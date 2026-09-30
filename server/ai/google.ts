import { ApiError, GoogleGenAI, type Content, type FunctionCall, type Part } from "@google/genai";
import type { ProviderAdapter, StepOptions, StepResult, ToolCall } from "./types";

// Google Gemini via @google/genai. History is kept as Gemini `Content[]`;
// model parts are stored verbatim so thought signatures round-trip.

class MissingKeyError extends Error {}

function client(apiKey?: string): GoogleGenAI {
  const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new MissingKeyError("No Google API key");
  // GEMINI_BASE_URL lets tests point the SDK at a stand-in server
  const baseUrl = process.env.GEMINI_BASE_URL;
  return new GoogleGenAI({ apiKey: key, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
}

let callSeq = 0;

export const google: ProviderAdapter = {
  id: "google",
  label: "Google",
  defaultModel: "gemini-2.5-pro",
  preferredModels: ["gemini-3-pro-preview", "gemini-3-pro", "gemini-2.5-pro", "gemini-2.5-flash"],
  envKeyNames: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],

  async listModels(apiKey) {
    const out: { id: string; label: string }[] = [];
    const pager = await client(apiKey).models.list();
    for await (const m of pager) {
      const id = (m.name ?? "").replace(/^models\//, "");
      if (!id.startsWith("gemini") || /(embedding|tts|image|audio|live|aqa)/.test(id)) continue;
      if (m.supportedActions && !m.supportedActions.includes("generateContent")) continue;
      out.push({ id, label: m.displayName ? `${m.displayName} (${id})` : id });
    }
    return out.sort((a, b) => b.id.localeCompare(a.id));
  },

  userTurn(history, text, context) {
    const out: Content[] = [];
    const last = history[history.length - 1] as Content | undefined;
    const pending = last?.role === "model" ? (last.parts ?? []).filter((p) => p.functionCall) : [];
    if (pending.length) {
      out.push({
        role: "user",
        parts: pending.map((p) => ({
          functionResponse: {
            id: p.functionCall!.id,
            name: p.functionCall!.name,
            response: { error: "Not run: the user stopped the response." },
          },
        })),
      });
    }
    out.push({ role: "user", parts: [{ text }, { text: context }] });
    return out;
  },

  async step(o: StepOptions): Promise<StepResult> {
    const ai = client(o.apiKey);
    const stream = await ai.models.generateContentStream({
      model: o.model,
      contents: o.history as Content[],
      config: {
        systemInstruction: o.system,
        tools: [
          {
            functionDeclarations: o.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parametersJsonSchema: t.parameters,
            })),
          },
        ],
        thinkingConfig: { includeThoughts: true },
        abortSignal: o.signal,
      },
    });
    const parts: Part[] = [];
    let finishReason: string | undefined;
    let blocked: string | undefined;
    for await (const chunk of stream) {
      if (chunk.promptFeedback?.blockReason) blocked = String(chunk.promptFeedback.blockReason);
      const cand = chunk.candidates?.[0];
      if (cand?.finishReason) finishReason = String(cand.finishReason);
      for (const part of cand?.content?.parts ?? []) {
        parts.push(part);
        if (part.text) o.emit({ type: part.thought ? "thinking" : "text", delta: part.text });
        if (part.functionCall) {
          // older models omit call ids; assign one so results can be matched
          part.functionCall.id ||= `call_${Date.now().toString(36)}_${callSeq++}`;
          o.emit({ type: "tool_start", id: part.functionCall.id, name: part.functionCall.name ?? "tool" });
        }
      }
    }
    if (blocked) return { messages: [], toolCalls: [], error: `Gemini blocked this request (${blocked}).` };
    const message: Content = { role: "model", parts };
    const calls = parts.map((p) => p.functionCall).filter((c): c is FunctionCall => !!c);
    if (finishReason === "SAFETY" || finishReason === "RECITATION" || finishReason === "PROHIBITED_CONTENT")
      return { messages: parts.length ? [message] : [], toolCalls: [], error: `Gemini stopped the response (${finishReason}).` };
    if (finishReason === "MAX_TOKENS" && calls.length)
      return { messages: [message], toolCalls: [], error: "The response hit the output limit mid tool call. Try a smaller request." };
    if (!parts.length) return { messages: [], toolCalls: [], error: "Gemini returned an empty response." };
    const toolCalls: ToolCall[] = calls.map((c) => ({ id: c.id!, name: c.name ?? "", input: c.args ?? {} }));
    return { messages: [message], toolCalls, stopReason: finishReason };
  },

  toolResults(results) {
    const parts: Part[] = results.map(({ call, result }) => {
      const text = result.content
        .map((c) => (c.type === "text" ? c.text : "[screenshot attached]"))
        .join("\n");
      let payload: unknown = text;
      try {
        payload = JSON.parse(text);
      } catch {
        // plain text result
      }
      return {
        functionResponse: {
          id: call.id,
          name: call.name,
          response: result.isError ? { error: text } : { output: payload },
        },
      };
    });
    // screenshots travel as inline image parts alongside the responses
    for (const { result } of results)
      for (const c of result.content) if (c.type === "image") parts.push({ inlineData: { mimeType: c.mimeType, data: c.data } });
    return [{ role: "user", parts } satisfies Content];
  },

  describeError(err) {
    if (err instanceof MissingKeyError)
      return "No Google API key found. Add it in AI Setup, or set GEMINI_API_KEY before starting the server.";
    if (err instanceof ApiError) {
      if (err.status === 400 && /api key/i.test(err.message)) return "Invalid Google API key. Check it in AI Setup.";
      if (err.status === 403) return `Google API permission denied: ${err.message}`;
      if (err.status === 404) return `Gemini model not found or not available to this key: ${err.message}`;
      if (err.status === 429) return "Rate limited by the Gemini API (or out of quota) — wait and try again.";
      return `Gemini API error ${err.status}: ${err.message}`;
    }
    return null;
  },
};
