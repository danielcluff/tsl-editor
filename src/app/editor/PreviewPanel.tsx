import { For, Show, createEffect, createMemo, createSignal, onSettled, snapshot, untrack, useContext } from "solid-js";
import { Camera, CircleAlert, Crosshair, Maximize2, Minimize2, SlidersHorizontal } from "lucide-static";
import type { GeometryKind, GraphKind, PreviewSettings } from "../../core/types";
import { animatedNodes, hasPreview, nodePreviewOn, nodeSignatures, resolveSettings } from "../../core/graph";
import { getNodeDef } from "../../core/registry";
import { ENVIRONMENTS, PreviewRenderer } from "../../runtime/preview";
import { LIVE_PREVIEW_ZOOM } from "../../runtime/preview-size";
import { Button, Dialog, Icon, NumberField, Popover, Select, Slider, Switch, Tooltip, togglePopover, type PopoverAnchor } from "../ui";
import { CodeEditor } from "./CodeEditor";
import { EditorContext } from "./store";
import { ui } from "./ui-state";

// the original's list, plus our Torus Knot and Icosahedron
const GEOMETRIES: { value: GeometryKind; label: string }[] = [
  { value: "sphere", label: "Sphere" },
  { value: "box", label: "Box" },
  { value: "torus", label: "Torus" },
  { value: "torusKnot", label: "Torus Knot" },
  { value: "plane", label: "Plane" },
  { value: "fullscreenQuad", label: "Fullscreen Quad" },
  { value: "cylinder", label: "Cylinder" },
  { value: "icosahedron", label: "Icosahedron" },
];

type ParamField = { key: string; def: number; int?: boolean; legacy?: string };
/** One settings row per entry, labelled like the original (e.g. "Segments (W/H)"). */
const PARAMS: Record<string, { label: string; fields: ParamField[] }[]> = {
  sphere: [
    { label: "Radius", fields: [{ key: "radius", def: 1.2 }] },
    { label: "Segments (W/H)", fields: [{ key: "widthSegments", def: 64, int: true }, { key: "heightSegments", def: 64, int: true }] },
  ],
  box: [
    { label: "Size (W/H/D)", fields: [{ key: "width", def: 1.6 }, { key: "height", def: 1.6 }, { key: "depth", def: 1.6 }] },
    {
      label: "Segments",
      fields: [
        { key: "widthSegments", def: 1, int: true, legacy: "segments" },
        { key: "heightSegments", def: 1, int: true, legacy: "segments" },
        { key: "depthSegments", def: 1, int: true, legacy: "segments" },
      ],
    },
  ],
  torus: [
    { label: "Radius", fields: [{ key: "radius", def: 1 }] },
    { label: "Tube", fields: [{ key: "tube", def: 0.4 }] },
    { label: "Segments (T/R)", fields: [{ key: "tubularSegments", def: 96, int: true }, { key: "radialSegments", def: 32, int: true }] },
  ],
  torusKnot: [
    { label: "Radius", fields: [{ key: "radius", def: 0.8 }] },
    { label: "Tube", fields: [{ key: "tube", def: 0.28 }] },
    { label: "Segments (T/R)", fields: [{ key: "tubularSegments", def: 160, int: true }, { key: "radialSegments", def: 24, int: true }] },
  ],
  plane: [
    { label: "Size (W/H)", fields: [{ key: "width", def: 2.4 }, { key: "height", def: 2.4 }] },
    { label: "Segments (W/H)", fields: [{ key: "widthSegments", def: 64, int: true }, { key: "heightSegments", def: 64, int: true }] },
  ],
  cylinder: [
    { label: "Radius (Top/Bot)", fields: [{ key: "radiusTop", def: 0.8 }, { key: "radiusBottom", def: 0.8 }] },
    { label: "Height", fields: [{ key: "height", def: 2 }] },
    { label: "Segments (R/H)", fields: [{ key: "radialSegments", def: 48, int: true }, { key: "heightSegments", def: 1, int: true }] },
  ],
  icosahedron: [
    { label: "Radius", fields: [{ key: "radius", def: 1.2 }] },
    { label: "Detail", fields: [{ key: "detail", def: 0, int: true }] },
  ],
};

