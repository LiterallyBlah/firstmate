import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { FirstmateConfigSchema } from "../shared/fleet";
import type { SupervisionStatus } from "../shared/supervision";
import type { RuleViolation } from "../shared/plan-rules";
import { WorkflowSnapshotSchema } from "../shared/workflow-rpc";
import { workflowFixture } from "../test/workflow-fixture";
import { loadFleet, ReportCache } from "./fleet";
import { cutoverGate } from "./supervision-gate";
import { startWorkflowService, workflowStore } from "./workflow-service";
import { updateFirstmateConfig } from "./config";
import { PLAN_READ_BUDGET_MS, workflowSnapshot, withWorkflowFleet } from "./workflow-board";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const at = "2026-11-05T12:00:00Z", completedAt = "2026-11-06T12:00:00Z";
async function fixture() {
  const home = join(process.env.PASEO_HOME!, randomUUID());
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  await workflowStore(home).execute({ op: "draft", definition: workflowFixture() }, randomUUID(), "mate");
  const plan = (await workflowStore(home).get("scheduler"))!;
  plan.status = "active";
  const acceptedAttempt = randomUUID(), oldAttempt = randomUUID();
  plan.nodes.trial = { state: "done", attempt: acceptedAttempt, agentId: "current", completedAt, evidence: "Verified bounded report",
    priorAttempts: [{ state: "failed", attempt: oldAttempt, agentId: "prior", completedAt: at, evidence: "Retained failed trial" }] };
  const scopeId = randomUUID();
  const refusal: RuleViolation = { format: "firstmate.rule-violation/1", id: randomUUID(), version: 1, homeId: home, scopeId,
    planId: "scheduler", nodeId: "trial", attemptId: oldAttempt, stage: "completion", subjectHash: "a".repeat(64), rules: null, conditions: ["regression has not passed on this fix"], at };
  const scoped = { freshness: "current", plans: [{ scopeId, plan }], backends: [{ planId: "scheduler", ownerScopeId: scopeId, backend: "scoped", state: "active" }], ruleViolations: [refusal] } as SupervisionStatus;
  const agents = ["current", "prior", "unknown"].map(id => ({ id, title: id, archivedAt: null, provider: "muse", model: null, status: "idle", cwd: home,
    pendingPermissions: [], updatedAt: completedAt, labels: { "firstmate.role": "crew", "firstmate.task": id === "unknown" ? "unknown" : "trial", "firstmate.project": "scheduler" } }));
  const paseo: any = { agents: { list: async () => ({ entries: agents.map(agent => ({ agent })), pageInfo: {} }) }, config: { get: async () => ({ config: { mcp: { injectIntoAgents: true } } }) } };
  const cache = new ReportCache();
  vi.spyOn(cache, "reportFor").mockResolvedValue({ state: "pending", report: null });
  const fleet = await loadFleet(paseo, FirstmateConfigSchema.parse({ home }), cache);
  return { home, plan, scoped, refusal, fleet, agents, paseo };
}

it("reproduces the production fleet path, scopes historical unknown reports to cards, and retains the unknown current warning", async () => {
  const { home, scoped, fleet } = await fixture();
  const view = WorkflowSnapshotSchema.parse(await workflowSnapshot(home, scoped));
  const result = await withWorkflowFleet(fleet, PLAN_READ_BUDGET_MS, async () => view);
  expect(result.warnings.filter(w => w.startsWith("Crew"))).toEqual([expect.stringContaining("Crew unknown (unknown) report pending")]);
  for (const id of ["current", "prior", "unknown"]) expect(result.cards.find(c => c.agent?.id === id)?.reportWarning).toContain("latest status line is unknown");
  expect(result.cards.find(c => c.agent?.id === "prior")?.report).toBeNull(); // Never invent success for the failed attempt.
  expect(scoped.plans[0]!.plan.nodes.trial!.priorAttempts![0]!.state).toBe("failed");
});

