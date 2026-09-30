import { For, Show, createMemo, createSignal, useContext } from "solid-js";
import { ChevronDown, ChevronRight, PanelLeftOpen, Plus, Search, Trash2, X } from "lucide-static";
import { libraryCategories } from "../../core/registry";
import type { GraphKind, NodeDef, SubgraphDef } from "../../core/types";
import { Icon, Tabs, Tooltip } from "../ui";
import { EditorContext, loadLibrary, removeFromLibrary } from "./store";

export function Sidebar() {
  const ed = useContext(EditorContext);
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal<Record<string, boolean>>({});
  const [customTab, setCustomTab] = createSignal<"project" | "library" | "community">("project");
  const [libVersion, setLibVersion] = createSignal(0);

  const graphKind = (): GraphKind => (ed.state.graph === "post" ? "post" : "material");
  const categories = createMemo(() => {
    const q = query().toLowerCase().trim();
    const cats = libraryCategories(graphKind());
    if (!q) return cats;
    return cats
      .map((c) => ({
        ...c,
        nodes: c.nodes.filter(
          (n) =>
            n.label.toLowerCase().includes(q) ||
            n.type.toLowerCase().includes(q) ||
            (n.tsl ?? "").toLowerCase().includes(q),
        ),
      }))
      .filter((c) => c.nodes.length);
  });

  const customNodes = createMemo<SubgraphDef[]>(() => {
    libVersion();
    const q = query().toLowerCase().trim();
    const list = customTab() === "project" ? ed.state.doc.customNodes : customTab() === "library" ? loadLibrary() : [];
    return q ? list.filter((s) => s.name.toLowerCase().includes(q)) : list;
  });

  const isOpen = (name: string) => !!query().trim() || !!open()[name];
  const toggle = (name: string) => setOpen((o) => ({ ...o, [name]: !o[name] }));

  const add = (def: NodeDef) => {
    if (def.kind === "loop") ed.createLoop();
    else ed.addNodeAt(def.type);
  };

  return (
    <Show
      when={ed.state.sidebarOpen}
      fallback={
        <div class="absolute top-0 left-0 z-20" data-ui>
          <Tooltip content="Show nodes" side="right">
            <button
              type="button"
              class="flex size-10 items-center justify-center rounded-xl border bg-sidebar text-muted-foreground shadow-lg hover:text-foreground"
              onClick={() => ed.setState((s) => void (s.sidebarOpen = true))}
              aria-label="Show nodes"
            >
              <Icon svg={PanelLeftOpen} class="size-4" />
            </button>
          </Tooltip>
        </div>
      }
    >
      <aside class="flex h-full w-52 shrink-0 flex-col overflow-hidden rounded-xl border bg-sidebar shadow-lg" data-ui>
        <div class="shrink-0 space-y-2 border-b px-3 py-2">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold">Nodes</h2>
          <button
            type="button"
            aria-label="Hide nodes"
            class="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => ed.setState((s) => void (s.sidebarOpen = false))}
          >
            <Icon svg={X} class="size-4" />
          </button>
        </div>
          <div class="relative">
            <Icon svg={Search} class="pointer-events-none absolute top-2.5 left-2 size-3.5 text-muted-foreground/70" />
            <input
              class="h-8 w-full rounded-md border border-input bg-transparent pr-3 pl-7 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30"
              placeholder="Search..."
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const first = categories()[0]?.nodes[0];
                  if (first) add(first);
                }
                if (e.key === "Escape") setQuery("");
              }}
            />
          </div>
        </div>
        <div class="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 py-0 pb-3">
          <For each={categories()}>
            {(cat) => (
              <div>
                <button
                  type="button"
                  class="group/label flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-foreground/70 hover:text-foreground"
                  onClick={() => toggle(cat.name)}
                >
                  <span class="truncate">{cat.name}</span>
                  <span class="inline-flex items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] leading-none font-medium text-muted-foreground">
                    {cat.nodes.length}
                  </span>
                  <Icon svg={isOpen(cat.name) ? ChevronDown : ChevronRight} class="ml-auto size-3.5 shrink-0 text-muted-foreground/70" />
                </button>
                <Show when={isOpen(cat.name)}>
                  <div class="mb-1">
                    <For each={cat.nodes}>
                      {(n) => (
                        <button
                          type="button"
                          draggable="true"
                          title={n.description ?? n.type}
                          class="block w-full truncate rounded-md py-1.5 pr-2 pl-5 text-left text-xs text-foreground/80 hover:bg-accent hover:text-foreground"
                          onClick={() => add(n)}
                          onDragStart={(e) => {
                            e.dataTransfer?.setData("application/x-tsl-node", n.type);
                            e.dataTransfer!.effectAllowed = "copy";
                          }}
                        >
                          {n.label}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>

          <div>
            <button
              type="button"
              class="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-foreground/70 hover:text-foreground"
              onClick={() => toggle("__custom")}
            >
              <span class="truncate">Custom Nodes</span>
              <span class="inline-flex items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] leading-none font-medium text-muted-foreground">
                {ed.state.doc.customNodes.length}
              </span>
              <Icon svg={isOpen("__custom") ? ChevronDown : ChevronRight} class="ml-auto size-3.5 shrink-0 text-muted-foreground/70" />
            </button>
            <Show when={isOpen("__custom")}>
              <div class="px-1 pt-1 pb-2">
                <Tabs
                  class="w-full"
                  value={customTab()}
                  onChange={setCustomTab}
                  tabs={[
                    { value: "project", label: "Project" },
                    { value: "library", label: "Library" },
                    { value: "community", label: "Community" },
                  ]}
                />
                <Show when={customTab() !== "community" && !ed.state.subgraph}>
                  <button
                    type="button"
                    class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-1.5 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                    onClick={() => ed.createSubgraph()}
                  >
                    <Icon svg={Plus} class="size-3" /> New subgraph
                  </button>
                </Show>
                <div class="mt-2">
                  <Show
                    when={customNodes().length}
                    fallback={
                      <p class="px-1 py-2 text-[11px] leading-relaxed text-muted-foreground">
                        {customTab() === "community"
                          ? "Community sharing is not available in the local build."
                          : 'Create a subgraph from selected nodes, or start an empty one. Choose "Library" in the subgraph bar to reuse it across projects.'}
                      </p>
                    }
                  >
                    <For each={customNodes()}>
                      {(sg) => (
                        <div class="group flex items-center">
                          <button
                            type="button"
                            draggable="true"
                            class="flex-1 truncate rounded-md py-1.5 pr-2 pl-3 text-left text-xs text-foreground/80 hover:bg-accent hover:text-foreground"
                            title={sg.description ?? sg.name}
                            onClick={() => ed.insertSubgraph(sg)}
                            onDragStart={(e) => {
                              e.dataTransfer?.setData("application/x-tsl-node", "subgraph/instance");
                              e.dataTransfer?.setData("application/x-tsl-subgraph", sg.id);
                            }}
                          >
                            {sg.name}
                          </button>
                          <Show when={customTab() === "library"}>
                            <button
                              type="button"
                              aria-label="Remove from library"
                              class="hidden p-1 text-muted-foreground group-hover:block hover:text-destructive"
                              onClick={() => {
                                removeFromLibrary(sg.id);
                                setLibVersion((v) => v + 1);
                              }}
                            >
                              <Icon svg={Trash2} class="size-3" />
                            </button>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </aside>
    </Show>
  );
}
