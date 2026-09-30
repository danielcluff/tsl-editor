import { For, Match, Show, Switch as SwitchFlow, createMemo, createSignal, useContext } from "solid-js";
import { Code2, Layers, Pencil, Plus, Trash2, Upload, Waypoints } from "lucide-static";
import { defaultGlobalValue } from "../../core/commands";
import { multiOpHandleId, multiOpInfo, multiOpParams } from "../../core/multiop";
import { ANY_VALUE_TYPES, LOOP_COMPARES, LOOP_MODES, convertAnyValue, findSubgraph, literalType, loopModeOf, nodeTitle, resolvePorts, uid, type AnyValueType, type LoopMode } from "../../core/graph";
import { getNodeDef, typeColor } from "../../core/registry";
import type { GlobalDef, GraphNode, PortDef } from "../../core/types";
import {
  Button,
  Checkbox,
  ColorPicker,
  Icon,
  Input,
  NumberField,
  Select,
  Slider,
  Switch,
  Tabs,
  Textarea,
} from "../ui";
import { EditorContext, type Editor } from "./store";
import { parseGlobals } from "./globals-parse";
import { ui } from "./ui-state";

type Tab = "properties" | "uniforms" | "globals";

export function Inspector() {
  const [tab, setTab] = createSignal<Tab>("properties");
  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-sidebar shadow-lg" data-ui>
      <div class="mx-2 mt-3 mb-2">
        <Tabs
          class="h-9 w-full [&>button]:text-sm"
          value={tab()}
          onChange={setTab}
          tabs={[
            { value: "properties", label: "Properties" },
            { value: "uniforms", label: "Uniforms" },
            { value: "globals", label: "Globals" },
          ]}
        />
      </div>
      <div class="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <SwitchFlow>
          <Match when={tab() === "properties"}>
            <Properties />
          </Match>
          <Match when={tab() === "uniforms"}>
            <Uniforms />
          </Match>
          <Match when={tab() === "globals"}>
            <Globals />
          </Match>
        </SwitchFlow>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------

/** Groups continuous edits (drag, typing) into one undo step. */
function useEditSession(ed: Editor) {
  let active = false;
  return {
    change(fn: () => void) {
      if (!active) {
        ed.pushHistory();
        active = true;
      }
      fn();
    },
    commit() {
      active = false;
    },
  };
}

function Section(props: { title: string; hint?: string; children: unknown; action?: unknown }) {
  return (
    <div class="border-t p-4 first:border-t-0">
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{props.title}</span>
        <Show when={props.hint}>
          <span class="text-right text-[10px] text-muted-foreground">{props.hint}</span>
        </Show>
        {props.action as never}
      </div>
      <div class="flex flex-col gap-2">{props.children as never}</div>
    </div>
  );
}

function Field(props: { label: string; sub?: string; children?: unknown; right?: unknown; color?: string }) {
  return (
    <div class="flex flex-col gap-1.5 rounded-md">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5 text-xs font-medium">
            <Show when={props.color}>
              <span class="size-2 shrink-0 rounded-full" style={{ background: props.color }} />
            </Show>
            <span class="truncate">{props.label}</span>
          </div>
          <Show when={props.sub}>
            <div class="text-[10px] text-muted-foreground">{props.sub}</div>
          </Show>
        </div>
        {props.right as never}
      </div>
      {props.children as never}
    </div>
  );
}

const VEC = ["X", "Y", "Z", "W"];

export function ValueEditor(props: {
  type: string;
  value: unknown;
  port?: PortDef;
  onChange: (v: unknown) => void;
  onCommit?: () => void;
}) {
  const t = () => {
    if (props.type !== "any") return props.type;
    const v = props.value;
    if (typeof v === "boolean") return "bool";
    if (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v)) return "color";
    if (Array.isArray(v)) return `vec${Math.min(4, Math.max(2, v.length))}`;
    return "float";
  };
  const options = () => props.port?.options;
  return (
    <SwitchFlow
      fallback={<div class="text-[11px] text-muted-foreground italic">Connection only</div>}
    >
      <Match when={options()}>
        {(opts) => (
          <Select
            value={String(props.value ?? props.port?.default ?? "")}
            options={opts().map((o) => ({ label: o.label, value: o.value }))}
            onChange={(v) => {
              const opt = opts().find((o) => String(o.value) === v);
              props.onChange(opt ? opt.value : v);
              props.onCommit?.();
            }}
          />
        )}
      </Match>
      <Match when={t() === "float" || t() === "int" || t() === "uint"}>
        <div class="flex flex-col gap-1.5">
          <NumberField
            value={Number(props.value ?? 0)}
            integer={t() !== "float"}
            min={props.port?.min ?? (t() === "uint" ? 0 : undefined)}
            max={props.port?.max}
            step={t() === "float" ? 0.01 : 1}
            onChange={props.onChange}
            onCommit={props.onCommit}
          />
          <Show when={props.port?.min !== undefined && props.port?.max !== undefined}>
            <Slider
              value={Number(props.value ?? 0)}
              min={props.port!.min!}
              max={props.port!.max!}
              onChange={(v) => props.onChange(v)}
            />
          </Show>
        </div>
      </Match>
      <Match when={t() === "bool"}>
        <Switch
          checked={Boolean(props.value)}
          onChange={(v) => {
            props.onChange(v);
            props.onCommit?.();
          }}
        />
      </Match>
      <Match when={t() === "color"}>
        <ColorPicker
          value={typeof props.value === "string" ? props.value : "#ffffff"}
          onChange={props.onChange}
          onCommit={props.onCommit}
        />
      </Match>
      <Match when={/^[iu]?vec[234]$/.test(t())}>
        {(_) => {
          const n = () => Number(t().slice(-1));
          const arr = () => {
            const v = props.value;
            const base = Array.isArray(v) ? (v as number[]) : Array(n()).fill(typeof v === "number" ? v : 0);
            return Array.from({ length: n() }, (_, i) => Number(base[i] ?? 0));
          };
          return (
            <div class={["grid gap-1", n() === 2 ? "grid-cols-2" : n() === 3 ? "grid-cols-3" : "grid-cols-4"]}>
              <For each={arr()}>
                {(c, i) => (
                  <NumberField
                    label={VEC[i()]}
                    value={c}
                    integer={t().startsWith("i") || t().startsWith("u")}
                    onChange={(v) => {
                      const next = [...arr()];
                      next[i()] = v;
                      props.onChange(next);
                    }}
                    onCommit={props.onCommit}
                  />
                )}
              </For>
            </div>
          );
        }}
      </Match>
      <Match when={t() === "string"}>
        <Input
          value={String(props.value ?? "")}
          onInput={(e) => props.onChange(e.currentTarget.value)}
          onBlur={() => props.onCommit?.()}
        />
      </Match>
    </SwitchFlow>
  );
}

