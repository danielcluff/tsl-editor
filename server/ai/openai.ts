import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { ProviderAdapter, StepOptions, StepResult, ToolCall } from "./types";

// OpenAI via the Chat Completions API (streaming). History is kept in
// Chat Completions message format.

/** Reasoning models accept `reasoning_effort`; older chat models reject it. */
const isReasoningModel = (model: string) => /^(o\d|gpt-5)/.test(model);

const CHAT_MODEL = /^(gpt-|o\d|chatgpt-)/;
const NON_CHAT = /(audio|realtime|tts|transcribe|image|embedding|search|moderation|instruct|dall-e|whisper|codex)/;

export const openai: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  defaultModel: "gpt-5",
  preferredModels: ["gpt-5.1", "gpt-5", "gpt-4.1", "gpt-4o"],
  envKeyNames: ["OPENAI_API_KEY"],

  async listModels(apiKey) {
    const client = new OpenAI(apiKey ? { apiKey } : {});
    const out: { id: string; label: string }[] = [];
    for await (const m of client.models.list()) {
      if (CHAT_MODEL.test(m.id) && !NON_CHAT.test(m.id)) out.push({ id: m.id, label: m.id });
    }
    return out.sort((a, b) => b.id.localeCompare(a.id));
  },

  userTurn(history, text, context) {
    const out: ChatCompletionMessageParam[] = [];
    const last = history[history.length - 1] as ChatCompletionMessageParam | undefined;
    if (last?.role === "assistant" && last.tool_calls?.length) {
      for (const call of last.tool_calls)
        out.push({ role: "tool", tool_call_id: call.id, content: "Not run: the user stopped the response." });
    }
    out.push({
      role: "user",
      content: [
        { type: "text", text },
        { type: "text", text: context },
      ],
    });
    return out;
  },

  async step(o: StepOptions): Promise<StepResult> {
    const client = new OpenAI(o.apiKey ? { apiKey: o.apiKey } : {});
    const tools: ChatCompletionTool[] = o.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const stream = client.chat.completions.stream(
      {
        model: o.model,
        messages: [{ role: "system", content: o.system }, ...(o.history as ChatCompletionMessageParam[])],
        tools,
        parallel_tool_calls: true,
        ...(isReasoningModel(o.model) ? { reasoning_effort: o.effort } : {}),
      },
      { signal: o.signal },
    );
    const started = new Set<number>();
    stream.on("content.delta", (e) => o.emit({ type: "text", delta: e.delta }));
    stream.on("chunk", (chunk) => {
      for (const tc of chunk.choices[0]?.delta?.tool_calls ?? []) {
        if (tc.id && tc.function?.name && !started.has(tc.index)) {
          started.add(tc.index);
          o.emit({ type: "tool_start", id: tc.id, name: tc.function.name });
        }
      }
    });
    const completion = await stream.finalChatCompletion();
    const choice = completion.choices[0];
    const msg = choice?.message;
    if (!msg) return { messages: [], toolCalls: [], error: "OpenAI returned no message." };
    const functionCalls = (msg.tool_calls ?? []).filter((c) => c.type === "function");
    const assistant: ChatCompletionMessageParam = {
      role: "assistant",
      content: msg.content ?? null,
      ...(functionCalls.length
        ? {
            tool_calls: functionCalls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: { name: c.function.name, arguments: c.function.arguments },
            })),
          }
        : {}),
    };
    if (choice.finish_reason === "content_filter")
      return { messages: [assistant], toolCalls: [], error: "OpenAI's content filter stopped this response." };
    if (msg.refusal) return { messages: [assistant], toolCalls: [], error: `OpenAI declined: ${msg.refusal}` };
    if (choice.finish_reason === "length" && functionCalls.length)
      return { messages: [assistant], toolCalls: [], error: "The response hit the output limit mid tool call. Try a smaller request." };
    const toolCalls: ToolCall[] = functionCalls.map((c) => {
      let input: unknown;
      try {
        input = JSON.parse(c.function.arguments || "{}");
      } catch {
        // surfaced to the model as an INVALID_JSON tool result by the loop
        input = { __unparsedArguments: c.function.arguments };
      }
      return { id: c.id, name: c.function.name, input };
    });
    return { messages: [assistant], toolCalls, stopReason: choice.finish_reason };
  },

  toolResults(results) {
    const out: ChatCompletionMessageParam[] = [];
    const images: { mimeType: string; data: string; tool: string }[] = [];
    for (const { call, result } of results) {
      const text = result.content
        .map((c) => (c.type === "text" ? c.text : "[screenshot attached in the next message]"))
        .join("\n");
      out.push({ role: "tool", tool_call_id: call.id, content: result.isError ? `Error: ${text}` : text });
      for (const c of result.content) if (c.type === "image") images.push({ mimeType: c.mimeType, data: c.data, tool: call.name });
    }
    // Tool messages are text-only, so screenshots follow as a user message.
    if (images.length) {
      out.push({
        role: "user",
        content: [
          { type: "text", text: `Screenshot${images.length > 1 ? "s" : ""} returned by ${images.map((i) => i.tool).join(", ")}:` },
          ...images.map((i) => ({ type: "image_url" as const, image_url: { url: `data:${i.mimeType};base64,${i.data}` } })),
        ],
      });
    }
    return out;
  },

  describeError(err) {
    if (err instanceof OpenAI.AuthenticationError)
      return "Invalid or missing OpenAI API key. Add it in AI Setup, or set OPENAI_API_KEY for the server.";
    if (err instanceof OpenAI.PermissionDeniedError) return `OpenAI permission denied: ${err.message}`;
    if (err instanceof OpenAI.NotFoundError) return `OpenAI model not found or not available to this key: ${err.message}`;
    if (err instanceof OpenAI.RateLimitError) return "Rate limited by the OpenAI API (or out of quota) — wait and try again.";
    if (err instanceof OpenAI.BadRequestError) return `OpenAI rejected the request: ${err.message}`;
    if (err instanceof OpenAI.APIError) return `OpenAI API error${err.status ? ` ${err.status}` : ""}: ${err.message}`;
    if (err instanceof OpenAI.OpenAIError && /api key/i.test(err.message))
      return "No OpenAI API key found. Add it in AI Setup, or set OPENAI_API_KEY before starting the server.";
    return null;
  },
};
