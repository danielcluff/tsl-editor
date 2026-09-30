import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onSettled,
  type ParentProps,
} from "solid-js";
import { Portal, type JSX } from "@solidjs/web";

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

export function Icon(props: { svg: string; class?: JSX.ClassValue; strokeWidth?: number }) {
  const html = createMemo(() =>
    props.svg
      .replace(/\swidth="24"/, "")
      .replace(/\sheight="24"/, "")
      .replace(/stroke-width="2"/, `stroke-width="${props.strokeWidth ?? 2}"`),
  );
  return <span class={["inline-flex shrink-0 [&>svg]:h-full [&>svg]:w-full", props.class ?? "size-4"]} innerHTML={html()} />;
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type Variant = "default" | "secondary" | "ghost" | "outline" | "destructive" | "link";
type Size = "default" | "sm" | "xs" | "icon" | "icon-sm" | "lg";

const VARIANTS: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  outline: "border bg-transparent hover:bg-accent dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
  destructive: "bg-destructive text-white hover:bg-destructive/90",
  link: "text-primary underline-offset-4 hover:underline",
};
const SIZES: Record<Size, string> = {
  default: "h-9 px-4 py-2 text-sm",
  sm: "h-8 rounded-md gap-1.5 px-3 text-sm",
  xs: "h-6 rounded-md gap-1 px-2 text-xs",
  lg: "h-10 rounded-md px-6 text-sm",
  icon: "size-9",
  "icon-sm": "size-7",
};

