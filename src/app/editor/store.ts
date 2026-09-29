import { createContext, createMemo, createSignal, flush, reconcile, snapshot, createStore } from "solid-js";
import { compileProject, type CompileResult } from "../../core/codegen";
import { executeCommand, type Command } from "../../core/commands";
import {
  addNode as coreAddNode,
  checkConnection,
  cloneSubset,
  connect as coreConnect,
  disconnect as coreDisconnect,
  graphOf,
  inferTypes,
  makeNode,
  removeNodes as coreRemoveNodes,
  resolvePorts,
  uid,
} from "../../core/graph";
import { autoLayout as coreAutoLayout, estimateSize } from "../../core/layout";
import { getNodeDef } from "../../core/registry";
import type {
  Diagnostic,
  Graph,
  GraphEdge,
  GraphKind,
  GraphNode,
  GraphRef,
  ProjectDoc,
  SubgraphDef,
  XY,
} from "../../core/types";
import { api } from "../lib/api";

export type Mode = "pan" | "select";
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}
export interface NodeLayout {
  w: number;
  h: number;
  /** handle offsets relative to node origin, keyed `in:key` / `out:key` */
  handles: Record<string, XY>;
}

interface HistoryEntry {
  graphs: ProjectDoc["graphs"];
  globals: ProjectDoc["globals"];
  customNodes: ProjectDoc["customNodes"];
}

export interface SubgraphSession {
  subgraphId: string;
  returnTo: GraphRef;
  backup: string;
}

const MAX_HISTORY = 150;
const BINARY_OPS: Record<string, "add" | "sub" | "mul" | "div" | "mod" | "pow" | "min" | "max"> = {
  "math/add": "add",
  "math/sub": "sub",
  "math/mul": "mul",
  "math/div": "div",
  "math/mod": "mod",
  "math/pow": "pow",
  "math/min": "min",
  "math/max": "max",
};

