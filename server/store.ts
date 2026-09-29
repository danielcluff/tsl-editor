import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createProject, nodeCount } from "../src/core/graph";
import type { ProjectDoc, ProjectSummary } from "../src/core/types";

const DATA_DIR = resolve(process.env.TSL_DATA_DIR ?? join(process.cwd(), "data"));
const PROJECTS = join(DATA_DIR, "projects");

const ID = /^[a-zA-Z0-9_-]{1,64}$/;

function file(id: string): string {
  if (!ID.test(id)) throw new Error(`Invalid project id "${id}"`);
  return join(PROJECTS, `${id}.json`);
}

export async function ensureStore() {
  await mkdir(PROJECTS, { recursive: true });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await ensureStore();
  const files = (await readdir(PROJECTS)).filter((f) => f.endsWith(".json"));
  const out: ProjectSummary[] = [];
  for (const f of files) {
    try {
      const doc = JSON.parse(await readFile(join(PROJECTS, f), "utf8")) as ProjectDoc;
      out.push({
        id: doc.id,
        name: doc.name,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        thumbnail: doc.thumbnail,
        nodeCount: nodeCount(doc),
      });
    } catch {
      // skip unreadable files
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<ProjectDoc | null> {
  try {
    return JSON.parse(await readFile(file(id), "utf8")) as ProjectDoc;
  } catch {
    return null;
  }
}

export async function saveProject(doc: ProjectDoc): Promise<ProjectDoc> {
  await ensureStore();
  const target = file(doc.id);
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(doc));
  await rename(tmp, target);
  return doc;
}

export async function newProject(name?: string, from?: Partial<ProjectDoc>): Promise<ProjectDoc> {
  const doc = createProject(name || "Untitled");
  if (from) {
    if (from.graphs) doc.graphs = from.graphs;
    if (from.globals) doc.globals = from.globals;
    if (from.customNodes) doc.customNodes = from.customNodes;
    if (from.settings) doc.settings = { ...doc.settings, ...from.settings };
    if (from.thumbnail) doc.thumbnail = from.thumbnail;
  }
  return saveProject(doc);
}

export async function deleteProject(id: string): Promise<void> {
  await rm(file(id), { force: true });
}
