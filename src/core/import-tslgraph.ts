// Import projects exported by tsl-graph.xyz ("Save to JSON").
//
// Its format is React Flow based: child nodes store positions relative to
// their parent, subgraphs and code nodes live in project-level libraries and
// are referenced by type, and preview settings use different field names.
// Anything this editor can't represent becomes an `import/placeholder` node
// that keeps the original data (read-only) and can only be deleted.

import { createProject, makeNode, resolvePorts } from "./graph";
import { getNodeDef } from "./registry";
import type {
  CodeNodeData,
  GeometryKind,
  GlobalDef,
  Graph,
  GraphEdge,
  GraphKind,
  GraphNode,
  PreviewSettings,
  ProjectDoc,
  SubgraphDef,
} from "./types";

// ---------------------------------------------------------------------------
// source format (only the fields we read)
// ---------------------------------------------------------------------------

interface SrcNode {
  id: string;
  type: string;
  position?: { x: number; y: number };
  parentId?: string;
  style?: { width?: number | string; height?: number | string };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
  data?: {
    type?: string;
    values?: Record<string, unknown>;
    activeInputs?: string[];
    operations?: unknown[];
    [k: string]: unknown;
  };
}

interface SrcEdge {
  id?: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

interface SrcPort {
  id: string;
  label?: string;
  type?: string;
}

interface SrcSubgraph {
  id: string;
  name?: string;
  nodes?: SrcNode[];
  edges?: SrcEdge[];
  inputs?: SrcPort[];
  outputs?: SrcPort[];
  inputNodePosition?: { x: number; y: number };
  outputNodePosition?: { x: number; y: number };
}

interface SrcCodeNode {
  id: string;
  name?: string;
  code?: string;
  language?: string;
  inputs?: SrcPort[];
  output?: SrcPort;
}

export interface TslGraphExport {
  version?: number;
  nodes: SrcNode[];
  edges?: SrcEdge[];
  postNodes?: SrcNode[];
  postEdges?: SrcEdge[];
  globals?: unknown[];
  subgraphs?: Record<string, SrcSubgraph>;
  codeNodes?: Record<string, SrcCodeNode>;
  previewSettings?: Record<string, unknown>;
}

export interface ImportReport {
  nodes: number;
  edges: number;
  placeholders: { type: string; reason: string }[];
  droppedEdges: { edge: string; reason: string }[];
  warnings: string[];
}

/** True for a tsl-graph.xyz export (as opposed to one of our own project files). */
export function isTslGraphExport(json: unknown): json is TslGraphExport {
  const j = json as Partial<TslGraphExport & ProjectDoc> | null;
  return !!j && Array.isArray(j.nodes) && !j.graphs && ("postNodes" in j || "previewSettings" in j || "version" in j);
}

// ---------------------------------------------------------------------------

const SUBGRAPH_INPUT = "subgraph-input";
const SUBGRAPH_OUTPUT = "subgraph-output";

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function meta(node: SrcNode, extra: Record<string, unknown> = {}): string {
  const { values, ...rest } = node.data ?? {};
  const info: Record<string, unknown> = {
    type: node.type,
    id: node.id,
    ...extra,
    ...(values && Object.keys(values).length ? { values } : {}),
  };
  for (const [k, v] of Object.entries(rest)) {
    if (k === "type" || k === "connected") continue;
    if (v !== undefined && !(Array.isArray(v) && v.length === 0)) info[k] = v;
  }
  return JSON.stringify(info, null, 2);
}

interface Ctx {
  src: TslGraphExport;
  report: ImportReport;
  /** source subgraph id -> our SubgraphDef id */
  subgraphIds: Map<string, string>;
  /** source code-node library id -> definition */
  codeDefs: Map<string, SrcCodeNode>;
  globalIds: Set<string>;
  /** converted subgraph definitions (bodies filled in as they are converted) */
  subgraphs: SubgraphDef[];
}

/** Convert one graph's nodes + edges. Returns our Graph with absolute positions. */
function convertGraph(
  ctx: Ctx,
  nodes: SrcNode[],
  edges: SrcEdge[],
  where: GraphKind | "subgraph",
  anchors?: { input?: GraphNode; output?: GraphNode },
): Graph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const absCache = new Map<string, { x: number; y: number }>();
  const abs = (n: SrcNode, depth = 0): { x: number; y: number } => {
    const cached = absCache.get(n.id);
    if (cached) return cached;
    const p = { x: num(n.position?.x) ?? 0, y: num(n.position?.y) ?? 0 };
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const out = parent && depth < 20 ? (({ x, y }) => ({ x: x + p.x, y: y + p.y }))(abs(parent, depth + 1)) : p;
    absCache.set(n.id, out);
    return out;
  };