// ---------------------------------------------------------------------------
// properties
// ---------------------------------------------------------------------------

function Properties() {
  const ed = useContext(EditorContext);
  return (
    <SwitchFlow
      fallback={<div class="flex h-full min-h-40 items-center justify-center p-6 text-center text-sm text-muted-foreground">Select a node to edit properties</div>}
    >
      <Match when={ed.selectedNode()?.type === "import/placeholder" && ed.selectedNode()}>
        {(node) => <PlaceholderProperties node={node()} />}
      </Match>
      <Match when={ed.selectedNode()}>{(node) => <NodeProperties node={node()} />}</Match>
      <Match when={ed.state.selection.nodes.length > 1}>
        <div class="flex flex-col gap-3 p-4">
          <div class="text-sm font-medium">{ed.state.selection.nodes.length} nodes selected</div>
          <div class="flex flex-wrap gap-2">
            <Button size="xs" variant="outline" onClick={() => ed.groupSelection()}>
              Group
            </Button>
            <Button size="xs" variant="outline" onClick={() => ed.createSubgraph()}>
              <Icon svg={Layers} class="size-3" /> Create Subgraph
            </Button>
            <Show when={ed.selectionChain().valid}>
              <Button size="xs" variant="outline" onClick={() => ed.convertToMultiOp()}>
                Convert to Multi-op
              </Button>
            </Show>
            <Button size="xs" variant="destructive" onClick={() => ed.deleteSelection()}>
              Delete
            </Button>
          </div>
        </div>
      </Match>
      <Match when={ed.state.selection.edges.length === 1}>
        <div class="flex flex-col gap-3 p-4">
          <div class="text-sm font-medium">Connection</div>
          <div class="flex gap-2">
            <Button size="xs" variant="outline" onClick={() => ed.edgeToPortal()}>
              <Icon svg={Waypoints} class="size-3" /> Convert to Portal
            </Button>
            <Button size="xs" variant="destructive" onClick={() => ed.deleteSelection()}>
              Delete
            </Button>
          </div>
        </div>
      </Match>
    </SwitchFlow>
  );
}

/** Imported node this editor doesn't support: read-only details, delete only. */
function PlaceholderProperties(props: { node: GraphNode }) {
  const ed = useContext(EditorContext);
  const ph = () => props.node.data.placeholder;
  return (
    <div>
      <div class="border-b px-3 py-3">
        <div class="text-sm font-semibold">{ph()?.originalType ?? "Unsupported node"}</div>
        <div class="mt-0.5 font-mono text-[10px] text-muted-foreground">{ph()?.originalId}</div>
        <div class="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-300">
          <div class="font-medium">Unsupported imported node</div>
          <div>{ph()?.reason}.</div>
          <div class="mt-1 text-amber-300/80">
            It can't be edited, copied or connected. Delete it, or rebuild it with supported nodes using the details below.
          </div>
        </div>
      </div>
      <Section title="Imported data">
        <pre class="thin-scroll max-h-80 overflow-auto rounded-md border bg-muted/40 px-2.5 py-2 font-mono text-[10px] leading-snug whitespace-pre-wrap select-text">
          {ph()?.meta}
        </pre>
        <Show when={(ph()?.inputs.length ?? 0) + (ph()?.outputs.length ?? 0) > 0}>
          <div class="text-[10px] text-muted-foreground">
            Connections kept for reference — inputs: {ph()?.inputs.join(", ") || "none"} · outputs: {ph()?.outputs.join(", ") || "none"}
          </div>
        </Show>
      </Section>
      <div class="border-t px-3 py-3">
        <Button size="xs" variant="destructive" onClick={() => ed.deleteSelection()}>
          <Icon svg={Trash2} class="size-3" /> Delete node
        </Button>
      </div>
    </div>
  );
}

