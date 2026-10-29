import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { captain, s04Fixture } from "../test/supervision-s04-fixture";
import type { DecisionSource } from "../shared/needs-you";
import { filterScopeInbox } from "../shared/scope-inbox";
import { needsYouSnapshot } from "./needs-you-ledger";
import { withScopeInboxContext } from "./scope-inbox";
import { expectedFor } from "./supervision-effects";
import { policyRef } from "./supervision-policy";

it("A09/F1: a persisted cross-project plan does not widen a project's legacy request or parked membership", async () => {
  const f = await s04Fixture();
  try {
    const cross = await f.addScope(1, "shared-work", ["cross-build"]);
    await f.draft(cross, [{ id: "cross-build" }]);
    const before = await f.store.read();
    const betaId = randomUUID(), alphaScope = randomUUID(), betaScope = randomUUID();
    const scope = (id: string, projectIds: string[]) => ({ id, homeId: before.homeId, kind: "project" as const,
      projectIds, sponsorId: null, version: 1, mode: "scoped" as const, state: "dormant" as const });
    const project = (id: string, scopeId: string, name: string) => ({ id, scopeId, name, aliases: [], version: 1,
      state: "admitted" as const, budget: { agents: 4, turns: 4 },
      sourceVector: [policyRef("policy-source", before.policySources[0]!)], provenance: captain });
    const mutations = [
      { kind: "scope" as const, value: scope(alphaScope, [cross.projectId]) },
      { kind: "scope" as const, value: scope(betaScope, [betaId]) },
      { kind: "scope" as const, value: { ...before.scopes.find(s => s.id === cross.id)!, projectIds: [cross.projectId, betaId], version: 2 } },
      { kind: "project" as const, value: project(cross.projectId, alphaScope, "Alpha") },
      { kind: "project" as const, value: project(betaId, betaScope, "Beta") },
    ];
    await f.store.transact(expectedFor(before, mutations), randomUUID(), mutations);
    const source: DecisionSource = { key: "beta-only", taskId: "unrelated-beta-task", hostId: "local-server", project: "Beta",
      title: "Beta-only decision", ask: "Beta question", url: null, reportPath: null, gateToken: null,
      section: "in-flight", disposition: "open", blockedBy: null };
    const base = { ...needsYouSnapshot(null, { status: "fresh" as const, checkedAt: 1000, asOf: 1000, problems: [] }),
      homeId: before.homeId, actionCount: 1, parked: [source],
      requests: [{ id: "beta-request", source, generation: 1, revision: 1, state: "seen" as const, detectedAt: 1000,
        updatedAt: 1000, originalAsk: source.ask, baseline: true, seenAt: null, seenRevision: null,
        snoozedUntil: null, submissions: [], resolution: null }],
      planNow: [{ plan: cross.planId, title: "Shared review", question: "Review", recommendation: "", waits: [], neededBy: [] }],
    };
    const snapshot = withScopeInboxContext(base, await f.store.read(), [], "local-server");
    expect(snapshot.scopeDirectory?.find(s => s.id === cross.id)?.projectNames).toEqual(["Alpha", "Beta"]);
    for (const id of [alphaScope, betaScope]) {
      const filtered = filterScopeInbox(snapshot, { kind: "project", id });
      expect(filtered.planNow?.map(n => n.plan)).toEqual([cross.planId]);
      expect(filtered.actionCount).toBe(1);
      // No project owner/host is recorded yet: plan membership cannot lend legacy identities to either project.
      expect(filtered.requests.map(r => r.source.taskId)).toEqual([]);
      expect(filtered.parked.map(r => r.taskId)).toEqual([]);
    }
    expect(filterScopeInbox(snapshot, { kind: "all" }).requests).toEqual(base.requests);
    expect(filterScopeInbox(snapshot, { kind: "project" }).parked).toEqual(base.parked);
  } finally {
    await f.store.releaseCoordinator();
  }
});