  const handlesUsed = (id: string) => ({
    inputs: [...new Set(edges.filter((e) => e.target === id).map((e) => e.targetHandle ?? "in"))],
    outputs: [...new Set(edges.filter((e) => e.source === id).map((e) => e.sourceHandle ?? "out"))],
  });

  const out: GraphNode[] = [];
  const placeholder = (n: SrcNode, reason: string, extra: Record<string, unknown> = {}) => {
    const h = handlesUsed(n.id);
    const node = makeNode("import/placeholder", abs(n), {
      placeholder: {
        originalType: n.type,
        originalId: n.id,
        reason,
        inputs: h.inputs,
        outputs: h.outputs,
        meta: meta(n, extra),
      },
    });
    node.id = n.id;
    ctx.report.placeholders.push({ type: n.type, reason });
    return node;
  };

  for (const n of nodes) {
    const type = n.type ?? n.data?.type ?? "";
    const values = { ...(n.data?.values ?? {}) };
    const pos = abs(n);
    let node: GraphNode | null = null;

    if (type === "group") {
      node = makeNode("utils/group", pos, { label: typeof values.label === "string" ? values.label : undefined });
      node.width = Math.round(num(n.style?.width) ?? num(n.measured?.width) ?? num(n.width) ?? 400);
      node.height = Math.round(num(n.style?.height) ?? num(n.measured?.height) ?? num(n.height) ?? 240);
    } else if (ctx.subgraphIds.has(type)) {
      node = makeNode("subgraph/instance", pos, { subgraphId: ctx.subgraphIds.get(type) });
    } else if (ctx.codeDefs.has(type)) {
      const def = ctx.codeDefs.get(type)!;
      node = makeNode("code/tsl", pos, { code: convertCode(def), label: def.name });
    } else if (type === "math/multiOp" && n.data?.operations) {
      // Their multi-op is a chain of arbitrary ops with per-op parameters;
      // ours is a fold of binary ops over inputs. The two don't map.
      node = placeholder(n, "Multi-op nodes use a different structure in this editor");
    } else {
      const def = getNodeDef(type);
      if (!def || def.kind === "placeholder" || def.type === "subgraph/instance" || def.type === "code/tsl") {
        node = placeholder(n, def ? "Node type can't be imported" : "Node type isn't available in this editor");
      } else if (where !== "subgraph" && def.graphs && !def.graphs.includes(where)) {
        node = placeholder(n, `Node type isn't allowed in the ${where} graph`);
      } else {
        node = makeNode(type, pos);
        const known = new Set(def.inputs.map((i) => i.key));
        for (const [k, v] of Object.entries(values)) if (known.has(k)) node.data.values[k] = v;
        if (n.data?.activeInputs) node.data.activeInputs = [...n.data.activeInputs];
        convertSpecialData(ctx, def.kind, values, node);
      }
    }
    if (!node) continue;
    if (node.type !== "import/placeholder") node.id = n.id;
    if (n.parentId && byId.has(n.parentId)) node.parentId = n.parentId;
    out.push(node);
  }

