import { componentCount, getNodeDef, visibleSplitOutputs } from "./registry";
import { migrateLegacyMultiOps, multiOpHandleId, multiOpInfo, multiOpInputs, multiOpParams, newMultiOpId } from "./multiop";
import type {
  GlobalDef,
  Graph,
  GraphEdge,
  GraphKind,
  GraphNode,
  MultiOpOperation,
  GraphRef,
  NodeData,
  NodeDef,
  PortDef,
  PreviewSettings,
  ProjectDoc,
  SubgraphDef,
  XY,
} from "./types";

// ---------------------------------------------------------------------------
// ids / factories
// ---------------------------------------------------------------------------

let counter = 0;
export function uid(prefix = "n"): string {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36).slice(-5)}${counter.toString(36).padStart(2, "0")}${Math.floor(
    Math.random() * 36 ** 2,
  )
    .toString(36)
    .padStart(2, "0")}`;
}

export function defaultSettings(): PreviewSettings {
  return {
    geometry: "sphere",
    geometryParams: {},
    environment: "none",
    envIntensity: 1,
    showBackground: false,
    showGrid: true,
    enablePost: true,
    showBackdrop: false,
    instancing: false,
    instanceCount: 100,
    thumbnail: "auto",
    // matches the original fixed light at (3, 5, 4)
    lightEnabled: true,
    lightIntensity: 2,
    lightColor: "#ffffff",
    lightAzimuth: 36.87,
    lightElevation: 45,
    showLightHelper: false,
    ambientIntensity: 1.2,
    nodePreviews: true,
  };
}

/** Settings with defaults filled in (projects saved before a field existed lack it). */
export function resolveSettings(s: Partial<PreviewSettings> | undefined): PreviewSettings {
  return { ...defaultSettings(), ...s };
}

export function emptyGraph(): Graph {
  return { nodes: [], edges: [] };
}

export function createProject(name = "Untitled"): ProjectDoc {
  const now = Date.now();
  const doc: ProjectDoc = {
    id: uid("p"),
    name,
    createdAt: now,
    updatedAt: now,
    version: 1,
    graphs: { material: emptyGraph(), post: emptyGraph() },
    globals: [],
    customNodes: [],
    settings: defaultSettings(),
  };
  addNode(doc, "material", "material/standard", { x: 400, y: 200 });
  const pin = addNode(doc, "post", "post/input", { x: 80, y: 160 });
  const pout = addNode(doc, "post", "post/output", { x: 460, y: 180 });
  connect(doc, "post", { source: pin.id, sourceHandle: "color", target: pout.id, targetHandle: "color" });
  return doc;
}

export function defaultValues(def: NodeDef): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const input of def.inputs) {
    if (input.default !== undefined) values[input.key] = clone(input.default);
  }
  if (def.kind === "uniform") {
    values.type = "float";
    values.value = 0.5;
  }
  if (def.type === "const/color" && values.value === undefined) values.value = "#ffffff";
  return values;
}

function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

export function makeNode(type: string, position: XY, data: Partial<NodeData> = {}): GraphNode {
  const def = getNodeDef(type);
  if (!def) throw new Error(`Unknown node type "${type}"`);
  const node: GraphNode = {
    id: uid(),
    type,
    position: { x: Math.round(position.x), y: Math.round(position.y) },
    data: { values: defaultValues(def), ...data },
  };
  if (def.kind === "material" && !node.data.activeInputs) {
    node.data.activeInputs = [...(def.defaultActiveInputs ?? [])];
  }
  if (def.kind === "postInput" && !node.data.activeInputs) {
    node.data.activeInputs = [...(def.defaultActiveInputs ?? ["color", "depth", "normal"])];
  }
  if (def.kind === "comment") {
    node.width ??= 240;
    node.height ??= 120;
    node.data.text ??= "";
  }
  if (def.kind === "group" || def.kind === "loop") {
    node.width ??= 420;
    node.height ??= 260;
    node.data.label ??= def.kind === "loop" ? "Loop" : "Group";
  }
  if (def.kind === "code" && !node.data.code) {
    node.data.code = {
      language: "tsl",
      source: "// inputs are available by name\nreturn mix(a, b, 0.5);",
      inputs: [
        { key: "a", type: "vec3" },
        { key: "b", type: "vec3" },
      ],
      outputs: [{ key: "out", type: "vec3" }],
    };
  }
  // a new multi-op starts with one Add, like the original; its inputs use the defaults
  if (def.kind === "multiOp" && !node.data.operations) node.data.operations = [{ id: newMultiOpId(), op: "add" }];
  return node;
}

// ---------------------------------------------------------------------------
// port resolution + type inference
// ---------------------------------------------------------------------------

export interface ResolvedPorts {
  inputs: PortDef[];
  outputs: PortDef[];
}

const vecOuts = (type: string): PortDef[] => {
  const n = componentCount(type);
  const keys = type === "color" ? ["r", "g", "b"] : ["x", "y", "z", "w"].slice(0, n);
  if (n === 1) return [{ key: "out", label: "Out", type }];
  return [
    ...keys.map((k) => ({ key: k, label: k.toUpperCase(), type: "float" })),
    { key: "out", label: "Out", type },
  ];
};

export function findSubgraph(doc: ProjectDoc, id: string | undefined): SubgraphDef | undefined {
  return id ? doc.customNodes.find((s) => s.id === id) : undefined;
}

export function findGlobal(doc: ProjectDoc, id: string | undefined): GlobalDef | undefined {
  return id ? doc.globals.find((g) => g.id === id) : undefined;
}

/**
 * All ports a node can have (properties panel view). `forCanvas` filters to
 * the handles actually drawn on the node (active material inputs, visible
 * split components, no property-only ports).
 */
export function resolvePorts(
  doc: ProjectDoc,
  node: GraphNode,
  opts: { forCanvas?: boolean; types?: TypeMap } = {},
): ResolvedPorts {
  const def = getNodeDef(node.type);
  if (!def) return { inputs: [], outputs: [] };
  let inputs = def.inputs;
  let outputs = def.outputs;
  switch (def.kind) {
    case "uniform": {
      const t = String(node.data.values.type ?? "float");
      outputs = vecOuts(t);
      break;
    }
    case "code": {
      const c = node.data.code;
      inputs = (c?.inputs ?? []).map((i) => ({ key: i.key, label: i.key, type: i.type }));
      outputs = (c?.outputs ?? []).map((o) => ({ key: o.key, label: o.key, type: o.type }));
      break;
    }
    case "subgraph": {
      const sg = findSubgraph(doc, node.data.subgraphId);
      inputs = (sg?.inputs ?? []).map((i) => ({ ...i, key: i.key }));
      outputs = sg?.outputs ?? [];
      break;
    }
    case "subgraphInput":
      inputs = [];
      outputs = (node.data.ports ?? []).map((p) => ({ ...p }));
      break;
    case "subgraphOutput":
      inputs = (node.data.ports ?? []).map((p) => ({ ...p, connectionOnly: true }));
      outputs = [];
      break;
    case "globalRef": {
      const g = findGlobal(doc, node.data.globalId);
      outputs = g ? vecOuts(g.type) : [{ key: "out", label: "Out", type: "any" }];
      break;
    }
    case "multiOp":
      inputs = multiOpInputs(node.data.operations ?? []).map((i) => i.port);
      break;
    case "split": {
      if (opts.forCanvas) {
        const inType = opts.types?.get(node.id)?.in?.in ?? "vec4";
        outputs = outputs.filter((o) => visibleSplitOutputs([o.key], inType).length > 0);
      }
      break;
    }
    case "material":
    case "postInput": {
      if (opts.forCanvas) {
        const active = new Set(node.data.activeInputs ?? def.defaultActiveInputs ?? []);
        if (def.kind === "material") inputs = inputs.filter((i) => active.has(i.key) && !i.propertyOnly);
        else outputs = outputs.filter((o) => active.has(o.key));
      }
      break;
    }
    case "placeholder": {
      const ph = node.data.placeholder;
      inputs = (ph?.inputs ?? []).map((k) => ({ key: k, label: k, type: "any", connectionOnly: true }));
      outputs = (ph?.outputs ?? []).map((k) => ({ key: k, label: k, type: "any" }));
      break;
    }
    case "localGet": {
      outputs = [{ key: "out", label: "Out", type: "any" }];
      break;
    }
  }
  if (opts.forCanvas) inputs = inputs.filter((i) => !i.propertyOnly && !i.hidden);
  return { inputs, outputs };
}

export type TypeMap = Map<string, { in: Record<string, string>; out: Record<string, string> }>;

const RANK: Record<string, number> = { bool: 0, int: 1, uint: 1, float: 2, vec2: 3, vec3: 4, color: 4, vec4: 5 };

/** Types an unconnected `any` input can be set to (the original's "Type" picker). */
export const ANY_VALUE_TYPES = ["float", "vec2", "vec3", "vec4", "color", "bool"] as const;
export type AnyValueType = (typeof ANY_VALUE_TYPES)[number];

/** Convert a literal to another type, keeping as much of the old value as makes sense. */
export function convertAnyValue(v: unknown, to: AnyValueType): unknown {
  const comps = (): number[] => {
    if (typeof v === "number") return [v];
    if (typeof v === "boolean") return [v ? 1 : 0];
    if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) return [1, 3, 5].map((i) => Math.round((parseInt(v.slice(i, i + 2), 16) / 255) * 1000) / 1000);
    if (Array.isArray(v)) return v.map((x) => Number(x) || 0);
    return [0];
  };
  const c = comps();
  switch (to) {
    case "float":
      return c[0] ?? 0;
    case "bool":
      return c.some((x) => x !== 0);
    case "color": {
      if (typeof v === "string" && v.startsWith("#")) return v;
      const rgb = c.length === 1 ? [c[0], c[0], c[0]] : [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
      return "#" + rgb.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0")).join("");
    }
    default: {
      const n = Number(to.slice(-1));
      // a scalar fills every component (vec3(1) === vec3(1, 1, 1)), a vector is padded with 0s
      return Array.from({ length: n }, (_, i) => (c.length === 1 ? c[0] : (c[i] ?? 0)));
    }
  }
}

/** The type a literal value compiles to when its input accepts `any`. */
export function literalType(v: unknown): string {
  if (typeof v === "number") return "float";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "string" && v.startsWith("#")) return "color";
  if (Array.isArray(v)) return v.length === 2 ? "vec2" : v.length === 3 ? "vec3" : "vec4";
  return "any";
}

function widest(types: string[]): string {
  let best = "any";
  let rank = -1;
  for (const t of types) {
    const r = RANK[t];
    if (r !== undefined && r > rank) {
      best = t;
      rank = r;
    } else if (r === undefined && best === "any" && t !== "any") best = t;
  }
  return best;
}

/** Resolve effective types of every handle, propagating through `any` ports. */
/** Result type of a multi-op: each step's declared type, else the widest of its inputs. */
function multiOpResultType(operations: MultiOpOperation[], inTypes: Record<string, string>): string {
  let prev = "any";
  operations.forEach((o, i) => {
    const info = multiOpInfo(o.op);
    if (!info) return;
    const params = multiOpParams(o.op, i === 0).map((p) => inTypes[multiOpHandleId(o.id, p.key)] ?? p.type);
    const ins = (i === 0 ? params : [prev, ...params]).filter((t) => t !== "any");
    prev = info.outType !== "any" ? info.outType : ins.length ? widest(ins) : "any";
  });
  return prev;
}

/** Bring documents saved by older versions up to date (in place). */
export function normalizeDoc(doc: ProjectDoc): ProjectDoc {
  for (const g of [doc.graphs.material, doc.graphs.post, ...(doc.customNodes ?? []).map((s) => s.graph)]) migrateLegacyMultiOps(g);
  return doc;
}

export function inferTypes(doc: ProjectDoc, graph: Graph): TypeMap {
  const map: TypeMap = new Map();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const list = incoming.get(e.target) ?? [];
    list.push(e);
    incoming.set(e.target, list);
  }
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (map.has(id)) return map.get(id)!;
    const node = byId.get(id);
    const entry = { in: {} as Record<string, string>, out: {} as Record<string, string> };
    if (!node || visiting.has(id)) return entry;
    visiting.add(id);
    const ports = resolvePorts(doc, node);
    const edges = incoming.get(id) ?? [];
    for (const input of ports.inputs) {
      const e = edges.find((x) => x.targetHandle === input.key);
      if (e) {
        const src = visit(e.source);
        entry.in[input.key] = src.out[e.sourceHandle] ?? "any";
      } else if (input.type === "any") {
        entry.in[input.key] = literalType(node.data.values[input.key] ?? input.default);
      } else entry.in[input.key] = input.type;
    }
    const def = getNodeDef(node.type);
    for (const output of ports.outputs) {
      let t = output.type;
      if (t === "any") {
        if (def?.kind === "localGet") {
          const src = node.data.localSourceId ? visit(node.data.localSourceId) : undefined;
          t = src?.out.out ?? "any";
        } else if (def?.type === "logic/select") {
          t = widest([entry.in.trueVal, entry.in.falseVal]);
        } else if (def?.kind === "split") {
          t = entry.in.in ?? "any";
        } else if (def?.kind === "multiOp") {
          t = multiOpResultType(node.data.operations ?? [], entry.in);
        } else {
          const ins = Object.values(entry.in).filter((x) => x !== "any");
          t = ins.length ? widest(ins) : "any";
        }
      }
      entry.out[output.key] = t;
    }
    visiting.delete(id);
    map.set(id, entry);
    return entry;
  };
  for (const n of graph.nodes) visit(n.id);
  return map;
}

export function canConnectTypes(from: string, to: string): boolean {
  if (from === "any" || to === "any") return true;
  const tex = (t: string) => t === "texture" || t === "sampler2D";
  if (tex(from) || tex(to)) return tex(from) && tex(to);
  const mat = (t: string) => t.startsWith("mat");
  if (mat(from) || mat(to)) return from === to || (mat(from) && !mat(to) && to.startsWith("vec")) || false;
  if (from === "string" || to === "string") return from === to;
  return true;
}

// ---------------------------------------------------------------------------
// mutations — all operate in place so they work on Solid store drafts
// ---------------------------------------------------------------------------

export function graphOf(doc: ProjectDoc, graph: GraphRef): Graph {
  if (graph.startsWith("sg:")) {
    const sg = doc.customNodes.find((s) => s.id === graph.slice(3));
    if (!sg) throw new Error(`Subgraph "${graph.slice(3)}" not found`);
    return sg.graph;
  }
  const g = doc.graphs[graph as GraphKind];
  if (!g) throw new Error(`Unknown graph "${graph}"`);
  return g;
}

export function addNode(
  doc: ProjectDoc,
  graph: GraphRef,
  type: string,
  position: XY,
  data: Partial<NodeData> = {},
): GraphNode {
  const node = makeNode(type, position, data);
  if (data.values) node.data.values = { ...defaultValues(getNodeDef(type)!), ...data.values };
  graphOf(doc, graph).nodes.push(node);
  return node;
}

export function removeNodes(doc: ProjectDoc, graph: GraphRef, ids: string[]): void {
  const g = graphOf(doc, graph);
  const set = new Set(ids);
  // Deleting a loop takes its parts with it (they mean nothing on their own);
  // any other container just releases its children.
  for (const n of g.nodes) {
    if (!n.parentId || !set.has(n.parentId)) continue;
    const parent = g.nodes.find((p) => p.id === n.parentId);
    if (getNodeDef(parent?.type ?? "")?.kind === "loop" && getNodeDef(n.type)?.kind === "loopPart") set.add(n.id);
    else n.parentId = undefined;
  }
  g.nodes = g.nodes.filter((n) => !set.has(n.id));
  g.edges = g.edges.filter((e) => !set.has(e.source) && !set.has(e.target));
}

function wouldCycle(g: Graph, source: string, target: string): boolean {
  if (source === target) return true;
  const out = new Map<string, string[]>();
  for (const e of g.edges) {
    const l = out.get(e.source) ?? [];
    l.push(e.target);
    out.set(e.source, l);
  }
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(out.get(id) ?? []));
  }
  return false;
}

export interface ConnectResult {
  ok: boolean;
  edge?: GraphEdge;
  error?: string;
}

export function checkConnection(
  doc: ProjectDoc,
  graph: GraphRef,
  c: Omit<GraphEdge, "id">,
): { ok: boolean; error?: string } {
  const g = graphOf(doc, graph);
  const src = g.nodes.find((n) => n.id === c.source);
  const tgt = g.nodes.find((n) => n.id === c.target);
  if (!src) return { ok: false, error: `Source node "${c.source}" not found` };
  if (!tgt) return { ok: false, error: `Target node "${c.target}" not found` };
  const sp = resolvePorts(doc, src).outputs.find((o) => o.key === c.sourceHandle);
  const tp = resolvePorts(doc, tgt).inputs.find((i) => i.key === c.targetHandle);
  if (!sp)
    return {
      ok: false,
      error: `Output "${c.sourceHandle}" not found on ${src.type}. Available: ${resolvePorts(doc, src)
        .outputs.map((o) => o.key)
        .join(", ")}`,
    };
  if (!tp)
    return {
      ok: false,
      error: `Input "${c.targetHandle}" not found on ${tgt.type}. Available: ${resolvePorts(doc, tgt)
        .inputs.map((i) => i.key)
        .join(", ")}`,
    };
  if (getNodeDef(src.type)?.kind === "placeholder" || getNodeDef(tgt.type)?.kind === "placeholder")
    return { ok: false, error: "Unsupported imported nodes can't be connected; delete or replace them" };
  if (tp.propertyOnly) return { ok: false, error: `Input "${tp.key}" is property-only and cannot be connected` };
  if (wouldCycle(g, c.source, c.target)) return { ok: false, error: "Connection would create a cycle" };
  const types = inferTypes(doc, g);
  const from = types.get(src.id)?.out[sp.key] ?? sp.type;
  if (!canConnectTypes(from, tp.type)) return { ok: false, error: `Type mismatch: ${from} → ${tp.type}` };
  return { ok: true };
}

export function connect(doc: ProjectDoc, graph: GraphRef, c: Omit<GraphEdge, "id">): ConnectResult {
  const check = checkConnection(doc, graph, c);
  if (!check.ok) return check;
  const g = graphOf(doc, graph);
  // An input accepts a single edge: replace any existing one.
  g.edges = g.edges.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle));
  const edge: GraphEdge = { id: uid("e"), ...c };
  g.edges.push(edge);
  // Connecting to an inactive material input activates it.
  const tgt = g.nodes.find((n) => n.id === c.target)!;
  if (tgt.data.activeInputs && !tgt.data.activeInputs.includes(c.targetHandle)) {
    tgt.data.activeInputs.push(c.targetHandle);
  }
  return { ok: true, edge };
}

export function disconnect(doc: ProjectDoc, graph: GraphRef, edgeIds: string[]): void {
  const set = new Set(edgeIds);
  graphOf(doc, graph).edges = graphOf(doc, graph).edges.filter((e) => !set.has(e.id));
}

export function setNodeValue(doc: ProjectDoc, graph: GraphRef, nodeId: string, key: string, value: unknown): void {
  const node = graphOf(doc, graph).nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`Node "${nodeId}" not found`);
  node.data.values[key] = value;
}

export function findNode(doc: ProjectDoc, graph: GraphRef, id: string): GraphNode | undefined {
  return graphOf(doc, graph).nodes.find((n) => n.id === id);
}

/** Deep copy of nodes + internal edges with fresh ids, offset by `delta`. */
export function cloneSubset(
  g: Graph,
  ids: string[],
  delta: XY = { x: 40, y: 40 },
): { nodes: GraphNode[]; edges: GraphEdge[]; idMap: Map<string, string> } {
  const set = new Set(ids);
  const idMap = new Map<string, string>();
  const nodes = g.nodes
    .filter((n) => set.has(n.id))
    .map((n) => {
      const copy: GraphNode = JSON.parse(JSON.stringify(n));
      copy.id = uid();
      idMap.set(n.id, copy.id);
      copy.position = { x: n.position.x + delta.x, y: n.position.y + delta.y };
      return copy;
    });
  for (const n of nodes) {
    if (n.parentId) n.parentId = idMap.get(n.parentId);
    if (n.data.localSourceId && idMap.has(n.data.localSourceId)) n.data.localSourceId = idMap.get(n.data.localSourceId);
  }
  const edges = g.edges
    .filter((e) => set.has(e.source) && set.has(e.target))
    .map((e) => ({ ...e, id: uid("e"), source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
  return { nodes, edges, idMap };
}

export function nodeTitle(doc: ProjectDoc, node: GraphNode): string {
  if (node.data.label) return node.data.label;
  const def = getNodeDef(node.type);
  if (def?.kind === "placeholder") return node.data.placeholder?.originalType ?? def.label;
  if (def?.kind === "subgraph") return findSubgraph(doc, node.data.subgraphId)?.name ?? "Subgraph";
  if (def?.kind === "globalRef") return findGlobal(doc, node.data.globalId)?.name ?? "Global";
  if (def?.kind === "uniform" && node.data.localName) return node.data.localName;
  if (def?.kind === "localSet") return node.data.localName ? `Set ${node.data.localName}` : def.label;
  if (def?.kind === "localGet") {
    const all = [...doc.graphs.material.nodes, ...doc.graphs.post.nodes, ...doc.customNodes.flatMap((s) => s.graph.nodes)];
    const src = all.find((n) => n.id === node.data.localSourceId);
    return src?.data.localName ? `Get ${src.data.localName}` : def.label;
  }
  return def?.label ?? node.type;
}

export function nodeCount(doc: ProjectDoc): number {
  return doc.graphs.material.nodes.length + doc.graphs.post.nodes.length;
}

const NO_PREVIEW_KINDS = new Set(["comment", "group", "loop", "loopPart", "material", "postOutput", "placeholder", "subgraphInput", "subgraphOutput"]);

/** Whether nodes of this type produce a value that can be shown as a preview thumbnail. */
export function hasPreview(type: string): boolean {
  const def = getNodeDef(type);
  return !!def && def.outputs.length > 0 && !NO_PREVIEW_KINDS.has(def.kind ?? "");
}

/** Whether a node's preview is shown: its own override, else the project default. */
export function nodePreviewOn(doc: ProjectDoc, node: GraphNode): boolean {
  return node.data.debug ?? doc.settings.nodePreviews !== false;
}

/** Set the project default and drop every per-node override so all nodes follow it. */
export function setNodePreviewDefault(doc: ProjectDoc, on: boolean): void {
  doc.settings.nodePreviews = on;
  const graphs = [doc.graphs.material, doc.graphs.post, ...doc.customNodes.map((sg) => sg.graph)];
  for (const g of graphs) for (const n of g.nodes) delete n.data.debug;
}

// ---------------------------------------------------------------------------
// loops (modes and parts, matching the original)
// ---------------------------------------------------------------------------

export type LoopMode = "count" | "range" | "reverse" | "nested" | "condition";

export const LOOP_MODES: { value: LoopMode; label: string }[] = [
  { value: "count", label: "Count" },
  { value: "range", label: "Range" },
  { value: "reverse", label: "Reverse" },
  { value: "nested", label: "Nested" },
  { value: "condition", label: "Condition" },
];

export const LOOP_COMPARES = ["<", "<=", ">", ">="] as const;

/** Parts each mode needs besides the accumulator and output. */
const LOOP_MODE_PARTS: Record<LoopMode, string[]> = {
  count: ["loop/count", "loop/index"],
  range: ["loop/start", "loop/end", "loop/index"],
  reverse: ["loop/start", "loop/index"],
  nested: ["loop/count", "loop/count2", "loop/index", "loop/index2"],
  condition: ["loop/condition"],
};

/** Top-to-bottom order of the parts in the loop's left column. */
const LOOP_COLUMN = ["loop/count", "loop/count2", "loop/start", "loop/end", "loop/condition", "loop/index", "loop/index2", "loop/accumulator"];

export const LOOP_PART_TYPES = new Set([...LOOP_COLUMN, "loop/output"]);

/** A loop's mode; projects saved before modes existed are inferred from their parts. */
export function loopModeOf(loop: GraphNode, children: GraphNode[]): LoopMode {
  const m = loop.data.values.loopMode;
  if (typeof m === "string" && m in LOOP_MODE_PARTS) return m as LoopMode;
  const has = (t: string) => children.some((c) => c.type === t);
  if (has("loop/count2")) return "nested";
  if (has("loop/start") && has("loop/end")) return "range";
  if (has("loop/start")) return "reverse";
  if (has("loop/condition") && !has("loop/count")) return "condition";
  return "count";
}

/**
 * Set a loop's mode and make its parts match: adds the parts the mode needs,
 * removes the ones it doesn't (with their wires) and restacks the left column.
 * Returns the loop's parts by type.
 */
export function setLoopMode(doc: ProjectDoc, graph: GraphRef, loopId: string, mode: LoopMode): Record<string, string> {
  const g = graphOf(doc, graph);
  const loop = g.nodes.find((n) => n.id === loopId);
  if (!loop || getNodeDef(loop.type)?.kind !== "loop") throw new Error(`"${loopId}" is not a loop`);
  loop.data.values.loopMode = mode;
  const wanted = new Set([...LOOP_MODE_PARTS[mode], "loop/accumulator", "loop/output"]);
  const children = () => g.nodes.filter((n) => n.parentId === loop.id);
  removeNodes(
    doc,
    graph,
    children()
      .filter((c) => LOOP_PART_TYPES.has(c.type) && !wanted.has(c.type))
      .map((c) => c.id),
  );
  const width = loop.width ?? 560;
  let output = children().find((c) => c.type === "loop/output");
  for (const type of wanted) {
    if (children().some((c) => c.type === type)) continue;
    const part = addNode(doc, graph, type, { x: loop.position.x + 32, y: loop.position.y + 32 });
    part.parentId = loop.id;
    if (type === "loop/output") {
      part.position = { x: loop.position.x + width - 200, y: loop.position.y + 32 };
      output = part;
    }
  }
  // left column, evenly spaced; grow the loop if the column doesn't fit
  const column = LOOP_COLUMN.map((t) => children().find((c) => c.type === t)).filter(Boolean) as GraphNode[];
  column.forEach((c, i) => (c.position = { x: loop.position.x + 32, y: loop.position.y + 32 + i * 72 }));
  loop.height = Math.max(loop.height ?? 320, 32 + column.length * 72 + 24);
  // a fresh output starts wired to the accumulator, like a new loop
  const acc = children().find((c) => c.type === "loop/accumulator");
  if (acc && output && !g.edges.some((e) => e.target === output!.id && e.targetHandle === "next"))
    connect(doc, graph, { source: acc.id, sourceHandle: "acc", target: output.id, targetHandle: "next" });
  return Object.fromEntries(children().filter((c) => LOOP_PART_TYPES.has(c.type)).map((c) => [c.type, c.id]));
}

/** A new loop with the parts for `mode`. */
export function createLoop(doc: ProjectDoc, graph: GraphRef, position: XY, mode: LoopMode = "count"): { loop: GraphNode; parts: Record<string, string> } {
  const loop = addNode(doc, graph, "loop", position);
  loop.width = 560;
  loop.height = 320;
  return { loop, parts: setLoopMode(doc, graph, loop.id, mode) };
}

// ---------------------------------------------------------------------------
// surface-uniform outputs
// ---------------------------------------------------------------------------

/** Categories whose nodes only transform their inputs (no per-pixel sources of their own). */
const PURE_CATEGORIES = new Set(["Math", "Logic", "Easing", "Constants"]);

/**
 * Whether a node's output is the same for every pixel of the surface: everything
 * upstream is a constant, a uniform, time, or pure math/logic over those. Anything
 * else (UVs, positions, textures, noise, subgraphs, loops…) might vary, so this errs
 * towards `false`. Values can still change over time (e.g. sin(time)).
 */
export function isUniformAcrossSurface(doc: ProjectDoc, graph: Graph, nodeId: string): boolean {
  return uniformAcrossSurface(doc, graph).get(nodeId) ?? false;
}

/** isUniformAcrossSurface for every node at once (one pass, shared results). */
export function uniformAcrossSurface(doc: ProjectDoc, graph: Graph): Map<string, boolean> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const sources = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = sources.get(e.target) ?? [];
    list.push(e.source);
    sources.set(e.target, list);
  }
  const memo = new Map<string, boolean>();
  const visit = (id: string): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, false); // cycles count as varying
    const node = byId.get(id);
    const def = node && getNodeDef(node.type);
    let ok = false;
    if (node && def) {
      const upstream = () => (sources.get(id) ?? []).every(visit);
      if (def.kind === "globalRef") ok = findGlobal(doc, node.data.globalId)?.kind !== "varying";
      else if (def.kind === "localGet") ok = !!node.data.localSourceId && visit(node.data.localSourceId);
      else if (
        node.type === "geo/time" ||
        def.kind === "uniform" ||
        def.kind === "multiOp" ||
        def.kind === "localSet" ||
        def.kind === "const" ||
        (PURE_CATEGORIES.has(def.category) && (def.kind ?? "standard") === "standard")
      )
        ok = upstream();
    }
    memo.set(id, ok);
    return ok;
  };
  for (const n of graph.nodes) visit(n.id);
  return memo;
}

/**
 * A string per node that changes whenever anything that can affect its value changes:
 * the node's own data, its wiring and everything upstream (plus globals and subgraph
 * definitions, which any node may use). Layout and cosmetic fields are left out, so
 * moving or renaming nodes keeps signatures stable. Used to reuse preview shaders.
 */
export function nodeSignatures(doc: ProjectDoc, graph: Graph): Map<string, string> {
  const salt = JSON.stringify([doc.globals, doc.customNodes.map((s) => [s.id, s.inputs, s.outputs, s.graph.nodes.map((n) => [n.id, n.type, dataSig(n)]), s.graph.edges])]);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const list = incoming.get(e.target) ?? [];
    list.push(e);
    incoming.set(e.target, list);
  }
  const out = new Map<string, string>();
  const visiting = new Set<string>();
  const sig = (id: string): string => {
    const known = out.get(id);
    if (known !== undefined) return known;
    const n = byId.get(id);
    if (!n || visiting.has(id)) return `?${id}`;
    visiting.add(id);
    const ins = (incoming.get(id) ?? [])
      .map((e) => `${e.targetHandle}<${e.sourceHandle}:${sig(e.source)}`)
      .sort();
    const extra = n.data.localSourceId ? sig(n.data.localSourceId) : "";
    visiting.delete(id);
    const s = `${n.type}${dataSig(n)}[${ins.join(",")}]${extra}`;
    out.set(id, s);
    return s;
  };
  for (const n of graph.nodes) sig(n.id);
  for (const [id, s] of out) out.set(id, hashString(salt + s));
  return out;
}

/** Node data that affects its value (no preview toggle, label or collapse state). */
function dataSig(n: GraphNode): string {
  const { debug: _d, label: _l, collapsed: _c, ...rest } = n.data;
  return JSON.stringify([rest, n.parentId]);
}

/** Short stable hash (two 32-bit FNV-1a variants plus length) so signatures stay small. */
function hashString(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13);
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}.${s.length.toString(36)}`;
}

