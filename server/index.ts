import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ProjectDoc } from "../src/core/types";
import { attachBridge, broadcast } from "./bridge";
import { createMcpServer } from "./mcp";
import { deleteProject, ensureStore, getProject, listProjects, newProject, saveProject } from "./store";

const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? "127.0.0.1";
const PROD = process.env.NODE_ENV === "production";
const ROOT = resolve(import.meta.dirname, "..");

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "projects", id?]
  if (parts[0] !== "api") return false;
  try {
    if (parts[1] === "projects" && parts.length === 2) {
      if (req.method === "GET") return json(res, 200, await listProjects()), true;
      if (req.method === "POST") {
        const body = ((await readBody(req)) ?? {}) as { name?: string; from?: Partial<ProjectDoc> };
        return json(res, 201, await newProject(body.name, body.from)), true;
      }
    }
    if (parts[1] === "projects" && parts.length === 3) {
      const id = parts[2];
      if (req.method === "GET") {
        const doc = await getProject(id);
        return doc ? json(res, 200, doc) : json(res, 404, { error: "Not found" }), true;
      }
      if (req.method === "PUT") {
        const doc = (await readBody(req)) as ProjectDoc;
        if (!doc || doc.id !== id) return json(res, 400, { error: "Body id mismatch" }), true;
        doc.updatedAt = Date.now();
        await saveProject(doc);
        broadcast(id, { type: "saved", projectId: id, updatedAt: doc.updatedAt }, req.headers["x-client-id"] as string);
        return json(res, 200, { ok: true, updatedAt: doc.updatedAt }), true;
      }
      if (req.method === "DELETE") {
        await deleteProject(id);
        return json(res, 200, { ok: true }), true;
      }
    }
    json(res, 404, { error: "Unknown endpoint" });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" }).end();
    return;
  }
  // Stateless: a fresh server/transport per request.
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, await readBody(req));
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".hdr": "application/octet-stream",
};

async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
  const dist = join(ROOT, "dist");
  let file = join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    file = join(dist, "index.html");
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
}

async function main() {
  await ensureStore();
  const server = createServer();
  attachBridge(server);

  let vite: import("vite").ViteDevServer | undefined;
  if (!PROD) {
    const { createServer: createVite } = await import("vite");
    vite = await createVite({
      root: ROOT,
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
  }

  server.on("request", async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/mcp") return void handleMcp(req, res).catch((e) => json(res, 500, { error: String(e) }));
    if (await handleApi(req, res, url)) return;
    if (vite) vite.middlewares(req, res);
    else await serveStatic(req, res, url);
  });

  server.listen(PORT, HOST, () => {
    console.log(`\n  TSL Graph  →  http://localhost:${PORT}`);
    console.log(`  MCP (HTTP) →  http://localhost:${PORT}/mcp\n`);
  });
}

void main();