function NodeProperties(props: { node: GraphNode }) {
  const ed = useContext(EditorContext);
  const session = useEditSession(ed);
  const def = createMemo(() => getNodeDef(props.node.type)!);
  const kind = () => def()?.kind ?? "standard";
  const ports = createMemo(() => resolvePorts(ed.state.doc, props.node));
  const connected = createMemo(() => new Set(ed.graph().edges.filter((e) => e.target === props.node.id).map((e) => e.targetHandle)));
  const inTypes = () => ed.types().get(props.node.id)?.in ?? {};
  const change = (key: string, v: unknown) => session.change(() => ed.setValue(props.node.id, key, v, { history: false }));
  const update = (fn: (n: GraphNode) => void, recompile = true) => ed.updateData(props.node.id, fn, { recompile });
  const [editingTitle, setEditingTitle] = createSignal(false);

  const inputEditor = (p: PortDef) => (
    <ValueEditor
      type={p.type === "any" ? (inTypes()[p.key] ?? "any") : String(p.type)}
      value={props.node.data.values[p.key] ?? p.default}
      port={p}
      onChange={(v) => change(p.key, v)}
      onCommit={session.commit}
    />
  );

  return (
    <div>
      <div class="border-b px-4 py-3">
        <Show
          when={editingTitle()}
          fallback={
            <button type="button" class="group flex items-center gap-1.5 text-left text-sm font-semibold" onClick={() => setEditingTitle(true)}>
              {nodeTitle(ed.state.doc, props.node)}
              <Icon svg={Pencil} class="size-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </button>
          }
        >
          <Input
            value={props.node.data.label ?? ""}
            placeholder={def().label}
            ref={(i) => requestAnimationFrame(() => i.focus())}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              setEditingTitle(false);
              update((n) => (n.data.label = v || undefined), false);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </Show>
        <div class="mt-0.5 text-xs text-muted-foreground" title={def().description}>
          {props.node.type}
        </div>
      </div>

      <SwitchFlow>
        <Match when={kind() === "material"}>
          <Section title="Inputs" hint="Active inputs show on node & compile">
            <For each={def().inputs.filter((i) => !i.propertyOnly)}>
              {(p) => {
                const active = () => (props.node.data.activeInputs ?? []).includes(p.key);
                return (
                  <Field
                    label={p.label}
                    sub={`${p.type}${p.connectionOnly ? " • connection only" : ""}${connected().has(p.key) ? " • connected" : ""}`}
                    color={active() ? typeColor(String(p.type)) : undefined}
                    right={
                      <Checkbox
                        checked={active()}
                        label={`Toggle ${p.label}`}
                        onChange={(v) =>
                          update((n) => {
                            const set = new Set(n.data.activeInputs ?? []);
                            if (v) set.add(p.key);
                            else set.delete(p.key);
                            n.data.activeInputs = def().inputs.map((i) => i.key).filter((k) => set.has(k));
                          })
                        }
                      />
                    }
                  >
                    <Show when={active() && !p.connectionOnly && !connected().has(p.key)}>{inputEditor(p)}</Show>
                  </Field>
                );
              }}
            </For>
          </Section>
          <Section title="Material">
            <For each={def().inputs.filter((i) => i.propertyOnly)}>
              {(p) => <Field label={p.label}>{inputEditor(p)}</Field>}
            </For>
          </Section>
        </Match>

        <Match when={kind() === "uniform"}>
          <Section title="Uniform">
            <Field label="Name" sub="variable name in generated code">
              <Input
                value={props.node.data.localName ?? ""}
                placeholder="uUniform"
                onBlur={(e) => update((n) => (n.data.localName = e.currentTarget.value.trim() || undefined))}
              />
            </Field>
            <Field label="Type">
              <Select
                value={String(props.node.data.values.type ?? "float")}
                options={["float", "int", "bool", "vec2", "vec3", "vec4", "color"].map((t) => ({ label: t, value: t }))}
                onChange={(t) =>
                  update((n) => {
                    n.data.values.type = t;
                    n.data.values.value = defaultGlobalValue(t);
                  })
                }
              />
            </Field>
            <Field label="Value" sub="updates live without recompiling">
              <ValueEditor
                type={String(props.node.data.values.type ?? "float")}
                value={props.node.data.values.value}
                onChange={(v) => change("value", v)}
                onCommit={session.commit}
              />
            </Field>
          </Section>
        </Match>

        <Match when={kind() === "code"}>
          <CodeProperties node={props.node} />
        </Match>

        <Match when={kind() === "comment"}>
          <Section title="Note">
            <Textarea
              rows={8}
              class="font-mono text-xs"
              placeholder="Write markdown notes..."
              value={props.node.data.text ?? ""}
              onBlur={(e) => update((n) => (n.data.text = e.currentTarget.value), false)}
            />
          </Section>
        </Match>

        <Match when={kind() === "localSet"}>
          <Section title="Local">
            <Field label="Name">
              <Input
                value={props.node.data.localName ?? ""}
                placeholder="myValue"
                onBlur={(e) => update((n) => (n.data.localName = e.currentTarget.value.trim() || undefined))}
              />
            </Field>
          </Section>
        </Match>

        <Match when={kind() === "localGet"}>
          <Section title="Local">
            <Field label="Source" sub="Set Local node to read">
              <Select
                value={props.node.data.localSourceId ?? ""}
                options={[
                  { label: "— choose —", value: "" },
                  ...ed
                    .graph()
                    .nodes.filter((n) => n.type === "local/set")
                    .map((n) => ({ label: n.data.localName ?? n.id, value: n.id })),
                ]}
                onChange={(v) => update((n) => (n.data.localSourceId = v || undefined))}
              />
            </Field>
          </Section>
        </Match>

        <Match when={kind() === "globalRef"}>
          <Section title="Global">
            <Field label="Global">
              <Select
                value={props.node.data.globalId ?? ""}
                options={[{ label: "— choose —", value: "" }, ...ed.state.doc.globals.map((g) => ({ label: `${g.name} (${g.type})`, value: g.id }))]}
                onChange={(v) => update((n) => (n.data.globalId = v || undefined))}
              />
            </Field>
          </Section>
        </Match>

        <Match when={kind() === "multiOp"}>
          {/* one box per operation, like the original's "Step N · Op" sections */}
          <div class="flex flex-col gap-4 p-4">
            <For each={props.node.data.operations ?? []} fallback={<div class="text-xs text-muted-foreground">No operations yet.</div>}>
              {(o, i) => (
                <div class="flex flex-col gap-2">
                  <span class="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                    Step {i() + 1} · {multiOpInfo(o.op)?.label ?? o.op}
                  </span>
                  <div class="rounded-lg border p-3">
                    <InputsSection
                      bare
                      node={props.node}
                      ports={multiOpParams(o.op, i() === 0).map((p) => ({ ...p, key: multiOpHandleId(o.id, p.key) }))}
                      connected={connected()}
                      editor={inputEditor}
                    />
                    <Show when={!multiOpParams(o.op, i() === 0).length}>
                      <div class="text-xs text-muted-foreground">Takes the previous result; no other inputs.</div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Match>

        <Match when={kind() === "gradient"}>
          <GradientProperties node={props.node} />
        </Match>

        <Match when={kind() === "textureSample"}>
          <TextureProperties node={props.node} editor={inputEditor} />
        </Match>

        <Match when={kind() === "subgraph"}>
          <Section title="Subgraph">
            <div class="text-xs">{findSubgraph(ed.state.doc, props.node.data.subgraphId)?.name ?? "Missing definition"}</div>
            <Button size="xs" variant="outline" onClick={() => props.node.data.subgraphId && ed.enterSubgraph(props.node.data.subgraphId)}>
              <Icon svg={Layers} class="size-3" /> Edit Subgraph
            </Button>
          </Section>
          <InputsSection node={props.node} ports={ports().inputs} connected={connected()} editor={inputEditor} />
        </Match>

        <Match when={kind() === "subgraphInput" || kind() === "subgraphOutput"}>
          <AnchorPorts node={props.node} />
        </Match>

        <Match when={kind() === "postInput"}>
          <Section title="Outputs" hint="Active outputs show on node">
            <For each={def().outputs}>
              {(p) => (
                <Field
                  label={p.label}
                  sub={String(p.type)}
                  right={
                    <Checkbox
                      checked={(props.node.data.activeInputs ?? []).includes(p.key)}
                      onChange={(v) =>
                        update((n) => {
                          const set = new Set(n.data.activeInputs ?? []);
                          if (v) set.add(p.key);
                          else set.delete(p.key);
                          n.data.activeInputs = def().outputs.map((o) => o.key).filter((k) => set.has(k));
                        })
                      }
                    />
                  }
                />
              )}
            </For>
          </Section>
        </Match>

        <Match when={kind() === "group" || kind() === "loop"}>
          <Section title={kind() === "loop" ? "Loop" : "Group"}>
            <Field label="Label">
              <Input value={props.node.data.label ?? ""} onBlur={(e) => update((n) => (n.data.label = e.currentTarget.value || undefined), false)} />
            </Field>
            <Show when={kind() === "loop"}>
              <LoopSettings node={props.node} />
            </Show>
          </Section>
        </Match>

        <Match when={true}>
          <InputsSection node={props.node} ports={ports().inputs} connected={connected()} editor={inputEditor} />
        </Match>
      </SwitchFlow>

      {/* subgraph anchors can't be duplicated or deleted */}
      <Show when={kind() !== "subgraphInput" && kind() !== "subgraphOutput"}>
      <div class="flex flex-wrap gap-2 border-t px-3 py-3">
        <Button size="xs" variant="outline" onClick={() => ed.duplicateSelection()}>
          Duplicate
        </Button>
        <Button size="xs" variant="ghost" class="text-destructive" onClick={() => ed.deleteSelection()}>
          <Icon svg={Trash2} class="size-3" /> Delete
        </Button>
      </div>
      </Show>
    </div>
  );
}

function InputsSection(props: {
  node: GraphNode;
  ports: PortDef[];
  connected: Set<string>;
  editor: (p: PortDef) => unknown;
  /** Just the fields, for embedding (no padding or empty message). */
  bare?: boolean;
}) {
  const ed = useContext(EditorContext);
  const types = () => ed.types().get(props.node.id)?.in ?? {};
  return (
    <Show
      when={props.ports.length}
      fallback={<Show when={!props.bare}><div class="px-3 py-4 text-xs text-muted-foreground">This node has no editable inputs.</div></Show>}
    >
      <div class={["flex flex-col gap-4", { "p-4": !props.bare }]}>
        <For each={props.ports}>
          {(p) => (
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between gap-2">
                <span class="text-[10px] font-medium tracking-wider text-foreground/70 uppercase" title={`${types()[p.key] ?? p.type}${p.connectionOnly ? " • connection only" : ""}`}>
                  {p.label}
                </span>
                <Show when={props.connected.has(p.key)}>
                  <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Connected</span>
                </Show>
                <Show when={!props.connected.has(p.key) && p.connectionOnly}>
                  <span class="text-[10px] text-muted-foreground">connection only</span>
                </Show>
              </div>
              <Show when={!props.connected.has(p.key) && !p.connectionOnly && !["texture", "mat3", "mat4", "sampler2D"].includes(String(p.type))}>
                <div class="flex flex-col gap-2">
                  {/* like the original: an unconnected `any` input picks which literal type it holds */}
                  <Show when={p.type === "any" && !p.options}>
                    <div class="flex items-center justify-between">
                      <span class="text-xs text-muted-foreground">Type</span>
                      <select
                        aria-label={`${p.label} type`}
                        class="h-6 rounded border bg-accent px-1 py-0 text-[10px] outline-none focus:ring-1 focus:ring-ring"
                        value={literalType(props.node.data.values[p.key] ?? p.default ?? 0)}
                        onChange={(e) =>
                          ed.setValue(props.node.id, p.key, convertAnyValue(props.node.data.values[p.key] ?? p.default ?? 0, e.currentTarget.value as AnyValueType))
                        }
                      >
                        <For each={ANY_VALUE_TYPES}>{(t) => <option value={t}>{t === "bool" ? "Bool" : t[0].toUpperCase() + t.slice(1)}</option>}</For>
                      </select>
                    </div>
                  </Show>
                  {props.editor(p) as never}
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

function CodeProperties(props: { node: GraphNode }) {
  const ed = useContext(EditorContext);
  const code = () => props.node.data.code!;
  const update = (fn: (n: GraphNode) => void) => ed.updateData(props.node.id, fn);
  const types = ["float", "int", "bool", "vec2", "vec3", "vec4", "color", "mat3", "mat4", "any"];
  const PortList = (p: { which: "inputs" | "outputs" }) => (
    <Section
      title={p.which === "inputs" ? "Inputs" : "Outputs"}
      action={
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground"
          aria-label="Add port"
          onClick={() =>
            update((n) => {
              const list = n.data.code![p.which];
              let i = list.length;
              const base = p.which === "inputs" ? "in" : "out";
              while (list.some((x) => x.key === `${base}${i}`)) i++;
              list.push({ key: `${base}${i}`, type: "float" });
            })
          }
        >
          <Icon svg={Plus} class="size-3.5" />
        </button>
      }
    >
      <For each={code()[p.which]}>
        {(port, i) => (
          <div class="flex items-center gap-1.5">
            <Input
              class="h-7 font-mono text-xs"
              value={port.key}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim().replace(/[^\w$]/g, "_");
                if (v && v !== port.key) update((n) => (n.data.code![p.which][i()].key = v));
              }}
            />
            <Select
              class="h-7 w-24 text-xs"
              value={port.type}
              options={types.map((t) => ({ label: t, value: t }))}
              onChange={(v) => update((n) => (n.data.code![p.which][i()].type = v))}
            />
            <button
              type="button"
              class="text-muted-foreground hover:text-destructive"
              aria-label="Remove port"
              onClick={() => update((n) => n.data.code![p.which].splice(i(), 1))}
            >
              <Icon svg={Trash2} class="size-3.5" />
            </button>
          </div>
        )}
      </For>
    </Section>
  );
  return (
    <>
      <Section title="Code">
        <Field label="Language">
          <Select
            value={code().language}
            options={[
              { label: "TSL (JavaScript)", value: "tsl" },
              { label: "WGSL", value: "wgsl" },
            ]}
            onChange={(v) => update((n) => (n.data.code!.language = v as "tsl" | "wgsl"))}
          />
        </Field>
        <Button size="sm" variant="outline" onClick={() => ui.editCode(props.node.id)}>
          <Icon svg={Code2} class="size-3.5" /> Edit Code
        </Button>
      </Section>
      <PortList which="inputs" />
      <PortList which="outputs" />
    </>
  );
}

function GradientProperties(props: { node: GraphNode }) {
  const ed = useContext(EditorContext);
  const session = useEditSession(ed);
  const stops = () => (props.node.data.values.stops as { id?: string; pos: number; color: string }[] | undefined) ?? [];
  const [active, setActive] = createSignal(0);
  const setStops = (fn: (s: { id?: string; pos: number; color: string }[]) => void, continuous = false) => {
    const apply = () =>
      ed.updateData(
        props.node.id,
        (n) => {
          const list = ((n.data.values.stops as { pos: number; color: string }[]) ?? []).map((s) => ({ ...s }));
          fn(list);
          n.data.values.stops = list;
        },
        { history: false },
      );
    if (continuous) session.change(apply);
    else {
      ed.pushHistory();
      apply();
    }
  };
  return (
    <Section title="Gradient">
      <div
        class="h-4 w-full rounded"
        style={{
          background: `linear-gradient(to right, ${stops()
            .slice()
            .sort((a, b) => a.pos - b.pos)
            .map((s) => `${s.color} ${Math.round(s.pos * 100)}%`)
            .join(", ")})`,
        }}
      />
      <Field label="Mode">
        <Select
          value={String(props.node.data.values.mode ?? 0)}
          options={[
            { label: "Linear", value: "0" },
            { label: "Step", value: "1" },
          ]}
          onChange={(v) => ed.setValue(props.node.id, "mode", Number(v))}
        />
      </Field>
      <For each={stops()}>
        {(s, i) => (
          <div class="flex items-center gap-2">
            <button
              type="button"
              class={["size-6 shrink-0 rounded border", { "ring-2 ring-blue-500": active() === i() }]}
              style={{ background: s.color }}
              onClick={() => setActive(i())}
              aria-label="Edit stop colour"
            />
            <NumberField
              class="flex-1"
              label="Pos"
              value={s.pos}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setStops((l) => (l[i()].pos = v), true)}
              onCommit={session.commit}
            />
            <button
              type="button"
              class="text-muted-foreground hover:text-destructive disabled:opacity-30"
              disabled={stops().length <= 2}
              onClick={() => setStops((l) => l.splice(i(), 1))}
              aria-label="Remove stop"
            >
              <Icon svg={Trash2} class="size-3.5" />
            </button>
          </div>
        )}
      </For>
      <Show when={stops()[active()]}>
        {(s) => (
          <ColorPicker
            value={s().color}
            onChange={(c) => setStops((l) => (l[active()].color = c), true)}
            onCommit={session.commit}
          />
        )}
      </Show>
      <Button
        size="xs"
        variant="outline"
        onClick={() => setStops((l) => l.push({ id: uid("stop"), pos: 0.5, color: "#ffffff" }))}
      >
        <Icon svg={Plus} class="size-3" /> Add stop
      </Button>
    </Section>
  );
}

function TextureProperties(props: { node: GraphNode; editor: (p: PortDef) => unknown }) {
  const ed = useContext(EditorContext);
  const def = () => getNodeDef(props.node.type)!;
  const upload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => ed.setValue(props.node.id, "url", String(reader.result));
      reader.readAsDataURL(file);
    };
    input.click();
  };
  return (
    <Section title="Texture">
      <Field label="Image URL">
        <div class="flex gap-1.5">
          <Input
            value={String(props.node.data.values.url ?? "").startsWith("data:") ? "(uploaded image)" : String(props.node.data.values.url ?? "")}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              if (v && v !== "(uploaded image)") ed.setValue(props.node.id, "url", v);
            }}
          />
          <Button size="icon-sm" variant="outline" onClick={upload} aria-label="Upload image">
            <Icon svg={Upload} class="size-3.5" />
          </Button>
        </div>
      </Field>
      <For each={def().inputs.filter((i) => i.propertyOnly && i.key !== "url")}>
        {(p) => <Field label={p.label}>{props.editor(p) as never}</Field>}
      </For>
    </Section>
  );
}

