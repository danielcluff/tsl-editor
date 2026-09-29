import type { Editor } from "./store";
import { ui } from "./ui-state";

interface Shortcut {
  code: string;
  display: string;
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
}

// Same bindings as the original editor.
export const SHORTCUTS = {
  undo: { code: "KeyZ", display: "Ctrl/Cmd + Z", mod: true },
  redo: { code: "KeyZ", display: "Ctrl/Cmd + Shift + Z / Ctrl/Cmd + Y", mod: true, shift: true },
  copy: { code: "KeyC", display: "Ctrl/Cmd + C", mod: true },
  paste: { code: "KeyV", display: "Ctrl/Cmd + V", mod: true },
  find: { code: "KeyF", display: "Ctrl/Cmd + F", mod: true },
  pan: { code: "KeyH", display: "H" },
  select: { code: "KeyV", display: "V" },
  subgraph: { code: "KeyS", display: "Ctrl/Cmd + Alt + S", mod: true, alt: true },
  codeNode: { code: "KeyC", display: "Ctrl/Cmd + Alt + C", mod: true, alt: true },
  loop: { code: "KeyL", display: "L" },
  group: { code: "KeyG", display: "Ctrl/Cmd + G", mod: true },
  ungroup: { code: "KeyG", display: "Ctrl/Cmd + Shift + G", mod: true, shift: true },
  removeFromGroup: { code: "KeyG", display: "Alt + G", alt: true },
  multiOp: { code: "KeyM", display: "M" },
  expandMultiOp: { code: "KeyM", display: "Shift + M", shift: true },
  portal: { code: "KeyP", display: "P" },
  imageExport: { code: "KeyE", display: "Ctrl/Cmd + Shift + E", mod: true, shift: true },
  viewCode: { code: "KeyV", display: "Ctrl/Cmd + Alt + V", mod: true, alt: true },
  saveSubgraph: { code: "Enter", display: "Ctrl/Cmd + Enter", mod: true },
  cancelSubgraph: { code: "Escape", display: "Esc" },
} satisfies Record<string, Shortcut>;

export const SHORTCUT_LIST: { key: string; label: string }[] = [
  { key: SHORTCUTS.undo.display, label: "Undo" },
  { key: SHORTCUTS.redo.display, label: "Redo" },
  { key: SHORTCUTS.copy.display, label: "Copy Selection" },
  { key: SHORTCUTS.paste.display, label: "Paste" },
  { key: "Ctrl/Cmd + D", label: "Duplicate Selection" },
  { key: SHORTCUTS.find.display, label: "Find Notes" },
  { key: SHORTCUTS.pan.display, label: "Pan Mode" },
  { key: SHORTCUTS.select.display, label: "Selection Mode" },
  { key: SHORTCUTS.subgraph.display, label: "Create Subgraph" },
  { key: SHORTCUTS.codeNode.display, label: "Create Code Node" },
  { key: SHORTCUTS.loop.display, label: "Create Loop" },
  { key: SHORTCUTS.group.display, label: "Group Nodes" },
  { key: SHORTCUTS.ungroup.display, label: "Ungroup Nodes" },
  { key: SHORTCUTS.removeFromGroup.display, label: "Remove from Group" },
  { key: SHORTCUTS.multiOp.display, label: "Convert to Multi-op" },
  { key: SHORTCUTS.expandMultiOp.display, label: "Expand Multi-op" },
  { key: SHORTCUTS.portal.display, label: "Convert Edge to Portal" },
  { key: SHORTCUTS.imageExport.display, label: "Open Image Export" },
  { key: SHORTCUTS.viewCode.display, label: "View Code" },
  { key: SHORTCUTS.saveSubgraph.display, label: "Save & Exit Subgraph" },
  { key: SHORTCUTS.cancelSubgraph.display, label: "Cancel Subgraph Editing" },
  { key: "F", label: "Fit View" },
  { key: "Shift + Space / Double-click", label: "Quick Add Node" },
  { key: "Delete", label: "Delete Selection" },
  { key: "Shift + Click", label: "Add to Selection" },
  { key: "Shift + Drag", label: "Box Selection" },
  { key: "Middle Mouse / Space + Drag", label: "Pan Canvas" },
  { key: "Wheel", label: "Zoom" },
];

function matches(s: Shortcut, e: KeyboardEvent): boolean {
  const mod = e.metaKey || e.ctrlKey;
  return e.code === s.code && !!s.mod === mod && !!s.alt === e.altKey && !!s.shift === e.shiftKey;
}

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    t.isContentEditable ||
    !!t.closest('[contenteditable="true"], [role="dialog"], [role="menu"]') ||
    !!document.querySelector('[role="dialog"][data-state="open"]')
  );
}

export function installShortcuts(ed: Editor): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || typing(e)) return;
    const S = SHORTCUTS;
    const act = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (ed.state.subgraph) {
      if (matches(S.saveSubgraph, e)) return act(() => ed.exitSubgraph(true));
      if (e.code === "Escape" && !ed.state.selection.nodes.length) return act(() => ed.exitSubgraph(false));
    }
    if (matches(S.undo, e)) return act(ed.undo);
    if (matches(S.redo, e) || ((e.metaKey || e.ctrlKey) && e.code === "KeyY")) return act(ed.redo);
    if (matches(S.viewCode, e)) return act(() => ui.openDialog("code"));
    if (matches(S.codeNode, e)) return act(() => ed.addNodeAt("code/tsl", ed.screenToFlow(ed.pointer().x, ed.pointer().y)));
    if (matches(S.subgraph, e)) return act(() => ed.state.selection.nodes.length && !ed.state.subgraph && ui.openDialog("subgraph"));
    if (matches(S.copy, e)) return act(ed.copySelection);
    if (matches(S.paste, e)) return act(() => void ed.paste());
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === "KeyD") return act(ed.duplicateSelection);
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === "KeyA")
      return act(() => ed.select(ed.graph().nodes.map((n) => n.id)));
    if (matches(S.find, e)) return act(() => ui.setFindOpen(true));
    if (matches(S.imageExport, e)) return act(() => ui.openDialog("export"));
    if (matches(S.ungroup, e)) return act(ed.ungroupSelection);
    if (matches(S.group, e)) return act(ed.groupSelection);
    if (matches(S.removeFromGroup, e)) return act(ed.removeFromGroup);
    if (matches(S.expandMultiOp, e)) return act(ed.expandMultiOp);
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (matches(S.multiOp, e)) return act(ed.convertToMultiOp);
    if (matches(S.portal, e)) return act(() => ed.state.selection.edges.length && ed.edgeToPortal());
    if (matches(S.pan, e)) return act(() => ed.setState((s) => void (s.mode = "pan")));
    if (matches(S.select, e)) return act(() => ed.setState((s) => void (s.mode = "select")));
    if (matches(S.loop, e)) return act(() => ed.createLoop(ed.screenToFlow(ed.pointer().x, ed.pointer().y)));
    if (e.code === "KeyF" && !e.shiftKey) return act(() => ed.fitView(ed.state.selection.nodes.length ? [...ed.state.selection.nodes] : undefined));
    if (e.code === "Delete" || e.code === "Backspace") return act(ed.deleteSelection);
    if (e.code === "Escape") return act(() => (ui.closeMenus(), ed.clearSelection()));
    if (e.code === "Space" && e.shiftKey) return act(() => ui.openPicker(ed.pointer()));
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
