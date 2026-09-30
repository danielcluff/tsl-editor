import type { ToolResult } from "../tools";

export type ProviderId = "anthropic" | "openai" | "google";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Events streamed to the browser. */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_start"; id: string; name: string }
  | { type: "tool_result"; id: string; name: string; isError: boolean; summary: string }
  | { type: "append"; messages: unknown[] }
  | { type: "fallback"; from: string; to: string }
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "done"; stopReason?: string | null };

/** JSON-schema tool description shared by all providers. */
export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface StepResult {
  /** Native assistant message(s) to append to history. */
  messages: unknown[];
  toolCalls: ToolCall[];
  /** Set when the turn ended in a way that must stop the loop with an error. */
  error?: string;
  stopReason?: string | null;
}

export interface StepOptions {
  history: unknown[];
  system: string;
  tools: ToolDescriptor[];
  apiKey?: string;
  model: string;
  effort: Effort;
  signal: AbortSignal;
  emit: (e: ChatEvent) => void;
}

export interface ModelInfo {
  id: string;
  label: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  /** Model used when the client has not picked one (and listing fails). */
  defaultModel: string;
  /** Preference order for choosing a default from a live model list. */
  preferredModels: string[];
  envKeyNames: string[];
  listModels(apiKey?: string): Promise<ModelInfo[]>;
  /**
   * Native messages for a new user prompt. Also answers tool calls left
   * unanswered at the end of `history` (a stopped run), so history stays valid.
   */
  userTurn(history: unknown[], text: string, context: string): unknown[];
  step(opts: StepOptions): Promise<StepResult>;
  toolResults(results: { call: ToolCall; result: ToolResult }[]): unknown[];
  describeError(err: unknown): string | null;
}
