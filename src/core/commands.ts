// Declarative, serialisable document operations. The editor UI, the MCP
// server and the browser bridge all go through `executeCommand`, so an agent
// editing a project sees exactly the same behaviour as a human.

import { compileProject } from "./codegen";
import {
  addNode,
  checkConnection,
  connect,
  createLoop,
  disconnect,
  findGlobal,
  LOOP_MODES,
  setLoopMode,
  type LoopMode,
  graphOf,
  inferTypes,
  nodeTitle,
  removeNodes,
  resolvePorts,
  uid,
} from "./graph";
import { autoLayout } from "./layout";
import { MULTI_OP_ORDER, multiOpInfo, newMultiOpId } from "./multiop";
import { allNodeDefs, getNodeDef } from "./registry";
import type { CodeNodeData, GlobalDef, GraphKind, GraphNode, GraphRef, PreviewSettings, ProjectDoc, XY } from "./types";

export type Command =
  | { op: "getGraph"; graph?: GraphRef }
  | {
      op: "addNode";
      graph?: GraphRef;
      type: string;
      position?: XY;
      values?: Record<string, unknown>;
      label?: string;
      localName?: string;
      activeInputs?: string[];
      code?: CodeNodeData;
      globalId?: string;
      localSourceId?: string;
      subgraphId?: string;
      parentId?: string;
      text?: string;
      width?: number;
      height?: number;
      /** math/multiOp: its operations (ids are generated when missing). */
      operations?: { id?: string; op: string }[];
      /** Name other operations in the same batch can reference as `$name`. */
      ref?: string;
    }
  | { op: "connect"; graph?: GraphRef; source: string; sourceHandle?: string; target: string; targetHandle: string }
  | { op: "disconnect"; graph?: GraphRef; edgeId?: string; target?: string; targetHandle?: string }
  | {
      op: "updateNode";
      graph?: GraphRef;
      nodeId: string;
      values?: Record<string, unknown>;
      activeInputs?: string[];
      label?: string;
      localName?: string;
      text?: string;
      code?: Partial<CodeNodeData>;
      position?: XY;
      parentId?: string | null;
      width?: number;
      height?: number;
      operations?: { id?: string; op: string }[];
    }
  | { op: "deleteNodes"; graph?: GraphRef; nodeIds: string[] }
  | { op: "autoLayout"; graph?: GraphRef }
  | { op: "clearGraph"; graph?: GraphRef }
  | { op: "compile" }
  | { op: "addGlobal"; name: string; kind?: GlobalDef["kind"]; type?: string; value?: unknown; ref?: string }
  | { op: "updateGlobal"; id: string; name?: string; kind?: GlobalDef["kind"]; type?: string; value?: unknown }
  | { op: "removeGlobal"; id: string }
  | { op: "updateSettings"; settings: Partial<PreviewSettings> }
  | { op: "rename"; name: string }
  | { op: "batch"; ops: Command[] };

/** Commands that do not modify the document. */
export const READ_ONLY_OPS = new Set(["getGraph", "compile"]);

export function isReadOnly(cmd: Command): boolean {
  if (cmd.op === "batch") return cmd.ops.every(isReadOnly);
  return READ_ONLY_OPS.has(cmd.op);
}

export class CommandError extends Error {}

// ---------------------------------------------------------------------------

type Refs = Map<string, string>;

function resolveRef(refs: Refs, id: string | undefined): string {
  if (!id) return id as unknown as string;
  if (id.startsWith("$")) {
    const r = refs.get(id.slice(1));
    if (!r) throw new CommandError(`Unknown reference "${id}"`);
    return r;
  }
  return id;
}

function g(cmd: { graph?: GraphRef }): GraphRef {
  const graph = cmd.graph ?? "material";
  if (graph !== "material" && graph !== "post" && !graph.startsWith("sg:"))
    throw new CommandError(`Unknown graph "${graph}"`);
  return graph;
}

function nextPosition(doc: ProjectDoc, graph: GraphRef): XY {
  const nodes = graphOf(doc, graph).nodes;
  if (!nodes.length) return { x: 0, y: 0 };
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const maxY = Math.max(...nodes.map((n) => n.position.y));
  return { x: minX - 260, y: maxY + 40 };
}

