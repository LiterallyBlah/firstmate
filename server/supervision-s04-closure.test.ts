/** Regression controls for the independent correction review of 0a6fc23b (C1/R1, C2/R1, C3/R9), plus the
 * final-admission revision/subject/approval audit using real command schemas. Synthetic receiver only.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SupervisionMutation } from "./supervision-store";
import { activationEffects } from "./supervisor-sessions";
import { continuationId, deriveContinuation, recordContinuation, type ContinuationRecord } from "./supervision-continuation";
import { acceptPolicyInventory } from "./supervision-policy";
import { planSubjectHash } from "./workflow-plans";
import { captain, planDefinition, s04Fixture, type NodeSpec, type S04Fixture, type ScopeHandle } from "../test/supervision-s04-fixture";

async function result<T>(p: Promise<T>): Promise<{ accepted: boolean; code: string | undefined; error: string | null }> {
  try { await p; return { accepted: true, code: undefined, error: null }; } catch (e) { return { accepted: false, code: (e as { code?: string }).code, error: (e as Error).message }; }
}
const derive = (fx: S04Fixture, scope: ScopeHandle) => fx.store.read().then(s => deriveContinuation(s, scope.id, scope.planId));
async function assess(fx: S04Fixture, scope: ScopeHandle, change: Partial<ContinuationRecord>) {
  const d = await derive(fx, scope);
  return recordContinuation(fx.store, { requestId: randomUUID(), scopeId: scope.id, planId: scope.planId, epoch: 1, inputVersion: d.inputVersion,
    disposition: "waiting", reason: "Assessed.", waits: [], completion: null, ...change }, await fx.actorFor(scope), true);
}
async function plan(fx: S04Fixture, n: number, id: string, nodes: NodeSpec[]) {
  const scope = await fx.addScope(n, id, nodes.map(x => x.id)); await fx.draft(scope, nodes); return scope;
}
/** Refusal must keep the reservation and spend, publish nothing and make no receiver call. */
async function refusedWithoutEffect(fx: S04Fixture, effectId: string, code: string) {
  const before = await fx.store.read(), calls = fx.receiver.calls.length;
  const r = await result(fx.gateway.dispatch(effectId));
  const after = await fx.store.read(), effect = after.effects.find(e => e.id === effectId)!;
  expect(r.code).toBe(code); expect(after.sequence).toBe(before.sequence); expect(fx.receiver.calls.length).toBe(calls);
  expect(effect.state).toBe("reserved");
  expect(after.attempts.find(a => a.id === effect.attemptId)?.spentAgents ?? 1).toBe(1);
}
async function upstreamAndQueued() {
  const fx = await s04Fixture(), up = await plan(fx, 1, "prerequisite-goal", [{ id: "proof" }]);
  await fx.launch(up, "proof"); await fx.record(up, "proof", "done");
  const down = await plan(fx, 2, "dependent-goal", [{ id: "queued", after: [{ node: "proof", on: "done" }] }, { id: "fresh", after: [{ node: "proof", on: "done" }] }]);
  return { fx, up, down, queued: await fx.start(down, "queued") };
}

