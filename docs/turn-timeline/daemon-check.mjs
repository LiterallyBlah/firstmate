/**
 * The captain-steer relay against a real Paseo 0.16 daemon, whose `agent.turn_ended` hook carries no history.
 * Every run makes a new temporary home and its own daemon; it never contacts the captain's. The synthetic
 * provider (docs/provider-migration/mock-provider.ts) cannot join a running turn, so a steer into a held turn
 * makes the daemon cancel it and start one from the steer: the race the relay must survive.
 *
 *   node docs/turn-timeline/daemon-check.mjs <paseo CLI: a .js entry, or the desktop's paseo.cmd>
 */
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
const cliPath = process.argv[2];
assert(cliPath && /\.(js|cmd)$/i.test(cliPath), "Supply the Paseo CLI: its JavaScript entry or the desktop's paseo.cmd.");
const home = await mkdtemp(join(tmpdir(), "firstmate-turn-timeline-daemon-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PASEO_|^(?:OPENAI|ANTHROPIC|GOOGLE|GEMINI)_/i.test(key)));
const execute = promisify(execFile);
const cli = (...args) => cliPath.toLowerCase().endsWith(".cmd")
  ? execute("cmd.exe", ["/d", "/c", cliPath, ...args, "--home", home], { env, windowsHide: true, timeout: 120000 })
  : execute(process.execPath, [cliPath, ...args, "--home", home], { env, windowsHide: true, timeout: 120000 });
const socket = createServer(); await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port; await new Promise((done) => socket.close(done));
await writeFile(join(home, "config.json"), JSON.stringify({ version: 1, pluginsEnabled: true,
  features: { dictation: { enabled: false }, voiceMode: { enabled: false } },
  daemon: { listen: `127.0.0.1:${port}`, relay: { enabled: false }, mcp: { injectIntoAgents: false } } }));
let client, api, started = false;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(task, description, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await task(); if (value) return value; await wait(250); }
  throw new Error(`Timed out: ${description}`);
}
const pluginConfig = async () => JSON.parse(await readFile(join(home, "plugin-data", "firstmate", "config.json"), "utf8"));
const burst = async (agentId) => (await pluginConfig()).mateNotes.find((note) => note.burst?.key === agentId);

try {
  const version = (await cli("--version")).stdout.trim();
  await cli("daemon", "start", "--timeout", "90"); started = true;
  const mock = join(home, "mock-plugin"); await mkdir(join(mock, "server"), { recursive: true });
  await writeFile(join(mock, "package.json"), JSON.stringify({ name: "fm-test-providers", version: "1.0.0", private: true }));
  await writeFile(join(mock, "paseo-plugin.json"), JSON.stringify({ id: "fm-test-providers", requirements: { paseo: ">=0.16.0" } }));
  await copyFile(join(here, "../provider-migration/mock-provider.ts"), join(mock, "index.server.ts"));
  await cli("plugin", "install", mock); await cli("plugin", "install", root);
  await until(async () => JSON.parse((await cli("plugin", "ls", "--json")).stdout).some((p) => p.id === "firstmate" && p.status === "running"), "firstmate running", 90000);
  client = new DaemonClient({ url: `ws://127.0.0.1:${port}/ws`, clientType: "cli", clientId: "fm-turn-timeline-check", reconnect: { enabled: false },
    logger: { debug() {}, info() {}, warn() {}, error() {} } });
  await client.connect(); api = createPaseoApi(client);
  const rpc = (name, input = {}) => client.invokePluginRpc("firstmate", `firstmate.${name}`, input);
  const mate = await rpc("mate.launch", { provider: "fm-test-source/mock", modeId: "safe" });
  await api.agents.ref(mate.agentId).waitForFinish(15000);

  const cwd = join(home, "crew"); await mkdir(cwd);
  const workspace = await api.workspaces.open(cwd);
  const crew = await workspace.agents.create({ config: { provider: "fm-test-source/mock", modeId: "safe" }, title: "Synthetic crewmate",
    labels: { "firstmate.role": "crew", "firstmate.task": "check-1", "firstmate.kind": "ship", "firstmate.project": "synthetic" } });
  const crewId = crew.id;

  // 1. An idle crewmate: the steer starts a turn of its own, which ends with the hook's history empty.
  await rpc("crew.steer", { agentId: crewId, text: "Use pnpm please" });
  const first = await until(() => burst(crewId), "steer relayed from the turn read back");
  assert.match(first.text, /Use pnpm please/);
  assert.match(first.text, /done: mock complete/);
  // The turn as Paseo 0.16 gives it: whole, with the captain's words under the turn id that read them.
  const page = await api.agents.ref(crewId).timeline.refetch({ direction: "tail", limit: 1, wholeTurns: true, projection: "projected" });
  const steer = page.entries.find(({ item }) => item.type === "user_message" && item.text === "Use pnpm please");
  assert(steer && typeof steer.turnId === "string", "the steer's entry carries its turn id");
  // The relay matches a steer only by this id: the daemon records the send's messageId as clientMessageId.
  assert.match(steer.item.clientMessageId ?? "", /^firstmate-crew-steer-/, "the steer's entry carries its captain-steer id");
  assert(page.entries.every((entry) => entry.turnId === steer.turnId), "a whole-turn tail page is that one turn");

  // 2. A held turn, then a steer the provider cannot join: the daemon cancels the held turn (not relayed)
  //    and starts one from the steer, whose answer joins the same burst note.
  await api.agents.ref(crewId).send("Hold synthetic turn", { messageId: "fm-check-hold" });
  await until(async () => (await api.agents.ref(crewId).refresh()).agent.status === "running", "held turn running");
  await rpc("crew.steer", { agentId: crewId, text: "Skip e2e too" });
  const merged = await until(async () => { const note = await burst(crewId); return /Skip e2e too/.test(note?.text ?? "") && note; }, "second steer merged into the burst");
  assert.equal((await pluginConfig()).mateNotes.filter((note) => note.burst?.key === crewId).length, 1, "one note per burst");
  assert.equal(merged.text.match(/Use pnpm please/g)?.length, 1, "the first exchange is not relayed twice");
  assert(!/Hold synthetic turn/.test(merged.text), "the cancelled turn's prompt is never presented as the captain's");

  console.log(JSON.stringify({ daemon: `fresh temporary home, Paseo ${version}`, passed: [
    "plugin with requirements >=0.16.0 installs and runs",
    "whole-turn tail page carries the steer under its turn id, with its captain-steer clientMessageId",
    "idle crewmate: captain steer relayed with its answer despite an empty hook timeline",
    "held turn cancelled by an unjoinable steer is not relayed; the replacing turn's exchange joins the same burst note",
  ] }, null, 2));
} finally {
  if (api) await api.dispose(); if (client) await client.close(); if (started) await cli("daemon", "stop").catch(() => {});
  // home is the concrete mkdtemp result under tmpdir, never a user-configured or live path.
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