it.each(["running", "error", "permission", "task", "project", "host", "ambiguous", "invalidated", "held", "missing-evidence"])("keeps report warnings when exact accepted history cannot explain %s", async kind => {
  const { home, scoped, fleet, plan } = await fixture();
  const card = fleet.cards.find(c => c.agent?.id === "current")!;
  if (kind === "running" || kind === "error") card.agent!.status = kind;
  if (kind === "permission") card.agent!.pendingPermissions = 1;
  if (kind === "task") card.taskId = "another-use-of-the-same-session";
  if (kind === "project") card.project = "other";
  if (kind === "host") plan.definition.nodes[0]!.kind === "run" && (plan.definition.nodes[0]!.launch.host = "remote");
  if (kind === "ambiguous") scoped.plans.push({ scopeId: randomUUID(), plan: { ...plan, definition: { ...plan.definition, id: "other" } } });
  if (kind === "ambiguous") scoped.backends.push({ ...scoped.backends[0]!, planId: "other", ownerScopeId: scoped.plans[1]!.scopeId });
  if (kind === "invalidated") plan.nodes.trial!.invalidated = "Renew evidence";
  if (kind === "held") plan.nodes.trial!.held = true;
  if (kind === "missing-evidence") delete plan.nodes.trial!.evidence;
  const result = await withWorkflowFleet(fleet, PLAN_READ_BUDGET_MS, () => workflowSnapshot(home, scoped));
  expect(result.warnings).toContainEqual(expect.stringContaining("Crew current (current) report pending"));
});

it("keeps refusal history inspectable while accepted later progress removes only the obsolete global warning", async () => {
  const { home, scoped, refusal } = await fixture();
  const view = WorkflowSnapshotSchema.parse(await workflowSnapshot(home, scoped));
  expect(view.warnings?.join()).not.toContain("regression has not passed");
  expect(view.ruleRefusals).toEqual([{ record: refusal, historical: true }]);
});

it.each(["failed", "unresolved", "invalidated", "held", "earlier", "other-owner", "missing-attempt", "missing-node", "held-source"])("retains a genuine or uncertain refusal with %s", async kind => {
  const { home, scoped, plan, refusal } = await fixture();
  if (kind === "failed" || kind === "unresolved") plan.nodes.trial!.state = kind;
  if (kind === "invalidated") plan.nodes.trial!.invalidated = "New check needed";
  if (kind === "held") plan.nodes.trial!.held = true;
  if (kind === "earlier") plan.nodes.trial!.completedAt = "2026-11-04T12:00:00Z";
  if (kind === "other-owner") refusal.scopeId = randomUUID();
  if (kind === "missing-attempt") refusal.attemptId = randomUUID();
  if (kind === "missing-node") refusal.nodeId = "missing";
  if (kind === "held-source") scoped.freshness = "held";
  const view = await workflowSnapshot(home, scoped);
  expect(view.warnings?.join()).toContain("regression has not passed");
});

it("retains old dispatch refusals and both failure records while later accepted progress supersedes their alerts", async () => {
  const { home, scoped, refusal } = await fixture();
  refusal.stage = "dispatch"; refusal.attemptId = null;
  const failures = [{ id: "first-failure" }, { id: "second-failure" }];
  scoped.ruleFailures = failures as NonNullable<SupervisionStatus["ruleFailures"]>;
  const before = structuredClone(scoped);
  expect((await workflowSnapshot(home, scoped)).ruleRefusals).toEqual([{ record: refusal, historical: true }]);
  expect(scoped).toEqual(before); // No report classification writes evidence, failure history, budgets or ownership.
});

