import { For, Show, createMemo } from "solid-js";
import { Bug, FileCode2 } from "lucide-static";
import { nodeTitle } from "../../core/graph";
import { CATEGORY_HEADER, getNodeDef, typeColor } from "../../core/registry";
import type { GraphNode, PortDef, ProjectDoc } from "../../core/types";
import { Icon } from "../ui";

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
  onToggleDebug?: () => void;
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

  const valueHint = (p: PortDef) => {
    if (props.connectedIn?.has(p.key)) return null;
    if (p.connectionOnly) return null;
    const v = props.node.data.values[p.key] ?? p.default;
    if (v === undefined) return null;
    return v;
  };

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
        <Show when={kind() !== "placeholder"}>
          <button
            type="button"
            data-nodrag
            aria-label="Show node debug preview"
            aria-pressed={props.node.data.debug ? "true" : "false"}
            class={[
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
              props.node.data.debug
                ? "border-blue-500/50 bg-blue-500/15 text-blue-500"
                : "border-transparent text-gray-500 hover:bg-white/40 dark:hover:bg-white/10",
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

      <Extra {...props} />

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
                <Show when={row.input}>
                  {(p) => (
                    <div class="group relative flex flex-row items-center py-0.5">
                      <Handle
                        side="in"
                        nodeId={props.node.id}
                        portKey={p().key}
                        type={props.inTypes?.[p().key] ?? p().type}
                        connected={!!props.connectedIn?.has(p().key)}
                        active={props.targetHandle === `in:${p().key}`}
                        onDown={props.onHandleDown}
                      />
                      <span
                        class={[
                          "px-1 text-[10px] font-medium tracking-wider uppercase transition-colors duration-150",
                          props.connectedIn?.has(p().key)
                            ? "text-gray-700 dark:text-white/90"
                            : "text-gray-500 group-hover:text-gray-700 dark:text-white/50 dark:group-hover:text-white/90",
                          isMaterial() ? "max-w-[100px] min-w-[100px] whitespace-normal" : "whitespace-nowrap",
                        ]}
                      >
                        {p().label}
                      </span>
                      <Show when={valueHint(p())}>
                        {(v) => (
                          <Show
                            when={p().type === "color" || (typeof v() === "string" && /^#[0-9a-f]{6}$/i.test(String(v())))}
                            fallback={
                              <Show when={fmt(v())}>
                                <span class="font-mono text-[9px] text-gray-500 tabular-nums">({fmt(v())})</span>
                              </Show>
                            }
                          >
                            <div
                              class="h-3 w-3 rounded-[3px] border border-gray-200 shadow-sm dark:border-white/10"
                              title={String(v())}
                              style={{ "background-color": String(v()) }}
                            />
                          </Show>
                        )}
                      </Show>
                    </div>
                  )}
                </Show>
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

      <Show when={props.node.data.debug && !props.static}>
        <div class="px-2 pb-2">
          <canvas
            ref={(el) => props.debugRef?.(el)}
            width="96"
            height="96"
            class="aspect-square w-full rounded-md border border-gray-200 bg-black dark:border-white/10"
            style={{ "image-rendering": "pixelated", "min-width": "120px" }}
          />
        </div>
      </Show>
    </div>
  );
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
      <Show when={def()?.kind === "multiOp"}>
        <div class="flex flex-wrap gap-1 px-2 pt-2">
          <For each={props.node.data.ops ?? []}>
            {(op) => (
              <span class="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[9px] text-gray-500 uppercase dark:bg-white/10 dark:text-gray-300">
                {op.op}
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={def()?.kind === "uniform"}>
        <div class="px-3 pt-1.5 font-mono text-[9px] text-gray-500">
          {String(props.node.data.values.type ?? "float")} · {fmt(props.node.data.values.value) || String(props.node.data.values.value ?? "")}
        </div>
      </Show>
    </>
  );
}
