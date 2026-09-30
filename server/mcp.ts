import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { INSTRUCTIONS, TOOLS, runTool } from "./tools";

export { runCommand } from "./tools";

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "tsl-graph", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.shape }, (args: Record<string, unknown>) =>
      runTool(tool, args),
    );
  }
  return server;
}
