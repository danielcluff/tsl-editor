import { snapshot } from "solid-js";
import type { Command } from "../../core/commands";
import type { ProjectDoc } from "../../core/types";
import { api, clientId } from "../lib/api";
import { navigate } from "../lib/router";
import type { Editor } from "./store";
import { ui } from "./ui-state";

// Connects the open editor to the server so MCP tool calls act on the live
// document (undo history, live preview, screenshots).

export function connectBridge(ed: Editor, opts: { projectId: string }): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 500;
  let timer: number | undefined;

  const send = (msg: object) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown> = {
    command: (params) => {
      if (params.projectId && params.projectId !== ed.state.doc.id) throw new Error("Editor has a different project open");
      const command = params.command as Command;
      const result = ed.runCommand(command);
      if (command.op !== "getGraph" && command.op !== "compile") ui.toast(`Agent: ${describe(command)}`);
      return result;
    },
    validate: async () => {
      ed.compileNow();
      // let the preview evaluate + compile shaders, then collect errors
      await new Promise((r) => setTimeout(r, 900));
      return {
        diagnostics: ed.diagnostics(),
        runtimeErrors: [...ed.state.runtimeErrors],
        ok: !ed.diagnostics().some((d) => d.level === "error") && ed.state.runtimeErrors.length === 0,
      };
    },
    capturePreview: async (params) => {
      if (!ed.previewHooks.capture) throw new Error("Preview is not ready");
      await new Promise((r) => setTimeout(r, 250));
      return ed.previewHooks.capture(Number(params.width) || 512, Number(params.height) || 512);
    },
  };

  const connect = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/bridge`);
    ws.onopen = () => {
      retry = 500;
      send({ type: "hello", projectId: opts.projectId, clientId });
      send({ type: "active", visible: document.visibilityState === "visible" });
    };
    ws.onmessage = async (ev) => {
      let msg: { type: string; id?: string; method?: string; params?: Record<string, unknown>; projectId?: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "call" && msg.id && msg.method) {
        try {
          const fn = handlers[msg.method];
          if (!fn) throw new Error(`Unknown method ${msg.method}`);
          const result = await fn(msg.params ?? {});
          send({ type: "result", id: msg.id, ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) });
        } catch (err) {
          send({ type: "result", id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      } else if (msg.type === "navigate" && msg.projectId) {
        navigate(`/editor/${msg.projectId}`);
      } else if ((msg.type === "reload" || msg.type === "saved") && msg.projectId === ed.state.doc.id) {
        // changed on disk (agent without editor, or another tab)
        if (ed.state.saveState === "saved") {
          const doc = (await api.get(ed.state.doc.id)) as ProjectDoc;
          if (JSON.stringify(doc.graphs) !== JSON.stringify(snapshot(ed.state.doc.graphs))) ed.replaceDoc(doc);
        }
      }
    };
    ws.onclose = () => {
      ws = null;
      if (closed) return;
      timer = window.setTimeout(connect, retry);
      retry = Math.min(retry * 2, 8000);
    };
  };
  connect();

  const onVis = () => send({ type: "active", visible: document.visibilityState === "visible" });
  const onFocus = () => send({ type: "active", visible: true });
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("focus", onFocus);
  return () => {
    closed = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("focus", onFocus);
    ws?.close();
  };
}

function describe(cmd: Command): string {
  switch (cmd.op) {
    case "addNode":
      return `added ${cmd.type}`;
    case "connect":
      return "connected nodes";
    case "batch":
      return `applied ${cmd.ops.length} operations`;
    case "deleteNodes":
      return `deleted ${cmd.nodeIds.length} node(s)`;
    default:
      return cmd.op;
  }
}
