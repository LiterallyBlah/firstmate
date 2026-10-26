/** Regression controls for the independent S04-prep review (R1–R9) at e99ca022, kept as in-repo tests.
 * Fxx are the reviewer's counterexamples (each failed at e99ca022); Cxx are its positive controls.
 * Adaptation: F04's capacity wait now carries the bounded `until` that R9 requires.
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentObservation } from "../shared/supervision-effects";
import { activationEffects, supervisorSpend } from "./supervisor-sessions";
import { SupervisionGateway } from "./supervision-effects";
import { deriveContinuation, goalStatus, recordContinuation, type ContinuationRecord } from "./supervision-continuation";
import { planSubjectHash, WorkflowPlanStore } from "./workflow-plans";
import { handleScopeRequest, legacyRoute, scopeRoute } from "./scope-requests";
import { captain, s04Fixture, type S04Fixture, type ScopeHandle } from "../test/supervision-s04-fixture";

async function result<T>(p: Promise<T>): Promise<{ accepted: true; value: T } | { accepted: false; code: string | undefined; error: string }> {
  try { return { accepted: true, value: await p }; } catch (e) { return { accepted: false, code: (e as { code?: string }).code, error: (e as Error).message }; }
}
const codeOf = (r: Awaited<ReturnType<typeof result>>) => r.accepted ? null : r.code;
const until = () => new Date(Date.now() + 3600_000).toISOString();
async function ready(nodes = ["first", "second"], options: Parameters<typeof s04Fixture>[0] = {}) {
  const fx = await s04Fixture(options), scope = await fx.addScope(1, "review-goal", nodes);
  await fx.draft(scope, nodes.map(id => ({ id })));
  return { fx, scope };
}
const profile = { provider: "synthetic/test", modeId: "default", thinkingOptionId: "high" };
async function supervisor(options: Parameters<typeof s04Fixture>[0] = {}) {
  const fx = await s04Fixture(options), scope = await fx.addScope(1, "review-goal", ["first"], false);
  await fx.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1, profile, opening: "Review synthetic goal." }, captain);
  const effects = activationEffects(await fx.store.read(), scope.id, 1);
  await fx.gateway.dispatch(effects.workspace!.id); await fx.gateway.dispatch(effects.create!.id);
  const binding = await fx.sessions.verify(scope.id, 1);
  return { fx, scope, effects, binding };
}
const continuation = (fx: S04Fixture, scope: ScopeHandle) => fx.store.read().then(s => deriveContinuation(s, scope.id, scope.planId));
async function assess(fx: S04Fixture, scope: ScopeHandle, change: Partial<ContinuationRecord>, epoch = 1) {
  const d = await continuation(fx, scope);
  return recordContinuation(fx.store, { requestId: randomUUID(), scopeId: scope.id, planId: scope.planId, epoch, inputVersion: d.inputVersion,
    disposition: "blocked", reason: "Assessed.", waits: [], completion: null, ...change }, await fx.actorFor(scope), true);
}

describe("S04-prep review regressions (R1–R9)", { timeout: 60000 }, () => {
  it("C01 atomic start, exact replay, same-plan CAS, no partial losing reservation", async () => {
    const { fx, scope } = await ready();
    const a = await fx.input(scope, { op: "start", plan: scope.planId, node: "first" }), b = await fx.input(scope, { op: "start", plan: scope.planId, node: "second" });
    const before = await fx.store.read();
    const [ra, rb] = await Promise.all([result(fx.gateway.startWorker(a, scope.owner)), result(fx.gateway.startWorker(b, scope.owner))]);
    const after = await fx.store.read();
    expect([ra, rb].filter(x => x.accepted)).toHaveLength(1); expect([ra, rb].map(codeOf).filter(Boolean)).toEqual(["STALE"]);
    expect(after.sequence).toBe(before.sequence + 1); expect(after.attempts).toHaveLength(1); expect(after.effects).toHaveLength(3);
    await fx.gateway.startWorker(ra.accepted ? a : b, scope.owner);
    expect((await fx.store.read()).sequence).toBe(after.sequence);
  });

  it("R1/F01a: a changed reviewed policy source stops a queued effect at final admission", async () => {
    const { fx, scope } = await ready(), started = await fx.start(scope, "first");
    await writeFile(join(fx.home, "data/orders.md"), "Changed captain source: stop new work.\n");
    expect(codeOf(await result(fx.start(scope, "second")))).toBe("STALE");
    expect(codeOf(await result(fx.gateway.dispatch(started.effects!.workspace)))).toBe("STALE");
    expect(fx.receiver.calls).toEqual([]);
    expect((await fx.store.read()).effects.find(e => e.id === started.effects!.workspace)!.state).toBe("reserved");
  });

  it("R1/F01b: a scope hold published while dispatch is preflighting wins the claim", async () => {
    const r = await ready(["first"]), go = await r.fx.start(r.scope, "first");
    const capabilities = r.fx.receiver.capabilities.bind(r.fx.receiver);
    let entered!: () => void, release!: () => void;
    const barrier = new Promise<void>(x => { entered = x; }), gate = new Promise<void>(x => { release = x; });
    r.fx.receiver.capabilities = async () => { entered(); await gate; return capabilities(); };
    const pending = result(r.fx.gateway.dispatch(go.effects!.workspace));
    await barrier;
    const s = await r.fx.store.read(), row = s.scopes[0]!;
    await r.fx.store.transact([{ kind: "scope", id: row.id, version: row.version }], randomUUID(), [{ kind: "scope", value: { ...row, state: "held", version: row.version + 1 } }]);
    release();
    expect(codeOf(await pending)).toBe("HELD"); expect(r.fx.receiver.calls).toEqual([]);
  });

  it("R1/F01c: a held backend refuses a previously reserved effect", async () => {
    const { fx, scope } = await ready(["first"]), started = await fx.start(scope, "first");
    const row = (await fx.store.read()).backends[0]!;
    await fx.store.transact([{ kind: "backend", id: row.planId, version: row.version }], randomUUID(), [{ kind: "backend", value: { ...row, state: "held", version: row.version + 1 } }]);
    expect(codeOf(await result(fx.gateway.dispatch(started.effects!.workspace)))).toBe("HELD"); expect(fx.receiver.calls).toEqual([]);
  });

  it("R1/F01d: a supervisor offer rechecks exact idle/no-permission identity before sending", async () => {
    const { fx, scope, effects, binding } = await supervisor();
    await fx.gateway.dispatch(effects.send!.id); // Opening delivered; the owner is now running.
    const turn = await fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: scope.id, epoch: 1, causation: "offer:busy", text: "New info." }, captain);
    expect(codeOf(await result(fx.gateway.dispatch(turn)))).toBe("HELD");
    fx.receiver.finish(binding.agentId); fx.receiver.agents.get(binding.agentId)!.pendingPermissions = 1;
    expect(codeOf(await result(fx.gateway.dispatch(turn)))).toBe("HELD");
    fx.receiver.agents.get(binding.agentId)!.pendingPermissions = 0;
    const find = fx.receiver.findAgent.bind(fx.receiver);
    fx.receiver.findAgent = async id => ({ ...(await find(id))!, id: "someone-else" }); // Misbound answer.
    expect(codeOf(await result(fx.gateway.dispatch(turn)))).toBe("HELD");
    fx.receiver.findAgent = find;
    expect((await fx.gateway.dispatch(turn)).state).toBe("succeeded"); // Positive control: idle exact owner.
    expect(fx.receiver.sends).toHaveLength(2);
  });

  it("R1: an invalidated prerequisite or a changed model rule stops queued work; interrupt still works under stop", async () => {
    const fx = await s04Fixture(), scope = await fx.addScope(1, "deps-goal", ["d-probe", "d-build"]);
    await fx.draft(scope, [{ id: "d-probe" }, { id: "d-build", after: [{ node: "d-probe", on: "done" }] }]);
    const probe = await fx.launch(scope, "d-probe"); await fx.record(scope, "d-probe", "done");
    const build = await fx.start(scope, "d-build");
    await fx.run(scope, { op: "invalidate", plan: scope.planId, node: "d-probe", attempt: probe.attemptId!, evidence: "Later evidence disproves the probe." });
    expect(codeOf(await result(fx.gateway.dispatch(build.effects!.workspace)))).toBe("STALE");
    const calls = fx.receiver.calls.length;
    const p = (await fx.store.read()).plans[0]!.plan;
    await fx.run(scope, { op: "captain", plan: scope.planId, revision: p.revision, subjectHash: planSubjectHash(p), action: "hold", text: "Stop admissions." }, captain);
    // Interrupt of the verified worker remains the safe-stop path while admissions are held.
    const interrupt = await fx.gateway.propose({ scopeId: scope.id, epoch: 1, attemptId: probe.attemptId!, operation: "agent.interrupt", causation: "stop", requestId: randomUUID() }, scope.owner);
    expect((await fx.gateway.dispatch(interrupt.id)).state).toBe("succeeded");
    expect(fx.receiver.calls.slice(calls).map(c => c.op)).toEqual(["interrupt"]);
    expect(codeOf(await result(fx.gateway.dispatch(build.effects!.workspace)))).toBe("HELD");
  });

  it("R2/F02: accepted start replay returns the original receipt after the brief and capabilities change", async () => {
    const { fx, scope } = await ready(["first"]), input = await fx.input(scope, { op: "start", plan: scope.planId, node: "first" });
    const first = await fx.gateway.startWorker(input, scope.owner), before = await fx.files();
    await writeFile(join(fx.home, "data/first/brief.md"), "Later source change.");
    (fx.receiver.capabilityValue as { selectedAgentIds: boolean }).selectedAgentIds = false;
    const repeated = await fx.gateway.startWorker(input, scope.owner);
    expect(repeated.receipt).toEqual(first.receipt); expect(repeated.attemptId).toBe(first.attemptId); expect(await fx.files()).toEqual(before);
    expect(codeOf(await result(fx.gateway.startWorker({ ...input, head: "b".repeat(40) }, scope.owner)))).toBe("CONFLICT");
  });

  it("R2/C09/F02b: transfer keeps old reservations visible and refused; replacement replays after the epoch advances", async () => {
    const fx = await s04Fixture(), scope = await fx.addScope(1, "transfer-goal", ["first"], false), p2 = { provider: "synthetic/test", modeId: "default" };
    await fx.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1, profile: p2, opening: "First owner." }, captain);
    let s = await fx.store.read(), effects = activationEffects(s, scope.id, 1);
    const binding = s.bindings[0]!;
    await fx.gateway.dispatch(effects.workspace!.id); await fx.gateway.dispatch(effects.create!.id); await fx.sessions.verify(scope.id, 1); await fx.gateway.dispatch(effects.send!.id);
    await fx.draft(scope, [{ id: "first" }]); const start = await fx.start(scope, "first"), old = await fx.actorFor(scope);
    await fx.sessions.hold({ requestId: randomUUID(), scopeId: scope.id, expectedEpoch: 1, reason: "Accounted manual transfer." }, captain);
    fx.receiver.agents.get(binding.agentId)!.status = "closed";
    s = await fx.store.read();
    const input = { requestId: randomUUID(), scopeId: scope.id, scopeVersion: s.scopes[0]!.version, expectedEpoch: 1, profile: p2, opening: "Replacement owner." };
    const replacement = await fx.sessions.prepareReplacement(input, captain);
    s = await fx.store.read(); effects = activationEffects(s, scope.id, 2);
    await fx.gateway.dispatch(effects.workspace!.id); await fx.gateway.dispatch(effects.create!.id); await fx.sessions.verify(scope.id, 2);
    expect((await fx.sessions.prepareReplacement(input, captain)).receipt).toEqual(replacement.receipt);
    expect(codeOf(await result(fx.gateway.dispatch(start.effects!.workspace)))).toBe("STALE");
    expect(codeOf(await result(fx.run(scope, { op: "ack", plan: scope.planId, kind: "told", ids: ["start:first"] }, old)))).toBe("UNKNOWN_OWNER");
    expect((await fx.store.read()).effects.find(e => e.id === start.effects!.workspace)!.state).toBe("reserved");
  });

  it("R3/F03: a cancelled supervisor reservation stays spent, and stop refuses another turn or activation", async () => {
    const { fx, scope } = await ready(["first"], { limits: { supervisorSessions: 1, supervisorTurns: 2 } });
    await fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: scope.id, epoch: 1, causation: "first-offer", text: "One." }, captain);
    const before = supervisorSpend(await fx.store.read(), scope.id), p = (await fx.store.read()).plans[0]!.plan;
    await fx.run(scope, { op: "captain", plan: scope.planId, revision: p.revision, subjectHash: planSubjectHash(p), action: "hold", text: "Stop admissions." }, captain);
    const after = supervisorSpend(await fx.store.read(), scope.id);
    expect(after.turns).toBe(before.turns);
    expect(codeOf(await result(fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: scope.id, epoch: 1, causation: "second-offer", text: "Two." }, captain)))).toBe("HELD");
    const dormant = await fx.addScope(2, "dormant-goal", ["dz"], false);
    const hold = { id: "00000000-0000-4000-8000-0000000003ff", version: 1, scopeId: dormant.id, planId: dormant.planId, operations: ["model.use" as const],
      reason: "Captain stop.", sourceVector: (await fx.store.read()).policyRules.slice(0, 1).map(r => ({ kind: "policy-rule", id: r.id, version: r.version, digest: "a".repeat(64) })), state: "held" as const };
    await fx.store.transact([{ kind: "operation-hold", id: hold.id, version: 0 }], randomUUID(), [{ kind: "operation-hold", value: hold }]);
    expect(codeOf(await result(fx.sessions.prepare({ requestId: randomUUID(), scopeId: dormant.id, scopeVersion: 1, profile, opening: "o" }, captain)))).toBe("HELD");
  });

  it("C04 an uncertain supervisor send keeps its separate cap and refuses another turn", async () => {
    const { fx, scope, effects } = await supervisor({ limits: { supervisorSessions: 1, supervisorTurns: 1 } });
    fx.receiver.faults.send = ["lose"]; await fx.gateway.dispatch(effects.send!.id);
    expect(codeOf(await result(fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: scope.id, epoch: 1, causation: "again", text: "Again." }, captain)))).toBe("HELD");
    expect(supervisorSpend(await fx.store.read(), scope.id)).toEqual({ sessions: 1, turns: 1, uncertain: 1 });
  });

  it("R4/F04: settling the owner's own offer does not create a new goal generation", async () => {
    const { fx, scope, effects, binding } = await supervisor();
    await fx.gateway.dispatch(effects.send!.id); fx.receiver.finish(binding.agentId);
    await fx.draft(scope, [{ id: "first" }]);
    const initial = await continuation(fx, scope);
    const turn = await fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: scope.id, epoch: 1, causation: initial.wakeKey, text: "Assess pending goal." }, captain);
    expect((await continuation(fx, scope)).inputVersion).toBe(initial.inputVersion); // Reservation is bookkeeping too.
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(r => { release = r; }), barrier = new Promise<void>(r => { entered = r; });
    fx.receiver.gate = gate; fx.receiver.afterAdmission = entered;
    const pending = fx.gateway.dispatch(turn); await barrier;
    const input = await continuation(fx, scope);
    await assess(fx, scope, { disposition: "waiting", reason: "Unchanged external capacity wait.", waits: [{ kind: "capacity", id: "provider", detail: "No new capacity facts.", until: until() }] });
    const assessed = await continuation(fx, scope);
    release(); await pending; fx.receiver.gate = null; fx.receiver.afterAdmission = null;
    const after = await continuation(fx, scope);
    expect(assessed.due).toBe(false); expect(after.due).toBe(false); expect(after.inputVersion).toBe(input.inputVersion); expect(after.wakeKey).toBe(assessed.wakeKey);
    expect(after.offers).toEqual({ pending: 0, uncertain: 0 });
  });

  it("R5/F05: replacement requires closure of the exact previous identity", async () => {
    const { fx, scope, effects, binding } = await supervisor();
    await fx.gateway.dispatch(effects.send!.id);
    await fx.sessions.hold({ requestId: randomUUID(), scopeId: scope.id, expectedEpoch: 1, reason: "Review replacement." }, captain);
    const status = await fx.store.read(), input = { requestId: randomUUID(), scopeId: scope.id, scopeVersion: status.scopes[0]!.version, expectedEpoch: 1, profile, opening: "Replacement." };
    expect(codeOf(await result(fx.sessions.prepareReplacement(input, captain)))).toBe("HELD");
    const find = fx.receiver.findAgent.bind(fx.receiver);
    fx.receiver.findAgent = async id => id === binding.agentId ? { ...(await find(id))!, id: "different-archived-agent", archivedAt: "2026-10-26T12:00:00.000Z", status: "closed" } as AgentObservation : find(id);
    expect(codeOf(await result(fx.sessions.prepareReplacement(input, captain)))).toBe("HELD");
    expect((await fx.store.read()).bindings[0]!.epoch).toBe(1);
  });

  it("R5: archive reconciliation ignores a misbound archived answer", async () => {
    const { fx, scope } = await ready(["first"]), start = await fx.launch(scope, "first");
    const worker = (await fx.store.read()).attempts[0]!.worker!.agentId;
    fx.receiver.finish(worker); await fx.record(scope, "first", "done");
    const proposal = await fx.gateway.propose({ scopeId: scope.id, epoch: 1, attemptId: start.attemptId!, operation: "agent.archive", causation: "terminal", requestId: randomUUID() }, scope.owner);
    fx.receiver.faults.archive = ["hide"];
    // `hide` targets the worker id; the archive itself happens, but the reply is lost.
    expect((await fx.gateway.dispatch(proposal.id)).state).toBe("uncertain");
    const find = fx.receiver.findAgent.bind(fx.receiver);
    fx.receiver.findAgent = async id => ({ ...(fx.receiver.agents.get(id) ?? (await find(id)))!, id: "other-agent" });
    expect((await fx.gateway.reconcile(proposal.id)).state).toBe("uncertain");
    fx.receiver.findAgent = find; fx.receiver.reveal(worker);
    expect((await fx.gateway.reconcile(proposal.id)).state).toBe("succeeded");
  });

  it("R6/F06: the active binding exposes the verified workspace; intent stays separate and identity is set once", async () => {
    const { fx, binding, effects } = await supervisor();
    const actual = fx.receiver.agents.get(binding.agentId)!.workspaceId;
    expect(binding.workspaceId).toBe(actual); expect(binding.workspaceIntent).toBe(effects.workspace!.receiverKey);
    const s = await fx.store.read(), row = s.bindings[0]!;
    expect(codeOf(await result(fx.store.transact([{ kind: "binding", id: row.scopeId, version: s.versions.find(v => v.kind === "binding")!.version }], randomUUID(),
      [{ kind: "binding", value: { ...row, workspaceId: "ws-elsewhere" } }])))).toBe("STALE");
  });

  it("R6: the store refuses activating a binding whose workspace is not its own intent's receipt", async () => {
    const fx = await s04Fixture(), scope = await fx.addScope(1, "intent-goal", ["first"], false);
    await fx.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1, profile, opening: "o" }, captain);
    const s = await fx.store.read(), effects = activationEffects(s, scope.id, 1);
    await fx.gateway.dispatch(effects.workspace!.id);
    const t = await fx.store.read(), row = t.bindings[0]!, sc = t.scopes[0]!;
    const forged = [{ kind: "binding" as const, value: { ...row, workspaceId: "ws-forged", state: "active" as const } }, { kind: "scope" as const, value: { ...sc, state: "active" as const, version: sc.version + 1 } }];
    expect(codeOf(await result(fx.store.transact([{ kind: "binding", id: row.scopeId, version: t.versions.find(v => v.kind === "binding")!.version }, { kind: "scope", id: sc.id, version: sc.version }], randomUUID(), forged)))).toBe("CONFLICT");
  });

  it("R7/F07/C05: a running record must name the verified worker; a premature one is refused; the exact one succeeds", async () => {
    const { fx, scope } = await ready(["first", "second"]), started = await fx.launch(scope, "first");
    const actual = (await fx.store.read()).attempts[0]!.worker!;
    expect(codeOf(await result(fx.run(scope, { op: "record", plan: scope.planId, node: "first", attempt: started.attemptId!, state: "running", evidence: "x", agentId: "different-worker", workspaceId: "different-workspace" })))).toBe("CONFLICT");
    const second = await fx.start(scope, "second");
    expect(codeOf(await result(fx.run(scope, { op: "record", plan: scope.planId, node: "second", attempt: second.attemptId!, state: "running", evidence: "x", agentId: "guess", workspaceId: "guess" })))).toBe("HELD");
    await fx.run(scope, { op: "record", plan: scope.planId, node: "first", attempt: started.attemptId!, state: "running", evidence: "Verified worker.", agentId: actual.agentId, workspaceId: actual.workspaceId });
    const files = await fx.files(), status = goalStatus(await fx.store.read());
    expect(await fx.files()).toEqual(files); expect(status.goals[0]!.activeWorkers).toBe(1); // Only the verified worker; the second start is still three reserved effects.
    expect(status.goals[0]!.activeEffects).toBe(3);
  });

  it("R8/F08: completion is refused while authorized ready work remains", async () => {
    const { fx, scope } = await ready(["first", "second"]);
    await fx.launch(scope, "first"); await fx.record(scope, "first", "done");
    expect(codeOf(await result(assess(fx, scope, { disposition: "completed", reason: "First milestone.", completion: { evidence: "Report." } })))).toBe("HELD");
  });

  it("R8/F08b: invalidated evidence makes an accepted completion inapplicable; re-acceptance keeps the history", async () => {
    const { fx, scope } = await ready(["first"]), start = await fx.launch(scope, "first");
    await fx.record(scope, "first", "done");
    await assess(fx, scope, { disposition: "completed", reason: "All goal evidence accepted.", completion: { evidence: "Verified complete outcome." } });
    expect(await continuation(fx, scope)).toMatchObject({ disposition: "completed", completionApplies: true, due: false });
    await fx.run(scope, { op: "invalidate", plan: scope.planId, node: "first", attempt: start.attemptId!, evidence: "Later evidence disproves the accepted result." });
    const after = await continuation(fx, scope);
    expect(after).toMatchObject({ derived: "needs-planning", completionApplies: false, due: true });
    expect(after.waits).toContainEqual(expect.objectContaining({ id: "completion" }));
    const old = after.assessed!.completion!;
    // Positive control: the checked validate command restores exactly the accepted outcome, so it applies again.
    await fx.run(scope, { op: "validate", plan: scope.planId, node: "first", attempt: start.attemptId!, expected: (await fx.store.read()).plans[0]!.plan.hash, evidence: "Re-verified after correction." });
    expect(await continuation(fx, scope)).toMatchObject({ completionApplies: true, disposition: "completed" });
    await fx.run(scope, { op: "invalidate", plan: scope.planId, node: "first", attempt: start.attemptId!, evidence: "Disproved again." });
    expect(await continuation(fx, scope)).toMatchObject({ completionApplies: false, due: true });
    await assess(fx, scope, { disposition: "completed", reason: "Accepted on independent replacement evidence.", completion: { evidence: "Independent report accepted." } });
    const row = (await fx.store.read()).continuations[0]!;
    expect(row.superseded.map(h => h.completion)).toEqual([old]);
    expect(codeOf(await result(fx.store.transact([{ kind: "continuation", id: row.id, version: row.version }], randomUUID(),
      [{ kind: "continuation", value: { ...row, version: row.version + 1, superseded: [] } }])))).toBe("HELD");
  });

  it("R9/F09: narrative planning acknowledgement cannot erase due work; only validated, bounded waits quiet it", async () => {
    const { fx, scope } = await ready(["first"]), before = await continuation(fx, scope);
    expect(codeOf(await result(assess(fx, scope, { disposition: "needs-planning" as never, reason: "I will continue planning next." })))).toBe("UNSUPPORTED");
    expect(codeOf(await result(assess(fx, scope, { disposition: "waiting", reason: "x", waits: [] })))).toBe("HELD");
    expect(codeOf(await result(assess(fx, scope, { disposition: "waiting", reason: "x", waits: [{ kind: "capacity", id: "p", detail: "quota" }] })))).toBe("HELD");
    expect(codeOf(await result(assess(fx, scope, { disposition: "waiting", reason: "x", waits: [{ kind: "attempt", id: randomUUID(), detail: "imaginary" }] })))).toBe("HELD");
    expect(await continuation(fx, scope)).toMatchObject({ due: true, inputVersion: before.inputVersion });
    // A bounded capacity wait quiets it until expiry; afterwards the same generation is due again with a new wake key.
    const soon = new Date(Date.now() + 60_000).toISOString();
    await assess(fx, scope, { disposition: "waiting", reason: "Quota exhausted.", waits: [{ kind: "capacity", id: "p", detail: "quota", until: soon }] });
    const quiet = await continuation(fx, scope);
    expect(quiet.due).toBe(false);
    const later = deriveContinuation(await fx.store.read(), scope.id, scope.planId, Date.now() + 120_000);
    expect(later).toMatchObject({ due: true, inputVersion: quiet.inputVersion }); expect(later.wakeKey).not.toBe(quiet.wakeKey);
  });

  it("C02/C03/C06/C07/C08 positive controls remain intact", async () => {
    const off = await ready(["first"], { capabilities: { selectedAgentIds: false } }), files = await off.fx.files();
    expect(codeOf(await result(off.fx.start(off.scope, "first")))).toBe("UNSUPPORTED"); expect(await off.fx.files()).toEqual(files);
    const { fx, scope } = await ready(["first"]), started = await fx.start(scope, "first");
    await fx.gateway.dispatch(started.effects!.workspace);
    fx.receiver.afterAdmission = () => { fx.hooks.boundary = async name => { if (name.startsWith("tip:")) throw new Error("receipt-commit crash"); }; };
    expect((await result(fx.gateway.dispatch(started.effects!.create))).accepted).toBe(false);
    fx.receiver.afterAdmission = null; fx.hooks.boundary = null;
    const restarted = new SupervisionGateway(fx.store, fx.commands, fx.home, fx.receiver, { enabled: true });
    expect(codeOf(await result(restarted.dispatch(started.effects!.create)))).toBe("UNCERTAIN");
    expect((await restarted.reconcile(started.effects!.create)).state).toBe("succeeded");
    await fx.gateway.verifyWorker(started.attemptId!);
    await writeFile(join(fx.home, "data/first/brief.md"), "Changed file must not change reserved bytes.");
    await fx.gateway.dispatch(started.effects!.send);
    expect(fx.receiver.sends[0]!.text).toBe("Synthetic checked brief."); expect(fx.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(1);
    const legacy = new WorkflowPlanStore(join(fx.home, "legacy"), fx.home), input = await fx.input(scope, { op: "start", plan: scope.planId, node: "first" });
    expect((await result(handleScopeRequest({ id: randomUUID(), actor: "general-first-mate", kind: "plan", input }, { store: fx.store, commands: fx.commands, gateway: fx.gateway, legacy, globalMateId: async () => "general-first-mate" }))).accepted).toBe(false);
    expect((await result(legacyRoute(fx.store, input.command))).accepted).toBe(false); await scopeRoute(legacy, scope.planId);
  });
});