const FPS_OPTIONS = [30, 60, 90, 120, 144, 240];
const FPS_KEY = "tsl.previewFps";

function readFpsPreference(): number {
  try {
    const v = Number(localStorage.getItem(FPS_KEY));
    if (FPS_OPTIONS.includes(v)) return v;
  } catch {
    // storage unavailable
  }
  return 60;
}

export function PreviewPanel(props: { onReady?: (p: PreviewRenderer) => void }) {
  const ed = useContext(EditorContext);
  let host!: HTMLDivElement;
  let preview: PreviewRenderer | undefined;
  const [settingsAnchor, setSettingsAnchor] = createSignal<PopoverAnchor | null>(null);
  const [scriptOpen, setScriptOpen] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const [backend, setBackend] = createSignal("");
  const [initError, setInitError] = createSignal<string | null>(null);

  onSettled(() => {
    preview = new PreviewRenderer(host, resolveSettings(snapshot(ed.state.doc.settings) as PreviewSettings));
    if (import.meta.env.DEV) (window as unknown as { __tslPreview: unknown }).__tslPreview = preview;
    preview.onError = (errs) => ed.setState((s) => void (s.runtimeErrors = errs));
    preview.onDebugStats = (id, stats, pixels) => ui.setDebugStats(id, stats, pixels);
    preview.setDebugLive(untrack(livePreviews));
    preview.setMainAnimated(untrack(mainAnimated));
    preview.setMaxFps(untrack(maxFps));
    preview.ready
      .then(() => {
        setReady(true);
        setBackend(preview!.backend);
        props.onReady?.(preview!);
      })
      .catch((err) => setInitError(err instanceof Error ? err.message : String(err)));

    // three logs shader/node build failures through console.error; surface them
    const origError = console.error;
    const origWarn = console.warn;
    const capture = (args: unknown[]) => {
      const msg = args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : "")).join(" ").trim();
      if (msg && /THREE|WGSL|GLSL|shader|Node/i.test(msg) && !/deprecated/i.test(msg)) {
        // may be logged from inside a reactive computation: write later
        queueMicrotask(() =>
          ed.setState((s) => {
            if (!s.runtimeErrors.includes(msg)) s.runtimeErrors = [...s.runtimeErrors, msg.slice(0, 400)];
          }),
        );
      }
    };
    console.error = (...args: unknown[]) => {
      capture(args);
      origError(...args);
    };
    console.warn = (...args: unknown[]) => {
      if (args.some((a) => typeof a === "string" && /TSL|NodeBuilder|shader/i.test(a))) capture(args);
      origWarn(...args);
    };
    return () => {
      console.error = origError;
      console.warn = origWarn;
      preview?.dispose();
    };
  });

  // Escape leaves the expanded view
  createEffect(
    () => ui.previewExpanded(),
    (expanded) => {
      if (!expanded) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        ui.setPreviewExpanded(false);
      };
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    },
  );

  // apply compiled graph
  createEffect(
    () => [ed.compiled(), ready(), ed.state.doc.settings.enablePost] as const,
    ([result, isReady, enablePost]) => {
      if (!result || !isReady || !preview) return;
      // per-node signatures let unchanged previews keep their shaders across recompiles
      const signatures = untrack(() => nodeSignatures(ed.state.doc, ed.state.doc.graphs.material));
      const errors = preview.apply(result.runtime.material, result.post.connected && enablePost ? result.runtime.post : null, signatures);
      ed.setState((s) => void (s.runtimeErrors = errors));
    },
  );

  // settings
  createEffect(
    () => JSON.stringify(ed.state.doc.settings),
    (json) => {
      if (!preview || !ready()) return;
      preview.applySettings(resolveSettings(JSON.parse(json)));
    },
  );

  // Frame-rate cap for the main view. A per-browser preference (it depends on the display),
  // not a project setting.
  const [maxFps, setMaxFpsSignal] = createSignal(readFpsPreference());
  const setMaxFps = (fps: number) => {
    setMaxFpsSignal(fps);
    try {
      localStorage.setItem(FPS_KEY, String(fps));
    } catch {
      // storage unavailable: the choice lasts for this session
    }
  };
  createEffect(maxFps, (fps) => preview?.setMaxFps(fps));

  // The main view only redraws every frame when what it shows can change by itself: the
  // material depends on time (or similar), or post-processing runs effects (some, like
  // afterimage or TRAA, depend on previous frames, so any effect counts). Otherwise it
  // redraws on edits and camera movement only.
  const mainAnimated = createMemo(() => {
    const doc = ed.state.doc;
    const mat = doc.graphs.material.nodes.find((n) => getNodeDef(n.type)?.kind === "material");
    if (mat && animatedNodes(doc, doc.graphs.material).has(mat.id)) return true;
    if (!doc.settings.enablePost) return false;
    return doc.graphs.post.nodes.some((n) => !["postInput", "postOutput", "comment", "group"].includes(getNodeDef(n.type)?.kind ?? ""));
  });
  createEffect(mainAnimated, (animated) => preview?.setMainAnimated(animated));

  // node previews animate only when zoomed in enough to read them (see LIVE_PREVIEW_ZOOM)
  const livePreviews = () => ed.viewport().zoom >= LIVE_PREVIEW_ZOOM;
  createEffect(livePreviews, (live) => preview?.setDebugLive(live));

  // debug thumbnails
  createEffect(
    () => {
      ui.debugVersion();
      if (ed.state.graph !== "material") return [];
      return ed
        .graph()
        .nodes.filter((n) => nodePreviewOn(ed.state.doc, n) && hasPreview(n.type))
        .map((n) => ({
          id: n.id,
          type: ed.types().get(n.id)?.out.out ?? Object.values(ed.types().get(n.id)?.out ?? {})[0] ?? "vec3",
          // math nodes show a value readout (see NodeCard)
          values: getNodeDef(n.type)?.category === "Math",
          animated: ed.animated().has(n.id),
        }));
    },
    (list) => {
      if (!preview) return;
      const map = new Map<string, { canvas: HTMLCanvasElement; type: string; values?: boolean; animated?: boolean }>();
      for (const d of list) {
        const c = ui.debugCanvases.get(d.id);
        if (c?.isConnected) map.set(d.id, { canvas: c, type: d.type, values: d.values, animated: d.animated });
      }
      preview.setDebugTargets(map);
    },
  );

  const settings = () => ed.state.doc.settings;
  const setSetting = <K extends keyof PreviewSettings>(key: K, value: PreviewSettings[K]) =>
    ed.mutate((doc) => void (doc.settings[key] = value), { history: false, recompile: false });

  const snapshotImage = async () => {
    if (!preview) return;
    const url = await preview.snapshot();
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ed.state.doc.name.replace(/[^\w-]+/g, "_") || "preview"}.png`;
    a.click();
  };

  type PreviewError = { message: string; nodeId?: string; graph?: GraphKind };
  const errors = (): PreviewError[] => [
    ...ed
      .diagnostics()
      .filter((d) => d.level === "error" || d.message.startsWith("Post:"))
      .map((d) => ({
        message: d.graph === "post" && !d.message.startsWith("Post") ? `Post: ${d.message}` : d.message,
        nodeId: d.nodeId,
        graph: d.graph,
      })),
    ...ed.state.runtimeErrors.map((message) => ({ message })),
  ];

  const focusError = (e: PreviewError) => {
    if (!e.nodeId) return;
    // the expanded preview covers the canvas
    if (ui.previewExpanded()) ui.setPreviewExpanded(false);
    ed.focusNode(e.nodeId, e.graph);
  };

  return (
    <div
      class={[
        "shrink-0 overflow-hidden rounded-xl border bg-card shadow-lg",
        // one position class only: `relative` is emitted after `fixed` and would win
        // expanded: fill everything left of the inspector column (288px wide + 8px gap + 16px inset),
        // which then takes the full height on the right
        ui.previewExpanded() ? "fixed top-4 bottom-4 left-4 right-[312px] z-40 shadow-2xl" : "relative h-72",
      ]}
      data-ui
    >
      <div ref={host} class="absolute inset-0" />
      <Show when={!ready() && !initError()}>
        <div class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Initializing WebGPU...</div>
      </Show>
      <Show when={initError()}>
        <div class="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-destructive">
          Could not start the renderer: {initError()}
        </div>
      </Show>
      <div class="absolute top-2 right-2 flex items-center gap-1">
        <Tooltip content={ui.previewExpanded() ? "Collapse" : "Expand"} side="bottom">
          <button
            type="button"
            class="flex size-7 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
            aria-label="Toggle expanded preview"
            onClick={() => ui.setPreviewExpanded(!ui.previewExpanded())}
          >
            <Icon svg={ui.previewExpanded() ? Minimize2 : Maximize2} class="size-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="Snapshot" side="bottom">
          <button
            type="button"
            title="Snapshot"
            aria-label="Snapshot"
            class="flex size-7 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
            onClick={() => void snapshotImage()}
          >
            <Icon svg={Camera} class="size-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="Preview settings" side="bottom">
          <button
            type="button"
            aria-label="Preview settings"
            class="flex size-7 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
            onClick={(e) => togglePopover(settingsAnchor(), setSettingsAnchor, e)}
          >
            <Icon svg={SlidersHorizontal} class="size-3.5" />
          </button>
        </Tooltip>
      </div>
      <Show when={backend()}>
        <div class="pointer-events-none absolute top-2.5 left-2.5 font-mono text-[9px] tracking-widest text-white/40 uppercase">{backend()}</div>
      </Show>
      <Show when={errors().length}>
        <div class="thin-scroll absolute right-2 bottom-2 left-2 flex max-h-[45%] flex-col gap-1 overflow-y-auto text-[11px] leading-snug text-white">
          <For each={errors()}>
            {(e) => (
              <Show
                when={e.nodeId}
                fallback={
                  <div class="flex items-start gap-1.5 rounded-md bg-red-500/85 px-2.5 py-1.5 shadow">
                    <Icon svg={CircleAlert} class="mt-px size-3 shrink-0" />
                    <span class="min-w-0 break-words">{e.message}</span>
                  </div>
                }
              >
                <button
                  type="button"
                  class="group flex w-full cursor-pointer items-start gap-1.5 rounded-md bg-red-500/85 px-2.5 py-1.5 text-left shadow hover:bg-red-500"
                  title="Show node"
                  onClick={() => focusError(e)}
                >
                  <Icon svg={CircleAlert} class="mt-px size-3 shrink-0" />
                  <span class="min-w-0 flex-1 break-words">{e.message}</span>
                  <Icon svg={Crosshair} class="mt-px size-3 shrink-0 opacity-60 group-hover:opacity-100" />
                </button>
              </Show>
            )}
          </For>
        </div>
      </Show>

      <Popover
        open={!!settingsAnchor()}
        anchor={settingsAnchor()?.rect}
        trigger={settingsAnchor()?.el}
        align="end"
        onClose={() => setSettingsAnchor(null)}
        class="thin-scroll max-h-[80vh] w-80 overflow-y-auto p-4"
      >
        <div class="grid gap-4">
          <div class="space-y-2">
            <h4 class="leading-none font-medium">Preview Settings</h4>
            <p class="text-sm text-muted-foreground">Configure the preview geometry and instancing.</p>
          </div>
          <div class="grid gap-4">
            <Field label="Geometry">
              <Select
                class="h-9 px-3"
                value={settings().geometry === "script" ? "sphere" : settings().geometry}
                options={GEOMETRIES}
                onChange={(v) => {
                  setSetting("geometry", v as GeometryKind);
                  setSetting("geometryParams", {});
                }}
              />
            </Field>
            <Field label="Environment">
              <Select
                class="h-9 px-3"
                value={settings().environment}
                options={ENVIRONMENTS.map((e) => ({ value: e.value, label: e.label }))}
                onChange={(v) => setSetting("environment", v)}
              />
            </Field>
            <Show when={settings().environment !== "none"}>
              <Field label="Intensity">
                <NumberField class="h-8" min={0} max={10} step={0.01} value={settings().envIntensity} onChange={(v) => setSetting("envIntensity", v)} />
              </Field>
              <Check label="Show Background" value={settings().showBackground} onChange={(v) => setSetting("showBackground", v)} />
            </Show>
            <Check label="Show Grid" value={settings().showGrid} onChange={(v) => setSetting("showGrid", v)} />
            <Check label="Enable Post-Processing" value={settings().enablePost} onChange={(v) => setSetting("enablePost", v)} />
            <For each={PARAMS[settings().geometry] ?? []}>
              {(row) => (
                <Field label={row.label}>
                  <div class="flex gap-1">
                    <For each={row.fields}>
                      {(f) => (
                        <NumberField
                          class="h-8 min-w-0 flex-1"
                          integer={f.int}
                          min={f.int ? (f.key === "detail" ? 0 : 1) : 0.01}
                          value={Number(settings().geometryParams[f.key] ?? (f.legacy ? settings().geometryParams[f.legacy] : undefined) ?? f.def)}
                          onChange={(v) => setSetting("geometryParams", { ...settings().geometryParams, [f.key]: v })}
                        />
                      )}
                    </For>
                  </div>
                </Field>
              )}
            </For>
            <Show when={settings().geometry === "cylinder"}>
              <Check
                label="Open Ended"
                value={Boolean(settings().geometryParams.openEnded)}
                onChange={(v) => setSetting("geometryParams", { ...settings().geometryParams, openEnded: v })}
              />
            </Show>
            <div class="flex items-center justify-between">
              <span class="text-sm leading-none font-medium">Geometry Script</span>
              <Button size="sm" variant="outline" onClick={() => setScriptOpen(true)}>
                {settings().geometryScript?.trim() ? "Edit" : "Add"}
              </Button>
            </div>
            <Show when={preview?.geometryError && settings().geometryScript?.trim()}>
              <div class="-mt-2 text-xs text-destructive">Geometry script error: {preview?.geometryError}</div>
            </Show>
            <div class="my-1 h-px bg-border" />
            <Check label="Show Backdrop" value={settings().showBackdrop} onChange={(v) => setSetting("showBackdrop", v)} />
            <Check label="Instancing" value={settings().instancing} onChange={(v) => setSetting("instancing", v)} />
            <Show when={settings().instancing}>
              <Field label="Instance Count">
                <NumberField class="h-8" integer min={1} max={100000} value={settings().instanceCount} onChange={(v) => setSetting("instanceCount", v)} />
              </Field>
            </Show>
            {/* ours: frame rate, lighting and thumbnail controls (not in the original) */}
            <div class="my-1 h-px bg-border" />
            <Field label="Frame Rate">
              <Select
                class="h-9 px-3"
                value={maxFps()}
                options={FPS_OPTIONS.map((f) => ({ value: f, label: `${f} fps` }))}
                onChange={(v) => setMaxFps(Number(v))}
              />
            </Field>
            <LightControls settings={resolveSettings(ed.state.doc.settings)} set={setSetting} />
            <div class="my-1 h-px bg-border" />
            <Field label="Thumbnail">
              <Select
                class="h-9 px-3"
                value={settings().thumbnail}
                options={[
                  { label: "Auto", value: "auto" },
                  { label: "Manual", value: "manual" },
                ]}
                onChange={(v) => setSetting("thumbnail", v as "auto" | "manual")}
              />
            </Field>
            <div class="flex items-center justify-between">
              <span class="text-sm leading-none font-medium">Capture Thumbnail</span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const t = await preview?.thumbnail();
                  if (t) ed.mutate((doc) => void (doc.thumbnail = t), { history: false, recompile: false });
                  ui.toast("Thumbnail captured", "success");
                }}
              >
                Capture
              </Button>
            </div>
          </div>
        </div>
      </Popover>

      <Dialog
        open={scriptOpen()}
        onClose={() => setScriptOpen(false)}
        title="Geometry Script"
        description={
          <>
            Runs automatically on the preview geometry. Available variables: <code class="font-mono text-xs">geometry</code>,{" "}
            <code class="font-mono text-xs">THREE</code>.
          </>
        }
        class="max-w-2xl"
      >
        <GeometryScriptEditor
          value={ed.state.doc.settings.geometryScript ?? ""}
          onSave={(v) => {
            // an empty script removes it (the row goes back to "Add")
            setSetting("geometryScript", v.trim() ? v : undefined);
            setScriptOpen(false);
          }}
          onCancel={() => setScriptOpen(false)}
        />
      </Dialog>
    </div>
  );
}

function GeometryScriptEditor(props: { value: string; onSave: (v: string) => void; onCancel: () => void }) {
  let current = props.value;
  return (
    <>
      <div class="h-72 overflow-hidden rounded-md border">
        <CodeEditor value={props.value} onChange={(v) => (current = v)} />
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button onClick={() => props.onSave(current)}>Save</Button>
      </div>
    </>
  );
}

/** Label on the left, control filling the right column (the original's two-column rows). */
function Field(props: { label: string; children: unknown }) {
  return (
    <div class="grid grid-cols-2 items-center gap-4">
      <span class="text-sm leading-none font-medium">{props.label}</span>
      {props.children as never}
    </div>
  );
}

/** The original uses plain checkboxes for boolean settings. */
function Check(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="flex cursor-pointer items-center justify-between">
      <span class="text-sm leading-none font-medium select-none">{props.label}</span>
      <input type="checkbox" class="size-4 cursor-pointer rounded border-primary" checked={props.value} onChange={(e) => props.onChange(e.currentTarget.checked)} />
    </label>
  );
}

function LightControls(props: {
  settings: PreviewSettings;
  set: <K extends keyof PreviewSettings>(key: K, value: PreviewSettings[K]) => void;
}) {
  const s = () => props.settings;
  return (
    <>
      <Check label="Directional Light" value={s().lightEnabled} onChange={(v) => props.set("lightEnabled", v)} />
      <Show when={s().lightEnabled}>
        <Field label="Light Intensity">
          <NumberField class="h-8" min={0} max={20} step={0.05} value={s().lightIntensity} onChange={(v) => props.set("lightIntensity", v)} />
        </Field>
        <Field label="Light Color">
          <label class="flex h-8 items-center gap-2 rounded-md border border-input px-2 dark:bg-input/30">
            <input
              type="color"
              aria-label="Light color"
              class="size-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
              value={s().lightColor}
              onInput={(e) => props.set("lightColor", e.currentTarget.value)}
            />
            <span class="font-mono text-xs text-muted-foreground uppercase">{s().lightColor}</span>
          </label>
        </Field>
        <Field label={`Azimuth (${Math.round(s().lightAzimuth)}°)`}>
          <Slider value={s().lightAzimuth} min={-180} max={180} step={1} onChange={(v) => props.set("lightAzimuth", v)} />
        </Field>
        <Field label={`Elevation (${Math.round(s().lightElevation)}°)`}>
          <Slider value={s().lightElevation} min={-90} max={90} step={1} onChange={(v) => props.set("lightElevation", v)} />
        </Field>
        <Check label="Show Light Helper" value={s().showLightHelper} onChange={(v) => props.set("showLightHelper", v)} />
      </Show>
      <Field label="Ambient">
        <NumberField class="h-8" min={0} max={10} step={0.05} value={s().ambientIntensity} onChange={(v) => props.set("ambientIntensity", v)} />
      </Field>
    </>
  );
}
