/** Regression ports of R04's three failing independent probes at 25117c7.
 * Recorder-only writes are omitted. R04-03 waits for B's actual send (bounded by 10 s),
 * while A's controlled lookup and 30 s subject deadline remain pending: no latency claim.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { s04Fixture, captain } from "../test/supervision-s04-fixture";
import { r04Fixture, r04Profile } from "../test/supervision-r04-fixture";
import { processScopeRequests } from "./scope-requests";
import { WorkflowPlanStore } from "./workflow-plans";
import { SupervisionLifecycle } from "./supervision-lifecycle";
import { supervisorSpend } from "./supervisor-sessions";
import { ObservationTimeout } from "./supervision-observation";

describe("R04 independent counterexamples", { timeout: 60000 }, () => {
  it("R04-01: processes a request beyond twenty retained completed requests", async () => {
    const f = await s04Fixture(), scope = await f.addScope(1, "transport-goal", ["work"]);
    const directory = join(f.home, "data/scope-requests"); await mkdir(directory, { recursive: true });
    const ids = Array.from({ length: 21 }, (_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
    for (const id of ids) await writeFile(join(directory, `${id}.json`), JSON.stringify({ id, actor: scope.owner.id, kind: "read",
      input: { scopeId: scope.id, epoch: 1, page: "outbox" } }));
    const handlers = { ...f, legacy: new WorkflowPlanStore(join(f.home, "legacy"), f.home), globalMateId: async () => f.state.globalMate };
    await processScopeRequests(f.home, handlers);
    expect((await readdir(directory)).filter(n => n.endsWith(".reply.json"))).toHaveLength(20);
    await processScopeRequests(f.home, handlers);
    expect((await readdir(directory)).filter(n => n.endsWith(".reply.json"))).toHaveLength(21);
    expect(JSON.parse(await readFile(join(directory, `${ids[20]}.reply.json`), "utf8")).ok).toBe(true);
  });

  it("R04-02: manual replacement reoffers the old pending page before new facts progress", async () => {
    const f = await r04Fixture(), { scope, binding } = await f.owner(1), launched = await f.launch(scope, "work-1");
    const worker = (await f.store.read()).attempts.find(a => a.id === launched.attemptId)!.worker!;
    await f.ingress.permission(worker.agentId, "permission-old-owner");
    const original = await f.lifecycle.wake(scope.id, "event"); expect(original.state).toBe("accepted");
    await f.sessions.hold({ requestId: randomUUID(), scopeId: scope.id, expectedEpoch: 1, reason: "Explicit fixture replacement." }, captain);
    f.receiver.agents.get(binding.agentId)!.status = "closed";
    await f.sessions.prepareReplacement({ requestId: randomUUID(), scopeId: scope.id,
      scopeVersion: (await f.store.read()).scopes.find(s => s.id === scope.id)!.version,
      expectedEpoch: 1, profile: r04Profile, opening: "Resume the existing pending checkpoint." }, captain);
    const replacement = await f.activate(scope.id, 2);
    await f.ingress.permission(worker.agentId, "permission-new-owner");
    let refusal: unknown = null;
    try { await f.lifecycle.wake(scope.id, "restart"); } catch (error) { refusal = error; }
    // Retain the review's positive control only on the broken path; it is not the correction.
    if (refusal) { await f.inbox.reoffer(scope.id, 2); expect((await f.lifecycle.wake(scope.id, "event")).state).toBe("accepted"); }
    expect(f.receiver.sends.at(-1)!.agentId).toBe(replacement.agentId);
    expect(refusal).toBeNull();
    const s = await f.store.read();
    expect(s.inbox.offers.find(o => o.id === original.offerId)!.state).toBe("retired");
    expect(s.inbox.offers.find(o => o.epoch === 2)!.eventIds).toHaveLength(2);
    expect(s.attempts).toHaveLength(1);
  });

  it("R04-03: a pending worker lookup cannot block a different ready owner's recovery wake", async () => {
    const f = await r04Fixture(), a = await f.owner(1), b = await f.owner(2), launched = await f.launch(a.scope, "work-1");
    const worker = (await f.store.read()).attempts.find(x => x.id === launched.attemptId)!.worker!;
    let release!: () => void, entered!: () => void, sent!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; }), atLookup = new Promise<void>(resolve => { entered = resolve; });
    const bSent = new Promise<boolean>(resolve => { sent = () => resolve(true); });
    const originalFind = f.receiver.findAgent.bind(f.receiver), originalSend = f.receiver.send.bind(f.receiver);
    f.receiver.findAgent = async id => { if (id === worker.agentId) { entered(); await barrier; } return originalFind(id); };
    f.receiver.send = async (...args) => { await originalSend(...args); if (args[0] === b.binding.agentId) sent(); };
    const before = f.receiver.sends.length, recovering = f.lifecycle.recover("restart");
    let progressedBeforeRelease = false, timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await atLookup;
      progressedBeforeRelease = await Promise.race([bSent, new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 10_000); })]);
    } finally { clearTimeout(timer); release(); }
    await recovering;
    expect(f.receiver.sends.slice(before).some(s => s.agentId === b.binding.agentId)).toBe(true);
    expect(progressedBeforeRelease).toBe(true);
  });

  it("R04-02: partial handling survives a crash at reoffer publication, without replaying an uncertain worker send", async () => {
    const f = await r04Fixture(), { scope, binding } = await f.owner(1);
    f.receiver.faults.send = ["lose"];
    const launched = await f.launch(scope, "work-1"), before = await f.store.read();
    const worker = before.attempts.find(a => a.id === launched.attemptId)!.worker!;
    const uncertain = before.effects.find(e => e.id === launched.effects!.send)!;
    expect(uncertain.state).toBe("uncertain");
    const first = (await f.ingress.permission(worker.agentId, "handled")).resultIds[0]!;
    const second = (await f.ingress.permission(worker.agentId, "unhandled")).resultIds[0]!;
    const page = await f.lifecycle.wake(scope.id, "event");
    await f.inbox.acknowledge(scope.id, 1, page.offerId!, [first, second]);
    const evidence = (await f.store.read()).inbox.events.find(e => e.id === first)!.envelope.payloadRef.slice(5);
    await f.inbox.handle(scope.id, 1, page.offerId!, [{ eventId: first, result: { kind: "no-action", reason: "Verified handled before replacement.", evidenceIds: [evidence] } }]);
    const handled = (await f.store.read()).inbox.assignments.find(a => a.id === first)!;
    await f.sessions.hold({ requestId: randomUUID(), scopeId: scope.id, expectedEpoch: 1, reason: "Manual replacement." }, captain);
    f.receiver.agents.get(binding.agentId)!.status = "closed";
    await f.sessions.prepareReplacement({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: (await f.store.read()).scopes[0]!.version,
      expectedEpoch: 1, profile: r04Profile, opening: "Resume checkpoint and pending page." }, captain);
    const replacement = await f.activate(scope.id, 2), calls = f.receiver.calls.length;
    f.hooks.boundary = async name => { if (name === "publication:linked") throw Error("fixture crash after reoffer publication"); };
    try { await expect(f.lifecycle.wake(scope.id, "restart")).rejects.toMatchObject({ code: "HELD" }); }
    finally { f.hooks.boundary = null; }
    expect(f.receiver.calls).toHaveLength(calls);
    // The journal publication survived, but its derived checkpoint did not. Recovery first
    // validates the entire history and restores only that index, then the original receipt wins.
    expect((await f.store.read()).freshness).toBe("held");
    await f.store.recoverIndex();
    const committed = await f.store.read();
    expect(committed.freshness).toBe("current");
    expect(committed.inbox.offers.find(o => o.id === page.offerId)!.state).toBe("retired");
    expect(committed.inbox.assignments.find(a => a.id === first)).toEqual(handled);
    const restarted = new SupervisionLifecycle(f.store, f.ingress, f.inbox, f.sessions, f.gateway, { enabled: true });
    const resumed = await restarted.wake(scope.id, "restart"); expect(resumed.state).toBe("accepted");
    const after = await f.store.read(), newPage = after.inbox.offers.find(o => o.id === resumed.offerId)!;
    expect(newPage.eventIds).toEqual([second]); expect(after.inbox.mailboxes[0]!.watermark).toBe(1);
    expect(after.inbox.assignments.find(a => a.id === first)).toEqual(handled);
    expect(after.effects.find(e => e.id === uncertain.id)).toEqual(uncertain);
    expect(after.attempts[0]).toEqual(before.attempts[0]);
    expect(supervisorSpend(after, scope.id)).toMatchObject({ sessions: 2, turns: 4 });
    expect(f.receiver.sends.at(-1)!.agentId).toBe(replacement.agentId);
    await expect(f.inbox.acknowledge(scope.id, 1, page.offerId!, [first, second])).rejects.toMatchObject({ code: "STALE" });
    await f.inbox.acknowledge(scope.id, 2, newPage.id, [second]);
    await f.inbox.handle(scope.id, 2, newPage.id, [{ eventId: second, result: { kind: "no-action", reason: "Verified by replacement.", evidenceIds: [evidence] } }]);
    expect((await f.store.read()).inbox.mailboxes[0]!.watermark).toBe(2);
  });

  it.each(["effect", "native-ingress"] as const)("R04-03: a pending %s read cannot gate another scope", async phase => {
    const f = await r04Fixture(), a = await f.owner(1), b = await f.owner(2);
    let release!: () => void, entered!: () => void, sent!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; }), atRead = new Promise<void>(resolve => { entered = resolve; });
    const bSent = new Promise<boolean>(resolve => { sent = () => resolve(true); });
    const send = f.receiver.send.bind(f.receiver);
    f.receiver.send = async (...args) => { await send(...args); if (args[0] === b.binding.agentId) sent(); };
    let effectId: string | undefined;
    if (phase === "effect") {
      const launched = await f.start(a.scope, "work-1"); await f.gateway.dispatch(launched.effects!.workspace);
      f.receiver.faults.createAgent = ["lose"]; effectId = launched.effects!.create;
      expect((await f.gateway.dispatch(effectId)).state).toBe("uncertain");
      const agentId = (await f.store.read()).effects.find(e => e.id === effectId)!.receiverKey, find = f.receiver.findAgent.bind(f.receiver);
      f.receiver.findAgent = async id => { if (id === agentId) { entered(); await barrier; } return find(id); };
    } else f.ingress.reconcile = async (_paseo, scopeId) => { if (scopeId === a.scope.id) { entered(); await barrier; } };
    const recovering = f.lifecycle.recover("restart", phase === "native-ingress" ? {} as never : undefined);
    let independent = false, timer: ReturnType<typeof setTimeout> | undefined;
    try { await atRead; independent = await Promise.race([bSent, new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 10_000); })]); }
    finally { clearTimeout(timer); release(); }
    await recovering; expect(independent).toBe(true);
    if (effectId) {
      expect((await f.store.read()).effects.find(e => e.id === effectId)!.state).toBe("succeeded");
      expect(f.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(3); // Two owners plus the one original worker.
    }
  });

  it("R04-03: timed-out worker reads stay unknown and reuse the pending lookup on the next pass", async () => {
    const f = await r04Fixture(100), { scope } = await f.owner(1), launched = await f.launch(scope, "work-1");
    const before = await f.store.read(), worker = before.attempts.find(a => a.id === launched.attemptId)!.worker!;
    let release!: () => void, reads = 0;
    const barrier = new Promise<void>(resolve => { release = resolve; }), find = f.receiver.findAgent.bind(f.receiver);
    const pending = barrier.then(() => find(worker.agentId));
    f.receiver.findAgent = id => { if (id === worker.agentId) { reads++; return pending; } return find(id); };
    try {
      for (let i = 0; i < 2; i++) {
        const recovered = await f.lifecycle.recover("heartbeat");
        expect(recovered.observations[0]).toMatchObject({ agentId: worker.agentId, observed: "not visible (unknown, not absent)", ownerReview: false });
      }
      expect(reads).toBe(1);
      const after = await f.store.read(); expect(after.attempts).toEqual(before.attempts); expect(after.effects).toEqual(before.effects);
      expect(after.inbox.sources.some(s => s.agentId === worker.agentId && s.gaps.includes("fetch-failed"))).toBe(true);
    } finally { release(); await pending; }
  });

  it("R04-03: a late effect receipt after the read deadline retains its original intent and spend", async () => {
    const f = await r04Fixture(100), { scope } = await f.owner(1), launched = await f.start(scope, "work-1");
    await f.gateway.dispatch(launched.effects!.workspace); f.receiver.faults.createAgent = ["lose"];
    const uncertain = await f.gateway.dispatch(launched.effects!.create), before = await f.store.read();
    let release!: () => void, reads = 0;
    const barrier = new Promise<void>(resolve => { release = resolve; }), find = f.receiver.findAgent.bind(f.receiver);
    const pending = barrier.then(() => find(uncertain.receiverKey!));
    f.receiver.findAgent = id => { if (id === uncertain.receiverKey) { reads++; return pending; } return find(id); };
    const reconcile = f.gateway.reconcile.bind(f.gateway); let original: Promise<Awaited<ReturnType<typeof reconcile>>> | undefined;
    f.gateway.reconcile = id => { original = reconcile(id); return original; };
    try {
      for (let i = 0; i < 2; i++) {
        const result = await f.lifecycle.recover("restart");
        expect(result.effects[0]).toMatchObject({ status: "rejected", reason: expect.any(ObservationTimeout) });
      }
      expect(reads).toBe(1); expect((await f.store.read()).effects.find(e => e.id === uncertain.id)).toEqual(uncertain);
    } finally { release(); await original; }
    const after = await f.store.read(); expect(after.effects.find(e => e.id === uncertain.id)).toMatchObject({ state: "succeeded", receiverKey: uncertain.receiverKey });
    expect(after.attempts).toEqual(before.attempts); expect(f.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(2);
  });
});
