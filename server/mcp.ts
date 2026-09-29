import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  describeNodeType,
  executeCommand,
  isReadOnly,
  listNodeTypes,
  type Command,
} from "../src/core/commands";
import { compileProject } from "../src/core/codegen";
import { CATEGORY_ORDER } from "../src/core/registry";
import { broadcast, callEditor, liveEditorFor, navigateClient, openEditors } from "./bridge";
import { getProject, listProjects, newProject, saveProject } from "./store";

const INSTRUCTIONS = `TSL Graph is a node-based editor for Three.js TSL (WebGPU) shaders.

A project has two graphs: "material" (must contain one material node such as material/standard; its inputs like colorNode/positionNode receive the shader) and "post" (post-processing; post/input provides the rendered scene, post/output receives the final color).

Workflow:
1. list_projects / create_project, or omit projectId to use the project currently open in the browser editor.
2. get_graph to see node ids, ports and edges. list_node_types / get_node_type to discover nodes (types look like "math/mul", "geo/uv", "noise/fractal_noise_float", "tslTextures/marble").
3. add_node, connect_nodes, update_node, delete_nodes — or apply_operations to do many steps in one call using "ref" names ("$name") for new nodes.
4. compile_graph returns the generated TSL code and diagnostics. validate_graph (needs the editor open) also reports runtime/shader errors. capture_preview returns a screenshot of the live 3D preview.

Tips: ports are identified by key (see get_node_type). Unconnected inputs use their inline values (set via update_node values). Material nodes only compile inputs listed in activeInputs; connecting an input activates it automatically. Output handles "x","y","z","w" (or "r","g","b") are swizzles of "out". Call auto_layout after building a graph so it is readable for the user.`;

const graphSchema = z.enum(["material", "post"]).optional().describe('Which graph (default "material")');
const projectIdSchema = z
  .string()
  .optional()
  .describe("Project id. Omit to use the project currently open in the browser editor.");

type ToolResult = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function fail(err: unknown): ToolResult {
  return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
}

function wrap<A>(fn: (args: A) => Promise<ToolResult>) {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err);
    }
  };
}

async function resolveProjectId(projectId?: string): Promise<string> {
  if (projectId) return projectId;
  const editors = openEditors().filter((e) => e.projectId);
  const visible = editors.find((e) => e.visible) ?? editors[0];
  if (visible?.projectId) return visible.projectId;
  throw new Error("No projectId given and no project is open in the editor. Use list_projects or create_project.");
}

export async function runCommand(projectIdArg: string | undefined, command: Command): Promise<unknown> {
  const projectId = await resolveProjectId(projectIdArg);
  const live = liveEditorFor(projectId);
  if (live) return callEditor(live, "command", { projectId, command });
  const doc = await getProject(projectId);
  if (!doc) throw new Error(`Project "${projectId}" not found`);
  const result = executeCommand(doc, command);
  if (!isReadOnly(command)) {
    doc.updatedAt = Date.now();
    await saveProject(doc);
    broadcast(projectId, { type: "reload", projectId });
  }
  return result;
}

