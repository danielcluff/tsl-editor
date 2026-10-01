import type { ProviderId } from "tsl-graph";

// AI keys the user enters in this app (Dashboard → AI keys), kept in this
// browser and handed to the graph editor through GraphHost.ai.getApiKey.
// Keys set on the server (ANTHROPIC_API_KEY, …) work without any of this.

const KEY = "tsl-ai-keys";
/** Where the editor's AI Setup stored keys before the graph moved into tsl-graph. */
const LEGACY = "tsl-ai-settings";

export type AiKeys = Partial<Record<ProviderId, string>>;

function legacyKeys(): AiKeys {
  try {
    const s = JSON.parse(localStorage.getItem(LEGACY) ?? "{}");
    return { ...(typeof s.apiKey === "string" && s.apiKey ? { anthropic: s.apiKey } : {}), ...s.apiKeys };
  } catch {
    return {};
  }
}

export function loadAiKeys(): AiKeys {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AiKeys) : legacyKeys();
  } catch {
    return {};
  }
}

export function saveAiKeys(keys: AiKeys) {
  try {
    localStorage.setItem(KEY, JSON.stringify(keys));
  } catch {
    // storage unavailable
  }
}

export const getAiKey = (provider: ProviderId) => loadAiKeys()[provider] || undefined;
