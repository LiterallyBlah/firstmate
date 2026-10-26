import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SupervisionActor } from "../shared/supervision";
import { continuationAgenda, deriveContinuation, goalStatus, livenessScan, recordContinuation, type ContinuationRecord } from "./supervision-continuation";
import { planSubjectHash } from "./workflow-plans";
import { captain, s04Fixture, type NodeSpec, type S04Fixture, type ScopeHandle } from "../test/supervision-s04-fixture";

const until = new Date(Date.now() + 3600_000).toISOString();
const derive = async (fx: S04Fixture, scope: ScopeHandle) => deriveContinuation(await fx.store.read(), scope.id, scope.planId);
async function record(fx: S04Fixture, scope: ScopeHandle, change: Partial<ContinuationRecord>, actor: SupervisionActor = scope.owner) {
  const d = await derive(fx, scope);
  return recordContinuation(fx.store, { requestId: randomUUID(), scopeId: scope.id, planId: scope.planId, epoch: 1, inputVersion: d.inputVersion,
    disposition: "blocked", reason: "Owner assessed.", waits: [], completion: null, ...change }, actor, true);
}
async function plan(fx: S04Fixture, n: number, nodes: NodeSpec[], delegated = false) {
  const scope = await fx.addScope(n, `goal-${n}`, nodes.map(x => x.id));
  await fx.draft(scope, nodes, delegated); return scope;
}

