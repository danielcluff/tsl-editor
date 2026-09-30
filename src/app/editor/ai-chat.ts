import { createContext, createStore, flush, snapshot } from "solid-js";
import { getNodeDef } from "../../core/registry";
import type { Editor } from "./store";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ProviderId = "anthropic" | "openai" | "google";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultModel: string;
  preferredModels: string[];
  serverKey: boolean;
  envKeyNames: string[];
}

export interface AISettings {
  provider: ProviderId;
  apiKeys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
  effort: Effort;
}

/** Progress labels, matching the original editor's AI tool names. */
export const TOOL_LABELS: Record<string, string> = {
  get_graph: "Reading graph",
  list_node_types: "Listing node types",
  get_node_type: "Reading node definition",
  compile_graph: "Generating code",
  validate_graph: "Validating graph",
  add_node: "Adding node",
  connect_nodes: "Connecting nodes",
  disconnect: "Disconnecting",
  update_node: "Editing node",
  delete_nodes: "Deleting node",
  auto_layout: "Auto layout",
  clear_graph: "Clearing graph",
  apply_operations: "Applying changes",
  add_global: "Adding global",
  update_preview_settings: "Updating preview",
  capture_preview: "Capturing preview",
  rename_project: "Renaming project",
};

const READ_ONLY_TOOLS = new Set(["get_graph", "list_node_types", "get_node_type", "compile_graph", "validate_graph", "capture_preview"]);

export type ChatItem =
  | { kind: "user"; key: string; text: string }
  | { kind: "text"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "tool"; key: string; name: string; status: "running" | "ok" | "error"; summary?: string }
  | { kind: "error"; key: string; text: string }
  | { kind: "notice"; key: string; text: string }
  | { kind: "changes"; key: string; count: number; mark: number };

export const PROVIDER_LABELS: Record<ProviderId, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };

const SETTINGS_KEY = "tsl-ai-settings";
const conversationKey = (projectId: string) => `tsl-ai-chat-${projectId}`;

interface Conversation {
  provider: ProviderId;
  /** Provider-native messages, append-only, replayed verbatim on each request. */
  history: unknown[];
  items: ChatItem[];
}

function loadSettings(): AISettings {
  const base: AISettings = { provider: "anthropic", apiKeys: {}, models: {}, effort: "high" };
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    // settings written before multi-provider support stored a single Anthropic key/model
    if (typeof s.apiKey === "string" && s.apiKey) base.apiKeys.anthropic = s.apiKey;
    if (typeof s.model === "string" && s.model) base.models.anthropic = s.model;
    return {
      provider: s.provider ?? base.provider,
      apiKeys: { ...base.apiKeys, ...s.apiKeys },
      models: { ...base.models, ...s.models },
      effort: s.effort ?? base.effort,
    };
  } catch {
    return base;
  }
}

function loadConversation(projectId: string, provider: ProviderId): Conversation {
  try {
    const c = JSON.parse(localStorage.getItem(conversationKey(projectId)) ?? "null");
    // older saves were a bare Anthropic history array without display items: start fresh
    if (c && !Array.isArray(c) && Array.isArray(c.history) && Array.isArray(c.items)) return c;
  } catch {
    // ignore
  }
  return { provider, history: [], items: [] };
}

let seq = 0;
const key = (p: string) => `${p}${Date.now().toString(36)}${seq++}`;

