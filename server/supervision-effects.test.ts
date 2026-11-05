import { createHash, randomUUID } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOT_CREATED_PROOF_MIN_AGE_MS, SupervisionGateway, effectLogicalKey, requireGatewayOperation } from "./supervision-effects";
import { SupervisorSessions } from "./supervisor-sessions";
import { recordContinuation } from "./supervision-continuation";
import { oneAtATime } from "./mate";
import { planSubjectHash } from "./workflow-plans";
import { captain, s04Fixture, type S04Fixture, type ScopeHandle } from "../test/supervision-s04-fixture";
import { SupervisionRemoteReceiver } from "./supervision-remote-receiver";
import { FakeCliBridge, REMOTE_CWD, REMOTE_HOST } from "../test/fake-remote-bridge";

async function ready(fx: S04Fixture, n = 1, prefix = "a") {
  const scope = await fx.addScope(n, `plan-${prefix}`, [`${prefix}-trial`, `${prefix}-build`]);
  await fx.draft(scope, [{ id: `${prefix}-trial` }, { id: `${prefix}-build`, kind: "ship", after: [{ node: `${prefix}-trial`, on: "done" }] }]);
  return scope;
}
const effect = async (fx: S04Fixture, id: string) => (await fx.store.read()).effects.find(e => e.id === id)!;
/** A gateway whose clock is past the not-created proof's minimum uncertain age. */
const laterGateway = (fx: S04Fixture) => new SupervisionGateway(fx.store, fx.commands, fx.home, fx.receiver,
  { enabled: true, now: () => Date.now() + NOT_CREATED_PROOF_MIN_AGE_MS + 60_000 });
const attempt = async (fx: S04Fixture, id: string) => (await fx.store.read()).attempts.find(a => a.id === id)!;

