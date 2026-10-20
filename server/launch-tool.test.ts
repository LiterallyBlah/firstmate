import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CREW_LABELS, FirstmateConfigSchema } from "../shared/fleet";
import { prepareHome } from "./home";
import { briefParts } from "./launch-tool";
import { commandArguments } from "./remotes";
import { WorkflowPlanStore } from "./workflow-plans";
import { processWorkflowRequests } from "./workflow-service";
import { PlanDefinitionSchema } from "../shared/workflow-plans";
import { fill, readTemplate, TEMPLATES } from "./templates";

// These scenarios run real Node/git processes; loaded Windows runners need the same budget as local verification.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../test/launch-cli.mjs", import.meta.url));
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const workerId = "11111111-1111-4111-8111-111111111111";
let scratch: string, home: string, statePath: string, logPath: string, configPath: string, cwd: string;
let queueTimer: ReturnType<typeof setInterval> | undefined, pumping: Promise<void> | undefined;
let workflowTimer: ReturnType<typeof setInterval> | undefined, workflowPumping: Promise<void> | undefined;
let state: any;
const save = () => writeFile(statePath, JSON.stringify(state));
const reload = async () => { state = JSON.parse(await readFile(statePath, "utf8")); };
const request = (extra: any = {}) => ({ id: "task", title: "Fix the thing", agentTitle: "Fix thing", project: "project", host: "local", baseBranch: "main", kind: "ship", mode: "reviewed-PR", brief: { assemble: { intent: "Fix the thing", spec: "Only this thing", rules: null } }, agent: { provider: "codex/model", modeId: "full-access", thinkingOptionId: "high" }, backlog: { existing: "none" }, ...extra });
async function run(args: string[], actor = "mate", extraEnv: NodeJS.ProcessEnv = {}) {
  const options = { cwd: home, env: { ...process.env, PASEO_HOME: scratch, PASEO_AGENT_ID: actor, ...extraEnv }, windowsHide: true, timeout: 25000, maxBuffer: 4 * 1024 * 1024 };
  try { return JSON.parse((await execute(process.execPath, [join(home, "tools/launch.mjs"), ...args], options)).stdout); }
  catch (error: any) { if (error.stdout?.trim()) return JSON.parse(error.stdout); throw error; }
}
async function prepare(value = request(), flags: string[] = []) {
  await writeFile(join(home, "data/task/request.json"), JSON.stringify(value));
  return run(["prepare", "--file", "data/task/request.json", ...flags]);
}
const entries = async () => readdir(join(home, "data/task/launches")).catch(() => []);
const calls = async (): Promise<string[][]> => (await readFile(logPath, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
const record = () => run(["record", "task", "--attempt", "1", "--agent", workerId, "--workspace", "wks", "--armed"]);
async function addWorker(overrides: any = {}) {
  state.agents = [{ id: workerId, labels: { "firstmate.role": "crew", "firstmate.task": "task", "firstmate.kind": "ship", "firstmate.project": "project", "firstmate.launch": "task.a1" }, detail: { Id: workerId, ParentAgentId: "mate", Cwd: cwd, Provider: "codex", Model: "model", Mode: "full-access", Thinking: "high", Archived: false }, ...overrides }];
  await save();
}
async function module() { return import(pathToFileURL(join(home, "tools/launch.mjs")).href); }

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "launch-tool-")); process.env.PASEO_HOME = scratch;
  home = join(scratch, "plugin-data/firstmate/home"); configPath = join(scratch, "plugin-data/firstmate/config.json");
  await prepareHome(home, FirstmateConfigSchema.parse({}));
  await writeFile(configPath, JSON.stringify({ mateAgentId: "mate", home }));
  const plans = new WorkflowPlanStore(join(scratch, "workflow-plans"), home);
  workflowTimer = setInterval(() => { workflowPumping ??= processWorkflowRequests(home, plans, async actor => { const live = JSON.parse(await readFile(configPath, "utf8")); if (actor !== live.mateAgentId) throw new Error("Not mate"); }).finally(() => { workflowPumping = undefined; }); }, 10);
  await mkdir(join(home, "data/task"));
  cwd = join(home, "repo"); await mkdir(cwd);
  await execute("git", ["init", "--initial-branch=main", cwd]);
  await execute("git", ["-C", cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "Initial"]);
  await execute("git", ["-C", cwd, "checkout", "-b", "fm/task"]);
  statePath = join(scratch, "cli-state.json"); logPath = join(scratch, "cli-calls.jsonl");
  state = { projects: [{ projectId: "p", name: "project", kind: "git", path: cwd }], workspaces: [{ workspaceId: "wks", project: "project", name: "Mutable title", isolation: "worktree", cwd }], models: [{ id: "model", thinkingOptionIds: ["high"] }], agents: [], workerId, runBehavior: "ok" };
  await save();
  await writeFile(join(home, "tools/launch.mjs"), fill(await readTemplate(TEMPLATES.launchHelper), { launchConfigJson: JSON.stringify({ home, paseoHome: scratch, cli: { command: process.execPath, args: [cli, statePath, logPath], env: {} }, labels: CREW_LABELS, parts: await briefParts() }) }));
});
afterEach(async () => {
  if (workflowTimer) clearInterval(workflowTimer); workflowTimer = undefined; await workflowPumping; workflowPumping = undefined;
  if (queueTimer) clearInterval(queueTimer); queueTimer = undefined; await pumping; pumping = undefined;
  await rm(scratch, { recursive: true, force: true });
});