const baseUrl = () => `http://localhost:${process.env.PORT ?? 5173}`;

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "tsl-graph", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  // ---- projects -------------------------------------------------------------

  server.registerTool(
    "list_projects",
    { description: "List saved projects (most recently edited first) and which are open in the editor." },
    wrap(async () => {
      const projects = await listProjects();
      const open = new Set(openEditors().map((e) => e.projectId));
      return ok(
        projects.map((p) => ({
          id: p.id,
          name: p.name,
          nodeCount: p.nodeCount,
          updatedAt: new Date(p.updatedAt).toISOString(),
          openInEditor: open.has(p.id),
          url: `${baseUrl()}/editor/${p.id}`,
        })),
      );
    }),
  );

  server.registerTool(
    "create_project",
    {
      description:
        "Create a new project (material graph starts with a MeshStandardMaterial, post graph with Post Input → Post Output). Set open=true to navigate a connected editor tab to it.",
      inputSchema: { name: z.string().optional(), open: z.boolean().optional() },
    },
    wrap(async ({ name, open }: { name?: string; open?: boolean }) => {
      const doc = await newProject(name);
      let opened = false;
      if (open) opened = await navigateEditor(doc.id);
      return ok({ projectId: doc.id, name: doc.name, url: `${baseUrl()}/editor/${doc.id}`, openedInEditor: opened });
    }),
  );

  server.registerTool(
    "open_project",
    {
      description: "Navigate the connected browser editor to a project so changes appear live. Returns its URL.",
      inputSchema: { projectId: z.string() },
    },
    wrap(async ({ projectId }: { projectId: string }) => {
      const doc = await getProject(projectId);
      if (!doc) throw new Error(`Project "${projectId}" not found`);
      const opened = await navigateEditor(projectId);
      return ok({
        url: `${baseUrl()}/editor/${projectId}`,
        openedInEditor: opened,
        ...(opened ? {} : { note: "No editor tab is connected; ask the user to open the URL." }),
      });
    }),
  );

  server.registerTool(
    "rename_project",
    { description: "Rename a project.", inputSchema: { projectId: projectIdSchema, name: z.string() } },
    wrap(async ({ projectId, name }: { projectId?: string; name: string }) =>
      ok(await runCommand(projectId, { op: "rename", name })),
    ),
  );

  // ---- node catalog ---------------------------------------------------------

  server.registerTool(
    "list_node_types",
    {
      description: `List available node types. Filter by category (${CATEGORY_ORDER.join(", ")}, Loop) or free-text search.`,
      inputSchema: {
        category: z.string().optional(),
        search: z.string().optional(),
        graph: graphSchema,
      },
    },
    wrap(async (args: { category?: string; search?: string; graph?: "material" | "post" }) => {
      const list = listNodeTypes(args);
      return ok(list.length ? list : "No matching node types.");
    }),
  );

  server.registerTool(
    "get_node_type",
    {
      description: "Full definition of a node type: input/output port keys, types, defaults, options and usage notes.",
      inputSchema: { type: z.string().describe('e.g. "math/mix"') },
    },
    wrap(async ({ type }: { type: string }) => ok(describeNodeType(type))),
  );

  // ---- graph reading --------------------------------------------------------

  server.registerTool(
    "get_graph",
    {
      description: "Snapshot of a graph: nodes (id, type, values, ports with inferred types) and edges.",
      inputSchema: { projectId: projectIdSchema, graph: graphSchema },
    },
    wrap(async ({ projectId, graph }: { projectId?: string; graph?: "material" | "post" }) =>
      ok(await runCommand(projectId, { op: "getGraph", graph })),
    ),
  );

  server.registerTool(
    "compile_graph",
    {
      description: "Generate the exported Three.js TSL code for the project and return it with compiler diagnostics.",
      inputSchema: { projectId: projectIdSchema },
    },
    wrap(async ({ projectId }: { projectId?: string }) => ok(await runCommand(projectId, { op: "compile" }))),
  );

  server.registerTool(
    "validate_graph",
    {
      description:
        "Compile and, when the project is open in the editor, evaluate it in the live WebGPU preview. Returns compiler diagnostics plus runtime/shader errors.",
      inputSchema: { projectId: projectIdSchema },
    },
    wrap(async ({ projectId }: { projectId?: string }) => {
      const id = await resolveProjectId(projectId);
      const live = liveEditorFor(id);
      if (live) return ok(await callEditor(live, "validate", {}));
      const doc = await getProject(id);
      if (!doc) throw new Error(`Project "${id}" not found`);
      const r = compileProject(doc);
      return ok({ diagnostics: r.diagnostics, runtimeErrors: null, note: "Editor not open: runtime errors not checked." });
    }),
  );

  // ---- editing --------------------------------------------------------------

  server.registerTool(
    "add_node",
    {
      description:
        "Add a node. Returns its id and ports. `values` sets inline input values (e.g. { value: 0.5 } for const/float, { a: 1 } for math/add).",
      inputSchema: {
        projectId: projectIdSchema,
        graph: graphSchema,
        type: z.string(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
        values: z.record(z.string(), z.any()).optional(),
        label: z.string().optional(),
        localName: z.string().optional().describe("Variable name in generated code"),
        activeInputs: z.array(z.string()).optional().describe("Material nodes: inputs to show/compile"),
        parentId: z.string().optional().describe("Loop or group container id"),
        code: z
          .object({
            language: z.enum(["tsl", "wgsl"]),
            source: z.string(),
            inputs: z.array(z.object({ key: z.string(), type: z.string() })),
            outputs: z.array(z.object({ key: z.string(), type: z.string() })),
          })
          .optional()
          .describe("Code nodes (type code/tsl)"),
        globalId: z.string().optional(),
        localSourceId: z.string().optional(),
        text: z.string().optional().describe("Comment text (utils/comment)"),
      },
    },
    wrap(async ({ projectId, ...rest }: { projectId?: string } & Omit<Extract<Command, { op: "addNode" }>, "op">) =>
      ok(await runCommand(projectId, { op: "addNode", ...rest })),
    ),
  );

  server.registerTool(
    "connect_nodes",
    {
      description:
        "Connect an output port to an input port. Replaces any existing connection into that input. sourceHandle defaults to \"out\".",
      inputSchema: {
        projectId: projectIdSchema,
        graph: graphSchema,
        source: z.string(),
        sourceHandle: z.string().optional(),
        target: z.string(),
        targetHandle: z.string(),
      },
    },
    wrap(async ({ projectId, ...rest }: { projectId?: string } & Omit<Extract<Command, { op: "connect" }>, "op">) =>
      ok(await runCommand(projectId, { op: "connect", ...rest })),
    ),
  );

  server.registerTool(
    "disconnect",
    {
      description: "Remove a connection by edge id, or every connection into target(.targetHandle).",
      inputSchema: {
        projectId: projectIdSchema,
        graph: graphSchema,
        edgeId: z.string().optional(),
        target: z.string().optional(),
        targetHandle: z.string().optional(),
      },
    },
    wrap(async ({ projectId, ...rest }: { projectId?: string } & Omit<Extract<Command, { op: "disconnect" }>, "op">) =>
      ok(await runCommand(projectId, { op: "disconnect", ...rest })),
    ),
  );

  server.registerTool(
    "update_node",
    {
      description:
        "Update a node: inline input values, material activeInputs, label, localName, comment text, code-node source/ports, position or container.",
      inputSchema: {
        projectId: projectIdSchema,
        graph: graphSchema,
        nodeId: z.string(),
        values: z.record(z.string(), z.any()).optional(),
        activeInputs: z.array(z.string()).optional(),
        label: z.string().optional(),
        localName: z.string().optional(),
        text: z.string().optional(),
        code: z
          .object({
            language: z.enum(["tsl", "wgsl"]).optional(),
            source: z.string().optional(),
            inputs: z.array(z.object({ key: z.string(), type: z.string() })).optional(),
            outputs: z.array(z.object({ key: z.string(), type: z.string() })).optional(),
          })
          .optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
        parentId: z.string().nullable().optional(),
      },
    },
    wrap(async ({ projectId, ...rest }: { projectId?: string } & Omit<Extract<Command, { op: "updateNode" }>, "op">) =>
      ok(await runCommand(projectId, { op: "updateNode", ...rest })),
    ),
  );

  server.registerTool(
    "delete_nodes",
    {
      description: "Delete nodes (and their connections).",
      inputSchema: { projectId: projectIdSchema, graph: graphSchema, nodeIds: z.array(z.string()) },
    },
    wrap(async ({ projectId, graph, nodeIds }: { projectId?: string; graph?: "material" | "post"; nodeIds: string[] }) =>
      ok(await runCommand(projectId, { op: "deleteNodes", graph, nodeIds })),
    ),
  );

  server.registerTool(
    "auto_layout",
    {
      description: "Arrange the graph left-to-right by data flow.",
      inputSchema: { projectId: projectIdSchema, graph: graphSchema },
    },
    wrap(async ({ projectId, graph }: { projectId?: string; graph?: "material" | "post" }) =>
      ok(await runCommand(projectId, { op: "autoLayout", graph })),
    ),
  );

  server.registerTool(
    "clear_graph",
    {
      description: "Remove every node from a graph (undoable in the editor).",
      inputSchema: { projectId: projectIdSchema, graph: graphSchema },
    },
    wrap(async ({ projectId, graph }: { projectId?: string; graph?: "material" | "post" }) =>
      ok(await runCommand(projectId, { op: "clearGraph", graph })),
    ),
  );

  server.registerTool(
    "apply_operations",
    {
      description: `Apply many operations atomically-in-order (one undo step in the editor). Each op is an object with "op" plus the fields of the matching tool:
- {op:"addNode", type, graph?, position?, values?, ref?:"name", ...}  (later ops can use "$name" instead of a node id)
- {op:"connect", source, sourceHandle?, target, targetHandle, graph?}
- {op:"disconnect", edgeId? | target, targetHandle?}
- {op:"updateNode", nodeId, values?, activeInputs?, ...}
- {op:"deleteNodes", nodeIds}
- {op:"addGlobal", name, kind?:"uniform"|"const", type?, value?, ref?}
- {op:"updateGlobal", id, ...} / {op:"removeGlobal", id}
- {op:"updateSettings", settings}
- {op:"autoLayout", graph?}
Stops at the first failing op (earlier ops stay applied).`,
      inputSchema: {
        projectId: projectIdSchema,
        operations: z.array(z.record(z.string(), z.any())),
      },
    },
    wrap(async ({ projectId, operations }: { projectId?: string; operations: Record<string, unknown>[] }) =>
      ok(await runCommand(projectId, { op: "batch", ops: operations as unknown as Command[] })),
    ),
  );

  // ---- globals & preview ------------------------------------------------------

  server.registerTool(
    "add_global",
    {
      description:
        "Add a project-level global (uniform or const) usable from both graphs via a global/ref node (set its globalId).",
      inputSchema: {
        projectId: projectIdSchema,
        name: z.string(),
        kind: z.enum(["uniform", "const"]).optional(),
        type: z.enum(["float", "int", "bool", "vec2", "vec3", "vec4", "color"]).optional(),
        value: z.any().optional(),
      },
    },
    wrap(async ({ projectId, ...rest }: { projectId?: string; name: string; kind?: "uniform" | "const"; type?: string; value?: unknown }) =>
      ok(await runCommand(projectId, { op: "addGlobal", ...rest })),
    ),
  );

  server.registerTool(
    "update_preview_settings",
    {
      description:
        "Change the 3D preview: geometry (sphere|box|torus|torusKnot|plane|cylinder|icosahedron|script), geometryParams, environment (none|apartment|city|dawn|forest|lobby|night|park|studio|sunset|warehouse|...), envIntensity, showBackground, showGrid, enablePost, instancing, instanceCount.",
      inputSchema: { projectId: projectIdSchema, settings: z.record(z.string(), z.any()) },
    },
    wrap(async ({ projectId, settings }: { projectId?: string; settings: Record<string, unknown> }) =>
      ok(await runCommand(projectId, { op: "updateSettings", settings })),
    ),
  );

  server.registerTool(
    "capture_preview",
    {
      description: "Screenshot of the live 3D preview (requires the project to be open in the editor).",
      inputSchema: {
        projectId: projectIdSchema,
        width: z.number().int().min(64).max(2048).optional(),
        height: z.number().int().min(64).max(2048).optional(),
      },
    },
    wrap(async ({ projectId, width, height }: { projectId?: string; width?: number; height?: number }) => {
      const id = await resolveProjectId(projectId);
      const live = liveEditorFor(id);
      if (!live) throw new Error("Project is not open in the editor; call open_project first.");
      const dataUrl = await callEditor<string>(live, "capturePreview", { width: width ?? 512, height: height ?? 512 });
      const [, mime, b64] = /^data:([^;]+);base64,(.*)$/.exec(dataUrl) ?? [];
      if (!b64) throw new Error("Editor returned no image");
      return { content: [{ type: "image", data: b64, mimeType: mime }] };
    }),
  );

  return server;
}

async function navigateEditor(projectId: string): Promise<boolean> {
  const editors = openEditors();
  const target = editors.find((e) => e.visible) ?? editors[0];
  if (!target) return false;
  return navigateClient(target.clientId, projectId);
}
