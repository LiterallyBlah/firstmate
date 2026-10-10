import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { expect, it } from "vitest";

it("replaces the supervisory MCP namespace with an endpoint exposing no tools", async () => {
  const path = fileURLToPath(new URL("../templates/tools/inspector-mcp.mjs", import.meta.url));
  const processHandle = spawn(process.execPath, [path], { windowsHide: true });
  let output = ""; processHandle.stdout.on("data", (chunk) => { output += chunk.toString(); });
  const exited = new Promise<void>((done, fail) => { processHandle.on("error", fail); processHandle.on("close", (code) => code === 0 ? done() : fail(new Error(`MCP exited ${code}`))); });
  for (const [id, method] of [[1, "initialize"], [2, "tools/list"], [3, "tools/call"]]) processHandle.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params: {} })}\n`);
  processHandle.stdin.end();
  const timeout = setTimeout(() => processHandle.kill(), 3000);
  try { await exited; } finally { clearTimeout(timeout); }
  const messages = output.trim().split("\n").map((line) => JSON.parse(line));
  expect(messages[0].result.capabilities).toEqual({ tools: {} });
  expect(messages[1].result.tools).toEqual([]);
  expect(messages[2].error.code).toBe(-32601);
});
