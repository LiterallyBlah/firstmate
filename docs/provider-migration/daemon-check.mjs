/** Requires an installed Paseo CLI JS entry supplied as argv[2]. Every CLI action explicitly selects a fresh home. */
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
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const cliEntry = process.argv[2];
assert(cliEntry && cliEntry.endsWith(".js"), "Supply the installed Paseo CLI JavaScript entry.");
const home = await mkdtemp(join(tmpdir(), "firstmate-migration-daemon-"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^PASEO_|^(?:OPENAI|ANTHROPIC|GOOGLE|GEMINI)_/i.test(key)),
);
const execute = promisify(execFile);
const cli = (...args) =>
  execute(process.execPath, [cliEntry, ...args, "--home", home], { env, windowsHide: true, timeout: 60000 });
const socket = createServer();
await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise((done) => socket.close(done));
await writeFile(
  join(home, "config.json"),
  JSON.stringify({
    pluginsEnabled: true,
    daemon: { listen: `127.0.0.1:${port}`, relay: { enabled: false }, mcp: { injectIntoAgents: false } },
  }),
);
let client;
let started = false;
try {
  await cli("daemon", "start", "--timeout", "45");
  started = true;
  const mock = join(home, "mock-plugin");
  await mkdir(mock);
  await writeFile(
    join(mock, "package.json"),
    JSON.stringify({ name: "fm-test-providers", version: "1.0.0", private: true }),
  );
  await writeFile(
    join(mock, "paseo-plugin.json"),
    JSON.stringify({ id: "fm-test-providers", requirements: { paseo: ">=0.11.0" } }),
  );
  await copyFile(join(here, "mock-provider.ts"), join(mock, "index.server.ts"));
  await cli("plugin", "install", mock);
  await cli("plugin", "install", root);
  const plugins = JSON.parse((await cli("plugin", "ls", "--json")).stdout);
  assert(
    plugins.find((plugin) => plugin.id === "firstmate" && plugin.status === "running"),
    JSON.stringify(plugins),
  );
  client = new DaemonClient({
    url: `ws://127.0.0.1:${port}/ws`,
    clientType: "cli",
    clientId: "fm-migration-test",
    reconnect: { enabled: false },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  await client.connect();
  const api = createPaseoApi(client);
  const rpc = (name, input = {}) => client.invokePluginRpc("firstmate", `firstmate.${name}`, input);
  const launch = await rpc("mate.launch", { provider: "fm-test-source/mock", modeId: "safe" });
  await api.agents.ref(launch.agentId).waitForFinish(10000);
  const config = await rpc("config.read");
  await writeFile(join(config.resolvedHome, "data/captain.md"), "Keep this standing order.");
  await api.agents.ref(launch.agentId).run("Preserve this captain request.", { timeoutMs: 10000 });
  const crewDirectory = join(home, "crew-workspace");
  await mkdir(crewDirectory);
  const crewWorkspace = await api.workspaces.open(crewDirectory);
  // A different cwd alone inherits the parent's workspace. Pass the workspaceId explicitly.
  const crew = await client.createAgent({
    provider: "fm-test-source",
    model: "mock",
    workspaceId: crewWorkspace.id,
    cwd: crewDirectory,
    callerAgentId: launch.agentId,
    labels: { "firstmate.role": "crew", "firstmate.task": "existing" },
  });
  assert.notEqual(crew.workspaceId, launch.workspaceId);
  const sameWorkspace = await client.createAgent({
    provider: "fm-test-source",
    model: "mock",
    cwd: config.resolvedHome,
    workspaceId: launch.workspaceId,
    callerAgentId: launch.agentId,
  });
  const grandchild = await client.createAgent({
    provider: "fm-test-source",
    model: "mock",
    cwd: config.resolvedHome,
    workspaceId: launch.workspaceId,
    callerAgentId: sameWorkspace.id,
  });
  const targets = await rpc("mate.targets");
  assert(targets.targets.some((entry) => entry.provider === "fm-test-target/mock"));
  const request = {
    sourceId: launch.agentId,
    target: { provider: "fm-test-target/mock", modeId: "safe", thinkingOptionId: "high" },
  };
  await assert.rejects(rpc("mate.migrate", request), /archive child sessions/);
  for (const id of [launch.agentId, sameWorkspace.id, grandchild.id, crew.id])
    assert.equal((await api.agents.ref(id).refresh()).agent.archivedAt, null);
  assert.equal((await rpc("config.read")).config.mateAgentId, launch.agentId);
  assert.equal((await rpc("config.read")).config.migration, null);
  // Only scratch sessions are detached, after proving the refusal made no changes.
  await api.agents.ref(sameWorkspace.id).detach();
  await writeFile(join(home, "fail-target-open"), "fail once");
  await assert.rejects(rpc("mate.migrate", request), /Synthetic creation failure/);
  const paused = await rpc("config.read");
  assert.equal(paused.config.mateAgentId, launch.agentId);
  assert(paused.config.migration);
  assert.equal((await api.agents.ref(launch.agentId).refresh()).agent.archivedAt, null);
  await rm(join(home, "fail-target-open"));
  // Reload the isolated plugin to prove the journal survives its process/lifecycle reset.
  await cli("plugin", "reload", "firstmate");
  const result = await rpc("mate.migrate", { sourceId: launch.agentId });
  assert.equal(result.agentId, paused.config.migration.agentId);
  await api.agents.ref(result.agentId).waitForFinish(10000);
  const old = await api.agents.ref(launch.agentId).refresh();
  const worker = await api.agents.ref(crew.id).refresh();
  const latest = await rpc("config.read");
  assert(old.agent.archivedAt);
  assert.equal(worker.agent.archivedAt, null);
  assert.equal(worker.agent.workspaceId, crewWorkspace.id);
  for (const id of [sameWorkspace.id, grandchild.id, result.agentId])
    assert.equal((await api.agents.ref(id).refresh()).agent.archivedAt, null);
  const replacement = (await api.agents.ref(result.agentId).refresh()).agent;
  assert.equal(replacement.labels["paseo.parent-agent-id"], undefined);
  assert.equal(latest.config.mateAgentId, result.agentId);
  assert.equal(latest.config.migration, null);
  assert.equal(await readFile(join(config.resolvedHome, "data/captain.md"), "utf8"), "Keep this standing order.");
  const history = await api.agents
    .ref(result.agentId)
    .timeline.refetch({ direction: "after", limit: 200, projection: "projected" });
  const handoff = history.entries.find(
    ({ item }) => item.type === "user_message" && item.clientMessageId?.startsWith("firstmate-handover-"),
  );
  assert(handoff, JSON.stringify(history.entries));
  assert(handoff.item.text.includes("Preserve this captain request."));
  await assert.rejects(
    rpc("mate.migrate", {
      sourceId: launch.agentId,
      target: { provider: "fm-test-target/mock", modeId: "safe", thinkingOptionId: "high" },
    }),
    /changed/,
  );
  await api.dispose();
  console.log(
    JSON.stringify(
      {
        daemon: "isolated throwaway",
        source: launch.agentId,
        replacement: result.agentId,
        crew: crew.id,
        passed: [
          "plugin compilation/install",
          "synthetic cross-provider migration",
          "old archived/history retained",
          "existing local crew retained",
          "same-workspace descendant refusal leaves every session intact",
          "explicit separate-workspace crew survives archive cascade",
          "replacement independent of archive cascade",
          "failed creation recovery across isolated plugin reload uses saved identity",
          "standing order retained",
          "bounded context delivered",
          "stale concurrent request refused",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (client) await client.close();
  if (started) await cli("daemon", "stop");
  // The target is a fresh mkdtemp under tmpdir; no user or real daemon paths are used.
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