it("removes a successful legacy cutover notice only when the current scoped owner is readable", async () => {
  const { home, scoped } = await fixture();
  await cutoverGate(home).publishSidecar({ format: "firstmate.cutover-sidecar/1", compatibility: 1, stage: "committed", homeId: home, planId: "scheduler",
    migrationId: randomUUID(), scopeId: scoped.plans[0]!.scopeId, at, sourceHash: "a".repeat(64), inventoryHash: "b".repeat(64), transaction: null,
    tokens: { plan: "scheduler", nodes: ["trial", "database", "build"], actions: [], agents: ["current", "prior"], tasks: [{ task: "trial", host: "local" }] } });
  expect((await workflowStore(home).read()).warnings.join()).toContain("legacy history is read-only");
  expect((await workflowSnapshot(home, scoped)).warnings?.join()).not.toContain("legacy history is read-only");
  await expect(workflowStore(home).execute({ op: "start", plan: "scheduler", node: "trial" }, randomUUID(), "mate")).rejects.toThrow("legacy writer cannot change it");
  scoped.freshness = "held";
  const unknown = await workflowSnapshot(home, scoped);
  expect([...unknown.problems ?? [], ...unknown.warnings ?? []].join()).toContain("legacy history is read-only");
  expect(unknown.plans).toEqual([]);
});

it("keeps corrupted cutover evidence and incomplete plan reads globally visible", async () => {
  const { home, scoped, fleet } = await fixture();
  const directory = join(cutoverGate(home).directory, "scheduler");
  await mkdir(directory, { recursive: true }); await writeFile(join(directory, "committed.json"), "{");
  const result = await withWorkflowFleet(fleet, PLAN_READ_BUDGET_MS, () => workflowSnapshot(home, scoped));
  expect(result.warnings.join()).toContain("damaged");
  expect(result.warnings).toContainEqual(expect.stringContaining("Crew current (current) report pending"));
});