describe("S04 effect gateway (synthetic receiver)", { timeout: 60000 }, () => {
  it("is disabled by default and writes nothing", async () => {
    const fx = await s04Fixture(), scope = await ready(fx), before = await fx.files();
    const off = new SupervisionGateway(fx.store, fx.commands, fx.home, fx.receiver);
    await expect(off.startWorker(await fx.input(scope, { op: "start", plan: scope.planId, node: "a-trial" }), scope.owner)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(new SupervisorSessions(fx.store, off, fx.receiver, { limits: { supervisorSessions: 1, supervisorTurns: 1 }, globalMateId: async () => null })
      .prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1, profile: { provider: "x/y", modeId: "" }, opening: "o" }, captain)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(recordContinuation(fx.store, { requestId: randomUUID(), scopeId: scope.id, planId: scope.planId, epoch: 1, inputVersion: "0".repeat(64),
      disposition: "blocked", reason: "r", waits: [], completion: null }, scope.owner)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(await fx.files()).toEqual(before); expect(fx.receiver.calls).toEqual([]);
  });

  it("reserves workspace/create/send with the checked start in one transaction, then sends only after verification", async () => {
    const fx = await s04Fixture(), scope = await ready(fx), before = (await fx.store.read()).sequence;
    const started = await fx.start(scope, "a-trial");
    const status = await fx.store.read();
    expect(status.sequence).toBe(before + 1);
    expect(status.effects.filter(e => e.attemptId === started.attemptId).map(e => [e.operation, e.state])).toEqual([
      ["workspace.open", "reserved"], ["agent.create", "reserved"], ["agent.send", "reserved"]]);
    expect(status.tasks.find(t => t.nodeId === "a-trial")!.currentAttempt).toBe(started.attemptId);
    expect(status.plans[0]!.plan.nodes["a-trial"]!.attempt).toBe(started.attemptId);
    expect(await attempt(fx, started.attemptId!)).toMatchObject({ spentAgents: 1, spentTurns: 1, state: "reserved", notificationStatus: "known", originalNotificationOwner: null });
    // Order is enforced: no create before the workspace, no send before verified identity.
    await expect(fx.gateway.dispatch(started.effects!.create)).rejects.toMatchObject({ code: "HELD" });
    await fx.gateway.dispatch(started.effects!.workspace);
    await fx.gateway.dispatch(started.effects!.create);
    await expect(fx.gateway.dispatch(started.effects!.send)).rejects.toMatchObject({ code: "HELD" });
    const active = await fx.gateway.verifyWorker(started.attemptId!);
    expect(active).toMatchObject({ state: "active", worker: { hostId: "local", agentId: (await effect(fx, started.effects!.create)).receiverKey } });
    await fx.gateway.dispatch(started.effects!.send);
    expect(fx.receiver.calls.map(c => c.op)).toEqual(["openWorkspace", "createAgent", "send"]);
    const created = fx.receiver.agents.get(active.worker!.agentId)!;
    // Top-level, unprompted, parentless: no General-native callback dependency.
    expect(created.labels["paseo.parent-agent-id"]).toBeUndefined();
    expect(created.labels).toMatchObject({ "firstmate.role": "crew", "firstmate.task": "a-trial", "firstmate.scope": scope.id, "firstmate.attempt": started.attemptId });
    expect(fx.receiver.sends).toEqual([{ agentId: active.worker!.agentId, text: "Synthetic checked brief.", messageId: `firstmate-s04-${started.effects!.send}` }]);
    expect(await attempt(fx, started.attemptId!)).toMatchObject({ state: "prompted", spentAgents: 1 });
  });

  it("one effect per logical start: replay returns the original reservation; a new request ID cannot duplicate it (A01-C02/C04)", async () => {
    const fx = await s04Fixture(), scope = await ready(fx);
    const i = await fx.input(scope, { op: "start", plan: scope.planId, node: "a-trial" });
    const first = await fx.gateway.startWorker(i, scope.owner), effects = (await fx.store.read()).effects.length;
    expect(await fx.gateway.startWorker(i, scope.owner)).toMatchObject({ receipt: first.receipt, attemptId: first.attemptId, effects: first.effects });
    await expect(fx.gateway.startWorker({ ...i, requestId: randomUUID() }, scope.owner)).rejects.toThrow();
    await expect(fx.commands.planCommand(i, scope.owner)).rejects.toMatchObject({ code: "CONFLICT" }); // plain vs composed command under one ID
    expect((await fx.store.read()).effects).toHaveLength(effects);
    const key = effectLogicalKey({ scopeId: scope.id, subject: "x", operation: "agent.create", causation: "c", objectiveRevision: 1 });
    expect(key).toBe(effectLogicalKey({ scopeId: scope.id, subject: "x", operation: "agent.create", causation: "c", objectiveRevision: 1 }));
  });

  it("lost workspace reply stays uncertain; no lookup means no retry and no create (A10/A18-C03)", async () => {
    const fx = await s04Fixture(), scope = await ready(fx), started = await fx.start(scope, "a-trial");
    fx.receiver.faults.openWorkspace = ["lose"];
    expect((await fx.gateway.dispatch(started.effects!.workspace)).state).toBe("uncertain");
    await expect(fx.gateway.dispatch(started.effects!.workspace)).rejects.toMatchObject({ code: "UNCERTAIN" });
    expect((await fx.gateway.reconcile(started.effects!.workspace)).state).toBe("uncertain");
    await expect(fx.gateway.dispatch(started.effects!.create)).rejects.toMatchObject({ code: "HELD" });
    expect(fx.receiver.calls.map(c => c.op)).toEqual(["openWorkspace"]);
    expect((await fx.store.read()).uncertainEffectIds).toContain(started.effects!.workspace);
    expect(await attempt(fx, started.attemptId!)).toMatchObject({ spentAgents: 1, spentTurns: 1 });
  });

  it("an exact workspace intent lookup binds the original workspace without a second open", async () => {
    const fx = await s04Fixture({ capabilities: { workspaceIntentLookup: true } }), scope = await ready(fx), started = await fx.start(scope, "a-trial");
    fx.receiver.faults.openWorkspace = ["lose"];
    await fx.gateway.dispatch(started.effects!.workspace);
    const settled = await fx.gateway.reconcile(started.effects!.workspace);
    expect(settled.state).toBe("succeeded"); expect(JSON.parse(settled.receiptRef!).workspaceId).toBe("ws-1");
    expect(fx.receiver.calls.filter(c => c.op === "openWorkspace")).toHaveLength(1);
  });

  it("reconcile settles an uncertain worker workspace.open as not created on proof, cancelling reserved siblings and keeping spend", async () => {
    const fx = await s04Fixture({ capabilities: { workspaceIntentLookup: true, workspaceNotCreatedProof: true } }), scope = await ready(fx), started = await fx.start(scope, "a-trial");
    fx.receiver.faults.openWorkspace = ["fail"]; // Plain failure, nothing created: dispatch goes uncertain.
    expect((await fx.gateway.dispatch(started.effects!.workspace)).state).toBe("uncertain");
    fx.receiver.workspaceNotCreated = true;
    // Too young: a creation the reply lost track of may still be running, so the proof is not even asked.
    expect((await fx.gateway.reconcile(started.effects!.workspace)).state).toBe("uncertain");
    expect(fx.receiver.proofCalls).toEqual([]);
    const settled = await laterGateway(fx).reconcile(started.effects!.workspace);
    expect(settled.state).toBe("failed"); expect(settled.receiptRef).toMatch(/^rejected:not-created:/);
    expect((await effect(fx, started.effects!.create)).state).toBe("cancelled");
    expect((await effect(fx, started.effects!.send)).state).toBe("cancelled");
    expect(await attempt(fx, started.attemptId!)).toMatchObject({ spentAgents: 1, spentTurns: 1 }); // Spend is kept, never refunded.
    expect(fx.receiver.calls.map(c => c.op)).toEqual(["openWorkspace"]); // Nothing resent or recreated.
    expect(fx.receiver.proofCalls).toHaveLength(1);
    expect((await fx.store.read()).uncertainEffectIds).not.toContain(started.effects!.workspace);
  });

  it("reconcile keeps an uncertain worker workspace.open uncertain when the not-created proof is inconclusive or unoffered", async () => {
    const fx = await s04Fixture({ capabilities: { workspaceIntentLookup: true, workspaceNotCreatedProof: true } }), scope = await ready(fx), started = await fx.start(scope, "a-trial");
    fx.receiver.faults.openWorkspace = ["fail"];
    await fx.gateway.dispatch(started.effects!.workspace);
    // workspaceNotCreated stays false: the proof cannot say nothing was created.
    expect((await laterGateway(fx).reconcile(started.effects!.workspace)).state).toBe("uncertain");
    expect((await effect(fx, started.effects!.create)).state).toBe("reserved");
    expect((await effect(fx, started.effects!.send)).state).toBe("reserved");
    expect(fx.receiver.proofCalls).toHaveLength(1); // Asked, and its "cannot say" is what kept it uncertain.
    expect(fx.receiver.calls.filter(c => c.op === "openWorkspace")).toHaveLength(1);
    const off = await s04Fixture({ capabilities: { workspaceIntentLookup: true, workspaceNotCreatedProof: false } }), scope2 = await ready(off), started2 = await off.start(scope2, "a-trial");
    off.receiver.faults.openWorkspace = ["fail"]; off.receiver.workspaceNotCreated = true;
    await off.gateway.dispatch(started2.effects!.workspace);
    expect((await laterGateway(off).reconcile(started2.effects!.workspace)).state).toBe("uncertain"); // No proof capability: never asked.
    expect(off.receiver.proofCalls).toEqual([]);
  });

  it("a found workspace still settles succeeded even when a not-created proof is on offer", async () => {
    const fx = await s04Fixture({ capabilities: { workspaceIntentLookup: true, workspaceNotCreatedProof: true } }), scope = await ready(fx), started = await fx.start(scope, "a-trial");
    fx.receiver.faults.openWorkspace = ["lose"]; fx.receiver.workspaceNotCreated = true;
    await fx.gateway.dispatch(started.effects!.workspace);
    const settled = await fx.gateway.reconcile(started.effects!.workspace);
    expect(settled.state).toBe("succeeded"); expect(JSON.parse(settled.receiptRef!).workspaceId).toBe("ws-1");
    expect(fx.receiver.proofCalls).toEqual([]);
    expect((await effect(fx, started.effects!.create)).state).toBe("reserved");
  });

  it("never proves not-created while the original workspace.open call is still in flight", async () => {
    const fx = await s04Fixture({ capabilities: { workspaceIntentLookup: true, workspaceNotCreatedProof: true } }), scope = await ready(fx), started = await fx.start(scope, "a-trial");
    fx.receiver.workspaceNotCreated = true; // The proof would say "nothing there" — it must not be asked yet.
    let release!: () => void; fx.receiver.beforePerform = () => new Promise<void>(done => { release = done; });
    const inflight = fx.gateway.dispatch(started.effects!.workspace);
    while ((await effect(fx, started.effects!.workspace)).state !== "dispatching") await new Promise(r => setTimeout(r, 10));
    // A concurrent reconcile marks the in-flight call uncertain; that state alone proves nothing.
    expect((await fx.gateway.reconcile(started.effects!.workspace)).state).toBe("uncertain");
    // Even past the minimum age, the outstanding call blocks the proof: no failed settle, no cancelled siblings.
    expect((await laterGateway(fx).reconcile(started.effects!.workspace)).state).toBe("uncertain");
    expect(fx.receiver.proofCalls).toEqual([]);
    expect((await effect(fx, started.effects!.create)).state).toBe("reserved");
    expect((await effect(fx, started.effects!.send)).state).toBe("reserved");
    release(); fx.receiver.beforePerform = null;
    expect(await inflight).toMatchObject({ state: "succeeded" }); // The original creation lands and binds.
    expect(fx.receiver.calls.filter(c => c.op === "openWorkspace")).toHaveLength(1);
  });

  it("restarts the proof age when a call marked uncertain mid-flight finally times out", async () => {
    const fx = await s04Fixture({ capabilities: { workspaceIntentLookup: true, workspaceNotCreatedProof: true } }), scope = await ready(fx), started = await fx.start(scope, "a-trial");
    let now = Date.now();
    const gateway = new SupervisionGateway(fx.store, fx.commands, fx.home, fx.receiver, { enabled: true, now: () => now });
    fx.receiver.workspaceNotCreated = true; fx.receiver.faults.openWorkspace = ["fail"];
    let release!: () => void; fx.receiver.beforePerform = () => new Promise<void>(done => { release = done; });
    const inflight = gateway.dispatch(started.effects!.workspace);
    while ((await effect(fx, started.effects!.workspace)).state !== "dispatching") await new Promise(r => setTimeout(r, 10));
    expect((await gateway.reconcile(started.effects!.workspace)).state).toBe("uncertain"); // Marked uncertain mid-call.
    now += NOT_CREATED_PROOF_MIN_AGE_MS + 60_000; // The call then runs past the minimum age...
    release(); fx.receiver.beforePerform = null;
    expect((await inflight).state).toBe("uncertain"); // ...and times out. The daemon may still be creating.
    expect((await gateway.reconcile(started.effects!.workspace)).state).toBe("uncertain"); // Age restarted at call end.
    expect(fx.receiver.proofCalls).toEqual([]);
    now += NOT_CREATED_PROOF_MIN_AGE_MS + 60_000;
    expect((await gateway.reconcile(started.effects!.workspace)).state).toBe("failed");
    expect(fx.receiver.proofCalls).toHaveLength(1);
  });

  it("lost create reply: negative lookup proves nothing; the late original binds to the same reserved ID (A10/A18-C03)", async () => {
    const fx = await s04Fixture(), scope = await ready(fx), started = await fx.start(scope, "a-trial");
    await fx.gateway.dispatch(started.effects!.workspace);
    fx.receiver.faults.createAgent = ["hide"];
    expect((await fx.gateway.dispatch(started.effects!.create)).state).toBe("uncertain");
    expect((await fx.gateway.reconcile(started.effects!.create)).state).toBe("uncertain");
    await expect(fx.gateway.verifyWorker(started.attemptId!)).rejects.toMatchObject({ code: "HELD" });
    await expect(fx.gateway.dispatch(started.effects!.create)).rejects.toMatchObject({ code: "UNCERTAIN" });
    const reserved = (await effect(fx, started.effects!.create)).receiverKey!;
    fx.receiver.reveal(reserved); // Late result from the original request.
    expect(await fx.gateway.reconcile(started.effects!.create)).toMatchObject({ state: "succeeded", receiptRef: `agent:${reserved}` });
    await fx.gateway.verifyWorker(started.attemptId!); await fx.gateway.dispatch(started.effects!.send);
    expect(fx.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(1);
    expect(fx.receiver.agents.size).toBe(1);
    expect(await attempt(fx, started.attemptId!)).toMatchObject({ spentAgents: 1, state: "prompted" });
  });

  it("lost send reply stays uncertain forever without a receipt API; never resent (A18-C03, U1)", async () => {
    const fx = await s04Fixture(), scope = await ready(fx), started = await fx.start(scope, "a-trial");
    await fx.gateway.dispatch(started.effects!.workspace); await fx.gateway.dispatch(started.effects!.create); await fx.gateway.verifyWorker(started.attemptId!);
    fx.receiver.faults.send = ["lose"];
    expect((await fx.gateway.dispatch(started.effects!.send)).state).toBe("uncertain");
    await expect(fx.gateway.dispatch(started.effects!.send)).rejects.toMatchObject({ code: "UNCERTAIN" });
    expect((await fx.gateway.reconcile(started.effects!.send)).state).toBe("uncertain");
    expect(fx.receiver.sends).toHaveLength(1);
    expect(await attempt(fx, started.attemptId!)).toMatchObject({ spentAgents: 1, spentTurns: 1, state: "active" });
  });

  it("a crash after admission and before the receipt commit leaves dispatching; a restarted gateway reconciles, never resends (P05/P06)", async () => {
    const fx = await s04Fixture(), scope = await ready(fx), started = await fx.start(scope, "a-trial");
    await fx.gateway.dispatch(started.effects!.workspace);
    fx.receiver.afterAdmission = () => { fx.hooks.boundary = async name => { if (name.startsWith("tip:")) throw new Error("process died"); }; };
    await expect(fx.gateway.dispatch(started.effects!.create)).rejects.toMatchObject({ code: "HELD" });
    fx.hooks.boundary = null; fx.receiver.afterAdmission = null;
    const status = await fx.store.read();
    expect(status.freshness).toBe("current");
    expect(status.effects.find(e => e.id === started.effects!.create)!.state).toBe("dispatching");
    expect(status.uncertainEffectIds).toContain(started.effects!.create);
    const restarted = new SupervisionGateway(fx.store, fx.commands, fx.home, fx.receiver, { enabled: true });
    await expect(restarted.dispatch(started.effects!.create)).rejects.toMatchObject({ code: "UNCERTAIN" });
    expect((await restarted.reconcile(started.effects!.create)).state).toBe("succeeded");
    expect(fx.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(1);
  });

  it("a definite reply still settles an in-flight effect that a concurrent reconcile marked uncertain", async () => {
    const fx = await s04Fixture(), scope = await ready(fx), started = await fx.start(scope, "a-trial");
    let release!: () => void; fx.receiver.gate = new Promise(done => { release = done; });
    const inflight = fx.gateway.dispatch(started.effects!.workspace);
    while ((await effect(fx, started.effects!.workspace)).state !== "dispatching") await new Promise(r => setTimeout(r, 10));
    expect((await fx.gateway.reconcile(started.effects!.workspace)).state).toBe("uncertain"); // No workspace lookup: unknown.
    release(); fx.receiver.gate = null;
    expect(await inflight).toMatchObject({ state: "succeeded" });
    expect(fx.receiver.calls.filter(c => c.op === "openWorkspace")).toHaveLength(1);
  });

  it("a definite pre-admission rejection fails safely and keeps cumulative spend (no hidden refund)", async () => {
    const fx = await s04Fixture(), scope = await ready(fx), started = await fx.start(scope, "a-trial");
    await fx.gateway.dispatch(started.effects!.workspace);
    fx.receiver.faults.createAgent = ["capacity"];
    const failed = await fx.gateway.dispatch(started.effects!.create);
    expect(failed).toMatchObject({ state: "failed" }); expect(failed.receiptRef).toMatch(/^rejected:capacity:/);
    await expect(fx.gateway.dispatch(started.effects!.create)).rejects.toMatchObject({ code: "HELD" });
    expect(await attempt(fx, started.attemptId!)).toMatchObject({ spentAgents: 1, spentTurns: 1 });
    expect((await fx.store.read()).plans[0]!.plan.nodes["a-trial"]!.spent).toBe(1);
    expect(fx.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(1); // No fallback profile or fresh ID.
  });

  it("refuses without caller-selected IDs and never falls back to a fresh-ID or prompted create (A18-C01/C02)", async () => {
    const fx = await s04Fixture({ capabilities: { selectedAgentIds: false } }), scope = await ready(fx), before = await fx.files();
    const blobs = await readdir(join(fx.store.root, "blobs"));
    await expect(fx.start(scope, "a-trial")).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(await fx.files()).toEqual(before);
    expect(await readdir(join(fx.store.root, "blobs"))).toEqual(blobs);
    expect((await fx.store.read()).plans[0]!.plan.nodes["a-trial"]?.state ?? "planned").toBe("planned");
    expect(fx.receiver.calls).toEqual([]);
  });

  it("refuses receivers that claim capabilities this contract cannot honour (A18-C05)", async () => {
    const fx = await s04Fixture({ capabilities: { sendReceiptLookup: true } as never }), scope = await ready(fx);
    await expect(fx.start(scope, "a-trial")).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(fx.receiver.calls).toEqual([]);
  });

  it("has no release adapter (A03-C04)", () => {
    for (const op of ["merge", "deploy", "discard", "publish", "release"]) expect(() => requireGatewayOperation(op)).toThrow(expect.objectContaining({ code: "UNSUPPORTED" }));
    expect(requireGatewayOperation("agent.create")).toBe("agent.create");
  });

  it("verification refuses native ancestry or changed settings and never sends the brief", async () => {
    const fx = await s04Fixture(), scope = await ready(fx), started = await fx.start(scope, "a-trial");
    fx.receiver.tamper = agent => { agent.labels["paseo.parent-agent-id"] = "general-first-mate"; };
    await fx.gateway.dispatch(started.effects!.workspace); await fx.gateway.dispatch(started.effects!.create);
    await expect(fx.gateway.verifyWorker(started.attemptId!)).rejects.toThrow(/independent ancestry/);
    await expect(fx.gateway.dispatch(started.effects!.send)).rejects.toMatchObject({ code: "HELD" });
    const other = await s04Fixture(), scope2 = await ready(other), started2 = await other.start(scope2, "a-trial");
    other.receiver.tamper = agent => { agent.thinkingOptionId = "low"; };
    await other.gateway.dispatch(started2.effects!.workspace); await other.gateway.dispatch(started2.effects!.create);
    await expect(other.gateway.verifyWorker(started2.attemptId!)).rejects.toThrow(/settings/);
    expect([...fx.receiver.sends, ...other.receiver.sends]).toEqual([]);
  });

  it("captain stop holds admissions: reserved effects cancel, dispatched ones keep their reservation; an unrelated scope continues (A05)", async () => {
    const fx = await s04Fixture(), a = await ready(fx, 1, "a"), b = await ready(fx, 2, "b");
    const sa = await fx.start(a, "a-trial");
    await fx.gateway.dispatch(sa.effects!.workspace);
    fx.receiver.faults.createAgent = ["lose"];
    await fx.gateway.dispatch(sa.effects!.create);
    const p = (await fx.store.read()).plans.find(p => p.plan.definition.id === a.planId)!.plan;
    await fx.run(a, { op: "captain", plan: a.planId, revision: p.revision, subjectHash: planSubjectHash(p), action: "hold", text: "Stop admissions for plan a." }, captain);
    const s = await fx.store.read();
    expect(s.effects.find(e => e.id === sa.effects!.send)!.state).toBe("cancelled");
    expect(s.effects.find(e => e.id === sa.effects!.create)!.state).toBe("uncertain");
    expect(s.attempts.find(x => x.id === sa.attemptId)).toMatchObject({ spentAgents: 1 });
    await expect(fx.gateway.dispatch(sa.effects!.send)).rejects.toMatchObject({ code: "HELD" });
    await fx.launch(b, "b-trial"); // Unrelated scope is not frozen.
    expect(fx.receiver.sends.map(x => x.agentId)).toHaveLength(1);
  });

  it("archive is a guarded proposal: idle is not finished, incomplete or non-empty inventory refuses (A14)", async () => {
    const fx = await s04Fixture(), scope = await ready(fx), started = await fx.launch(scope, "a-trial");
    const worker = (await attempt(fx, started.attemptId!)).worker!.agentId;
    const propose = (operation: string, actor = scope.owner) => fx.gateway.propose({ scopeId: scope.id, epoch: 1, attemptId: started.attemptId!, operation, causation: `${operation}:review`, requestId: randomUUID() }, actor);
    fx.receiver.finish(worker);
    await expect(propose("agent.archive")).rejects.toThrow(/Idle is not finished/);
    await fx.record(scope, "a-trial", "done");
    fx.receiver.incompleteInventory = true;
    await expect(propose("agent.archive")).rejects.toMatchObject({ code: "HELD" });
    fx.receiver.incompleteInventory = false; fx.receiver.children.set(worker, [{ id: "child", labels: {}, workspaceId: null }]);
    await expect(propose("agent.archive")).rejects.toThrow(/descendants/);
    fx.receiver.children.delete(worker);
    await expect(propose("agent.archive", { kind: "mate-chat", id: "general-first-mate", source: "chat" })).rejects.toThrow();
    const proposal = await propose("agent.archive");
    expect(proposal).toMatchObject({ state: "reserved", operation: "agent.archive" });
    fx.receiver.children.set(worker, [{ id: "late-child", labels: {}, workspaceId: null }]); // Check-then-archive race (U3 absent).
    await expect(fx.gateway.dispatch(proposal.id)).rejects.toMatchObject({ code: "HELD" });
    fx.receiver.children.delete(worker);
    expect((await fx.gateway.dispatch(proposal.id)).state).toBe("succeeded");
    expect(fx.receiver.agents.get(worker)!.archivedAt).not.toBeNull();
  });

  it("interrupt proposals come only from the current owner for its current worker; one per cause", async () => {
    const fx = await s04Fixture(), scope = await ready(fx), started = await fx.launch(scope, "a-trial");
    const input = { scopeId: scope.id, epoch: 1, attemptId: started.attemptId!, operation: "agent.interrupt", causation: "owner:stop-loop", requestId: randomUUID() };
    await expect(fx.gateway.propose({ ...input, epoch: 2 }, scope.owner)).rejects.toMatchObject({ code: "STALE" });
    await expect(fx.gateway.propose(input, { kind: "agent", id: "neighbour", source: "x" })).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
    const proposal = await fx.gateway.propose(input, scope.owner);
    await expect(fx.gateway.propose({ ...input, requestId: randomUUID() }, scope.owner)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await fx.gateway.dispatch(proposal.id)).state).toBe("succeeded");
  });

  it("two plans progress to their workers while General holds its conversation lock (A08)", async () => {
    const fx = await s04Fixture(), a = await ready(fx, 1, "a"), b = await ready(fx, 2, "b");
    let release!: () => void;
    const general = oneAtATime(() => new Promise<void>(done => { release = done; }));
    await Promise.all([fx.launch(a, "a-trial"), fx.launch(b, "b-trial")]);
    expect(fx.receiver.sends).toHaveLength(2);
    expect(fx.receiver.calls.every(c => c.target !== "general-first-mate")).toBe(true);
    release(); await general;
  });
});
describe("label-bound remote worker receiver (fake CLI bridge, probe shapes)", { timeout: 60000 }, () => {
  async function remoteReady(fx: S04Fixture, bridge: FakeCliBridge, cliVersion = "0.14.0") {
    const scope = await fx.addScope(3, "plan-r", ["r-trial", "r-build"], true, REMOTE_HOST);
    await fx.draft(scope, [{ id: "r-trial" }, { id: "r-build", kind: "ship", after: [{ node: "r-trial", on: "done" }] }]);
    const receiver = new SupervisionRemoteReceiver(bridge, REMOTE_HOST, async () => REMOTE_CWD, { cliVersion: async () => cliVersion });
    const gateway = new SupervisionGateway(fx.store, fx.commands, fx.home, fx.receiver,
      { enabled: true, receiverFor: (host) => host === REMOTE_HOST ? receiver : undefined });
    return { scope, receiver, gateway };
  }
  const startRemote = async (fx: S04Fixture, gateway: SupervisionGateway, scope: ScopeHandle) =>
    gateway.startWorker(await fx.input(scope, { op: "start", plan: scope.planId, node: "r-trial" }), await fx.actorFor(scope));

  it("creates at the prompt, verifies after create, settles the send at-create, and interrupts via stop; archive is refused", async () => {
    const fx = await s04Fixture(), bridge = new FakeCliBridge(), { scope, gateway } = await remoteReady(fx, bridge);
    const started = await startRemote(fx, gateway, scope);
    await gateway.dispatch(started.effects!.workspace);
    await gateway.dispatch(started.effects!.create);
    const active = await gateway.verifyWorker(started.attemptId!);
    const agentId = [...bridge.agents.keys()][0]!;
    expect(active.worker).toEqual({ hostId: REMOTE_HOST, agentId, workspaceId: "wks_remote1" });
    expect((await gateway.dispatch(started.effects!.send)).receiptRef).toBe(`message:at-create:${agentId}`);
    expect(bridge.runs()).toHaveLength(1);
    expect(bridge.runs()[0]).toContain(`firstmate.attempt=${started.attemptId}`);
    expect(bridge.runs()[0]!.at(-1)).toBe("Synthetic checked brief.");
    expect(bridge.calls.filter((args) => args[0] === "send")).toEqual([]);
    expect(await attempt(fx, started.attemptId!)).toMatchObject({ state: "prompted", spentAgents: 1 });
    const owner = await fx.actorFor(scope);
    const stop = await gateway.propose({ scopeId: scope.id, epoch: 1, attemptId: started.attemptId!, operation: "agent.interrupt", causation: "test-stop", requestId: randomUUID() }, owner);
    expect((await gateway.dispatch(stop.id)).state).toBe("succeeded");
    expect(bridge.calls.filter((args) => args[0] === "stop")).toEqual([["stop", agentId]]);
    await expect(gateway.propose({ scopeId: scope.id, epoch: 1, attemptId: started.attemptId!, operation: "agent.archive", causation: "test-archive", requestId: randomUUID() }, owner))
      .rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("an uncertain create is never resent; label discovery binds exactly one, and a duplicate stays held", async () => {
    const fx = await s04Fixture(), bridge = new FakeCliBridge(), { scope, gateway } = await remoteReady(fx, bridge);
    const started = await startRemote(fx, gateway, scope);
    await gateway.dispatch(started.effects!.workspace);
    bridge.fault = "lose-run";
    expect((await gateway.dispatch(started.effects!.create)).state).toBe("uncertain");
    await expect(gateway.dispatch(started.effects!.create)).rejects.toMatchObject({ code: "UNCERTAIN" });
    expect(bridge.runs()).toHaveLength(1);
    // A second same-label agent is a held duplicate: reconcile binds nothing and touches nothing.
    const [agentId] = [...bridge.agents.keys()];
    bridge.byAttempt.set(started.attemptId!, [agentId!, randomUUID()]);
    expect((await gateway.reconcile(started.effects!.create)).state).toBe("uncertain");
    expect(bridge.calls.filter((args) => ["archive", "stop"].includes(args[0]!))).toEqual([]);
    bridge.byAttempt.set(started.attemptId!, [agentId!]);
    const settled = await gateway.reconcile(started.effects!.create);
    expect(settled).toMatchObject({ state: "succeeded", receiptRef: `agent:${agentId}` });
    await gateway.verifyWorker(started.attemptId!);
    await gateway.dispatch(started.effects!.send);
    expect(bridge.runs()).toHaveLength(1);
    expect(await attempt(fx, started.attemptId!)).toMatchObject({ state: "prompted", spentAgents: 1, spentTurns: 1 });
  });

  it("connect refused settles failed with siblings cancelled, unlike a post-submit timeout's uncertainty", async () => {
    const fx = await s04Fixture(), bridge = new FakeCliBridge(), { scope, gateway } = await remoteReady(fx, bridge);
    const started = await startRemote(fx, gateway, scope);
    bridge.fault = "connect";
    expect((await gateway.dispatch(started.effects!.workspace)).state).toBe("failed");
    expect((await effect(fx, started.effects!.create)).state).toBe("cancelled");
    expect((await effect(fx, started.effects!.send)).state).toBe("cancelled");
    expect(bridge.calls.filter((args) => args[0] === "run")).toEqual([]);
    expect(await attempt(fx, started.attemptId!)).toMatchObject({ spentAgents: 1, spentTurns: 1 });
  });

  it("a verification mismatch holds the attempt; nothing further is dispatched", async () => {
    const fx = await s04Fixture(), bridge = new FakeCliBridge(), { scope, gateway } = await remoteReady(fx, bridge);
    const started = await startRemote(fx, gateway, scope);
    await gateway.dispatch(started.effects!.workspace);
    await gateway.dispatch(started.effects!.create);
    bridge.tamperInspect = (detail) => { detail.Model = "another-model"; };
    await expect(gateway.verifyWorker(started.attemptId!)).rejects.toMatchObject({ code: "HELD" });
    await expect(gateway.dispatch(started.effects!.send)).rejects.toMatchObject({ code: "HELD" });
    expect((await attempt(fx, started.attemptId!)).state).toBe("reserved");
    expect(bridge.calls.filter((args) => args[0] === "send")).toEqual([]);
  });

  it("an unqualified version pair refuses reservation and writes no attempt", async () => {
    const fx = await s04Fixture(), bridge = new FakeCliBridge(), { scope, gateway } = await remoteReady(fx, bridge, "0.13.0");
    const before = await fx.store.read();
    await expect(startRemote(fx, gateway, scope)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    const after = await fx.store.read();
    expect(after.attempts).toHaveLength(before.attempts.length);
    expect(after.effects).toHaveLength(before.effects.length);
    const fx2 = await s04Fixture(), bridge2 = new FakeCliBridge();
    bridge2.daemonVersion = null;
    const second = await remoteReady(fx2, bridge2);
    await expect(startRemote(fx2, second.gateway, second.scope)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("an oversized brief is refused before reservation, never truncated", async () => {
    const fx = await s04Fixture(), bridge = new FakeCliBridge(), { scope, gateway } = await remoteReady(fx, bridge);
    const big = "x".repeat(28001);
    await writeFile(join(fx.home, "data/r-trial/brief.md"), big);
    const input = { ...await fx.input(scope, { op: "start", plan: scope.planId, node: "r-trial" }),
      briefHash: createHash("sha256").update(big).digest("hex") };
    const before = await fx.store.read();
    await expect(gateway.startWorker(input, await fx.actorFor(scope))).rejects.toThrow(/28000/);
    const after = await fx.store.read();
    expect(after.attempts).toHaveLength(before.attempts.length);
    expect(after.effects).toHaveLength(before.effects.length);
    expect(bridge.calls).toEqual([]);
  });
});
export type { ScopeHandle };
