import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { ProjectDoc } from "tsl-graph";
import { createFileStore, createGraphServer, envApiKey } from "tsl-graph/server";

const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? "127.0.0.1";
const PROD = process.env.NODE_ENV === "production";
const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIR = resolve(process.env.TSL_DATA_DIR ?? join(process.cwd(), "data"));

const store = createFileStore(join(DATA_DIR, "projects"));

// MCP (/mcp), the editor bridge (/bridge) and the AI chat (/ai/*) come from tsl-graph.
// basePath "" keeps the MCP endpoint at /mcp, where existing agent configs point.
const graph = createGraphServer({
  store,
  basePath: "",
  mcp: "graph",
  projectUrl: (id) => `http://localhost:${PORT}/editor/${id}`,
  ai: { getApiKey: envApiKey },
});

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

/** Project REST API used by the dashboard and the editor host (src/app/lib/api.ts). */
async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "projects", id?]
  if (parts[0] !== "api") return false;
  try {
    if (parts[1] === "projects" && parts.length === 2) {
      if (req.method === "GET") return json(res, 200, await store.list()), true;
      if (req.method === "POST") {
        const body = ((await readBody(req)) ?? {}) as { name?: string; from?: Partial<ProjectDoc> };
        return json(res, 201, await store.create(body.name, body.from)), true;
      }
    }
    if (parts[1] === "projects" && parts.length === 3) {
      const id = parts[2];
      if (req.method === "GET") {
        const doc = await store.get(id);
        return doc ? json(res, 200, doc) : json(res, 404, { error: "Not found" }), true;
      }
      if (req.method === "PUT") {
        const doc = (await readBody(req)) as ProjectDoc;
        if (!doc || doc.id !== id) return json(res, 400, { error: "Body id mismatch" }), true;
        await store.save(doc);
        // other open tabs of this project reload it
        graph.notifyProjectChanged(id);
        return json(res, 200, { ok: true, updatedAt: doc.updatedAt }), true;
      }
      if (req.method === "DELETE") {
        await store.remove(id);
        return json(res, 200, { ok: true }), true;
      }
    }
    json(res, 404, { error: "Unknown endpoint" });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
  return true;
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
  const server = createServer();
  graph.attach(server);

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
    if (await graph.handle(req, res)) return;
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