it("answers a real workflow-clock request while three native report reads remain pending", async () => {
  const { home, paseo } = await fixture();
  await writeFile(join(home, "AGENTS.md"), "# Disposable reporting fixture");
  await updateFirstmateConfig({ home, mateAgentId: "", mateLaunch: null, migration: null });
  // Freeze only the service/observation timers, leaving filesystem scheduling real. A slow CI
  // filesystem must not expire the optional history budget before it can answer the request.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  let release!: (page: unknown) => void, fleetSettled = false;
  const native = new Promise(done => { release = done; });
  const read = vi.fn(() => native);
  paseo.agents.ref = () => ({ timeline: { refetch: read } });
  const pendingFleet = loadFleet(paseo, FirstmateConfigSchema.parse({ home }), new ReportCache()).then(result => { fleetSettled = true; return result; });
  const directory = join(home, "data/workflow-requests"), id = randomUUID();
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${id}.json`), JSON.stringify({ id, actor: "mate", command: { op: "show", plan: "scheduler" } }));
  const stop = startWorkflowService();
  try {
    await vi.advanceTimersByTimeAsync(1000);
    const deadline = Date.now() + 20000;
    let reply: string | null = null;
    while (Date.now() < deadline && reply === null) {
      try { reply = await readFile(join(directory, `${id}.reply.json`), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (reply === null) await delay(25);
    }
    expect(reply).not.toBeNull();
    expect(JSON.parse(reply!)).toMatchObject({ ok: true, result: { definition: { id: "scheduler" } } });
    expect(read).toHaveBeenCalledTimes(3);
    expect(fleetSettled).toBe(false); // Disconfirms a direct reporting/role-lock dependency, not all live-stall causes.
  } finally { release({ entries: [] }); await pendingFleet; await stop(); }
}, 30000);

it("control: uniquely identified accepted history scopes the matching alert", async () => {
  const { home, scoped, fleet } = await fixture();
  const result = await withWorkflowFleet(fleet, PLAN_READ_BUDGET_MS, () => workflowSnapshot(home, scoped));
  expect(result.warnings.some(w => w.startsWith("Crew current (current)"))).toBe(false);
  expect(result.warnings.some(w => w.startsWith("Crew unknown (unknown)"))).toBe(true);
});

it.each(["missing-current-attempt", "missing-prior-attempt", "reused-same-node", "reused-removed-node"])("review: preserves global uncertainty for %s", async kind => {
  const { home, scoped, fleet, plan } = await fixture();
  const state = plan.nodes.trial!;
  let agent = "current";
  if (kind === "missing-current-attempt") delete state.attempt;
  if (kind === "missing-prior-attempt") { delete state.priorAttempts![0]!.attempt; agent = "prior"; }
  if (kind === "reused-same-node") state.priorAttempts![0]!.agentId = "current";
  if (kind === "reused-removed-node") {
    const node = structuredClone(plan.definition.nodes[0]!); node.id = "removed-other-use";
    plan.removed = [{ node, state: { state: "failed", attempt: randomUUID(), agentId: "current", evidence: "Retain other use", completedAt: at } }];
  }
  const view = WorkflowSnapshotSchema.parse(await workflowSnapshot(home, scoped));
  const result = await withWorkflowFleet(fleet, PLAN_READ_BUDGET_MS, async () => view);
  expect(result.warnings).toContainEqual(expect.stringContaining(`Crew ${agent} (${agent}) report pending`));
});

it("review: retains the cutover warning if its recorded owner differs from the scoped overlay", async () => {
  const { home, scoped } = await fixture();
  await cutoverGate(home).publishSidecar({ format: "firstmate.cutover-sidecar/1", compatibility: 1, stage: "committed", homeId: home, planId: "scheduler",
    migrationId: randomUUID(), scopeId: randomUUID(), at, sourceHash: "a".repeat(64), inventoryHash: "b".repeat(64), transaction: null,
    tokens: { plan: "scheduler", nodes: ["trial", "database", "build"], actions: [], agents: ["current", "prior"], tasks: [{ task: "trial", host: "local" }] } });
  expect((await workflowStore(home).read()).warnings.join()).toContain("legacy history is read-only");
  const view = await workflowSnapshot(home, scoped);
  expect([...(view.problems ?? []), ...(view.warnings ?? [])].join()).toContain("legacy history is read-only");
});

it("review: real store replay can retain the same native identity across distinct attempts", async () => {
  const { home, scoped, fleet } = await fixture(), store = workflowStore(home);
  await mkdir(join(home, "data/trial"), { recursive: true });
  await writeFile(join(home, "data/trial/brief.md"), "Bounded disposable source-replay fixture.");
  const drafted = (await store.get("scheduler"))!;
  await store.execute({ op: "approve", plan: "scheduler", expected: drafted.hash, quote: "Approve fixture only" }, randomUUID(), "mate");
  await store.execute({ op: "start", plan: "scheduler", node: "trial" }, randomUUID(), "mate");
  const first = (await store.get("scheduler"))!.nodes.trial!.attempt!;
  await store.execute({ op: "record", plan: "scheduler", node: "trial", attempt: first, state: "failed", agentId: "current", workspaceId: "same-workspace", evidence: "Retained first failure" }, randomUUID(), "mate");
  await store.execute({ op: "replace", plan: "scheduler", node: "trial", attempt: first, expected: (await store.get("scheduler"))!.hash, kind: "relaunch", budget: { agents: 4, turns: 4 }, evidence: "Deliberate fixture replacement" }, randomUUID(), "mate");
  await store.execute({ op: "start", plan: "scheduler", node: "trial" }, randomUUID(), "mate");
  const second = (await store.get("scheduler"))!.nodes.trial!.attempt!;
  expect(second).not.toBe(first);
  await store.execute({ op: "record", plan: "scheduler", node: "trial", attempt: second, state: "done", agentId: "current", workspaceId: "same-workspace", evidence: "Accepted fixture second outcome" }, randomUUID(), "mate");
  const replayed = (await store.get("scheduler"))!;
  expect(replayed.nodes.trial!.priorAttempts![0]!.agentId).toBe("current");
  scoped.plans[0]!.plan = replayed;
  const result = await withWorkflowFleet(fleet, PLAN_READ_BUDGET_MS, () => workflowSnapshot(home, scoped));
  expect(result.warnings).toContainEqual(expect.stringContaining("Crew current (current) report pending"));
});
