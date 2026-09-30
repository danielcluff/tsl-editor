// One tool table shared by the MCP server and the in-editor AI chat agent.
import { z } from "zod";
import { describeNodeType, executeCommand, isReadOnly, listNodeTypes, type Command } from "../src/core/commands";
import { compileProject } from "../src/core/codegen";
import { CATEGORY_ORDER } from "../src/core/registry";
import { broadcast, callEditor, liveEditorFor, navigateClient, openEditors } from "./bridge";
import { getProject, listProjects, newProject, saveProject } from "./store";

export const INSTRUCTIONS = `TSL Graph is a node-based editor for Three.js TSL (WebGPU) shaders.

A project has two graphs: "material" (must contain one material node such as material/standard; its inputs like colorNode/positionNode receive the shader) and "post" (post-processing; post/input provides the rendered scene, post/output receives the final color).

Workflow:
1. list_projects / create_project, or omit projectId to use the project currently open in the browser editor.
2. get_graph to see node ids, ports and edges. list_node_types / get_node_type to discover nodes (types look like "math/mul", "geo/uv", "noise/fractal_noise_float", "tslTextures/marble").
3. add_node, connect_nodes, update_node, delete_nodes — or apply_operations to do many steps in one call using "ref" names ("$name") for new nodes.
4. compile_graph returns the generated TSL code and diagnostics. validate_graph (needs the editor open) also reports runtime/shader errors. capture_preview returns a screenshot of the live 3D preview.

Tips: ports are identified by key (see get_node_type). Unconnected inputs use their inline values (set via update_node values). Material nodes only compile inputs listed in activeInputs; connecting an input activates it automatically. Output handles "x","y","z","w" (or "r","g","b") are swizzles of "out". Call auto_layout after building a graph so it is readable for the user.`;