describe("S04 unfinished-goal continuation", { timeout: 60000 }, () => {
  it("Starpath shape: an accepted intermediate result with zero workers and no ready node needs planning, never finished", async () => {
    const fx = await s04Fixture();
    const scope = await plan(fx, 1, [{ id: "lifecycle", kind: "ship" }, { id: "qualify", after: [{ node: "lifecycle", on: "landed" }] }]);
    await fx.launch(scope, "lifecycle"); await fx.record(scope, "lifecycle", "done");
    const d = await derive(fx, scope);
    expect(d).toMatchObject({ derived: "needs-planning", disposition: "needs-planning", due: true, deliverable: true, activeWorkers: 0, nextNodes: [], responsible: "scope-owner" });
    expect(continuationAgenda(await fx.store.read()).map(c => c.planId)).toEqual([scope.planId]);
  });

  it("one finish makes two independent tasks ready; both reserve and start within the scope", async () => {
    const fx = await s04Fixture();
    const scope = await plan(fx, 1, [{ id: "probe" }, { id: "left", kind: "ship", after: [{ node: "probe", on: "done" }] }, { id: "right", kind: "ship", after: [{ node: "probe", on: "done" }] }]);
    await fx.launch(scope, "probe"); await fx.record(scope, "probe", "done");
    const d = await derive(fx, scope);
    expect(d).toMatchObject({ derived: "ready-action", nextNodes: ["left", "right"], due: true });
    // Starts serialize on the plan revision (a concurrent second start is STALE and rereads); no General hop.
    for (const node of d.nextNodes) await fx.launch(scope, node);
    const after = await derive(fx, scope);
    expect(after).toMatchObject({ derived: "waiting", due: false, activeWorkers: 2 });
    expect(fx.receiver.sends).toHaveLength(3);
  });

  it("a routine continuation stays with the owner; only a captain-authority decision escalates", async () => {
    const fx = await s04Fixture();
    const scope = await plan(fx, 1, [{ id: "scan" }, { id: "pick", decision: "captain", after: [{ node: "scan", on: "done" }] }, { id: "tidy", decision: "owner", after: [{ node: "scan", on: "done" }] },
      { id: "ship-it", kind: "ship", after: [{ node: "pick", on: "answered" }, { node: "tidy", on: "answered" }] }], true);
    await fx.launch(scope, "scan"); await fx.record(scope, "scan", "done");
    const d = await derive(fx, scope);
    expect(d).toMatchObject({ derived: "ready-action", nextNodes: ["tidy"] });
    expect(d.waits).toContainEqual(expect.objectContaining({ kind: "decision", id: "pick" }));
    await expect(record(fx, scope, { disposition: "captain-decision", waits: [{ kind: "decision", id: "tidy", detail: "x" }] })).rejects.toThrow(/stays with its owner/);
    // The captain's pending pick does not excuse the owner's own ready answer.
    await expect(record(fx, scope, { disposition: "captain-decision", reason: "Awaiting the captain's pick.", waits: [{ kind: "decision", id: "pick", detail: "Captain pick" }] })).rejects.toThrow(/Ready work stays due/);
    expect(await derive(fx, scope)).toMatchObject({ derived: "ready-action", nextNodes: ["tidy"], due: true });
  });

  it("recording an assessment cannot retrigger itself; an unchanged retry is refused; new facts make work due again", async () => {
    const fx = await s04Fixture();
    const scope = await plan(fx, 1, [{ id: "solo" }, { id: "after", after: [{ node: "solo", on: "done" }] }]);
    const first = await derive(fx, scope);
    expect(first).toMatchObject({ derived: "ready-action", due: true });
    await record(fx, scope, { disposition: "waiting", reason: "Provider capacity unavailable; bounded backoff.", waits: [{ kind: "capacity", id: "codex", detail: "quota", until }] });
    const second = await derive(fx, scope);
    expect(second).toMatchObject({ inputVersion: first.inputVersion, disposition: "waiting", derived: "ready-action", nextNodes: ["solo"], due: false });
    await expect(record(fx, scope, { disposition: "waiting", reason: "again", waits: [{ kind: "capacity", id: "codex", detail: "quota", until }] })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await derive(fx, scope)).inputVersion).toBe(first.inputVersion); // Heartbeat/restart re-derivation: still quiet.
    // A bookkeeping acknowledgement changes the plan hash, not the semantic input.
    await fx.run(scope, { op: "ack", plan: scope.planId, kind: "told", ids: ["start:solo"] });
    expect(await derive(fx, scope)).toMatchObject({ inputVersion: first.inputVersion, due: false });
    await fx.launch(scope, "solo"); await fx.record(scope, "solo", "done");
    expect(await derive(fx, scope)).toMatchObject({ derived: "ready-action", nextNodes: ["after"], due: true });
  });

  it("stale facts and stale owners cannot commit an assessment", async () => {
    const fx = await s04Fixture(), scope = await plan(fx, 1, [{ id: "one" }]);
    const d = await derive(fx, scope);
    await fx.launch(scope, "one");
    await expect(recordContinuation(fx.store, { requestId: randomUUID(), scopeId: scope.id, planId: scope.planId, epoch: 1, inputVersion: d.inputVersion,
      disposition: "blocked", reason: "old view", waits: [{ kind: "prerequisite", id: "x", detail: "x", until }], completion: null }, scope.owner, true)).rejects.toMatchObject({ code: "STALE" });
    await expect(record(fx, scope, {}, { kind: "mate-chat", id: "general-first-mate", source: "chat" })).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
    await expect(record(fx, scope, { disposition: "ready-action" as never })).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("explicit pause suppresses work; idleness is never a pause", async () => {
    const fx = await s04Fixture(), scope = await plan(fx, 1, [{ id: "p1" }]);
    await expect(record(fx, scope, { disposition: "paused", reason: "idle" })).rejects.toMatchObject({ code: "UNSUPPORTED" });
    const p = (await fx.store.read()).plans[0]!.plan;
    await fx.run(scope, { op: "captain", plan: scope.planId, revision: p.revision, subjectHash: planSubjectHash(p), action: "hold", text: "Pause this goal." }, captain);
    expect(await derive(fx, scope)).toMatchObject({ derived: "paused", due: false, responsible: "captain" });
    expect(continuationAgenda(await fx.store.read()).filter(c => c.due)).toEqual([]);
  });

  it("a held scope keeps its obligations visible, wakes nobody and admits no effect", async () => {
    const fx = await s04Fixture(), scope = await plan(fx, 1, [{ id: "h1" }, { id: "h2" }]);
    const started = await fx.start(scope, "h1");
    const s = await fx.store.read(), row = s.scopes.find(x => x.id === scope.id)!;
    await fx.store.transact([{ kind: "scope", id: row.id, version: row.version }], randomUUID(), [{ kind: "scope", value: { ...row, state: "held", version: row.version + 1 } }]);
    expect(await derive(fx, scope)).toMatchObject({ derived: "blocked", due: false, deliverable: false, responsible: "captain", nextNodes: ["h2"] });
    await expect(fx.gateway.dispatch(started.effects!.workspace)).rejects.toMatchObject({ code: "HELD" });
    await expect(fx.start(scope, "h2")).rejects.toMatchObject({ code: "HELD" });
    expect(fx.receiver.calls).toEqual([]);
  });

  it("completion needs quiescent work and evidence, and an accepted completion cannot be silently erased", async () => {
    const fx = await s04Fixture(), scope = await plan(fx, 1, [{ id: "c1" }]);
    await fx.launch(scope, "c1");
    await expect(record(fx, scope, { disposition: "completed", reason: "done", completion: { evidence: "Report verified." } })).rejects.toThrow(/quiescent/);
    await fx.record(scope, "c1", "done");
    await expect(record(fx, scope, { disposition: "completed", reason: "done", completion: null })).rejects.toThrow(/evidence/);
    expect(await derive(fx, scope)).toMatchObject({ derived: "needs-planning" }); // All nodes terminal is not success.
    await record(fx, scope, { disposition: "completed", reason: "Outcome accepted.", completion: { evidence: "Verified report data/c1/report.md at head abc." } });
    expect(await derive(fx, scope)).toMatchObject({ derived: "completed", due: false });
    const s = await fx.store.read(), row = s.continuations[0]!;
    await expect(fx.store.transact([{ kind: "continuation", id: row.id, version: row.version }], randomUUID(),
      [{ kind: "continuation", value: { ...row, version: row.version + 1, disposition: "blocked", completion: null } }])).rejects.toMatchObject({ code: "HELD" });
  });

  it("a capacity failure at launch keeps spend and stays visible as an obligation, without fallback", async () => {
    const fx = await s04Fixture(), scope = await plan(fx, 1, [{ id: "cap" }]);
    const started = await fx.start(scope, "cap");
    await fx.gateway.dispatch(started.effects!.workspace);
    fx.receiver.faults.createAgent = ["capacity"];
    await fx.gateway.dispatch(started.effects!.create);
    const d = await derive(fx, scope);
    expect(d).toMatchObject({ derived: "needs-planning", due: true, activeWorkers: 0 });
    expect(d.waits.filter(w => w.kind === "effect")).toEqual([]);
    expect((await fx.store.read()).effects.find(e => e.id === started.effects!.send)!.state).toBe("cancelled");
    expect((await fx.store.read()).attempts[0]).toMatchObject({ spentAgents: 1 });
    expect(fx.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(1);
  });

  it("restart/lost-callback scan rediscovers a finished worker without creating, prompting or retargeting", async () => {
    const fx = await s04Fixture(), scope = await plan(fx, 1, [{ id: "lost" }]);
    const started = await fx.launch(scope, "lost");
    const bound = (await fx.store.read()).attempts[0]!.worker!, worker = bound.agentId;
    await fx.run(scope, { op: "record", plan: scope.planId, node: "lost", attempt: started.attemptId!, state: "running", evidence: "Worker verified and prompted.", agentId: worker, workspaceId: bound.workspaceId });
    const calls = fx.receiver.calls.length;
    fx.receiver.finish(worker); // The completion notification was lost; nothing told the owner.
    const scan = await livenessScan(await fx.store.read(), fx.receiver);
    expect(scan).toEqual([{ attemptId: started.attemptId, agentId: worker, observed: "idle", ownerReview: true }]);
    expect(fx.receiver.calls).toHaveLength(calls);
    expect(await derive(fx, scope)).toMatchObject({ derived: "waiting", activeWorkers: 1 });
  });

  it("goal and project status show owner, next action, live worker/effect counts and evidence age without waking anyone", async () => {
    const fx = await s04Fixture();
    const a = await plan(fx, 1, [{ id: "ga" }]), b = await plan(fx, 2, [{ id: "gb" }]);
    await fx.launch(a, "ga");
    const before = await fx.files(), view = goalStatus(await fx.store.read());
    expect(view.goals.map(g => [g.planId, g.state, g.owner, g.activeWorkers, g.due])).toEqual([
      [a.planId, "waiting", "owner-1", 1, false], [b.planId, "ready-action", "owner-2", 0, true]]);
    expect(view.projects.map(p => [p.projectId, p.activeWorkers, p.due])).toEqual([[a.projectId, 1, 0], [b.projectId, 0, 1]]);
    expect(await fx.files()).toEqual(before);
  });
});