export function executeCommand(doc: ProjectDoc, cmd: Command, refs: Refs = new Map()): unknown {
  switch (cmd.op) {
    case "getGraph":
      return describeGraph(doc, g(cmd));

    case "addNode": {
      const graph = g(cmd);
      const def = getNodeDef(cmd.type);
      if (!def) {
        const suggestions = allNodeDefs()
          .filter((d) => d.type.toLowerCase().includes(cmd.type.toLowerCase().split("/").pop() ?? ""))
          .slice(0, 8)
          .map((d) => d.type);
        throw new CommandError(
          `Unknown node type "${cmd.type}".${suggestions.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""}`,
        );
      }
      if (def.kind === "placeholder")
        throw new CommandError("Placeholder nodes only come from imports and can't be added");
      if (def.graphs && !graph.startsWith("sg:") && !def.graphs.includes(graph as GraphKind))
        throw new CommandError(`"${cmd.type}" can only be used in the ${def.graphs.join("/")} graph`);
      if (def.kind === "loop") {
        // a loop comes with the parts for its mode
        const mode = String(cmd.values?.loopMode ?? "count") as LoopMode;
        if (!LOOP_MODES.some((m) => m.value === mode)) throw new CommandError(`Unknown loop mode "${mode}"`);
        const { loop, parts } = createLoop(doc, graph, cmd.position ?? nextPosition(doc, graph), mode);
        for (const k of ["loopType", "loopCompare"]) if (cmd.values?.[k] !== undefined) loop.data.values[k] = cmd.values[k];
        if (cmd.label) loop.data.label = cmd.label;
        if (cmd.width) loop.width = cmd.width;
        if (cmd.height) loop.height = cmd.height;
        if (cmd.ref) refs.set(cmd.ref, loop.id);
        return { nodeId: loop.id, ...(cmd.ref ? { ref: cmd.ref } : {}), parts };
      }
      if (def.kind === "loopPart" && cmd.parentId) {
        const parentId = resolveRef(refs, cmd.parentId);
        const existing = graphOf(doc, graph).nodes.find((n) => n.parentId === parentId && n.type === cmd.type);
        if (existing)
          throw new CommandError(`That loop already has a ${cmd.type} part ("${existing.id}"); loops create their own parts, so use that one`);
      }
      const node = addNode(doc, graph, cmd.type, cmd.position ?? nextPosition(doc, graph), {
        ...(cmd.values ? { values: cmd.values } : {}),
        ...(cmd.label ? { label: cmd.label } : {}),
        ...(cmd.localName ? { localName: cmd.localName } : {}),
        ...(cmd.code ? { code: cmd.code } : {}),
        ...(cmd.globalId ? { globalId: resolveRef(refs, cmd.globalId) } : {}),
        ...(cmd.localSourceId ? { localSourceId: resolveRef(refs, cmd.localSourceId) } : {}),
        ...(cmd.subgraphId ? { subgraphId: cmd.subgraphId } : {}),
        ...(cmd.text !== undefined ? { text: cmd.text } : {}),
      });
      if (cmd.activeInputs) node.data.activeInputs = [...cmd.activeInputs];
      if (cmd.operations) {
        if (def.kind !== "multiOp") throw new CommandError("operations only apply to math/multiOp");
        setMultiOpOperations(doc, graph, node, cmd.operations, cmd.values);
      }
      if (cmd.parentId) node.parentId = resolveRef(refs, cmd.parentId);
      if (cmd.width) node.width = cmd.width;
      if (cmd.height) node.height = cmd.height;
      if (cmd.ref) refs.set(cmd.ref, node.id);
      return { nodeId: node.id, ...(cmd.ref ? { ref: cmd.ref } : {}), ports: portSummary(doc, graph, node.id) };
    }

    case "connect": {
      const graph = g(cmd);
      const source = resolveRef(refs, cmd.source);
      const target = resolveRef(refs, cmd.target);
      const res = connect(doc, graph, {
        source,
        sourceHandle: cmd.sourceHandle ?? "out",
        target,
        targetHandle: cmd.targetHandle,
      });
      if (!res.ok) throw new CommandError(res.error ?? "Connection failed");
      return { edgeId: res.edge!.id };
    }

    case "disconnect": {
      const graph = g(cmd);
      const edges = graphOf(doc, graph).edges;
      const ids = cmd.edgeId
        ? [cmd.edgeId]
        : edges
            .filter((e) => e.target === resolveRef(refs, cmd.target) && (!cmd.targetHandle || e.targetHandle === cmd.targetHandle))
            .map((e) => e.id);
      if (!ids.length) throw new CommandError("No matching edge");
      disconnect(doc, graph, ids);
      return { removed: ids.length };
    }

    case "updateNode": {
      const graph = g(cmd);
      const id = resolveRef(refs, cmd.nodeId);
      const node = graphOf(doc, graph).nodes.find((n) => n.id === id);
      if (!node) throw new CommandError(`Node "${id}" not found in ${graph} graph`);
      if (getNodeDef(node.type)?.kind === "placeholder") {
        const onlyMoves = Object.keys(cmd).every((k) => ["op", "graph", "nodeId", "position"].includes(k));
        if (!onlyMoves) throw new CommandError("Unsupported imported nodes are read-only; delete them or replace them");
      }
      if (cmd.values) for (const [k, v] of Object.entries(cmd.values)) if (k !== "loopMode") node.data.values[k] = v;
      let loopParts: Record<string, string> | undefined;
      if (cmd.values?.loopMode !== undefined) {
        if (getNodeDef(node.type)?.kind !== "loop") throw new CommandError("loopMode only applies to loop nodes");
        const mode = String(cmd.values.loopMode) as LoopMode;
        if (!LOOP_MODES.some((m) => m.value === mode)) throw new CommandError(`Unknown loop mode "${mode}"`);
        loopParts = setLoopMode(doc, graph, node.id, mode);
      }
      if (cmd.activeInputs) node.data.activeInputs = [...cmd.activeInputs];
      if (cmd.operations) {
        if (getNodeDef(node.type)?.kind !== "multiOp") throw new CommandError("operations only apply to math/multiOp");
        setMultiOpOperations(doc, graph, node, cmd.operations, cmd.values);
      }
      if (cmd.label !== undefined) node.data.label = cmd.label || undefined;
      if (cmd.localName !== undefined) node.data.localName = cmd.localName || undefined;
      if (cmd.text !== undefined) node.data.text = cmd.text;
      if (cmd.code) {
        if (!node.data.code) throw new CommandError("Node is not a code node");
        Object.assign(node.data.code, cmd.code);
        // drop edges to ports that disappeared
        const ports = resolvePorts(doc, node);
        graphOf(doc, graph).edges = graphOf(doc, graph).edges.filter(
          (e) =>
            (e.target !== node.id || ports.inputs.some((p) => p.key === e.targetHandle)) &&
            (e.source !== node.id || ports.outputs.some((p) => p.key === e.sourceHandle)),
        );
      }
      if (cmd.position) node.position = { x: Math.round(cmd.position.x), y: Math.round(cmd.position.y) };
      if (cmd.parentId !== undefined) node.parentId = cmd.parentId ? resolveRef(refs, cmd.parentId) : undefined;
      if (cmd.width) node.width = cmd.width;
      if (cmd.height) node.height = cmd.height;
      return { nodeId: node.id, ...(loopParts ? { parts: loopParts } : {}) };
    }

    case "deleteNodes": {
      const graph = g(cmd);
      const ids = cmd.nodeIds.map((i) => resolveRef(refs, i));
      const missing = ids.filter((i) => !graphOf(doc, graph).nodes.some((n) => n.id === i));
      if (missing.length) throw new CommandError(`Nodes not found: ${missing.join(", ")}`);
      removeNodes(doc, graph, ids);
      return { removed: ids.length };
    }

    case "autoLayout":
      autoLayout(graphOf(doc, g(cmd)));
      return { ok: true };

    case "clearGraph": {
      const gr = graphOf(doc, g(cmd));
      gr.nodes = [];
      gr.edges = [];
      return { ok: true };
    }

    case "compile": {
      const r = compileProject(doc);
      return { code: r.code, diagnostics: r.diagnostics };
    }

    case "addGlobal": {
      const global: GlobalDef = {
        id: uid("g"),
        name: cmd.name,
        kind: cmd.kind ?? "uniform",
        type: cmd.type ?? "float",
        value: cmd.value ?? defaultGlobalValue(cmd.type ?? "float"),
      };
      doc.globals.push(global);
      if (cmd.ref) refs.set(cmd.ref, global.id);
      return { globalId: global.id };
    }

    case "updateGlobal": {
      const gl = findGlobal(doc, resolveRef(refs, cmd.id));
      if (!gl) throw new CommandError(`Global "${cmd.id}" not found`);
      if (cmd.name !== undefined) gl.name = cmd.name;
      if (cmd.kind !== undefined) gl.kind = cmd.kind;
      if (cmd.type !== undefined) gl.type = cmd.type;
      if (cmd.value !== undefined) gl.value = cmd.value;
      return { globalId: gl.id };
    }

    case "removeGlobal": {
      const id = resolveRef(refs, cmd.id);
      doc.globals = doc.globals.filter((x) => x.id !== id);
      return { ok: true };
    }

    case "updateSettings":
      Object.assign(doc.settings, cmd.settings);
      return { settings: doc.settings };

    case "rename":
      doc.name = cmd.name;
      return { name: doc.name };

    case "batch": {
      const results: unknown[] = [];
      cmd.ops.forEach((op, i) => {
        try {
          results.push(executeCommand(doc, op, refs));
        } catch (err) {
          throw new CommandError(
            `Operation ${i} (${op.op}) failed: ${err instanceof Error ? err.message : String(err)}. ` +
              `Operations before it were applied.`,
          );
        }
      });
      return { results, refs: Object.fromEntries(refs) };
    }
  }
  throw new CommandError(`Unknown op "${(cmd as { op: string }).op}"`);
}

