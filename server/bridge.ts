import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

// Editor tabs connect here so MCP tools can act on the live editor (undo
// history, live preview, screenshots) instead of the file on disk.

interface Client {
  id: string;
  ws: WebSocket;
  projectId: string | null;
  lastActive: number;
  visible: boolean;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

const clients = new Map<string, Client>();
const pending = new Map<string, Pending>();
let seq = 0;

export function attachBridge(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    if (!req.url?.startsWith("/bridge")) return; // leave other upgrades (vite HMR) alone
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws) => {
    const client: Client = { id: `c${++seq}`, ws, projectId: null, lastActive: Date.now(), visible: true };
    clients.set(client.id, client);
    ws.on("message", (raw) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      switch (msg.type) {
        case "hello":
        case "open":
          client.projectId = (msg.projectId as string) ?? null;
          client.lastActive = Date.now();
          break;
        case "active":
          client.lastActive = Date.now();
          client.visible = msg.visible !== false;
          break;
        case "result": {
          const p = pending.get(msg.id as string);
          if (!p) return;
          pending.delete(msg.id as string);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.result);
          else p.reject(new Error(String(msg.error ?? "Editor call failed")));
          break;
        }
      }
    });
    ws.on("close", () => clients.delete(client.id));
    ws.send(JSON.stringify({ type: "welcome", clientId: client.id }));
  });
}

/** Most recently active editor tab showing `projectId`. */
export function liveEditorFor(projectId: string): Client | undefined {
  let best: Client | undefined;
  for (const c of clients.values()) {
    if (c.projectId !== projectId || c.ws.readyState !== c.ws.OPEN) continue;
    if (!best || (c.visible && !best.visible) || (c.visible === best.visible && c.lastActive > best.lastActive)) best = c;
  }
  return best;
}

export function openEditors(): { clientId: string; projectId: string | null; visible: boolean }[] {
  return [...clients.values()].map((c) => ({ clientId: c.id, projectId: c.projectId, visible: c.visible }));
}

export function callEditor<T = unknown>(client: Client, method: string, params: unknown, timeoutMs = 20000): Promise<T> {
  const id = `r${++seq}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Editor did not respond to "${method}" within ${timeoutMs / 1000}s`));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    client.ws.send(JSON.stringify({ type: "call", id, method, params }));
  });
}

export function broadcast(projectId: string, message: object, exceptClientId?: string) {
  for (const c of clients.values()) {
    if (c.projectId === projectId && c.id !== exceptClientId && c.ws.readyState === c.ws.OPEN) {
      c.ws.send(JSON.stringify(message));
    }
  }
}

/** Ask an editor tab to open another project. */
export function navigateClient(clientId: string, projectId: string): boolean {
  const c = clients.get(clientId);
  if (!c || c.ws.readyState !== c.ws.OPEN) return false;
  c.ws.send(JSON.stringify({ type: "navigate", projectId }));
  c.projectId = projectId;
  c.lastActive = Date.now();
  return true;
}
