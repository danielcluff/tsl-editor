// Multi-op: a chain of math operations in one node, modelled exactly like the
// original editor so its projects import 1:1. The node stores
// `data.operations = [{ id, op }]` (op = TSL function name); every operation's
// inputs are ports named `op_<id>_<key>` whose literal values live under the
// same key in `data.values`. The previous result flows into each operation's
// "chain" input, so only the first operation exposes it.

import { getNodeDef } from "./registry";
import type { Graph, GraphEdge, GraphNode, MultiOpOperation, PortDef } from "./types";

/** The original's operation list, in its dropdown order (TSL names). */
export const MULTI_OP_ORDER = [
  "add", "sub", "mul", "div", "sin", "cos", "tan", "asin", "acos", "atan", "degrees", "radians",
  "exp", "exp2", "log", "log2", "inverseSqrt", "cbrt", "sign", "round", "trunc", "negate", "oneMinus",
  "reciprocal", "saturate", "abs", "pow", "sqrt", "fract", "floor", "ceil", "mod", "min", "max", "mix",
  "remap", "remapClamp", "clamp", "step", "smoothstep", "length", "normalize", "dot", "cross", "reflect",
  "range", "distance", "faceforward", "refract", "equal", "all", "any", "difference", "pow2", "pow3",
  "pow4", "dFdx", "dFdy", "fwidth",
] as const;

/** Which input takes the previous result: first match (case-insensitive), else the first input. */
const CHAIN_PRIORITY = ["x", "node", "in", "a", "p", "i", "n"];

export interface MultiOpInfo {
  op: string;
  /** Standalone node type (e.g. math/add), used to convert chains and expand. */
  type: string;
  label: string;
  inputs: PortDef[];
  chainKey: string;
  /** Declared result type; "any" means it follows its inputs. */
  outType: string;
}

let table: Map<string, MultiOpInfo> | undefined;
function ops(): Map<string, MultiOpInfo> {
  if (table) return table;
  table = new Map();
  for (const op of MULTI_OP_ORDER) {
    // the node whose TSL function is `op` (e.g. "equal" is math/equals)
    const def = ["math/" + op, op === "equal" ? "math/equals" : ""].map((t) => getNodeDef(t)).find((d) => d?.tsl === op);
    if (!def) continue;
    const keys = def.inputs.map((i) => i.key);
    const chainKey = CHAIN_PRIORITY.map((p) => keys.find((k) => k.toLowerCase() === p)).find(Boolean) ?? keys[0];
    table.set(op, {
      op,
      type: def.type,
      label: def.label,
      inputs: def.inputs.map((i) => ({ ...i, default: i.default ?? 0 })),
      chainKey,
      outType: def.outputs.find((o) => o.key === "out")?.type ?? "any",
    });
  }
  return table;
}

export function multiOpInfo(op: string): MultiOpInfo | undefined {
  return ops().get(op);
}

/** Dropdown options, in the original's order. */
export function multiOpOptions(): { value: string; label: string }[] {
  return [...ops().values()].map((i) => ({ value: i.op, label: i.label }));
}

/** The operation a standalone node type corresponds to (math/sin → "sin"). */
export function multiOpForNodeType(type: string): string | undefined {
  for (const i of ops().values()) if (i.type === type) return i.op;
  return undefined;
}

export const multiOpHandleId = (opId: string, key: string) => `op_${opId}_${key}`;

/** Same id shape as the original, so imported and new operations look alike. */
export const newMultiOpId = (index = 0) => `op_${Date.now()}_${index}_${Math.floor(Math.random() * 1e4)}`;

/** An operation's input ports; the chain input only exists on the first operation. */
export function multiOpParams(op: string, first: boolean): PortDef[] {
  const info = multiOpInfo(op);
  if (!info) return [];
  return first ? info.inputs : info.inputs.filter((i) => i.key !== info.chainKey);
}

/** Every input port of a multi-op, in order, with the operation it belongs to. */
export function multiOpInputs(operations: MultiOpOperation[]): { port: PortDef; opId: string; index: number; param: PortDef }[] {
  return operations.flatMap((o, index) =>
    multiOpParams(o.op, index === 0).map((param) => ({
      port: { ...param, key: multiOpHandleId(o.id, param.key) },
      opId: o.id,
      index,
      param,
    })),
  );
}

// ---------------------------------------------------------------------------
// chains of standalone nodes <-> multi-op
// ---------------------------------------------------------------------------

/**
 * Whether `ids` form a single straight chain of math nodes (each feeding the next one's
 * chain input), the original's rule for "Convert to Multi-op". Returns them in order.
 */
export function detectConvertibleChain(
  ids: string[],
  graph: Graph,
): { valid: true; ordered: string[] } | { valid: false; reason: string } {
  const fail = (reason: string) => ({ valid: false as const, reason });
  if (ids.length < 2) return fail("Need at least 2 nodes to convert to Multi-op");
  const set = new Set(ids);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const id of ids) {
    const n = byId.get(id);
    if (!n) return fail(`Node "${id}" not found`);
    if (!multiOpForNodeType(n.type)) return fail(`"${getNodeDef(n.type)?.label ?? n.type}" can't be a Multi-op operation`);
  }
  const chainEdges: GraphEdge[] = [];
  const otherEdges: GraphEdge[] = [];
  for (const e of graph.edges) {
    if (!set.has(e.source) || !set.has(e.target)) continue;
    const info = multiOpInfo(multiOpForNodeType(byId.get(e.target)!.type)!)!;
    (e.sourceHandle === "out" && e.targetHandle === info.chainKey ? chainEdges : otherEdges).push(e);
  }
  const prev = new Map<string, string>();
  const next = new Map<string, string>();
  for (const e of chainEdges) {
    if (prev.has(e.target)) return fail("Chain has a node with multiple chain inputs (branching)");
    prev.set(e.target, e.source);
    if (next.has(e.source)) return fail("Chain has a node with multiple chain outputs (branching)");
    next.set(e.source, e.target);
  }
  const starts = ids.filter((id) => !prev.has(id));
  if (starts.length !== 1) return fail(starts.length ? "Selected nodes don't form a single chain" : "Chain has a cycle");
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (let id: string | undefined = starts[0]; id; id = next.get(id)) {
    if (seen.has(id)) return fail("Chain has a cycle");
    seen.add(id);
    ordered.push(id);
  }
  if (ordered.length !== ids.length) return fail("Not all selected nodes are connected in a single chain");
  if (otherEdges.length) return fail("A selected node feeds a non-chain input of another selected node");
  return { valid: true, ordered };
}

