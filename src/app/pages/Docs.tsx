import { For, Show, createMemo, createSignal } from "solid-js";
import { CATEGORY_ORDER, allNodeDefs, createProject, getNodeDef, makeNode, resolvePorts } from "tsl-graph";
import { A } from "../lib/router";
import { Input } from "tsl-graph/ui";
import { NodeCard } from "tsl-graph/editor";

export const slugOf = (type: string) => type.replace(/\//g, "--");
const typeOf = (slug: string) => slug.replace(/--/g, "/");

function DocsLayout(props: { children: unknown }) {
  return (
    <div class="min-h-screen bg-background text-foreground">
      <div class="mx-auto flex max-w-7xl gap-10 px-6 py-10">
        <aside class="sticky top-10 hidden h-fit w-40 shrink-0 md:block">
          <div class="mb-3 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">Docs</div>
          <A href="/docs/nodes" class="block rounded-md px-3 py-1.5 text-sm hover:bg-accent">
            Nodes
          </A>
          <A href="/dashboard" class="mt-6 block rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
            ← Editor
          </A>
        </aside>
        <main class="min-w-0 flex-1">{props.children as never}</main>
      </div>
    </div>
  );
}

export function DocsNodes() {
  const [q, setQ] = createSignal("");
  const categories = createMemo(() => {
    const query = q().toLowerCase().trim();
    const defs = allNodeDefs().filter((d) => !["Subgraph", "Code"].includes(d.category) && d.type !== "utils/group" && d.type !== "utils/portal");
    const order = [...CATEGORY_ORDER, "Loop"];
    return order
      .map((name) => ({
        name,
        nodes: defs
          .filter((d) => d.category === name)
          .filter((d) => !query || d.label.toLowerCase().includes(query) || d.type.toLowerCase().includes(query))
          .sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .filter((c) => c.nodes.length);
  });
  return (
    <DocsLayout>
      <h1 class="text-3xl font-semibold">Nodes</h1>
      <p class="mt-2 text-muted-foreground">Browse all built-in node types. Search by name or type.</p>
      <Input class="mt-4 max-w-md" placeholder="Search nodes..." value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
      <div class="mt-8 space-y-10">
        <For each={categories()}>
          {(cat) => (
            <section>
              <h2 class="mb-4 flex items-center gap-2 text-xl font-semibold">
                {cat.name}
                <span class="rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">{cat.nodes.length}</span>
              </h2>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <For each={cat.nodes}>
                  {(n) => (
                    <A
                      href={`/docs/nodes/${slugOf(n.type)}`}
                      class="rounded-lg border px-4 py-3 transition-colors hover:border-foreground/30 hover:bg-accent/40"
                    >
                      <div class="text-sm font-medium">{n.label}</div>
                      <div class="mt-1 font-mono text-xs text-muted-foreground">{n.type}</div>
                    </A>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </div>
    </DocsLayout>
  );
}

export function DocsNode(props: { slug: string }) {
  const def = createMemo(() => getNodeDef(typeOf(props.slug)));
  return (
    <DocsLayout>
      <Show when={def()} fallback={<div class="text-muted-foreground">Unknown node type.</div>}>
        {(d) => {
          const doc = createProject("docs");
          const node = createMemo(() => makeNode(d().type, { x: 0, y: 0 }));
          const ports = createMemo(() => resolvePorts(doc, node(), { forCanvas: true }));
          return (
            <div class="space-y-8">
              <div class="space-y-3">
                <div class="flex flex-wrap items-center gap-2">
                  <h1 class="text-3xl font-semibold">{d().label}</h1>
                  <span class="rounded-full border px-2 py-0.5 text-xs font-medium">{d().category}</span>
                </div>
                <div class="font-mono text-sm text-muted-foreground">{d().type}</div>
                <Show when={d().description}>
                  <p class="text-muted-foreground">{d().description}</p>
                </Show>
                <div class="flex flex-wrap gap-2">
                  <Show when={d().tsl && !d().tsl!.startsWith("__")}>
                    <span class="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">TSL: {d().tsl}</span>
                  </Show>
                  <Show when={d().importFrom}>
                    <span class="rounded-full bg-secondary px-2 py-0.5 font-mono text-xs">{d().importFrom}</span>
                  </Show>
                </div>
              </div>
              <section class="space-y-3">
                <h2 class="text-xl font-semibold">Node UI</h2>
                <div class="graph-canvas flex h-[320px] items-center justify-center rounded-xl border" style={{ "background-size": "20px 20px" }}>
                  <div class="pointer-events-none origin-center scale-[1.6]">
                    <NodeCard doc={doc} node={node()} inputs={ports().inputs} outputs={ports().outputs} static />
                  </div>
                </div>
              </section>
              <PortTable title="Inputs" ports={d().inputs} />
              <PortTable title="Outputs" ports={d().outputs} />
            </div>
          );
        }}
      </Show>
    </DocsLayout>
  );
}

function PortTable(props: { title: string; ports: { key: string; label: string; type: string; default?: unknown; connectionOnly?: boolean; propertyOnly?: boolean }[] }) {
  return (
    <section class="space-y-3">
      <h2 class="text-xl font-semibold">{props.title}</h2>
      <Show when={props.ports.length} fallback={<div class="text-sm text-muted-foreground">None</div>}>
        <div class="overflow-hidden rounded-lg border">
          <table class="w-full text-sm">
            <thead class="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <For each={["Key", "Label", "Type", "Default", "Flags"]}>{(h) => <th class="px-3 py-2 text-left font-medium">{h}</th>}</For>
              </tr>
            </thead>
            <tbody>
              <For each={props.ports}>
                {(p) => (
                  <tr class="border-t">
                    <td class="px-3 py-2 font-mono text-xs text-muted-foreground">{p.key}</td>
                    <td class="px-3 py-2">{p.label}</td>
                    <td class="px-3 py-2">
                      <span class="rounded-full bg-secondary px-2 py-0.5 text-xs">{p.type}</span>
                    </td>
                    <td class="px-3 py-2 font-mono text-xs">
                      {p.default === undefined ? "-" : typeof p.default === "object" ? JSON.stringify(p.default) : String(p.default)}
                    </td>
                    <td class="px-3 py-2 text-xs text-muted-foreground">
                      {[p.connectionOnly && "connection only", p.propertyOnly && "property only"].filter(Boolean).join(", ") || "-"}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </section>
  );
}