  // subgraph anchors take the source's fixed ids
  const idMap = new Map<string, string>();
  if (anchors?.input) {
    out.push(anchors.input);
    idMap.set(SUBGRAPH_INPUT, anchors.input.id);
  }
  if (anchors?.output) {
    out.push(anchors.output);
    idMap.set(SUBGRAPH_OUTPUT, anchors.output.id);
  }

  const graph: Graph = { nodes: out, edges: [] };
  const ourById = new Map(out.map((n) => [n.id, n]));
  // a scratch doc so port resolution can see the subgraph definitions
  const probe = createProject("probe");
  probe.customNodes = ctx.subgraphs;
  for (const e of edges) {
    const source = idMap.get(e.source) ?? e.source;
    const target = idMap.get(e.target) ?? e.target;
    const s = ourById.get(source);
    const t = ourById.get(target);
    const label = `${e.source}.${e.sourceHandle ?? "out"} → ${e.target}.${e.targetHandle ?? ""}`;
    if (!s || !t) {
      ctx.report.droppedEdges.push({ edge: label, reason: "endpoint missing" });
      continue;
    }
    const sourceHandle = e.sourceHandle ?? "out";
    const targetHandle = e.targetHandle ?? "";
    const outs = resolvePorts(probe, s).outputs.map((p) => p.key);
    const ins = resolvePorts(probe, t).inputs.map((p) => p.key);
    if (!outs.includes(sourceHandle) || !ins.includes(targetHandle)) {
      ctx.report.droppedEdges.push({ edge: label, reason: "port not found on the converted node" });
      continue;
    }
    graph.edges.push({ id: e.id ?? `e_${graph.edges.length}`, source, sourceHandle, target, targetHandle } satisfies GraphEdge);
  }
  ctx.report.nodes += out.length;
  ctx.report.edges += graph.edges.length;
  return graph;
}

function convertSpecialData(ctx: Ctx, kind: string | undefined, values: Record<string, unknown>, node: GraphNode) {
  switch (kind) {
    case "uniform":
      node.data.values = {
        type: typeof values.uniformType === "string" ? values.uniformType : typeof values.type === "string" ? values.type : "float",
        value: values.value ?? 0,
      };
      if (typeof values.localName === "string") node.data.localName = values.localName;
      break;
    case "comment":
      node.data.text = String(values.text ?? values.content ?? values.label ?? "");
      break;
    case "localSet":
      if (typeof (values.localName ?? values.name) === "string") node.data.localName = String(values.localName ?? values.name);
      break;
    case "localGet": {
      const src = values.localSourceId ?? values.sourceId ?? values.source;
      if (typeof src === "string") node.data.localSourceId = src;
      break;
    }
    case "globalRef": {
      const id = values.globalId ?? values.id;
      if (typeof id === "string") {
        node.data.globalId = id;
        if (!ctx.globalIds.has(id)) ctx.report.warnings.push(`Global reference "${id}" points at a global that wasn't in the file`);
      }
      break;
    }
  }
  if (typeof values.localName === "string" && !node.data.localName && kind !== "uniform") node.data.localName = values.localName;
}

/**
 * Their code nodes hold a TSL expression (usually `Fn(([a, b]) => ...)`) called
 * with the inputs in order; ours are a function body with inputs by name.
 */
function convertCode(def: SrcCodeNode): CodeNodeData {
  const inputs = (def.inputs ?? []).map((i) => ({ key: i.id, type: i.type ?? "any" }));
  const call = inputs.map((i) => i.key).join(", ");
  const src = (def.code ?? "").trim();
  return {
    language: def.language === "wgsl" ? "wgsl" : "tsl",
    source:
      def.language === "wgsl"
        ? src
        : `// Imported from TSL Graph ("${def.name ?? def.id}").\n// Original expression, called with the inputs in order:\nreturn (${src})(${call});`,
    inputs,
    outputs: [{ key: def.output?.id ?? "out", type: def.output?.type ?? "any" }],
  };
}

