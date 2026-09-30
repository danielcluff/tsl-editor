// Scripted stand-in for the Anthropic, OpenAI and Gemini streaming APIs, for
// testing the in-editor chat loop without credentials:
//   PORT=5199 npx tsx scripts/mock-anthropic.ts
//   ANTHROPIC_BASE_URL=http://127.0.0.1:5199 ANTHROPIC_API_KEY=test \
//   OPENAI_BASE_URL=http://127.0.0.1:5199/v1 OPENAI_API_KEY=test \
//   GEMINI_BASE_URL=http://127.0.0.1:5199 GEMINI_API_KEY=test PORT=5174 pnpm dev
// Each run: read the graph, add a fresnel glow, validate, reply.
import { createServer, type ServerResponse } from "node:http";
import { writeFileSync } from "node:fs";

const port = Number(process.env.PORT ?? 5199);
const requestLog: unknown[] = [];

interface Turn {
  thinking?: string;
  text?: string;
  call?: { id: string; name: string; input: unknown };
}

function script(stage: number, materialId: () => string): Turn {
  if (stage === 0) return { thinking: "I'll look at the material graph first.", call: { id: "call_1", name: "get_graph", input: { graph: "material" } } };
  if (stage === 1)
    return {
      text: "Adding a cyan fresnel rim to the emissive input. ",
      call: {
        id: "call_2",
        name: "apply_operations",
        input: {
          operations: [
            { op: "addNode", type: "utils/fresnel", ref: "f", values: { power: 3 } },
            { op: "addNode", type: "const/color", ref: "c", values: { value: "#22d3ee" } },
            { op: "addNode", type: "math/mul", ref: "m" },
            { op: "connect", source: "$f", target: "$m", targetHandle: "a" },
            { op: "connect", source: "$c", target: "$m", targetHandle: "b" },
            { op: "connect", source: "$m", target: materialId(), targetHandle: "emissiveNode" },
            { op: "autoLayout" },
          ],
        },
      },
    };
  if (stage === 2) return { call: { id: "call_3", name: "validate_graph", input: {} } };
  return { text: "Done — the sphere now has a **cyan fresnel glow** on its rim (emissive). Undo with Ctrl/Cmd+Z if you don't like it." };
}

const findMaterial = (graphJson: unknown): string => {
  const g = (typeof graphJson === "string" ? JSON.parse(graphJson) : graphJson) as { nodes: { id: string; type: string }[] };
  return g.nodes.find((n) => n.type.startsWith("material/"))!.id;
};

// ---- Anthropic ---------------------------------------------------------------
function anthropicStream(res: ServerResponse, turn: Turn, model: string) {
  const events: object[] = [
    { type: "message_start", message: { id: `msg_${Date.now()}`, type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
  ];
  let index = 0;
  if (turn.thinking) {
    events.push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
    events.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: turn.thinking } });
    events.push({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: "sig" } });
    events.push({ type: "content_block_stop", index: index++ });
  }
  if (turn.text) {
    events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
    for (const w of turn.text.split(/(?<= )/)) events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: w } });
    events.push({ type: "content_block_stop", index: index++ });
  }
  if (turn.call) {
    events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: `toolu_${turn.call.id}`, name: turn.call.name, input: {} } });
    const json = JSON.stringify(turn.call.input);
    for (let i = 0; i < json.length; i += 40) events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 40) } });
    events.push({ type: "content_block_stop", index: index++ });
  }
  events.push({ type: "message_delta", delta: { stop_reason: turn.call ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 42 } });
  events.push({ type: "message_stop" });
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join(""));
}

