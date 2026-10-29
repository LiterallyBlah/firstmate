import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { s04Fixture, captain, type ScopeHandle } from "../test/supervision-s04-fixture";
import { PlanRuntime } from "../server/plan-runtime";
import { SupervisionRuntime } from "../server/supervision-runtime";
import { PlanRules, ruleRef } from "../server/plan-rules";
import { PlanRuleRecordSchema } from "../shared/plan-rules";
import { FirstmateConfigSchema } from "../shared/fleet";
import { acceptPolicyInventory, policyRef } from "../server/supervision-policy";
import { expectedFor, stableId } from "../server/supervision-effects";
import { workflowHomeId } from "../server/workflow-board";
import { planSubjectHash } from "../server/workflow-plans";
import type { SupervisionMutation } from "../server/supervision-store";
import type { PaseoApi } from "../server/host-types";
import { ScopeRuntime } from "../server/scope-runtime";
import { planSupervisorGatewayLimits } from "../shared/plan-supervisor-limits";
import { resolveDiscussion } from "../shared/scope-discussion";
import { activationEffects } from "../server/supervisor-sessions";
import { PolicySourceSchema } from "../shared/supervision-policy";

async function fixture(slots = 10, budget = 6) {
  const f = await s04Fixture(), scopes: ScopeHandle[] = [], records: ReturnType<typeof PlanRuleRecordSchema.parse>[] = [];
  for (let n = 1; n <= 2; n++) {
    const scope = await f.addScope(n, `chain-${n}`, [`build-${n}`]); scopes.push(scope);
    await f.draft(scope, [{ id: `build-${n}` }], true);
    if (budget !== 6) {
      const p = (await f.store.read()).plans.find(p => p.scopeId === scope.id)!.plan;
      await f.run(scope, { op: "revise", definition: { ...p.definition, budget: { agents: budget, turns: budget } }, expected: p.hash, reason: "Explicit one-run worker envelope for the review case" });
    }
    const s = await f.store.read(), projectScope = randomUUID(), own = s.scopes.find(v => v.id === scope.id)!;
    const changes: SupervisionMutation[] = [
      { kind: "scope", value: { ...own, sponsorId: projectScope, version: own.version + 1 } },
      { kind: "scope", value: { id: projectScope, version: 1, homeId: s.homeId, kind: "project", projectIds: [scope.projectId], sponsorId: null, mode: "scoped", state: "active" } },
      { kind: "project", value: { id: scope.projectId, version: 1, scopeId: projectScope, name: scope.project, aliases: [], state: "admitted", budget: { agents: 6, turns: 6 }, sourceVector: [policyRef("policy-source", s.policySources[0]!)], provenance: captain } },
      { kind: "plan-sponsor", value: { id: scope.id, version: 1, sponsorScopeId: projectScope, projectIds: [scope.projectId], claims: [{ projectId: scope.projectId, agents: 6, turns: 6, priority: 1 }], queuedAt: 1, state: "granted", provenance: captain } },
    ];
    await f.store.transact(expectedFor(s, changes), randomUUID(), changes);
    // Existing independent supervisors are observed dormant, so they consume no worker slot.
    const plan = (await f.store.read()).plans.find(p => p.scopeId === scope.id)!.plan;
    const na = { applies: false as const, reason: "Small server-only review fixture; no applicable visual, performance, long-run or heavy-suite requirement." };
    const record = PlanRuleRecordSchema.parse({ format: "firstmate.plan-rules/1", id: stableId("plan-rules", s.homeId, scope.planId, plan.revision), version: 1,
      homeId: s.homeId, scopeId: scope.id, planId: scope.planId, revision: plan.revision, sources: [policyRef("policy-source", s.policySources[0]!)], supervisorLimits: { sessions: 1, turns: 8 },
      nodes: [{ nodeId: scope.nodes[0], checks: [{ id: "unit", command: "node check.mjs", passCriterion: "Exit zero and no failures" }], design: na, performance: na, longRun: na, heavyTests: na }] });
    records.push(record); await new PlanRules(f.store, f.home).import(randomUUID(), record, captain);
  }
  const originalFind = f.receiver.findAgent.bind(f.receiver);
  vi.spyOn(f.receiver, "findAgent").mockImplementation(async id => {
    const owner = scopes.find(s => s.owner.id === id);
    if (owner) return { id, workspaceId: `supervisor-ws-${scopes.indexOf(owner) + 1}`, cwd: f.home, labels: {}, provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high", status: "idle", pendingPermissions: 0, archivedAt: null };
    return originalFind(id);
  });
  const nativeSend = vi.fn(async () => {});
  const api = { agents: { list: vi.fn(async () => ({ entries: [], pageInfo: { hasMore: false } })), ref: () => ({ send: nativeSend }) } } as unknown as PaseoApi;
  const runtime = new SupervisionRuntime(join(f.home, "store"), () => f.store);
  const config = async () => FirstmateConfigSchema.parse({ home: f.home, mateAgentId: "general" });
  const closeBootstrap = vi.fn(async () => {}), bootstrap = vi.fn(async () => ({ paseo: api, close: closeBootstrap }));
  const service = new PlanRuntime(runtime, { enabled: true, config, receiver: () => f.receiver, slots, bootstrap });
  const components = service.compose(f.store, f.home, "general", api);
  const input = async (index: number) => ({ ...await f.input(scopes[index]!, { op: "start" as const, plan: scopes[index]!.planId, node: scopes[index]!.nodes[0]! }), planRules: ruleRef(records[index]!) });
  return { ...f, scopes, records, runtime, service, components, api, nativeSend, input, bootstrap, closeBootstrap };
}

it("F1: successful create before verification must keep its reserved General-headroom slot", async () => {
  const f = await fixture(2);
  try {
    const a = await f.components.gateway.startWorker(await f.input(0), f.scopes[0]!.owner);
    await expect(f.components.gateway.startWorker(await f.input(1), f.scopes[1]!.owner)).rejects.toThrow("capacity");
    await f.components.gateway.dispatch(a.effects!.workspace);
    const reserved = await f.store.read(), projectScope = reserved.projects!.projects[1]!.scopeId;
    const busy = { kind: "binding" as const, value: { scopeId: projectScope, epoch: 1, hostId: "local", agentId: "other-reserved-capacity", workspaceId: "project-space",
      profileDigest: "a".repeat(64), state: "active" as const, checkpointHash: "a".repeat(64), acknowledgedSeq: 0, heartbeatDue: null } };
    await f.store.transact(expectedFor(reserved, [busy]), randomUUID(), [busy]);
    await expect(f.components.gateway.dispatch(a.effects!.create)).rejects.toThrow("capacity");
    expect((await f.store.read()).effects.find(e => e.id === a.effects!.create)!.state).toBe("reserved");
    const retired = { ...busy, value: { ...busy.value, state: "retired" as const } };
    await f.store.transact(expectedFor(await f.store.read(), [retired]), randomUUID(), [retired]);
    await f.components.gateway.dispatch(a.effects!.create);
    const before = await f.store.read();
    expect(before.attempts[0]!.worker).toBeNull();
    expect(before.effects.find(e => e.id === a.effects!.send)!.state).toBe("reserved");
    // The native worker now exists but its opening send is still outstanding. No slot is free.
    await expect(f.components.gateway.startWorker(await f.input(1), f.scopes[1]!.owner)).rejects.toThrow("capacity");
    await f.components.gateway.verifyWorker(a.attemptId!); await f.components.gateway.dispatch(a.effects!.send);
    expect(f.receiver.sends).toHaveLength(1);
  } finally { await f.service.stop(); await f.runtime.stop(); }
});

it("F2: enabling an operating runtime after restart must process retained work without a view or unrelated event", async () => {
  const f = await fixture();
  try {
    const a = await f.components.gateway.startWorker(await f.input(0), f.scopes[0]!.owner);
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    f.service.register({ on: (name: string, handler: (...args: unknown[]) => unknown) => { hooks.set(name, handler); return () => {}; }, before: vi.fn(() => () => {}) } as never);
    await f.service.tick(); await f.service.tick();
    // The bootstrap obtains the API independently of views and unrelated lifecycle callbacks.
    expect(f.bootstrap).toHaveBeenCalledExactlyOnceWith(f.home, "general");
    expect((await f.store.read()).effects.find(e => e.id === a.effects!.workspace)!.state).toBe("succeeded");
  } finally { await f.service.stop(); await f.runtime.stop(); }
});

it("F3: the scoped board route must refuse a new worker turn after a checked captain admission stop", async () => {
  const f = await fixture(10, 1);
  try {
    f.service.remember(f.api); await f.service.tick();
    const a = await f.components.gateway.startWorker(await f.input(0), f.scopes[0]!.owner);
    await f.components.gateway.dispatch(a.effects!.workspace); await f.components.gateway.dispatch(a.effects!.create);
    await f.components.gateway.verifyWorker(a.attemptId!); await f.components.gateway.dispatch(a.effects!.send);
    const s = await f.store.read(), plan = s.plans.find(p => p.scopeId === f.scopes[0]!.id)!.plan;
    await f.service.act({ homeId: workflowHomeId(f.home), requestId: randomUUID(), command: { op: "captain", plan: plan.definition.id, revision: plan.revision, subjectHash: planSubjectHash(plan), action: "hold", text: "Stop new work until the authority issue is resolved." } }, f.api);
    const held = await f.store.read();
    expect(held.plans.find(p => p.scopeId === f.scopes[0]!.id)!.plan.definition.budget.turns).toBe(1);
    expect(held.operationHolds.some(h => h.scopeId === f.scopes[0]!.id && h.state === "held" && h.operations.includes("model.use"))).toBe(true);
    const worker = held.attempts.find(v => v.id === a.attemptId)!.worker!;
    f.receiver.finish(worker.agentId); // An idle receiver starts a new paid turn on send.
    await expect(f.service.steer(f.api, worker.agentId, "Do another implementation pass")).rejects.toThrow();
    expect((await f.store.read()).attempts.find(v => v.id === a.attemptId)!.spentTurns).toBe(1);
    expect(f.nativeSend).not.toHaveBeenCalled();
    const refused = (await f.store.read()).sources.submissions.at(-1)!;
    expect(refused).toMatchObject({ state: "failed", agentId: worker.agentId, attemptId: a.attemptId, correlation: null });
    expect(Buffer.from(await f.store.readBlob(refused.textDigest)).toString()).toBe("Do another implementation pass");
  } finally { await f.service.stop(); await f.runtime.stop(); }
});

it.each(["before-file", "before-supersede", "dispatch-file", "dispatch-supersede", "dispatch-record", "unchanged"])("F4: C binds continuing-turn authority across reservation and dispatch (%s)", async mode => {
  const f = await s04Fixture(), scope = await f.addScope(1, "source-budget", ["build"], false);
  const profile = { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" };
  await f.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1, profile, opening: "Initial explicitly approved session" }, captain);
  const opening = activationEffects(await f.store.read(), scope.id, 1);
  await f.gateway.dispatch(opening.workspace!.id); await f.gateway.dispatch(opening.create!.id);
  const binding = await f.sessions.verify(scope.id, 1); await f.gateway.dispatch(opening.send!.id);
  f.receiver.finish(binding.agentId);
  await f.draft(scope, [{ id: "build" }], true);
  const s = await f.store.read(), projectScope = randomUUID(), projectRows: SupervisionMutation[] = [
    { kind: "scope", value: { id: projectScope, version: 1, homeId: s.homeId, kind: "project", projectIds: [scope.projectId], sponsorId: null, mode: "scoped", state: "dormant" } },
    { kind: "project", value: { id: scope.projectId, version: 1, scopeId: projectScope, name: scope.project, aliases: [], state: "admitted", budget: { agents: 4, turns: 4 }, sourceVector: [policyRef("policy-source", s.policySources[0]!)], provenance: captain } },
  ];
  await f.store.transact(expectedFor(s, projectRows), randomUUID(), projectRows);
  const text = "Approved continuing-turn cap: three turns.\n", sha = (t: string) => createHash("sha256").update(t).digest("hex");
  await writeFile(join(f.home, "data", "rule-orders.md"), text);
  const source = PolicySourceSchema.parse({ id: randomUUID(), version: 1, path: "data/rule-orders.md", lineStart: 1, lineEnd: 1, fileHash: sha(text), excerptHash: sha(text.trimEnd()), provenance: captain, supersedes: [] });
  await acceptPolicyInventory(f.store, f.home, randomUUID(), captain, { sources: [source], rules: [] }, true);
  const plan = (await f.store.read()).plans[0]!.plan, na = { applies: false as const, reason: "Small server-only check, no applicable visual, performance, long-run or heavy-suite requirement." };
  const rules = new PlanRules(f.store, f.home);
  const record = PlanRuleRecordSchema.parse({ format: "firstmate.plan-rules/1", id: stableId("plan-rules", s.homeId, scope.planId, plan.revision), version: 1, homeId: s.homeId, scopeId: scope.id, planId: scope.planId, revision: plan.revision, sources: [policyRef("policy-source", source)], supervisorLimits: { sessions: 1, turns: 3 },
    nodes: [{ nodeId: "build", checks: [{ id: "unit", command: "node check.mjs", passCriterion: "No failed assertions" }], design: na, performance: na, longRun: na, heavyTests: na }] });
  await rules.import(randomUUID(), record, captain);
  const runtime = new SupervisionRuntime(join(f.home, "store"), () => f.store);
  const service = new ScopeRuntime(runtime, { enabled: true, uiEnabled: true, config: async () => FirstmateConfigSchema.parse({ home: f.home, mateAgentId: f.state.globalMate }), receiver: () => f.receiver, planLimits: planSupervisorGatewayLimits, planBudgetRefused: (_store, _home, id) => rules.budgetDecision(id) });
  try {
    const mutateAuthority = async () => {
      if (mode.endsWith("file")) await writeFile(join(f.home, "data", "rule-orders.md"), "The reviewed continuing-turn authority changed.\n");
      else if (mode.endsWith("supersede")) {
        await writeFile(join(f.home, "data", "new-rule-orders.md"), text);
        await acceptPolicyInventory(f.store, f.home, randomUUID(), captain, { sources: [{ ...source, id: randomUUID(), path: "data/new-rule-orders.md", supersedes: [source.id] }], rules: [] }, true);
      } else if (mode.endsWith("record")) await rules.import(randomUUID(), { ...record, version: 2 }, captain);
    };
    if (mode.startsWith("before")) await mutateAuthority();
    if (mode.startsWith("dispatch")) {
      const find = f.receiver.findAgent.bind(f.receiver); let changed = false;
      vi.spyOn(f.receiver, "findAgent").mockImplementation(async id => {
        if (!changed && id === binding.agentId && (await f.store.read()).effects.some(e => e.operation === "agent.send" && e.state === "reserved" && e.planRules)) {
          changed = true; await mutateAuthority();
        }
        return find(id);
      });
    }
    const outcome = await service.execute(s.homeId, scope.id, {} as PaseoApi, async ({ discussions }) => {
      const snapshot = await discussions.read(), addressedText = "Explain the current plan", route = resolveDiscussion(addressedText, snapshot.scopes, snapshot.projects, scope.id);
      return discussions.result({ id: randomUUID(), text: route.text, addressedText, defaultScope: scope.id, route: { target: route.scope.target, recipient: route.scope.title, projectIds: route.projectIds, conversationId: "main", replyTo: null } });
    });
    expect(f.receiver.sends).toHaveLength(mode === "unchanged" ? 2 : 1);
    if (mode.startsWith("before")) expect(outcome.outcome).toBe("refused");
    else {
      expect(outcome.outcome).toBe("recorded"); // The transcript remains durable even if dispatch is held.
      if (outcome.outcome === "recorded") expect(outcome.thread.messages.at(-1)!.delivery).toBe(mode === "unchanged" ? "sent" : "uncertain");
    }
    if (mode.startsWith("dispatch") || mode === "unchanged") {
      const effect = (await f.store.read()).effects.filter(e => e.operation === "agent.send").at(-1)!;
      expect(effect.planRules).toEqual(ruleRef(record));
    }
  } finally { await runtime.stop(); }
});