const MESH: Record<string, GeometryKind> = {
  sphere: "sphere",
  box: "box",
  cube: "box",
  torus: "torus",
  torusKnot: "torusKnot",
  torusknot: "torusKnot",
  plane: "plane",
  cylinder: "cylinder",
  icosahedron: "icosahedron",
  fullscreenQuad: "fullscreenQuad",
  fullscreenquad: "fullscreenQuad",
  quad: "fullscreenQuad",
  // their custom mesh is a script on top of a base geometry
  custom: "sphere",
  script: "sphere",
};

function convertSettings(src: Record<string, unknown> | undefined, report: ImportReport): Partial<PreviewSettings> {
  if (!src) return {};
  const out: Partial<PreviewSettings> = {};
  const mesh = String(src.mesh ?? "sphere");
  out.geometry = MESH[mesh] ?? "sphere";
  if (!MESH[mesh]) report.warnings.push(`Preview mesh "${mesh}" isn't available; using a sphere`);
  const c = (src.config ?? {}) as Record<string, unknown>;
  const pick = (map: Record<string, string>) => {
    const r: Record<string, number | boolean> = {};
    for (const [ours, theirs] of Object.entries(map)) {
      const v = c[theirs];
      if (typeof v === "number" || typeof v === "boolean") r[ours] = v;
    }
    return r;
  };
  out.geometryParams = {
    sphere: () => pick({ radius: "radius", widthSegments: "widthSegmentsSphere", heightSegments: "heightSegmentsSphere" }),
    box: () => pick({ width: "width", height: "height", depth: "depth", widthSegments: "widthSegments", heightSegments: "heightSegments", depthSegments: "depthSegments" }),
    torus: () => pick({ radius: "radiusTorus", tube: "tube", radialSegments: "radialSegments", tubularSegments: "tubularSegments" }),
    torusKnot: () => pick({ radius: "radiusTorus", tube: "tube", radialSegments: "radialSegments", tubularSegments: "tubularSegments" }),
    plane: () => pick({ width: "widthPlane", height: "heightPlane", widthSegments: "widthSegmentsPlane", heightSegments: "heightSegmentsPlane" }),
    cylinder: () =>
      pick({
        radiusTop: "radiusTop",
        radiusBottom: "radiusBottom",
        height: "heightCylinder",
        radialSegments: "radialSegmentsCylinder",
        heightSegments: "heightSegmentsCylinder",
        openEnded: "openEnded",
      }),
    icosahedron: () => pick({ radius: "radius" }),
    fullscreenQuad: () => ({}),
    script: () => ({}),
  }[out.geometry]();
  if (typeof src.geometryScript === "string" && src.geometryScript) out.geometryScript = src.geometryScript;
  if (typeof src.environment === "string") out.environment = src.environment;
  if (typeof src.environmentIntensity === "number") out.envIntensity = src.environmentIntensity;
  if (typeof src.showEnvironmentBackground === "boolean") out.showBackground = src.showEnvironmentBackground;
  if (typeof src.showBackdrop === "boolean") out.showBackdrop = src.showBackdrop;
  if (typeof src.showGrid === "boolean") out.showGrid = src.showGrid;
  if (typeof src.postEnabled === "boolean") out.enablePost = src.postEnabled;
  if (typeof src.isInstanced === "boolean") out.instancing = src.isInstanced;
  if (typeof src.instanceCount === "number") out.instanceCount = src.instanceCount;
  if (src.thumbnailMode === "auto" || src.thumbnailMode === "manual") out.thumbnail = src.thumbnailMode;
  if (src.codeMode === "custom" && src.customCode) report.warnings.push("The file used hand-written custom code for the preview; that code wasn't imported");
  return out;
}

