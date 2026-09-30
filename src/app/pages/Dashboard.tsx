import { For, Show, createMemo, createSignal, onSettled } from "solid-js";
import {
  Copy,
  Download,
  EllipsisVertical,
  FileUp,
  LogOut,
  Moon,
  Pencil,
  Plug,
  Plus,
  Search,
  Sun,
  Trash2,
} from "lucide-static";
import type { ProjectDoc, ProjectSummary } from "../../core/types";
import { TEMPLATES, projectFromTemplate } from "../../core/templates";
import { importTslGraph, isTslGraphExport, summarizeImport } from "../../core/import-tslgraph";
import { api } from "../lib/api";
import { A, navigate } from "../lib/router";
import { signOut, user } from "../lib/session";
import { theme, toggleTheme } from "../lib/theme";
import { Button, Dialog, Icon, Input, MenuItem, MenuSeparator, Popover, togglePopover, type PopoverAnchor } from "../ui";
import { Logo, timeAgo } from "./shared";

export function Dashboard() {
  const [projects, setProjects] = createSignal<ProjectSummary[] | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");
  const [menu, setMenu] = createSignal<(PopoverAnchor & { id: string }) | null>(null);
  const [userMenu, setUserMenu] = createSignal<PopoverAnchor | null>(null);
  const [renaming, setRenaming] = createSignal<ProjectSummary | null>(null);
  const [renameText, setRenameText] = createSignal("");
  const [deleting, setDeleting] = createSignal<ProjectSummary | null>(null);
  const [mcpOpen, setMcpOpen] = createSignal(false);

  const refresh = async () => {
    try {
      setProjects(await api.list());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  onSettled(() => {
    if (!user()) {
      navigate("/sign-in?redirect=%2Fdashboard", { replace: true });
      return;
    }
    void refresh();
  });

  const filtered = createMemo(() => {
    const q = query().toLowerCase().trim();
    const list = projects() ?? [];
    return q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list;
  });

  const createFrom = async (templateId: string) => {
    const doc = projectFromTemplate(templateId);
    const saved = await api.create(doc.name, doc);
    navigate(`/editor/${saved.id}`);
  };

  const duplicate = async (id: string) => {
    const doc = await api.get(id);
    await api.create(`${doc.name} (copy)`, doc);
    await refresh();
  };

  const download = async (id: string) => {
    const doc = await api.get(id);
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.name.replace(/[^\w-]+/g, "_") || "project"}.tsl-graph.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const json = JSON.parse(await file.text());
        const fallbackName = file.name.replace(/\.json$/i, "");
        let doc: ProjectDoc;
        let summary: string | null = null;
        if (isTslGraphExport(json)) {
          // export from tsl-graph.xyz
          const result = importTslGraph(json, fallbackName);
          doc = result.doc;
          summary = summarizeImport(result.report);
        } else if ((json as ProjectDoc).graphs?.material) {
          doc = json as ProjectDoc;
        } else {
          throw new Error("Not a TSL Graph project file");
        }
        const saved = await api.create(doc.name ?? fallbackName, doc);
        if (summary) {
          try {
            sessionStorage.setItem(`tsl-import-summary-${saved.id}`, summary);
          } catch {
            // the summary is a nicety
          }
        }
        navigate(`/editor/${saved.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    input.click();
  };

  return (
    <div class="min-h-screen bg-background">
      <header class="border-b">
        <div class="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <A href="/">
            <Logo size="md" />
          </A>
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMcpOpen(true)}>
              <Icon svg={Plug} class="size-4" /> Connect agent
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={toggleTheme}>
              <Icon svg={theme() === "dark" ? Sun : Moon} class="size-4" />
            </Button>
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold"
              onClick={(e) => togglePopover(userMenu(), setUserMenu, e)}
              aria-label="Account"
            >
              {user()?.name.slice(0, 1) ?? "G"}
            </button>
          </div>
        </div>
      </header>

      <main class="mx-auto max-w-7xl px-6 py-8">
        <section>
          <h2 class="mb-3 text-sm font-medium text-muted-foreground">Start a new project</h2>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <For each={TEMPLATES}>
              {(t) => (
                <button
                  type="button"
                  class="group flex flex-col gap-1 rounded-lg border bg-card p-3 text-left transition-colors hover:border-foreground/30"
                  onClick={() => void createFrom(t.id)}
                >
                  <div class="flex h-16 items-center justify-center rounded-md bg-muted/60">
                    <Show when={t.id === "blank"} fallback={<TemplateGlyph id={t.id} />}>
                      <Icon svg={Plus} class="size-6 text-muted-foreground group-hover:text-foreground" />
                    </Show>
                  </div>
                  <div class="mt-1 text-sm font-medium">{t.name}</div>
                  <div class="line-clamp-2 text-xs text-muted-foreground">{t.description}</div>
                </button>
              )}
            </For>
          </div>
        </section>

        <section class="mt-10">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h1 class="text-xl font-semibold">Projects</h1>
            <div class="flex items-center gap-2">
              <div class="relative">
                <Icon svg={Search} class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  class="w-56 pl-8"
                  placeholder="Search projects..."
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                />
              </div>
              <Button variant="outline" size="sm" onClick={importJson}>
                <Icon svg={FileUp} class="size-4" /> Import
              </Button>
              <Button size="sm" onClick={() => void createFrom("blank")}>
                <Icon svg={Plus} class="size-4" /> New Project
              </Button>
            </div>
          </div>

          <Show when={error()}>
            <div class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error()}
            </div>
          </Show>

          <Show
            when={projects()}
            fallback={<div class="py-20 text-center text-sm text-muted-foreground">Loading projects…</div>}
          >
            <Show
              when={filtered().length > 0}
              fallback={
                <div class="rounded-lg border border-dashed py-20 text-center text-sm text-muted-foreground">
                  {query() ? "No projects match your search." : "No projects yet. Start one from a template above."}
                </div>
              }
            >
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <For each={filtered()}>
                  {(p) => (
                    <div class="group relative overflow-hidden rounded-lg border bg-card transition-colors hover:border-foreground/30">
                      <A href={`/editor/${p.id}`} class="block">
                        <div class="aspect-[16/10] bg-muted/40">
                          <Show
                            when={p.thumbnail}
                            fallback={
                              <div class="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
                                no preview
                              </div>
                            }
                          >
                            <img src={p.thumbnail} alt="" class="h-full w-full object-cover" />
                          </Show>
                        </div>
                        <div class="px-3 py-2.5">
                          <div class="truncate pr-6 text-sm font-medium">{p.name}</div>
                          <div class="mt-0.5 text-xs text-muted-foreground">
                            {p.nodeCount} nodes · edited {timeAgo(p.updatedAt)}
                          </div>
                        </div>
                      </A>
                      <button
                        type="button"
                        aria-label="Project actions"
                        class="absolute right-2 bottom-3 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={(e) => togglePopover(menu(), (a) => setMenu(a && { ...a, id: p.id }), e)}
                      >
                        <Icon svg={EllipsisVertical} class="size-4" />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </section>
      </main>

      <Popover open={!!menu()} anchor={menu()?.rect} trigger={menu()?.el} align="end" onClose={() => setMenu(null)}>
        <MenuItem
          icon={Pencil}
          onSelect={() => {
            const p = projects()?.find((x) => x.id === menu()?.id);
            setMenu(null);
            if (p) {
              setRenameText(p.name);
              setRenaming(p);
            }
          }}
        >
          Rename
        </MenuItem>
        <MenuItem
          icon={Copy}
          onSelect={() => {
            const id = menu()!.id;
            setMenu(null);
            void duplicate(id);
          }}
        >
          Duplicate
        </MenuItem>
        <MenuItem
          icon={Download}
          onSelect={() => {
            const id = menu()!.id;
            setMenu(null);
            void download(id);
          }}
        >
          Download JSON
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={Trash2}
          destructive
          onSelect={() => {
            const p = projects()?.find((x) => x.id === menu()?.id);
            setMenu(null);
            if (p) setDeleting(p);
          }}
        >
          Delete
        </MenuItem>
      </Popover>

      <Popover open={!!userMenu()} anchor={userMenu()?.rect} trigger={userMenu()?.el} align="end" onClose={() => setUserMenu(null)}>
        <div class="px-2 py-1.5 text-sm font-medium">{user()?.name ?? "Guest"}</div>
        <MenuSeparator />
        <MenuItem
          icon={LogOut}
          onSelect={() => {
            signOut();
            navigate("/");
          }}
        >
          Sign out
        </MenuItem>
      </Popover>

      <Dialog open={!!renaming()} onClose={() => setRenaming(null)} title="Rename project">
        <form
          class="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const p = renaming();
            if (!p) return;
            const doc = await api.get(p.id);
            doc.name = renameText().trim() || "Untitled";
            await api.save(doc);
            setRenaming(null);
            await refresh();
          }}
        >
          <Input value={renameText()} onInput={(e) => setRenameText(e.currentTarget.value)} autofocus />
          <div class="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={!!deleting()}
        onClose={() => setDeleting(null)}
        title="Delete project?"
        description={`"${deleting()?.name ?? ""}" will be permanently deleted. This cannot be undone.`}
      >
        <div class="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              const p = deleting();
              setDeleting(null);
              if (p) {
                await api.remove(p.id);
                await refresh();
              }
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>

      <McpDialog open={mcpOpen()} onClose={() => setMcpOpen(false)} />
    </div>
  );
}

function TemplateGlyph(props: { id: string }) {
  const bg: Record<string, string> = {
    gradient: "radial-gradient(circle at 40% 35%, #fde047, #10b981 45%, #1d4ed8 80%)",
    "noise-displace": "radial-gradient(circle at 40% 35%, #f472b6, #7c3aed 50%, #1e3a8a 85%)",
    fresnel: "radial-gradient(circle at 50% 50%, #0b1020 55%, #38bdf8 85%)",
    marble: "radial-gradient(circle at 40% 35%, #f0f8ff, #9aa8f0 55%, #4545d3 90%)",
    bloom: "radial-gradient(circle at 50% 50%, #ffd7a8 10%, #ff5a1f 40%, transparent 72%)",
  };
  return <div class="size-11 rounded-full shadow-inner" style={{ background: bg[props.id] ?? "#555" }} />;
}

export function McpDialog(props: { open: boolean; onClose: () => void }) {
  const origin = location.origin;
  const httpCmd = `claude mcp add --transport http tsl-graph ${origin}/mcp`;
  const [copied, setCopied] = createSignal<string | null>(null);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1200);
  };
  const json = JSON.stringify({ mcpServers: { "tsl-graph": { type: "http", url: `${origin}/mcp` } } }, null, 2);
  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="Connect an agent (MCP)"
      description="Agents act on the project open in your editor tab — edits show up live, with undo."
      class="max-w-xl"
    >
      <div class="space-y-4 text-sm">
        <div>
          <div class="mb-1.5 font-medium">Claude Code</div>
          <CopyBlock text={httpCmd} copied={copied() === httpCmd} onCopy={() => copy(httpCmd)} />
        </div>
        <div>
          <div class="mb-1.5 font-medium">Any MCP client (HTTP)</div>
          <CopyBlock text={json} copied={copied() === json} onCopy={() => copy(json)} />
        </div>
        <div>
          <div class="mb-1.5 font-medium">stdio-only clients</div>
          <CopyBlock
            text={`pnpm --dir ${"<repo>"} mcp:stdio`}
            copied={false}
            onCopy={() => copy("pnpm mcp:stdio")}
          />
          <p class="mt-1.5 text-xs text-muted-foreground">Proxies stdio to this server; keep the editor server running.</p>
        </div>
      </div>
    </Dialog>
  );
}

function CopyBlock(props: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div class="flex items-start gap-1 rounded-md border bg-muted/50">
      <pre class="thin-scroll min-w-0 flex-1 overflow-x-auto p-3 font-mono text-xs whitespace-pre">{props.text}</pre>
      <Button variant="ghost" size="xs" class="mt-2 mr-2 shrink-0" onClick={props.onCopy}>
        <Icon svg={Copy} class="size-3" /> {props.copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