export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ToolResult {
  [key: string]: unknown;
  content: ToolContent[];
  isError?: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  /** Tools that manage projects rather than editing the open one (hidden from the in-editor chat). */
  projectManagement?: boolean;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const graphSchema = z.enum(["material", "post"]).optional().describe('Which graph (default "material")');
const projectIdSchema = z
  .string()
  .optional()
  .describe("Project id. Omit to use the project currently open in the browser editor.");

export function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

export function fail(err: unknown): ToolResult {
  return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
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

async function navigateEditor(projectId: string): Promise<boolean> {
  const editors = openEditors();
  const target = editors.find((e) => e.visible) ?? editors[0];
  if (!target) return false;
  return navigateClient(target.clientId, projectId);
}

type A = Record<string, unknown>;
const pid = (a: A) => a.projectId as string | undefined;
/** Command fields = tool args minus projectId. */
const cmd = <T extends Command["op"]>(op: T, a: A) => {
  const { projectId: _p, ...rest } = a;
  return { op, ...rest } as unknown as Extract<Command, { op: T }>;
};

const codeShape = z.object({
  language: z.enum(["tsl", "wgsl"]),
  source: z.string(),
  inputs: z.array(z.object({ key: z.string(), type: z.string() })),
  outputs: z.array(z.object({ key: z.string(), type: z.string() })),
});

export const TOOLS: ToolSpec[] = [
  // ---- projects ------------------------------------------------------------
  {
    name: "list_projects",
    description: "List saved projects (most recently edited first) and which are open in the editor.",
    shape: {},
    projectManagement: true,
    run: async () => {
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
    },
  },
  {
    name: "create_project",
    description:
      "Create a new project (material graph starts with a MeshStandardMaterial, post graph with Post Input → Post Output). Set open=true to navigate a connected editor tab to it.",
    shape: { name: z.string().optional(), open: z.boolean().optional() },
    projectManagement: true,
    run: async (a) => {
      const doc = await newProject(a.name as string | undefined);
      const opened = a.open ? await navigateEditor(doc.id) : false;
      return ok({ projectId: doc.id, name: doc.name, url: `${baseUrl()}/editor/${doc.id}`, openedInEditor: opened });
    },
  },
  {
    name: "open_project",
    description: "Navigate the connected browser editor to a project so changes appear live. Returns its URL.",
    shape: { projectId: z.string() },
    projectManagement: true,
    run: async (a) => {
      const projectId = a.projectId as string;
      if (!(await getProject(projectId))) throw new Error(`Project "${projectId}" not found`);
      const opened = await navigateEditor(projectId);
      return ok({
        url: `${baseUrl()}/editor/${projectId}`,
        openedInEditor: opened,
        ...(opened ? {} : { note: "No editor tab is connected; ask the user to open the URL." }),
      });
    },
  },
  {
    name: "rename_project",
    description: "Rename a project.",
    shape: { projectId: projectIdSchema, name: z.string() },
    run: async (a) => ok(await runCommand(pid(a), { op: "rename", name: a.name as string })),
  },

  // ---- node catalog --------------------------------------------------------
  {
    name: "list_node_types",
    description: `List available node types. Filter by category (${CATEGORY_ORDER.join(", ")}, Loop) or free-text search.`,
    shape: { category: z.string().optional(), search: z.string().optional(), graph: graphSchema },
    run: async (a) => {
      const list = listNodeTypes(a as { category?: string; search?: string; graph?: "material" | "post" });
      return ok(list.length ? list : "No matching node types.");
    },
  },
  {
    name: "get_node_type",
    description: "Full definition of a node type: input/output port keys, types, defaults, options and usage notes.",
    shape: { type: z.string().describe('e.g. "math/mix"') },
    run: async (a) => ok(describeNodeType(a.type as string)),
  },

  // ---- reading -------------------------------------------------------------
  {
    name: "get_graph",
    description: "Snapshot of a graph: nodes (id, type, values, ports with inferred types) and edges.",
    shape: { projectId: projectIdSchema, graph: graphSchema },
    run: async (a) => ok(await runCommand(pid(a), cmd("getGraph", a))),
  },
  {
    name: "compile_graph",
    description: "Generate the exported Three.js TSL code for the project and return it with compiler diagnostics.",
    shape: { projectId: projectIdSchema },
    run: async (a) => ok(await runCommand(pid(a), { op: "compile" })),
  },
  {
    name: "validate_graph",
    description:
      "Compile and, when the project is open in the editor, evaluate it in the live WebGPU preview. Returns compiler diagnostics plus runtime/shader errors.",
    shape: { projectId: projectIdSchema },
    run: async (a) => {
      const id = await resolveProjectId(pid(a));
      const live = liveEditorFor(id);
      if (live) return ok(await callEditor(live, "validate", {}));
      const doc = await getProject(id);
      if (!doc) throw new Error(`Project "${id}" not found`);
      return ok({ diagnostics: compileProject(doc).diagnostics, runtimeErrors: null, note: "Editor not open: runtime errors not checked." });
    },
  },

  // ---- editing -------------------------------------------------------------
  {
    name: "add_node",
    description:
      "Add a node. Returns its id and ports. `values` sets inline input values (e.g. { value: 0.5 } for const/float, { a: 1 } for math/add).",
    shape: {
      projectId: projectIdSchema,
      graph: graphSchema,
      type: z.string(),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      values: z.record(z.string(), z.any()).optional(),
      label: z.string().optional(),
      localName: z.string().optional().describe("Variable name in generated code"),
      activeInputs: z.array(z.string()).optional().describe("Material nodes: inputs to show/compile"),
      parentId: z.string().optional().describe("Loop or group container id"),
      code: codeShape.optional().describe("Code nodes (type code/tsl)"),
      globalId: z.string().optional(),
      localSourceId: z.string().optional(),
      text: z.string().optional().describe("Comment text (utils/comment)"),
      operations: z
        .array(z.object({ id: z.string().optional(), op: z.string() }))
        .optional()
        .describe("math/multiOp: the chain of operations (TSL names, e.g. sin, mul, add); ports become op_<id>_<key>"),
    },
    run: async (a) => ok(await runCommand(pid(a), cmd("addNode", a))),
  },
  {
    name: "connect_nodes",
    description:
      'Connect an output port to an input port. Replaces any existing connection into that input. sourceHandle defaults to "out".',
    shape: {
      projectId: projectIdSchema,
      graph: graphSchema,
      source: z.string(),
      sourceHandle: z.string().optional(),
      target: z.string(),
      targetHandle: z.string(),
    },
    run: async (a) => ok(await runCommand(pid(a), cmd("connect", a))),
  },
  {
    name: "disconnect",
    description: "Remove a connection by edge id, or every connection into target(.targetHandle).",
    shape: {
      projectId: projectIdSchema,
      graph: graphSchema,
      edgeId: z.string().optional(),
      target: z.string().optional(),
      targetHandle: z.string().optional(),
    },
    run: async (a) => ok(await runCommand(pid(a), cmd("disconnect", a))),
  },
  {
    name: "update_node",
    description:
      "Update a node: inline input values, material activeInputs, label, localName, comment text, code-node source/ports, multi-op operations, position or container.",
    shape: {
      projectId: projectIdSchema,
      graph: graphSchema,
      nodeId: z.string(),
      values: z.record(z.string(), z.any()).optional(),
      activeInputs: z.array(z.string()).optional(),
      label: z.string().optional(),
      localName: z.string().optional(),
      text: z.string().optional(),
      code: codeShape.partial().optional(),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      parentId: z.string().nullable().optional(),
      operations: z
        .array(z.object({ id: z.string().optional(), op: z.string() }))
        .optional()
        .describe("math/multiOp: the chain of operations (TSL names, e.g. sin, mul, add); ports become op_<id>_<key>"),
    },
    run: async (a) => ok(await runCommand(pid(a), cmd("updateNode", a))),
  },
  {
    name: "delete_nodes",
    description: "Delete nodes (and their connections).",
    shape: { projectId: projectIdSchema, graph: graphSchema, nodeIds: z.array(z.string()) },
    run: async (a) => ok(await runCommand(pid(a), cmd("deleteNodes", a))),
  },
  {
    name: "auto_layout",
    description: "Arrange the graph left-to-right by data flow.",
    shape: { projectId: projectIdSchema, graph: graphSchema },
    run: async (a) => ok(await runCommand(pid(a), cmd("autoLayout", a))),
  },
  {
    name: "clear_graph",
    description: "Remove every node from a graph (undoable in the editor).",
    shape: { projectId: projectIdSchema, graph: graphSchema },
    run: async (a) => ok(await runCommand(pid(a), cmd("clearGraph", a))),
  },
  {
    name: "apply_operations",
    description: `Apply many operations in order (one undo step in the editor). Each op is an object with "op" plus the fields of the matching tool:
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
    shape: { projectId: projectIdSchema, operations: z.array(z.record(z.string(), z.any())) },
    run: async (a) => ok(await runCommand(pid(a), { op: "batch", ops: a.operations as unknown as Command[] })),
  },

  // ---- globals & preview ---------------------------------------------------
  {
    name: "add_global",
    description: "Add a project-level global (uniform or const) usable from both graphs via a global/ref node (set its globalId).",
    shape: {
      projectId: projectIdSchema,
      name: z.string(),
      kind: z.enum(["uniform", "const"]).optional(),
      type: z.enum(["float", "int", "bool", "vec2", "vec3", "vec4", "color"]).optional(),
      value: z.any().optional(),
    },
    run: async (a) => ok(await runCommand(pid(a), cmd("addGlobal", a))),
  },
  {
    name: "update_preview_settings",
    description:
      "Change the 3D preview: geometry (sphere|box|torus|torusKnot|plane|cylinder|icosahedron|fullscreenQuad), geometryParams, geometryScript (JS run on the built geometry with `geometry` and `THREE` in scope; mutate it or return a new BufferGeometry), environment (none|apartment|city|dawn|forest|lobby|night|park|studio|sunset|warehouse|...), envIntensity, showBackground, showGrid, enablePost, instancing, instanceCount, and lighting: lightEnabled, lightIntensity, lightColor (hex), lightAzimuth (degrees around Y, 0 = front), lightElevation (degrees above horizon), showLightHelper, ambientIntensity, and nodePreviews (default for the preview thumbnails on nodes; setting it through the editor toolbar also clears per-node overrides).",
    shape: { projectId: projectIdSchema, settings: z.record(z.string(), z.any()) },
    run: async (a) => ok(await runCommand(pid(a), cmd("updateSettings", a))),
  },
  {
    name: "capture_preview",
    description: "Screenshot of the live 3D preview (requires the project to be open in the editor).",
    shape: {
      projectId: projectIdSchema,
      width: z.number().int().min(64).max(2048).optional(),
      height: z.number().int().min(64).max(2048).optional(),
    },
    run: async (a) => {
      const id = await resolveProjectId(pid(a));
      const live = liveEditorFor(id);
      if (!live) throw new Error("Project is not open in the editor; call open_project first.");
      const dataUrl = await callEditor<string>(live, "capturePreview", {
        width: (a.width as number | undefined) ?? 512,
        height: (a.height as number | undefined) ?? 512,
      });
      const [, mime, b64] = /^data:([^;]+);base64,(.*)$/.exec(dataUrl) ?? [];
      if (!b64) throw new Error("Editor returned no image");
      return { content: [{ type: "image", data: b64, mimeType: mime }] };
    },
  },
];

/** Run a tool by name, turning thrown errors into error results. */
export async function runTool(spec: ToolSpec, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    return await spec.run(args);
  } catch (err) {
    return fail(err);
  }
}