export function createChat(ed: Editor) {
  const projectId = ed.state.doc.id;
  const settings = loadSettings();
  const conversation = loadConversation(projectId, settings.provider);
  const [state, setState] = createStore({
    open: false,
    minimized: false,
    settingsOpen: false,
    settings,
    providers: [] as ProviderInfo[],
    /** models listed per provider (live from the provider API where possible) */
    models: {} as Partial<Record<ProviderId, { id: string; label: string }[]>>,
    modelErrors: {} as Partial<Record<ProviderId, string | undefined>>,
    conversation,
    streaming: false,
  });
  let controller: AbortController | null = null;

  void fetch("/api/ai/status")
    .then((r) => r.json())
    .then((s: { providers: ProviderInfo[] }) => {
      setState((d) => void (d.providers = s.providers));
      void refreshModels(settings.provider);
    })
    .catch(() => {});

  const provider = () => state.providers.find((p) => p.id === state.settings.provider);

  /** Model for the active provider: the saved pick, else the best listed/default one. */
  function activeModel(): string {
    const id = state.settings.provider;
    const picked = state.settings.models[id];
    if (picked) return picked;
    const info = provider();
    const listed = state.models[id] ?? [];
    for (const pref of info?.preferredModels ?? []) if (listed.some((m) => m.id === pref)) return pref;
    return listed[0]?.id ?? info?.defaultModel ?? "";
  }

  async function refreshModels(id: ProviderId) {
    try {
      const res = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: id, apiKey: state.settings.apiKeys[id] || undefined }),
      });
      const data = (await res.json()) as { models: { id: string; label: string }[]; error?: string };
      setState((d) => {
        d.models[id] = data.models;
        d.modelErrors[id] = data.error;
      });
    } catch (err) {
      setState((d) => void (d.modelErrors[id] = err instanceof Error ? err.message : String(err)));
    }
  }

  const persist = () => {
    try {
      localStorage.setItem(conversationKey(projectId), JSON.stringify(snapshot(state.conversation)));
    } catch {
      // quota (screenshots are large): keep the conversation in memory only
    }
  };

  /** Update settings; `update` runs on the store draft and on a plain copy for storage. */
  function saveSettings(update: (s: AISettings) => void) {
    setState((d) => update(d.settings as AISettings));
    try {
      const next = JSON.parse(JSON.stringify(snapshot(state.settings))) as AISettings;
      update(next);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  function editorState(): string {
    const g = ed.state.graph;
    const selected = ed.state.selection.nodes
      .map((id) => ed.nodesById().get(id))
      .filter(Boolean)
      .map((n) => `${n!.id} (${getNodeDef(n!.type)?.label ?? n!.type})`);
    const problems = [
      ...ed.diagnostics().map((d) => `${d.level}: ${d.message}`),
      ...ed.state.runtimeErrors.map((e) => `runtime: ${e.split("\n")[0]}`),
    ];
    return [
      "<editor_state>",
      `project: ${ed.state.doc.name}`,
      `active graph: ${g.startsWith("sg:") ? "subgraph (editing)" : g}`,
      `material graph: ${ed.state.doc.graphs.material.nodes.length} nodes, post graph: ${ed.state.doc.graphs.post.nodes.length} nodes`,
      selected.length ? `selected: ${selected.join(", ")}` : "selected: nothing",
      problems.length ? `problems:\n${problems.slice(0, 8).join("\n")}` : "problems: none",
      "</editor_state>",
    ].join("\n");
  }

  // ---- transcript updates from stream events ------------------------------
  const pushItem = (item: ChatItem) => setState((d) => void d.conversation.items.push(item));

  /** Append streamed text to the trailing item of the same kind, or start one. */
  const appendDelta = (kind: "text" | "thinking", delta: string, liveKeys: Set<string>) =>
    setState((d) => {
      const items = d.conversation.items;
      const last = items[items.length - 1];
      if (last && last.kind === kind && liveKeys.has(last.key)) last.text += delta;
      else {
        const k = key(kind);
        liveKeys.add(k);
        items.push({ kind, key: k, text: delta });
      }
    });

  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || state.streaming) return;
    const providerId = state.settings.provider;
    const model = activeModel();
    const apiKey = state.settings.apiKeys[providerId] || undefined;
    // A conversation is bound to its provider's message format.
    const switching = state.conversation.provider !== providerId && state.conversation.history.length > 0;
    const history = switching ? [] : (snapshot(state.conversation.history) as unknown[]);
    setState((d) => {
      if (switching) {
        d.conversation = { provider: providerId, history: [], items: [] };
        d.conversation.items.push({
          kind: "notice",
          key: key("n"),
          text: `Switched to ${PROVIDER_LABELS[providerId]} — started a new conversation.`,
        });
      }
      d.conversation.provider = providerId;
      d.conversation.items.push({ kind: "user", key: key("u"), text: prompt });
      d.streaming = true;
    });
    const mark = ed.historyMark();
    let changes = 0;
    const liveKeys = new Set<string>();
    controller = new AbortController();
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ provider: providerId, projectId, history, prompt, context: editorState(), apiKey, model, effort: state.settings.effort }),
      });
      if (!res.ok || !res.body) throw new Error(`Chat request failed (${res.status})`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
          switch (ev.type) {
            case "text":
            case "thinking":
              appendDelta(ev.type, ev.delta as string, liveKeys);
              break;
            case "tool_start":
              liveKeys.clear();
              pushItem({ kind: "tool", key: ev.id as string, name: ev.name as string, status: "running" });
              break;
            case "tool_result":
              if (!ev.isError && !READ_ONLY_TOOLS.has(ev.name as string)) changes++;
              setState((d) => {
                const t = d.conversation.items.find((i) => i.kind === "tool" && i.key === ev.id);
                if (t && t.kind === "tool") {
                  t.status = ev.isError ? "error" : "ok";
                  t.summary = ev.summary as string;
                }
              });
              break;
            case "append":
              setState((d) => void d.conversation.history.push(...(ev.messages as unknown[])));
              break;
            case "fallback":
              pushItem({ kind: "notice", key: key("f"), text: `${ev.from} declined part of this; continued on ${ev.to}.` });
              break;
            case "notice":
              pushItem({ kind: "notice", key: key("n"), text: ev.message as string });
              break;
            case "error":
              pushItem({ kind: "error", key: key("e"), text: ev.message as string });
              break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError")
        pushItem({ kind: "error", key: key("e"), text: err instanceof Error ? err.message : String(err) });
    } finally {
      controller = null;
      setState((d) => {
        d.streaming = false;
        // tools interrupted by Stop never report back
        for (const i of d.conversation.items) if (i.kind === "tool" && i.status === "running") i.status = "error";
      });
      if (changes > 0) pushItem({ kind: "changes", key: key("c"), count: changes, mark });
      // make the queued writes readable before serialising
      flush();
      persist();
    }
  }

  function stop() {
    controller?.abort();
  }

  function clear() {
    stop();
    setState((d) => {
      d.conversation = { provider: d.settings.provider, history: [], items: [] };
    });
    try {
      localStorage.removeItem(conversationKey(projectId));
    } catch {
      // ignore
    }
  }

  return {
    state,
    setState,
    send,
    stop,
    clear,
    saveSettings,
    refreshModels,
    activeModel,
    provider,
    undoChanges: (mark: number) => ed.undoTo(mark),
  };
}

export type Chat = ReturnType<typeof createChat>;
export const ChatContext = createContext<Chat>();
