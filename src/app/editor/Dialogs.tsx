import { For, Match, Show, Switch, createMemo, createSignal, untrack, useContext } from "solid-js";
import { Check, Copy, Download } from "lucide-static";
import { nodeTitle } from "../../core/graph";
import { CATEGORY_HEADER, getNodeDef, typeColor } from "../../core/registry";
import { TEMPLATES, projectFromTemplate } from "../../core/templates";
import type { CodeNodeData } from "../../core/types";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import { McpDialog } from "../pages/Dashboard";
import { Button, Checkbox, Dialog, Icon, Input, Select, Tabs } from "../ui";
import { CodeEditor } from "./CodeEditor";
import { SHORTCUT_LIST } from "./shortcuts";
import { EditorContext, type Editor } from "./store";
import { ui } from "./ui-state";

export function Dialogs(props: { persist: boolean }) {
  return (
    <>
      <CodeViewDialog />
      <CodeNodeDialog />
      <HelpDialog />
      <ImageExportDialog />
      <ClearDialog />
      <ShareDialog persist={props.persist} />
      <McpDialog open={ui.dialog() === "mcp"} onClose={ui.closeDialog} />
    </>
  );
}

function CopyButton(props: { text: () => string }) {
  const [done, setDone] = createSignal(false);
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard?.writeText(props.text());
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      <Icon svg={done() ? Check : Copy} class="size-3" /> {done() ? "Copied" : "Copy"}
    </Button>
  );
}

// ---------------------------------------------------------------------------

