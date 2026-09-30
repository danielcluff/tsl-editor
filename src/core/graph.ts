import { componentCount, getNodeDef, visibleSplitOutputs } from "./registry";
import type {
  GlobalDef,
  Graph,
  GraphEdge,
  GraphKind,
  GraphNode,
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
  if (def.kind === "multiOp" && !node.data.ops) {
    node.data.ops = [{ op: "add" }];
    node.data.values = { in0: 0, in1: 0 };
  }
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
    case "multiOp": {
      const n = (node.data.ops?.length ?? 1) + 1;
      inputs = Array.from({ length: n }, (_, i) => ({
        key: `in${i}`,
        label: String.fromCharCode(65 + i),
        type: "any",
        default: 0,
      }));
      break;
    }
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

function literalType(v: unknown): string {
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
  // Deleting a container releases its children.
  for (const n of g.nodes) if (n.parentId && set.has(n.parentId)) n.parentId = undefined;
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
