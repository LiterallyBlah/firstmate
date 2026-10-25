import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
import { WorkflowPlanStore } from "./workflow-plans";
import { processWorkflowRequests } from "./workflow-service";
import { readTemplate, TEMPLATES } from "./templates";

const execute = promisify(execFile);
let home: string, store: WorkflowPlanStore, timer: ReturnType<typeof setInterval>, pending: Promise<void> | undefined;
beforeEach(async () => {
  home = join(process.env.PASEO_HOME!, randomUUID()); await mkdir(join(home, "tools"), { recursive: true }); await mkdir(join(home, "data/task"), { recursive: true });
  await writeFile(join(home, "tools/workflow.mjs"), await readTemplate(TEMPLATES.workflowHelper));
  await writeFile(join(home, "tools/role.mjs"), 'console.log(process.env.PASEO_AGENT_ID === "mate" ? "first-mate" : "guest");');
  await writeFile(join(home, "data/task/brief.md"), "Do this task.");
  store = new WorkflowPlanStore(join(home, "ledger"), home);
  timer = setInterval(() => { pending ??= processWorkflowRequests(home, store, async actor => { if (actor !== "mate") throw new Error("Wrong role"); }).finally(() => { pending = undefined; }); }, 10);
});
afterEach(async () => { clearInterval(timer); await pending; });
async function run(args: string[], actor = "mate") {
  try { return JSON.parse((await execute(process.execPath, [join(home, "tools/workflow.mjs"), ...args], { cwd: home, env: { ...process.env, PASEO_AGENT_ID: actor }, windowsHide: true, timeout: 10000 })).stdout); }
  catch (e: any) { return JSON.parse(e.stdout); }
}
it("transports plans, an implicit start, records, read-only agenda and idempotent requests", async () => {
  const launch = { id: "task", title: "Task", agentTitle: "Task", project: "project", host: "local", baseBranch: "main", kind: "ship", mode: "direct-PR", brief: { file: "data/task/brief.md" }, agent: { provider: "codex/model", modeId: "full-access" }, backlog: { existing: "none" } };
  await writeFile(join(home, "data/task/request.json"), JSON.stringify(launch));
  expect(await run(["plans"], "guest")).toMatchObject({ ok: true, result: [] });
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n- [ ] choose - Choose (kind: captain) (hold: Pick) (blocked-by: waiting for evidence) (plan: request) (needed-by: build, test)\n## Done\n");
  expect(await run(["lint"], "guest")).toMatchObject({ ok: true, result: { valid: true, problems: [], sources: [{ disposition: "parked" }] } });
  const id = randomUUID(), args = ["start", "--file", "data/task/request.json", "--request-id", id];
  const started = await run(args); expect(started.ok).toBe(true); expect(await run(args)).toEqual(started);
  const before = await readFile(join(home, "ledger/task/00000000.json"), "utf8");
  expect((await run(["agenda", "--json"])).result[0].kind).toBe("replan"); expect(await readFile(join(home, "ledger/task/00000000.json"), "utf8")).toBe(before);
  const attempt = started.result.launch.workflow.attempt;
  expect(await run(["record", "--plan", "task", "--node", "task", "--attempt", attempt, "--state", "running", "--agent", "worker", "--workspace", "space", "--evidence", "Inspected worker"])).toMatchObject({ ok: true });
  expect((await run(["plan", "task"])).result.nodes.task.agentId).toBe("worker");
  await run(["record", "--plan", "task", "--node", "task", "--attempt", attempt, "--state", "done", "--evidence", "Verified evidence-only trial"]);
  const current = (await store.get("task"))!;
  expect(await run(["close", "--plan", "task", "--node", "task", "--attempt", attempt, "--expected", current.hash, "--evidence", "Verified trial report; no change is intended to land."])).toMatchObject({ ok: true, result: { plan: { nodes: { task: { state: "done", closedWithoutLanding: { by: "mate" } } } } } });
  expect(await run(["start", "--file", "data/task/request.json"], "guest")).toMatchObject({ ok: false, error: expect.stringContaining("current first mate") });
  expect(await run(["start", "--file", "../outside.json"])).toMatchObject({ ok: false });
});
it("transports explicit delegation, a routine decision and revocation through the existing request handler", async () => {
  const launch = { id: "task", title: "Task", agentTitle: "Task", project: "project", host: "local", baseBranch: "main", kind: "ship", mode: "reviewed-PR", brief: { file: "data/task/brief.md" }, agent: { provider: "codex/model", modeId: "full-access" }, backlog: { existing: "none" } };
  const definition = { format: "firstmate.plan/1", id: "outcome", title: "Ship outcome", request: { text: "Choose and ship", at: "2026-10-20T12:00:00Z" },
    ownership: { owner: "firstmate", evidence: "Captain delegated this outcome" }, budget: { agents: 1, turns: 1 }, nodes: [
      { id: "choice", kind: "decision", authority: "owner", title: "Choose route", summary: "Select the implementation route", options: [{ id: "simple", label: "Simple", consequence: "Use the simple approach" }, { id: "complex", label: "Complex", consequence: "Use the complex approach" }], recommendation: "simple", rationale: "Current scope is bounded" },
      { id: "task", kind: "run", title: "Task", summary: "Ship the selected route", workflow: "task@1", launch, after: [{ node: "choice", reason: "decision", on: "answered" }] },
    ] };
  await writeFile(join(home, "data/task/plan.json"), JSON.stringify(definition));
  expect(await run(["plan", "draft", "--file", "data/task/plan.json"])).toMatchObject({ ok: true, result: { plan: { owner: "firstmate", status: "active" } } });
  const shown = (await run(["plan", "outcome"])).result;
  const answer = { op: "progress", plan: "outcome", revision: shown.revision, subjectHash: shown.subjectHash, action: "answer", node: "choice", option: "simple", evidence: "Current brief supports the simple route" };
  await writeFile(join(home, "data/task/progress.json"), JSON.stringify(answer));
  expect(await run(["plan", "progress", "--file", "data/task/progress.json"])).toMatchObject({ ok: true, result: { plan: { nodes: { choice: { answer: "simple" } } } } });
  expect((await run(["start", "--plan", "outcome", "--node", "task"])).result.launch.workflow.attempt).toBeTruthy();
  const after = (await run(["plan", "outcome"])).result;
  const transfer = { op: "captain", plan: "outcome", revision: after.revision, subjectHash: after.subjectHash, action: "transfer", owner: "captain", text: "Captain takes back routine decisions" };
  await writeFile(join(home, "data/task/transfer.json"), JSON.stringify(transfer));
  expect(await run(["plan", "action", "--file", "data/task/transfer.json"])).toMatchObject({ ok: true, result: { plan: { owner: "captain", ownerEvents: [{ to: "captain" }] } } });
  expect(await run(["plan", "progress", "--file", "data/task/progress.json"])).toMatchObject({ ok: false });
});
it("retires a quarantined plan through the first-mate tool while retaining files, attempts and scoped reservations", async () => {
  const launch = { id: "task", title: "Task", agentTitle: "Task", project: "project", host: "local", baseBranch: "main", kind: "ship", mode: "direct-PR", brief: { file: "data/task/brief.md" }, agent: { provider: "codex/model", modeId: "full-access" }, backlog: { existing: "none" } };
  await writeFile(join(home, "data/task/request.json"), JSON.stringify(launch));
  const started = await run(["start", "--file", "data/task/request.json"]), attempt = started.result.launch.workflow.attempt;
  await run(["record", "--plan", "task", "--node", "task", "--attempt", attempt, "--state", "running", "--agent", "worker", "--workspace", "space", "--evidence", "Inspected existing worker"]);
  const first = await readFile(join(home, "ledger/task/00000000.json"), "utf8"), damaged = join(home, "ledger/task/00000001.json");
  await writeFile(damaged, "{");
  const inspection = (await run(["plan", "task"], "guest")).result.quarantined;
  const requestId = randomUUID(), command = { op: "retire", plan: "task", expected: inspection.fingerprint, evidence: "Inspected worker; work remains accounted in its original workspace" };
  const args = ["retire", "--plan", "task", "--expected", command.expected, "--evidence", command.evidence, "--request-id", requestId];
  expect(await run(args, "guest")).toMatchObject({ ok: false, error: expect.stringContaining("current first mate") });
  // A forged queued command must independently pass the daemon's current-role guard.
  const forged = randomUUID();
  await writeFile(join(home, `data/workflow-requests/${forged}.json`), JSON.stringify({ id: forged, actor: "former", command }));
  await processWorkflowRequests(home, store, async actor => { if (actor !== "mate") throw new Error("Wrong role"); });
  expect(JSON.parse(await readFile(join(home, `data/workflow-requests/${forged}.reply.json`), "utf8"))).toMatchObject({ ok: false, error: "Wrong role" });
  await writeFile(damaged, "{ changed");
  expect(await run(args)).toMatchObject({ ok: false, error: expect.stringContaining("changed since inspection") });
  const current = (await run(["plan", "task"])).result.quarantined;
  command.expected = current.fingerprint; args[4] = current.fingerprint; args[8] = randomUUID();
  const retired = await run(args); expect(retired.ok).toBe(true); expect(await run(args)).toEqual(retired);
  expect(await store.execute(command as any, args[8]!, "mate")).toEqual(retired.result);
  expect(retired.result.inventory.attempts).toContainEqual({ node: "task", attempt, spent: 1, agentId: "worker", workspaceId: "space" });
  expect(retired.result.inventory.budget).toEqual({ agents: 1, turns: 1 });
  expect(await readFile(join(home, "ledger/task/00000000.json"), "utf8")).toBe(first); expect(await readFile(damaged, "utf8")).toBe("{ changed");
  expect((await store.read()).problems).toEqual([]); expect((await store.read()).warnings.join()).toContain("Retired quarantine task");
  expect(await run(["start", "--file", "data/task/request.json"])).toMatchObject({ ok: false, error: expect.stringContaining("retired") });
  const clone = { format: "firstmate.plan/1", id: "clone", title: "Clone", request: { text: "Reuse task", at: "2026-10-20T12:00:00Z" }, budget: { agents: 1, turns: 1 }, nodes: [{ id: "task", title: "Task", summary: "Task", kind: "run", workflow: "task@1", launch }] };
  await expect(store.execute({ op: "draft", definition: clone } as any, randomUUID(), "mate")).rejects.toThrow("ownership");
});
