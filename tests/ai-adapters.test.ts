import { describe, expect, it } from "vitest";
import { anthropic } from "../server/ai/anthropic";
import { google } from "../server/ai/google";
import { openai } from "../server/ai/openai";
import type { ToolResult } from "../server/tools";

const call = { id: "c1", name: "capture_preview", input: {} };
const shot: ToolResult = { content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] };
const text: ToolResult = { content: [{ type: "text", text: '{"ok":true}' }] };

describe("provider adapters", () => {
  it("answer tool calls left dangling by a stopped run", () => {
    const a = anthropic.userTurn([{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "get_graph", input: {} }] }], "hi", "ctx") as any[];
    expect(a[0].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1", is_error: true });

    const o = openai.userTurn(
      [{ role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "get_graph", arguments: "{}" } }] }],
      "hi",
      "ctx",
    ) as any[];
    expect(o[0]).toMatchObject({ role: "tool", tool_call_id: "t1" });
    expect(o[1].role).toBe("user");

    const g = google.userTurn([{ role: "model", parts: [{ functionCall: { id: "t1", name: "get_graph", args: {} } }] }], "hi", "ctx") as any[];
    expect(g[0].parts[0].functionResponse).toMatchObject({ id: "t1", name: "get_graph" });
    expect(g[1].parts[0].text).toBe("hi");
  });

  it("carry screenshots in each provider's format", () => {
    const a = anthropic.toolResults([{ call, result: shot }]) as any[];
    expect(a[0].content[0].content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png" } });

    const o = openai.toolResults([{ call, result: shot }]) as any[];
    expect(o[0]).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(o[1].content[1]).toMatchObject({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });

    const g = google.toolResults([{ call, result: shot }]) as any[];
    expect(g[0].parts[1]).toMatchObject({ inlineData: { mimeType: "image/png", data: "AAAA" } });
  });

  it("pass JSON tool output through as structured data to Gemini", () => {
    const g = google.toolResults([{ call: { ...call, name: "validate_graph" }, result: text }]) as any[];
    expect(g[0].parts[0].functionResponse.response).toEqual({ output: { ok: true } });
  });
});
