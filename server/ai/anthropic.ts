import Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "../tools";
import type { ProviderAdapter, StepOptions, StepResult, ToolCall } from "./types";

type Msg = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlockParam;

const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

/**
 * After a mid-output fallback, blocks the declined model produced before the
 * last `fallback` marker must not be echoed back (thinking, tool_use, and
 * unpaired server tool use); everything from the boundary on echoes as-is.
 */
function echoContent(content: Anthropic.Beta.BetaContentBlock[]): Block[] {
  const boundary = content.map((b) => b.type).lastIndexOf("fallback");
  if (boundary === -1) return content as Block[];
  const drop = new Set(["thinking", "redacted_thinking", "tool_use", "server_tool_use"]);
  return content.filter((b, i) => i >= boundary || !drop.has(b.type)) as Block[];
}

function resultContent(result: ToolResult): Anthropic.Beta.BetaToolResultBlockParam["content"] {
  return result.content.map((c) =>
    c.type === "text"
      ? { type: "text" as const, text: c.text }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: c.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
            data: c.data,
          },
        },
  );
}

export const anthropic: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",
  defaultModel: "claude-opus-5-5",
  preferredModels: MODELS.map((m) => m.id),
  envKeyNames: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],

  async listModels() {
    return MODELS;
  },

  userTurn(history, text, context) {
    const last = history[history.length - 1] as Msg | undefined;
    const dangling: Block[] =
      last?.role === "assistant" && Array.isArray(last.content)
        ? last.content
            .filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use")
            .map((b) => ({ type: "tool_result", tool_use_id: b.id, is_error: true, content: "Not run: the user stopped the response." }))
        : [];
    const turn: Msg = { role: "user", content: [...dangling, { type: "text", text }, { type: "text", text: context }] };
    return [turn];
  },

  async step(o: StepOptions): Promise<StepResult> {
    // constructed per step (inside the loop's try): throws when no credentials exist
    const client = new Anthropic(o.apiKey ? { apiKey: o.apiKey } : {});
    // Haiku 4.5 predates adaptive thinking, effort and server-side fallback.
    const isHaiku = o.model === "claude-haiku-4-5";
    let jsonRetries = 0;
    for (;;) {
      const stream = client.beta.messages.stream(
        {
          model: o.model,
          max_tokens: 64000,
          system: o.system,
          tools: o.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
            // stream large inputs as generated; the loop validates every input
            eager_input_streaming: true,
          })),
          messages: o.history as Msg[],
          cache_control: { type: "ephemeral" },
          ...(isHaiku
            ? {}
            : {
                thinking: { type: "adaptive", display: "summarized" },
                output_config: { effort: o.effort },
                betas: ["server-side-fallback-2026-07-01"],
                fallbacks: "default" as const,
              }),
        },
        { signal: o.signal },
      );
      let message: Anthropic.Beta.BetaMessage;
      try {
        for await (const event of stream) {
          if (event.type === "content_block_start") {
            const block = event.content_block;
            if (block.type === "tool_use") o.emit({ type: "tool_start", id: block.id, name: block.name });
            else if (block.type === "fallback") o.emit({ type: "fallback", from: block.from.model, to: block.to.model });
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") o.emit({ type: "text", delta: event.delta.text });
            else if (event.delta.type === "thinking_delta") o.emit({ type: "thinking", delta: event.delta.thinking });
          }
        }
        message = await stream.finalMessage();
      } catch (err) {
        // Only an unparseable eagerly-streamed tool input is retried. The SDK has
        // no dedicated class for this case (a plain AnthropicError), so it is
        // identified by its message; API and credential errors propagate.
        const badToolJson =
          err instanceof Anthropic.AnthropicError &&
          !(err instanceof Anthropic.APIError) &&
          err.message.startsWith("Unable to parse tool parameter JSON");
        if (!badToolJson || o.signal.aborted || jsonRetries++ >= 2) throw err;
        o.emit({ type: "notice", message: "Tool input was malformed, retrying…" });
        continue;
      }

      if (message.stop_reason === "refusal") {
        const cat = message.stop_details?.category;
        return { messages: [], toolCalls: [], error: `Claude declined this request${cat ? ` (${cat})` : ""}. Try rephrasing it.` };
      }
      const content = echoContent(message.content);
      const toolCalls: ToolCall[] = content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
      const messages: Msg[] = [{ role: "assistant", content }];
      if (message.stop_reason === "max_tokens" && toolCalls.length) {
        // a truncated tool input usually still parses; never run it
        return { messages, toolCalls: [], error: "The response hit the output limit mid tool call. Try a smaller request." };
      }
      if (message.stop_reason === "pause_turn") return { messages, toolCalls: [], stopReason: "pause_turn" };
      return { messages, toolCalls: message.stop_reason === "tool_use" ? toolCalls : [], stopReason: message.stop_reason };
    }
  },

  toolResults(results) {
    const content: Anthropic.Beta.BetaToolResultBlockParam[] = results.map(({ call, result }) => ({
      type: "tool_result",
      tool_use_id: call.id,
      content: resultContent(result),
      ...(result.isError ? { is_error: true } : {}),
    }));
    return [{ role: "user", content } satisfies Msg];
  },

  describeError(err) {
    if (err instanceof Anthropic.AuthenticationError)
      return "Invalid or missing Anthropic API key. Add it in AI Setup, or set ANTHROPIC_API_KEY for the server.";
    if (err instanceof Anthropic.PermissionDeniedError) return `Permission denied: ${err.message}`;
    if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API — wait a moment and try again.";
    if (err instanceof Anthropic.BadRequestError) return `Request rejected: ${err.message}`;
    if (err instanceof Anthropic.APIError) return `Anthropic API error${err.status ? ` ${err.status}` : ""}: ${err.message}`;
    if (err instanceof Error && /api key|apiKey|authToken|credentials/i.test(err.message))
      return "No Anthropic credentials found. Add an API key in AI Setup, or set ANTHROPIC_API_KEY (or run `ant auth login`) before starting the server.";
    return null;
  },
};
