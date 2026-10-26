import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SupervisionActor } from "../shared/supervision";
import { activationEffects, supervisorSpend } from "./supervisor-sessions";
import { deriveContinuation, recordContinuation } from "./supervision-continuation";
import { captain, s04Fixture, type S04Fixture, type ScopeHandle } from "../test/supervision-s04-fixture";

const profile = { provider: "claude/opus-5.5", modeId: "default", thinkingOptionId: "high" };
async function dormant(fx: S04Fixture, n = 1) { return fx.addScope(n, `plan-${n}`, [`n${n}-trial`], false); }
async function reserve(fx: S04Fixture, scope: ScopeHandle, opening = "You supervise this plan. Read its checkpoint.") {
  const version = (await fx.store.read()).scopes.find(s => s.id === scope.id)!.version;
  await fx.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: version, profile, opening }, captain);
  const s = await fx.store.read(), binding = s.bindings.find(b => b.scopeId === scope.id)!;
  return { binding, effects: activationEffects(s, scope.id, binding.epoch) };
}
async function activate(fx: S04Fixture, scope: ScopeHandle) {
  const { binding, effects } = await reserve(fx, scope);
  await fx.gateway.dispatch(effects.workspace!.id); await fx.gateway.dispatch(effects.create!.id);
  await fx.sessions.verify(scope.id, binding.epoch); await fx.gateway.dispatch(effects.send!.id);
  return { binding, effects };
}