function AnchorPorts(props: { node: GraphNode }) {
  const ed = useContext(EditorContext);
  const isInput = () => props.node.type === "subgraph/input";
  const update = (fn: (n: GraphNode) => void) => ed.updateData(props.node.id, fn);
  const types = ["float", "int", "bool", "vec2", "vec3", "vec4", "color", "any"];
  return (
    <Section
      title={isInput() ? "Subgraph Inputs" : "Subgraph Outputs"}
      action={
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground"
          aria-label="Add port"
          onClick={() =>
            update((n) => {
              const list = (n.data.ports ??= []);
              const base = isInput() ? "in" : "out";
              let i = list.length;
              while (list.some((p) => p.key === `${base}${i}`)) i++;
              list.push({ key: `${base}${i}`, label: `${isInput() ? "In" : "Out"} ${i + 1}`, type: "float" });
            })
          }
        >
          <Icon svg={Plus} class="size-3.5" />
        </button>
      }
    >
      <p class="text-[11px] leading-relaxed text-muted-foreground">
        {isInput() ? "Values passed into the subgraph become outputs of this node." : "Connect results here; they become outputs of the subgraph node."}
      </p>
      <For each={props.node.data.ports ?? []}>
        {(p, i) => (
          <div class="flex items-center gap-1.5">
            <Input
              class="h-7 text-xs"
              value={p.label}
              onBlur={(e) => update((n) => (n.data.ports![i()].label = e.currentTarget.value || p.key))}
            />
            <Select
              class="h-7 w-20 text-xs"
              value={p.type}
              options={types.map((t) => ({ label: t, value: t }))}
              onChange={(v) => update((n) => (n.data.ports![i()].type = v))}
            />
            <button type="button" class="text-muted-foreground hover:text-destructive" aria-label="Remove port" onClick={() => update((n) => n.data.ports!.splice(i(), 1))}>
              <Icon svg={Trash2} class="size-3.5" />
            </button>
          </div>
        )}
      </For>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// uniforms + globals tabs
// ---------------------------------------------------------------------------

function Uniforms() {
  const ed = useContext(EditorContext);
  const session = useEditSession(ed);
  const nodes = createMemo(() =>
    (["material", "post"] as const).flatMap((g) =>
      ed.state.doc.graphs[g].nodes.filter((n) => n.type === "const/uniform").map((n) => ({ graph: g, node: n })),
    ),
  );
  const globals = createMemo(() => ed.state.doc.globals.filter((g) => g.kind === "uniform"));
  return (
    <div>
      <div class="border-b px-4 py-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold">Uniforms</h3>
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground">{nodes().length + globals().length}</span>
            <Button size="sm" variant="outline" class="h-7" onClick={() => ed.addNodeAt("const/uniform")}>
              <Icon svg={Plus} class="mr-1 size-3.5" /> New
            </Button>
          </div>
        </div>
        <p class="mt-0.5 text-xs text-muted-foreground">Edit node and global uniforms without hunting nodes</p>
      </div>
      <Show
        when={nodes().length || globals().length}
        fallback={<p class="px-4 py-4 text-sm text-muted-foreground">No uniforms in this graph.</p>}
      >
        <div class="flex flex-col gap-3 px-4 py-4">
          <For each={nodes()}>
            {({ graph, node }) => (
              <Field
                label={node.data.localName || node.data.label || "uniform"}
                sub={`${String(node.data.values.type ?? "float")} • ${graph} node`}
                right={
                  <button
                    type="button"
                    class="text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      ed.setGraph(graph);
                      ed.select([node.id]);
                      requestAnimationFrame(() => ed.fitView([node.id], 200));
                    }}
                  >
                    Locate
                  </button>
                }
              >
                <ValueEditor
                  type={String(node.data.values.type ?? "float")}
                  value={node.data.values.value}
                  onChange={(v) =>
                    session.change(() => {
                      ed.mutate(
                        (doc) => {
                          const n = doc.graphs[graph].nodes.find((x) => x.id === node.id);
                          if (n) n.data.values.value = v;
                        },
                        { history: false, recompile: false },
                      );
                      ed.previewHooks.setUniform?.(node.id, v);
                    })
                  }
                  onCommit={session.commit}
                />
              </Field>
            )}
          </For>
          <For each={globals()}>{(g) => <GlobalValue global={g} session={session} />}</For>
        </div>
      </Show>
    </div>
  );
}

