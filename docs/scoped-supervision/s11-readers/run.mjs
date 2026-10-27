/** S11: exercise S10's two daemon readers — `retainedWorkspaces()` (paginated `fetch_agent_history_request`) and
 * `nativeSchedules()` (`schedule/list`) — through a real plugin channel on a THROWAWAY daemon of the installed
 * Paseo version (R10 "live-daemon readers" condition). The readers' source files are copied unchanged into a
 * minimal probe plugin, whose server half runs them once at start and writes what they returned.
 *
 *   node docs/scoped-supervision/s11-readers/run.mjs "<Paseo install>/resources"
 *
 * Everything stays under the ignored `.local/s11-readers/`; the daemon is stopped and its home deleted at the end.
 * No model, provider or agent is started. One far-future schedule is created paused, so the schedule listing has a
 * real row to parse; the history listing has none (creating a session would start a provider). Only `result.json`
 * beside this file is written into the repository.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../../..");
const resources = process.argv[2];
assert(resources, "Supply the Paseo install's resources directory");
const exe = resolve(resources, "..", process.platform === "win32" ? "Paseo.exe" : "paseo");
const cliEntry = join(resources, "app.asar", "node_modules", "@getpaseo", "cli", "dist", "index.js");
const runner = join(resources, "app.asar.unpacked", "dist", "daemon", "node-entrypoint-runner.js");
const scratch = join(root, ".local", "s11-readers", String(Date.now())), home = join(scratch, "daemon"), plugin = join(scratch, "plugin");
await mkdir(join(plugin, "server"), { recursive: true }); await mkdir(home, { recursive: true });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const execute = promisify(execFile);
// Not desktop-managed, never the captain's home: only this throwaway home.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PASEO_|CLAUDE|ANTHROPIC|OPENAI|CODEX)/i.test(k)));
Object.assign(env, { PASEO_HOME: home, ELECTRON_RUN_AS_NODE: "1", PASEO_NODE_ENV: "production" });
const cli = (...args) => execute(exe, ["--disable-warning=DEP0040", runner, "node-script", cliEntry, ...args, "--home", home], { env, windowsHide: true, timeout: 90000, maxBuffer: 4 * 1024 * 1024 });

const sources = {};
for (const file of ["archive-inventory.ts", "daemon-session.ts"]) {
  await copyFile(join(root, "server", file), join(plugin, "server", file));
  sources[`server/${file}`] = sha(await readFile(join(root, "server", file)));
}
await writeFile(join(plugin, "paseo-plugin.json"), JSON.stringify({ id: "s11-readers", requirements: { paseo: ">=0.11.0" } }, null, 2));
await writeFile(join(plugin, "package.json"), JSON.stringify({ name: "s11-readers", private: true, version: "0.0.0", type: "module" }, null, 2));
await writeFile(join(plugin, "index.server.ts"), `import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nativeSchedules, retainedWorkspaces } from "./server/archive-inventory";
// Runs both unmodified readers once over this plugin's own daemon channel and records what they returned.
export default function contribute() {
  const timer = setTimeout(async () => {
    const out: Record<string, unknown> = { at: new Date().toISOString() };
    try { out.retainedWorkspaces = { result: "complete", value: await retainedWorkspaces() }; }
    catch (error) { out.retainedWorkspaces = { result: "refused", error: String(error) }; }
    out.nativeSchedules = await nativeSchedules();
    await writeFile(join(process.env.PASEO_HOME!, "s11-readers.json"), JSON.stringify(out, null, 2));
  }, 1500);
  return () => clearTimeout(timer);
}
`);

const probe = createServer(); await new Promise(done => probe.listen(0, "127.0.0.1", done));
const port = probe.address().port; await new Promise(done => probe.close(done));
await writeFile(join(home, "config.json"), JSON.stringify({ version: 1, pluginsEnabled: true, features: { dictation: { enabled: false }, voiceMode: { enabled: false } },
  daemon: { listen: `127.0.0.1:${port}`, relay: { enabled: false }, mcp: { injectIntoAgents: false } } }));

const trace = { at: new Date().toISOString(), node: process.version, platform: process.platform, osRelease: release(), sources, steps: [] };
const step = async (name, run) => { try { const r = await run(); trace.steps.push({ name, ok: true }); return r; } catch (e) { trace.steps.push({ name, ok: false, error: String(e.stderr || e.message || e).slice(0, 2000) }); throw e; } };
try {
  trace.paseo = (await step("version", () => cli("--version"))).stdout.trim();
  await step("daemon start", () => cli("daemon", "start", "--timeout", "60"));
  await step("schedule create (paused, far future)", async () => {
    const created = JSON.parse((await cli("schedule", "create", "--cron", "0 0 1 1 *", "--timezone", "UTC", "--name", "s11-reader-probe", "--max-runs", "1", "--provider", "claude",
      "--cwd", scratch, "--json", "S11 probe: never runs")).stdout);
    const id = created.id ?? created.schedule?.id;
    assert(id, "schedule id");
    await cli("schedule", "pause", id);
    trace.schedule = id;
  });
  await step("plugin install", () => cli("plugin", "install", plugin));
  let result = null;
  for (let n = 0; n < 60 && !result; n++) {
    result = await readFile(join(home, "s11-readers.json"), "utf8").then(JSON.parse, () => null);
    if (!result) await new Promise(done => setTimeout(done, 1000));
  }
  trace.plugin = (await cli("plugin", "ls", "--json")).stdout.trim().slice(0, 4000);
  trace.result = result;
  trace.logs = (await cli("plugin", "logs", "s11-readers").catch(e => ({ stdout: String(e.stderr || e) }))).stdout.trim().slice(-4000);
  assert(result, "the probe plugin wrote no result");
} catch (error) { trace.error = String(error.stack ?? error).slice(0, 4000); console.error(trace.error); }
finally {
  await cli("daemon", "stop").catch(() => {});
  trace.verdict = trace.result?.retainedWorkspaces?.result === "complete" && trace.result?.nativeSchedules?.complete === true ? "both readers complete" : "not qualified";
  const text = JSON.stringify(trace, null, 2) + "\n";
  await writeFile(join(here, "result.json"), text);
  console.log(trace.verdict, sha(text));
  assert(resolve(scratch).startsWith(join(root, ".local")));
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