function CodeViewDialog() {
  const ed = useContext(EditorContext);
  const code = () => ed.compiled()?.code ?? "";
  const count = () => ed.state.doc.graphs.material.nodes.length + ed.state.doc.graphs.post.nodes.length;
  return (
    <Dialog
      open={ui.dialog() === "code"}
      onClose={ui.closeDialog}
      title={
        <div>
          TSL Output
          <div class="mt-1 text-xs font-normal text-muted-foreground">({count()} nodes)</div>
        </div>
      }
      class="h-[85vh] max-w-4xl"
    >
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
        <div class="flex items-center justify-end gap-1 border-b bg-[#282c34] px-2 py-1">
          <Button
            size="xs"
            variant="ghost"
            class="text-white/80 hover:text-white"
            onClick={() => {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([code()], { type: "text/javascript" }));
              a.download = `${ed.state.doc.name.replace(/[^\w-]+/g, "_") || "shader"}.js`;
              a.click();
            }}
          >
            <Icon svg={Download} class="size-3" /> Download
          </Button>
          <CopyButton text={code} />
        </div>
        <div class="min-h-0 flex-1 bg-[#282c34]">
          <Show when={ui.dialog() === "code"}>
            <CodeEditor value={code()} readonly />
          </Show>
        </div>
      </div>
      <Show when={ed.diagnostics().length}>
        <div class="thin-scroll max-h-24 overflow-y-auto rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <For each={ed.diagnostics()}>{(d) => <div>{d.level === "error" ? "✖" : "⚠"} {d.message}</div>}</For>
        </div>
      </Show>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

const TSL_HINT = `// TSL code node. Inputs are variables; return a node
// (or an object keyed by output names when there are several outputs).
// All three/tsl functions are in scope: mix, sin, uv, time, vec3, Fn, If, Loop…`;

const WGSL_HINT = `// WGSL function. Inputs are passed by name.
fn main(a: vec3f, b: vec3f) -> vec3f {
  return mix(a, b, 0.5);
}`;

function CodeNodeDialog() {
  const ed = useContext(EditorContext);
  const node = createMemo(() => {
    const id = ui.codeEditing();
    return id ? ed.nodesById().get(id) : undefined;
  });
  let draft = "";
  return (
    <Dialog open={!!node()} onClose={() => ui.editCode(null)} title="Code Node" class="h-[80vh] max-w-3xl">
      <Show when={node()}>
        {(n) => {
          const code = () => n().data.code as CodeNodeData;
          draft = untrack(() => code().source);
          const [lang, setLang] = createSignal(untrack(() => code().language));
          return (
            <>
              <div class="flex items-center gap-3 text-xs text-muted-foreground">
                <div class="w-44">
                  <Select
                    value={lang()}
                    options={[
                      { label: "TSL (JavaScript)", value: "tsl" },
                      { label: "WGSL", value: "wgsl" },
                    ]}
                    onChange={(v) => setLang(v as "tsl" | "wgsl")}
                  />
                </div>
                <span>
                  Inputs: <span class="font-mono">{code().inputs.map((i) => `${i.key}: ${i.type}`).join(", ") || "none"}</span> · Outputs:{" "}
                  <span class="font-mono">{code().outputs.map((o) => `${o.key}: ${o.type}`).join(", ") || "none"}</span>
                </span>
              </div>
              <div class="min-h-0 flex-1 overflow-hidden rounded-md border bg-[#282c34]">
                <CodeEditor
                  value={code().source || (lang() === "wgsl" ? WGSL_HINT : TSL_HINT)}
                  language={lang() === "wgsl" ? "wgsl" : "js"}
                  onChange={(v) => (draft = v)}
                />
              </div>
              <p class="text-[11px] text-muted-foreground">
                Sandboxed: code runs while building the shader graph, not per-pixel. Edit ports in the Properties panel.
              </p>
              <div class="flex justify-end gap-2">
                <Button variant="outline" onClick={() => ui.editCode(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    const id = n().id;
                    const language = lang();
                    const source = draft;
                    ed.updateData(id, (x) => {
                      if (x.data.code) {
                        x.data.code.source = source;
                        x.data.code.language = language;
                      }
                    });
                    ui.editCode(null);
                  }}
                >
                  Save
                </Button>
              </div>
            </>
          );
        }}
      </Show>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function HelpDialog() {
  const ed = useContext(EditorContext);
  return (
    <Dialog open={ui.dialog() === "help"} onClose={ui.closeDialog} title="Help & Documentation" class="h-[85vh] max-w-3xl">
      <Tabs
        value={ui.helpTab()}
        onChange={ui.setHelpTab}
        tabs={[
          { value: "guide", label: "User Guide" },
          { value: "shortcuts", label: "Keyboard Shortcuts" },
          { value: "tutorials", label: "Tutorials" },
          { value: "agents", label: "Agents (MCP)" },
        ]}
      />
      <div class="thin-scroll min-h-0 flex-1 overflow-y-auto pr-1 text-sm leading-relaxed">
        <Switch>
          <Match when={ui.helpTab() === "guide"}>
            <Guide />
          </Match>
          <Match when={ui.helpTab() === "shortcuts"}>
            <h2 class="mb-4 text-xl font-bold tracking-tight">Keyboard Shortcuts</h2>
            <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
              <For each={SHORTCUT_LIST}>
                {(s) => (
                  <div class="flex items-center justify-between rounded-lg border bg-card/50 p-3">
                    <span class="text-sm font-medium">{s.label}</span>
                    <kbd class="inline-flex h-5 items-center rounded border bg-muted px-2 font-mono text-[10px] text-muted-foreground">{s.key}</kbd>
                  </div>
                )}
              </For>
            </div>
          </Match>
          <Match when={ui.helpTab() === "tutorials"}>
            <h2 class="mb-2 text-xl font-bold tracking-tight">Tutorials</h2>
            <p class="mb-4 text-muted-foreground">Each tutorial opens a new project with a working graph you can dissect.</p>
            <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
              <For each={TEMPLATES.filter((t) => t.id !== "blank")}>
                {(t) => (
                  <button
                    type="button"
                    class="rounded-lg border p-3 text-left hover:bg-accent"
                    onClick={async () => {
                      const doc = projectFromTemplate(t.id);
                      const saved = await api.create(doc.name, doc);
                      ui.closeDialog();
                      navigate(`/editor/${saved.id}`);
                    }}
                  >
                    <div class="font-medium">{t.name}</div>
                    <div class="text-xs text-muted-foreground">{t.description}</div>
                  </button>
                )}
              </For>
            </div>
            <p class="mt-4 text-xs text-muted-foreground">Current project: {ed.state.doc.name}</p>
          </Match>
          <Match when={ui.helpTab() === "agents"}>
            <h2 class="mb-2 text-xl font-bold tracking-tight">Agents (MCP)</h2>
            <p class="text-muted-foreground">
              The editor server exposes an MCP endpoint at <code class="font-mono">{location.origin}/mcp</code>. Connected agents
              operate on the project open in this tab: every change goes through the same undo history, the preview updates live, and
              the agent can read compiler diagnostics, runtime shader errors and screenshots.
            </p>
            <Button class="mt-4" size="sm" variant="outline" onClick={() => ui.openDialog("mcp")}>
              Show connection instructions
            </Button>
          </Match>
        </Switch>
      </div>
    </Dialog>
  );
}

function H(props: { children: unknown }) {
  return <h3 class="mt-6 mb-2 text-base font-semibold first:mt-0">{props.children as never}</h3>;
}

function Guide() {
  return (
    <div class="space-y-2 text-muted-foreground [&_b]:text-foreground">
      <H>Interface Overview</H>
      <p>
        The <b>Nodes</b> library is on the left, the graph canvas in the middle and the live <b>Preview</b> with the <b>Properties</b>,{" "}
        <b>Uniforms</b> and <b>Globals</b> panels on the right. Switch between the <b>Material</b> graph (what the mesh looks like) and the{" "}
        <b>Post</b> graph (full-screen effects) at the top. Click nodes in the library or start from a template on the dashboard.
      </p>
      <H>Working with Nodes</H>
      <p>
        <b>Adding Nodes:</b> click any node in the library to drop it at the centre of the view, or drag it onto the canvas.{" "}
        <b>Quick Add:</b> double-click empty canvas (or Shift + Space) to open the node picker and type to search.
      </p>
      <p>
        <b>Connections:</b> drag from an <b>Output</b> handle (right side) to an <b>Input</b> handle (left side). Handle colours show the
        data type. Dropping a wire on empty canvas opens the node picker filtered to compatible nodes and connects the result. Drag a
        connected input to re-route or remove its wire.
      </p>
      <p>
        <b>Node Debug Preview:</b> click the <b>Bug Icon</b> on a node header to render that node's value as a thumbnail.
      </p>
      <p>
        <b>Material nodes</b> only compile their <i>active</i> inputs. Toggle inputs with the checkboxes in Properties; connecting a wire
        activates an input automatically.
      </p>
      <H>Subgraphs</H>
      <p>
        <b>1. Creating a Subgraph:</b> click <b>Create Subgraph</b> (Layers icon) in the bottom toolbar. With nodes selected (
        <b>Shift + Click</b> or <b>Shift + Drag</b>) they move into the subgraph and the wires crossing the selection become its inputs and
        outputs. With nothing selected you start from an empty subgraph with one input and one output. Either way the subgraph opens for
        editing.
      </p>
      <p>
        <b>2. Name, scope and ports:</b> while editing, the bottom bar holds the subgraph's <b>name</b> and <b>scope</b> — <b>Project</b>{" "}
        keeps it in this project, <b>Library</b> makes it available in every project (Custom Nodes → Library). Select the{" "}
        <b>Subgraph Input</b> or <b>Subgraph Output</b> anchor node to add, rename, retype or remove ports in Properties, then build the
        logic between them.
      </p>
      <p>
        <b>3. Save:</b> <b>Save & Exit</b> (Ctrl/Cmd + Enter) returns to your graph; a new empty subgraph is placed there as a node.{" "}
        <b>Cancel</b> (Esc) discards a new subgraph, or reverts your edits to an existing one. Double-click a subgraph node (or use Edit
        Subgraph in Properties) to edit it again.
      </p>
      <p>
        Think of it as a function definition: the input anchor holds the parameters <code>(a, b)</code>, the output anchor the{" "}
        <code>return</code>, and each node instance is a call like <code>myFunction(1, 2)</code>.
      </p>
      <H>Code Nodes</H>
      <p>
        <b>Writing Code:</b> code nodes run TSL (JavaScript) with every <code>three/tsl</code> function in scope, or a <b>WGSL</b>{" "}
        function via <code>wgslFn</code>. Inputs are available by name; return a node, or an object keyed by output names.
      </p>
      <p>
        <b>Configuring Types:</b> add, rename and type the ports in Properties — e.g. an input <code>color</code> of type Color and{" "}
        <code>time</code> of type Float.
      </p>
      <p>
        <b>Limitations:</b> the code builds the shader graph once; it is not executed per pixel, and has no access to <code>window</code>{" "}
        or <code>document</code>.
      </p>
      <H>Loops, Locals and Globals</H>
      <p>
        Press <b>L</b> to create a Loop frame. Put Count (or Start/End), Index, Accumulator and Output parts inside; the Output's value
        feeds the accumulator each iteration. <b>Set Local</b>/<b>Get Local</b> give values a reusable name. <b>Globals</b> are
        project-level uniforms and constants shared by both graphs.
      </p>
      <H>Miscellaneous</H>
      <p>
        <b>Groups:</b> Ctrl/Cmd + G wraps the selection in a frame; drag its header to move everything; double-click to rename.{" "}
        <b>Comments:</b> add a Comment node and double-click to write Markdown. <b>Live Update:</b> uniform values update the preview without
        recompiling. <b>Geometry & Light:</b> use the preview's settings button to change mesh, environment map and post-processing.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// image export: draw the graph onto a 2D canvas
// ---------------------------------------------------------------------------

const HEADER_HEX: Record<string, string> = {
  "cat-math": "#2a1216",
  "cat-constants": "#1f1535",
  "cat-geometry": "#0c2420",
  "cat-material": "#2a170d",
  "cat-subgraph": "#121c38",
  "cat-post": "#0c2426",
  "cat-texture": "#2a1022",
  "cat-model": "#0b2230",
  "cat-advanced": "#141a26",
  "cat-noise": "#2a0f2e",
  "cat-utils": "#29200c",
  "cat-loop": "#18173a",
  "cat-globals": "#0c2420",
  "cat-locals": "#2a1d0b",
  "cat-tsltextures": "#2a0f18",
  "cat-default": "#161a22",
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function renderGraphImage(ed: Editor, opts: { scale: number; background: boolean; preview?: string }): Promise<string> {
  const g = ed.graph();
  const nodes = g.nodes;
  const pad = 60;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const s = ed.nodeSize(n);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + s.w);
    maxY = Math.max(maxY, n.position.y + s.h);
  }
  if (!nodes.length) {
    minX = minY = 0;
    maxX = maxY = 200;
  }
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * opts.scale);
  canvas.height = Math.ceil(h * opts.scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(opts.scale, opts.scale);
  ctx.translate(pad - minX, pad - minY);
  if (opts.background) {
    ctx.fillStyle = "#03060d";
    ctx.fillRect(minX - pad, minY - pad, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    for (let x = Math.floor((minX - pad) / 20) * 20; x < maxX + pad; x += 20)
      for (let y = Math.floor((minY - pad) / 20) * 20; y < maxY + pad; y += 20) ctx.fillRect(x, y, 1, 1);
  }
  const pos = (id: string, side: "in" | "out", key: string) => {
    const n = ed.nodesById().get(id)!;
    const off = ed.layout[id]?.handles[`${side}:${key}`];
    const s = ed.nodeSize(n);
    return { x: n.position.x + (off?.x ?? (side === "out" ? s.w : 0)), y: n.position.y + (off?.y ?? 30) };
  };
  // containers
  for (const n of nodes) {
    const kind = getNodeDef(n.type)?.kind;
    if (kind !== "group" && kind !== "loop") continue;
    roundRect(ctx, n.position.x, n.position.y, n.width ?? 400, n.height ?? 240, 12);
    ctx.fillStyle = kind === "loop" ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.03)";
    ctx.fill();
    ctx.strokeStyle = kind === "loop" ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "600 10px Geist Variable, sans-serif";
    ctx.fillText((n.data.label ?? (kind === "loop" ? "Loop" : "Group")).toUpperCase(), n.position.x + 12, n.position.y + 20);
  }
  // edges
  for (const e of g.edges) {
    if (!ed.nodesById().has(e.source) || !ed.nodesById().has(e.target)) continue;
    const a = pos(e.source, "out", e.sourceHandle);
    const b = pos(e.target, "in", e.targetHandle);
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(a.x + dx, a.y, b.x - dx, b.y, b.x, b.y);
    ctx.strokeStyle = typeColor(ed.types().get(e.source)?.out[e.sourceHandle]);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // nodes
  for (const n of nodes) {
    const def = getNodeDef(n.type);
    const kind = def?.kind;
    if (kind === "group" || kind === "loop") continue;
    const s = ed.nodeSize(n);
    const x = n.position.x;
    const y = n.position.y;
    if (kind === "comment") {
      roundRect(ctx, x, y, s.w, s.h, 8);
      ctx.fillStyle = "rgba(252,211,77,0.12)";
      ctx.fill();
      ctx.fillStyle = "rgba(255,247,220,0.9)";
      ctx.font = "11px Geist Variable, sans-serif";
      (n.data.text ?? "").split("\n").slice(0, Math.floor((s.h - 16) / 15)).forEach((line, i) => ctx.fillText(line.slice(0, 60), x + 12, y + 20 + i * 15));
      continue;
    }
    roundRect(ctx, x, y, s.w, s.h, 12);
    ctx.fillStyle = "rgba(11,15,24,0.96)";
    ctx.fill();
    ctx.save();
    roundRect(ctx, x, y, s.w, 28, 12);
    ctx.clip();
    ctx.fillStyle = HEADER_HEX[CATEGORY_HEADER[def?.category ?? ""] ?? "cat-default"] ?? "#161a22";
    ctx.fillRect(x, y, s.w, 28);
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(x, y + 28, s.w, 1);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "600 10px Geist Variable, sans-serif";
    ctx.letterSpacing = "1.5px";
    ctx.fillText(nodeTitle(ed.state.doc, n).toUpperCase(), x + 12, y + 18);
    ctx.letterSpacing = "1px";
    ctx.font = "500 10px Geist Variable, sans-serif";
    const handles = ed.layout[n.id]?.handles ?? {};
    for (const [hk, off] of Object.entries(handles)) {
      const [side, key] = hk.split(":");
      const t = side === "in" ? ed.types().get(n.id)?.in[key] : ed.types().get(n.id)?.out[key];
      ctx.fillStyle = typeColor(t);
      if (side === "in") ctx.fillRect(x, y + off.y - 8, 8, 16);
      else ctx.fillRect(x + s.w - 8, y + off.y - 8, 8, 16);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      const ports = ed.resolvePorts(n);
      const label = (side === "in" ? ports.inputs : ports.outputs).find((p) => p.key === key)?.label ?? key;
      ctx.textAlign = side === "in" ? "left" : "right";
      ctx.fillText(label.toUpperCase(), side === "in" ? x + 14 : x + s.w - 14, y + off.y + 3.5);
      ctx.textAlign = "left";
    }
    ctx.letterSpacing = "0px";
  }
  if (opts.preview) {
    const img = new Image();
    img.src = opts.preview;
    await img.decode();
    const pw = Math.min(360, w * 0.35);
    const ph = (pw * img.height) / img.width;
    const px = maxX + pad - pw - 16;
    const py = minY - pad + 16;
    roundRect(ctx, px, py, pw, ph, 10);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#0b0f18";
    ctx.fillRect(px, py, pw, ph);
    ctx.drawImage(img, px, py, pw, ph);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.stroke();
  }
  return canvas.toDataURL("image/png");
}

function ImageExportDialog() {
  const ed = useContext(EditorContext);
  const [scale, setScale] = createSignal("2");
  const [bg, setBg] = createSignal(true);
  const [withPreview, setWithPreview] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  return (
    <Dialog open={ui.dialog() === "export"} onClose={ui.closeDialog} title="Export Image" description="Render the current graph as a PNG.">
      <div class="flex flex-col gap-3 text-sm">
        <label class="flex items-center justify-between">
          Resolution
          <div class="w-32">
            <Select
              value={scale()}
              options={[
                { label: "1x", value: "1" },
                { label: "2x", value: "2" },
                { label: "3x", value: "3" },
                { label: "4x", value: "4" },
              ]}
              onChange={setScale}
            />
          </div>
        </label>
        <label class="flex items-center justify-between">
          Background
          <Checkbox checked={bg()} onChange={setBg} />
        </label>
        <label class="flex items-center justify-between">
          Include shader preview
          <Checkbox checked={withPreview()} onChange={setWithPreview} />
        </label>
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="outline" onClick={ui.closeDialog}>
          Cancel
        </Button>
        <Button
          disabled={busy()}
          onClick={async () => {
            setBusy(true);
            try {
              const preview = withPreview() ? await ed.previewHooks.capture?.(640, 480) : undefined;
              const url = await renderGraphImage(ed, { scale: Number(scale()), background: bg(), preview });
              const a = document.createElement("a");
              a.href = url;
              a.download = `${ed.state.doc.name.replace(/[^\w-]+/g, "_") || "graph"}-graph.png`;
              a.click();
              ui.closeDialog();
            } catch (err) {
              ui.toast(`Export failed: ${err instanceof Error ? err.message : err}`, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon svg={Download} class="size-4" /> Export PNG
        </Button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function ClearDialog() {
  const ed = useContext(EditorContext);
  return (
    <Dialog
      open={ui.dialog() === "clear"}
      onClose={ui.closeDialog}
      title="Clear Graph?"
      description={`This removes every node from the ${ed.state.graph.startsWith("sg:") ? "subgraph" : ed.state.graph} graph. You can undo it.`}
    >
      <div class="flex justify-end gap-2">
        <Button variant="outline" onClick={ui.closeDialog}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            ed.mutate((doc) => {
              const g = ed.state.graph === "post" ? doc.graphs.post : ed.state.graph === "material" ? doc.graphs.material : null;
              if (g) {
                g.nodes = [];
                g.edges = [];
              }
            });
            ed.clearSelection();
            ui.closeDialog();
          }}
        >
          Clear Graph
        </Button>
      </div>
    </Dialog>
  );
}

function ShareDialog(props: { persist: boolean }) {
  const ed = useContext(EditorContext);
  const url = () => `${location.origin}/editor/${ed.state.doc.id}`;
  return (
    <Dialog
      open={ui.dialog() === "share"}
      onClose={ui.closeDialog}
      title="Share Project"
      description="Anyone who can reach this editor server can open the project from this link."
    >
      <Show when={props.persist} fallback={<p class="text-sm text-muted-foreground">This demo project is not saved.</p>}>
        <div class="flex gap-2">
          <Input readonly value={url()} class="font-mono text-xs" />
          <CopyButton text={url} />
        </div>
      </Show>
      <div class="flex justify-between gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            const saved = await api.create(`${ed.state.doc.name} (remix)`, JSON.parse(JSON.stringify(ed.state.doc)));
            ui.closeDialog();
            navigate(`/editor/${saved.id}`);
          }}
        >
          Remix (fork a copy)
        </Button>
        <Button variant="outline" onClick={ui.closeDialog}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
