import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { s04Fixture, planDefinition, captain, type ScopeHandle } from "../test/supervision-s04-fixture";
import { activationEffects, supervisorSpend } from "./supervisor-sessions";
import { continuationInputVersion, deriveContinuation, goalStatus } from "./supervision-continuation";
import { SupervisionEvents } from "./supervision-events";
import { SupervisionInbox } from "./supervision-inbox";
import { SupervisionLifecycle, registerSupervisionLifecycle } from "./supervision-lifecycle";
import { handleScopeRequest, scopeRoute, legacyRoute } from "./scope-requests";
import { WorkflowPlanStore, planSubjectHash } from "./workflow-plans";
import { SupervisionStore } from "./supervision-store";

async function integrated() {
  const fx = await s04Fixture(), ingress = new SupervisionEvents(fx.store), inbox = new SupervisionInbox(fx.store, { offers: true });
  const lifecycle = new SupervisionLifecycle(fx.store, ingress, inbox, fx.sessions, fx.gateway, { enabled: true });
  async function owner(n: number, nodes: string[]) {
    const scope = await fx.addScope(n, `goal-${n}`, nodes, false);
    await fx.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1,
      profile: { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" }, opening: "Read the scoped checkpoint; no global mate role." }, captain);
    const effects = activationEffects(await fx.store.read(), scope.id, 1);
    await fx.gateway.dispatch(effects.workspace!.id); await fx.gateway.dispatch(effects.create!.id);
    const binding = await fx.sessions.verify(scope.id, 1); await fx.gateway.dispatch(effects.send!.id);
    fx.receiver.finish(binding.agentId);
    await fx.draft(scope, nodes.map(id => ({ id })), true);
    return { scope, binding };
  }
  async function finish(scope: ScopeHandle, node: string) {
    const started = await fx.launch(scope, node), worker = (await fx.store.read()).attempts.find(a => a.id === started.attemptId)!.worker!;
    fx.receiver.finish(worker.agentId);
    const admitted = await ingress.permission(worker.agentId, `request-${node}`);
    return { started, worker, eventId: admitted.resultIds[0]! };
  }
  return { ...fx, ingress, inbox, lifecycle, owner, finish };
}
type Fixture = Awaited<ReturnType<typeof integrated>>;
async function acknowledge(f: Fixture, scope: ScopeHandle, offerId: string, actor?: string) {
  const s = await f.store.read(), page = s.inbox.offers.find(o => o.id === offerId)!;
  const legacy = new WorkflowPlanStore(join(f.home, "legacy"), f.home);
  const handlers = { ...f, legacy, globalMateId: async () => f.state.globalMate };
  const owner = actor ?? (await f.actorFor(scope)).id;
  const ack = await handleScopeRequest({ id: randomUUID(), actor: owner, kind: "inbox", input: { op: "ack", requestId: randomUUID(),
    scopeId: scope.id, epoch: 1, offerId, eventIds: page.eventIds } }, handlers);
  return { handlers, owner, page, ack };
}

describe("S04 with landed S02 mailboxes (isolated synthetic receiver)", { timeout: 60000 }, () => {
  it("defaults off before reading/writing or attaching hooks; all components share one store", async () => {
    const f = await integrated(), disabled = new SupervisionLifecycle(f.store, f.ingress, f.inbox, f.sessions, f.gateway);
    const before = await f.files(), on = vi.fn();
    await expect(disabled.wake(randomUUID(), "heartbeat")).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(() => registerSupervisionLifecycle({ on } as never, disabled)).toThrow(/disabled/);
    expect(on).not.toHaveBeenCalled(); expect(await f.files()).toEqual(before); expect(f.receiver.calls).toEqual([]);
    expect(() => new SupervisionLifecycle(new SupervisionStore(join(f.home, "other"), f.home), f.ingress, f.inbox, f.sessions, f.gateway)).toThrow(/one authority store/);
    const callbacks = new Map<string, (event: never, context: never) => Promise<void>>(), remove = vi.fn();
    const dispose = registerSupervisionLifecycle({ on: (name: string, handler: (event: never, context: never) => Promise<void>) => { callbacks.set(name, handler); return remove; } } as never, f.lifecycle);
    await callbacks.get("agent.turn_ended")!({ agent: { id: "general" } } as never, { paseo: {} } as never);
    expect(await f.files()).toEqual(before); expect(f.receiver.calls).toEqual([]); dispose(); expect(remove).toHaveBeenCalledTimes(3);
  });

  it("two scopes progress independently while General is busy; triggers and own status writes coalesce", async () => {
    const f = await integrated(), a = await f.owner(1, ["a", "aa"]), b = await f.owner(2, ["b"]);
    const version = continuationInputVersion(await f.store.read(), a.scope.id, a.scope.planId), before = f.receiver.sends.length;
    const wakes = await Promise.all([f.lifecycle.wake(a.scope.id, "event"), f.lifecycle.wake(b.scope.id, "heartbeat"), f.lifecycle.wake(a.scope.id, "turn-end")]);
    expect(wakes.slice(0, 2).map(w => w.state)).toEqual(["accepted", "accepted"]);
    expect(f.receiver.sends.slice(before).map(s => s.agentId).sort()).toEqual([a.binding.agentId, b.binding.agentId].sort());
    expect(continuationInputVersion(await f.store.read(), a.scope.id, a.scope.planId)).toBe(version);
    f.receiver.finish(a.binding.agentId);
    expect((await f.lifecycle.wake(a.scope.id, "restart")).state).toBe("awaiting-owner");
    const due = deriveContinuation(await f.store.read(), a.scope.id, a.scope.planId);
    expect(due.nextNodes).toEqual(["a", "aa"]); expect(due.due).toBe(true);
    for (const node of due.nextNodes) await f.launch(a.scope, node);
    expect(goalStatus(await f.store.read()).goals.find(g => g.scopeId === a.scope.id)!.activeWorkers).toBe(2);
    expect(f.receiver.sends.some(s => s.agentId === f.state.globalMate)).toBe(false);
  });

  it("commits page uncertainty and counted effect together; only exact owner acknowledgement/results advance the watermark", async () => {
    const f = await integrated(), { scope, binding } = await f.owner(1, ["trial"]), { eventId } = await f.finish(scope, "trial");
    const inputVersion = continuationInputVersion(await f.store.read(), scope.id, scope.planId);
    f.receiver.afterAdmission = () => {}; // Receiver checks below read the already committed claim.
    const send = f.receiver.send.bind(f.receiver);
    f.receiver.send = async (...args) => {
      const s = await f.store.read();
      expect(s.inbox.offers[0]).toMatchObject({ state: "uncertain", sends: 1 });
      expect(s.effects.filter(e => e.attemptId === null && e.operation === "agent.send")).toHaveLength(2);
      expect(s.effects.find(e => e.receiverKey === args[2])!.state).toBe("dispatching");
      await send(...args);
    };
    const wake = await f.lifecycle.wake(scope.id, "event"); expect(wake.state).toBe("accepted");
    expect((await f.store.read()).inbox.mailboxes[0]!.watermark).toBe(0);
    await expect(acknowledge(f, scope, wake.offerId!, "neighbor")).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
    const { handlers, owner, page } = await acknowledge(f, scope, wake.offerId!);
    const readBefore = await f.files(), readPage = await handleScopeRequest({ id: randomUUID(), actor: owner, kind: "read",
      input: { scopeId: scope.id, epoch: 1, page: "outbox", after: 0 } }, handlers) as { entries: unknown[] };
    expect(readPage.entries.length).toBeGreaterThan(0); expect(await f.files()).toEqual(readBefore);
    const s = await f.store.read(), evidence = s.inbox.events.find(e => e.id === eventId)!.envelope.payloadRef.slice(5);
    await handleScopeRequest({ id: randomUUID(), actor: owner, kind: "inbox", input: { op: "handle", requestId: randomUUID(), scopeId: scope.id,
      epoch: 1, offerId: page.id, results: [{ eventId, result: { kind: "no-action", reason: "Inspected exact request; recorded separately, outcome remains unresolved.", evidenceIds: [evidence] } }] } }, handlers);
    expect((await f.store.read()).inbox.mailboxes[0]!.watermark).toBe(1);
    const outbox = (await f.store.read()).outbox[0]!;
    const handled = await f.run(scope, { op: "ack", plan: scope.planId, kind: "handled", ids: [outbox.id] });
    await handleScopeRequest({ id: randomUUID(), actor: owner, kind: "outbox", input: { requestId: randomUUID(), scopeId: scope.id, epoch: 1,
      scopeVersion: (await f.store.read()).scopes.find(s => s.id === scope.id)!.version, outboxId: outbox.id, resultRef: `command:${handled.receipt.requestId}` } }, handlers);
    expect((await f.store.read()).outbox.find(o => o.id === outbox.id)!.state).toBe("handled");
    expect(continuationInputVersion(await f.store.read(), scope.id, scope.planId)).toBe(inputVersion);
    expect(supervisorSpend(await f.store.read(), scope.id).turns).toBe(2);
    expect(f.receiver.sends.at(-1)!.agentId).toBe(binding.agentId);
  });

  it("lost owner-send acknowledgement survives restart with one send, original offer and retained spend", async () => {
    const f = await integrated(), { scope } = await f.owner(1, ["lost"]); await f.finish(scope, "lost");
    f.receiver.faults.send = ["lose"];
    const wake = await f.lifecycle.wake(scope.id, "event"), sends = f.receiver.sends.length;
    expect(wake.state).toBe("uncertain");
    const restarted = new SupervisionLifecycle(f.store, f.ingress, f.inbox, f.sessions, f.gateway, { enabled: true });
    expect((await restarted.wake(scope.id, "restart")).state).toBe("uncertain");
    expect((await restarted.wake(scope.id, "heartbeat")).effectId).toBe(wake.effectId);
    expect(f.receiver.sends).toHaveLength(sends); expect(supervisorSpend(await f.store.read(), scope.id)).toMatchObject({ turns: 2, uncertain: 1 });
    await acknowledge(f, scope, wake.offerId!); // Actual owner receipt may acknowledge an uncertain transport.
    expect((await f.store.read()).inbox.offers[0]!.state).toBe("acknowledged");
    expect((await restarted.wake(scope.id, "turn-end")).state).toBe("uncertain"); // Ack is not an imperative send receipt.
  });

  it("lost worker callback is recovered through S02 facts; idle/status prose never finishes the goal", async () => {
    const f = await integrated(), { scope, binding } = await f.owner(1, ["work"]), started = await f.launch(scope, "work");
    const worker = (await f.store.read()).attempts.find(a => a.id === started.attemptId)!.worker!;
    f.receiver.finish(worker.agentId);
    const recovered = await f.lifecycle.recover("heartbeat");
    expect(recovered.observations).toEqual([{ attemptId: started.attemptId, agentId: worker.agentId, observed: "idle", ownerReview: true }]);
    expect(recovered.wakes[0]).toMatchObject({ status: "fulfilled", value: { state: "accepted" } });
    expect((await f.store.read()).plans[0]!.plan.nodes.work!.state).toBe("starting");
    expect(f.receiver.sends.at(-1)!.agentId).toBe(binding.agentId);
    const count = f.receiver.sends.length;
    await f.lifecycle.recover("restart"); expect(f.receiver.sends).toHaveLength(count);
  });

  it("definite model capacity refusal keeps the obligation, counted turn and failure; unchanged heartbeat never retries", async () => {
    const f = await integrated(), { scope } = await f.owner(1, ["capacity"]);
    f.receiver.faults.send = ["capacity"];
    const first = await f.lifecycle.wake(scope.id, "event"), calls = f.receiver.calls.length;
    expect(first).toMatchObject({ state: "held", reason: expect.stringContaining("capacity") });
    const next = await f.lifecycle.wake(scope.id, "heartbeat"); expect(next.effectId).toBe(first.effectId);
    expect(f.receiver.calls).toHaveLength(calls); expect(supervisorSpend(await f.store.read(), scope.id).turns).toBe(2);
    expect(deriveContinuation(await f.store.read(), scope.id, scope.planId)).toMatchObject({ due: true, derived: "ready-action" });
    expect(goalStatus(await f.store.read()).goals[0]!.lastSupervisorFailure).toMatchObject({ effectId: first.effectId, reason: expect.stringContaining("capacity") });
  });

  it("a crash after reservation resumes the original effect once; another cause cannot reserve a concurrent owner turn", async () => {
    const f = await integrated(), { scope } = await f.owner(1, ["crash"]); await f.finish(scope, "crash");
    const dispatch = vi.spyOn(f.gateway, "dispatch").mockRejectedValueOnce(new Error("fixture crash before dispatch"));
    await expect(f.lifecycle.wake(scope.id, "event")).rejects.toThrow("fixture crash before dispatch");
    dispatch.mockRestore();
    const before = await f.store.read(), offered = before.inbox.offers[0]!;
    expect(offered.state).toBe("uncertain"); expect(supervisorSpend(before, scope.id).turns).toBe(2);
    await expect(f.sessions.reserveTurn({ requestId: randomUUID(), scopeId: scope.id, epoch: 1, causation: "another-cause", text: "Duplicate pass" }, captain)).rejects.toMatchObject({ code: "HELD" });
    const sends = f.receiver.sends.length, resumed = await f.lifecycle.wake(scope.id, "restart");
    expect(resumed).toMatchObject({ state: "accepted", offerId: offered.id }); expect(f.receiver.sends).toHaveLength(sends + 1);
    expect(supervisorSpend(await f.store.read(), scope.id).turns).toBe(2);
  });

  it("a slow scope send releases the publication lock before the native call; another owner progresses", async () => {
    const f = await integrated(), a = await f.owner(1, ["slow"]), b = await f.owner(2, ["independent"]);
    let release!: () => void, entered!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const send = f.receiver.send.bind(f.receiver);
    f.receiver.send = async (...args) => { await send(...args); if (args[0] === a.binding.agentId) { entered(); await wait; } };
    const slow = f.lifecycle.wake(a.scope.id, "event");
    try {
      await started;
      expect((await f.lifecycle.wake(b.scope.id, "event")).state).toBe("accepted");
      expect((await f.store.read()).effects.some(e => e.scopeId === a.scope.id && e.state === "dispatching")).toBe(true);
    } finally { release(); await slow; }
  });

  it("paused scope retains unoffered facts and zero-worker unfinished goals remain discoverable", async () => {
    const f = await integrated(), { scope } = await f.owner(1, ["done"]);
    await f.launch(scope, "done"); await f.record(scope, "done", "done");
    expect(deriveContinuation(await f.store.read(), scope.id, scope.planId)).toMatchObject({ disposition: "needs-planning", activeWorkers: 0, due: true });
    expect((await f.lifecycle.recover("heartbeat")).wakes[0]).toMatchObject({ status: "fulfilled", value: { state: "accepted" } });
    const p = (await f.store.read()).plans[0]!.plan;
    await f.run(scope, { op: "captain", plan: scope.planId, revision: p.revision, subjectHash: planSubjectHash(p), action: "hold", text: "Explicit pause in fixture." }, captain);
    const calls = f.receiver.calls.length;
    expect((await f.lifecycle.wake(scope.id, "heartbeat")).state).toBe("held");
    expect(f.receiver.calls).toHaveLength(calls);
  });

  it("routes against task ownership as well as plan name, including automatic one-run attempts", async () => {
    const f = await integrated(), { scope } = await f.owner(1, ["owned"]);
    const plan = (await f.store.read()).plans[0]!.plan, launch = plan.definition.nodes.flatMap(n => n.kind === "run" ? [n.launch] : [])[0]!;
    const implicit = { op: "implicit" as const, launch };
    await expect(legacyRoute(f.store, implicit)).rejects.toThrow(/scoped supervisor/);
    const legacy = new WorkflowPlanStore(join(f.home, "legacy"), f.home);
    const definition = { ...plan.definition, id: "legacy-name" };
    await legacy.execute({ op: "draft", definition }, randomUUID(), "mate");
    await expect(scopeRoute(legacy, scope.planId, implicit)).rejects.toThrow(/legacy first mate/);
    const guarded = new WorkflowPlanStore(join(f.home, "guarded"), f.home, command => legacyRoute(f.store, command));
    await expect(guarded.execute(implicit, randomUUID(), "mate")).rejects.toThrow(/scoped supervisor/);
    expect(await guarded.get("owned")).toBeNull();
  });

  it("remote ownership can be observed but S04 cannot reserve a remote lifecycle effect", async () => {
    const f = await s04Fixture(), scope = await f.addScope(1, "remote-plan", ["remote-node"], true, "remote-host");
    const definition = planDefinition(scope.planId, scope.project, [{ id: "remote-node" }]);
    for (const node of definition.nodes) if (node.kind === "run") node.launch.host = "remote-host";
    await f.run(scope, { op: "draft", definition });
    const p = (await f.store.read()).plans[0]!.plan;
    if (p.status === "review") await f.run(scope, { op: "captain", plan: scope.planId, revision: p.revision, subjectHash: planSubjectHash(p), action: "approve", text: "Fixture approval." }, captain);
    const before = await f.store.read();
    await expect(f.start(scope, "remote-node")).rejects.toMatchObject({ code: "UNSUPPORTED" });
    const after = await f.store.read();
    expect(after.sequence).toBe(before.sequence); expect(after.attempts).toEqual([]); expect(after.effects).toEqual([]); expect(f.receiver.calls).toEqual([]);
  });
});
