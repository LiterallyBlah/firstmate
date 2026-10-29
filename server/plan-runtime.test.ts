import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { s04Fixture, captain, type ScopeHandle } from "../test/supervision-s04-fixture";
import { expected } from "../test/supervision-fixture";
import { FirstmateConfigSchema } from "../shared/fleet";
import { PlanRuleRecordSchema, RuleVerificationSchema } from "../shared/plan-rules";
import { PlanRuntime } from "./plan-runtime";
import { SupervisionRuntime } from "./supervision-runtime";
import type { PaseoApi } from "./host-types";
import { PlanRules, ruleRef } from "./plan-rules";
import { policyRef } from "./supervision-policy";
import { digest } from "./submissions";
import { expectedFor, stableId } from "./supervision-effects";
import { oneAtATime } from "./mate";
import { workflowHomeId, workflowSnapshot } from "./workflow-board";
import { planSubjectHash } from "./workflow-plans";
import { checkPlanAllocation } from "./plan-allocation";
import type { SupervisionMutation } from "./supervision-store";
import { normalizePullRequest } from "./supervision-sources";

async function fixture() {
  const f = await s04Fixture(), scopes: ScopeHandle[] = [];
  for (let n = 1; n <= 2; n++) {
    const scope = await f.addScope(n, `chain-${n}`, [`build-${n}`, `review-${n}`]); scopes.push(scope);
    await f.draft(scope, [{ id: `build-${n}` }, { id: `review-${n}`, after: [{ node: `build-${n}`, on: "done" }] }], true);
    const s = await f.store.read(), projectScope = randomUUID(), own = s.scopes.find(s => s.id === scope.id)!;
    const mutations: SupervisionMutation[] = [
      { kind: "scope", value: { ...own, sponsorId: projectScope, version: own.version + 1 } },
      { kind: "scope", value: { id: projectScope, version: 1, kind: "project", homeId: s.homeId, projectIds: [scope.projectId], sponsorId: null, mode: "scoped", state: "active" } },
      { kind: "project", value: { id: scope.projectId, version: 1, scopeId: projectScope, name: scope.project, aliases: [], state: "admitted", budget: { agents: 6, turns: 6 },
        sourceVector: [policyRef("policy-source", s.policySources[0]!)], provenance: captain } },
      { kind: "plan-sponsor", value: { id: scope.id, version: 1, sponsorScopeId: projectScope, projectIds: [scope.projectId], claims: [{ projectId: scope.projectId, agents: 6, turns: 6, priority: 1 }], queuedAt: 1, state: "granted", provenance: captain } },
    ]; await f.store.transact(expectedFor(s, mutations), randomUUID(), mutations);
  }
  const runtime = new SupervisionRuntime(join(f.home, "store"), () => f.store); await runtime.mutate(f.home, async () => {});
  const api = { agents: { list: vi.fn(async () => ({ entries: [], pageInfo: { hasMore: false } })) } } as unknown as PaseoApi;
  const service = new PlanRuntime(runtime, { enabled: true, config: async () => FirstmateConfigSchema.parse({ home: f.home, mateAgentId: "general" }), receiver: () => f.receiver, slots: 10 });
  const directory = join(f.home, "data/scope-requests"); await mkdir(directory);
  async function queue(scope: ScopeHandle | "general", kind: string, input: unknown) {
    const id = randomUUID(); await writeFile(join(directory, `${id}.json`), JSON.stringify({ id, kind, actor: scope === "general" ? scope : scope.owner.id, input })); return id;
  }
  async function result(id: string) { return JSON.parse(await readFile(join(directory, `${id}.reply.json`), "utf8")); }
  const na = { applies: false, reason: "Bounded server-only chain; no visual/performance/heavy-test or long-work change." };
  const records = [];
  for (const scope of scopes) {
    const s = await f.store.read(), plan = s.plans.find(p => p.scopeId === scope.id)!.plan;
    const record = PlanRuleRecordSchema.parse({ format: "firstmate.plan-rules/1", id: stableId("plan-rules", s.homeId, scope.planId, plan.revision), version: 1,
      homeId: s.homeId, scopeId: scope.id, planId: scope.planId, revision: plan.revision, sources: [policyRef("policy-source", s.policySources[0]!)], supervisorLimits: { sessions: 1, turns: 8 },
      nodes: scope.nodes.map(nodeId => ({ nodeId, checks: [{ id: "unit", command: "node check.mjs", passCriterion: "exit zero, every assertion passes" }], design: na, performance: na, longRun: na, heavyTests: na })) });
    records.push(record); await queue("general", "rules", record);
  }
  service.remember(api); await service.tick();
  return { ...f, runtime, service, api, scopes, records, queue, result, directory };
}
it("default-off registration, view handles and ticks create no home, journal, session or receiver", async () => {
  const root = join(process.env.PASEO_HOME!, randomUUID()), runtime = new SupervisionRuntime(root), receiver = vi.fn();
  const service = new PlanRuntime(runtime, { config: async () => { throw new Error("Off means no config IO"); }, receiver });
  const on = vi.fn(); service.register({ on } as never); service.remember({} as PaseoApi); await service.tick(); await service.remote({} as never);
  expect(await service.act({} as never, {} as PaseoApi)).toBe(false); expect(on).not.toHaveBeenCalled(); expect(receiver).not.toHaveBeenCalled();
  await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" }); await service.stop(); await runtime.stop();
});
it("the first callback after restart is journaled before any view/tick, with one root subscription and one consequence", async () => {
  const f = await fixture(), scope = f.scopes[0]!, launched = await f.launch(scope, scope.nodes[0]!), hooks = new Map<string, (...args: unknown[]) => unknown>();
  const restarted = new PlanRuntime(f.runtime, { enabled: true, config: async () => FirstmateConfigSchema.parse({ home: f.home, mateAgentId: "general" }), receiver: () => f.receiver });
  const on = vi.fn((name: string, handler: (...args: unknown[]) => unknown) => { hooks.set(name, handler); return () => hooks.delete(name); });
  restarted.register({ on, before: vi.fn() } as never);
  try {
    const worker = (await f.store.read()).attempts.find(a => a.id === launched.attemptId)!.worker!;
    const event = { agent: { id: worker.agentId }, request: { id: "native-permission-1" } }, context = { paseo: f.api };
    await hooks.get("agent.permission_requested")!(event, context); await hooks.get("agent.permission_requested")!(event, context);
    const s = await f.store.read(), events = s.inbox.events.filter(e => e.envelope.subject.permissionId === "native-permission-1");
    expect(events).toHaveLength(1); expect(s.inbox.assignments.find(a => a.id === events[0]!.id)?.scopeId).toBe(scope.id);
    expect(on.mock.calls.filter(([name]) => name === "agent.turn_ended")).toHaveLength(1);
  } finally { await restarted.stop(); await f.service.stop(); await f.runtime.stop(); }
});
it("production tick processes two checked chains while General's lifecycle lock is busy; replay/restart makes no second worker", async () => {
  const f = await fixture();
  let unlock!: () => void, entered!: () => void;
  const ready = new Promise<void>(r => { entered = r; }), hold = oneAtATime(async () => { entered(); await new Promise<void>(r => { unlock = r; }); }); await ready;
  try {
    for (const phase of [0, 1]) {
      const requests = [];
      for (const [i, scope] of f.scopes.entries()) requests.push(await f.queue(scope, "plan", { ...await f.input(scope, { op: "start", plan: scope.planId, node: scope.nodes[phase]! }), planRules: ruleRef(f.records[i]!) }));
      await f.service.tick();
      for (const id of requests) expect(await f.result(id)).toMatchObject({ ok: true });
      for (const [i, scope] of f.scopes.entries()) {
        const s = await f.store.read(), task = s.tasks.find(t => t.ownerScopeId === scope.id && t.nodeId === scope.nodes[phase])!, attempt = s.attempts.find(a => a.id === task.currentAttempt)!;
        expect(attempt.worker).toBeTruthy();
        const artifactId = await f.queue(scope, "artifact", { scopeId: scope.id, file: `data/${scope.nodes[phase]}/brief.md`, digest: digest("not raw") });
        // A wrong digest is refused through the real consumer; publish real CI evidence separately.
        await f.service.tick(); expect(await f.result(artifactId)).toMatchObject({ ok: false, code: "STALE" });
        const blob = await f.store.putBlob(Buffer.from(`Fresh CI output for ${attempt.id}`)); await f.store.transact(expected([{ kind: "blob", value: blob }]), randomUUID(), [{ kind: "blob", value: blob }]);
        const artifact = { digest: blob.id, verifier: scope.owner.id, method: "automatic", provenance: `independent isolated CI job for ${attempt.id}` };
        const verification = RuleVerificationSchema.parse({ format: "firstmate.rule-verification/1", id: randomUUID(), version: 1, homeId: s.homeId, scopeId: scope.id,
          planId: scope.planId, nodeId: task.nodeId, revision: f.records[i]!.revision, rules: ruleRef(f.records[i]!), attemptId: attempt.id, head: "a".repeat(40), buildInputs: digest(attempt.id),
          at: new Date().toISOString(), verifierId: scope.owner.id, workerId: attempt.worker!.agentId, checks: [{ id: "unit", command: "node check.mjs", result: "passed", artifact }],
          regressions: [], design: null, performance: null, budget: null, snapshot: null, blocker: { category: "none", description: "No blocker", evidence: artifact, correctiveNode: null, disposition: null } });
        const evidenceId = await f.queue(scope, "rule-verification", verification); await f.service.tick(); expect(await f.result(evidenceId)).toMatchObject({ ok: true });
        const command = { ...await f.input(scope, { op: "record", plan: scope.planId, node: task.nodeId, attempt: attempt.id, state: "done", evidence: "Verified exact CI output" }), planRules: ruleRef(f.records[i]!), head: verification.head };
        const doneId = await f.queue(scope, "plan", command); await f.service.tick(); expect(await f.result(doneId)).toMatchObject({ ok: true });
        await rm(join(f.directory, `${doneId}.reply.json`)); await f.service.tick(); expect(await f.result(doneId)).toMatchObject({ ok: true });
      }
    }
    expect((await f.store.read()).attempts).toHaveLength(4);
    expect(f.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(4);
    const snapshot = await workflowSnapshot(f.home, await f.store.read()); expect(snapshot.plans).toHaveLength(2);
    expect(snapshot.plans.every(p => Object.values(p.nodes).every(n => n.state === "done"))).toBe(true);
    expect(f.receiver.sends.every(s => s.agentId !== "general")).toBe(true);
    await f.service.stop();
    const restarted = new PlanRuntime(f.runtime, { enabled: true, config: async () => FirstmateConfigSchema.parse({ home: f.home, mateAgentId: "general" }), receiver: () => f.receiver });
    restarted.remember(f.api); await restarted.tick(); await restarted.stop();
    expect(f.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(4);
  } finally { unlock(); await hold; await f.service.stop(); await f.runtime.stop(); }
  // Windows CI: median 11.3 s, passes up to 19.3 s and three timeouts at 20 s; hosted Windows runner slowdowns add up to ~46 s (61 runs, 2026-10-28/29), so the budget is its Windows median + ~50 s.
}, 90_000);
it("allocation stops and queued claims hold only affected starts without reserving spend", async () => {
  const f = await fixture();
  try {
    const s = await f.store.read(), a = f.scopes[0]!, b = f.scopes[1]!, p = s.projects!.projects.find(p => p.id === a.projectId)!;
    const mutation = { kind: "project" as const, value: { ...p, version: p.version + 1, state: "stopped" as const } }; await f.store.transact(expectedFor(s, [mutation]), randomUUID(), [mutation]);
    expect(() => checkPlanAllocation(s, a.id, true)).not.toThrow();
    const held = await f.queue(a, "plan", { ...await f.input(a, { op: "start", plan: a.planId, node: a.nodes[0]! }), planRules: ruleRef(f.records[0]!) });
    const good = await f.queue(b, "plan", { ...await f.input(b, { op: "start", plan: b.planId, node: b.nodes[0]! }), planRules: ruleRef(f.records[1]!) });
    await f.service.tick(); expect(await f.result(held)).toMatchObject({ ok: false, code: "HELD" }); expect(await f.result(good)).toMatchObject({ ok: true });
    expect((await f.store.read()).attempts).toHaveLength(1);
  } finally { await f.service.stop(); await f.runtime.stop(); }
});
it("a delegated owner adds an authorized corrective run and stricter checks without minting caps or another owner", async () => {
  const f = await fixture();
  try {
    const scope = f.scopes[0]!, p = (await f.store.read()).plans.find(p => p.scopeId === scope.id)!.plan, definition = structuredClone(p.definition);
    const run = definition.nodes.find(n => n.kind === "run")!; if (run.kind !== "run") throw new Error("fixture run");
    definition.nodes.push({ ...run, id: "corrective", title: "Diagnose recurring blocker", launch: { ...run.launch, id: "corrective", brief: { file: "data/corrective/brief.md" } } });
    await mkdir(join(f.home, "data/corrective")); await writeFile(join(f.home, "data/corrective/brief.md"), "Synthetic checked brief.");
    const revise = await f.queue(scope, "plan", await f.input(scope, { op: "revise", definition, expected: p.hash, reason: "Within existing delegated scope and cumulative budget" }));
    await f.service.tick(); expect(await f.result(revise)).toMatchObject({ ok: true });
    const changed = (await f.store.read()).plans.find(p => p.scopeId === scope.id)!.plan, record = { ...f.records[0]!, revision: changed.revision,
      id: stableId("plan-rules", f.store.homeId, scope.planId, changed.revision), version: 1, nodes: [...f.records[0]!.nodes, { ...f.records[0]!.nodes[0]!, nodeId: "corrective" }] };
    const rules = await f.queue(scope, "rules", record); await f.service.tick(); expect(await f.result(rules)).toMatchObject({ ok: true });
    const weakening = await f.queue(scope, "rules", { ...record, version: 2, supervisorLimits: { sessions: 100, turns: 100 } });
    await f.service.tick(); expect(await f.result(weakening)).toMatchObject({ ok: false, code: "HELD" });
    const start = await f.queue(scope, "plan", { ...await f.input(scope, { op: "start", plan: scope.planId, node: "corrective" }), planRules: ruleRef(record) });
    await f.service.tick(); expect(await f.result(start)).toMatchObject({ ok: true });
    expect((await f.store.read()).tasks.find(t => t.nodeId === "corrective")?.ownerScopeId).toBe(scope.id);
    expect(f.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(1);
  } finally { await f.service.stop(); await f.runtime.stop(); }
});
it("production final admission rereads a bound PR and refuses a moved head before creating a worktree", async () => {
  const f = await fixture();
  try {
    const scope = f.scopes[0]!, commands = f.service.compose(f.store, f.home, "general", f.api), started = await commands.gateway.startWorker({ ...await f.input(scope,
      { op: "start", plan: scope.planId, node: scope.nodes[0]! }), planRules: ruleRef(f.records[0]!), head: "a".repeat(40) }, scope.owner);
    await commands.sources.bindPullRequest({ scopeId: scope.id, attemptId: started.attemptId!, repository: "me/web", pr: 42 });
    const current = normalizePullRequest({ state: "OPEN", headRefOid: "b".repeat(40), author: { login: "builder" }, reviews: [],
      statusCheckRollup: [{ __typename: "CheckRun", name: "unit", status: "COMPLETED", conclusion: "SUCCESS" }] }, "me/web", 42, new Date().toISOString());
    const checked = new PlanRuntime(f.runtime, { enabled: true, config: async () => FirstmateConfigSchema.parse({ home: f.home, mateAgentId: "general" }), receiver: () => f.receiver, readPr: async () => current });
    await expect(checked.compose(f.store, f.home, "general", f.api).gateway.dispatch(started.effects!.workspace)).rejects.toMatchObject({ code: "STALE" });
    await expect(commands.rules.command(await f.store.read(), { ...await f.input(scope, { op: "record", plan: scope.planId, node: scope.nodes[0]!,
      attempt: started.attemptId!, state: "done", evidence: "Old-head report cannot earn completion" }), planRules: ruleRef(f.records[0]!), head: "a".repeat(40) })).rejects.toThrow("bound PR head");
    expect(f.receiver.calls).toHaveLength(0); await checked.stop();
  } finally { await f.service.stop(); await f.runtime.stop(); }
});
it("ordinary Plans routes to the scoped owner and exact accepted app replay survives later source drift", async () => {
  const f = await fixture();
  try {
    const scope = f.scopes[0]!, p = (await f.store.read()).plans.find(p => p.scopeId === scope.id)!.plan;
    const input = { homeId: workflowHomeId(f.home), requestId: randomUUID(), command: { op: "captain" as const, plan: scope.planId,
      revision: p.revision, subjectHash: planSubjectHash(p), action: "hold" as const, text: "Pause this plan only" } };
    expect(await f.service.act(input, f.api)).toBe(true);
    const held = await f.store.read(); expect(held.plans.find(p => p.scopeId === scope.id)?.plan.status).toBe("held");
    expect(held.plans.find(p => p.scopeId === f.scopes[1]!.id)?.plan.status).toBe("active");
    await writeFile(join(f.home, "data/orders.md"), "Changed source after accepted action.");
    expect(await f.service.act(input, f.api)).toBe(true); expect((await f.store.read()).sequence).toBe(held.sequence);
    expect(f.receiver.calls).toHaveLength(0);
  } finally { await f.service.stop(); await f.runtime.stop(); }
});
