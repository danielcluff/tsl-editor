import { For, Show, createEffect, createSignal, onSettled, snapshot, useContext } from "solid-js";
import { Camera, Maximize2, Minimize2, SlidersHorizontal } from "lucide-static";
import type { GeometryKind, PreviewSettings } from "../../core/types";
import { resolveSettings } from "../../core/graph";
import { ENVIRONMENTS, PreviewRenderer } from "../../runtime/preview";
import { Button, Dialog, Icon, NumberField, Popover, Select, Slider, Switch, Tooltip, togglePopover, type PopoverAnchor } from "../ui";
import { CodeEditor } from "./CodeEditor";
import { EditorContext } from "./store";
import { ui } from "./ui-state";

const GEOMETRIES: { value: GeometryKind; label: string }[] = [
  { value: "sphere", label: "Sphere" },
  { value: "box", label: "Box" },
  { value: "torus", label: "Torus" },
  { value: "torusKnot", label: "Torus Knot" },
  { value: "plane", label: "Plane" },
  { value: "cylinder", label: "Cylinder" },
  { value: "icosahedron", label: "Icosahedron" },
  { value: "script", label: "Custom Script" },
];

const PARAMS: Record<string, { key: string; label: string; def: number; int?: boolean }[]> = {
  sphere: [
    { key: "radius", label: "Radius", def: 1.2 },
    { key: "widthSegments", label: "Segments W", def: 64, int: true },
    { key: "heightSegments", label: "Segments H", def: 64, int: true },
  ],
  box: [
    { key: "width", label: "W", def: 1.6 },
    { key: "height", label: "H", def: 1.6 },
    { key: "depth", label: "D", def: 1.6 },
    { key: "segments", label: "Segments", def: 1, int: true },
  ],
  torus: [
    { key: "radius", label: "Radius", def: 1 },
    { key: "tube", label: "Tube", def: 0.4 },
    { key: "tubularSegments", label: "Seg T", def: 96, int: true },
    { key: "radialSegments", label: "Seg R", def: 32, int: true },
  ],
  torusKnot: [
    { key: "radius", label: "Radius", def: 0.8 },
    { key: "tube", label: "Tube", def: 0.28 },
    { key: "tubularSegments", label: "Seg T", def: 160, int: true },
    { key: "radialSegments", label: "Seg R", def: 24, int: true },
  ],
  plane: [
    { key: "width", label: "W", def: 2.4 },
    { key: "height", label: "H", def: 2.4 },
    { key: "widthSegments", label: "Seg W", def: 64, int: true },
    { key: "heightSegments", label: "Seg H", def: 64, int: true },
  ],
  cylinder: [
    { key: "radiusTop", label: "Top", def: 0.8 },
    { key: "radiusBottom", label: "Bot", def: 0.8 },
    { key: "height", label: "Height", def: 2 },
    { key: "radialSegments", label: "Seg R", def: 48, int: true },
    { key: "heightSegments", label: "Seg H", def: 1, int: true },
  ],
  icosahedron: [
    { key: "radius", label: "Radius", def: 1.2 },
    { key: "detail", label: "Detail", def: 0, int: true },
  ],
};

