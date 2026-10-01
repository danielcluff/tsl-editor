import type { ProjectDoc, ProjectSummary } from "tsl-graph";

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `${method} ${url} failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  list: () => req<ProjectSummary[]>("GET", "/api/projects"),
  get: (id: string) => req<ProjectDoc>("GET", `/api/projects/${id}`),
  create: (name?: string, from?: Partial<ProjectDoc>) => req<ProjectDoc>("POST", "/api/projects", { name, from }),
  save: (doc: ProjectDoc) => req<{ ok: true; updatedAt: number }>("PUT", `/api/projects/${doc.id}`, doc),
  remove: (id: string) => req<{ ok: true }>("DELETE", `/api/projects/${id}`),
};