export function Button(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size },
) {
  return (
    <button
      type="button"
      {...props}
      class={[
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-all disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        VARIANTS[props.variant ?? "default"],
        SIZES[props.size ?? "default"],
        props.class,
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Floating positioning helper
// ---------------------------------------------------------------------------

export type Side = "top" | "bottom" | "left" | "right";

function place(anchor: DOMRect, el: HTMLElement, side: Side, align: "start" | "center" | "end", gap = 6) {
  const r = el.getBoundingClientRect();
  let x = 0;
  let y = 0;
  if (side === "top" || side === "bottom") {
    y = side === "top" ? anchor.top - r.height - gap : anchor.bottom + gap;
    x =
      align === "start"
        ? anchor.left
        : align === "end"
          ? anchor.right - r.width
          : anchor.left + anchor.width / 2 - r.width / 2;
  } else {
    x = side === "left" ? anchor.left - r.width - gap : anchor.right + gap;
    y =
      align === "start"
        ? anchor.top
        : align === "end"
          ? anchor.bottom - r.height
          : anchor.top + anchor.height / 2 - r.height / 2;
  }
  x = Math.max(6, Math.min(window.innerWidth - r.width - 6, x));
  y = Math.max(6, Math.min(window.innerHeight - r.height - 6, y));
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export function Tooltip(props: ParentProps<{ content: JSX.Element; side?: Side; delay?: number; class?: string }>) {
  const [open, setOpen] = createSignal(false);
  const [anchor, setAnchor] = createSignal<DOMRect>();
  let timer: number | undefined;
  let trigger!: HTMLSpanElement;
  const show = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      setAnchor(trigger.getBoundingClientRect());
      setOpen(true);
    }, props.delay ?? 300);
  };
  const hide = () => {
    clearTimeout(timer);
    setOpen(false);
  };
  return (
    <>
      <span
        ref={trigger}
        class={props.class ?? "inline-flex"}
        onPointerEnter={show}
        onPointerLeave={hide}
        onPointerDown={hide}
      >
        {props.children}
      </span>
      <Show when={open() && anchor()}>
        {(a) => (
          <Portal>
            <div
              class="pointer-events-none fixed left-0 top-0 z-[100] rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground shadow-md animate-in fade-in"
              ref={(el) => requestAnimationFrame(() => place(a(), el, props.side ?? "top", "center"))}
            >
              {props.content}
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
}

// ---------------------------------------------------------------------------
// Popover / dropdown menu
// ---------------------------------------------------------------------------

export function Popover(
  props: ParentProps<{
    open: boolean;
    onClose: () => void;
    anchor?: DOMRect;
    /**
     * Element that toggles this popover. Presses on it are not treated as
     * "outside" clicks, so its own click handler can close the popover cleanly
     * instead of the popover closing and the click reopening it.
     */
    trigger?: Element | null;
    side?: Side;
    align?: "start" | "center" | "end";
    class?: string;
  }>,
) {
  let el: HTMLDivElement | undefined;
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      const onDown = (e: PointerEvent) => {
        const target = e.target as Node;
        if (props.trigger?.contains(target)) return;
        if (el && !el.contains(target)) props.onClose();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") props.onClose();
      };
      const t = setTimeout(() => window.addEventListener("pointerdown", onDown, true));
      window.addEventListener("keydown", onKey, true);
      return () => {
        clearTimeout(t);
        window.removeEventListener("pointerdown", onDown, true);
        window.removeEventListener("keydown", onKey, true);
      };
    },
  );
  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={(e) => {
            el = e;
            requestAnimationFrame(() => {
              if (props.anchor) place(props.anchor, e, props.side ?? "bottom", props.align ?? "start");
            });
          }}
          role="menu"
          class={[
            "fixed left-0 top-0 z-[90] min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
            props.class,
          ]}
        >
          {props.children}
        </div>
      </Portal>
    </Show>
  );
}

/** Anchor state for a popover opened by a toggle button. */
export interface PopoverAnchor {
  rect: DOMRect;
  el: HTMLElement;
}

/** Click handler for a popover toggle button: opens when closed, closes when open. */
export function togglePopover(current: PopoverAnchor | null, set: (a: PopoverAnchor | null) => void, e: MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  set(current?.el === el ? null : { rect: el.getBoundingClientRect(), el });
}

export function MenuItem(
  props: ParentProps<{ onSelect: () => void; icon?: string; shortcut?: string; destructive?: boolean; disabled?: boolean }>,
) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      class={[
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent disabled:opacity-50",
        { "text-destructive": !!props.destructive },
      ]}
      onClick={() => props.onSelect()}
    >
      <Show when={props.icon}>{(i) => <Icon svg={i()} class="size-4 text-muted-foreground" />}</Show>
      <span class="flex-1">{props.children}</span>
      <Show when={props.shortcut}>
        <span class="ml-auto text-xs tracking-widest text-muted-foreground">{props.shortcut}</span>
      </Show>
    </button>
  );
}

export function MenuLabel(props: ParentProps) {
  return <div class="px-2 py-1.5 text-xs font-medium text-muted-foreground">{props.children}</div>;
}

export function MenuSeparator() {
  return <div class="-mx-1 my-1 h-px bg-border" />;
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function Dialog(
  props: ParentProps<{
    open: boolean;
    onClose: () => void;
    title?: JSX.Element;
    description?: JSX.Element;
    class?: string;
    hideClose?: boolean;
  }>,
) {
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      };
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    },
  );
  return (
    <Show when={props.open}>
      <Portal>
        <div class="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" data-state="open">
          <div class="absolute inset-0 bg-black/60" onClick={() => props.onClose()} />
          <div
            class={[
              "relative z-10 flex max-h-[90vh] w-full flex-col gap-4 rounded-lg border bg-card p-6 text-card-foreground shadow-lg",
              props.class?.includes("max-w-") ? "" : "max-w-lg",
              props.class,
            ]}
          >
            <Show when={props.title}>
              <div class="flex flex-col gap-1.5 pr-6">
                <h2 class="text-lg font-semibold leading-none">{props.title}</h2>
                <Show when={props.description}>
                  <p class="text-sm text-muted-foreground">{props.description}</p>
                </Show>
              </div>
            </Show>
            <Show when={!props.hideClose}>
              <button
                type="button"
                class="absolute right-4 top-4 rounded-xs opacity-70 transition-opacity hover:opacity-100"
                onClick={() => props.onClose()}
                aria-label="Close"
              >
                <Icon svg={X_SVG} class="size-4" />
              </button>
            </Show>
            {props.children}
          </div>
        </div>
      </Portal>
    </Show>
  );
}

