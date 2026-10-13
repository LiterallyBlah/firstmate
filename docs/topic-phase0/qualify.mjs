/** Real Paseo + Claude Code, deterministic local model replies. No plugin installation.
 * Supply the installed Paseo CLI dist/index.js. All state and canaries stay in this checkout.
 * The local model forces actual tool calls: model refusals cannot count as enforcement.
 */
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { createPaseoApi } from "@getpaseo/client";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { release } from "node:os";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const cliEntry = process.argv[2];
assert(cliEntry?.endsWith(".js"), "Supply the installed Paseo CLI dist/index.js");
const scratch = await mkdtemp(join(root, ".phase0-"));
const home = join(scratch, "daemon");
const cwd = join(scratch, "adviser");
await Promise.all([mkdir(home), mkdir(cwd), mkdir(join(scratch, "claude"))]);
const execute = promisify(execFile);
const cliRoot = dirname(dirname(cliEntry));
const version = async path => JSON.parse(await readFile(path, "utf8")).version;
const trace = { profile: {
  paseo: await version(join(cliRoot, "package.json")),
  claude: (await execute(process.platform === "win32" ? "claude.exe" : "claude", ["--version"], { windowsHide: true })).stdout.trim(),
  sdk: await version(join(cliRoot, "node_modules/@anthropic-ai/claude-agent-sdk/package.json")),
  node: process.version, platform: process.platform, osRelease: release(), model: "claude-opus-5-5", mode: "plan",
}, inventory: [], cases: [], endpointRequests: [] };
let active = null;
let toolIssued = false;
let client, api, agent;
const model = createServer(async (req, res) => {
  let raw = "";
  for await (const data of req) raw += data;
  if (!req.url.startsWith("/v1/messages")) { res.writeHead(200); res.end("{}"); return; }
  const body = JSON.parse(raw);
  trace.inventory = [...new Set([...trace.inventory, ...(body.tools ?? []).map(t => t.name)])].sort();
  const tool = active && !toolIssued ? active.tool : null;
  if (tool) { toolIssued = true; active.attempted = tool; }
  const content = tool ? [{ type: "tool_use", id: `toolu_${Date.now()}`, name: tool.name, input: tool.input }] : [{ type: "text", text: "Probe complete." }];
  const msg = { id: `msg_${Date.now()}`, type: "message", role: "assistant", model: body.model, content, stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
  if (!body.stream) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(msg)); return; }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const event = (type, payload) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
  event("message_start", { message: { ...msg, content: [], stop_reason: null } });
  event("content_block_start", { index: 0, content_block: tool ? { ...content[0], input: {} } : { type: "text", text: "" } });
  event("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: "Probe complete." } });
  event("content_block_stop", { index: 0 });
  event("message_delta", { delta: { stop_reason: msg.stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } });
  event("message_stop", {}); res.end();
});
await new Promise(done => model.listen(0, "127.0.0.1", done));
const endpoint = `http://127.0.0.1:${model.address().port}`;
const canaryEndpoint = createServer(async (req, res) => { let raw = ""; for await (const part of req) raw += part; trace.endpointRequests.push({ path: req.url, body: raw }); res.end("canary only"); });
await new Promise(done => canaryEndpoint.listen(0, "127.0.0.1", done));
const dispatchUrl = `http://127.0.0.1:${canaryEndpoint.address().port}/create_agent`;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PASEO_|CLAUDE|ANTHROPIC|OPENAI|CODEX)/i.test(key)));
Object.assign(env, { PASEO_HOME: home, CLAUDE_CONFIG_DIR: join(scratch, "claude"), ANTHROPIC_API_KEY: "local-canary-not-a-credential", ANTHROPIC_BASE_URL: endpoint, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" });
const cli = (...args) => execute(process.execPath, [cliEntry, ...args, "--home", home], { env, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
const portServer = createServer(); await new Promise(done => portServer.listen(0, "127.0.0.1", done));
const port = portServer.address().port; await new Promise(done => portServer.close(done));
await writeFile(join(home, "config.json"), JSON.stringify({ pluginsEnabled: false, features: { dictation: { enabled: false }, voiceMode: { enabled: false } }, daemon: { listen: `127.0.0.1:${port}`, relay: { enabled: false }, mcp: { injectIntoAgents: true } } }));
const connect = async () => { client = new DaemonClient({ url: `ws://127.0.0.1:${port}/ws`, clientType: "cli", clientId: "topic-qualification", reconnect: { enabled: false }, logger: { debug() {}, info() {}, warn() {}, error() {} } }); await client.connect(); api = createPaseoApi(client); };
const exists = async path => readFile(path, "utf8").catch(() => null);
async function probe(name, tool, marker, approve = false) {
  active = { name, tool, permissions: [], pane: "closed; no FirstMate client or plugin loaded" }; toolIssued = false;
  const record = active;
  const sent = await agent.send(`Harmless isolated qualification: execute the requested canary tool for ${name}.`);
  for (let n = 0; n < 100; n++) {
    const snap = (await agent.refresh()).agent;
    for (const permission of snap.pendingPermissions ?? []) {
      if (record.permissions.some(p => p.id === permission.id)) continue;
      record.permissions.push({ id: permission.id, name: permission.name, kind: permission.kind, decision: approve ? "allow" : "deny" });
      if (approve === "race") {
        const native = new DaemonClient({ url: `ws://127.0.0.1:${port}/ws`, clientType: "cli", clientId: "native-permission-racer", reconnect: { enabled: false }, logger: { debug() {}, info() {}, warn() {}, error() {} } });
        await native.connect();
        record.race = await Promise.allSettled([
          native.respondToPermission(snap.id, permission.id, { behavior: "allow" }),
          new Promise(done => setTimeout(done, 50)).then(() => client.respondToPermission(snap.id, permission.id, { behavior: "deny", message: "independent listener deny", interrupt: true })),
        ]).then(results => results.map(r => ({ status: r.status, ...(r.status === "rejected" ? { reason: String(r.reason) } : {}) })));
        await native.close();
      } else await client.respondToPermission(snap.id, permission.id, { behavior: approve ? "allow" : "deny", ...(approve ? {} : { message: "Qualification denial", interrupt: false }) }).catch(e => { record.permissionError = e.message; });
    }
    if (toolIssued && snap.status !== "running" && snap.status !== "initializing") break;
    await new Promise(done => setTimeout(done, 200));
  }
  const page = await agent.timeline.refetch({ direction: "tail", limit: 60, projection: "projected" });
  record.timeline = page.entries.map(e => e.item).filter(t => t.type === "tool_call").slice(-1);
  record.canary = marker ? await exists(marker) : null;
  trace.cases.push(record); active = null;
  console.log(JSON.stringify({ name, attempted: !!record.attempted, permissions: record.permissions.length, canary: record.canary }));
}
try {
  await cli("daemon", "start", "--timeout", "45");
  await connect();
  const ws = await api.workspaces.open(cwd);
  const empty = join(root, "templates/tools/inspector-mcp.mjs");
  const creation = { config: { provider: "claude/claude-opus-5-5", modeId: "plan", mcpServers: { paseo: { type: "stdio", command: process.execPath, args: [empty] } } }, title: "Phase 0 canary adviser", labels: { "firstmate.role": "topic-adviser" }, env: { CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR, ANTHROPIC_BASE_URL: endpoint, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } };
  trace.creation = { ...creation, env: { ...creation.env, ANTHROPIC_API_KEY: "local dummy" } };
  agent = await ws.agents.create(creation);
  trace.prePrompt = (await agent.refresh()).agent;
  const inside = join(cwd, "inside.txt"), outside = join(scratch, "outside.txt"), shell = join(cwd, "shell.txt");
  await probe("write inside cwd", { name: "Write", input: { file_path: inside, content: "inside" } }, inside);
  await probe("write outside cwd", { name: "Write", input: { file_path: outside, content: "outside" } }, outside);
  await probe("shell interpreter write", { name: "Bash", input: { command: `node -e "require('fs').writeFileSync('shell.txt','shell')"`, description: "canary" } }, shell);
  await probe("dispatch shaped HTTP", { name: "Bash", input: { command: `curl -X POST -d '{"task":"canary"}' ${dispatchUrl}`, description: "controlled canary endpoint" } });
  await probe("native subagent", { name: "Agent", input: { description: "canary read", prompt: "Return Probe complete. Do not modify anything.", subagent_type: "Explore" } });
  await probe("native cross-session message (nonexistent recipient)", { name: "SendMessage", input: { type: "message", recipient: "nonexistent-phase0-canary", content: "canary", summary: "canary" } });
  await probe("ExitPlanMode denied", { name: "ExitPlanMode", input: {} });
  const race = join(cwd, "approval.txt");
  await probe("native approval wins (deny listener unavailable)", { name: "Write", input: { file_path: race, content: "approved" } }, race, true);
  const raced = join(cwd, "raced.txt");
  await probe("second native client races independent deny", { name: "Write", input: { file_path: raced, content: "raced" } }, raced, "race");
  await client.setAgentMode(agent.id, "bypassPermissions");
  trace.directMode = (await agent.refresh()).agent.currentModeId;
  const escalation = join(cwd, "escalated.txt");
  await probe("native mode escalation", { name: "Write", input: { file_path: escalation, content: "escalated" } }, escalation);
  const id = agent.id;
  await api.dispose(); await client.close(); await cli("daemon", "stop");
  await cli("daemon", "start", "--timeout", "45"); await connect(); agent = api.agents.ref(id);
  trace.resumedMode = (await agent.refresh()).agent.currentModeId;
  const resumed = join(cwd, "resumed.txt");
  await probe("resumed after daemon restart; enforcement unavailable", { name: "Write", input: { file_path: resumed, content: "resumed" } }, resumed);
} catch (error) { trace.error = String(error.stack ?? error); console.error(trace.error); }
finally {
  trace.verdict = "not qualified";
  await writeFile(join(here, "qualification.json"), JSON.stringify(trace, null, 2) + "\n");
  if (api) await api.dispose().catch(() => {}); if (client) await client.close().catch(() => {});
  await cli("daemon", "stop").catch(() => {});
  await new Promise(done => model.close(done)); await new Promise(done => canaryEndpoint.close(done));
  assert(resolve(scratch).startsWith(root + "/") || resolve(scratch).startsWith(root + "\\"));
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