export function defaultGlobalValue(type: string): unknown {
  switch (type) {
    case "color":
      return "#ffffff";
    case "vec2":
      return [0, 0];
    case "vec3":
      return [0, 0, 0];
    case "vec4":
      return [0, 0, 0, 1];
    case "bool":
      return false;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// agent-friendly summaries
// ---------------------------------------------------------------------------

export function portSummary(doc: ProjectDoc, graph: GraphRef, nodeId: string) {
  const node = graphOf(doc, graph).nodes.find((n) => n.id === nodeId)!;
  const types = inferTypes(doc, graphOf(doc, graph)).get(nodeId);
  const ports = resolvePorts(doc, node);
  return {
    inputs: ports.inputs.map((p) => ({
      key: p.key,
      type: types?.in[p.key] ?? p.type,
      ...(p.propertyOnly ? { propertyOnly: true } : {}),
      ...(p.connectionOnly ? { connectionOnly: true } : {}),
      ...(p.options ? { options: p.options.map((o) => o.value) } : {}),
    })),
    outputs: ports.outputs.map((p) => ({ key: p.key, type: types?.out[p.key] ?? p.type })),
  };
}

export function describeGraph(doc: ProjectDoc, graph: GraphRef) {
  const gr = graphOf(doc, graph);
  const types = inferTypes(doc, gr);
  return {
    project: { id: doc.id, name: doc.name },
    graph,
    nodes: gr.nodes.map((n) => {
      const def = getNodeDef(n.type);
      const ports = resolvePorts(doc, n);
      const connected = new Set(gr.edges.filter((e) => e.target === n.id).map((e) => e.targetHandle));
      const values: Record<string, unknown> = {};
      for (const p of ports.inputs) {
        if (connected.has(p.key) || p.connectionOnly) continue;
        const v = n.data.values[p.key] ?? p.default;
        if (v !== undefined) values[p.key] = v;
      }
      if (def?.kind === "uniform") {
        values.type = n.data.values.type;
        values.value = n.data.values.value;
      }
      return {
        id: n.id,
        type: n.type,
        title: nodeTitle(doc, n),
        position: n.position,
        ...(n.parentId ? { parentId: n.parentId } : {}),
        ...(Object.keys(values).length ? { values } : {}),
        ...(n.data.activeInputs ? { activeInputs: n.data.activeInputs } : {}),
        ...(n.data.localName ? { localName: n.data.localName } : {}),
        ...(n.data.text ? { text: n.data.text } : {}),
        ...(n.data.code ? { code: n.data.code } : {}),
        inputs: ports.inputs.map((p) => `${p.key}:${types.get(n.id)?.in[p.key] ?? p.type}`),
        outputs: ports.outputs.map((p) => `${p.key}:${types.get(n.id)?.out[p.key] ?? p.type}`),
      };
    }),
    edges: gr.edges.map((e) => ({
      id: e.id,
      from: `${e.source}.${e.sourceHandle}`,
      to: `${e.target}.${e.targetHandle}`,
    })),
    globals: doc.globals,
  };
}

/** Replace a multi-op's operations, dropping wires and values for ports that no longer exist. */
function setMultiOpOperations(
  doc: ProjectDoc,
  graph: GraphRef,
  node: GraphNode,
  operations: { id?: string; op: string }[],
  values?: Record<string, unknown>,
) {
  const unknown = operations.filter((o) => !multiOpInfo(o.op)).map((o) => o.op);
  if (unknown.length) throw new CommandError(`Unknown operation(s): ${unknown.join(", ")}. Available: ${MULTI_OP_ORDER.join(", ")}`);
  node.data.operations = operations.map((o, i) => ({ id: o.id ?? newMultiOpId(i), op: o.op }));
  const keys = new Set(resolvePorts(doc, node).inputs.map((p) => p.key));
  const g = graphOf(doc, graph);
  g.edges = g.edges.filter((e) => e.target !== node.id || keys.has(e.targetHandle));
  for (const k of Object.keys(node.data.values)) if (!keys.has(k)) delete node.data.values[k];
  // values given alongside may target the new ports
  if (values) for (const [k, v] of Object.entries(values)) if (keys.has(k)) node.data.values[k] = v;
}

export function describeNodeType(type: string) {
  const def = getNodeDef(type);
  if (!def) throw new CommandError(`Unknown node type "${type}"`);
  return {
    type: def.type,
    label: def.label,
    category: def.category,
    description: def.description,
    tsl: def.tsl && !def.tsl.startsWith("__") ? def.tsl : undefined,
    importFrom: def.importFrom,
    graphs: def.graphs ?? ["material", "post"],
    inputs: def.inputs.map((p) => ({
      key: p.key,
      label: p.label,
      type: p.type,
      default: p.default,
      ...(p.connectionOnly ? { connectionOnly: true } : {}),
      ...(p.propertyOnly ? { propertyOnly: true } : {}),
      ...(p.isMaterialProp ? { materialProperty: true } : {}),
      ...(p.options ? { options: p.options } : {}),
    })),
    outputs: def.outputs.map((p) => ({ key: p.key, label: p.label, type: p.type })),
    ...(def.defaultActiveInputs ? { defaultActiveInputs: def.defaultActiveInputs } : {}),
    notes: NODE_NOTES[def.kind ?? ""] ?? undefined,
  };
}

const NODE_NOTES: Record<string, string> = {
  material:
    "Material output node. Only inputs listed in activeInputs are shown/compiled; connecting to an input activates it. Set activeInputs via updateNode.",
  uniform: "Values: { type: 'float'|'int'|'bool'|'vec2'|'vec3'|'vec4'|'color', value }. Uniform values update live without recompiling.",
  code: "Set data via addNode/updateNode `code`: { language: 'tsl'|'wgsl', source, inputs:[{key,type}], outputs:[{key,type}] }. TSL source is a JS function body using TSL functions; input keys are variables; return a node (or an object keyed by output keys when there are several outputs).",
  localSet: "Give it a localName and connect `value`. Local Get nodes reference it via localSourceId.",
  localGet: "Set localSourceId to the id of a Set Local node.",
  globalRef: "Set globalId to a project global (see addGlobal).",
  loop:
    "Loop container. Adding it creates its parts (returned as `parts`, by type) for values.loopMode: count (loop/count, loop/index), range (loop/start, loop/end, loop/index), reverse (loop/start, loop/index; counts down from start-1 to 0), nested (loop/count, loop/count2, loop/index, loop/index2) or condition (loop/condition: a while loop). Every mode also has loop/accumulator and loop/output. Range/reverse take values.loopType (int|float) and values.loopCompare (<, <=, >, >=). Change the mode later with update_node values.loopMode, which swaps the parts. Put your math nodes inside with parentId = the loop id: accumulator.acc is the running value, wire the next value into loop/output.next, and loop/output.out outside the loop is the result.",
  multiOp:
    "A chain of math operations in one node (like sin(x).mul(2).add(0.5)). Set `operations: [{ op }]` on add_node/update_node, using TSL names: " +
    MULTI_OP_ORDER.join(", ") +
    ". The previous result feeds each operation's first/chain input automatically; the other inputs become ports named op_<operationId>_<key> (see the returned ports) and take inline values under the same keys. Output is `out`.",
  gradient: "values.stops: [{ pos: 0..1, color: '#rrggbb' }]; values.mode: 0 linear, 1 step.",
  textureSample: "values.url: image URL or data URL.",
  comment: "Markdown text in `text`; width/height set the box size.",
};

export function listNodeTypes(filter: { category?: string; search?: string; graph?: GraphRef } = {}) {
  const q = filter.search?.toLowerCase().trim();
  return allNodeDefs()
    .filter((d) => d.category !== "Subgraph" && d.type !== "subgraph/instance" && d.kind !== "placeholder")
    .filter((d) => !filter.category || d.category.toLowerCase() === filter.category.toLowerCase())
    .filter((d) => !filter.graph || !d.graphs || filter.graph.startsWith("sg:") || d.graphs.includes(filter.graph as GraphKind))
    .filter(
      (d) =>
        !q ||
        d.type.toLowerCase().includes(q) ||
        d.label.toLowerCase().includes(q) ||
        (d.description ?? "").toLowerCase().includes(q) ||
        (d.tsl ?? "").toLowerCase().includes(q),
    )
    .map((d) => ({
      type: d.type,
      label: d.label,
      category: d.category,
      ...(d.description ? { description: d.description } : {}),
    }));
}

/** Summaries for connection-check feedback without mutating. */
export function tryConnect(doc: ProjectDoc, graph: GraphRef, c: Parameters<typeof checkConnection>[2]) {
  return checkConnection(doc, graph, c);
}