it("F2: a failed idle bootstrap retains the original reservation and backs off without a model event", async () => {
  const f = await fixture();
  try {
    const start = await f.components.gateway.startWorker(await f.input(0), f.scopes[0]!.owner);
    f.bootstrap.mockRejectedValueOnce(new Error("Read-only bootstrap is unavailable"));
    await expect(f.service.tick()).rejects.toThrow("bootstrap is unavailable"); await f.service.tick();
    expect(f.bootstrap).toHaveBeenCalledOnce(); expect(f.receiver.calls).toEqual([]);
    const after = await f.store.read(); expect(after.effects.find(e => e.id === start.effects!.workspace)!.state).toBe("reserved"); expect(after.attempts).toHaveLength(1);
  } finally { await f.service.stop(); await f.runtime.stop(); }
});
it("F2: startup keeps an uncertain native creation and original spend; it never retries that creation", async () => {
  const f = await fixture();
  try {
    const start = await f.components.gateway.startWorker(await f.input(0), f.scopes[0]!.owner);
    await f.components.gateway.dispatch(start.effects!.workspace); f.receiver.faults.createAgent = ["hide"];
    expect((await f.components.gateway.dispatch(start.effects!.create)).state).toBe("uncertain");
    await f.service.tick(); await f.service.tick();
    const after = await f.store.read(); expect(after.effects.find(e => e.id === start.effects!.create)!.state).toBe("uncertain");
    expect(after.attempts[0]!.spentTurns).toBe(1); expect(f.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(1); expect(f.receiver.sends).toEqual([]);
    await f.service.stop(); expect(f.closeBootstrap).toHaveBeenCalledOnce();
  } finally { await f.service.stop(); await f.runtime.stop(); }
});

it("F2: default-off startup neither connects nor progresses retained work", async () => {
  const f = await fixture(), bootstrap = vi.fn(async () => ({ paseo: f.api, close: f.closeBootstrap }));
  const disabled = new PlanRuntime(f.runtime, { bootstrap, config: async () => FirstmateConfigSchema.parse({ home: f.home, mateAgentId: "general" }) });
  try {
    const start = await f.components.gateway.startWorker(await f.input(0), f.scopes[0]!.owner);
    await disabled.tick(); expect(bootstrap).not.toHaveBeenCalled(); expect(f.receiver.calls).toEqual([]);
    expect((await f.store.read()).effects.find(e => e.id === start.effects!.workspace)!.state).toBe("reserved");
  } finally { await disabled.stop(); await f.service.stop(); await f.runtime.stop(); }
});
