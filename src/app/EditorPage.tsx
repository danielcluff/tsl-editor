import { createMemo, untrack } from "solid-js";
import type { GraphHost } from "tsl-graph";
import { projectFromTemplate } from "tsl-graph";
import { GraphEditor } from "tsl-graph/editor";
import { getAiKey } from "./lib/ai-keys";
import { api } from "./lib/api";
import { navigate, search } from "./lib/router";
import { user } from "./lib/session";
import { theme } from "./lib/theme";

// tsl-editor as a tsl-graph host: this app owns projects (REST API), routing,
// sign-in and AI keys; the editor itself comes from the tsl-graph package.

const host: GraphHost = {
  projects: {
    load: (id) => api.get(id),
    save: async (doc) => void (await api.save(doc)),
    create: (name, from) => api.create(name, from),
  },
  openProject: (id) => navigate(`/editor/${id}`),
  exit: () => navigate("/dashboard"),
  projectUrl: (id) => `${location.origin}/editor/${id}`,
  docsUrl: "/docs/nodes",
  // the graph server is mounted at the site root (see server/index.ts)
  server: { url: "" },
  mcp: "graph",
  ai: { getApiKey: getAiKey },
};

/** Import summary left by the dashboard for the project it just created. */
function takeImportSummary(id: string) {
  try {
    const key = `tsl-import-summary-${id}`;
    const message = sessionStorage.getItem(key);
    if (!message) return undefined;
    sessionStorage.removeItem(key);
    return { message, kind: message.includes("unsupported") || message.includes("dropped") ? ("info" as const) : ("success" as const) };
  } catch {
    return undefined;
  }
}

export default function EditorPage(props: { id: string }) {
  // the route remounts this page per project id
  const id = untrack(() => props.id);
  const embed = createMemo(() => new URLSearchParams(search()).has("embed"));
  if (id !== "demo" && !untrack(user)) {
    queueMicrotask(() => navigate(`/sign-in?redirect=${encodeURIComponent(location.pathname)}`, { replace: true }));
    return null;
  }
  const project = id === "demo" ? { doc: projectFromTemplate("gradient", "Landing Demo") } : { projectId: id, notice: takeImportSummary(id) };
  return (
    <div class="fixed inset-0">
      <GraphEditor host={host} theme={theme()} embed={embed()} {...project} />
    </div>
  );
}
