/** Every CLI action selects a new temporary home. This never contacts the captain's daemon. */
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { createPaseoApi } from "@getpaseo/client";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const cliEntry = process.argv[2];
assert(cliEntry && cliEntry.endsWith(".js"), "Supply the installed Paseo CLI JavaScript entry.");
const home = await mkdtemp(join(tmpdir(), "firstmate-watch-routing-daemon-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PASEO_|^(?:OPENAI|ANTHROPIC|GOOGLE|GEMINI)_/i.test(key)));
const execute = promisify(execFile);
const cli = (...args) => execute(process.execPath, [cliEntry, ...args, "--home", home], { env, windowsHide: true, timeout: 60000 });
const socket = createServer(); await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port; await new Promise((done) => socket.close(done));
await writeFile(join(home, "config.json"), JSON.stringify({ pluginsEnabled: true,
  features: { dictation: { enabled: false }, voiceMode: { enabled: false } },
  daemon: { listen: `127.0.0.1:${port}`, relay: { enabled: false }, mcp: { injectIntoAgents: true } } }));
let client, api, started = false;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(task, description, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await task(); if (value) return value; await wait(250); }
  throw new Error(`Timed out: ${description}`);
}
try {
  await cli("daemon", "start", "--timeout", "45"); started = true;
  const mock = join(home, "mock-plugin"); await mkdir(mock);
  await writeFile(join(mock, "package.json"), JSON.stringify({ name: "fm-test-providers", version: "1.0.0", private: true }));
  await writeFile(join(mock, "paseo-plugin.json"), JSON.stringify({ id: "fm-test-providers", requirements: { paseo: ">=0.11.0" } }));
  await mkdir(join(mock, "server"));
  await copyFile(join(here, "../provider-migration/mock-provider.ts"), join(mock, "server/base-provider.ts"));
  await writeFile(join(mock, "index.server.ts"), (await readFile(join(here, "mock-provider.ts"), "utf8")).replace('"../provider-migration/mock-provider"', '"./server/base-provider"'));
  await cli("plugin", "install", mock); await cli("plugin", "install", root);
  assert(JSON.parse((await cli("plugin", "ls", "--json")).stdout).some((plugin) => plugin.id === "firstmate" && plugin.status === "running"));
  client = new DaemonClient({ url: `ws://127.0.0.1:${port}/ws`, clientType: "cli", clientId: "fm-watch-routing-test", reconnect: { enabled: false }, logger: { debug() {}, info() {}, warn() {}, error() {} } });
  await client.connect(); api = createPaseoApi(client);
  const rpc = (name, input = {}) => client.invokePluginRpc("firstmate", `firstmate.${name}`, input);
  const source = await rpc("mate.launch", { provider: "fm-test-source/mock", modeId: "safe" });
  await api.agents.ref(source.agentId).waitForFinish(10000);
  const config = await rpc("config.read");
  for (const name of ["pr-watch", "remote-watch"]) await rpc("watch.toggle", { name, enabled: false });
  const initialThinking = (await api.agents.ref(source.agentId).refresh()).agent.thinkingOptionId;
  const options = await rpc("watch.options"); assert(options.available); assert(options.thinking.some((entry) => entry.id === "medium"));
  const current = (await rpc("fleet.load")).watches.find((watch) => watch.name === "pr-watch");
  assert.deepEqual(current.routing, { executionSession: "current", newSessionReasoning: "inherit", notificationPolicy: "never" });
  await assert.rejects(rpc("watch.create", { ...options.boardReview, name: "invalid", newSessionReasoning: "unsupported" }), /not supported/);
  const silent = { ...options.boardReview, schedule: "* * * * *" };
  await rpc("watch.create", silent);
  const silentRun = await until(async () => (await rpc("watch.history", { name: silent.name })).runs.find((run) => run.cleanup === "archived"), "silent inspection completes");
  assert.equal(silentRun.status, "completed"); assert.equal(silentRun.delivery, "suppressed");
  assert.equal(JSON.parse(silentRun.report).result.outcome, "no-change");
  assert.equal((await api.agents.ref(source.agentId).refresh()).agent.thinkingOptionId, initialThinking);
  const timeline = await api.agents.ref(source.agentId).timeline.refetch({ direction: "tail", limit: 200, projection: "projected" });
  assert(!timeline.entries.some(({ item }) => item.type === "user_message" && item.clientMessageId === `firstmate-watch-result-${silentRun.runId}`));
  await rpc("watch.configure", { ...silent, enabled: false });
  const inspector = (await client.fetchAgentHistory({ filter: { includeArchived: true, labels: { "firstmate.watch-run": silentRun.runId } } })).entries[0].agent;
  assert(inspector.archivedAt); assert.notEqual(inspector.workspaceId, source.workspaceId);
  assert(!inspector.labels["paseo.parent-agent-id"]); assert(!inspector.cwd.startsWith(config.resolvedHome));
  assert.equal(inspector.currentModeId, "read-only"); assert.equal(inspector.thinkingOptionId, "medium");
  const opens = (await readFile(join(home, "synthetic-opens.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  const opened = opens.find((entry) => entry.config.cwd === inspector.cwd);
  assert(opened.config.systemPrompt.includes("inspection authority only"));
  assert(opened.config.mcpServers.paseo.args.some((arg) => arg.endsWith("inspector-mcp.mjs")), "Empty MCP namespace must replace injected supervisory tools");
  assert((await readFile(join(home, "plugin-data/firstmate/watch-inspections/runs", silentRun.runId, "result.json"), "utf8")).includes("no-change"));
  await writeFile(join(home, "hold-inspector"), "hold result until mate replacement");
  const actionable = { ...silent, name: "actionable-review", prompt: "SYNTHETIC_ACTIONABLE", enabled: true };
  await rpc("watch.create", actionable);
  const running = await until(async () => (await rpc("watch.history", { name: actionable.name })).runs.find((run) => run.status === "sent"), "held inspector starts");
  await rpc("mate.release"); await api.agents.ref(source.agentId).archive();
  const replacement = await rpc("mate.launch", { provider: "fm-test-source/mock", modeId: "safe" });
  await api.agents.ref(replacement.agentId).waitForFinish(10000);
  assert.equal((await api.agents.ref(running.agentId).refresh()).agent.archivedAt, null, "Mate archive must not cascade into a separate inspector");
  await rm(join(home, "hold-inspector"));
  const result = await until(async () => (await rpc("watch.history", { name: actionable.name })).runs.find((run) => run.delivery === "sent" && run.cleanup === "archived"), "result reaches current mate");
  const delivered = await api.agents.ref(replacement.agentId).timeline.refetch({ direction: "tail", limit: 200, projection: "projected" });
  assert.equal(delivered.entries.filter(({ item }) => item.type === "user_message" && item.clientMessageId === `firstmate-watch-result-${result.runId}`).length, 1);
  await rpc("watch.configure", { ...actionable, enabled: false });
  const requestFile = join(home, "request.json");
  await writeFile(requestFile, JSON.stringify({ name: "helper-current", schedule: "0 0 1 1 *", prompt: "Inspect on the main session", enabled: false, executionSession: "current", newSessionReasoning: "inherit", notificationPolicy: "never" }));
  const helper = await execute(process.execPath, [join(config.resolvedHome, "tools/watch.mjs"), "create", "--file", requestFile], { env, windowsHide: true, timeout: 55000 });
  assert.equal(JSON.parse(helper.stdout).ok, true);
  assert((await rpc("fleet.load")).watches.some((watch) => watch.name === "helper-current" && watch.routing.executionSession === "current"));
  console.log(JSON.stringify({ daemon: "fresh temporary home", passed: ["plugin install and client/server compilation", "legacy defaults", "typed reasoning validation", "silent medium inspection and retained evidence", "separate parentless workspace survives old mate archive", "no home charter or injected supervisory MCP", "current-session thinking preserved", "delivery to current mate exactly once", "typed helper transport"] }, null, 2));
} finally {
  if (api) await api.dispose(); if (client) await client.close(); if (started) await cli("daemon", "stop");
  // home is the concrete mkdtemp result under tmpdir, never a user-configured or live path.
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