function GlobalValue(props: { global: GlobalDef; session: ReturnType<typeof useEditSession> }) {
  const ed = useContext(EditorContext);
  return (
    <Field label={props.global.name} sub={`${props.global.type} • global`}>
      <ValueEditor
        type={props.global.type}
        value={props.global.value}
        onChange={(v) =>
          props.session.change(() => {
            ed.mutate(
              (doc) => {
                const g = doc.globals.find((x) => x.id === props.global.id);
                if (g) g.value = v;
              },
              { history: false, recompile: props.global.kind !== "uniform" },
            );
            if (props.global.kind === "uniform") ed.previewHooks.setUniform?.(`global:${props.global.id}`, v);
          })
        }
        onCommit={props.session.commit}
      />
    </Field>
  );
}

const GLOBAL_TYPES = ["float", "int", "bool", "vec2", "vec3", "vec4", "color"];

function Globals() {
  const ed = useContext(EditorContext);
  const session = useEditSession(ed);
  const [bulk, setBulk] = createSignal("");
  const add = () =>
    ed.mutate((doc) => {
      let i = doc.globals.length + 1;
      while (doc.globals.some((g) => g.name === `global${i}`)) i++;
      doc.globals.push({ id: uid("g"), name: `global${i}`, kind: "uniform", type: "float", value: 0 });
    });
  const updateGlobal = (id: string, fn: (g: GlobalDef) => void) =>
    ed.mutate((doc) => {
      const g = doc.globals.find((x) => x.id === id);
      if (g) fn(g);
    });
  return (
    <div>
      <div class="border-b px-4 py-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold">Globals</h3>
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground">{ed.state.doc.globals.length}</span>
            <Button size="sm" variant="outline" class="h-7" onClick={add}>
              <Icon svg={Plus} class="mr-1 size-3.5" /> Add
            </Button>
          </div>
        </div>
        <p class="mt-0.5 text-xs text-muted-foreground">Define project-level uniforms, varyings, and constants.</p>
      </div>
      <div class="space-y-2 px-4 py-4">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-medium tracking-wider text-foreground/70 uppercase">Bulk Import</span>
          <Button
            size="sm"
            variant="outline"
            class="h-7"
            disabled={!bulk().trim()}
            onClick={() => {
              const parsed = parseGlobals(bulk());
              if (!parsed.length) {
                ui.toast("No globals found to import", "error");
                return;
              }
              ed.mutate((doc) => {
                for (const g of parsed) {
                  const existing = doc.globals.find((x) => x.name === g.name);
                  if (existing) Object.assign(existing, g);
                  else doc.globals.push({ id: uid("g"), ...g });
                }
              });
              setBulk("");
              ui.toast(`Imported ${parsed.length} global${parsed.length === 1 ? "" : "s"}`, "success");
            }}
          >
            Import
          </Button>
        </div>
        <Textarea
          rows={5}
          class="text-sm"
          placeholder={"Paste const foo = uniform(1); const bar = uniform(vec2(0, 0));"}
          value={bulk()}
          onInput={(e) => setBulk(e.currentTarget.value)}
        />
        <p class="text-[11px] text-muted-foreground">
          Supports <code>uniform()</code>, <code>varying()</code>, and constant initializers with <code>float</code>, <code>int</code>,{" "}
          <code>bool</code>, <code>vec2</code>, <code>vec3</code>, <code>vec4</code>, and <code>color</code>.
        </p>
      </div>
      <Show
        when={ed.state.doc.globals.length}
        fallback={<p class="px-4 pb-4 text-sm text-muted-foreground">No globals yet. Add one to reuse it across your graph.</p>}
      >
        <div class="flex flex-col divide-y border-t">
          <For each={ed.state.doc.globals}>
            {(g) => (
              <div class="flex flex-col gap-2 px-3 py-3">
                <div class="flex items-center gap-1.5">
                  <Input
                    class="h-7 font-mono text-xs"
                    value={g.name}
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim().replace(/[^\w$]/g, "_");
                      if (v && v !== g.name) updateGlobal(g.id, (x) => (x.name = v));
                    }}
                  />
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground"
                    title="Add reference node to graph"
                    onClick={() => ed.addNodeAt("global/ref", undefined, { globalId: g.id })}
                  >
                    <Icon svg={Plus} class="size-3.5" />
                  </button>
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-destructive"
                    aria-label="Delete global"
                    onClick={() => ed.mutate((doc) => (doc.globals = doc.globals.filter((x) => x.id !== g.id)))}
                  >
                    <Icon svg={Trash2} class="size-3.5" />
                  </button>
                </div>
                <div class="grid grid-cols-2 gap-1.5">
                  <Select
                    class="h-7 text-xs"
                    value={g.kind}
                    options={[
                      { label: "uniform", value: "uniform" },
                      { label: "varying", value: "varying" },
                      { label: "const", value: "const" },
                    ]}
                    onChange={(v) => updateGlobal(g.id, (x) => (x.kind = v as GlobalDef["kind"]))}
                  />
                  <Select
                    class="h-7 text-xs"
                    value={g.type}
                    options={GLOBAL_TYPES.map((t) => ({ label: t, value: t }))}
                    onChange={(v) =>
                      updateGlobal(g.id, (x) => {
                        x.type = v;
                        x.value = defaultGlobalValue(v);
                      })
                    }
                  />
                </div>
                <GlobalValue global={g} session={session} />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

const LOOP_HELP: Record<LoopMode, string> = {
  count: "Runs Count times; Index goes 0 … Count − 1.",
  range: "Index runs from Start toward End while the comparison holds.",
  reverse: "Index counts down from Start − 1 to 0.",
  nested: "Runs Count × Count 2 times; Index and Index 2 are the two loop indices.",
  condition: "Runs while Condition is true (a while loop). Build the condition from the accumulator so it can end.",
};

function LoopSettings(props: { node: GraphNode }) {
  const ed = useContext(EditorContext);
  const mode = () => loopModeOf(props.node, ed.graph().nodes.filter((n) => n.parentId === props.node.id));
  const set = (key: string, v: string) => ed.setValue(props.node.id, key, v);
  return (
    <>
      <Field label="Mode">
        <Select value={mode()} options={LOOP_MODES} onChange={(v) => ed.setLoopMode(props.node.id, v as LoopMode)} />
      </Field>
      <Show when={mode() === "range" || mode() === "reverse"}>
        <Field label="Type">
          <Select
            value={props.node.data.values.loopType === "float" ? "float" : "int"}
            options={[
              { label: "Int", value: "int" },
              { label: "Float", value: "float" },
            ]}
            onChange={(v) => set("loopType", v)}
          />
        </Field>
        <Field label="Compare">
          <Select
            value={String(props.node.data.values.loopCompare ?? (mode() === "reverse" ? ">" : "<"))}
            options={LOOP_COMPARES.map((c) => ({ label: c, value: c }))}
            onChange={(v) => set("loopCompare", v)}
          />
        </Field>
      </Show>
      <p class="text-[11px] leading-relaxed text-muted-foreground">
        {LOOP_HELP[mode()]} Wire the next value into Output; the Accumulator holds the running value, and Output's port outside the
        loop is the result.
      </p>
    </>
  );
}
