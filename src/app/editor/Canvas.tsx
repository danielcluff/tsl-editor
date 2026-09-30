import { For, Show, createMemo, createSignal, onSettled, useContext } from "solid-js";
import { canConnectTypes, graphOf } from "../../core/graph";
import { getNodeDef, typeColor } from "../../core/registry";
import type { GraphEdge, GraphNode, XY } from "../../core/types";
import { EditorContext, type Editor } from "./store";
import { NodeCard } from "./NodeCard";
import { renderMarkdown } from "./markdown";
import { ui } from "./ui-state";

interface PendingConnection {
  from: { nodeId: string; side: "in" | "out"; key: string; type: string };
  to: XY;
  hover: { nodeId: string; key: string } | null;
}

export function Canvas() {
  const ed = useContext(EditorContext);
  let el!: HTMLDivElement;
  const [pending, setPending] = createSignal<PendingConnection | null>(null);
  const [box, setBox] = createSignal<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [spaceDown, setSpaceDown] = createSignal(false);
  const [panning, setPanning] = createSignal(false);

  onSettled(() => {
    ed.setCanvas(el);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = ed.viewport();
      const rect = el.getBoundingClientRect();
      // trackpad two-finger scroll pans; wheel / pinch zooms
      const isPinch = e.ctrlKey;
      const isTrackpadPan = !isPinch && e.deltaMode === 0 && Math.abs(e.deltaX) > 0 && Math.abs(e.deltaY) < 50;
      if (isTrackpadPan) {
        ed.setViewport({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
        return;
      }
      const factor = Math.exp(-e.deltaY * (isPinch ? 0.01 : 0.0015));
      const zoom = Math.min(2.5, Math.max(0.1, v.zoom * factor));
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      ed.setViewport({ zoom, x: mx - ((mx - v.x) / v.zoom) * zoom, y: my - ((my - v.y) / v.zoom) * zoom });
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement)?.closest?.("input,textarea,[contenteditable]")) setSpaceDown(true);
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("pointerdown", onPanCapture, { capture: true });
    // no double-click actions (enter subgraph, edit code) while panning with Space
    const blockDblClick = (e: MouseEvent) => {
      if (spaceDown()) e.stopPropagation();
    };
    el.addEventListener("dblclick", blockDblClick, { capture: true });
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    requestAnimationFrame(() => {
      if (!ed.state.viewports[ed.state.graph]) ed.fitView();
    });
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("pointerdown", onPanCapture, { capture: true });
      el.removeEventListener("dblclick", blockDblClick, { capture: true });
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    };
  });

  // ---- background interactions -----------------------------------------------
  /** Drag the viewport. A click without movement clears the selection only when it began on empty canvas. */
  const startPan = (e: PointerEvent, clearOnClick: boolean) => {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const v0 = ed.viewport();
    let moved = false;
    setPanning(true);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      ed.setViewport({ ...v0, x: v0.x + dx, y: v0.y + dy });
    };
    const up = () => {
      setPanning(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved && clearOnClick) ed.clearSelection();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /**
   * Space+drag and middle-drag pan from anywhere on the canvas. This runs in
   * the capture phase so presses over nodes, handles and group headers pan
   * instead of reaching their drag/connect handlers.
   */
  const onPanCapture = (e: PointerEvent) => {
    if (!(e.button === 1 || (e.button === 0 && spaceDown()))) return;
    e.stopPropagation();
    ui.closeMenus();
    startPan(e, !(e.target as HTMLElement).closest("[data-node-id],[data-edge-id]"));
  };

  const onBackgroundDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-node-id],[data-edge-id],[data-ui]")) return;
    ui.closeMenus();
    if (e.button === 0 && ed.state.mode === "pan" && !e.shiftKey) {
      startPan(e, true);
      return;
    }
    if (e.button !== 0) return;
    // box selection
    const rect = el.getBoundingClientRect();
    const x0 = e.clientX - rect.left;
    const y0 = e.clientY - rect.top;
    const additive = e.shiftKey;
    const initial = additive ? [...ed.state.selection.nodes] : [];
    setBox({ x0, y0, x1: x0, y1: y0 });
    const move = (ev: PointerEvent) => {
      const b = { x0, y0, x1: ev.clientX - rect.left, y1: ev.clientY - rect.top };
      setBox(b);
      const v = ed.viewport();
      const fx0 = (Math.min(b.x0, b.x1) - v.x) / v.zoom;
      const fy0 = (Math.min(b.y0, b.y1) - v.y) / v.zoom;
      const fx1 = (Math.max(b.x0, b.x1) - v.x) / v.zoom;
      const fy1 = (Math.max(b.y0, b.y1) - v.y) / v.zoom;
      const hits = ed
        .graph()
        .nodes.filter((n) => {
          const s = ed.nodeSize(n);
          return n.position.x < fx1 && n.position.x + s.w > fx0 && n.position.y < fy1 && n.position.y + s.h > fy0;
        })
        .map((n) => n.id);
      ed.select([...new Set([...initial, ...hits])]);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const b = box();
      setBox(null);
      if (b && Math.abs(b.x1 - b.x0) + Math.abs(b.y1 - b.y0) < 3 && !additive) ed.clearSelection();
      void ev;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---- connections -------------------------------------------------------------
  const handlePos = (nodeId: string, side: "in" | "out", key: string): XY | null => {
    const n = ed.nodesById().get(nodeId);
    if (!n) return null;
    const l = ed.layout[nodeId];
    const off = l?.handles[`${side}:${key}`];
    if (off) return { x: n.position.x + off.x, y: n.position.y + off.y };
    const s = ed.nodeSize(n);
    return { x: n.position.x + (side === "out" ? s.w : 0), y: n.position.y + 30 };
  };

  const findTarget = (clientX: number, clientY: number, from: PendingConnection["from"]) => {
    const want = from.side === "out" ? "in" : "out";
    const elAt = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const h = elAt?.closest("[data-handle]") as HTMLElement | null;
    let cand: { nodeId: string; key: string; type: string } | null = null;
    if (h) {
      const [side, key] = (h.dataset.handle ?? "").split(":");
      if (side === want && h.dataset.node !== from.nodeId) cand = { nodeId: h.dataset.node!, key, type: h.dataset.type ?? "any" };
    }
    if (!cand) {
      // snap to nearest compatible handle within 28px
      const p = ed.screenToFlow(clientX, clientY);
      const radius = 28 / ed.viewport().zoom;
      let best = radius;
      for (const [nodeId, l] of Object.entries(ed.layout)) {
        if (nodeId === from.nodeId) continue;
        const n = ed.nodesById().get(nodeId);
        if (!n) continue;
        for (const [hk, off] of Object.entries(l.handles)) {
          const [side, key] = hk.split(":");
          if (side !== want) continue;
          const d = Math.hypot(n.position.x + off.x - p.x, n.position.y + off.y - p.y);
          if (d < best) {
            best = d;
            const t = side === "in" ? ed.types().get(nodeId)?.in[key] : ed.types().get(nodeId)?.out[key];
            cand = { nodeId, key, type: t ?? "any" };
          }
        }
      }
    }
    if (!cand) return null;
    const ok = from.side === "out" ? canConnectTypes(from.type, cand.type) : canConnectTypes(cand.type, from.type);
    return ok ? cand : null;
  };

  const onHandleDown = (e: PointerEvent, nodeId: string, side: "in" | "out", key: string) => {
    if (e.button !== 0) return;
    let from: PendingConnection["from"];
    if (side === "in") {
      const existing = ed.graph().edges.find((x) => x.target === nodeId && x.targetHandle === key);
      if (existing) {
        // pick up the existing wire from its source
        ed.mutate((doc) => {
          const g = graphOf(doc, ed.state.graph);
          g.edges = g.edges.filter((x) => x.id !== existing.id);
        });
        from = {
          nodeId: existing.source,
          side: "out",
          key: existing.sourceHandle,
          type: ed.types().get(existing.source)?.out[existing.sourceHandle] ?? "any",
        };
      } else {
        from = { nodeId, side, key, type: ed.types().get(nodeId)?.in[key] ?? "any" };
      }
    } else {
      from = { nodeId, side, key, type: ed.types().get(nodeId)?.out[key] ?? "any" };
    }
    setPending({ from, to: ed.screenToFlow(e.clientX, e.clientY), hover: null });
    const move = (ev: PointerEvent) => {
      const hover = findTarget(ev.clientX, ev.clientY, from);
      setPending({ from, to: ed.screenToFlow(ev.clientX, ev.clientY), hover: hover && { nodeId: hover.nodeId, key: hover.key } });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const target = findTarget(ev.clientX, ev.clientY, from);
      setPending(null);
      if (target) {
        const c =
          from.side === "out"
            ? { source: from.nodeId, sourceHandle: from.key, target: target.nodeId, targetHandle: target.key }
            : { source: target.nodeId, sourceHandle: target.key, target: from.nodeId, targetHandle: from.key };
        const err = ed.connect(c);
        if (err) ui.toast(err, "error");
        return;
      }
      const overCanvas = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest(".graph-canvas");
      if (overCanvas) {
        ui.openPicker({ x: ev.clientX, y: ev.clientY }, { from });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---- derived render data -------------------------------------------------------
  const containers = createMemo(() =>
    ed.graph().nodes.filter((n) => {
      const k = getNodeDef(n.type)?.kind;
      return k === "group" || k === "loop";
    }),
  );
  const comments = createMemo(() => ed.graph().nodes.filter((n) => getNodeDef(n.type)?.kind === "comment"));
  const regular = createMemo(() =>
    ed.graph().nodes.filter((n) => {
      const k = getNodeDef(n.type)?.kind;
      return k !== "group" && k !== "loop" && k !== "comment";
    }),
  );
  const nodeErrors = createMemo(() => {
    const m = new Map<string, string>();
    for (const d of ed.diagnostics()) if (d.nodeId && d.level === "error") m.set(d.nodeId, d.message);
    return m;
  });
  const connected = createMemo(() => {
    const ins = new Map<string, Set<string>>();
    const outs = new Map<string, Set<string>>();
    for (const e of ed.graph().edges) {
      if (!ins.has(e.target)) ins.set(e.target, new Set());
      ins.get(e.target)!.add(e.targetHandle);
      if (!outs.has(e.source)) outs.set(e.source, new Set());
      outs.get(e.source)!.add(e.sourceHandle);
    }
    return { ins, outs };
  });

  // Dot spacing on screen; doubles when zoomed far out so the dots don't
  // merge into a grey wash.
  const gridStep = () => {
    let step = 20 * ed.viewport().zoom;
    while (step < 10) step *= 2;
    return step;
  };

  const transform = () => {
    const v = ed.viewport();
    return `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
  };

  return (
    <div
      ref={el}
      class={[
        "graph-canvas absolute inset-0 overflow-hidden outline-none select-none",
        panning() ? "cursor-grabbing" : ed.state.mode === "pan" || spaceDown() ? "cursor-grab" : "cursor-default",
        // while Space is held everything under the pointer pans, so show that over nodes too
        { "[&_*]:!cursor-grab": spaceDown() && !panning(), "[&_*]:!cursor-grabbing": panning() },
      ]}
      style={{
        "background-size": `${gridStep()}px ${gridStep()}px`,
        "background-position": `${ed.viewport().x}px ${ed.viewport().y}px`,
      }}
      tabindex="0"
      onPointerDown={onBackgroundDown}
      onPointerMove={(e) => ed.setPointer({ x: e.clientX, y: e.clientY })}
      onDblClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-node-id],[data-edge-id],[data-ui]")) return;
        ui.openPicker({ x: e.clientX, y: e.clientY });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const nodeEl = (e.target as HTMLElement).closest("[data-node-id]") as HTMLElement | null;
        const edgeEl = (e.target as HTMLElement).closest("[data-edge-id]") as HTMLElement | null;
        if (nodeEl) {
          const id = nodeEl.dataset.nodeId!;
          if (!ed.state.selection.nodes.includes(id)) ed.select([id]);
          ui.openContext({ x: e.clientX, y: e.clientY }, { kind: "node", id });
        } else if (edgeEl) {
          ed.select([], [edgeEl.dataset.edgeId!]);
          ui.openContext({ x: e.clientX, y: e.clientY }, { kind: "edge", id: edgeEl.dataset.edgeId! });
        } else ui.openContext({ x: e.clientX, y: e.clientY }, { kind: "canvas" });
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes("application/x-tsl-node")) e.preventDefault();
      }}
      onDrop={(e) => {
        const type = e.dataTransfer?.getData("application/x-tsl-node");
        const sg = e.dataTransfer?.getData("application/x-tsl-subgraph");
        if (sg) {
          e.preventDefault();
          ui.insertSubgraphById(sg, ed.screenToFlow(e.clientX, e.clientY));
        } else if (type) {
          e.preventDefault();
          ed.addNodeAt(type, ed.screenToFlow(e.clientX, e.clientY));
        }
      }}
    >
      <div class="absolute top-0 left-0 origin-top-left" style={{ transform: transform() }}>
        <For each={containers()}>{(n) => <Container node={n} />}</For>
        <svg class="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1">
          <For each={ed.graph().edges}>
            {(edge) => <EdgePath edge={edge} handlePos={handlePos} />}
          </For>
          <Show when={pending()}>
            {(p) => {
              const start = () => handlePos(p().from.nodeId, p().from.side, p().from.key) ?? p().to;
              const d = () => {
                const s = start();
                const t = p().to;
                return p().from.side === "out" ? bezier(s, t) : bezier(t, s);
              };
              return (
                <path
                  d={d()}
                  class="edge-path"
                  stroke={typeColor(p().from.type)}
                  stroke-dasharray={p().hover ? undefined : "6 4"}
                  opacity="0.9"
                />
              );
            }}
          </Show>
        </svg>
        <For each={comments()}>{(n) => <Comment node={n} />}</For>
        <For each={regular()}>
          {(n) => (
            <NodeWrapper
              node={n}
              error={nodeErrors().get(n.id)}
              connectedIn={connected().ins.get(n.id)}
              connectedOut={connected().outs.get(n.id)}
              targetHandle={pending()?.hover?.nodeId === n.id ? `in:${pending()!.hover!.key}` : null}
              onHandleDown={(e, side, key) => onHandleDown(e, n.id, side, key)}
            />
          )}
        </For>
      </div>
      <Show when={box()}>
        {(b) => (
          <div
            class="pointer-events-none absolute border border-blue-500 bg-blue-500/10"
            style={{
              left: `${Math.min(b().x0, b().x1)}px`,
              top: `${Math.min(b().y0, b().y1)}px`,
              width: `${Math.abs(b().x1 - b().x0)}px`,
              height: `${Math.abs(b().y1 - b().y0)}px`,
            }}
          />
        )}
      </Show>
    </div>
  );
}

function bezier(a: XY, b: XY): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function EdgePath(props: { edge: GraphEdge; handlePos: (id: string, side: "in" | "out", key: string) => XY | null }) {
  const ed = useContext(EditorContext);
  const d = createMemo(() => {
    const a = props.handlePos(props.edge.source, "out", props.edge.sourceHandle);
    const b = props.handlePos(props.edge.target, "in", props.edge.targetHandle);
    return a && b ? bezier(a, b) : "";
  });
  const color = () => typeColor(ed.types().get(props.edge.source)?.out[props.edge.sourceHandle]);
  const selected = () => ed.state.selection.edges.includes(props.edge.id);
  return (
    <g>
      <path
        d={d()}
        class="edge-hit"
        style={{ "pointer-events": "stroke" }}
        data-edge-id={props.edge.id}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          ed.select([], [props.edge.id], e.shiftKey);
        }}
      />
      <path
        d={d()}
        class={["edge-path", { "edge-selected": selected() }]}
        stroke={color()}
        stroke-width={selected() ? 3 : 2}
        opacity={selected() ? 1 : 0.85}
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// node wrapper: positioning, drag, measurement
// ---------------------------------------------------------------------------

function useNodeDrag(ed: Editor, node: () => GraphNode) {
  return (e: PointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("[data-handle],[data-nodrag],input,textarea,select,button")) return;
    e.stopPropagation();
    const id = node().id;
    const current = [...ed.state.selection.nodes];
    const selected = current.includes(id);
    // selection writes are not readable until flush, so compute the result here
    let ids: string[];
    if (e.shiftKey) {
      ids = selected ? current.filter((x) => x !== id) : [...current, id];
      ed.select(ids, [...ed.state.selection.edges]);
      if (selected) return;
    } else if (selected) {
      ids = current;
    } else {
      ids = [id];
      ed.select(ids);
    }
    const start = { x: e.clientX, y: e.clientY };
    let last = start;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      if (!dragging) {
        dragging = true;
        ed.pushHistory();
      }
      const z = ed.viewport().zoom;
      ed.moveNodes({ x: (ev.clientX - last.x) / z, y: (ev.clientY - last.y) / z }, ids);
      last = { x: ev.clientX, y: ev.clientY };
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (dragging) ed.finishDrag(ids);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

function measure(ed: Editor, id: string, el: HTMLElement) {
  const zoom = ed.viewport().zoom;
  const base = el.getBoundingClientRect();
  const handles: Record<string, XY> = {};
  for (const h of el.querySelectorAll<HTMLElement>("[data-handle]")) {
    const r = h.getBoundingClientRect();
    handles[h.dataset.handle!] = {
      x: (r.left + r.width / 2 - base.left) / zoom + (h.dataset.handle!.startsWith("in:") ? -r.width / 2 / zoom : r.width / 2 / zoom),
      y: (r.top + r.height / 2 - base.top) / zoom,
    };
  }
  ed.setLayout((l) => {
    l[id] = { w: el.offsetWidth, h: el.offsetHeight, handles };
  });
}

function NodeWrapper(props: {
  node: GraphNode;
  error?: string;
  connectedIn?: Set<string>;
  connectedOut?: Set<string>;
  targetHandle: string | null;
  onHandleDown: (e: PointerEvent, side: "in" | "out", key: string) => void;
}) {
  const ed = useContext(EditorContext);
  let el!: HTMLDivElement;
  const ports = createMemo(() => ed.resolvePorts(props.node));
  const t = createMemo(() => ed.types().get(props.node.id));
  const selected = () => ed.state.selection.nodes.includes(props.node.id);
  const onDown = useNodeDrag(ed, () => props.node);

  onSettled(() => {
    const id = props.node.id;
    const ro = new ResizeObserver(() => measure(ed, id, el));
    ro.observe(el);
    measure(ed, id, el);
    return () => {
      ro.disconnect();
      // disposal runs inside the reactive update; write afterwards
      setTimeout(() => {
        if (!ed.nodesById().has(id))
          ed.setLayout((l) => {
            delete l[id];
          });
      });
    };
  });

  return (
    <div
      ref={el}
      data-node-id={props.node.id}
      class="absolute top-0 left-0"
      style={{
        transform: `translate(${props.node.position.x}px, ${props.node.position.y}px)`,
        "z-index": selected() ? 1000 : 1,
      }}
      onPointerDown={onDown}
      onDblClick={(e) => {
        e.stopPropagation();
        const def = getNodeDef(props.node.type);
        if (def?.kind === "subgraph" && props.node.data.subgraphId) ed.enterSubgraph(props.node.data.subgraphId);
        else if (def?.kind === "code") ui.editCode(props.node.id);
      }}
    >
      <NodeCard
        doc={ed.state.doc}
        node={props.node}
        inputs={ports().inputs}
        outputs={ports().outputs}
        selected={selected()}
        error={props.error}
        inTypes={t()?.in}
        outTypes={t()?.out}
        connectedIn={props.connectedIn}
        connectedOut={props.connectedOut}
        targetHandle={props.targetHandle}
        onHandleDown={props.onHandleDown}
        onToggleDebug={() => ed.updateData(props.node.id, (n) => (n.data.debug = !n.data.debug), { recompile: false })}
        debugRef={(c) => ui.registerDebugCanvas(props.node.id, c)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// containers (groups / loops) and comments
// ---------------------------------------------------------------------------

function useResize(ed: Editor, node: () => GraphNode, min = { w: 160, h: 80 }) {
  return (e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const w0 = node().width ?? 240;
    const h0 = node().height ?? 120;
    ed.pushHistory();
    const move = (ev: PointerEvent) => {
      const z = ed.viewport().zoom;
      const w = Math.max(min.w, w0 + (ev.clientX - start.x) / z);
      const h = Math.max(min.h, h0 + (ev.clientY - start.y) / z);
      ed.updateData(
        node().id,
        (n) => {
          n.width = Math.round(w);
          n.height = Math.round(h);
        },
        { history: false, recompile: false },
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

function Container(props: { node: GraphNode }) {
  const ed = useContext(EditorContext);
  const isLoop = () => getNodeDef(props.node.type)?.kind === "loop";
  const selected = () => ed.state.selection.nodes.includes(props.node.id);
  const onDown = useNodeDrag(ed, () => props.node);
  const onResize = useResize(ed, () => props.node, { w: 200, h: 120 });
  const [editing, setEditing] = createSignal(false);
  return (
    <div
      data-node-id={props.node.id}
      class={[
        "absolute top-0 left-0 rounded-xl border-2",
        isLoop()
          ? "border-indigo-500/50 bg-indigo-500/[0.06]"
          : "border-dashed border-gray-400/40 bg-gray-500/[0.05] dark:border-white/15 dark:bg-white/[0.03]",
        { "!border-blue-500": selected() },
      ]}
      style={{
        transform: `translate(${props.node.position.x}px, ${props.node.position.y}px)`,
        width: `${props.node.width ?? 400}px`,
        height: `${props.node.height ?? 240}px`,
      }}
      onPointerDown={(e) => {
        // only the header bar drags a container, the body is for box-select/pan
        if (!(e.target as HTMLElement).closest("[data-container-header]")) return;
        onDown(e);
      }}
    >
      <div
        data-container-header
        class={[
          "flex h-8 cursor-grab items-center gap-2 rounded-t-[10px] px-3 text-[10px] font-semibold tracking-widest uppercase",
          isLoop() ? "bg-indigo-500/15 text-indigo-300" : "text-gray-500 dark:text-white/50",
        ]}
        onDblClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        <Show
          when={editing()}
          fallback={<span class="truncate">{props.node.data.label ?? (isLoop() ? "Loop" : "Group")}</span>}
        >
          <input
            data-nodrag
            class="w-full rounded bg-black/30 px-1 py-0.5 text-[10px] tracking-widest text-white uppercase outline-none"
            value={props.node.data.label ?? ""}
            placeholder="Group name..."
            ref={(i) => requestAnimationFrame(() => i.select())}
            onBlur={(e) => {
              const v = e.currentTarget.value;
              setEditing(false);
              ed.updateData(props.node.id, (n) => (n.data.label = v || undefined), { recompile: false });
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </Show>
        <Show when={isLoop()}>
          <span class="ml-auto font-mono text-[9px] tracking-normal normal-case opacity-70">for (i) {"{ … }"}</span>
        </Show>
      </div>
      <div class="absolute right-0 bottom-0 size-4 cursor-se-resize" data-nodrag onPointerDown={onResize}>
        <svg viewBox="0 0 10 10" class="size-full p-1 text-gray-400">
          <path d="M9 1 L1 9 M9 5 L5 9" stroke="currentColor" stroke-width="1" />
        </svg>
      </div>
    </div>
  );
}

function Comment(props: { node: GraphNode }) {
  const ed = useContext(EditorContext);
  const selected = () => ed.state.selection.nodes.includes(props.node.id);
  const onDown = useNodeDrag(ed, () => props.node);
  const onResize = useResize(ed, () => props.node, { w: 140, h: 60 });
  const [editing, setEditing] = createSignal(false);
  const html = createMemo(() => renderMarkdown(props.node.data.text ?? ""));
  const highlighted = () => ui.findHighlight() === props.node.id;
  return (
    <div
      data-node-id={props.node.id}
      class={[
        "absolute top-0 left-0 flex flex-col overflow-hidden rounded-lg border bg-amber-100/90 text-gray-800 shadow-md dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-50/90",
        { "ring-2 ring-blue-500": selected(), "ring-2 ring-amber-400": highlighted() && !selected() },
      ]}
      style={{
        transform: `translate(${props.node.position.x}px, ${props.node.position.y}px)`,
        width: `${props.node.width ?? 240}px`,
        height: `${props.node.height ?? 120}px`,
        "z-index": 2,
      }}
      onPointerDown={onDown}
      onDblClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      <Show
        when={editing()}
        fallback={
          <div class="md thin-scroll h-full overflow-auto px-3 py-2 text-xs">
            <Show when={props.node.data.text} fallback={<span class="opacity-50">Add markdown notes...</span>}>
              <div innerHTML={html()} />
            </Show>
          </div>
        }
      >
        <textarea
          data-nodrag
          class="h-full w-full resize-none bg-transparent px-3 py-2 font-mono text-xs outline-none"
          placeholder="Write markdown notes..."
          value={props.node.data.text ?? ""}
          ref={(t) => requestAnimationFrame(() => t.focus())}
          onBlur={(e) => {
            const v = e.currentTarget.value;
            setEditing(false);
            if (v !== (props.node.data.text ?? "")) ed.updateData(props.node.id, (n) => (n.data.text = v), { recompile: false });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
            e.stopPropagation();
          }}
        />
      </Show>
      <div class="absolute right-0 bottom-0 size-3 cursor-se-resize" data-nodrag onPointerDown={onResize} />
    </div>
  );
}