const X_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      class={[
        "h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30",
        props.class,
      ]}
    />
  );
}

export function Textarea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      class={[
        "w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30",
        props.class,
      ]}
    />
  );
}

export function Checkbox(props: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={props.checked ? "true" : "false"}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      class={[
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input shadow-xs transition-colors disabled:opacity-50 dark:bg-input/30",
        { "!border-blue-500 !bg-blue-500 text-white": props.checked },
      ]}
    >
      <Show when={props.checked}>
        <svg viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="3">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </Show>
    </button>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked ? "true" : "false"}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
      class={[
        "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-transparent transition-colors",
        props.checked ? "bg-primary" : "bg-input dark:bg-input/80",
      ]}
    >
      <span
        class={[
          "block size-4 rounded-full bg-background shadow-sm transition-transform",
          props.checked ? "translate-x-[14px]" : "translate-x-0",
        ]}
      />
    </button>
  );
}

export function Select(props: {
  value: string | number;
  options: { label: string; value: string | number }[];
  onChange: (v: string) => void;
  class?: string;
}) {
  return (
    <select
      value={String(props.value)}
      onChange={(e) => props.onChange(e.currentTarget.value)}
      class={[
        "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30 [&>option]:bg-popover",
        props.class,
      ]}
    >
      <For each={props.options}>{(o) => <option value={String(o.value)}>{o.label}</option>}</For>
    </select>
  );
}

/** Numeric input with horizontal drag-to-scrub on the label area. */
export function NumberField(props: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  label?: string;
  class?: string;
}) {
  const [text, setText] = createSignal<string | null>(null);
  const clamp = (v: number) => {
    let n = v;
    if (props.min !== undefined) n = Math.max(props.min, n);
    if (props.max !== undefined) n = Math.min(props.max, n);
    return props.integer ? Math.round(n) : Math.round(n * 1e5) / 1e5;
  };
  const startScrub = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const start = props.value;
    const step = props.step ?? (props.integer ? 1 : 0.01);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 2) moved = true;
      if (moved) props.onChange(clamp(start + Math.round(dx / 2) * step * (ev.shiftKey ? 10 : 1)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) props.onCommit?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div class={["flex h-7 items-center overflow-hidden rounded-md border border-input bg-transparent text-xs dark:bg-input/30", props.class]}>
      <Show when={props.label}>
        <span
          class="flex h-full shrink-0 cursor-ew-resize select-none items-center border-r border-input px-1.5 font-mono text-[10px] whitespace-nowrap uppercase text-muted-foreground"
          onPointerDown={startScrub}
        >
          {props.label}
        </span>
      </Show>
      <input
        class="h-full w-full min-w-0 bg-transparent px-1.5 font-mono tabular-nums outline-none"
        inputmode="decimal"
        value={text() ?? String(props.value)}
        onFocus={(e) => setText(e.currentTarget.value)}
        onInput={(e) => {
          setText(e.currentTarget.value);
          const n = Number(e.currentTarget.value);
          if (e.currentTarget.value.trim() !== "" && Number.isFinite(n)) props.onChange(clamp(n));
        }}
        onBlur={() => {
          setText(null);
          props.onCommit?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const step = (props.step ?? (props.integer ? 1 : 0.1)) * (e.shiftKey ? 10 : 1);
            props.onChange(clamp(props.value + (e.key === "ArrowUp" ? step : -step)));
            setText(null);
          }
        }}
      />
    </div>
  );
}