/**
 * Nodes whose output can change from frame to frame on its own: something upstream is
 * the Time node, a node with a `time` input left to its default (tsl-textures use the
 * live time uniform then), a code node (arbitrary TSL) or a subgraph containing any of
 * these. Everything else only changes when the graph or a uniform does.
 */
export function animatedNodes(doc: ProjectDoc, graph: Graph, seenSubgraphs = new Set<string>()): Set<string> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const sources = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = sources.get(e.target) ?? [];
    list.push(e.source);
    sources.set(e.target, list);
  }
  const wired = new Set(graph.edges.map((e) => `${e.target}:${e.targetHandle}`));
  const selfAnimated = (n: GraphNode): boolean => {
    const def = getNodeDef(n.type);
    if (!def) return false;
    if (n.type === "geo/time" || def.kind === "code") return true;
    if (def.inputs.some((i) => i.key.toLowerCase() === "time" && !wired.has(`${n.id}:${i.key}`) && n.data.values[i.key] === undefined)) return true;
    if (def.kind === "subgraph" && n.data.subgraphId && !seenSubgraphs.has(n.data.subgraphId)) {
      const sg = doc.customNodes.find((s) => s.id === n.data.subgraphId);
      if (!sg) return false;
      seenSubgraphs.add(sg.id);
      const inner = animatedNodes(doc, sg.graph, seenSubgraphs).size > 0;
      seenSubgraphs.delete(sg.id);
      return inner;
    }
    return false;
  };
  const memo = new Map<string, boolean>();
  const visit = (id: string): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, false);
    const n = byId.get(id);
    const v = !!n && (selfAnimated(n) || (sources.get(id) ?? []).some(visit) || (!!n.data.localSourceId && visit(n.data.localSourceId)));
    memo.set(id, v);
    return v;
  };
  const out = new Set<string>();
  for (const n of graph.nodes) if (visit(n.id)) out.add(n.id);
  return out;
}
