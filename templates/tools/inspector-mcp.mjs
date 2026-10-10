// Empty MCP endpoint occupies the paseo namespace so the daemon does not inject supervisor tools.
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.id === undefined) return;
  const result = request.method === "initialize"
    ? { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "firstmate-inspector", version: "1" } }
    : request.method === "tools/list" ? { tools: [] }
    : request.method === "ping" ? {}
    : null;
  process.stdout.write(`${JSON.stringify(result === null
    ? { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Inspectors have no tools." } }
    : { jsonrpc: "2.0", id: request.id, result })}\n`);
});
