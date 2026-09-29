import { createSignal } from "solid-js";
import type { XY } from "../../core/types";

// Transient editor UI state shared between canvas, toolbar and dialogs.

export interface PickerState {
  screen: XY;
  pending?: { from: { nodeId: string; side: "in" | "out"; key: string; type: string } };
}

export type ContextTarget = { kind: "canvas" } | { kind: "node"; id: string } | { kind: "edge"; id: string };

export type DialogName = "code" | "help" | "export" | "subgraph" | "clear" | "share" | "mcp" | null;

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error" | "success";
}

const [picker, setPicker] = createSignal<PickerState | null>(null);
const [context, setContext] = createSignal<{ screen: XY; target: ContextTarget } | null>(null);
const [toasts, setToasts] = createSignal<Toast[]>([]);
const [codeEditing, setCodeEditing] = createSignal<string | null>(null);
const [dialog, setDialog] = createSignal<DialogName>(null);
const [helpTab, setHelpTab] = createSignal<string>("guide");
const [findOpen, setFindOpen] = createSignal(false);
const [findHighlight, setFindHighlight] = createSignal<string | null>(null);
const [debugVersion, setDebugVersion] = createSignal(0);
const [previewExpanded, setPreviewExpanded] = createSignal(false);

const debugCanvases = new Map<string, HTMLCanvasElement>();
let toastId = 0;

export const ui = {
  picker,
  openPicker: (screen: XY, pending?: PickerState["pending"]) => {
    setContext(null);
    setPicker({ screen, pending });
  },
  closePicker: () => setPicker(null),

  context,
  openContext: (screen: XY, target: ContextTarget) => {
    setPicker(null);
    setContext({ screen, target });
  },
  closeMenus: () => {
    setPicker(null);
    setContext(null);
  },

  toasts,
  toast: (message: string, kind: Toast["kind"] = "info") => {
    const t = { id: ++toastId, message, kind };
    setToasts((l) => [...l, t]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== t.id)), 3500);
  },

  codeEditing,
  editCode: (nodeId: string | null) => setCodeEditing(nodeId),

  dialog,
  openDialog: (d: DialogName) => setDialog(d),
  closeDialog: () => setDialog(null),
  helpTab,
  openHelp: (tab = "guide") => {
    setHelpTab(tab);
    setDialog("help");
  },
  setHelpTab,

  findOpen,
  setFindOpen,
  findHighlight,
  setFindHighlight,

  previewExpanded,
  setPreviewExpanded,

  debugVersion,
  debugCanvases,
  registerDebugCanvas: (id: string, canvas: HTMLCanvasElement) => {
    debugCanvases.set(id, canvas);
    // called from a ref during render: signal after the render pass
    queueMicrotask(() => setDebugVersion((v) => v + 1));
  },

  /** Wired by EditorPage (needs the library + editor). */
  insertSubgraphById: (_id: string, _at?: XY) => {},
};