const DEFAULT_SCRIPT = `// Return a THREE.BufferGeometry. \`THREE\` is in scope.
const geometry = new THREE.TorusKnotGeometry(0.8, 0.25, 200, 32);
return geometry;`;

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
    preview.onError = (errs) => ed.setState((s) => void (s.runtimeErrors = errs));
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
      const errors = preview.apply(result.runtime.material, result.post.connected && enablePost ? result.runtime.post : null);
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

  // debug thumbnails
  createEffect(
    () => {
      ui.debugVersion();
      return ed
        .graph()
        .nodes.filter((n) => n.data.debug)
        .map((n) => ({ id: n.id, type: ed.types().get(n.id)?.out.out ?? Object.values(ed.types().get(n.id)?.out ?? {})[0] ?? "vec3" }));
    },
    (list) => {
      if (!preview) return;
      const map = new Map<string, { canvas: HTMLCanvasElement; type: string }>();
      for (const d of list) {
        const c = ui.debugCanvases.get(d.id);
        if (c?.isConnected) map.set(d.id, { canvas: c, type: d.type });
      }
      preview.setDebugTargets(map);
    },
  );

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

  const errors = () => [
    ...ed
      .diagnostics()
      .filter((d) => d.level === "error" || d.message.startsWith("Post:"))
      .map((d) => (d.graph === "post" && !d.message.startsWith("Post") ? `Post: ${d.message}` : d.message)),
    ...ed.state.runtimeErrors,
  ];

  return (
    <div
      class={[
        "shrink-0 overflow-hidden rounded-lg border bg-card",
        // one position class only: `relative` is emitted after `fixed` and would win
        // expanded: fill everything left of the inspector column (300px wide + 8px gap + 8px padding),
        // which then takes the full height on the right
        ui.previewExpanded() ? "fixed top-2 bottom-2 left-2 right-[316px] z-40 shadow-2xl" : "relative h-[300px]",
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
        <div class="thin-scroll absolute right-2 bottom-2 left-2 max-h-[45%] overflow-y-auto rounded-md bg-red-500/85 px-2.5 py-1.5 text-[11px] leading-relaxed text-white shadow">
          <For each={errors()}>{(e) => <div class="break-words">{e}</div>}</For>
        </div>
      </Show>

      <Popover open={!!settingsAnchor()} anchor={settingsAnchor()?.rect} trigger={settingsAnchor()?.el} align="end" onClose={() => setSettingsAnchor(null)} class="thin-scroll max-h-[80vh] w-72 overflow-y-auto p-3">
        <div class="mb-3 text-sm font-semibold">Preview Settings</div>
        <div class="flex flex-col gap-3 text-xs">
          <Row label="Geometry">
            <Select
              class="h-7 text-xs"
              value={ed.state.doc.settings.geometry}
              options={GEOMETRIES}
              onChange={(v) => {
                setSetting("geometry", v as GeometryKind);
                setSetting("geometryParams", {});
                if (v === "script" && !ed.state.doc.settings.geometryScript) setSetting("geometryScript", DEFAULT_SCRIPT);
              }}
            />
          </Row>
          <Show when={PARAMS[ed.state.doc.settings.geometry]}>
            {(params) => (
              <div class="grid grid-cols-2 gap-1.5">
                <For each={params()}>
                  {(p) => (
                    <NumberField
                      label={p.label}
                      integer={p.int}
                      min={p.int ? 0 : 0.01}
                      value={Number(ed.state.doc.settings.geometryParams[p.key] ?? p.def)}
                      onChange={(v) => setSetting("geometryParams", { ...ed.state.doc.settings.geometryParams, [p.key]: v })}
                    />
                  )}
                </For>
                <Show when={ed.state.doc.settings.geometry === "cylinder"}>
                  <label class="col-span-2 flex items-center justify-between">
                    Open Ended
                    <Switch
                      checked={Boolean(ed.state.doc.settings.geometryParams.openEnded)}
                      onChange={(v) => setSetting("geometryParams", { ...ed.state.doc.settings.geometryParams, openEnded: v })}
                    />
                  </label>
                </Show>
              </div>
            )}
          </Show>
          <Show when={ed.state.doc.settings.geometry === "script"}>
            <Button size="xs" variant="outline" onClick={() => setScriptOpen(true)}>
              Edit Geometry Script
            </Button>
            <Show when={preview?.geometryError}>
              <div class="text-destructive">Geometry script error: {preview?.geometryError}</div>
            </Show>
          </Show>
          <Row label="Environment">
            <Select
              class="h-7 text-xs"
              value={ed.state.doc.settings.environment}
              options={ENVIRONMENTS.map((e) => ({ value: e.value, label: e.label }))}
              onChange={(v) => setSetting("environment", v)}
            />
          </Row>
          <Row label={`Intensity (${ed.state.doc.settings.envIntensity.toFixed(2)})`}>
            <Slider value={ed.state.doc.settings.envIntensity} min={0} max={3} onChange={(v) => setSetting("envIntensity", v)} />
          </Row>
          <Toggle label="Show Background" value={ed.state.doc.settings.showBackground} onChange={(v) => setSetting("showBackground", v)} />
          <Toggle label="Show Grid" value={ed.state.doc.settings.showGrid} onChange={(v) => setSetting("showGrid", v)} />
          <Toggle label="Enable Post-Processing" value={ed.state.doc.settings.enablePost} onChange={(v) => setSetting("enablePost", v)} />
          <Toggle label="Show Backdrop" value={ed.state.doc.settings.showBackdrop} onChange={(v) => setSetting("showBackdrop", v)} />
          <LightControls settings={resolveSettings(ed.state.doc.settings)} set={setSetting} />
          <Toggle label="Instancing" value={ed.state.doc.settings.instancing} onChange={(v) => setSetting("instancing", v)} />
          <Show when={ed.state.doc.settings.instancing}>
            <Row label="Instance Count">
              <NumberField integer min={1} max={100000} value={ed.state.doc.settings.instanceCount} onChange={(v) => setSetting("instanceCount", v)} />
            </Row>
          </Show>
          <Row label="Thumbnail">
            <div class="flex items-center gap-1.5">
              <Select
                class="h-7 text-xs"
                value={ed.state.doc.settings.thumbnail}
                options={[
                  { label: "Auto", value: "auto" },
                  { label: "Manual", value: "manual" },
                ]}
                onChange={(v) => setSetting("thumbnail", v as "auto" | "manual")}
              />
              <Button
                size="xs"
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
          </Row>
        </div>
      </Popover>

      <Dialog open={scriptOpen()} onClose={() => setScriptOpen(false)} title="Geometry Script" description="Runs with THREE in scope and must return a BufferGeometry." class="max-w-2xl">
        <GeometryScriptEditor
          value={ed.state.doc.settings.geometryScript ?? DEFAULT_SCRIPT}
          onSave={(v) => {
            setSetting("geometryScript", v);
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

function Row(props: { label: string; children: unknown }) {
  return (
    <div class="flex flex-col gap-1">
      <span class="text-muted-foreground">{props.label}</span>
      {props.children as never}
    </div>
  );
}

function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="flex items-center justify-between">
      {props.label}
      <Switch checked={props.value} onChange={props.onChange} />
    </label>
  );
}

function LightControls(props: {
  settings: PreviewSettings;
  set: <K extends keyof PreviewSettings>(key: K, value: PreviewSettings[K]) => void;
}) {
  const s = () => props.settings;
  return (
    <div class="-mx-3 flex flex-col gap-3 border-y px-3 py-3">
      <div class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">Light</div>
      <Toggle label="Directional Light" value={s().lightEnabled} onChange={(v) => props.set("lightEnabled", v)} />
      <Show when={s().lightEnabled}>
        <Row label={`Intensity (${s().lightIntensity.toFixed(2)})`}>
          <Slider value={s().lightIntensity} min={0} max={10} step={0.05} onChange={(v) => props.set("lightIntensity", v)} />
        </Row>
        <label class="flex items-center justify-between">
          Color
          <span class="flex items-center gap-2">
            <span class="font-mono text-[10px] text-muted-foreground uppercase">{s().lightColor}</span>
            <input
              type="color"
              aria-label="Light color"
              class="h-6 w-8 cursor-pointer rounded border bg-transparent p-0"
              value={s().lightColor}
              onInput={(e) => props.set("lightColor", e.currentTarget.value)}
            />
          </span>
        </label>
        <Row label={`Azimuth (${Math.round(s().lightAzimuth)}°)`}>
          <Slider value={s().lightAzimuth} min={-180} max={180} step={1} onChange={(v) => props.set("lightAzimuth", v)} />
        </Row>
        <Row label={`Elevation (${Math.round(s().lightElevation)}°)`}>
          <Slider value={s().lightElevation} min={-90} max={90} step={1} onChange={(v) => props.set("lightElevation", v)} />
        </Row>
        <Toggle label="Show Light Helper" value={s().showLightHelper} onChange={(v) => props.set("showLightHelper", v)} />
      </Show>
      <Row label={`Ambient (${s().ambientIntensity.toFixed(2)})`}>
        <Slider value={s().ambientIntensity} min={0} max={3} step={0.05} onChange={(v) => props.set("ambientIntensity", v)} />
      </Row>
    </div>
  );
}
