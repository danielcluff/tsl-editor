// Smoke test: drive the running editor over MCP like an agent would.
// Usage: pnpm dev (in another terminal, with a project open) then `npx tsx scripts/mcp-smoke.ts`
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { writeFileSync } from "node:fs";

const client = new Client({ name: "smoke", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.URL ?? "http://localhost:5173/mcp")));
const text = (r: any) => r.content.map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${text(r)}`);
  return r;
};

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));
console.log("projects:", text(await call("list_projects")).slice(0, 300));
const graph = JSON.parse(text(await call("get_graph")));
console.log("open project:", graph.project.name, "nodes:", graph.nodes.length);
const material = graph.nodes.find((n: any) => n.type.startsWith("material/"));

const res = JSON.parse(
  text(
    await call("apply_operations", {
      operations: [
        { op: "addNode", type: "tslTextures/marble", ref: "marble", values: { scale: 2 } },
        { op: "addNode", type: "utils/fresnel", ref: "fr", values: { power: 3 } },
        { op: "addNode", type: "const/color", ref: "rim", values: { value: "#22d3ee" } },
        { op: "addNode", type: "math/mul", ref: "glow" },
        { op: "connect", source: "$fr", target: "$glow", targetHandle: "a" },
        { op: "connect", source: "$rim", target: "$glow", targetHandle: "b" },
        { op: "connect", source: "$marble", target: material.id, targetHandle: "colorNode" },
        { op: "connect", source: "$glow", target: material.id, targetHandle: "emissiveNode" },
        { op: "autoLayout" },
      ],
    }),
  ),
);
console.log("refs:", res.refs);
console.log("validate:", text(await call("validate_graph")).slice(0, 600));
const code = JSON.parse(text(await call("compile_graph")));
console.log("code length:", code.code.length, "diagnostics:", code.diagnostics.length);
const shot: any = await call("capture_preview", { width: 384, height: 384 });
const img = shot.content.find((c: any) => c.type === "image");
if (img) {
  writeFileSync(process.env.OUT ?? "/tmp/tsl-preview.png", Buffer.from(img.data, "base64"));
  console.log("preview saved:", img.data.length, "b64 chars");
}
await client.close();