function convertGlobals(src: unknown[] | undefined, report: ImportReport): GlobalDef[] {
  const out: GlobalDef[] = [];
  for (const raw of src ?? []) {
    const g = raw as Record<string, unknown>;
    const id = typeof g.id === "string" ? g.id : undefined;
    const name = typeof g.name === "string" ? g.name : id;
    if (!id || !name) {
      report.warnings.push(`Skipped a global without an id/name: ${JSON.stringify(g).slice(0, 80)}`);
      continue;
    }
    const kind = g.kind === "const" || g.kind === "varying" ? g.kind : g.kind === "constant" ? "const" : "uniform";
    out.push({ id, name, kind, type: typeof g.type === "string" ? g.type : "float", value: g.value ?? 0 });
  }
  return out;
}

/** Convert a tsl-graph.xyz export into a new project document. */
export function importTslGraph(src: TslGraphExport, name = "Imported shader"): { doc: ProjectDoc; report: ImportReport } {
  const report: ImportReport = { nodes: 0, edges: 0, placeholders: [], droppedEdges: [], warnings: [] };
  const doc = createProject(name);
  const ctx: Ctx = {
    src,
    report,
    subgraphIds: new Map(),
    codeDefs: new Map(Object.entries(src.codeNodes ?? {})),
    globalIds: new Set(),
    subgraphs: [],
  };

  doc.globals = convertGlobals(src.globals, report);
  ctx.globalIds = new Set(doc.globals.map((g) => g.id));

  // Subgraph definitions: register ids first so instances (including nested
  // ones) resolve, then convert their bodies.
  const sgs = Object.values(src.subgraphs ?? {});
  for (const sg of sgs) ctx.subgraphIds.set(sg.id, sg.id);
  for (const sg of sgs) {
    const inputs = (sg.inputs ?? []).map((p) => ({ key: p.id, label: p.label ?? p.id, type: p.type ?? "any" }));
    const outputs = (sg.outputs ?? []).map((p) => ({ key: p.id, label: p.label ?? p.id, type: p.type ?? "any" }));
    ctx.subgraphs.push({ id: sg.id, name: sg.name ?? "Subgraph", graph: { nodes: [], edges: [] }, inputs, outputs, scope: "project" });
  }
  for (const [i, sg] of sgs.entries()) {
    const def = ctx.subgraphs[i];
    const input = makeNode("subgraph/input", sg.inputNodePosition ?? { x: 0, y: 0 }, { ports: def.inputs.map((p) => ({ ...p })) });
    const output = makeNode("subgraph/output", sg.outputNodePosition ?? { x: 600, y: 0 }, { ports: def.outputs.map((p) => ({ ...p })) });
    def.graph = convertGraph(ctx, sg.nodes ?? [], sg.edges ?? [], "subgraph", { input, output });
  }
  doc.customNodes = ctx.subgraphs;

  doc.graphs.material = convertGraph(ctx, src.nodes ?? [], src.edges ?? [], "material");
  if (src.postNodes) doc.graphs.post = convertGraph(ctx, src.postNodes, src.postEdges ?? [], "post");

  if (!doc.graphs.material.nodes.some((n) => n.type.startsWith("material/")))
    report.warnings.push("The material graph has no material node");

  doc.settings = { ...doc.settings, ...convertSettings(src.previewSettings, report) };
  return { doc, report };
}

/** One-line summary for toasts. */
export function summarizeImport(r: ImportReport): string {
  const parts = [`Imported ${r.nodes} nodes and ${r.edges} connections`];
  if (r.placeholders.length)
    parts.push(`${r.placeholders.length} unsupported node${r.placeholders.length === 1 ? "" : "s"} kept as placeholder${r.placeholders.length === 1 ? "" : "s"}`);
  if (r.droppedEdges.length) parts.push(`${r.droppedEdges.length} connection${r.droppedEdges.length === 1 ? "" : "s"} dropped`);
  return parts.join(" · ");
}
