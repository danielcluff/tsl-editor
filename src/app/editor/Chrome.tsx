import { For, Show, createMemo, createSignal, useContext } from "solid-js";
import { Portal } from "@solidjs/web";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Code,
  Copy,
  Download,
  Ellipsis,
  Eraser,
  FileCode2,
  FolderOpen,
  GraduationCap,
  Group,
  Hand,
  Image,
  Keyboard,
  Layers,
  LayoutGrid,
  MousePointer2,
  Plug,
  Redo2,
  Repeat,
  Scan,
  Share2,
  Sparkles,
  Trash2,
  Undo2,
  Waypoints,
  X,
} from "lucide-static";
import { getNodeDef } from "../../core/registry";
import { A } from "../lib/router";
import { Icon, MenuItem, MenuLabel, MenuSeparator, Popover, Tooltip, togglePopover, type PopoverAnchor } from "../ui";
import { Logo } from "../pages/shared";
import { EditorContext, PAN_MODE_ENABLED } from "./store";
import { ChatContext } from "./ai-chat";
import { ui } from "./ui-state";
import { SHORTCUTS } from "./shortcuts";

// ---------------------------------------------------------------------------
// top bar
// ---------------------------------------------------------------------------

export function TopBar(props: { embed?: boolean; onSaveJson: () => void; onLoadJson: () => void }) {
  const ed = useContext(EditorContext);
  const [menu, setMenu] = createSignal<PopoverAnchor | null>(null);
  const sg = createMemo(() =>
    ed.state.subgraph ? ed.state.doc.customNodes.find((s) => s.id === ed.state.subgraph!.subgraphId) : undefined,
  );
  return (
    <div class="@container absolute top-0 right-0 left-0 z-20 flex h-10 items-center gap-3 border-b bg-card/90 px-3 backdrop-blur" data-ui>
      <A href="/dashboard" aria-label="Go to dashboard" class="shrink-0">
        <Logo />
      </A>
      <div class="h-5 w-px bg-border" />
      <Show
        when={!ed.state.subgraph}
        fallback={
          <div class="flex min-w-0 items-center gap-2 text-xs">
            <span class="shrink-0" title="Editing subgraph">
              <Icon svg={Layers} class="size-3.5 text-blue-400" />
            </span>
            {/* the label only shows when the bar is wide enough to keep the name readable */}
            <span class="hidden shrink-0 whitespace-nowrap text-muted-foreground @xl:inline">Editing subgraph</span>
            <input
              aria-label="Subgraph name"
              placeholder="Subgraph Name"
              class="h-7 w-36 min-w-24 rounded-md border border-transparent bg-transparent px-1.5 text-xs font-medium outline-none hover:border-border focus:border-border focus:bg-background"
              value={ed.state.subgraph?.nameDraft ?? sg()?.name ?? ""}
              onInput={(e) => ed.setSubgraphDraft({ name: e.currentTarget.value })}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            <select
              aria-label="Scope"
              title="Scope: Project = only in this project. Library = available in all your projects."
              class="h-7 shrink-0 rounded-md border border-border bg-background/60 px-1.5 text-xs text-foreground outline-none"
              value={ed.state.subgraph?.scopeDraft ?? "project"}
              onChange={(e) => ed.setSubgraphDraft({ scope: e.currentTarget.value as "project" | "library" })}
            >
              <option value="project">Project</option>
              <option value="library">Library</option>
            </select>
          </div>
        }
      >
        <input
          aria-label="Project name"
          class="w-40 min-w-0 truncate rounded-md bg-transparent px-1.5 py-1 text-xs font-medium outline-none hover:bg-accent focus:bg-accent"
          value={ed.state.doc.name}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim() || "Untitled";
            if (v !== ed.state.doc.name) ed.mutate((d) => void (d.name = v), { history: false, recompile: false });
          }}
        />
        <div class="flex h-7 items-center rounded-md bg-muted p-0.5 text-[11px]">
          <For each={["material", "post"] as const}>
            {(g) => (
              <button
                type="button"
                class={[
                  "h-full rounded-[5px] px-2.5 font-medium capitalize transition-colors",
                  ed.state.graph === g ? "bg-background text-foreground shadow-sm dark:bg-input/40" : "text-muted-foreground hover:text-foreground",
                ]}
                onClick={() => ed.setGraph(g)}
              >
                {g}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="flex-1" />
      <SaveBadge />
      <Show when={!props.embed}>
        <Tooltip content="Share Project" side="bottom">
          <button
            type="button"
            aria-label="Share project"
            class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => ui.openDialog("share")}
          >
            <Icon svg={Share2} class="size-3.5" />
          </button>
        </Tooltip>
      </Show>
      <button
        type="button"
        title="More options"
        aria-label="More options"
        class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={(e) => togglePopover(menu(), setMenu, e)}
      >
        <Icon svg={Ellipsis} class="size-4" />
      </button>
      <Popover open={!!menu()} anchor={menu()?.rect} trigger={menu()?.el} align="end" onClose={() => setMenu(null)} class="w-56">
        <MenuLabel>File</MenuLabel>
        <MenuItem icon={Download} onSelect={() => (setMenu(null), props.onSaveJson())}>
          Save to JSON
        </MenuItem>
        <MenuItem icon={FolderOpen} onSelect={() => (setMenu(null), props.onLoadJson())}>
          Load from JSON
        </MenuItem>
        <MenuItem icon={Eraser} destructive onSelect={() => (setMenu(null), ui.openDialog("clear"))}>
          Clear graph
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Help</MenuLabel>
        <MenuItem icon={BookOpen} onSelect={() => (setMenu(null), window.open("/docs/nodes", "_blank"))}>
          Documentation
        </MenuItem>
        <MenuItem icon={GraduationCap} onSelect={() => (setMenu(null), ui.openHelp("guide"))}>
          User guide
        </MenuItem>
        <MenuItem icon={Keyboard} onSelect={() => (setMenu(null), ui.openHelp("shortcuts"))}>
          Keyboard shortcuts
        </MenuItem>
        <MenuItem icon={LayoutGrid} onSelect={() => (setMenu(null), ui.openHelp("tutorials"))}>
          Interactive tutorials
        </MenuItem>
        <MenuItem icon={Plug} onSelect={() => (setMenu(null), ui.openDialog("mcp"))}>
          Connect agent (MCP)
        </MenuItem>
      </Popover>
    </div>
  );
}

