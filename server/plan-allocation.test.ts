import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { s04Fixture, captain } from "../test/supervision-s04-fixture";
import { checkPlanAllocation } from "./plan-allocation";
import { policyRef } from "./supervision-policy";
it("cross-project claims charge their exact task's retained spend and never borrow another project's room", async () => {
  const f = await s04Fixture(), scope = await f.addScope(1, "cross", ["a", "b"]), s = await f.store.read(), projectB = randomUUID(), sponsor = randomUUID();
  s.scopes[0] = { ...s.scopes[0]!, projectIds: [scope.projectId, projectB], sponsorId: sponsor };
  const a = s.tasks.find(t => t.nodeId === "a")!, b = s.tasks.find(t => t.nodeId === "b")!; b.projectId = projectB;
  s.projects = { projects: [scope.projectId, projectB].map(id => ({ id, version: 1, scopeId: sponsor, name: id, aliases: [], state: "admitted", budget: { agents: 2, turns: 2 }, sourceVector: [policyRef("policy-source", s.policySources[0]!)], provenance: captain })),
    sponsors: [{ id: scope.id, version: 1, sponsorScopeId: sponsor, projectIds: [scope.projectId, projectB], claims: [scope.projectId, projectB].map(projectId => ({ projectId, agents: 1, turns: 1, priority: 1 })), queuedAt: 1, state: "granted", provenance: captain }],
    intents: [], dependencies: [], memory: [], memoryProposals: [], conflicts: [] };
  const spent = (taskId: string) => ({ id: randomUUID(), taskId, ordinal: 1, briefHash: "a".repeat(64), launchEffectId: randomUUID(), worker: null,
    originalNotificationOwner: null, notificationStatus: "unknown" as const, spentAgents: 1, spentTurns: 1, state: "failed", evidenceIds: [], version: 1 });
  s.attempts.push(spent(a.id));
  expect(() => checkPlanAllocation(s, scope.id, true, projectB)).not.toThrow();
  expect(() => checkPlanAllocation(s, scope.id, true, scope.projectId)).toThrow("exhausted");
  expect(() => checkPlanAllocation(s, scope.id, true)).toThrow("exact owned task");
  s.attempts.push(spent(b.id)); expect(() => checkPlanAllocation(s, scope.id, false)).not.toThrow();
  s.attempts.push(spent(a.id)); expect(() => checkPlanAllocation(s, scope.id, false)).toThrow("exhausted");
});