async function remoteFixture(behavior = "ok") {
  const queue = join(scratch, "queue"); await mkdir(queue);
  state.projects[0].path = "C:\\Users\\Worker Name\\project";
  state.workspaces[0].cwd = "C:\\Worktrees\\task"; state.runBehavior = behavior; await save();
  await writeFile(join(home, "data/remote-hosts.json"), JSON.stringify({ hosts: [{ serverId: "remote", label: "Remote", online: true, projects: state.projects, workers: [] }] }));
  await writeFile(join(home, "tools/remote.mjs"), fill(await readTemplate(TEMPLATES.remoteHelper), { remoteQueueJson: JSON.stringify(queue) }));
  queueTimer = setInterval(() => {
    if (pumping) return;
    pumping = (async () => {
      for (const name of (await readdir(queue)).filter(name => name.endsWith(".request.json"))) {
        const path = join(queue, name), input = JSON.parse(await readFile(path, "utf8"));
        await rm(path);
        let response;
        try {
          const args = commandArguments(input.args, "owner-fixture");
          const answer = await execute(process.execPath, [cli, statePath, logPath, ...args], { windowsHide: true, timeout: 10000 });
          response = { id: input.id, ok: true, result: JSON.parse(answer.stdout) };
        } catch (error: any) { response = { id: input.id, ok: false, error: error.stderr?.trim() ?? error.message }; }
        await writeFile(join(queue, `${input.id}.response.json`), JSON.stringify(response));
      }
    })().finally(() => { pumping = undefined; });
  }, 10);
}

