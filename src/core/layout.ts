import { getNodeDef } from "./registry";
import type { Graph, GraphNode } from "./types";

/** Rough node footprint used for layout when real DOM sizes are unknown. */
export function estimateSize(node: GraphNode): { w: number; h: number } {
  if (node.width && node.height) return { w: node.width, h: node.height };
  const def = getNodeDef(node.type);
  const title = node.data.label ?? def?.label ?? node.type;
  const ins = (def?.inputs ?? []).filter((i) => !i.propertyOnly && (!node.data.activeInputs || def?.kind !== "material" || node.data.activeInputs.includes(i.key)));
  const rows = Math.max(ins.length, def?.outputs.length ?? 0, 1);
  const w = Math.min(280, Math.max(110, title.length * 7.5 + 60, def?.kind === "material" ? 200 : 0));
  return { w, h: 40 + rows * 22 };
}

/**
 * Layered left-to-right layout: layer = longest path from a source, order
 * inside a layer by barycenter of upstream neighbours. Group/loop containers
 * are laid out as single blocks (their children move with them); comments
 * stay where they are.
 */
export function autoLayout(graph: Graph, sizes?: Map<string, { w: number; h: number }>): void {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const kindOf = (n: GraphNode) => getNodeDef(n.type)?.kind;
  const isContainer = (n: GraphNode) => kindOf(n) === "group" || kindOf(n) === "loop";
  // map every node to the top-level block it belongs to
  const blockOf = (id: string): string => {
    let n = byId.get(id);
    while (n?.parentId && byId.has(n.parentId)) n = byId.get(n.parentId);
    return n?.id ?? id;
  };
  const movable = graph.nodes.filter((n) => !n.parentId || !byId.has(n.parentId)).filter((n) => kindOf(n) !== "comment");
  if (movable.length === 0) return;
  const ids = new Set(movable.map((n) => n.id));
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const n of movable) {
    preds.set(n.id, []);
    succs.set(n.id, []);
  }
  for (const e of graph.edges) {
    const s = blockOf(e.source);
    const t = blockOf(e.target);
    if (s === t || !ids.has(s) || !ids.has(t)) continue;
    preds.get(t)!.push(s);
    succs.get(s)!.push(t);
  }
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = Math.max(-1, ...preds.get(id)!.map(depth)) + 1;
    visiting.delete(id);
    layer.set(id, d);
    return d;
  };
  for (const n of movable) depth(n.id);
  // Pull sink nodes (e.g. the material) to the far right.
  const maxLayer = Math.max(...layer.values());
  for (const n of movable) if (succs.get(n.id)!.length === 0 && preds.get(n.id)!.length > 0) layer.set(n.id, maxLayer);

  const layers: string[][] = [];
  for (const [id, l] of layer) (layers[l] ??= []).push(id);
  const order = new Map<string, number>();
  layers.forEach((col, l) => {
    if (!col) return;
    if (l > 0) {
      const bary = (id: string) => {
        const p = preds.get(id)!.filter((x) => order.has(x));
        return p.length ? p.reduce((acc, x) => acc + order.get(x)!, 0) / p.length : Number.MAX_SAFE_INTEGER;
      };
      col.sort((a, b) => bary(a) - bary(b));
    }
    col.forEach((id, i) => order.set(id, i));
  });

  const size = (id: string) => {
    const n = byId.get(id)!;
    if (isContainer(n)) return { w: n.width ?? 400, h: n.height ?? 240 };
    return sizes?.get(id) ?? estimateSize(n);
  };
  const gapX = 80;
  const gapY = 40;
  const cols = layers.map((c) => c ?? []);
  const colHeights = cols.map((col) => col.reduce((acc, id) => acc + size(id).h + gapY, -gapY));
  const tallest = Math.max(...colHeights);
  let x = 0;
  cols.forEach((col, l) => {
    if (!col.length) return;
    const colW = Math.max(...col.map((id) => size(id).w));
    let y = (tallest - colHeights[l]) / 2;
    for (const id of col) {
      const n = byId.get(id)!;
      const dx = Math.round(x) - n.position.x;
      const dy = Math.round(y) - n.position.y;
      n.position = { x: Math.round(x), y: Math.round(y) };
      if (isContainer(n)) {
        for (const c of graph.nodes) if (c.id !== n.id && blockOf(c.id) === n.id) c.position = { x: c.position.x + dx, y: c.position.y + dy };
      }
      y += size(id).h + gapY;
    }
    x += colW + gapX;
  });
}
