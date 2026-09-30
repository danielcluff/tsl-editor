import { For, Show, createMemo, createSignal } from "solid-js";
import { Bug, Check, ChevronDown, FileCode2 } from "lucide-static";
import { nodePreviewOn, nodeTitle } from "../../core/graph";
import { CATEGORY_HEADER, getNodeDef, typeColor } from "../../core/registry";
import type { GraphNode, MultiOpOperation, PortDef, ProjectDoc } from "../../core/types";
import { multiOpHandleId, multiOpInfo, multiOpOptions, multiOpParams, newMultiOpId } from "../../core/multiop";
import type { DebugStats } from "../../runtime/preview";
import { PREVIEW_SIZE } from "../../runtime/preview-size";
import { fmtValue } from "./format";
import { Icon, Popover, type PopoverAnchor } from "../ui";

export interface NodeCardProps {
  doc: ProjectDoc;
  node: GraphNode;
  inputs: PortDef[];
  outputs: PortDef[];
  selected?: boolean;
  static?: boolean;
  error?: string;
  inTypes?: Record<string, string>;
  outTypes?: Record<string, string>;
  connectedIn?: Set<string>;
  connectedOut?: Set<string>;
  /** handle currently hovered as a valid connection target */
  targetHandle?: string | null;
  onHandleDown?: (e: PointerEvent, side: "in" | "out", key: string) => void;
  /** Node can show a live preview thumbnail (it has a value in the material graph). */
  previewable?: boolean;
  /** The output is the same everywhere on the surface (from the graph), so a picture adds nothing. */
  surfaceUniform?: boolean;
  /** Output value stats from the last preview render (math nodes show these as a readout). */
  valueStats?: DebugStats;
  /** Output value at a point of the preview (u, v in 0..1 from the top-left). */
  sampleValue?: (u: number, v: number) => number[] | undefined;
  onToggleDebug?: () => void;
  /** Edit a multi-op's operation list (add / remove / change). */
  onMultiOp?: (fn: (operations: MultiOpOperation[]) => void) => void;
  debugRef?: (el: HTMLCanvasElement) => void;
  onTitleDblClick?: () => void;
}

function fmt(v: unknown): string {
  if (typeof v === "number") return String(Math.round(v * 1000) / 1000);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) return v.map(fmt).join(", ");
  if (typeof v === "string" && v.length < 16) return v;
  return "";
}

