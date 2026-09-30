import { Show, createSignal, onSettled, snapshot, untrack } from "solid-js";
import { projectFromTemplate } from "../../core/templates";
import type { ProjectDoc } from "../../core/types";
import { api } from "../lib/api";
import { navigate, search } from "../lib/router";
import { user } from "../lib/session";
import { Canvas } from "./Canvas";
import { ContextMenu, FindBar, Toasts, TopBar, Toolbar } from "./Chrome";
import { Dialogs } from "./Dialogs";
import { Inspector } from "./Inspector";
import { NodePicker } from "./NodePicker";
import { PreviewPanel } from "./PreviewPanel";
import { Sidebar } from "./Sidebar";
import { connectBridge } from "./bridge-client";
import { installShortcuts } from "./shortcuts";
import { EditorContext, createEditor, loadLibrary } from "./store";
import { AIChat } from "./AIChat";
import { ChatContext, createChat } from "./ai-chat";
import { ui } from "./ui-state";

export default function EditorPage(props: { id: string }) {
  const [doc, setDoc] = createSignal<ProjectDoc | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const demo = () => props.id === "demo";

  onSettled(() => {
    const id = untrack(() => props.id);
    if (id === "demo") {
      const d = projectFromTemplate("gradient", "Landing Demo");
      setDoc(d);
      return;
    }
    if (!user()) {
      navigate(`/sign-in?redirect=${encodeURIComponent(location.pathname)}`, { replace: true });
      return;
    }
    api
      .get(id)
      .then(setDoc)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  });

  return (
    <Show
      when={doc()}
      keyed
      fallback={
        <div class="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
          {error() ? (
            <div class="text-center">
              <div class="text-destructive">{error()}</div>
              <a href="/dashboard" class="mt-3 inline-block underline">
                Back to dashboard
              </a>
            </div>
          ) : (
            "Loading project…"
          )}
        </div>
      }
    >
      {(d) => <EditorShell doc={d} persist={!demo()} embed={new URLSearchParams(search()).has("embed")} />}
    </Show>
  );
}

function EditorShell(props: { doc: ProjectDoc; persist: boolean; embed: boolean }) {
  const ed = createEditor(untrack(() => props.doc), { persist: untrack(() => props.persist) });
  const chat = createChat(ed);
  if (import.meta.env.DEV) (window as unknown as { __tsl: unknown }).__tsl = { ed, ui, chat };
  ui.insertSubgraphById = (id, at) => {
    const def = ed.state.doc.customNodes.find((s) => s.id === id) ?? loadLibrary().find((s) => s.id === id);
    if (def) ed.insertSubgraph(def, at);
  };

  onSettled(() => {
    ed.compileNow();
    const offKeys = installShortcuts(ed, () =>
      chat.setState((d) => {
        d.open = !(d.open && !d.minimized);
        d.minimized = false;
      }),
    );
    const offBridge = untrack(() => props.persist) ? connectBridge(ed, { projectId: ed.state.doc.id }) : () => {};
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (ed.state.saveState === "unsaved" || ed.state.saveState === "saving") {
        void ed.save();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);

    // automatic thumbnails: at most every 15s, only after content changes
    let lastThumbVersion = -1;
    const thumbTimer = window.setInterval(async () => {
      if (!untrack(() => props.persist) || ed.state.doc.settings.thumbnail !== "auto") return;
      const v = ed.version();
      if (v === lastThumbVersion || !ed.previewHooks.thumbnail) return;
      lastThumbVersion = v;
      try {
        const t = await ed.previewHooks.thumbnail();
        ed.mutate((doc) => void (doc.thumbnail = t), { history: false, recompile: false });
        lastThumbVersion = ed.version();
      } catch {
        // ignore
      }
    }, 15000);

    return () => {
      offKeys();
      offBridge();
      clearInterval(thumbTimer);
      window.removeEventListener("beforeunload", beforeUnload);
      // disposal runs inside an owned scope: no reactive writes here
      setTimeout(() => {
        void ed.save();
        ui.closeMenus();
        ui.closeDialog();
      });
    };
  });

  const saveJson = () => {
    const blob = new Blob([JSON.stringify(snapshot(ed.state.doc), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${ed.state.doc.name.replace(/[^\w-]+/g, "_") || "project"}.tsl-graph.json`;
    a.click();
  };
  const loadJson = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text()) as ProjectDoc;
        if (!data.graphs?.material) throw new Error("Not a TSL Graph project file");
        const next: ProjectDoc = { ...snapshot(ed.state.doc), graphs: data.graphs, globals: data.globals ?? [], customNodes: data.customNodes ?? [], settings: { ...ed.state.doc.settings, ...data.settings } } as ProjectDoc;
        ed.replaceDoc(next, { history: true });
        ed.mutate(() => {}, { history: false });
        requestAnimationFrame(() => ed.fitView());
        ui.toast("Project loaded", "success");
      } catch (err) {
        ui.toast(err instanceof Error ? err.message : String(err), "error");
      }
    };
    input.click();
  };

  return (
    <EditorContext value={ed}>
      <ChatContext value={chat}>
      <div class="fixed inset-0 flex gap-2 bg-background p-2 text-foreground">
        <Sidebar />
        <div class="relative min-w-0 flex-1 overflow-hidden rounded-lg border">
          <Canvas />
          <TopBar embed={props.embed} onSaveJson={saveJson} onLoadJson={loadJson} />
          <Toolbar />
          <FindBar />
          <AIChat />
        </div>
        <div class="flex w-[300px] shrink-0 flex-col gap-2">
          <PreviewPanel
            onReady={(p) => {
              ed.previewHooks.setUniform = (key, value) => p.setUniform(key, value);
              ed.previewHooks.capture = (w, h) => p.snapshot(w, h);
              ed.previewHooks.thumbnail = () => p.thumbnail();
            }}
          />
          <Inspector />
        </div>
      </div>
      <NodePicker />
      <ContextMenu />
      <Dialogs persist={props.persist} />
      <Toasts />
      </ChatContext>
    </EditorContext>
  );
}
