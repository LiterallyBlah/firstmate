import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { s04Fixture, captain, type ScopeHandle } from "./supervision-s04-fixture";
import { expected } from "./supervision-fixture";
import { FirstmateConfigSchema } from "../shared/fleet";
import { PlanRuleRecordSchema, RuleVerificationSchema } from "../shared/plan-rules";
import { PlanRuntime } from "../server/plan-runtime";
import { SupervisionRuntime } from "../server/supervision-runtime";
import type { PaseoApi } from "../server/host-types";
import { PlanRules, ruleRef } from "../server/plan-rules";
import { policyRef } from "../server/supervision-policy";
import { digest } from "../server/submissions";
import { expectedFor, stableId } from "../server/supervision-effects";
import { oneAtATime } from "../server/mate";
import { workflowHomeId, workflowSnapshot } from "../server/workflow-board";
import { planSubjectHash } from "../server/workflow-plans";
import { checkPlanAllocation } from "../server/plan-allocation";
import type { SupervisionMutation } from "../server/supervision-store";
import { normalizePullRequest } from "../server/supervision-sources";
import { SupervisionSources } from "../server/supervision-sources";
import { activationEffects } from "../server/supervisor-sessions";
import { WatchConfigStore } from "../server/watch-config";
import { pluginDir } from "../server/data-dir";
import { watchPolicyDigest } from "../server/supervision-source-state";
import { cutoverGate } from "../server/supervision-gate";

export async function fixture(realOwners = false) {
  const f = await s04Fixture(), scopes: ScopeHandle[] = [];
  for (let n = 1; n <= 2; n++) {
    const scope = await f.addScope(n, `chain-${n}`, [`build-${n}`, `review-${n}`], !realOwners); scopes.push(scope);
    if (realOwners) {
      await f.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: (await f.store.read()).scopes.find(s => s.id === scope.id)!.version,
        profile: { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" }, opening: "Synthetic isolated owner" }, captain);
      const b = (await f.store.read()).bindings.find(b => b.scopeId === scope.id)!; scope.owner.id = b.agentId;
      const e = activationEffects(await f.store.read(), scope.id, b.epoch);
      await f.gateway.dispatch(e.workspace!.id); await f.gateway.dispatch(e.create!.id); await f.sessions.verify(scope.id, b.epoch); await f.gateway.dispatch(e.send!.id); f.receiver.finish(b.agentId);
    }
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