// ---- OpenAI Chat Completions ---------------------------------------------------
function openaiStream(res: ServerResponse, turn: Turn, model: string) {
  const base = { id: `chatcmpl-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model };
  const chunks: object[] = [{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }];
  if (turn.text) for (const w of turn.text.split(/(?<= )/)) chunks.push({ ...base, choices: [{ index: 0, delta: { content: w }, finish_reason: null }] });
  if (turn.call) {
    const json = JSON.stringify(turn.call.input);
    chunks.push({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: turn.call.id, type: "function", function: { name: turn.call.name, arguments: "" } }] }, finish_reason: null }] });
    for (let i = 0; i < json.length; i += 40)
      chunks.push({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: json.slice(i, i + 40) } }] }, finish_reason: null }] });
  }
  chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: turn.call ? "tool_calls" : "stop" }] });
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n");
}

// ---- Gemini ----------------------------------------------------------------------
function geminiStream(res: ServerResponse, turn: Turn) {
  const chunks: object[] = [];
  const chunk = (parts: object[], finishReason?: string) => ({
    candidates: [{ content: { role: "model", parts }, ...(finishReason ? { finishReason } : {}), index: 0 }],
  });
  if (turn.thinking) chunks.push(chunk([{ text: turn.thinking, thought: true }]));
  if (turn.text) for (const w of turn.text.split(/(?<= )/)) chunks.push(chunk([{ text: w }]));
  if (turn.call) chunks.push(chunk([{ functionCall: { name: turn.call.name, args: turn.call.input }, thoughtSignature: "c2ln" }]));
  chunks.push(chunk([], "STOP"));
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join(""));
}

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  const body = raw ? JSON.parse(raw) : {};
  const url = req.url ?? "";
  requestLog.push({ url, headers: req.headers, body });
  writeFileSync(process.env.LOG ?? "/tmp/mock-ai-log.json", JSON.stringify(requestLog, null, 2));

  if (url.startsWith("/v1/messages")) {
    const msgs = body.messages as { role: string; content: { type: string; content?: { text: string }[] }[] }[];
    const prompt = msgs.map((m, i) => (m.role === "user" && m.content.some((b) => b.type === "text") ? i : -1)).filter((i) => i >= 0).pop()!;
    const stage = msgs.slice(prompt + 1).filter((m) => m.role === "assistant").length;
    return anthropicStream(res, script(stage, () => findMaterial(msgs.at(-1)!.content[0].content![0].text)), body.model);
  }
  if (url.startsWith("/v1/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ object: "list", data: ["gpt-5", "gpt-4.1", "text-embedding-3-small", "gpt-4o-audio-preview"].map((id) => ({ id, object: "model", created: 0, owned_by: "mock" })) }));
  }
  if (url.startsWith("/v1/chat/completions")) {
    const msgs = body.messages as { role: string; content: unknown }[];
    const prompt = msgs.map((m, i) => (m.role === "user" && Array.isArray(m.content) && !JSON.stringify(m.content).includes("Screenshot") ? i : -1)).filter((i) => i >= 0).pop()!;
    const stage = msgs.slice(prompt + 1).filter((m) => m.role === "assistant").length;
    return openaiStream(res, script(stage, () => findMaterial(msgs.at(-1)!.content)), body.model);
  }
  if (url.includes(":streamGenerateContent")) {
    const contents = body.contents as { role: string; parts: { text?: string; functionResponse?: { response: { output: unknown } } }[] }[];
    const prompt = contents.map((c, i) => (c.role === "user" && c.parts.some((p) => p.text) ? i : -1)).filter((i) => i >= 0).pop()!;
    const stage = contents.slice(prompt + 1).filter((c) => c.role === "model").length;
    return geminiStream(res, script(stage, () => findMaterial(contents.at(-1)!.parts[0].functionResponse!.response.output)));
  }
  if (url.startsWith("/v1beta/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ models: [
      { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", supportedActions: ["generateContent"] },
      { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedActions: ["generateContent"] },
      { name: "models/text-embedding-004", displayName: "Embedding", supportedActions: ["embedContent"] },
    ] }));
  }
  res.writeHead(404).end();
}).listen(port, "127.0.0.1", () => console.log(`mock AI APIs on :${port}`));
