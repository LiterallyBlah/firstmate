import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { s04Fixture, captain } from "../test/supervision-s04-fixture";
import { activationEffects, SupervisorSessions, supervisorSpend } from "./supervisor-sessions";
import { SupervisorControls } from "./supervisor-controls";
import { supervisorList } from "./supervisor-configuration";
import { SupervisionStore } from "./supervision-store";
import { digest } from "./submissions";
import { expected } from "../test/supervision-fixture";
const profile = { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" };
const catalog = [{ provider: profile.provider, label: "Sol", modes: [{ id: "full-access", label: "Full access" }], thinking: [{ id: "high", label: "High" }, { id: "xhigh", label: "Extra high" }] }];
async function fixture(cap = 3) {
  const fx = await s04Fixture({ limits: { supervisorSessions: cap, supervisorTurns: 10 } }), scope = await fx.addScope(1, "trial", ["build"], false);
  const sessions = new SupervisorSessions(fx.store, fx.gateway, fx.receiver, { enabled: true, unverifiedUiAttach: true, limits: { supervisorSessions: cap, supervisorTurns: 10 }, globalMateId: async () => "general" });
  await sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1, profile, opening: "Original checkpoint" }, captain);
  const effects = activationEffects(await fx.store.read(), scope.id, 1);
  await fx.gateway.dispatch(effects.workspace!.id); await fx.gateway.dispatch(effects.create!.id); await sessions.verify(scope.id, 1); await fx.gateway.dispatch(effects.send!.id);
  fx.receiver.agents.get((await fx.store.read()).bindings[0]!.agentId)!.status = "idle";
  const state = { catalog, policy: "a".repeat(64) };
  const controls = new SupervisorControls(fx.store, sessions, fx.gateway, fx.receiver, { enabled: true, catalog: async () => state.catalog,
    policyDigest: async () => state.policy, validate: async () => {}, limits: () => ({ supervisorSessions: cap, supervisorTurns: 10 }) });
  const base = () => fx.store.read().then(s => ({ requestId: randomUUID(), homeId: s.homeId, scopeId: scope.id, expectedEpoch: s.bindings[0]!.epoch, bindingDigest: digest(s.bindings[0]) }));
  async function stage() { const input = { ...await base(), profile: { ...profile, thinkingOptionId: "xhigh" }, limits: { supervisorSessions: cap, supervisorTurns: 10 }, policyDigest: state.policy };
    await controls.stageFromUnverifiedUi(input); return input; }
  const replacement = async () => ({ ...await base(), expectedControlId: controls.read(await fx.store.read(), scope.id).controlId!, opening: "Use retained checkpoint; preserve all work." });
  return { ...fx, sessions, controls, scope, state, base, stage, replacement };
}
describe("Supervisor foundation checked app lifecycle", { timeout: 60000 }, () => {
  it("lists each bound Supervisor from stored truth alone: no native call, no write, no unbound scope", async () => {
    const fx = await fixture(), unbound = await fx.addScope(2, "other", ["build"], false);
    const before = await fx.store.read(), calls = fx.receiver.calls.length, binding = before.bindings[0]!;
    const rows = supervisorList(before, () => ({ supervisorSessions: 3, supervisorTurns: 10 }));
    expect(rows).toEqual([{ scopeId: fx.scope.id, kind: "plan", title: expect.any(String), planId: null, state: "active", agentId: binding.agentId, epoch: 1,
      profile: { provider: profile.provider, modeId: profile.modeId, thinkingOptionId: profile.thinkingOptionId }, sessions: 1, turns: 1,
      limits: { supervisorSessions: 3, supervisorTurns: 10 }, lastFailure: null }]);
    expect(rows.some(r => r.scopeId === unbound.id)).toBe(false);
    await fx.stage();
    expect(supervisorList(await fx.store.read(), () => null)).toEqual([expect.objectContaining({ state: "change-pending", limits: null,
      profile: { provider: profile.provider, modeId: profile.modeId, thinkingOptionId: "high" } })]);
    expect(fx.receiver.calls.length).toBe(calls);
  });
  it("a claimed send finishes under its original generation after a proposal; no interruption or reinterpretation", async () => {
    const fx = await fixture(), old = (await fx.store.read()).bindings[0]!;
    const turn = await fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: fx.scope.id, epoch: 1, causation: "claimed", text: "Original profile input" }, captain);
    let release!: () => void, entered!: () => void;
    fx.receiver.gate = new Promise<void>(r => { release = r; });
    const admitted = new Promise<void>(r => { entered = r; }); fx.receiver.afterAdmission = () => entered();
    const dispatch = fx.gateway.dispatch(turn); await admitted;
    try {
      await fx.stage(); expect((await fx.store.read()).effects.find(e => e.id === turn)?.state).toBe("dispatching");
      expect(fx.receiver.agents.get(old.agentId)!.thinkingOptionId).toBe("high");
      expect(fx.receiver.calls.some(c => c.op === "interrupt")).toBe(false);
    } finally { release(); fx.receiver.gate = null; fx.receiver.afterAdmission = null; }
    expect((await dispatch).state).toBe("succeeded");
    expect(fx.controls.read(await fx.store.read(), fx.scope.id).state).toBe("change-pending");
    expect(supervisorSpend(await fx.store.read(), fx.scope.id)).toEqual({ sessions: 1, turns: 2, uncertain: 0 });
  });
  it("a binding cannot name a missing configuration generation; legacy bindings remain compatible", async () => {
    const fx = await s04Fixture(), scope = await fx.addScope(1, "trial", ["build"], false);
    const mutations = [{ kind: "binding" as const, value: { scopeId: scope.id, epoch: 1, hostId: "local", agentId: "missing-generation", workspaceId: "workspace",
      profileDigest: "a".repeat(64), checkpointHash: "a".repeat(64), configurationId: randomUUID(), state: "prepared" as const, acknowledgedSeq: 0, heartbeatDue: null } }];
    await expect(fx.store.transact(expected(mutations), randomUUID(), mutations)).rejects.toMatchObject({ code: "HELD" });
    expect((await fx.store.read()).bindings).toEqual([]); expect(fx.receiver.calls).toEqual([]);
  });
  it("exact stopped predecessor produces one next epoch and opening; accepted replay keeps distinct launch operations and generation", async () => {
    const fx = await fixture(), old = (await fx.store.read()).bindings[0]!; await fx.stage();
    const input = await fx.replacement(); await expect(fx.controls.replaceFromUnverifiedUi(input)).rejects.toMatchObject({ code: "HELD" });
    expect(fx.receiver.agents.size).toBe(1); fx.receiver.agents.get(old.agentId)!.status = "closed";
    await fx.controls.replaceFromUnverifiedUi(input); const status = await fx.store.read(), next = status.bindings[0]!;
    expect(next).toMatchObject({ epoch: 2, state: "active", configurationId: input.expectedControlId });
    expect(next.agentId).not.toBe(old.agentId); expect(await fx.gateway.profile(next.profileDigest)).toMatchObject({ thinkingOptionId: "xhigh" });
    expect(fx.receiver.calls.map(c => c.op)).toEqual(["openWorkspace", "createAgent", "send", "openWorkspace", "createAgent", "send"]);
    expect(supervisorSpend(status, fx.scope.id)).toEqual({ sessions: 2, turns: 2, uncertain: 0 });
    expect(status.effects.filter(e => e.epoch === 1).every(e => !e.configurationId)).toBe(true);
    expect(status.effects.filter(e => e.epoch === 2).every(e => e.configurationId === input.expectedControlId)).toBe(true);
    await fx.controls.replaceFromUnverifiedUi(input); expect(fx.receiver.agents.size).toBe(2); expect(fx.receiver.sends).toHaveLength(2);
    await expect(fx.controls.replaceFromUnverifiedUi({ ...input, opening: "Different" })).rejects.toMatchObject({ code: "CONFLICT" });
    const turn = await fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: fx.scope.id, epoch: 2, causation: "new-event", text: "A new checked event" }, captain);
    expect((await fx.store.read()).effects.find(e => e.id === turn)?.configurationId).toBe(input.expectedControlId);
    fx.receiver.agents.get(next.agentId)!.status = "idle";
    await fx.gateway.dispatch(turn); expect(fx.receiver.sends).toHaveLength(3);
    const reread = await new SupervisionStore(join(fx.home, "store"), fx.home).read(); expect(reread.problems).toEqual([]);
    expect(fx.controls.read(reread, fx.scope.id).configurations).toHaveLength(1);
  });
  it("mid-turn save retains old native settings and blocks a reserved-but-unclaimed send at final guard", async () => {
    const fx = await fixture(), old = (await fx.store.read()).bindings[0]!;
    const turn = await fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: fx.scope.id, epoch: 1, causation: "event", text: "Old profile turn" }, captain);
    fx.receiver.agents.get(old.agentId)!.status = "running"; const calls = fx.receiver.calls.length;
    await fx.stage(); expect(fx.receiver.calls).toHaveLength(calls); expect(fx.receiver.agents.get(old.agentId)!.thinkingOptionId).toBe("high");
    fx.receiver.agents.get(old.agentId)!.status = "idle";
    await expect(fx.gateway.dispatch(turn)).rejects.toMatchObject({ code: "HELD" });
    expect((await fx.store.read()).effects.find(e => e.id === turn)?.state).toBe("reserved");
    expect(supervisorSpend(await fx.store.read(), fx.scope.id).turns).toBe(2);
  });
  it.each(["catalog", "policy", "unrelated-uncertainty", "wrong-owner", "offline"])("%s refuses replacement without another create or refunded spend", async kind => {
    const fx = await fixture(); await fx.stage(); const input = await fx.replacement(), old = (await fx.store.read()).bindings[0]!;
    fx.receiver.agents.get(old.agentId)!.status = "closed";
    if (kind === "catalog") fx.state.catalog = [{ ...catalog[0]!, thinking: [{ id: "high", label: "High" }] }];
    if (kind === "policy") fx.state.policy = "b".repeat(64);
    if (kind === "wrong-owner") input.bindingDigest = "b".repeat(64);
    if (kind === "offline") fx.receiver.agents.delete(old.agentId);
    if (kind === "unrelated-uncertainty") {
      // Retain a real unknown opening in the existing effect ledger, rather than inventing an absence.
      const s = await fx.store.read(), e = s.effects.find(e => e.operation === "agent.send")!;
      // Fault must precede the send; use the gateway's already supported uncertainty test in a separate scope.
      const second = await fx.addScope(2, "other", ["other-build"], false);
      await fx.sessions.prepare({ requestId: randomUUID(), scopeId: second.id, scopeVersion: 1, profile, opening: "Other" }, captain);
      const other = activationEffects(await fx.store.read(), second.id, 1);
      await fx.gateway.dispatch(other.workspace!.id); await fx.gateway.dispatch(other.create!.id); await fx.sessions.verify(second.id, 1);
      fx.receiver.faults.send = ["lose"]; await fx.gateway.dispatch(other.send!.id);
      // Unrelated uncertainty cannot hold this scope; its exact owner remains independent.
      await fx.controls.replaceFromUnverifiedUi(input); expect(fx.receiver.agents.size).toBe(3); expect(e.state).toBe("succeeded"); return;
    }
    await expect(fx.controls.replaceFromUnverifiedUi(input)).rejects.toBeTruthy(); expect(supervisorSpend(await fx.store.read(), fx.scope.id)).toEqual({ sessions: 1, turns: 1, uncertain: 0 });
    expect(fx.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(1);
  });
  it("own unknown send holds replacement and retains the original effect and budget", async () => {
    const fx = await fixture();
    const turn = await fx.sessions.reserveTurn({requestId:randomUUID(),scopeId:fx.scope.id,epoch:1,causation:"unknown",text:"Unknown delivery"},captain);
    fx.receiver.faults.send=["lose"]; await fx.gateway.dispatch(turn); await fx.stage();
    const input=await fx.replacement(); fx.receiver.agents.get((await fx.store.read()).bindings[0]!.agentId)!.status="closed";
    await expect(fx.controls.replaceFromUnverifiedUi(input)).rejects.toMatchObject({code:"UNCERTAIN"});
    expect(supervisorSpend(await fx.store.read(),fx.scope.id)).toEqual({sessions:1,turns:2,uncertain:1});
    expect(fx.receiver.calls.filter(c=>c.op==="createAgent")).toHaveLength(1);
  });
  it("restart after the stopped-owner hold resumes the original replacement and never repeats an uncertain opening", async () => {
    const fx=await fixture(); await fx.stage(); const input=await fx.replacement();
    fx.receiver.agents.get((await fx.store.read()).bindings[0]!.agentId)!.status="closed";
    vi.spyOn(fx.sessions,"prepareReplacementFromUnverifiedUi").mockRejectedValueOnce(Error("crash after hold"));
    await expect(fx.controls.replaceFromUnverifiedUi(input)).rejects.toThrow("crash after hold");
    expect((await fx.store.read()).bindings[0]!.state).toBe("suspect");
    const freshView=fx.controls.read(await new SupervisionStore(join(fx.home,"store"),fx.home).read(),fx.scope.id);
    expect(freshView.replacementResume).toEqual({...input,op:"replace"});
    fx.receiver.faults.send=["lose"]; await fx.controls.replaceFromUnverifiedUi(freshView.replacementResume!);
    expect(supervisorSpend(await fx.store.read(),fx.scope.id)).toEqual({sessions:2,turns:2,uncertain:1});
    await fx.controls.replaceFromUnverifiedUi(input);
    expect(fx.receiver.agents.size).toBe(2); expect(fx.receiver.calls.filter(c=>c.op==="send")).toHaveLength(2);
  });
  it("ordinary pause refuses worker start before reserving any attempt or effects, while keeping plan history", async () => {
    const fx=await fixture(); await fx.draft(fx.scope,[{id:"build"}]); const before=await fx.store.read();
    const base={...await fx.base(),planHash:before.plans[0]!.plan.hash}; await fx.controls.pauseFromUnverifiedUi(base);
    const input=await fx.input(fx.scope,{op:"start",plan:fx.scope.planId,node:"build"});
    await expect(fx.gateway.startWorker(input,await fx.actorFor(fx.scope))).rejects.toMatchObject({code:"HELD"});
    const after=await fx.store.read(); expect(after.attempts).toEqual(before.attempts); expect(after.effects).toEqual(before.effects);
    expect(after.plans).toEqual(before.plans);
  });
  it("exhausted cumulative sessions cannot become free replacement work", async () => {
    const fx = await fixture(1); await fx.stage(); const input = await fx.replacement(); fx.receiver.agents.get((await fx.store.read()).bindings[0]!.agentId)!.status = "closed";
    await expect(fx.controls.replaceFromUnverifiedUi(input)).rejects.toMatchObject({ code: "HELD" });
    expect(supervisorSpend(await fx.store.read(), fx.scope.id)).toEqual({ sessions: 1, turns: 1, uncertain: 0 });
  });
  it("two pending change requests have one winner; a stale pause cannot release a later change", async () => {
    const fx = await fixture(), base = await fx.base(), body = { ...base, profile, limits: { supervisorSessions: 3, supervisorTurns: 10 }, policyDigest: fx.state.policy };
    const results = await Promise.allSettled([fx.controls.stageFromUnverifiedUi(body), fx.controls.stageFromUnverifiedUi({ ...body, requestId: randomUUID() })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(fx.controls.read(await fx.store.read(), fx.scope.id).configurations).toHaveLength(1);
    await expect(fx.controls.resumeFromUnverifiedUi({ ...base, requestId: randomUUID(), expectedControlId: body.requestId })).rejects.toMatchObject({ code: "HELD" });
  });
});
