import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { BUILT_IN_WATCHES, scheduleLine } from "./watch-files";
import { dataPath } from "./data-dir";

const execute = promisify(execFile);
const source = fileURLToPath(new URL("../templates/watches/launch-metrics.mjs", import.meta.url));
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

// Match the public CLI projections: labels are deliberately absent from ls and inspect.
const fakeCli = `import { readFileSync, appendFileSync } from 'node:fs';
let args = process.argv.slice(2);
const host = process.env.FAKE_REMOTE === '1' ? args.shift() : 'local';
const fixture = JSON.parse(readFileSync(process.env.FAKE_DATA, 'utf8'))[host];
appendFileSync(process.env.FAKE_LOG, JSON.stringify({host,args})+'\\n');
if (!fixture || fixture.fail) process.exit(1);
let result;
if (args[0] === 'ls') {
  if (!args.includes('-a') || !args.includes('-g')) process.exit(3);
  const labels = {};
  for(let i=0;i<args.length;i++) if(args[i]==='--label') {
    const label=args[++i], at=label.indexOf('=');
    if(at<1) process.exit(4);
    labels[label.slice(0,at)]=label.slice(at+1);
  }
  result=fixture.agents.filter(a=>Object.entries(labels).every(([k,v])=>a.labels[k]===v)).map(a=>({id:a.Id,cwd:a.Cwd}));
} else if(args[0]==='inspect') {
  if(fixture.failInspect === args[1]) process.exit(2);
  const agent=fixture.agents.find(a=>a.Id===args[1]);
  if(!agent) process.exit(2);
  const {labels,...detail}=agent; result=detail;
} else if(args[0]==='workspace' && args[1]==='ls') result=fixture.workspaces;
else process.exit(5);
process.stdout.write(JSON.stringify(result));
`;
type Agent = ReturnType<typeof agent>;
type Workspace = { workspaceId: string; cwd: string; isolation: string; branch?: string };
type Host = { agents: Agent[]; workspaces: Workspace[]; fail?: boolean; failInspect?: string };
function agent(id: string, task = "sample") {
  return { Id: id, Cwd: `/trees/${task}`, ParentAgentId: "lead", CreatedAt: "2026-10-17T10:00:00.000Z",
    Provider: "codex", Model: "test-model", Mode: "full-access", Thinking: "high", Worktree: null,
    labels: { "firstmate.role": "crew", "firstmate.task": task, "firstmate.kind": "ship", "firstmate.project": "sample-project" } as Record<string, string> };
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "fm-launch-metrics-")); roots.push(root);
  const home = join(root, "home"), state = join(root, "state"), daemon = join(root, "daemon");
  await mkdir(join(home, "data"), { recursive: true }); await mkdir(join(home, "tools"));
  await mkdir(join(daemon, "plugin-data", "firstmate"), { recursive: true });
  await writeFile(join(daemon, "plugin-data", "firstmate", "config.json"), JSON.stringify({ home, mateAgentId: "lead" }));
  await writeFile(join(home, "data", "backlog.md"), "## In flight\n");
  const cliPath = join(root, "paseo.mjs"), fixturePath = join(root, "fixture.json");
  await writeFile(cliPath, fakeCli);
  await writeFile(join(home, "tools", "remote.mjs"), "process.env.FAKE_REMOTE='1';\n" + fakeCli);
  const watch = join(root, "launch-metrics.mjs"); await copyFile(source, watch);
  const fixture: Record<string, Host> = { local: { agents: [], workspaces: [] }, remote: { agents: [], workspaces: [] } };
  const catalog = { hosts: [{ serverId: "remote", label: "Remote", online: true, workers: [], clockSkew: { seconds: 0 } }] };
  const env = { ...process.env, PASEO_HOME: daemon, PASEO_CLI: cliPath, FIRSTMATE_HOME: home,
    FIRSTMATE_BACKLOG: join(home, "data", "backlog.md"), FIRSTMATE_WATCH_STATE: state, FAKE_DATA: fixturePath, FAKE_LOG: join(root, "calls.jsonl") };
  const save = async () => {
    await writeFile(fixturePath, JSON.stringify(fixture));
    await writeFile(join(home, "data", "remote-hosts.json"), JSON.stringify(catalog));
  };
  const run = async (...args: string[]) => {
    await save();
    return execute(process.execPath, [watch, ...args], { env, timeout: 25000, windowsHide: true });
  };
  const add = (id: string, host = "local", branch: string | undefined = "fm/sample") => {
    const worker = agent(id);
    fixture[host]!.agents.push(worker);
    fixture[host]!.workspaces.push({ workspaceId: `wks-${id}`, cwd: worker.Cwd, isolation: "worktree", ...(branch === undefined ? {} : { branch }) });
    return worker;
  };
  const request = async (host = "local", launch?: string) => {
    await mkdir(join(home, "data", "sample"), { recursive: true });
    const path = join(home, "data", "sample", "dispatch.json");
    await writeFile(path, JSON.stringify({ host, args: ["run", "--provider", "codex/test-model", "--mode", "full-access", "--thinking", "high",
      "--label", "firstmate.task=sample", "--label", "firstmate.kind=ship", "--label", "firstmate.project=sample-project",
      ...(launch ? ["--label", `firstmate.launch=${launch}`] : []), "--", "unrecorded prompt prose"] }));
    await utimes(path, new Date("2026-10-17T09:59:00Z"), new Date("2026-10-17T09:59:00Z"));
  };
  const backlog = async (id: string, host = "local") => writeFile(env.FIRSTMATE_BACKLOG,
    `## In flight\n- [ ] sample - Task (project: sample-project) (kind: ship) (agent: ${id})${host === "local" ? "" : ` (host: ${host})`}\n`);
  const records = async (): Promise<any[]> => {
    try { return (await readFile(join(home, "data", "metrics", "launches.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  };
  return { root, home, state, daemon, fixture, catalog, env, run, add, request, backlog, records, save, watch };
}

describe("opt-in launch metrics watch", () => {
  it("ships a 15-minute template without enabling another built-in watch", async () => {
    expect(scheduleLine(await readFile(source, "utf8"))).toBe("*/15 * * * *");
    expect(BUILT_IN_WATCHES.map(w => w.name)).toEqual(["pr-watch", "remote-watch"]);
  }, 30000);
  it("is silent on the first baseline and unchanged runs, including pre-existing crew", async () => {
    const f = await setup(); f.add("old-local"); f.add("old-remote", "remote");
    expect(await f.run()).toMatchObject({ stdout: "", stderr: "" });
    expect(await f.records()).toEqual([]);
    expect(await f.run()).toMatchObject({ stdout: "", stderr: "" });
    const calls = await readFile(f.env.FAKE_LOG, "utf8");
    expect(calls).not.toContain("inspect");
    expect(await readdir(join(f.home, "recall", "backlog"))).toHaveLength(1);
  }, 30000);
  it("records a local launch once, checks requested settings, and recovers a stale state after append", async () => {
    const f = await setup(); await f.run();
    const baseline = await readFile(join(f.state, "launch-metrics.json"), "utf8");
    f.add("new-local"); await f.backlog("new-local"); await f.request();
    expect(await f.run()).toMatchObject({ stdout: "", stderr: "" });
    const [record] = await f.records();
    expect(record).toMatchObject({ locality: "local", agentId: "new-local", leadId: "lead", checklist: "pass", requestToCreatedMs: 60000 });
    expect(record.checks.parent.status).toBe("pass");
    expect(JSON.stringify(record)).not.toContain("unrecorded prompt");
    await writeFile(join(f.state, "launch-metrics.json"), baseline);
    await f.run(); await f.run();
    expect(await f.records()).toHaveLength(1);
  }, 30000);
  it("snapshots only changed bytes, preserving distinct same-minute versions and malformed lines", async () => {
    const f = await setup(); await f.run();
    const text = "## In flight\n- [ ] ??? (agent: unmatched\n- broken\n";
    await writeFile(f.env.FIRSTMATE_BACKLOG, text); f.add("unfiled");
    await f.run(); await f.run();
    const files = await readdir(join(f.home, "recall", "backlog"));
    expect(files).toHaveLength(2);
    expect(files.every(file => /^\d{4}-\d{2}-\d{2}T\d{4}(?:-[a-f0-9]{64})?\.md$/.test(file))).toBe(true);
    expect(await readFile(f.env.FIRSTMATE_BACKLOG, "utf8")).toBe(text);
    expect((await f.records())[0].checks.backlog.status).toBe("fail");
  }, 30000);
  it("uses real 0.11 workspace shapes and reports unavailable branch and request evidence as unknown", async () => {
    const f = await setup(); await f.run(); f.add("no-branch");
    delete f.fixture.local!.workspaces[0]!.branch;
    await f.backlog("no-branch"); await f.run();
    const [record] = await f.records();
    expect(record.workspace.isolation).toBe("worktree");
    expect(record.checks.worktree).toEqual({ status: "unknown", reason: "workspace-branch-not-exposed" });
    expect(record.checks.model.status).toBe("unknown");
  }, 30000);
  it("reads the current config each time, with the server's current/legacy precedence; errors stay unknown", async () => {
    const f = await setup(); await f.run();
    const legacy = join(f.daemon, "plugins", "firstmate"); await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "config.json"), JSON.stringify({ home: f.home, mateAgentId: "stale-lead" }));
    const old = process.env.PASEO_HOME; process.env.PASEO_HOME = f.daemon;
    try { expect(dataPath("config.json")).toBe(join(f.daemon, "plugin-data", "firstmate", "config.json")); }
    finally { if (old === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = old; }
    f.add("current"); await f.backlog("current"); await f.run();
    expect((await f.records())[0].leadId).toBe("lead");
    await writeFile(join(f.daemon, "plugin-data", "firstmate", "config.json"), "malformed");
    f.fixture.local!.workspaces = []; f.add("unknown"); await f.backlog("unknown"); await f.run();
    expect((await f.records())[1]).toMatchObject({ leadId: null, checks: { parent: { status: "unknown" } } });
    await rm(join(f.daemon, "plugin-data", "firstmate", "config.json"));
    f.fixture.local!.workspaces = []; f.add("legacy"); await f.backlog("legacy"); await f.run();
    expect((await f.records())[2]).toMatchObject({ leadId: "stale-lead", checks: { parent: { status: "fail" } } });
  }, 30000);
  it("records label/settings/branch failures without assuming a request was obeyed", async () => {
    const f = await setup(); await f.run(); const worker = f.add("different", "local", "fm/wrong");
    worker.labels["firstmate.project"] = "wrong-project"; worker.Model = "different-model"; worker.Mode = "read-only"; worker.Thinking = "low";
    await f.backlog("different"); await f.request(); await f.run();
    const [record] = await f.records();
    for (const key of ["labels", "model", "mode", "thinking", "worktree"]) expect(record.checks[key].status).toBe("fail");
  }, 30000);
  it("measures remote launches, retaining the launch label and separating dispatch actions from attempts", async () => {
    const f = await setup(); await f.run(); const worker = f.add("remote-worker", "remote");
    worker.labels["firstmate.launch"] = "sample.a2";
    await f.backlog("remote-worker", "Remote"); await f.request("remote", "sample.a2");
    const receiptDir = join(f.home, "data", "remote-action-receipts"); await mkdir(receiptDir);
    const taskKey = createHash("sha256").update("sample").digest("hex");
    for (const [requestId, phase, targetId, at] of [
      ["one", "started", null, "2026-10-17T09:59:00Z"], ["one", "failed", null, "2026-10-17T09:59:10Z"],
      ["two", "started", null, "2026-10-17T09:59:20Z"], ["two", "succeeded", "remote-worker", "2026-10-17T10:00:01Z"],
    ]) await writeFile(join(receiptDir, `${requestId}.${phase}.json`), JSON.stringify({ version: 1, requestId, phase, targetId, at, action: "dispatch", serverId: "remote", taskKey }));
    expect(await f.run()).toMatchObject({ stdout: "", stderr: "" });
    await f.run();
    const [record] = await f.records();
    expect(record).toMatchObject({ locality: "remote", launchLabel: "sample.a2", checks: { parent: { status: "not-applicable" } } });
    expect(record.remote).toMatchObject({ verifiedLaunchAttempts: 1, attemptsBeforeSuccess: null, firstAttemptSuccess: null });
    expect(record.remote.observedDispatchActions).toHaveLength(2);
    expect(record.remote.observedDispatchActions[0]).toMatchObject({ outcome: "failed", cause: "unknown" });
    const report = JSON.parse((await f.run("--report", "--from", "2026-10-17", "--days", "14")).stdout);
    expect(report.groups.remote).toMatchObject({ launches: 1, observedDispatchActions: 2, remoteErrorsByCause: { unknown: 1 }, remoteFirstAttemptSuccessRate: null });
    expect(report.groups.local.launches).toBe(0);
    expect(JSON.parse((await f.run("--report", "--from", "2026-11-01", "--days", "14")).stdout).groups.remote.launches).toBe(0);
  }, 30000);
  it("retries failed reads without advancing that host, and baselines newly connected hosts", async () => {
    const f = await setup(); f.catalog.hosts[0]!.online = false; await f.run();
    f.add("preexisting", "remote"); f.catalog.hosts[0]!.online = true; await f.run();
    expect(await f.records()).toEqual([]);
    f.add("retry-me"); f.fixture.local!.fail = true;
    expect(await f.run()).toMatchObject({ stdout: "", stderr: expect.stringContaining("unseen launches remain eligible") });
    delete f.fixture.local!.fail; await f.backlog("retry-me"); await f.run();
    expect(await f.records()).toHaveLength(1);
  }, 30000);
  it("soft-fails an unreachable host while saving snapshots and other launches, then retries without duplicates", async () => {
    const f = await setup();
    f.fixture.available = { agents: [], workspaces: [] };
    f.catalog.hosts.push({ ...f.catalog.hosts[0]!, serverId: "available", label: "Available" });
    await f.run();
    f.add("local-launch"); f.add("remote-launch", "available"); f.add("retry-launch", "remote");
    f.fixture.remote!.fail = true;
    await f.backlog("local-launch");
    const result = await f.run(); // execFile resolves only for exit 0.
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().split("\n")).toEqual([
      "Launch metrics: a host could not be measured; unseen launches remain eligible for the next run.",
    ]);
    expect((await f.records()).map(r => r.key)).toEqual(["local:local-launch", "available:remote-launch"]);
    const state = JSON.parse(await readFile(join(f.state, "launch-metrics.json"), "utf8"));
    expect(state.hosts.remote.seen).toEqual([]);
    expect(state.hosts.local.seen).toEqual(["local-launch"]);
    expect(state.hosts.available.seen).toEqual(["remote-launch"]);
    const snapshots = await readdir(join(f.home, "recall", "backlog"));
    expect(snapshots).toHaveLength(2);
    expect(await Promise.all(snapshots.map(name => readFile(join(f.home, "recall", "backlog", name), "utf8"))))
      .toContain(await readFile(f.env.FIRSTMATE_BACKLOG, "utf8"));
    delete f.fixture.remote!.fail;
    expect(await f.run()).toMatchObject({ stdout: "", stderr: "" });
    await f.run();
    expect((await f.records()).map(r => r.key)).toEqual(["local:local-launch", "available:remote-launch", "remote:retry-launch"]);
    expect(await readdir(join(f.home, "recall", "backlog"))).toHaveLength(2);
  }, 30000);
  it("keeps metrics storage failures fatal and leaves the launch unseen", async () => {
    const f = await setup(); await f.run(); f.add("retry-write");
    await writeFile(join(f.home, "data", "metrics"), "not a directory");
    await expect(f.run()).rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("Launch metrics failed") });
    const state = JSON.parse(await readFile(join(f.state, "launch-metrics.json"), "utf8"));
    expect(state.hosts.local.seen).toEqual([]);
  }, 30000);
  it("accepts planned structured requests and serializes overlapping manual runs", async () => {
    const f = await setup(); await f.run(); const worker = f.add("structured");
    worker.labels["firstmate.launch"] = "sample.a1"; await f.backlog("structured");
    const dir = join(f.home, "data", "sample", "launches"); await mkdir(dir, { recursive: true });
    const path = join(dir, "1.json");
    await writeFile(path, JSON.stringify({ id: "sample", createAgent: { provider: "codex/test-model", labels: worker.labels,
      settings: { modeId: "full-access", thinkingOptionId: "high" } } }));
    await utimes(path, new Date("2026-10-17T09:59:00Z"), new Date("2026-10-17T09:59:00Z"));
    await f.save();
    const results = await Promise.all([1, 2].map(() => execute(process.execPath, [f.watch], { env: f.env, timeout: 25000, windowsHide: true })));
    expect(results.every(r => r.stdout === "" && r.stderr === "")).toBe(true);
    const records = await f.records(); expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ launchLabel: "sample.a1", checklist: "pass", request: { path: "data/sample/launches/1.json" } });
  }, 30000);
  it("reports failed dispatches without workers and never invokes the CLI or changes state in report mode", async () => {
    const f = await setup(); await f.run();
    const dir = join(f.home, "data", "remote-action-receipts"); await mkdir(dir);
    await writeFile(join(dir, "orphan.failed.json"), JSON.stringify({ version: 1, action: "dispatch", requestId: "orphan", phase: "failed", at: "2026-10-17T10:00:00Z" }));
    const before = await readFile(join(f.state, "launch-metrics.json"), "utf8");
    const calls = await readFile(f.env.FAKE_LOG, "utf8");
    const report = JSON.parse((await f.run("--report", "--from", "2026-10-17", "--days", "14")).stdout);
    expect(report.receiptTotals).toMatchObject({ observedDispatchActions: 1, errorsByCause: { unknown: 1 } });
    expect(report.groups.remote.launches).toBe(0);
    expect(await readFile(join(f.state, "launch-metrics.json"), "utf8")).toBe(before);
    expect(await readFile(f.env.FAKE_LOG, "utf8")).toBe(calls);
  }, 30000);
  it("does not let one unavailable worker prevent measuring the remaining crew", async () => {
    const f = await setup(); await f.run(); f.add("unavailable"); f.add("available");
    f.fixture.local!.failInspect = "unavailable"; await f.backlog("available");
    expect(await f.run()).toMatchObject({ stdout: "", stderr: expect.stringContaining("host could not be measured") });
    expect((await f.records()).map(record => record.agentId)).toEqual(["available"]);
    delete f.fixture.local!.failInspect; await f.run();
    expect(await f.records()).toHaveLength(2);
  }, 30000);
});