/**
 * Replace a valid chain with one multi-op node (in place). Outside wires into the chain's
 * inputs move to the matching operation ports; wires out of the chain leave from `out`.
 */
export function chainToMultiOp(graph: Graph, ordered: string[], node: GraphNode): void {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const set = new Set(ordered);
  const operations: MultiOpOperation[] = [];
  const edges: GraphEdge[] = [];
  ordered.forEach((id, index) => {
    const src = byId.get(id)!;
    const op = multiOpForNodeType(src.type)!;
    const o = { id: newMultiOpId(index), op };
    operations.push(o);
    for (const param of multiOpParams(op, index === 0)) {
      const handle = multiOpHandleId(o.id, param.key);
      const e = graph.edges.find((x) => x.target === id && x.targetHandle === param.key && !set.has(x.source));
      if (e) edges.push({ ...e, target: node.id, targetHandle: handle });
      else if (src.data.values[param.key] !== undefined) node.data.values[handle] = src.data.values[param.key];
    }
  });
  // anything the chain fed outside the selection now comes from the multi-op
  for (const e of graph.edges) if (set.has(e.source) && !set.has(e.target)) edges.push({ ...e, source: node.id, sourceHandle: "out" });
  node.data.operations = operations;
  graph.nodes = graph.nodes.filter((n) => !set.has(n.id));
  graph.edges = graph.edges.filter((e) => !set.has(e.source) && !set.has(e.target));
  graph.nodes.push(node);
  graph.edges.push(...edges);
}

// ---------------------------------------------------------------------------
// our earlier format
// ---------------------------------------------------------------------------

/**
 * Projects saved before the original's model used `data.ops: [{ op }]` folded over
 * inputs `in0..inN` (in0 op1 in1 op2 in2 ...). Convert those in place.
 */
export function migrateLegacyMultiOps(graph: Graph): void {
  for (const node of graph.nodes) {
    const legacy = (node.data as { ops?: { op: string }[] }).ops;
    if (node.type !== "math/multiOp" || !legacy || node.data.operations) continue;
    const values: Record<string, unknown> = {};
    const handleFor = new Map<string, string>();
    const operations = legacy.map((step, i) => ({ id: newMultiOpId(i), op: step.op }));
    operations.forEach((o, i) => {
      const [a, b] = [multiOpInfo(o.op)?.inputs[0]?.key ?? "a", multiOpInfo(o.op)?.inputs[1]?.key ?? "b"];
      if (i === 0) handleFor.set("in0", multiOpHandleId(o.id, a));
      handleFor.set(`in${i + 1}`, multiOpHandleId(o.id, b));
    });
    for (const [oldKey, handle] of handleFor) if (node.data.values[oldKey] !== undefined) values[handle] = node.data.values[oldKey];
    node.data.operations = operations;
    node.data.values = values;
    delete (node.data as { ops?: unknown }).ops;
    for (const e of graph.edges) if (e.target === node.id && handleFor.has(e.targetHandle)) e.targetHandle = handleFor.get(e.targetHandle)!;
  }
}

/**
 * Expand a multi-op back into standalone nodes (in place), laid out left to right from the
 * multi-op's position. `make` creates a node of a type at a position (graph.makeNode).
 * Returns the new node ids in chain order.
 */
export function multiOpToChain(graph: Graph, node: GraphNode, make: (type: string, pos: { x: number; y: number }) => GraphNode): string[] {
  const operations = node.data.operations ?? [];
  const created: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeId = () => `e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  operations.forEach((o, index) => {
    const info = multiOpInfo(o.op);
    if (!info) return;
    const n = make(info.type, { x: node.position.x + index * 220, y: node.position.y });
    n.parentId = node.parentId;
    for (const param of multiOpParams(o.op, index === 0)) {
      const handle = multiOpHandleId(o.id, param.key);
      const e = graph.edges.find((x) => x.target === node.id && x.targetHandle === handle);
      if (e) edges.push({ ...e, id: edgeId(), target: n.id, targetHandle: param.key });
      else if (node.data.values[handle] !== undefined) n.data.values[param.key] = node.data.values[handle];
    }
    const prev = created[created.length - 1];
    if (prev) edges.push({ id: edgeId(), source: prev.id, sourceHandle: "out", target: n.id, targetHandle: info.chainKey });
    created.push(n);
  });
  const last = created[created.length - 1];
  if (last) for (const e of graph.edges) if (e.source === node.id) edges.push({ ...e, id: edgeId(), source: last.id, sourceHandle: "out" });
  graph.nodes = graph.nodes.filter((n) => n.id !== node.id);
  graph.edges = graph.edges.filter((e) => e.source !== node.id && e.target !== node.id);
  graph.nodes.push(...created);
  graph.edges.push(...edges);
  return created.map((n) => n.id);
}