describe("launch contract and assembly", () => {
  it("prepares the conductor's exact dependent request after verified predecessor completion", async () => {
    await mkdir(join(home, "data/predecessor")); await writeFile(join(home, "data/predecessor/brief.md"), "# Status line\ndone: report");
    await writeFile(join(home, "data/task/brief.md"), "# Status line\ndone: task");
    const launch = request({ brief: { file: "data/task/brief.md" } });
    const plans = new WorkflowPlanStore(join(scratch, "workflow-plans"), home);
    const definition = PlanDefinitionSchema.parse({ format: "firstmate.plan/1", id: "dependent", title: "Dependent", request: { text: "Build it", at: "2026-10-20T12:00:00Z", posture: "sail", quote: "Go" }, budget: { agents: 2, turns: 2 }, nodes: [
      { id: "predecessor", title: "Trial", summary: "Trial", kind: "run", workflow: "scout@1", launch: { ...launch, id: "predecessor", kind: "scout", brief: { file: "data/predecessor/brief.md" } } },
      { id: "task", title: "Build", summary: "Build", kind: "run", workflow: "task@1", launch, after: [{ node: "predecessor", on: "done", reason: "needs-evidence" }] },
    ] });
    await plans.execute({ op: "draft", definition }, "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "mate");
    const first: any = await plans.execute({ op: "start", plan: "dependent", node: "predecessor" }, "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", "mate");
    await plans.execute({ op: "record", plan: "dependent", node: "predecessor", attempt: first.launch.workflow.attempt, state: "done", evidence: "Verified report" }, "cccccccc-cccc-4ccc-accc-cccccccccccc", "mate");
    const second: any = await plans.execute({ op: "start", plan: "dependent", node: "task" }, "dddddddd-dddd-4ddd-addd-dddddddddddd", "mate");
    await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n- [ ] task - Build (project: project) (plan: dependent) (blocked-by: predecessor)\n## Done\n");
    expect(await prepare(second.launch)).toMatchObject({ ok: true, workflow: { plan: "dependent" } });
  });
  it("refuses a changed bound brief before claiming the committed start", async () => {
    await writeFile(join(home, "data/task/brief.md"), "# Status line\ndone: original");
    const launch = request({ brief: { file: "data/task/brief.md" } }), plans = new WorkflowPlanStore(join(scratch, "workflow-plans"), home);
    const definition = PlanDefinitionSchema.parse({ format: "firstmate.plan/1", id: "bound", title: "Bound", request: { text: "Build", at: "2026-10-20T12:00:00Z" }, budget: { agents: 1, turns: 1 }, nodes: [{ id: "task", title: "Build", summary: "Build", kind: "run", workflow: "task@1", launch }] });
    await plans.execute({ op: "draft", definition }, "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "mate");
    const started: any = await plans.execute({ op: "start", plan: "bound", node: "task" }, "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", "mate");
    await writeFile(join(home, "data/task/brief.md"), "# Status line\ndone: changed");
    expect(await prepare(started.launch)).toMatchObject({ code: "brief-changed" });
    expect((await plans.get("bound"))?.nodes.task?.claimed).toBe(false);
  });
  it("claims a drafted plan's already-filed Queued line without another adoption request", async () => {
    await writeFile(join(home, "data/task/brief.md"), "Implement the planned task.\n\n# Status line\nEnd every turn with done: <result> or blocked: <reason>.\n");
    const launch = request({ brief: { file: "data/task/brief.md" } });
    const plans = new WorkflowPlanStore(join(scratch, "workflow-plans"), home);
    const definition = PlanDefinitionSchema.parse({ format: "firstmate.plan/1", id: "planned", title: "Planned task", request: { text: "Build it", at: "2026-10-20T12:00:00Z" }, budget: { agents: 1, turns: 1 }, nodes: [{ id: "task", title: "Fix the thing", summary: "Implement the requested fix", kind: "run", workflow: "task@1", launch }] });
    await plans.execute({ op: "draft", definition }, "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "mate");
    const started: any = await plans.execute({ op: "start", plan: "planned", node: "task" }, "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", "mate");
    await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n- [ ] task - Fix the thing (project: project) (plan: planned)\n## Done\n");
    const result = await prepare(started.launch); expect(result, JSON.stringify(result)).toMatchObject({ ok: true }); expect(result.workflow.plan).toBe("planned");
    expect(result.backlog.line).toContain("(plan: planned)"); expect((await plans.get("planned"))?.nodes.task?.claimed).toBe(true);
  });
  it("emits exact local MCP arguments with baseBranch and never creates locally", async () => {
    const result = await prepare(); expect(result.ok).toBe(true);
    expect(result.createWorkspace).toEqual({ isolation: "worktree", path: cwd, branchName: "fm/task", baseBranch: "main", worktreeSlug: "task", title: "Fix the thing" });
    expect(result.createAgent).toMatchObject({ title: "Fix thing", provider: "codex/model", settings: { modeId: "full-access", thinkingOptionId: "high" }, workspaceId: "<from create_workspace>", notifyOnFinish: true, labels: { "firstmate.role": "crew", "firstmate.launch": "task.a1" } });
    expect(result.createAgent.initialPrompt).toContain("git fetch origin"); expect(result.createAgent.initialPrompt).toContain("# Status line");
    expect((await calls()).every(args => ["project", "provider"].includes(args[0]!))).toBe(true);
    expect(await readFile(join(home, "data/backlog.md"), "utf8")).toContain(result.backlog.line);
  });
  it.each(["workspaceId", "workspace", "relaunch", "relaunchOf", "promotion", "promote", "agentId"])("refuses unsupported %s before effects", async key => {
    expect(await prepare(request({ [key]: "existing" }))).toMatchObject({ code: "unsupported-before-effects" });
    expect(await entries()).toEqual([]); expect(await calls()).toEqual([]);
  });
  it.each([
    { surprise: true }, { id: 3 }, { id: "../bad" }, { id: "A" }, { id: "a".repeat(65) }, { title: "x\ny" }, { title: "x(y)" }, { title: "" }, { title: "a".repeat(121) }, { agentTitle: "a".repeat(61) },
    { kind: "captain" }, { mode: "x(y)" }, { host: "" }, { project: "a\nb" }, { baseBranch: "--help" }, { baseBranch: "a..b" },
    { agent: { provider: "codex", modeId: "full-access" } }, { agent: { provider: "codex/model", modeId: "" } }, { agent: { provider: "codex/model", modeId: "full-access", extra: true } },
    { backlog: { existing: "replace" } }, { backlog: { existing: "none", note: "x(y)" } }, { backlog: { existing: "none", tags: ["a,b"] } }, { backlog: { existing: "none", tags: Array(13).fill("tag") } }, { backlog: { existing: "none", tags: ["a".repeat(41)] } },
    { brief: { assemble: { intent: "a", spec: "b", rules: "outside.md" } } }, { brief: { file: "data/task/else.md" } }, { brief: { file: "data/task/brief.md", assemble: {} } },
    { brief: { assemble: { intent: { file: "a", extra: true }, spec: "b", rules: null } } }, { dependency: { evidence: "wrong" } }, { captainAuthority: { hold: "x", authority: "" } },
  ])("refuses invalid request %# without writes", async extra => {
    expect((await prepare(request(extra))).ok).toBe(false); expect(await entries()).toEqual([]);
  });
  it.each(["model", "thinking", "project", "host"])("validates %s against host data", async which => {
    const value = request();
    if (which === "model") value.agent.provider = "codex/missing";
    if (which === "thinking") value.agent.thinkingOptionId = "unsupported";
    if (which === "project") value.project = "missing";
    if (which === "host") value.host = "missing";
    expect((await prepare(value)).ok).toBe(false); expect(await entries()).toEqual([]);
  });
  it.each(["\n", "\r\n"])("keeps supplied full brief bytes and two digest domains (%j)", async newline => {
    const value = `\uFEFF  # Custom brief${newline}Art only: café 船. No push.${newline}# Status line${newline}done: art ready${newline}`;
    const path = join(home, "data/task/brief.md"); await writeFile(path, value);
    const result = await prepare(request({ brief: { file: "data/task/brief.md" } }));
    expect(result.createAgent.initialPrompt).toBe(value); expect(await readFile(path, "utf8")).toBe(value);
    expect(result.brief.fileSha256).toBe(digest(value)); expect(result.brief.payloadSha256).toBe(digest(value.replace(/\r\n/g, "\n").trim()));
    expect(result.brief.fileSha256).not.toBe(digest(value.slice(0, -1)));
    expect(result.brief.payloadSha256).not.toBe(digest(value.replace(/\r\n/g, "\n").trim().slice(0, -1)));
  });
  it.each([Buffer.from("# Status line\n__MISSING__"), Buffer.from("# Status line\n\0"), Buffer.from([0xff, 0xfe]), Buffer.from("No status heading")])("refuses invalid brief %#", async value => {
    await writeFile(join(home, "data/task/brief.md"), value);
    expect((await prepare(request({ brief: { file: "data/task/brief.md" } }))).ok).toBe(false); expect(await entries()).toEqual([]);
  });
  it("checks the remote limit, and fills file parts and rules without re-expansion", async () => {
    await writeFile(join(home, "data/task/intent.md"), "Intent {{spec}}"); await writeFile(join(home, "data/project-rules.md"), "Custom rules");
    const result = await prepare(request({ brief: { assemble: { intent: { file: "data/task/intent.md" }, spec: "Actual spec", rules: "data/project-rules.md" } } }), ["--dry-run"]);
    expect(result.createAgent.initialPrompt).toContain("Intent {{spec}}"); expect(result.createAgent.initialPrompt).toContain("Custom rules"); expect(await entries()).toEqual([]);
    await writeFile(join(home, "data/task/brief.md"), "# Status line\n" + "x".repeat(28000));
    expect(await prepare(request({ host: "remote", brief: { file: "data/task/brief.md" } }))).toMatchObject({ code: "brief-too-large" });
  });
  it("keeps an origin-qualified base in the arguments without doubling the brief's remote prefix", async () => {
    const result = await prepare(request({ baseBranch: "origin/main" }), ["--dry-run"]);
    expect(result.createWorkspace.baseBranch).toBe("origin/main");
    expect(result.createAgent.initialPrompt).toContain("`origin/main`"); expect(result.createAgent.initialPrompt).not.toContain("origin/origin/");
  });
  it("refuses escaping file paths and symlinks before effects", async () => {
    await mkdir(join(scratch, "outside")); await writeFile(join(scratch, "outside/spec.md"), "spec");
    await symlink(join(scratch, "outside"), join(home, "data/link"), process.platform === "win32" ? "junction" : "dir");
    for (const file of ["../outside/spec.md", "data/link/spec.md"]) expect((await prepare(request({ brief: { assemble: { intent: "a", spec: { file }, rules: null } } }))).code).toBe("outside-home");
    expect(await entries()).toEqual([]);
  });
});

describe("attempts and current-role recovery", () => {
  it("reserves one attempt across simultaneous prepares", async () => {
    state.delay = 30; await save();
    await writeFile(join(home, "data/task/request.json"), JSON.stringify(request()));
    const results = await Promise.all([run(["prepare", "--file", "data/task/request.json"]), run(["prepare", "--file", "data/task/request.json"])]);
    expect(results.filter(item => item.ok)).toHaveLength(1); expect((await entries()).filter(name => /^\d+\.json$/.test(name))).toEqual(["1.json"]);
  });
  it("blocks issued/unresolved, retains an abandoned plan for deliberate replanning and watches late workers", async () => {
    await prepare();
    expect((await prepare(request({ backlog: { existing: "adopt" } })))).toMatchObject({ code: "attempt-open" });
    expect(await run(["unresolved", "task", "--attempt", "1", "--error", "Lost answer"])).toMatchObject({ state: "unresolved" });
    expect((await prepare(request({ backlog: { existing: "adopt" } })))).toMatchObject({ code: "attempt-open" });
    expect((await run(["abandon", "task", "--attempt", "1"])).ok).toBe(false);
    expect(await run(["abandon", "task", "--attempt", "1", "--reason", "Inspected; duplicate risk accepted"])).toMatchObject({ state: "abandoned" });
    expect(await prepare()).toMatchObject({ ok: false, error: expect.stringContaining("already belongs to a plan") });
    await addWorker();
    expect((await run(["status", "task"])).attempts[0]).toMatchObject({ state: "abandoned", duplicate: true, found: [workerId] });
  });
  it("reconciles a lost create answer without another create", async () => {
    await prepare(); await run(["unresolved", "task", "--attempt", "1"]); await addWorker();
    const before = await readFile(join(home, "data/task/launches/1.json"), "utf8");
    expect((await run(["status", "task"])).attempts[0].found).toEqual([workerId]);
    expect(await readFile(join(home, "data/task/launches/1.json"), "utf8")).toBe(before);
    expect(await run(["unresolved", "task", "--attempt", "1"])).toMatchObject({ state: "recorded", agent: workerId });
    expect((await calls()).some(args => args[0] === "run")).toBe(false);
  });
  it("records under a successor, warns, rejects a guest, and status takes no lock", async () => {
    await prepare(); await addWorker(); await writeFile(configPath, JSON.stringify({ mateAgentId: "successor", home }));
    expect((await record()).code).toBe("not-first-mate");
    const result = await run(["record", "task", "--attempt", "1", "--agent", workerId, "--workspace", "wks"], "successor");
    expect(result).toMatchObject({ state: "recorded", recorder: "successor", launchedBy: "mate", handover: true }); expect(result.warning).toContain("Check it on your heartbeat");
    await writeFile(join(home, "data/task/launches/.lock"), "held");
    expect((await run(["status", "task"], "guest")).ok).toBe(true);
    expect(await readFile(join(home, "data/task/launches/.lock"), "utf8")).toBe("held");
  });
  it("preserves the daemon identity hint for the role guard", async () => {
    await writeFile(join(home, "data/task/request.json"), JSON.stringify(request()));
    expect((await run(["prepare", "--file", "data/task/request.json"], "mate", { PASEO_HOME: home })).code).toBe("not-first-mate");
    expect(await entries()).toEqual([]); expect(await calls()).toEqual([]);
  });
  it("refuses a live recorded worker before effects, and never guesses failed reads mean gone", async () => {
    await prepare(); await addWorker(); await record();
    expect((await prepare()).code).toBe("unsupported-before-effects");
    state.fail = "inspect"; await save();
    // A manually returned Queued line does not evade the live-worker check.
    await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n- [ ] task - Filed title\n## Done\n");
    expect((await prepare(request({ backlog: { existing: "adopt" } }))).code).toBe("cli-read-failed");
  });
  it("tracks a relabelled recorded identity and requires a revised plan after the worker is gone", async () => {
    await prepare(); await addWorker(); await record();
    state.agents[0].labels = {}; await save();
    expect((await prepare()).code).toBe("unsupported-before-effects");
    expect((await run(["abandon", "task", "--attempt", "1", "--reason", "try again"])).code).toBe("unsupported-before-effects");
    state.agents[0].detail.Archived = true; await save();
    expect(await prepare()).toMatchObject({ ok: false, error: expect.stringContaining("already belongs to a plan") });
  });
  it("does not treat a missing recorded identity as proof it is gone", async () => {
    await prepare(); await addWorker(); await record(); state.agents = []; await save();
    expect((await prepare()).code).toBe("cli-read-failed");
    expect((await entries()).filter(name => /^\d+\.json$/.test(name))).toEqual(["1.json"]);
  });
  it("reports stale locks and only removes a checked, dead pid explicitly", async () => {
    await mkdir(join(home, "data/task/launches"));
    const lock = join(home, "data/task/launches/.lock");
    await writeFile(lock, JSON.stringify({ pid: process.pid }));
    expect((await run(["unlock", "task"])).code).toBe("lock-live");
    // Spawn and reap a child to obtain a pid known to have exited.
    const child = execFile(process.execPath, ["-e", ""], { windowsHide: true });
    const pid = child.pid; await new Promise(resolve => child.on("exit", resolve));
    await writeFile(lock, JSON.stringify({ pid }));
    expect((await prepare()).code).toBe("stale-lock");
    expect((await run(["unlock", "task"])).ok).toBe(true); expect((await prepare()).ok).toBe(true);
  });
});

describe("backlog and gates", () => {
  it.each(["\n", "\r\n"])("preserves BOM, other lines and line endings (%j), saves the exact recovery line", async eol => {
    const source = `\uFEFF# Books${eol}## In flight${eol}- [ ] other - Unrelated (note: untouched)${eol}## Queued${eol}- [ ] task - Filed title (tags: Art)${eol}## Done${eol}`;
    await writeFile(join(home, "data/backlog.md"), source);
    const issued = await prepare(request({ backlog: { existing: "adopt" } }));
    expect(issued.backlog.line).toContain("Filed title"); expect(issued.backlog.line).toContain("(tags: Art)");
    await addWorker(); const result = await record();
    const after = await readFile(join(home, "data/backlog.md"), "utf8");
    expect(after.charCodeAt(0)).toBe(0xfeff); expect(after).toContain(`- [ ] other - Unrelated (note: untouched)${eol}`);
    expect(after).toContain(result.backlog.line + eol); expect(result.backlog.warning).toContain("without detection");
    const without = after.replace(result.backlog.line + eol, ""); await writeFile(join(home, "data/backlog.md"), without);
    const tool = await module(); const restored = tool.backlogEdit(Buffer.from(without), "task", result.backlog.line, "In flight");
    expect(restored.toString()).toBe(after);
  });
  it("detects the before-compare change and the after-rename missing line, with no claim about the intervening window", async () => {
    const tool = await module(), path = join(home, "data/backlog.md"), before = await readFile(path), line = "- [ ] task - Task";
    const after = tool.backlogEdit(before, "task", line, "Queued");
    await expect(tool.replaceBacklog(path, before, after, line, { beforeCompare: () => writeFile(path, "changed") })).rejects.toMatchObject({ code: "backlog-changed" });
    expect(await readFile(path, "utf8")).toBe("changed"); await writeFile(path, before);
    await expect(tool.replaceBacklog(path, before, after, line, { afterRename: () => writeFile(path, before) })).rejects.toMatchObject({ code: "backlog-line-missing" });
  });
  it("binds dependency evidence and captain authority to the filed hold, without consulting Done", async () => {
    await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n- [ ] task - Filed title (blocked-by: missing-history) (kind: captain) (hold: Approve art)\n## Done\n");
    const value = request({ backlog: { existing: "adopt" } });
    expect((await prepare(value)).code).toBe("dependency-evidence-required");
    value.dependency = { satisfiedBy: "art at fm/art commit abc1234" };
    expect((await prepare(value)).code).toBe("captain-authority-required");
    value.captainAuthority = { hold: "Other hold", authority: "Approved 2026-10-17" };
    expect((await prepare(value)).ok).toBe(false);
    value.captainAuthority.hold = "Approve art";
    const result = await prepare(value); expect(result.ok).toBe(true);
    expect(result.backlog.line).toContain("art at fm/art commit abc1234"); expect(result.backlog.line).toContain("Approved 2026-10-17");
    expect(result.backlog.line).not.toContain("(hold:"); expect(result.backlog.line).not.toContain("(blocked-by:");
  });
  it("requires authority for captain items without a hold and rejects an unrelated override", async () => {
    await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n- [ ] task - Decide art (kind: captain)\n## Done\n");
    const value = request({ backlog: { existing: "adopt" }, captainAuthority: { hold: "Decide art", authority: "Approved the art 2026-10-17" } });
    expect((await prepare(value, ["--dry-run"])).ok).toBe(true);
    await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n- [ ] task - Decide art\n## Done\n");
    expect((await prepare(value)).code).toBe("authority-mismatch");
  });
});

describe("record checks", () => {
  it("checks real local branch/merge-base, canonical cwd, labels and parent; arming stays reported", async () => {
    await prepare(); await addWorker(); const result = await record();
    expect(result).toMatchObject({ state: "recorded", checks: { labels: "pass", workspace: "pass", isolation: "pass", parent: "pass", cwd: "pass", branch: "pass", baseBranch: "pass", settings: "pass" }, armed: { reported: true, verified: false }, briefDeliveredIntact: "unknown" });
  });
  it.each(["labels", "parent", "workspace", "isolation", "cwd", "branch", "baseBranch"])("accounts for a worker when %s alone fails", async check => {
    await prepare(); await addWorker();
    if (check === "labels") state.agents[0].labels["firstmate.kind"] = "scout";
    if (check === "parent") state.agents[0].detail.ParentAgentId = "other";
    if (check === "workspace") state.workspaces = [];
    if (check === "isolation") state.workspaces[0].isolation = "local";
    if (check === "cwd") state.agents[0].detail.Cwd = home;
    if (check === "branch") await execute("git", ["-C", cwd, "checkout", "main"]);
    if (check === "baseBranch") {
      await execute("git", ["-C", cwd, "checkout", "main"]);
      await execute("git", ["-C", cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "New base"]);
      await execute("git", ["-C", cwd, "checkout", "fm/task"]);
    }
    await save(); const result = await record(); expect(result.state).toBe("recorded"); expect(result.checks[check]).toBe("fail"); expect(result.problems).toContain(check);
    expect(result.backlog.line).toContain(`(agent: ${workerId})`);
  });
  it.each(["Provider", "Model", "Mode", "Thinking"])("records %s differences as informational", async field => {
    await prepare(); await addWorker(); state.agents[0].detail[field] = "changed"; await save();
    const result = await record(); expect(result.ok).toBe(true); expect(result.checks.settings).toBe("settings-differ"); expect(result.problems).toEqual([]);
  });
  it("reports unreadable Git data as unknown", async () => {
    await prepare(); await addWorker(); state.workspaces[0].cwd = home; state.agents[0].detail.Cwd = home; await save();
    expect((await record()).checks).toMatchObject({ branch: "unknown", baseBranch: "unknown" });
  });
  it("reports missing inspect fields as unknown and does not replace an already-recorded identity", async () => {
    await prepare(); await addWorker(); delete state.agents[0].detail.ParentAgentId; delete state.agents[0].detail.Mode; await save();
    expect((await record()).checks).toMatchObject({ parent: "unknown", settings: "unknown" });
    expect((await run(["record", "task", "--attempt", "1", "--agent", "different", "--workspace", "wks"])).code).toBe("already-recorded");
  });
});

describe("remote queue and uncertainty", () => {
  it("launches with byte-exact Windows cwd, prompt-file and no reserved labels; remote.mjs writes receipts", async () => {
    await remoteFixture(); const result = await prepare(request({ host: "Remote" }));
    expect(result).toMatchObject({ state: "recorded", host: "remote", agent: workerId });
    const wire = JSON.parse(await readFile(join(home, "data/task/launches/1.remote.json"), "utf8"));
    expect(wire.args.slice(0, 5)).toEqual(["run", "--prompt-file", "data/task/brief.md", "--cwd", "C:\\Users\\Worker Name\\project"]);
    expect(wire.args).toContain("--base"); expect(wire.args).toContain("firstmate.launch=task.a1");
    expect(wire.args.some((arg: string) => /^firstmate\.(role|owner)=/.test(arg))).toBe(false);
    const sent = (await calls()).filter(args => args[0] === "run"); expect(sent).toHaveLength(1); expect(sent[0]).toContain("--"); expect(sent[0]).not.toContain("--prompt-file");
    expect(result.checks.parent).toContain("not-applicable"); expect(result.checks.branch).toContain("unknown"); expect(result.checks.role).toContain("unknown");
    expect(result.backlog.line).toContain("(host: remote)");
    const receipts = await readdir(join(home, "data/remote-action-receipts")); expect(receipts.some(name => name.endsWith(".started.json"))).toBe(true); expect(receipts.some(name => name.endsWith(".succeeded.json"))).toBe(true);
  });
  it("keeps timeout unresolved and never sends a second run", async () => {
    await remoteFixture("timeout"); expect(await prepare(request({ host: "remote" }))).toMatchObject({ state: "unresolved" });
    expect((await prepare(request({ host: "remote", backlog: { existing: "adopt" } }))).code).toBe("attempt-open");
    expect((await calls()).filter(args => args[0] === "run")).toHaveLength(1);
  });
  it("has a remote scout return its report through the bridge, not write the local home", async () => {
    await remoteFixture(); const result = await prepare(request({ host: "remote", kind: "scout" }));
    expect(result.state).toBe("recorded");
    const brief = await readFile(join(home, "data/task/brief.md"), "utf8");
    expect(brief).toContain("Return the full report in the final reply"); expect(brief).not.toContain(home);
  });
  it.each(["explicit-found", "explicit-empty"])("reconciles an explicit CLI error (%s) before choosing a state", async behavior => {
    await remoteFixture(behavior); const result = await prepare(request({ host: "remote" }));
    expect(result.state).toBe(behavior === "explicit-found" ? "recorded" : "failed");
    if (behavior === "explicit-empty") expect(result.partialEffectsNote).toContain("leftover worktree");
    expect((await calls()).filter(args => args[0] === "run")).toHaveLength(1); await reload();
  });
});

describe("render and packaging", () => {
  it("fills exactly once, creates no launch/queue effects, and writes only an explicit new message", async () => {
    await writeFile(join(home, "data/templates/example.md"), "{{one}} / {{two}}");
    const args = ["render", "example", "--set", "one={{two}}", "--set", "two=literal"];
    expect(await run(args, "guest")).toMatchObject({ text: "{{two}} / literal" }); expect(await entries()).toEqual([]); expect(await calls()).toEqual([]);
    expect((await run([...args, "--out", "data/task/message.md"], "guest")).ok).toBe(true);
    expect(await readFile(join(home, "data/task/message.md"), "utf8")).toBe("{{two}} / literal\n");
    expect((await run([...args, "--out", "data/task/message.md"], "guest")).ok).toBe(false);
  });
  it("seeds editable templates, refreshes plugin code, and documents every command", async () => {
    await writeFile(join(home, "data/templates/land.md"), "Captain edited"); await writeFile(join(home, "tools/launch.mjs"), "stale");
    await prepareHome(home, FirstmateConfigSchema.parse({}));
    expect(await readFile(join(home, "data/templates/land.md"), "utf8")).toBe("Captain edited");
    const rendered = await readFile(join(home, "tools/launch.mjs"), "utf8"); expect(rendered).not.toContain("{{launchConfigJson}}");
    for (const name of ["prepare", "record", "unresolved", "abandon", "status", "render", "unlock", "help"]) expect((await run(["help"], "guest")).help).toContain(name);
    expect(Object.values(TEMPLATES)).toContain("tools/launch.mjs"); expect(Object.values(TEMPLATES)).toContain("parts/brief-rules.md");
  });
});