export function NodeCard(props: NodeCardProps) {
  const def = createMemo(() => getNodeDef(props.node.type));
  const kind = () => def()?.kind ?? "standard";
  const isMaterial = () => kind() === "material";
  const title = () => nodeTitle(props.doc, props.node);
  // previews are on unless the user switched them off for this node
  const previewOn = () => !!props.previewable && !props.static && nodePreviewOn(props.doc, props.node);
  // math nodes compute a value: show it (and its type) instead of only a picture
  const valueMode = () => def()?.category === "Math";
  const outType = () => props.valueStats?.type ?? props.outTypes?.out ?? Object.values(props.outTypes ?? {})[0] ?? "any";
  const [hover, setHover] = createSignal<number[] | undefined>();
  const header = () =>
    kind() === "placeholder"
      ? "bg-[repeating-linear-gradient(135deg,rgba(245,158,11,0.18)_0_6px,transparent_6px_12px)]"
      : (CATEGORY_HEADER[def()?.category ?? ""] ?? "cat-default");
  const propRows = createMemo(() => (def()?.callable ? (def()?.inputs.filter((i) => i.propertyOnly) ?? []) : []));
  const rows = createMemo(() => {
    const ins = props.inputs;
    const outs = props.outputs;
    const n = Math.max(ins.length + propRows().length, outs.length);
    return Array.from({ length: n }, (_, i) => ({
      prop: i < propRows().length ? propRows()[i] : undefined,
      input: i >= propRows().length ? ins[i - propRows().length] : undefined,
      output: outs[i],
    }));
  });


  return (
    <div
      class={[
        "flex min-w-[50px] flex-col overflow-hidden rounded-xl bg-white/95 transition-shadow duration-150 dark:bg-card/95",
        props.selected ? "shadow-xl shadow-gray-400/50 dark:shadow-black/50" : "shadow-lg shadow-gray-300/50 dark:shadow-black/30",
        { "ring-1 ring-red-500/80": !!props.error && kind() !== "placeholder" },
        { "outline-dashed outline-1 outline-amber-500/70": kind() === "placeholder" },
      ]}
      title={props.error}
    >
      <div
        class={[
          "flex gap-2 rounded-t-xl border-b px-3 pt-2 pb-1 transition-colors duration-150",
          header(),
          props.selected ? "border-blue-500" : "border-gray-200 dark:border-white/10",
        ]}
      >
        <div class="flex min-w-0 flex-1 flex-col gap-0.5" onDblClick={() => props.onTitleDblClick?.()}>
          <span
            class="block min-w-0 cursor-pointer truncate text-[10px] font-semibold tracking-widest text-gray-800 uppercase transition-colors hover:text-gray-600 dark:text-white/90 dark:hover:text-white/60"
            title={def()?.description ?? title()}
          >
            {title()}
          </span>
        </div>
        <Show when={props.previewable}>
          <button
            type="button"
            data-nodrag
            aria-label="Toggle node preview"
            title={previewOn() ? "Hide preview" : "Show preview"}
            aria-pressed={previewOn() ? "true" : "false"}
            class={[
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/10",
              // on: same colour as the title; off: faded
              previewOn()
                ? "text-gray-800 dark:text-white/90"
                : "text-gray-400 hover:text-gray-600 dark:text-white/25 dark:hover:text-white/60",
            ]}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleDebug?.();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Icon svg={Bug} class="size-3.5" strokeWidth={1.75} />
          </button>
        </Show>
      </div>

      <Show when={previewOn()}>
        <div class="min-w-[120px] border-b border-gray-200 dark:border-white/10">
          {/* A math result that can't vary across the surface has nothing to picture (the canvas stays
              mounted so it keeps rendering). Decided from the graph, not the pixels: a varying signal
              that briefly flattens (e.g. a mix passing through zero) keeps its picture. */}
          <canvas
            ref={(el) => props.debugRef?.(el)}
            width={PREVIEW_SIZE}
            height={PREVIEW_SIZE}
            class={[valueMode() && props.surfaceUniform ? "hidden" : "block aspect-square w-full bg-black"]}
            style={{ "min-width": "120px" }}
            onPointerMove={(e) => {
              if (!props.sampleValue) return;
              const r = e.currentTarget.getBoundingClientRect();
              setHover(props.sampleValue((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
            }}
            onPointerLeave={() => setHover(undefined)}
          />
          <Show when={valueMode()}>
            <ValueReadout type={outType()} stats={props.valueStats} hover={hover()} />
          </Show>
        </div>
      </Show>

      <Extra {...props} />

      <Show when={kind() !== "multiOp"} fallback={<MultiOpBody {...props} />}>
      <div class="relative flex flex-col gap-0 rounded-b-xl pt-1 pb-1.5">
        <For each={rows()}>
          {(row) => (
            <div class="flex min-h-[22px] items-center justify-between">
              <div class="mr-2 flex min-w-0 flex-1 items-center">
                <Show when={row.prop}>
                  {(p) => (
                    <>
                      <span class="ml-2 mr-2 font-mono text-[9px] tracking-wider text-gray-500 uppercase dark:text-gray-400">
                        {p().label}
                      </span>
                      <div class="flex min-w-0 flex-1 items-center justify-end">
                        <span class="flex items-center font-mono text-[9px] text-gray-500 tabular-nums">
                          ({fmt(props.node.data.values[p().key] ?? p().default)})
                        </span>
                      </div>
                    </>
                  )}
                </Show>
                <Show when={row.input}>{(p) => <InputPort card={props} port={p()} wrap={isMaterial()} />}</Show>
              </div>
              <div class="flex shrink-0 items-center">
                <Show when={row.output}>
                  {(p) => (
                    <div class="group relative flex flex-row-reverse items-center py-0.5">
                      <Handle
                        side="out"
                        nodeId={props.node.id}
                        portKey={p().key}
                        type={props.outTypes?.[p().key] ?? p().type}
                        connected={!!props.connectedOut?.has(p().key)}
                        active={false}
                        onDown={props.onHandleDown}
                      />
                      <span
                        class={[
                          "px-1 text-[10px] font-medium tracking-wider whitespace-nowrap uppercase transition-colors duration-150",
                          props.connectedOut?.has(p().key)
                            ? "text-gray-700 dark:text-white/90"
                            : "text-gray-500 group-hover:text-gray-700 dark:text-white/50 dark:group-hover:text-white/90",
                        ]}
                      >
                        {p().label}
                      </span>
                    </div>
                  )}
                </Show>
              </div>
            </div>
          )}
        </For>
        <Show when={rows().length === 0 && !def()?.outputs.length && kind() !== "material"}>
          <div class="px-3 py-1 text-[10px] text-gray-500 dark:text-white/40">No ports</div>
        </Show>
      </div>
      </Show>

    </div>
  );
}

/** An input port: handle, label and the unconnected value as a hint. */
function InputPort(props: { card: NodeCardProps; port: PortDef; wrap?: boolean }) {
  return (
    <div class="group relative flex flex-row items-center py-0.5">
                      <Handle
                        side="in"
                        nodeId={props.card.node.id}
                        portKey={props.port.key}
                        type={props.card.inTypes?.[props.port.key] ?? props.port.type}
                        connected={!!props.card.connectedIn?.has(props.port.key)}
                        active={props.card.targetHandle === `in:${props.port.key}`}
                        onDown={props.card.onHandleDown}
                      />
                      <span
                        class={[
                          "px-1 text-[10px] font-medium tracking-wider uppercase transition-colors duration-150",
                          props.card.connectedIn?.has(props.port.key)
                            ? "text-gray-700 dark:text-white/90"
                            : "text-gray-500 group-hover:text-gray-700 dark:text-white/50 dark:group-hover:text-white/90",
                          props.wrap ? "max-w-[100px] min-w-[100px] whitespace-normal" : "whitespace-nowrap",
                        ]}
                      >
                        {props.port.label}
                      </span>
                      {/* wrapped so falsy defaults like 0 or false still show */}
                      <Show when={valueHint(props.card, props.port) !== null ? { v: valueHint(props.card, props.port) } : undefined}>
                        {(h) => {
                          const v = () => h().v;
                          return (
                          <Show
                            when={props.port.type === "color" || (typeof v() === "string" && /^#[0-9a-f]{6}$/i.test(String(v())))}
                            fallback={
                              <Show when={fmt(v()) !== ""}>
                                <span class="font-mono text-[9px] whitespace-nowrap text-gray-500 tabular-nums">({fmt(v())})</span>
                              </Show>
                            }
                          >
                            <div
                              class="h-3 w-3 rounded-[3px] border border-gray-200 shadow-sm dark:border-white/10"
                              title={String(v())}
                              style={{ "background-color": String(v()) }}
                            />
                          </Show>
                          );
                        }}
                      </Show>
                    </div>
  );
}

function valueHint(card: NodeCardProps, p: PortDef) {
  if (card.connectedIn?.has(p.key)) return null;
  if (p.connectionOnly) return null;
  const v = card.node.data.values[p.key] ?? p.default;
  if (v === undefined) return null;
  return v;
}

function Handle(props: {
  side: "in" | "out";
  nodeId: string;
  portKey: string;
  type: string;
  connected: boolean;
  active: boolean;
  onDown?: (e: PointerEvent, side: "in" | "out", key: string) => void;
}) {
  const color = () => typeColor(props.type);
  return (
    <div class="relative flex items-center" title={props.type}>
      <div
        data-handle={`${props.side}:${props.portKey}`}
        data-node={props.nodeId}
        data-type={props.type}
        class={[
          "graph-handle relative h-4 w-2",
          props.side === "in" ? "rounded-r-[3px]" : "rounded-l-[3px]",
          { "is-connecting-target": props.active },
          props.onDown ? "cursor-crosshair" : "",
        ]}
        style={{
          "--handle-bg": props.connected ? color() : "var(--handle-idle, rgba(255,255,255,0.1))",
          "--handle-hover-bg": color(),
        }}
        onPointerDown={(e) => {
          if (!props.onDown) return;
          e.stopPropagation();
          props.onDown(e, props.side, props.portKey);
        }}
      />
    </div>
  );
}

/** Kind-specific content between header and ports. */
function Extra(props: NodeCardProps) {
  const def = () => getNodeDef(props.node.type);
  return (
    <>
      <Show when={def()?.kind === "placeholder" && props.node.data.placeholder}>
        {(ph) => (
          <div class="px-2 pt-2">
            <div class="mb-1 text-[9px] font-semibold tracking-wider text-amber-500 uppercase">Unsupported · read-only</div>
            <pre
              data-nodrag
              class="thin-scroll max-h-40 max-w-[260px] min-w-[180px] cursor-text overflow-auto rounded-md bg-black/30 px-2 py-1.5 font-mono text-[9px] leading-snug whitespace-pre-wrap text-gray-400 select-text"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {ph().meta}
            </pre>
          </div>
        )}
      </Show>
      <Show when={def()?.kind === "gradient"}>
        <div class="px-2 pt-2">
          <div
            class="h-3 w-full min-w-[140px] rounded-[3px]"
            style={{
              background: `linear-gradient(to right, ${(
                ((props.node.data.values.stops as { pos: number; color: string }[] | undefined) ?? [])
                  .slice()
                  .sort((a, b) => a.pos - b.pos)
                  .map((s) => `${s.color} ${Math.round(s.pos * 100)}%`) || []
              ).join(", ")})`,
            }}
          />
        </div>
      </Show>
      <Show when={def()?.kind === "textureSample"}>
        <div class="px-2 pt-2">
          <div
            class="aspect-square w-full min-w-[120px] rounded-md border border-gray-200 bg-cover bg-center dark:border-white/10"
            style={{
              "background-image":
                String(props.node.data.values.url ?? "/uv.png") === "/uv.png"
                  ? "repeating-conic-gradient(#3b4252 0 25%, #5e6a85 0 50%) 50% / 25% 25%"
                  : `url("${String(props.node.data.values.url)}")`,
            }}
          />
        </div>
      </Show>
      <Show when={def()?.kind === "code" && props.node.data.code}>
        {(code) => (
          <div class="px-2 pt-2">
            <div class="flex max-w-[260px] min-w-[180px] items-start gap-1.5 rounded-md bg-black/30 px-2 py-1.5">
              <Icon svg={FileCode2} class="mt-px size-3 text-gray-400" />
              <pre class="line-clamp-4 overflow-hidden font-mono text-[9px] leading-snug whitespace-pre-wrap text-gray-400">
                {code().source}
              </pre>
            </div>
            <div class="mt-1 font-mono text-[8px] tracking-widest text-gray-500 uppercase">{code().language}</div>
          </div>
        )}
      </Show>
      <Show when={def()?.kind === "uniform"}>
        <div class="px-3 pt-1.5 font-mono text-[9px] text-gray-500">
          {String(props.node.data.values.type ?? "float")} · {fmt(props.node.data.values.value) || String(props.node.data.values.value ?? "")}
        </div>
      </Show>
    </>
  );
}

const AXES = ["x", "y", "z", "w"];


/**
 * Output type on top, then one line per component: the value (constant or under the
 * pointer) or its range across the preview. The line count only depends on the type, so
 * changing numbers don't reflow the node.
 */
function ValueReadout(props: { type: string; stats?: DebugStats; hover?: number[] }) {
  const comps = () => props.stats?.comps ?? 1;
  const shown = () => props.hover ?? (props.stats?.constant ? props.stats.min : undefined);
  const lines = () =>
    Array.from({ length: comps() }, (_, c) => {
      const s = props.stats;
      if (!s) return "…";
      const v = shown();
      return v ? fmtValue(v[c]) : `${fmtValue(s.min[c])} … ${fmtValue(s.max[c])}`;
    });
  return (
    <div class="flex flex-col gap-0.5 px-3 py-1.5 font-mono tabular-nums">
      <span class="text-[9px] tracking-wider uppercase" style={{ color: typeColor(props.type) }}>
        {props.type}
      </span>
      <For each={lines()}>
        {(line, c) => (
          <div class="flex h-4 min-w-0 items-baseline gap-1.5 leading-4">
            <Show when={comps() > 1}>
              <span class="w-2 shrink-0 text-[8px] text-gray-400 uppercase dark:text-white/30">{AXES[c()]}</span>
            </Show>
            <span
              class={[
                "truncate",
                shown() ? "text-[11px] text-gray-800 dark:text-white/90" : "text-[9px] text-gray-500 dark:text-white/50",
              ]}
            >
              {line}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

/** Multi-op card, laid out like the original: one block of ports + operation picker per step. */
function MultiOpBody(props: NodeCardProps) {
  const operations = () => props.node.data.operations ?? [];
  const edit = (fn: (ops: MultiOpOperation[]) => void) => props.onMultiOp?.(fn);
  return (
    <div class="flex flex-col gap-1 pt-1 pb-1.5">
      <Show when={operations().length} fallback={<div class="px-3 py-2 text-[10px] text-muted-foreground">No operations yet</div>}>
        <For each={operations()}>
          {(o, i) => (
            <div class="flex flex-col gap-1">
              <div class="flex min-h-[24px] items-start justify-between">
                <div class="flex min-w-0 flex-col gap-0.5">
                  <For each={multiOpParams(o.op, i() === 0)}>
                    {(param) => <InputPort card={props} port={{ ...param, key: multiOpHandleId(o.id, param.key) }} />}
                  </For>
                </div>
                <div class="flex items-center gap-1 pr-2">
                  <OpPicker
                    value={o.op}
                    disabled={props.static || !props.onMultiOp}
                    onChange={(op) => edit((list) => void (list[i()] = { ...list[i()], op }))}
                  />
                  <button
                    type="button"
                    data-nodrag
                    class="h-6 w-6 rounded-md border border-transparent text-[10px] text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove ${multiOpInfo(o.op)?.label ?? o.op}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      edit((list) => void list.splice(i(), 1));
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
              <Show when={i() < operations().length - 1}>
                <div class="mx-auto my-1 h-px w-full max-w-[90%] bg-border" />
              </Show>
            </div>
          )}
        </For>
      </Show>
      <div class="px-2 pt-1">
        <button
          type="button"
          data-nodrag
          class="h-7 w-full rounded-md border border-dashed border-gray-300 text-[10px] tracking-wider text-gray-500 uppercase transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-white/20 dark:text-white/50 dark:hover:border-white/40 dark:hover:text-white/80"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            edit((list) => void list.push({ id: newMultiOpId(list.length), op: "add" }));
          }}
        >
          + Add Operation
        </button>
      </div>
      <div class="flex items-center justify-end">
        <div class="group relative flex flex-row-reverse items-center py-0.5">
          <Handle
            side="out"
            nodeId={props.node.id}
            portKey="out"
            type={props.outTypes?.out ?? "any"}
            connected={!!props.connectedOut?.has("out")}
            active={false}
            onDown={props.onHandleDown}
          />
          <span
            class={[
              "px-1 text-[10px] font-medium tracking-wider whitespace-nowrap uppercase transition-colors duration-150",
              props.connectedOut?.has("out")
                ? "text-gray-700 dark:text-white/90"
                : "text-gray-500 group-hover:text-gray-700 dark:text-white/50 dark:group-hover:text-white/90",
            ]}
          >
            Out
          </span>
        </div>
      </div>
    </div>
  );
}

/** Searchable operation dropdown (the original uses a combobox here). */
function OpPicker(props: { value: string; onChange: (op: string) => void; disabled?: boolean }) {
  const [anchor, setAnchor] = createSignal<PopoverAnchor | null>(null);
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const options = createMemo(() => {
    const q = query().trim().toLowerCase();
    return multiOpOptions().filter((o) => !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  });
  const choose = (op: string) => {
    setAnchor(null);
    if (op !== props.value) props.onChange(op);
  };
  let list: HTMLDivElement | undefined;
  return (
    <>
      <button
        type="button"
        data-nodrag
        disabled={props.disabled}
        class="ml-2 flex h-6 max-w-[100px] min-w-[50px] items-center justify-between gap-1 rounded-md border border-gray-200 bg-transparent pr-1 pl-2 text-[9px] text-gray-700 disabled:opacity-60 dark:border-white/10 dark:text-white/80"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setQuery("");
          setActive(Math.max(0, multiOpOptions().findIndex((o) => o.value === props.value)));
          const el = e.currentTarget as HTMLElement;
          setAnchor(anchor()?.el === el ? null : { rect: el.getBoundingClientRect(), el });
        }}
      >
        <span class="truncate">{multiOpInfo(props.value)?.label ?? props.value}</span>
        <Icon svg={ChevronDown} class="size-3 shrink-0 text-muted-foreground" />
      </button>
      <Popover open={!!anchor()} anchor={anchor()?.rect} trigger={anchor()?.el} onClose={() => setAnchor(null)} class="w-44 p-1">
        <input
          class="mb-1 h-7 w-full rounded-md border border-input bg-transparent px-2 text-[11px] outline-none dark:bg-input/30"
          placeholder="Search operations..."
          value={query()}
          ref={(i) => requestAnimationFrame(() => i.focus())}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            const n = options().length;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (n ? (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n : 0));
              list?.querySelector(`[data-index="${active()}"]`)?.scrollIntoView({ block: "nearest" });
            } else if (e.key === "Enter") {
              const o = options()[active()];
              if (o) choose(o.value);
            } else if (e.key === "Escape") setAnchor(null);
          }}
        />
        <div ref={list} class="thin-scroll max-h-72 overflow-y-auto" role="listbox">
          <Show when={options().length} fallback={<div class="px-2 py-1.5 text-[11px] text-muted-foreground">No items found.</div>}>
            <For each={options()}>
              {(o, i) => (
                <button
                  type="button"
                  role="option"
                  data-index={i()}
                  aria-selected={o.value === props.value ? "true" : "false"}
                  class={[
                    "relative flex w-full items-center rounded-sm py-1.5 pr-8 pl-2 text-left text-[11px]",
                    i() === active() ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                  ]}
                  onPointerMove={() => setActive(i())}
                  onClick={() => choose(o.value)}
                >
                  {o.label}
                  <Show when={o.value === props.value}>
                    <Icon svg={Check} class="absolute right-2 size-3.5" />
                  </Show>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Popover>
    </>
  );
}
