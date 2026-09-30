// MCP over stateless HTTP has no persistent connection, so "connected" means
// an MCP client has talked to this server recently.

const ACTIVE_MS = 30 * 60 * 1000;

let lastSeen = 0;
let clientName: string | null = null;

/** Record an incoming MCP JSON-RPC message (or batch). */
export function recordMcpActivity(body: unknown) {
  lastSeen = Date.now();
  for (const msg of Array.isArray(body) ? body : [body]) {
    const m = msg as { method?: string; params?: { clientInfo?: { name?: string } } } | null;
    if (m?.method === "initialize" && m.params?.clientInfo?.name) clientName = m.params.clientInfo.name;
  }
}

export function mcpStatus() {
  const connected = lastSeen > 0 && Date.now() - lastSeen < ACTIVE_MS;
  return { connected, client: connected ? clientName : null, lastSeen: lastSeen || null };
}