describe("S04 correction closure: C1, C2, C3 and final-admission audit", { timeout: 60000 }, () => {
  it("C1/I01: a held external prerequisite backend refuses already reserved work exactly like a new checked start", async () => {
    const { fx, up, down, queued } = await upstreamAndQueued();
    expect((await fx.store.read()).effects.find(e => e.id === queued.effects!.workspace)!.dependencyBindings)
      .toEqual([{ planId: up.planId, nodeId: "proof", outcome: "done", attemptId: (await fx.store.read()).plans.find(p => p.plan.definition.id === up.planId)!.plan.nodes.proof!.attempt }]);
    const row = (await fx.store.read()).backends.find(b => b.planId === up.planId)!;
    await fx.store.transact([{ kind: "backend", id: row.planId, version: row.version }], randomUUID(), [{ kind: "backend", value: { ...row, state: "held", version: row.version + 1 } }]);
    expect((await result(fx.start(down, "fresh"))).code).toBe("HELD");
    await refusedWithoutEffect(fx, queued.effects!.workspace, "HELD");
  });

  it("C1: a held or transferring upstream owner scope refuses; the available prerequisite is the positive control", async () => {
    const { fx, up, queued } = await upstreamAndQueued();
    const scope = (await fx.store.read()).scopes.find(s => s.id === up.id)!;
    await fx.store.transact([{ kind: "scope", id: scope.id, version: scope.version }], randomUUID(), [{ kind: "scope", value: { ...scope, state: "held", version: scope.version + 1 } }]);
    await refusedWithoutEffect(fx, queued.effects!.workspace, "HELD");
    const held = (await fx.store.read()).scopes.find(s => s.id === up.id)!;
    await fx.store.transact([{ kind: "scope", id: held.id, version: held.version }], randomUUID(), [{ kind: "scope", value: { ...held, state: "active", version: held.version + 1 } }]);
    expect((await fx.gateway.dispatch(queued.effects!.workspace)).state).toBe("succeeded");
  });

  it("C1: an invalidated cross-plan prerequisite refuses with the reservation retained", async () => {
    const { fx, up, queued } = await upstreamAndQueued();
    const attempt = (await fx.store.read()).plans.find(p => p.plan.definition.id === up.planId)!.plan.nodes.proof!.attempt!;
    await fx.run(up, { op: "invalidate", plan: up.planId, node: "proof", attempt, evidence: "Later evidence disproves the prerequisite." });
    await refusedWithoutEffect(fx, queued.effects!.workspace, "STALE");
  });

  it("C2/I02: a recipient whose observed profile diverged after verification receives nothing; the restored one does", async () => {
    const fx = await s04Fixture(), scope = await plan(fx, 1, "profile-goal", [{ id: "first" }]), started = await fx.start(scope, "first");
    await fx.gateway.dispatch(started.effects!.workspace); await fx.gateway.dispatch(started.effects!.create); await fx.gateway.verifyWorker(started.attemptId!);
    const worker = fx.receiver.agents.get((await fx.store.read()).attempts[0]!.worker!.agentId)!;
    worker.provider = "unreviewed/other-model";
    await refusedWithoutEffect(fx, started.effects!.send, "HELD");
    worker.provider = "codex/gpt-6.1-sol"; worker.labels["paseo.parent-agent-id"] = "general-first-mate";
    await refusedWithoutEffect(fx, started.effects!.send, "HELD"); // Independent ancestry is rechecked too.
    delete worker.labels["paseo.parent-agent-id"];
    expect((await fx.gateway.dispatch(started.effects!.send)).state).toBe("succeeded");
    expect(fx.receiver.sends).toHaveLength(1);
  });

  it("C2/I10: model policy is evaluated on the validated observed recipient; the exact permitted profile is the positive control", async () => {
    const fx = await s04Fixture(), scope = await fx.addScope(1, "model-goal", ["bad", "good"]);
    const rule = (await fx.store.read()).policyRules[0]!;
    await acceptPolicyInventory(fx.store, fx.home, randomUUID(), captain, { sources: [], rules: [{ ...rule, version: rule.version + 1, constraints: { ...rule.constraints, models: ["codex/gpt-6.1-sol"] } }] }, true);
    await acceptPolicyInventory(fx.store, fx.home, randomUUID(), captain, { sources: [], rules: [], reviewedHolds: (await fx.store.read()).operationHolds.map(h => ({ id: h.id, version: h.version })) }, true);
    await fx.draft(scope, [{ id: "bad" }, { id: "good" }]);
    const bad = await fx.start(scope, "bad");
    await fx.gateway.dispatch(bad.effects!.workspace); await fx.gateway.dispatch(bad.effects!.create); await fx.gateway.verifyWorker(bad.attemptId!);
    fx.receiver.agents.get((await fx.store.read()).attempts.find(a => a.id === bad.attemptId)!.worker!.agentId)!.provider = "unreviewed/other-model";
    await refusedWithoutEffect(fx, bad.effects!.send, "HELD");
    const good = await fx.launch(scope, "good");
    expect((await fx.store.read()).effects.find(e => e.id === good.effects!.send)!.state).toBe("succeeded");
  });

  it("C2: a supervisor turn is sent only to the recipient matching its pinned profile and workspace", async () => {
    const fx = await s04Fixture(), scope = await fx.addScope(1, "supervisor-goal", ["first"], false);
    await fx.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1, profile: { provider: "synthetic/test", modeId: "default" }, opening: "Open." }, captain);
    const effects = activationEffects(await fx.store.read(), scope.id, 1);
    await fx.gateway.dispatch(effects.workspace!.id); await fx.gateway.dispatch(effects.create!.id);
    const binding = await fx.sessions.verify(scope.id, 1), agent = fx.receiver.agents.get(binding.agentId)!;
    agent.modeId = "full-access";
    await refusedWithoutEffect(fx, effects.send!.id, "HELD");
    agent.modeId = "default";
    expect((await fx.gateway.dispatch(effects.send!.id)).state).toBe("succeeded");
  });

  it("C3/I03-v2: a future captain gate behind failed evidence cannot quiet owner planning", async () => {
    const fx = await s04Fixture(), scope = await plan(fx, 1, "decision-goal", [{ id: "first" }, { id: "pick", decision: "captain", after: [{ node: "first", on: "done" }] },
      { id: "after-pick", after: [{ node: "pick", on: "answered" }] }]);
    await fx.launch(scope, "first"); await fx.record(scope, "first", "failed");
    const p = (await fx.store.read()).plans[0]!.plan;
    expect((await result(fx.run(scope, { op: "captain", plan: scope.planId, revision: p.revision, subjectHash: planSubjectHash(p), action: "answer", node: "pick", option: "yes", text: "Select yes." }, captain))).accepted).toBe(false);
    expect(await derive(fx, scope)).toMatchObject({ derived: "needs-planning", due: true });
    expect((await result(assess(fx, scope, { disposition: "captain-decision", waits: [{ kind: "decision", id: "pick", detail: "Captain pick." }] }))).code).toBe("HELD");
    expect(await derive(fx, scope)).toMatchObject({ disposition: "needs-planning", due: true });
  });

  it("C3/I09: an answerable captain decision is a legitimate quiet wait and its answer makes work due", async () => {
    const fx = await s04Fixture(), scope = await plan(fx, 1, "decision-control", [{ id: "first" }, { id: "pick", decision: "captain", after: [{ node: "first", on: "done" }] },
      { id: "after-pick", after: [{ node: "pick", on: "answered" }] }]);
    await fx.launch(scope, "first"); await fx.record(scope, "first", "done");
    await assess(fx, scope, { disposition: "captain-decision", waits: [{ kind: "decision", id: "pick", detail: "Ready captain choice." }] });
    expect(await derive(fx, scope)).toMatchObject({ disposition: "captain-decision", due: false });
    const p = (await fx.store.read()).plans[0]!.plan;
    await fx.run(scope, { op: "captain", plan: scope.planId, revision: p.revision, subjectHash: planSubjectHash(p), action: "answer", node: "pick", option: "yes", text: "Select yes." }, captain);
    expect(await derive(fx, scope)).toMatchObject({ derived: "ready-action", due: true, nextNodes: ["after-pick"] });
  });

  it("C3 (same class): an external dependency wait needs live upstream progress", async () => {
    const fx = await s04Fixture(), up = await plan(fx, 1, "upstream-goal", [{ id: "u-build", kind: "ship" }]);
    const down = await plan(fx, 2, "downstream-goal", [{ id: "d-after", after: [{ node: "u-build", on: "landed" }] }]);
    const wait = { kind: "dependency" as const, id: "u-build", detail: "Upstream landing." };
    expect((await result(assess(fx, down, { waits: [wait] }))).code).toBe("HELD"); // Planned upstream: nothing is advancing it.
    await fx.launch(up, "u-build");
    await assess(fx, down, { waits: [wait] });
    expect(await derive(fx, down)).toMatchObject({ disposition: "waiting", due: false });
    await fx.record(up, "u-build", "done"); // Done but not landed: no live progress toward the landing.
    const after = await derive(fx, down);
    expect(after).toMatchObject({ derived: "needs-planning", due: true });
    expect((await result(assess(fx, down, { waits: [wait] }))).code).toBe("HELD");
    expect((await result(assess(fx, down, { disposition: "blocked", waits: [{ kind: "prerequisite", id: "u-build-landing", detail: "Landing requires a separate decision.", until: new Date(Date.now() + 3600_000).toISOString() }] }))).accepted).toBe(true);
  });

  it("C3: a persisted wait that no longer applies never quiets derivation", async () => {
    const fx = await s04Fixture(), scope = await plan(fx, 1, "persisted-goal", [{ id: "first" }, { id: "pick", decision: "captain", after: [{ node: "first", on: "done" }] },
      { id: "after-pick", after: [{ node: "pick", on: "answered" }] }]);
    await fx.launch(scope, "first"); await fx.record(scope, "first", "failed");
    const d = await derive(fx, scope), s = await fx.store.read();
    // A row admitted by older/looser validation: written directly, bypassing recordContinuation.
    const row = { id: continuationId(scope.id, scope.planId), version: 1, scopeId: scope.id, planId: scope.planId, objectiveHash: d.objectiveHash!,
      inputVersion: d.inputVersion, epoch: 1, disposition: "captain-decision" as const, reason: "Looser historical validation.", responsible: "captain" as const,
      nextNodes: [], waits: [{ kind: "decision" as const, id: "pick", detail: "Unanswerable." }], completion: null, superseded: [],
      provenance: (await fx.actorFor(scope)), at: new Date().toISOString() };
    const mutations: SupervisionMutation[] = [{ kind: "continuation", value: row }];
    await fx.store.transact([{ kind: "continuation", id: row.id, version: 0 }], randomUUID(), mutations);
    expect((await fx.store.read()).sequence).toBe(s.sequence + 1);
    expect(await derive(fx, scope)).toMatchObject({ disposition: "needs-planning", due: true });
  });

  it("Audit: a revision returns the plan to review and holds queued work until re-approved; started nodes stay pinned", async () => {
    const fx = await s04Fixture(), scope = await fx.addScope(1, "revision-goal", ["r1", "r2"]);
    await fx.draft(scope, [{ id: "r1" }]);
    const started = await fx.start(scope, "r1");
    let p = (await fx.store.read()).plans[0]!.plan;
    await fx.run(scope, { op: "revise", definition: planDefinition(scope.planId, scope.project, [{ id: "r1" }, { id: "r2" }]), expected: p.hash, reason: "Add an unrelated step." });
    p = (await fx.store.read()).plans[0]!.plan;
    expect(p.status).toBe("review");
    await refusedWithoutEffect(fx, started.effects!.workspace, "HELD");
    // Removing the started node is refused by the landed reducer (pre-existing TypeError message; no write).
    const before = (await fx.store.read()).sequence;
    expect((await result(fx.run(scope, { op: "revise", definition: planDefinition(scope.planId, scope.project, [{ id: "r2" }]), expected: p.hash, reason: "Drop started." }))).accepted).toBe(false);
    expect((await fx.store.read()).sequence).toBe(before);
    await fx.run(scope, { op: "captain", plan: scope.planId, revision: p.revision, subjectHash: planSubjectHash(p), action: "approve", text: "Approve the revision." }, captain);
    expect((await fx.gateway.dispatch(started.effects!.workspace)).state).toBe("succeeded");
  });

  it("Audit: an approval-bound start dispatches under its real approval; a later policy change refuses it", async () => {
    const fx = await s04Fixture(), scope = await fx.addScope(1, "approval-goal", ["a1", "a2"]);
    await fx.draft(scope, [{ id: "a1" }, { id: "a2" }]);
    const rule = (await fx.store.read()).policyRules[0]!;
    await acceptPolicyInventory(fx.store, fx.home, randomUUID(), captain, { sources: [], rules: [{ ...rule, version: rule.version + 1, constraints: { ...rule.constraints, requireApproval: true } }] }, true);
    await acceptPolicyInventory(fx.store, fx.home, randomUUID(), captain, { sources: [], rules: [], reviewedHolds: (await fx.store.read()).operationHolds.filter(h => h.state === "held").map(h => ({ id: h.id, version: h.version })) }, true);
    const approved = async (node: string) => {
      const i = await fx.input(scope, { op: "start", plan: scope.planId, node }); await fx.commands.approve(i, captain);
      return fx.gateway.startWorker({ ...i, requestId: randomUUID(), approvalId: i.requestId }, scope.owner);
    };
    const a1 = await approved("a1");
    expect((await fx.store.read()).effects.find(e => e.id === a1.effects!.workspace)!.approvalId).not.toBeNull();
    expect((await fx.gateway.dispatch(a1.effects!.workspace)).state).toBe("succeeded");
    const a2 = await approved("a2");
    const current = (await fx.store.read()).policyRules[0]!;
    await acceptPolicyInventory(fx.store, fx.home, randomUUID(), captain, { sources: [], rules: [{ ...current, version: current.version + 1, constraints: { ...current.constraints, models: ["codex/gpt-6.1-sol"] } }] }, true);
    await refusedWithoutEffect(fx, a2.effects!.workspace, "HELD"); // The rule-change hold commits first.
    await acceptPolicyInventory(fx.store, fx.home, randomUUID(), captain, { sources: [], rules: [], reviewedHolds: (await fx.store.read()).operationHolds.filter(h => h.state === "held").map(h => ({ id: h.id, version: h.version })) }, true);
    await refusedWithoutEffect(fx, a2.effects!.workspace, "STALE"); // Reviewed release does not readmit the old pinned vector.
  });
});