describe("S04 supervisor lifecycle (synthetic receiver)", { timeout: 60000 }, () => {
  it("reserved/unprompted -> verified -> active -> send, with the opening last", async () => {
    const fx = await s04Fixture(), scope = await dormant(fx), { binding, effects } = await reserve(fx, scope);
    let s = await fx.store.read();
    expect(binding).toMatchObject({ epoch: 1, state: "prepared", workspaceId: null, workspaceIntent: `ws-${effects.workspace!.id}` });
    expect(s.scopes.find(x => x.id === scope.id)!.state).toBe("transferring");
    await fx.gateway.dispatch(effects.workspace!.id); await fx.gateway.dispatch(effects.create!.id);
    await expect(fx.gateway.dispatch(effects.send!.id)).rejects.toMatchObject({ code: "HELD" }); // No opening before activation.
    const created = fx.receiver.agents.get(binding.agentId)!;
    expect(created.labels).toMatchObject({ "firstmate.role": "plan-supervisor", "firstmate.scope": scope.id, "firstmate.epoch": "1" });
    expect(created.labels["paseo.parent-agent-id"]).toBeUndefined();
    expect(await fx.sessions.verify(scope.id, 1)).toMatchObject({ state: "active", agentId: binding.agentId, workspaceId: created.workspaceId, workspaceIntent: binding.workspaceIntent });
    s = await fx.store.read();
    expect(s.scopes.find(x => x.id === scope.id)!.state).toBe("active");
    await fx.gateway.dispatch(effects.send!.id);
    expect(fx.receiver.calls.map(c => c.op)).toEqual(["openWorkspace", "createAgent", "send"]);
    expect(fx.receiver.sends[0]).toMatchObject({ agentId: binding.agentId, text: "You supervise this plan. Read its checkpoint." });
    expect(supervisorSpend(await fx.store.read(), scope.id)).toEqual({ sessions: 1, turns: 1, uncertain: 0 });
  });

  it("a lost create reply cannot produce a second supervisor; restart reconciles the same reserved identity (A10)", async () => {
    const fx = await s04Fixture(), scope = await dormant(fx), { binding, effects } = await reserve(fx, scope);
    await fx.gateway.dispatch(effects.workspace!.id);
    fx.receiver.faults.createAgent = ["hide"];
    expect((await fx.gateway.dispatch(effects.create!.id)).state).toBe("uncertain");
    const version = (await fx.store.read()).scopes.find(s => s.id === scope.id)!.version;
    await expect(fx.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: version, profile, opening: "again" }, captain)).rejects.toMatchObject({ code: "HELD" });
    await expect(fx.sessions.verify(scope.id, 1)).rejects.toMatchObject({ code: "HELD" });
    fx.receiver.reveal(binding.agentId);
    expect((await fx.gateway.reconcile(effects.create!.id)).state).toBe("succeeded");
    await fx.sessions.verify(scope.id, 1);
    expect(fx.receiver.agents.size).toBe(1);
  });

  it("never lets a scope supervisor be the global first mate", async () => {
    const fx = await s04Fixture(), scope = await dormant(fx), { binding, effects } = await reserve(fx, scope);
    await fx.gateway.dispatch(effects.workspace!.id); await fx.gateway.dispatch(effects.create!.id);
    fx.state.globalMate = binding.agentId;
    await expect(fx.sessions.verify(scope.id, 1)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await fx.store.read()).bindings[0]!.state).toBe("prepared");
  });

  it("agents cannot activate scopes, and a prepared binding is not an owner", async () => {
    const fx = await s04Fixture(), scope = await dormant(fx);
    await expect(fx.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1, profile, opening: "x" }, { kind: "agent", id: "general-first-mate", source: "x" })).rejects.toMatchObject({ code: "UNSUPPORTED" });
    const { binding } = await reserve(fx, scope);
    await expect(fx.draft({ ...scope, owner: { kind: "agent", id: binding.agentId, source: "x" } }, [{ id: "n1-trial" }])).rejects.toMatchObject({ code: "HELD" });
  });

  it("supervisor budget is separate, counted at reservation and never refunded by failure (A20)", async () => {
    const fx = await s04Fixture({ limits: { supervisorSessions: 1, supervisorTurns: 2 } }), scope = await dormant(fx);
    const { binding, effects } = await reserve(fx, scope);
    await fx.gateway.dispatch(effects.workspace!.id); await fx.gateway.dispatch(effects.create!.id); await fx.sessions.verify(scope.id, 1);
    fx.receiver.faults.send = ["capacity"];
    expect((await fx.gateway.dispatch(effects.send!.id)).state).toBe("failed"); // Capacity: no paid fallback profile, no second session.
    expect(supervisorSpend(await fx.store.read(), scope.id)).toMatchObject({ sessions: 1, turns: 1 });
    const turn = await fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: scope.id, epoch: 1, causation: "offer:1", text: "Two new facts." }, captain);
    fx.receiver.faults.send = ["lose"];
    expect((await fx.gateway.dispatch(turn)).state).toBe("uncertain");
    await expect(fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: scope.id, epoch: 1, causation: "offer:2", text: "More." }, captain)).rejects.toMatchObject({ code: "HELD" });
    expect(supervisorSpend(await fx.store.read(), scope.id)).toEqual({ sessions: 1, turns: 2, uncertain: 1 });
    expect(fx.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(1);
    expect(binding.agentId).toBe(fx.receiver.calls[1]!.target);
  });

  it("manual transfer: explicit hold, no takeover until the old actor is shown stopped, old epoch loses authority (A01/A10/A14)", async () => {
    const fx = await s04Fixture(), scope = await dormant(fx), { binding } = await activate(fx, scope);
    const old: SupervisionActor = { kind: "agent", id: binding.agentId, source: "scope-helper" };
    await fx.draft({ ...scope, owner: old }, [{ id: "n1-trial" }]);
    const before = deriveContinuation(await fx.store.read(), scope.id, scope.planId);
    await expect(fx.sessions.hold({ requestId: randomUUID(), scopeId: scope.id, expectedEpoch: 1, reason: "x" }, old)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await fx.sessions.hold({ requestId: randomUUID(), scopeId: scope.id, expectedEpoch: 1, reason: "Captain replaces the supervisor." }, captain);
    const version = () => fx.store.read().then(s => s.scopes.find(x => x.id === scope.id)!.version);
    const replace = async () => fx.sessions.prepareReplacement({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: await version(), expectedEpoch: 1, profile, opening: "Take over from the checkpoint." }, captain);
    await expect(replace()).rejects.toThrow(/not shown stopped/); // Idle is not stopped; no lease/timeout takeover.
    fx.receiver.agents.get(binding.agentId)!.archivedAt = "2026-10-26T12:00:00.000Z"; // The captain retired it separately.
    await replace();
    const s = await fx.store.read(), next = s.bindings.find(b => b.scopeId === scope.id)!;
    expect(next).toMatchObject({ epoch: 2, state: "prepared" }); expect(next.agentId).not.toBe(binding.agentId);
    // The old epoch cannot mutate through the gateway or the checked commands.
    const oldStart = { ...await fx.input(scope, { op: "start", plan: scope.planId, node: "n1-trial" }), epoch: 1 };
    await expect(fx.commands.planCommand(oldStart, old)).rejects.toMatchObject({ code: "STALE" });
    await expect(fx.gateway.startWorker({ ...oldStart, requestId: randomUUID() }, old)).rejects.toMatchObject({ code: "STALE" });
    await expect(recordContinuation(fx.store, { requestId: randomUUID(), scopeId: scope.id, planId: scope.planId, epoch: 1, inputVersion: before.inputVersion,
      disposition: "blocked", reason: "stale", waits: [{ kind: "prerequisite", id: "x", detail: "x", until: new Date(Date.now() + 3600_000).toISOString() }], completion: null }, old, true)).rejects.toMatchObject({ code: "STALE" });
    const effects = activationEffects(s, scope.id, 2);
    await fx.gateway.dispatch(effects.workspace!.id); await fx.gateway.dispatch(effects.create!.id); await fx.sessions.verify(scope.id, 2);
    await expect(fx.run(scope, { op: "start", plan: scope.planId, node: "n1-trial" }, old)).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
    const after = deriveContinuation(await fx.store.read(), scope.id, scope.planId);
    expect(after).toMatchObject({ derived: "ready-action", nextNodes: ["n1-trial"], due: true, owner: { epoch: 2, state: "active" } });
    expect(supervisorSpend(await fx.store.read(), scope.id).sessions).toBe(2); // Replacement adds spend explicitly.
  });
});