export function createEditor(initial: ProjectDoc, opts: { readonly?: boolean; persist?: boolean } = {}) {
  const persist = opts.persist ?? true;
  const [state, setState] = createStore({
    doc: initial,
    graph: "material" as GraphRef,
    selection: { nodes: [] as string[], edges: [] as string[] },
    viewports: {} as Record<string, Viewport>,
    mode: "pan" as Mode,
    saveState: "saved" as "saved" | "unsaved" | "saving" | "error",
    sidebarOpen: true,
    runtimeErrors: [] as string[],
    subgraph: null as SubgraphSession | null,
    canUndo: false,
    canRedo: false,
  });
  const [layout, setLayout] = createStore<Record<string, NodeLayout>>({});
  const [compiled, setCompiled] = createSignal<CompileResult | null>(null, { equals: false });
  const [version, setVersion] = createSignal(0);

  let past: string[] = [];
  let future: string[] = [];
  let canvasEl: HTMLDivElement | undefined;
  let pointer: XY = { x: 0, y: 0 };

  // ---- derived -------------------------------------------------------------
  const graph = createMemo(() => graphOf(state.doc, state.graph));
  const nodesById = createMemo(() => new Map(graph().nodes.map((n) => [n.id, n])));
  const types = createMemo(() => {
    version();
    return inferTypes(state.doc, graph());
  });
  const viewport = createMemo<Viewport>(() => state.viewports[state.graph] ?? { x: 120, y: 80, zoom: 1 });
  const diagnostics = createMemo<Diagnostic[]>(() => compiled()?.diagnostics ?? []);
  const topGraph = (): GraphKind => (state.graph === "post" ? "post" : "material");

  // ---- history ---------------------------------------------------------------
  const serialize = (): string =>
    JSON.stringify({
      graphs: snapshot(state.doc.graphs),
      globals: snapshot(state.doc.globals),
      customNodes: snapshot(state.doc.customNodes),
    } satisfies HistoryEntry);

  function pushHistory() {
    past.push(serialize());
    if (past.length > MAX_HISTORY) past.shift();
    future = [];
    setState((s) => {
      s.canUndo = true;
      s.canRedo = false;
    });
  }

  function restore(entry: string) {
    const h = JSON.parse(entry) as HistoryEntry;
    setState((s) => {
      for (const k of ["material", "post"] as const) {
        reconcile(h.graphs[k].nodes, "id")(s.doc.graphs[k].nodes);
        reconcile(h.graphs[k].edges, "id")(s.doc.graphs[k].edges);
      }
      s.doc.globals = h.globals;
      s.doc.customNodes = h.customNodes;
      const ids = new Set(graphOfSafe(s.doc as ProjectDoc, s.graph)?.nodes.map((n) => n.id) ?? []);
      s.selection.nodes = s.selection.nodes.filter((id) => ids.has(id));
      s.selection.edges = [];
      s.canUndo = past.length > 0;
      s.canRedo = future.length > 0;
    });
    changed();
  }

  function undo() {
    const entry = past.pop();
    if (!entry) return;
    future.push(serialize());
    restore(entry);
  }

  function redo() {
    const entry = future.pop();
    if (!entry) return;
    past.push(serialize());
    restore(entry);
  }

  // ---- mutation --------------------------------------------------------------
  let compileTimer: number | undefined;
  let saveTimer: number | undefined;

  function changed(opts: { recompile?: boolean } = {}) {
    setVersion((v) => v + 1);
    if (persist) {
      setState((s) => {
        s.saveState = "unsaved";
      });
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => void save(), 700);
    }
    if (opts.recompile !== false) scheduleCompile();
  }

  /** Apply a change to the document (records undo unless history:false). */
  function mutate<T>(fn: (doc: ProjectDoc) => T, o: { history?: boolean; recompile?: boolean } = {}): T {
    if (opts.readonly) throw new Error("Project is read-only");
    if (o.history !== false) pushHistory();
    let result!: T;
    setState((s) => {
      result = fn(s.doc as ProjectDoc);
      s.doc.updatedAt = Date.now();
    });
    flush();
    changed({ recompile: o.recompile });
    return result;
  }

  function scheduleCompile(delay = 120) {
    clearTimeout(compileTimer);
    compileTimer = window.setTimeout(compileNow, delay);
  }

  function compileNow() {
    clearTimeout(compileTimer);
    const doc = snapshot(state.doc) as ProjectDoc;
    try {
      setCompiled(compileProject(doc));
    } catch (err) {
      setCompiled({
        code: "",
        runtime: { material: "return { material: null, nodes: {}, uniforms: {} };", post: "return { outputNode: null, nodes: {}, uniforms: {} };" },
        material: { lines: [], nodes: {}, uniforms: {}, ok: false },
        post: { lines: [], nodes: {}, uniforms: {}, ok: false, connected: false },
        globals: {},
        diagnostics: [{ level: "error", message: `Compiler crashed: ${err instanceof Error ? err.message : err}` }],
        utils: [],
      });
    }
  }

  let saving = false;
  let saveAgain = false;
  async function save() {
    if (!persist) return;
    clearTimeout(saveTimer);
    if (saving) {
      saveAgain = true;
      return;
    }
    saving = true;
    setState((s) => {
      s.saveState = "saving";
    });
    try {
      await api.save(snapshot(state.doc) as ProjectDoc);
      setState((s) => {
        s.saveState = saveAgain ? "unsaved" : "saved";
      });
    } catch {
      setState((s) => {
        s.saveState = "error";
      });
    } finally {
      saving = false;
      if (saveAgain) {
        saveAgain = false;
        void save();
      }
    }
  }

  /** Replace the whole document (load from JSON / external reload). */
  function replaceDoc(doc: ProjectDoc, o: { history?: boolean } = {}) {
    if (o.history) pushHistory();
    setState((s) => {
      s.doc = doc;
      s.graph = "material";
      s.selection = { nodes: [], edges: [] };
      s.subgraph = null;
    });
    flush();
    setVersion((v) => v + 1);
    compileNow();
  }

  // ---- selection -----------------------------------------------------------
  function select(nodes: string[], edges: string[] = [], additive = false) {
    setState((s) => {
      if (additive) {
        s.selection.nodes = [...new Set([...s.selection.nodes, ...nodes])];
        s.selection.edges = [...new Set([...s.selection.edges, ...edges])];
      } else {
        s.selection.nodes = nodes;
        s.selection.edges = edges;
      }
    });
  }
  const clearSelection = () => select([], []);
  const selectedNode = createMemo(() =>
    state.selection.nodes.length === 1 ? nodesById().get(state.selection.nodes[0]) : undefined,
  );

  // ---- viewport ----------------------------------------------------------------
  function setViewport(v: Viewport) {
    setState((s) => {
      s.viewports[s.graph] = v;
    });
  }

  function screenToFlow(clientX: number, clientY: number): XY {
    const rect = canvasEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const v = viewport();
    return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom };
  }

  function viewCenter(): XY {
    const rect = canvasEl?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToFlow(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function nodeSize(n: GraphNode) {
    const l = layout[n.id];
    return l ? { w: l.w, h: l.h } : estimateSize(n);
  }

  function fitView(ids?: string[], padding = 80) {
    if (!canvasEl) return;
    const nodes = graph().nodes.filter((n) => !ids || ids.includes(n.id));
    if (!nodes.length) {
      setViewport({ x: 120, y: 80, zoom: 1 });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const s = nodeSize(n);
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + s.w);
      maxY = Math.max(maxY, n.position.y + s.h);
    }
    const rect = canvasEl.getBoundingClientRect();
    const zoom = Math.min(1.5, Math.max(0.1, Math.min((rect.width - padding * 2) / (maxX - minX), (rect.height - padding * 2) / (maxY - minY))));
    setViewport({
      zoom,
      x: rect.width / 2 - ((minX + maxX) / 2) * zoom,
      y: rect.height / 2 - ((minY + maxY) / 2) * zoom,
    });
  }

  // ---- graph actions ---------------------------------------------------------
  function addNodeAt(type: string, pos?: XY, data: Partial<GraphNode["data"]> = {}): string {
    const at = pos ?? viewCenter();
    const id = mutate((doc) => {
      const n = coreAddNode(doc, state.graph, type, { x: at.x - 90, y: at.y - 30 }, data);
      return n.id;
    });
    select([id]);
    return id;
  }

  function connect(c: Omit<GraphEdge, "id">): string | null {
    const check = checkConnection(state.doc, state.graph, c);
    if (!check.ok) return check.error ?? "Cannot connect";
    mutate((doc) => coreConnect(doc, state.graph, c));
    return null;
  }

  function deleteSelection() {
    const nodes = state.selection.nodes.filter((id) => {
      const n = nodesById().get(id);
      const kind = n ? getNodeDef(n.type)?.kind : undefined;
      // Subgraph anchors cannot be deleted while editing the subgraph.
      return kind !== "subgraphInput" && kind !== "subgraphOutput";
    });
    const edges = [...state.selection.edges];
    if (!nodes.length && !edges.length) return;
    mutate((doc) => {
      if (edges.length) coreDisconnect(doc, state.graph, edges);
      if (nodes.length) coreRemoveNodes(doc, state.graph, nodes);
    });
    clearSelection();
  }

  function moveNodes(delta: XY, ids: string[]) {
    // children of moved containers move along
    const all = new Set(ids);
    for (const n of graph().nodes) if (n.parentId && all.has(n.parentId)) all.add(n.id);
    mutate(
      (doc) => {
        for (const n of graphOf(doc, state.graph).nodes) {
          if (all.has(n.id)) n.position = { x: n.position.x + delta.x, y: n.position.y + delta.y };
        }
      },
      { history: false, recompile: false },
    );
  }

  /** After a drag: snap positions and adopt/release container membership. */
  function finishDrag(ids: string[]) {
    mutate(
      (doc) => {
        const g = graphOf(doc, state.graph);
        const containers = g.nodes.filter((n) => {
          const k = getNodeDef(n.type)?.kind;
          return k === "group" || k === "loop";
        });
        for (const n of g.nodes) {
          if (!ids.includes(n.id)) continue;
          n.position = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
          const kind = getNodeDef(n.type)?.kind;
          if (kind === "group" || kind === "loop" || kind === "comment") continue;
          const s = nodeSize(n);
          const cx = n.position.x + s.w / 2;
          const cy = n.position.y + s.h / 2;
          const hit = containers.find(
            (c) =>
              c.id !== n.id &&
              cx > c.position.x &&
              cx < c.position.x + (c.width ?? 400) &&
              cy > c.position.y &&
              cy < c.position.y + (c.height ?? 240),
          );
          const isLoopPart = n.type.startsWith("loop/");
          if (hit) {
            if (isLoopPart && getNodeDef(hit.type)?.kind !== "loop") continue;
            n.parentId = hit.id;
          } else if (n.parentId && !isLoopPart) n.parentId = undefined;
          else if (n.parentId && isLoopPart) n.parentId = undefined;
        }
      },
      { history: false },
    );
  }

  function setValue(nodeId: string, key: string, value: unknown, o: { history?: boolean } = {}) {
    const node = nodesById().get(nodeId);
    const isUniform = node && getNodeDef(node.type)?.kind === "uniform" && key === "value";
    mutate(
      (doc) => {
        const n = graphOf(doc, state.graph).nodes.find((x) => x.id === nodeId);
        if (n) n.data.values[key] = value;
      },
      { history: o.history, recompile: !isUniform },
    );
    if (isUniform) previewHooks.setUniform?.(nodeId, value);
  }

  function updateData(nodeId: string, fn: (n: GraphNode) => void, o: { history?: boolean; recompile?: boolean } = {}) {
    mutate((doc) => {
      const n = graphOf(doc, state.graph).nodes.find((x) => x.id === nodeId);
      if (n) fn(n);
    }, o);
  }

  function autoLayout() {
    const sizes = new Map(graph().nodes.map((n) => [n.id, nodeSize(n)]));
    mutate((doc) => coreAutoLayout(graphOf(doc, state.graph), sizes));
    requestAnimationFrame(() => fitView());
  }

  // ---- clipboard ------------------------------------------------------------
  function copySelection() {
    const ids = state.selection.nodes;
    if (!ids.length) return;
    const g = snapshot(graph()) as Graph;
    const set = new Set(ids);
    for (const n of g.nodes) if (n.parentId && set.has(n.parentId)) set.add(n.id);
    const payload = {
      kind: "tsl-graph/clipboard",
      nodes: g.nodes.filter((n) => set.has(n.id)),
      edges: g.edges.filter((e) => set.has(e.source) && set.has(e.target)),
    };
    const text = JSON.stringify(payload);
    try {
      localStorage.setItem("tsl-clipboard", text);
    } catch {
      // ignore
    }
    void navigator.clipboard?.writeText(text).catch(() => {});
  }

  async function paste(at?: XY) {
    let text: string | null = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // permissions — fall back to local clipboard
    }
    if (!text || !text.includes("tsl-graph/clipboard")) {
      try {
        text = localStorage.getItem("tsl-clipboard");
      } catch {
        text = null;
      }
    }
    if (!text) return;
    let payload: { kind: string; nodes: GraphNode[]; edges: GraphEdge[] };
    try {
      payload = JSON.parse(text);
    } catch {
      return;
    }
    if (payload.kind !== "tsl-graph/clipboard" || !payload.nodes?.length) return;
    const minX = Math.min(...payload.nodes.map((n) => n.position.x));
    const minY = Math.min(...payload.nodes.map((n) => n.position.y));
    const target = at ?? screenToFlow(pointer.x, pointer.y);
    const { nodes, edges } = cloneSubset(payload as Graph, payload.nodes.map((n) => n.id), {
      x: target.x - minX,
      y: target.y - minY,
    });
    mutate((doc) => {
      const g = graphOf(doc, state.graph);
      g.nodes.push(...nodes);
      g.edges.push(...edges);
    });
    select(nodes.map((n) => n.id));
  }

  function duplicateSelection() {
    const ids = state.selection.nodes;
    if (!ids.length) return;
    const { nodes, edges } = cloneSubset(snapshot(graph()) as Graph, [...ids], { x: 40, y: 40 });
    mutate((doc) => {
      const g = graphOf(doc, state.graph);
      g.nodes.push(...nodes);
      g.edges.push(...edges);
    });
    select(nodes.map((n) => n.id));
  }

  // ---- grouping ---------------------------------------------------------------
  function selectionBounds(ids: string[]) {
    const nodes = graph().nodes.filter((n) => ids.includes(n.id));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const s = nodeSize(n);
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + s.w);
      maxY = Math.max(maxY, n.position.y + s.h);
    }
    return { minX, minY, maxX, maxY };
  }

  function groupSelection() {
    const ids = state.selection.nodes.filter((id) => {
      const k = getNodeDef(nodesById().get(id)?.type ?? "")?.kind;
      return k !== "group" && k !== "loop";
    });
    if (!ids.length) return;
    const b = selectionBounds(ids);
    const gid = mutate((doc) => {
      const group = makeNode("utils/group", { x: b.minX - 30, y: b.minY - 50 });
      group.width = b.maxX - b.minX + 60;
      group.height = b.maxY - b.minY + 80;
      const g = graphOf(doc, state.graph);
      g.nodes.unshift(group);
      for (const n of g.nodes) if (ids.includes(n.id)) n.parentId = group.id;
      return group.id;
    });
    select([gid]);
  }

  function ungroupSelection() {
    const groups = state.selection.nodes.filter((id) => getNodeDef(nodesById().get(id)?.type ?? "")?.kind === "group");
    if (!groups.length) return;
    mutate((doc) => coreRemoveNodes(doc, state.graph, groups));
    clearSelection();
  }

  function removeFromGroup() {
    const ids = state.selection.nodes;
    mutate((doc) => {
      for (const n of graphOf(doc, state.graph).nodes) if (ids.includes(n.id) && !n.type.startsWith("loop/")) n.parentId = undefined;
    });
  }

  // ---- loops --------------------------------------------------------------------
  function createLoop(at?: XY) {
    const c = at ?? viewCenter();
    const x = c.x - 280;
    const y = c.y - 160;
    const id = mutate((doc) => {
      const g = state.graph;
      const loop = coreAddNode(doc, g, "loop", { x, y });
      loop.width = 560;
      loop.height = 320;
      const part = (type: string, px: number, py: number) => {
        const n = coreAddNode(doc, g, type, { x: x + px, y: y + py });
        n.parentId = loop.id;
        return n;
      };
      part("loop/count", 30, 50);
      part("loop/index", 30, 150);
      const acc = part("loop/accumulator", 30, 220);
      const out = part("loop/output", 380, 200);
      coreConnect(doc, g, { source: acc.id, sourceHandle: "acc", target: out.id, targetHandle: "next" });
      return loop.id;
    });
    select([id]);
  }

  // ---- multi-op ---------------------------------------------------------------
  function convertToMultiOp() {
    const sel = state.selection.nodes.map((id) => nodesById().get(id)!).filter((n) => n && BINARY_OPS[n.type]);
    if (!sel.length) return;
    const g = graph();
    const selIds = new Set(sel.map((n) => n.id));
    // root = selected binary node whose output does not feed another selected binary node's "a"
    const feedsA = (n: GraphNode) =>
      g.edges.some((e) => e.source === n.id && selIds.has(e.target) && e.targetHandle === "a");
    const root = sel.find((n) => !feedsA(n));
    if (!root) return;
    // walk down the "a" chain
    const chain: GraphNode[] = [root];
    for (;;) {
      const head = chain[chain.length - 1];
      const e = g.edges.find((x) => x.target === head.id && x.targetHandle === "a" && selIds.has(x.source));
      if (!e) break;
      const next = nodesById().get(e.source)!;
      const usedElsewhere = g.edges.some((x) => x.source === next.id && x.target !== head.id);
      if (usedElsewhere) break;
      chain.push(next);
    }
    chain.reverse(); // innermost first
    const first = chain[0];
    const ops = chain.map((n) => ({ op: BINARY_OPS[n.type] }));
    const inputs: ({ edge?: GraphEdge; value?: unknown })[] = [];
    const inEdge = (n: GraphNode, h: string) => g.edges.find((e) => e.target === n.id && e.targetHandle === h);
    inputs.push({ edge: inEdge(first, "a"), value: first.data.values.a ?? 0 });
    for (const n of chain) inputs.push({ edge: inEdge(n, "b"), value: n.data.values.b ?? 0 });
    const outEdges = g.edges.filter((e) => e.source === root.id);
    const pos = { ...first.position };
    const newId = mutate((doc) => {
      const gr = graphOf(doc, state.graph);
      const mo = coreAddNode(doc, state.graph, "math/multiOp", pos);
      mo.data.ops = ops;
      mo.data.values = {};
      inputs.forEach((inp, i) => {
        mo.data.values[`in${i}`] = typeof inp.value === "object" ? 0 : inp.value;
      });
      const ids = chain.map((n) => n.id);
      coreRemoveNodes(doc, state.graph, ids);
      inputs.forEach((inp, i) => {
        if (inp.edge) gr.edges.push({ ...inp.edge, id: uid("e"), target: mo.id, targetHandle: `in${i}` });
      });
      for (const e of outEdges) gr.edges.push({ ...e, id: uid("e"), source: mo.id, sourceHandle: "out" });
      return mo.id;
    });
    select([newId]);
  }

  function expandMultiOp() {
    const node = selectedNode();
    if (!node || node.type !== "math/multiOp") return;
    const g = graph();
    const ops = node.data.ops ?? [];
    const inEdge = (h: string) => g.edges.find((e) => e.target === node.id && e.targetHandle === h);
    const outEdges = g.edges.filter((e) => e.source === node.id);
    const typeFor = Object.fromEntries(Object.entries(BINARY_OPS).map(([t, o]) => [o, t]));
    mutate((doc) => {
      const gr = graphOf(doc, state.graph);
      let prev: GraphNode | null = null;
      ops.forEach((step, i) => {
        const n = coreAddNode(doc, state.graph, typeFor[step.op], { x: node.position.x + i * 200, y: node.position.y });
        if (i === 0) {
          const ea = inEdge("in0");
          if (ea) gr.edges.push({ ...ea, id: uid("e"), target: n.id, targetHandle: "a" });
          else n.data.values.a = node.data.values.in0 ?? 0;
        } else if (prev) {
          gr.edges.push({ id: uid("e"), source: prev.id, sourceHandle: "out", target: n.id, targetHandle: "a" });
        }
        const eb = inEdge(`in${i + 1}`);
        if (eb) gr.edges.push({ ...eb, id: uid("e"), target: n.id, targetHandle: "b" });
        else n.data.values.b = node.data.values[`in${i + 1}`] ?? 0;
        prev = n;
      });
      const last = prev as GraphNode | null;
      coreRemoveNodes(doc, state.graph, [node.id]);
      if (last) for (const e of outEdges) gr.edges.push({ ...e, id: uid("e"), source: last.id });
    });
  }

  // ---- portals --------------------------------------------------------------------
  function edgeToPortal(edgeId?: string) {
    const id = edgeId ?? state.selection.edges[0];
    const e = graph().edges.find((x) => x.id === id);
    if (!e) return;
    const src = nodesById().get(e.source)!;
    const tgt = nodesById().get(e.target)!;
    const portalId = uid("portal");
    mutate((doc) => {
      const g = graphOf(doc, state.graph);
      const a = coreAddNode(doc, state.graph, "utils/portal", { x: src.position.x + nodeSize(src).w + 40, y: src.position.y }, { portalId });
      const b = coreAddNode(doc, state.graph, "utils/portal", { x: tgt.position.x - 160, y: tgt.position.y }, { portalId });
      g.edges = g.edges.filter((x) => x.id !== e.id);
      g.edges.push({ id: uid("e"), source: e.source, sourceHandle: e.sourceHandle, target: a.id, targetHandle: "in" });
      g.edges.push({ id: uid("e"), source: b.id, sourceHandle: "out", target: e.target, targetHandle: e.targetHandle });
    });
    clearSelection();
  }

  // ---- subgraphs --------------------------------------------------------------------
  function createSubgraphFromSelection(name: string, scope: "project" | "library" = "project"): string | null {
    const ids = state.selection.nodes.filter((id) => {
      const k = getNodeDef(nodesById().get(id)?.type ?? "")?.kind;
      return k !== "material" && k !== "postOutput" && k !== "postInput" && k !== "subgraphInput" && k !== "subgraphOutput";
    });
    if (!ids.length) return null;
    const g = snapshot(graph()) as Graph;
    const set = new Set(ids);
    const t = types();
    const incoming = g.edges.filter((e) => set.has(e.target) && !set.has(e.source));
    const outgoing = g.edges.filter((e) => set.has(e.source) && !set.has(e.target));
    const inputs: SubgraphDef["inputs"] = [];
    const inKey = new Map<string, string>();
    for (const e of incoming) {
      const k = `${e.source}.${e.sourceHandle}`;
      if (inKey.has(k)) continue;
      const key = `in${inputs.length}`;
      inKey.set(k, key);
      inputs.push({ key, label: `In ${inputs.length + 1}`, type: t.get(e.source)?.out[e.sourceHandle] ?? "any" });
    }
    const outputs: SubgraphDef["outputs"] = [];
    const outKey = new Map<string, string>();
    for (const e of outgoing) {
      const k = `${e.source}.${e.sourceHandle}`;
      if (outKey.has(k)) continue;
      const key = outputs.length === 0 ? "out" : `out${outputs.length}`;
      outKey.set(k, key);
      outputs.push({ key, label: outputs.length === 0 ? "Out" : `Out ${outputs.length + 1}`, type: t.get(e.source)?.out[e.sourceHandle] ?? "any" });
    }
    const b = selectionBounds(ids);
    const inner = g.nodes.filter((n) => set.has(n.id)).map((n) => ({ ...n, parentId: n.parentId && set.has(n.parentId) ? n.parentId : undefined }));
    const inAnchor = makeNode("subgraph/input", { x: b.minX - 260, y: (b.minY + b.maxY) / 2 - 40 }, { ports: inputs.map((i) => ({ key: i.key, label: i.label, type: i.type })) });
    const outAnchor = makeNode("subgraph/output", { x: b.maxX + 80, y: (b.minY + b.maxY) / 2 - 40 }, { ports: outputs.map((o) => ({ ...o })) });
    const innerEdges: GraphEdge[] = g.edges.filter((e) => set.has(e.source) && set.has(e.target));
    for (const e of incoming) innerEdges.push({ id: uid("e"), source: inAnchor.id, sourceHandle: inKey.get(`${e.source}.${e.sourceHandle}`)!, target: e.target, targetHandle: e.targetHandle });
    for (const [k, key] of outKey) {
      const [source, sourceHandle] = k.split(".");
      innerEdges.push({ id: uid("e"), source, sourceHandle, target: outAnchor.id, targetHandle: key });
    }
    const def: SubgraphDef = {
      id: uid("sg"),
      name: name || "Subgraph",
      graph: { nodes: [inAnchor, ...inner, outAnchor], edges: innerEdges },
      inputs,
      outputs,
      scope: "project",
    };
    const instanceId = mutate((doc) => {
      doc.customNodes.push(def);
      const gr = graphOf(doc, state.graph);
      coreRemoveNodes(doc, state.graph, ids);
      const inst = coreAddNode(doc, state.graph, "subgraph/instance", { x: (b.minX + b.maxX) / 2 - 90, y: (b.minY + b.maxY) / 2 - 30 }, { subgraphId: def.id });
      for (const e of incoming) gr.edges.push({ id: uid("e"), source: e.source, sourceHandle: e.sourceHandle, target: inst.id, targetHandle: inKey.get(`${e.source}.${e.sourceHandle}`)! });
      for (const e of outgoing) gr.edges.push({ id: uid("e"), source: inst.id, sourceHandle: outKey.get(`${e.source}.${e.sourceHandle}`)!, target: e.target, targetHandle: e.targetHandle });
      return inst.id;
    });
    if (scope === "library") saveToLibrary(def);
    select([instanceId]);
    return instanceId;
  }

  function enterSubgraph(subgraphId: string) {
    if (state.subgraph) return;
    setState((s) => {
      s.subgraph = { subgraphId, returnTo: s.graph, backup: JSON.stringify(snapshot(s.doc.customNodes)) };
      s.graph = `sg:${subgraphId}`;
      s.selection = { nodes: [], edges: [] };
    });
    flush();
    requestAnimationFrame(() => fitView());
  }

  function exitSubgraph(saveChanges: boolean) {
    const session = state.subgraph;
    if (!session) return;
    if (saveChanges) {
      mutate((doc) => {
        const sg = doc.customNodes.find((s) => s.id === session.subgraphId);
        if (!sg) return;
        const inA = sg.graph.nodes.find((n) => n.type === "subgraph/input");
        const outA = sg.graph.nodes.find((n) => n.type === "subgraph/output");
        sg.inputs = (inA?.data.ports ?? []).map((p) => ({ ...p, default: sg.inputs.find((i) => i.key === p.key)?.default }));
        sg.outputs = (outA?.data.ports ?? []).map((p) => ({ ...p }));
      });
    } else {
      const backup = JSON.parse(session.backup);
      mutate((doc) => {
        doc.customNodes = backup;
      });
    }
    setState((s) => {
      s.graph = session.returnTo;
      s.subgraph = null;
      s.selection = { nodes: [], edges: [] };
    });
    flush();
    changed();
  }

  function insertSubgraph(def: SubgraphDef, at?: XY) {
    const existing = state.doc.customNodes.find((s) => s.id === def.id);
    const id = mutate((doc) => {
      if (!existing) doc.customNodes.push({ ...JSON.parse(JSON.stringify(def)), scope: "project" });
      const c = at ?? viewCenter();
      return coreAddNode(doc, state.graph, "subgraph/instance", { x: c.x - 90, y: c.y - 30 }, { subgraphId: def.id }).id;
    });
    select([id]);
  }

  // ---- misc -------------------------------------------------------------------------
  function runCommand(cmd: Command): unknown {
    const readOnly = cmd.op === "getGraph" || cmd.op === "compile";
    if (readOnly) return executeCommand(snapshot(state.doc) as ProjectDoc, cmd);
    const result = mutate((doc) => JSON.parse(JSON.stringify(executeCommand(doc, cmd) ?? null)));
    // Layout inside commands uses estimated sizes; once new nodes are measured,
    // redo it with real sizes and frame the result.
    const ops = cmd.op === "batch" ? cmd.ops : [cmd];
    const layoutOp = ops.find((o) => o.op === "autoLayout") as { graph?: GraphRef } | undefined;
    if (layoutOp && (layoutOp.graph ?? "material") === state.graph) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const sizes = new Map(graph().nodes.map((n) => [n.id, nodeSize(n)]));
          mutate((doc) => coreAutoLayout(graphOf(doc, state.graph), sizes), { history: false, recompile: false });
          requestAnimationFrame(() => fitView());
        }),
      );
    } else if (ops.some((o) => o.op === "addNode")) {
      requestAnimationFrame(() => fitView());
    }
    return result;
  }

  function setGraph(g: GraphRef) {
    if (state.subgraph) return;
    setState((s) => {
      s.graph = g;
      s.selection = { nodes: [], edges: [] };
    });
  }

  const previewHooks: {
    setUniform?: (key: string, value: unknown) => void;
    capture?: (w?: number, h?: number) => Promise<string>;
    thumbnail?: () => Promise<string>;
  } = {};

  return {
    state,
    setState,
    layout,
    setLayout,
    compiled,
    diagnostics,
    version,
    graph,
    nodesById,
    types,
    viewport,
    selectedNode,
    topGraph,
    previewHooks,
    // setup
    setCanvas: (el: HTMLDivElement) => (canvasEl = el),
    canvas: () => canvasEl,
    setPointer: (p: XY) => (pointer = p),
    pointer: () => pointer,
    // history
    undo,
    redo,
    pushHistory,
    mutate,
    save,
    compileNow,
    scheduleCompile,
    replaceDoc,
    // selection & view
    select,
    clearSelection,
    setViewport,
    screenToFlow,
    viewCenter,
    fitView,
    nodeSize,
    setGraph,
    // actions
    addNodeAt,
    connect,
    deleteSelection,
    moveNodes,
    finishDrag,
    setValue,
    updateData,
    autoLayout,
    copySelection,
    paste,
    duplicateSelection,
    groupSelection,
    ungroupSelection,
    removeFromGroup,
    createLoop,
    convertToMultiOp,
    expandMultiOp,
    edgeToPortal,
    createSubgraphFromSelection,
    enterSubgraph,
    exitSubgraph,
    insertSubgraph,
    runCommand,
    resolvePorts: (n: GraphNode, forCanvas = true) => resolvePorts(state.doc, n, { forCanvas, types: types() }),
  };
}

export type Editor = ReturnType<typeof createEditor>;
export const EditorContext = createContext<Editor>();

function graphOfSafe(doc: ProjectDoc, g: GraphRef): Graph | undefined {
  try {
    return graphOf(doc, g);
  } catch {
    return undefined;
  }
}

// ---- subgraph library (per-browser) ---------------------------------------------

export function loadLibrary(): SubgraphDef[] {
  try {
    return JSON.parse(localStorage.getItem("tsl-subgraph-library") ?? "[]");
  } catch {
    return [];
  }
}

export function saveToLibrary(def: SubgraphDef) {
  const lib = loadLibrary().filter((d) => d.id !== def.id);
  lib.push({ ...JSON.parse(JSON.stringify(def)), scope: "library" });
  try {
    localStorage.setItem("tsl-subgraph-library", JSON.stringify(lib));
  } catch {
    // ignore
  }
}

export function removeFromLibrary(id: string) {
  try {
    localStorage.setItem("tsl-subgraph-library", JSON.stringify(loadLibrary().filter((d) => d.id !== id)));
  } catch {
    // ignore
  }
}