function SaveBadge() {
  const ed = useContext(EditorContext);
  const label = () =>
    ({ saved: "Saved", unsaved: "Unsaved", saving: "Saving…", error: "Save failed" })[ed.state.saveState];
  return (
    <span
      class={[
        "rounded-full border px-2.5 py-0.5 text-[10px] font-medium",
        ed.state.saveState === "saved"
          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
          : ed.state.saveState === "error"
            ? "border-red-500/30 bg-red-500/15 text-red-400"
            : "border-amber-500/30 bg-amber-500/10 text-amber-400",
      ]}
    >
      {label()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// bottom toolbar
// ---------------------------------------------------------------------------

function ToolButton(props: { icon: string; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Tooltip content={props.label} side="top">
      <button
        type="button"
        aria-label={props.label}
        disabled={props.disabled}
        class={[
          "flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-35",
          props.active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
        ]}
        onClick={() => props.onClick()}
      >
        <Icon svg={props.icon} class="size-4" />
      </button>
    </Tooltip>
  );
}

export function Toolbar() {
  const ed = useContext(EditorContext);
  const chat = useContext(ChatContext);
  const k = (name: keyof typeof SHORTCUTS) => SHORTCUTS[name].display;
  return (
    <Show when={!ed.state.subgraph} fallback={<SubgraphBar />}>
    <div class="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border bg-card/95 p-1 shadow-lg backdrop-blur" data-ui>
      <Show when={PAN_MODE_ENABLED}>
        <ToolButton icon={Hand} label={`Pan Mode (${k("pan")})`} active={ed.state.mode === "pan"} onClick={() => ed.setState((s) => void (s.mode = "pan"))} />
        <ToolButton
          icon={MousePointer2}
          label={`Selection Mode (${k("select")})`}
          active={ed.state.mode === "select"}
          onClick={() => ed.setState((s) => void (s.mode = "select"))}
        />
        <div class="mx-1 h-5 w-px bg-border" />
      </Show>
      <ToolButton
        icon={Layers}
        label={`Create Subgraph (${k("subgraph")})`}
        onClick={() => ed.createSubgraph()}
      />
      <ToolButton icon={FileCode2} label={`Create Code Node (${k("codeNode")})`} onClick={() => ed.addNodeAt("code/tsl")} />
      <ToolButton icon={Repeat} label={`Create Loop (${k("loop")})`} onClick={() => ed.createLoop()} />
      <ToolButton icon={Group} label={`Group Nodes (${k("group")})`} disabled={!ed.state.selection.nodes.length} onClick={() => ed.groupSelection()} />
      <div class="mx-1 h-5 w-px bg-border" />
      <ToolButton icon={Undo2} label={`Undo (${k("undo")})`} disabled={!ed.state.canUndo} onClick={() => ed.undo()} />
      <ToolButton icon={Redo2} label={`Redo (${k("redo")})`} disabled={!ed.state.canRedo} onClick={() => ed.redo()} />
      <div class="mx-1 h-5 w-px bg-border" />
      <ToolButton icon={Scan} label="Fit View" onClick={() => ed.fitView()} />
      <ToolButton icon={Image} label={`Open Image Export (${k("imageExport")})`} onClick={() => ui.openDialog("export")} />
      <ToolButton icon={Code} label={`View Code (${k("viewCode")})`} onClick={() => ui.openDialog("code")} />
      <div class="mx-1 h-5 w-px bg-border" />
      <ToolButton
        icon={Sparkles}
        label={`AI Assistant (${k("aiChat")})`}
        active={chat.state.open && !chat.state.minimized}
        onClick={() =>
          chat.setState((d) => {
            d.open = !(d.open && !d.minimized);
            d.minimized = false;
          })
        }
      />
    </div>
    </Show>
  );
}

/**
 * Replaces the toolbar while a subgraph is open: the tools that make sense
 * inside it, and Save & Exit / Cancel. (Name and scope are in the top bar.)
 */
function SubgraphBar() {
  const ed = useContext(EditorContext);
  const k = (name: keyof typeof SHORTCUTS) => SHORTCUTS[name].display;
  const session = () => ed.state.subgraph!;
  return (
    <form
      class="thin-scroll absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border-2 border-blue-500/70 bg-card/95 p-1.5 shadow-lg backdrop-blur"
      data-ui
      onSubmit={(e) => {
        e.preventDefault();
        ed.exitSubgraph(true);
      }}
    >
      <Icon svg={Layers} class="mx-1 size-4 shrink-0 text-blue-400" />
      <ToolButton icon={FileCode2} label={`Create Code Node (${k("codeNode")})`} onClick={() => ed.addNodeAt("code/tsl")} />
      <ToolButton icon={Repeat} label={`Create Loop (${k("loop")})`} onClick={() => ed.createLoop()} />
      <ToolButton icon={Group} label={`Group Nodes (${k("group")})`} disabled={!ed.state.selection.nodes.length} onClick={() => ed.groupSelection()} />
      <div class="mx-1 h-5 w-px bg-border" />
      <ToolButton icon={Undo2} label={`Undo (${k("undo")})`} disabled={!ed.state.canUndo} onClick={() => ed.undo()} />
      <ToolButton icon={Redo2} label={`Redo (${k("redo")})`} disabled={!ed.state.canRedo} onClick={() => ed.redo()} />
      <ToolButton icon={Scan} label="Fit View" onClick={() => ed.fitView()} />
      <div class="mx-1 h-5 w-px bg-border" />
      <Tooltip content={session().isNew ? "Discard this new subgraph (Esc)" : "Discard changes (Esc)"} side="top">
        <button
          type="button"
          class="h-7 shrink-0 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => ed.exitSubgraph(false)}
        >
          Cancel
        </button>
      </Tooltip>
      <Tooltip content={`Save & Exit (${k("saveSubgraph")})`} side="top">
        <button type="submit" class="h-7 shrink-0 rounded-md bg-blue-600 px-3 text-xs font-medium whitespace-nowrap text-white hover:bg-blue-500">
          Save & Exit
        </button>
      </Tooltip>
    </form>
  );
}

// ---------------------------------------------------------------------------
// context menu
// ---------------------------------------------------------------------------

export function ContextMenu() {
  const ed = useContext(EditorContext);
  const close = () => ui.closeMenus();
  const rect = () => {
    const c = ui.context();
    return c ? new DOMRect(c.screen.x, c.screen.y, 0, 0) : undefined;
  };
  const node = () => {
    const c = ui.context();
    return c?.target.kind === "node" ? ed.nodesById().get(c.target.id) : undefined;
  };
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <Popover open={!!ui.context()} anchor={rect()} onClose={close} class="w-56">
      <Show when={ui.context()?.target.kind === "canvas"}>
        <MenuItem onSelect={run(() => ui.openPicker(ui.context()!.screen))}>Add node…</MenuItem>
        <MenuItem shortcut={SHORTCUTS.paste.display} onSelect={run(() => void ed.paste(ed.screenToFlow(ui.context()!.screen.x, ui.context()!.screen.y)))}>
          Paste
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={FileCode2} onSelect={run(() => ed.addNodeAt("code/tsl", ed.screenToFlow(ui.context()!.screen.x, ui.context()!.screen.y)))}>
          Create Code Node
        </MenuItem>
        <MenuItem icon={Repeat} onSelect={run(() => ed.createLoop(ed.screenToFlow(ui.context()!.screen.x, ui.context()!.screen.y)))}>
          Create Loop
        </MenuItem>
        <MenuItem onSelect={run(() => ed.addNodeAt("utils/comment", ed.screenToFlow(ui.context()!.screen.x, ui.context()!.screen.y)))}>
          Add Comment
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={Scan} onSelect={run(() => ed.fitView())}>
          Fit View
        </MenuItem>
        <MenuItem icon={LayoutGrid} onSelect={run(() => ed.autoLayout())}>
          Auto Layout
        </MenuItem>
      </Show>
      <Show when={node()}>
        {(n) => (
          <>
            <Show when={getNodeDef(n().type)?.kind === "subgraph"}>
              <MenuItem icon={Layers} onSelect={run(() => n().data.subgraphId && ed.enterSubgraph(n().data.subgraphId!))}>
                Edit Subgraph
              </MenuItem>
            </Show>
            <Show when={getNodeDef(n().type)?.kind === "code"}>
              <MenuItem icon={Code} onSelect={run(() => ui.editCode(n().id))}>
                Edit Code
              </MenuItem>
            </Show>
            <MenuItem icon={Copy} shortcut={SHORTCUTS.copy.display} onSelect={run(() => ed.copySelection())}>
              Copy
            </MenuItem>
            <MenuItem onSelect={run(() => ed.duplicateSelection())}>Duplicate</MenuItem>
            <MenuItem onSelect={run(() => ed.updateData(n().id, (x) => (x.data.debug = !x.data.debug), { recompile: false }))}>
              Toggle Debug Preview
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={Group} shortcut={SHORTCUTS.group.display} onSelect={run(() => ed.groupSelection())}>
              Group
            </MenuItem>
            <Show when={n().parentId}>
              <MenuItem shortcut={SHORTCUTS.removeFromGroup.display} onSelect={run(() => ed.removeFromGroup())}>
                Remove from Group
              </MenuItem>
            </Show>
            <Show when={!ed.state.subgraph}>
              <MenuItem icon={Layers} shortcut={SHORTCUTS.subgraph.display} onSelect={run(() => ed.createSubgraph())}>
                Create Subgraph
              </MenuItem>
            </Show>
            <Show when={["math/add", "math/sub", "math/mul", "math/div", "math/mod", "math/pow", "math/min", "math/max"].includes(n().type)}>
              <MenuItem shortcut={SHORTCUTS.multiOp.display} onSelect={run(() => ed.convertToMultiOp())}>
                Convert to Multi-op
              </MenuItem>
            </Show>
            <Show when={n().type === "math/multiOp"}>
              <MenuItem shortcut={SHORTCUTS.expandMultiOp.display} onSelect={run(() => ed.expandMultiOp())}>
                Expand Multi-op
              </MenuItem>
            </Show>
            <MenuSeparator />
            <MenuItem icon={Trash2} destructive shortcut="Del" onSelect={run(() => ed.deleteSelection())}>
              Delete
            </MenuItem>
          </>
        )}
      </Show>
      <Show when={ui.context()?.target.kind === "edge"}>
        <MenuItem icon={Waypoints} shortcut={SHORTCUTS.portal.display} onSelect={run(() => ed.edgeToPortal())}>
          Convert Edge to Portal
        </MenuItem>
        <MenuItem icon={Trash2} destructive onSelect={run(() => ed.deleteSelection())}>
          Delete Connection
        </MenuItem>
      </Show>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// find notes
// ---------------------------------------------------------------------------

export function FindBar() {
  const ed = useContext(EditorContext);
  const [q, setQ] = createSignal("");
  const [idx, setIdx] = createSignal(0);
  const matches = createMemo(() => {
    const query = q().toLowerCase().trim();
    if (!query) return [];
    return ed
      .graph()
      .nodes.filter((n) => {
        const text = `${n.data.text ?? ""} ${n.data.label ?? ""} ${getNodeDef(n.type)?.label ?? ""}`.toLowerCase();
        return text.includes(query);
      })
      .map((n) => n.id);
  });
  const go = (i: number) => {
    const m = matches();
    if (!m.length) return;
    const j = ((i % m.length) + m.length) % m.length;
    setIdx(j);
    ui.setFindHighlight(m[j]);
    ed.select([m[j]]);
    ed.fitView([m[j]], 220);
  };
  const close = () => {
    ui.setFindOpen(false);
    ui.setFindHighlight(null);
  };
  return (
    <Show when={ui.findOpen()}>
      <div class="absolute top-12 right-3 z-30 flex items-center gap-1 rounded-lg border bg-card p-1 shadow-lg" data-ui>
        <input
          class="h-7 w-48 rounded-md bg-transparent px-2 text-xs outline-none"
          placeholder="Find notes..."
          value={q()}
          ref={(i) => requestAnimationFrame(() => i.focus())}
          onInput={(e) => {
            setQ(e.currentTarget.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") go(e.shiftKey ? idx() - 1 : matches().length && ui.findHighlight() ? idx() + 1 : 0);
            if (e.key === "Escape") close();
          }}
        />
        <span class="w-10 text-center font-mono text-[10px] text-muted-foreground">
          {matches().length ? `${idx() + 1}/${matches().length}` : "0/0"}
        </span>
        <button type="button" title="Previous match" class="rounded p-1 text-muted-foreground hover:bg-accent" onClick={() => go(idx() - 1)}>
          <Icon svg={ChevronUp} class="size-3.5" />
        </button>
        <button type="button" title="Next match" class="rounded p-1 text-muted-foreground hover:bg-accent" onClick={() => go(idx() + 1)}>
          <Icon svg={ChevronDown} class="size-3.5" />
        </button>
        <button type="button" title="Close" class="rounded p-1 text-muted-foreground hover:bg-accent" onClick={close}>
          <Icon svg={X} class="size-3.5" />
        </button>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// toasts
// ---------------------------------------------------------------------------

export function Toasts() {
  return (
    <Portal>
      <div class="pointer-events-none fixed bottom-4 left-1/2 z-[120] flex -translate-x-1/2 flex-col items-center gap-2">
        <For each={ui.toasts()}>
          {(t) => (
            <div
              class={[
                "pointer-events-auto rounded-md border px-3 py-2 text-xs shadow-lg",
                t.kind === "error"
                  ? "border-red-500/40 bg-red-950/90 text-red-100"
                  : t.kind === "success"
                    ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-100"
                    : "bg-popover text-popover-foreground",
              ]}
            >
              {t.message}
            </div>
          )}
        </For>
      </div>
    </Portal>
  );
}