export function Slider(props: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range"
      class="h-1.5 w-full cursor-pointer accent-blue-500"
      min={props.min}
      max={props.max}
      step={props.step ?? 0.01}
      value={props.value}
      onInput={(e) => props.onChange(Number(e.currentTarget.value))}
    />
  );
}

// ---------------------------------------------------------------------------
// Color picker (saturation/value square + hue strip + hex), like the original
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

export function ColorPicker(props: { value: string; onChange: (hex: string) => void; onCommit?: () => void }) {
  const hsv = createMemo(() => rgbToHsv(...hexToRgb(props.value || "#ffffff")));
  // hue is kept locally so it survives passing through greys
  const [hue, setHue] = createSignal<number | null>(null);
  const h = () => hue() ?? hsv()[0];
  const [text, setText] = createSignal<string | null>(null);

  const drag = (el: HTMLElement, fn: (x: number, y: number) => void) => (e: PointerEvent) => {
    const rect = el.getBoundingClientRect();
    const apply = (ev: PointerEvent) =>
      fn(
        Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)),
        Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height)),
      );
    apply(e);
    const up = () => {
      window.removeEventListener("pointermove", apply);
      window.removeEventListener("pointerup", up);
      props.onCommit?.();
    };
    window.addEventListener("pointermove", apply);
    window.addEventListener("pointerup", up);
  };

  let sv!: HTMLDivElement;
  let hueBar!: HTMLDivElement;
  return (
    <div class="flex flex-col gap-2">
      <div
        ref={sv}
        class="relative h-28 w-full cursor-crosshair rounded-md"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h()} 100% 50%))`,
        }}
        onPointerDown={(e) =>
          drag(sv, (x, y) => {
            setHue(h());
            props.onChange(rgbToHex(...hsvToRgb(h(), x, 1 - y)));
          })(e)
        }
      >
        <div
          class="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${hsv()[1] * 100}%`, top: `${(1 - hsv()[2]) * 100}%` }}
        />
      </div>
      <div
        ref={hueBar}
        class="relative h-2.5 w-full cursor-pointer rounded-full"
        style={{
          background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
        }}
        onPointerDown={(e) =>
          drag(hueBar, (x) => {
            const nh = x * 359.9;
            setHue(nh);
            props.onChange(rgbToHex(...hsvToRgb(nh, hsv()[1], hsv()[2])));
          })(e)
        }
      >
        <div
          class="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${(h() / 360) * 100}%` }}
        />
      </div>
      <div class="flex items-center gap-2">
        <div class="size-7 shrink-0 rounded-md border" style={{ background: props.value }} />
        <Input
          class="h-7 font-mono text-xs uppercase"
          value={text() ?? props.value.toUpperCase()}
          onInput={(e) => {
            const v = e.currentTarget.value.trim();
            setText(v);
            if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
              setHue(null);
              props.onChange(v.startsWith("#") ? v.toLowerCase() : `#${v.toLowerCase()}`);
            }
          }}
          onBlur={() => {
            setText(null);
            props.onCommit?.();
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function Tabs<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: JSX.Element }[];
  class?: string;
}) {
  return (
    <div class={["inline-flex h-8 items-center rounded-lg bg-muted p-[3px] text-muted-foreground", props.class]}>
      <For each={props.tabs}>
        {(t) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.value === t.value ? "true" : "false"}
            onClick={() => props.onChange(t.value)}
            class={[
              "inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium whitespace-nowrap transition-colors",
              props.value === t.value
                ? "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30"
                : "hover:text-foreground",
            ]}
          >
            {t.label}
          </button>
        )}
      </For>
    </div>
  );
}

export function Kbd(props: ParentProps) {
  return (
    <kbd class="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
      {props.children}
    </kbd>
  );
}

/** Run once after mount with cleanup (component-level lifecycle). */
export function useMount(fn: () => void | (() => void)) {
  onSettled(fn);
}
