import { For, Show, createMemo, createSignal, useContext } from "solid-js";
import { ChevronDown, ChevronRight, PanelLeftOpen, Search, Trash2, X } from "lucide-static";
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
        <div class="absolute top-2 left-2 z-20" data-ui>
          <Tooltip content="Show nodes" side="right">
            <button
              type="button"
              class="flex size-9 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-sm hover:text-foreground"
              onClick={() => ed.setState((s) => void (s.sidebarOpen = true))}
              aria-label="Show nodes"
            >
              <Icon svg={PanelLeftOpen} class="size-4" />
            </button>
          </Tooltip>
        </div>
      }
    >
      <aside class="flex h-full w-[208px] shrink-0 flex-col rounded-lg border bg-card" data-ui>
        <div class="flex items-center justify-between px-3 pt-3 pb-2">
          <span class="text-sm font-semibold">Nodes</span>
          <button
            type="button"
            aria-label="Hide nodes"
            class="text-muted-foreground hover:text-foreground"
            onClick={() => ed.setState((s) => void (s.sidebarOpen = false))}
          >
            <Icon svg={X} class="size-4" />
          </button>
        </div>
        <div class="px-2 pb-2">
          <div class="relative">
            <Icon svg={Search} class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              class="h-8 w-full rounded-md border border-input bg-transparent pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30"
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
        <div class="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <For each={categories()}>
            {(cat) => (
              <div>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                  onClick={() => toggle(cat.name)}
                >
                  <span class="flex-1 truncate">{cat.name}</span>
                  <span class="rounded-md bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">{cat.nodes.length}</span>
                  <Icon svg={isOpen(cat.name) ? ChevronDown : ChevronRight} class="size-3.5 text-muted-foreground" />
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
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={() => toggle("__custom")}
            >
              <span class="flex-1">Custom Nodes</span>
              <span class="rounded-md bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                {ed.state.doc.customNodes.length}
              </span>
              <Icon svg={isOpen("__custom") ? ChevronDown : ChevronRight} class="size-3.5 text-muted-foreground" />
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
                <div class="mt-2">
                  <Show
                    when={customNodes().length}
                    fallback={
                      <p class="px-1 py-2 text-[11px] leading-relaxed text-muted-foreground">
                        {customTab() === "community"
                          ? "Community sharing is not available in the local build."
                          : 'Select nodes and press Ctrl/Cmd + Alt + S to create a subgraph. Choose "Library" to reuse it across projects.'}
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
