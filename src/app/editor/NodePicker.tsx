import { For, Show, createMemo, createSignal, useContext } from "solid-js";
import { Portal } from "@solidjs/web";
import { Search } from "lucide-static";
import { canConnectTypes, resolvePorts, makeNode } from "../../core/graph";
import { allNodeDefs } from "../../core/registry";
import type { GraphKind, NodeDef, PortDef } from "../../core/types";
import { Icon } from "../ui";
import { EditorContext, type Editor } from "./store";
import { ui, type PickerState } from "./ui-state";

function compatiblePort(def: NodeDef, from: { side: "in" | "out"; type: string }, doc: Parameters<typeof resolvePorts>[0]): PortDef | undefined {
  const ports = resolvePorts(doc, makeNode(def.type, { x: 0, y: 0 }));
  const list = from.side === "out" ? ports.inputs.filter((p) => !p.propertyOnly) : ports.outputs;
  const ok = list.filter((p) => (from.side === "out" ? canConnectTypes(from.type, p.type) : canConnectTypes(p.type, from.type)));
  return ok.find((p) => p.type === from.type) ?? ok.find((p) => p.key === "out") ?? ok[0];
}

export function NodePicker() {
  const ed = useContext(EditorContext);
  return (
    <Show when={ui.picker()}>
      {(p) => <PickerPanel screen={p().screen} pending={p().pending} ed={ed} />}
    </Show>
  );
}

function PickerPanel(props: { screen: { x: number; y: number }; pending?: PickerState["pending"]; ed: Editor }) {
  const ed = props.ed;
  const [q, setQ] = createSignal("");
  const [active, setActive] = createSignal(0);
  const graphKind = (): GraphKind => (ed.state.graph === "post" ? "post" : "material");
  const results = createMemo(() => {
    const query = q().toLowerCase().trim();
    const from = props.pending?.from;
    let defs = allNodeDefs().filter(
      (d) =>
        d.category !== "Subgraph" &&
        d.kind !== "placeholder" &&
        d.category !== "Loop" &&
        d.type !== "utils/group" &&
        (!d.graphs || ed.state.graph.startsWith("sg:") || d.graphs.includes(graphKind())),
    );
    if (from) defs = defs.filter((d) => compatiblePort(d, from, ed.state.doc));
    if (query) {
      const score = (d: NodeDef) => {
        const l = d.label.toLowerCase();
        if (l === query) return 0;
        if (l.startsWith(query)) return 1;
        if (l.includes(query)) return 2;
        if (d.type.toLowerCase().includes(query) || (d.tsl ?? "").toLowerCase().includes(query)) return 3;
        if ((d.description ?? "").toLowerCase().includes(query)) return 4;
        return 99;
      };
      defs = defs
        .map((d) => [d, score(d)] as const)
        .filter(([, s]) => s < 99)
        .sort((a, b) => a[1] - b[1] || a[0].label.localeCompare(b[0].label))
        .map(([d]) => d);
    } else {
      defs = defs.sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
    }
    return defs.slice(0, 80);
  });

  const choose = (def: NodeDef) => {
    const at = ed.screenToFlow(props.screen.x, props.screen.y);
    ui.closePicker();
    if (def.kind === "loop") {
      ed.createLoop(at);
      return;
    }
    const from = props.pending?.from;
    const id = ed.addNodeAt(def.type, { x: at.x + (from?.side === "out" ? 90 : from ? -90 : 0), y: at.y + 30 });
    if (!from) return;
    const port = compatiblePort(def, from, ed.state.doc);
    if (!port) return;
    const err =
      from.side === "out"
        ? ed.connect({ source: from.nodeId, sourceHandle: from.key, target: id, targetHandle: port.key })
        : ed.connect({ source: id, sourceHandle: port.key, target: from.nodeId, targetHandle: from.key });
    if (err) ui.toast(err, "error");
  };

  let listEl!: HTMLDivElement;
  const left = () => Math.min(props.screen.x, window.innerWidth - 300);
  const top = () => Math.min(props.screen.y, window.innerHeight - 380);

  return (
    <Portal>
      <div class="fixed inset-0 z-[70]" onPointerDown={() => ui.closePicker()} />
      <div
        class="fixed z-[71] flex w-[280px] flex-col overflow-hidden rounded-lg border bg-popover shadow-xl"
        style={{ left: `${left()}px`, top: `${top()}px` }}
        data-ui
      >
        <div class="relative border-b">
          <Icon svg={Search} class="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            class="h-10 w-full bg-transparent pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground"
            placeholder={props.pending ? "Add connected node..." : "Search nodes..."}
            value={q()}
            ref={(i) => requestAnimationFrame(() => i.focus())}
            onInput={(e) => {
              setQ(e.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(results().length - 1, a + 1));
                listEl.querySelector(`[data-i="${active() + 1}"]`)?.scrollIntoView({ block: "nearest" });
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
                listEl.querySelector(`[data-i="${active() - 1}"]`)?.scrollIntoView({ block: "nearest" });
              } else if (e.key === "Enter") {
                const d = results()[active()];
                if (d) choose(d);
              } else if (e.key === "Escape") ui.closePicker();
              e.stopPropagation();
            }}
          />
        </div>
        <div ref={listEl} class="thin-scroll max-h-[320px] overflow-y-auto p-1">
          <For each={results()} fallback={<div class="px-3 py-6 text-center text-xs text-muted-foreground">No matching nodes</div>}>
            {(d, i) => (
              <button
                type="button"
                data-i={i()}
                class={[
                  "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
                  i() === active() ? "bg-accent" : "hover:bg-accent/60",
                ]}
                onPointerEnter={() => setActive(i())}
                onClick={() => choose(d)}
              >
                <span class="truncate">{d.label}</span>
                <span class="shrink-0 text-[10px] text-muted-foreground">{d.category}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </Portal>
  );
}
