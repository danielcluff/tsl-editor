// In-editor AI chat: a provider-agnostic tool-use loop that edits the open
// project through the same tools the MCP server exposes. Progress streams to
// the browser as server-sent events.
import type { ServerResponse } from "node:http";
import { z } from "zod";
import { INSTRUCTIONS, TOOLS, runTool, type ToolResult, type ToolSpec } from "../tools";
import { anthropic } from "./anthropic";
import { google } from "./google";
import { openai } from "./openai";
import type { ChatEvent, Effort, ProviderAdapter, ProviderId, ToolCall, ToolDescriptor } from "./types";

export const PROVIDERS: Record<ProviderId, ProviderAdapter> = { anthropic, openai, google };
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const MAX_TURNS = 40;

const SYSTEM = `${INSTRUCTIONS}

You are the assistant built into the TSL Graph editor. The user is looking at their project in the editor right now, and every tool call you make shows up live on their canvas (and can be undone with Ctrl/Cmd+Z). The tools always act on the open project, so never pass a projectId.

How to work:
- Start from get_graph for the relevant graph unless the editor state in the user's message already tells you enough. Look up unfamiliar node types with get_node_type before wiring them.
- Prefer apply_operations with "$ref" names when adding several nodes and connections.
- Reuse existing nodes where it makes sense instead of rebuilding the graph, and don't delete the user's nodes unless asked.
- After building or changing the shader, run validate_graph and fix any errors it reports. Use capture_preview when the visual result matters, and iterate if it doesn't look like what the user asked for.
- Finish with auto_layout on the graphs you changed.
- Code nodes run TSL (JavaScript): operators must be method calls (a.mul(b), not a * b).

Keep replies short: say what you built or changed and anything the user should know. The user sees your tool calls as they happen, so don't narrate each step.`;

interface ChatTool {
  spec: ToolSpec;
  schema: z.ZodObject;
  descriptor: ToolDescriptor;
}

/** Chat tools: the editing tools minus project management, with projectId removed (the server injects it). */
const CHAT_TOOLS: ChatTool[] = TOOLS.filter((t) => !t.projectManagement).map((spec) => {
  const { projectId: _omit, ...shape } = spec.shape;
  const schema = z.object(shape);
  const { $schema: _s, ...parameters } = z.toJSONSchema(schema) as Record<string, unknown>;
  return { spec, schema, descriptor: { name: spec.name, description: spec.description, parameters } };
});
const DESCRIPTORS = CHAT_TOOLS.map((t) => t.descriptor);

export function credentialStatus() {
  return {
    providers: Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      label: p.label,
      defaultModel: p.defaultModel,
      preferredModels: p.preferredModels,
      serverKey: p.envKeyNames.some((k) => !!process.env[k]),
      envKeyNames: p.envKeyNames,
    })),
  };
}

export async function handleModels(res: ServerResponse, body: { provider?: ProviderId; apiKey?: string }) {
  const provider = PROVIDERS[body?.provider ?? "anthropic"];
  res.setHeader("content-type", "application/json");
  if (!provider) return res.writeHead(400).end(JSON.stringify({ error: "Unknown provider" }));
  try {
    res.end(JSON.stringify({ models: await provider.listModels(body.apiKey || undefined) }));
  } catch (err) {
    res.end(JSON.stringify({ models: [], error: provider.describeError(err) ?? (err instanceof Error ? err.message : String(err)) }));
  }
}

function summarize(result: ToolResult): string {
  const text = result.content.find((c) => c.type === "text");
  if (!text) return result.content.some((c) => c.type === "image") ? "[image]" : "";
  return text.text.length > 400 ? `${text.text.slice(0, 400)}…` : text.text;
}

async function executeCall(call: ToolCall, projectId: string): Promise<ToolResult> {
  const tool = CHAT_TOOLS.find((t) => t.spec.name === call.name);
  if (!tool) return { content: [{ type: "text", text: `Unknown tool "${call.name}"` }], isError: true };
  // Validate before running: streamed tool inputs can arrive truncated or malformed.
  const parsed = tool.schema.safeParse(call.input);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: JSON.stringify({ INVALID_JSON: JSON.stringify(call.input), issues: parsed.error.issues.slice(0, 5) }) }],
      isError: true,
    };
  }
  return runTool(tool.spec, { ...parsed.data, projectId });
}

export interface ChatRequest {
  provider?: ProviderId;
  projectId: string;
  /** Provider-native conversation so far (append-only). */
  history: unknown[];
  prompt: string;
  context?: string;
  apiKey?: string;
  model?: string;
  effort?: Effort;
}

export async function handleChat(res: ServerResponse, body: ChatRequest) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  const send = (event: ChatEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const provider = PROVIDERS[body?.provider ?? "anthropic"];
  if (!provider || !body?.projectId || !Array.isArray(body.history) || !body.prompt?.trim()) {
    send({ type: "error", message: "Invalid chat request" });
    return res.end();
  }
  const model = body.model?.trim() || provider.defaultModel;
  const effort: Effort = EFFORTS.includes(body.effort as Effort) ? (body.effort as Effort) : "high";

  // History is append-only: we only ever add new turns, and report them to the
  // client so its copy stays identical.
  const history: unknown[] = [...body.history];
  const append = (messages: unknown[]) => {
    if (!messages.length) return;
    history.push(...messages);
    send({ type: "append", messages });
  };

  try {
    append(provider.userTurn(history, body.prompt.trim(), body.context ?? ""));
    for (let turn = 0; turn < MAX_TURNS && !controller.signal.aborted; turn++) {
      const step = await provider.step({
        history,
        system: SYSTEM,
        tools: DESCRIPTORS,
        apiKey: body.apiKey || undefined,
        model,
        effort,
        signal: controller.signal,
        emit: send,
      });
      append(step.messages);
      if (step.error) {
        send({ type: "error", message: step.error });
        break;
      }
      if (step.stopReason === "pause_turn") continue;
      if (!step.toolCalls.length) {
        send({ type: "done", stopReason: step.stopReason });
        break;
      }
      // Sequential: graph edits depend on each other's order.
      const results: { call: ToolCall; result: ToolResult }[] = [];
      for (const call of step.toolCalls) {
        const result = await executeCall(call, body.projectId);
        send({ type: "tool_result", id: call.id, name: call.name, isError: !!result.isError, summary: summarize(result) });
        results.push({ call, result });
      }
      append(provider.toolResults(results));
      if (turn === MAX_TURNS - 1) send({ type: "error", message: "Stopped after too many steps." });
    }
  } catch (err) {
    if (!controller.signal.aborted)
      send({ type: "error", message: provider.describeError(err) ?? (err instanceof Error ? err.message : String(err)) });
  } finally {
    if (!res.writableEnded) res.end();
  }
}
