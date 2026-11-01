/** Adjacent Stage 2 correction controls. Synthetic sources and clocks only. */
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { s04Fixture } from "../supervision-s04-fixture";
import { now } from "../supervision-inbox-fixture";
import { SupervisionSources } from "../../server/supervision-sources";
import { watchPolicyDigest } from "../../server/supervision-source-state";
import { expectedFor } from "../../server/supervision-effects";
import { digest } from "../../server/submissions";

async function fixture() {
  const f = await s04Fixture(), scope = await f.addScope(1, "plan", ["build"]);
  await f.draft(scope, [{ id: "build" }]); await f.launch(scope, "build");
  const s = await f.store.read(), task = s.tasks[0]!, owner = s.bindings[0]!;
  let clock = now;
  const sources = new SupervisionSources(f.store, { now: () => clock });
  const target = { homeId: s.homeId, hostId: "local" as const, name: "one", definitionDigest: digest("definition"), scopeId: scope.id,
    taskId: task.id, attemptId: task.currentAttempt!, planId: "plan", planHash: s.plans[0]!.plan.hash, planRevision: s.plans[0]!.plan.revision,
    owner: { agentId: owner.agentId, epoch: owner.epoch, profileDigest: owner.profileDigest }, policyDigest: watchPolicyDigest(s, scope.id) };
  await sources.bindWatch(target, randomUUID()); await sources.bindWatch({ ...target, name: "two" }, randomUUID());
  const fact = { format: "firstmate.watch-fact/1" as const, watch: "one", definitionDigest: target.definitionDigest, subject: "checks", state: "healthy",
    evidence: "exact evidence", observedAt: now.toISOString(), validUntil: new Date(now.getTime() + 60_000).toISOString(), deadline: null,
    coverage: "complete" as const, policyDigest: target.policyDigest, unknownEffects: false };
  return { ...f, sources, target, fact, clock: (offset: number) => { clock = new Date(now.getTime() + offset); } };
}

it.each(["freshness", "coverage", "unknown"])("F1: overlapping %s recovery has one actionable shared consequence", async kind => {
  const f = await fixture(); await f.sources.observeWatch(f.fact);
  const bad = { ...f.fact, watch: "two", ...(kind === "freshness" ? { validUntil: now.toISOString() } : kind === "coverage" ? { coverage: "gap" as const } : { unknownEffects: true }) };
  await f.sources.observeWatch(bad); await f.sources.observeWatch(f.fact);
  await f.sources.observeWatch({ ...f.fact, watch: "two" });
  const s = await f.store.read();
  expect(s.inbox.assignments.map(a => a.state)).toEqual(["observed", "assigned", "assigned", "superseded"]);
  expect(new Set(s.inbox.assignments.map(a => a.scopeId))).toEqual(new Set([f.target.scopeId]));
});

it("F2: 100 differing overlap clock passes spend nothing; a real later A-B-A still acts", async () => {
  const f = await fixture(); await f.sources.observeWatch(f.fact); await f.sources.observeWatch({ ...f.fact, watch: "two", state: "failed" });
  const before = await f.store.read();
  for (let n = 0; n < 100; n++) await f.sources.refreshWatches();
  const after = await f.store.read(); expect(after.sequence).toBe(before.sequence); expect(after.effects).toEqual(before.effects); expect(after.inbox).toEqual(before.inbox);
  await f.sources.observeWatch({ ...f.fact, observedAt: new Date(now.getTime() + 1).toISOString() });
  expect((await f.store.read()).inbox.assignments.map(a => a.state)).toEqual(["observed", "assigned", "assigned"]);
});

it.each(["expiry", "deadline", "policy"])("F2: overlapping retained %s changes surface once and keep both provenances", async kind => {
  const f = await fixture(), fact = { ...f.fact, ...(kind === "deadline" ? { deadline: new Date(now.getTime() + 30_000).toISOString() } : {}) };
  await f.sources.observeWatch(fact); await f.sources.observeWatch({ ...fact, watch: "two", state: "failed" });
  if (kind === "policy") {
    const s = await f.store.read(), rule = s.policyRules[0]!, mutations = [{ kind: "policy-rule" as const, value: { ...rule, version: rule.version + 1 } }];
    await f.store.transact(expectedFor(s, mutations), randomUUID(), mutations);
  } else f.clock(kind === "expiry" ? 60_001 : 30_001);
  const before = await f.store.read(); expect(await f.sources.refreshWatches()).toEqual([]);
  const changed = await f.store.read(); expect(changed.inbox.events.length).toBe(before.inbox.events.length + 2);
  await f.sources.refreshWatches(); expect((await f.store.read()).sequence).toBe(changed.sequence);
  expect(new Set(changed.inbox.events.map(e => e.envelope.subject.watch))).toEqual(new Set(["one", "two"]));
});

it("F2: a newer real report cannot be overwritten by an earlier captured clock payload", async () => {
  const f = await fixture(); await f.sources.observeWatch(f.fact); f.clock(60_001);
  const failures = await f.sources.refreshWatches(async () => true, async (fact, retained) => {
    await f.sources.observeWatch({ ...fact, state: "failed", observedAt: new Date(now.getTime() + 60_001).toISOString(), validUntil: new Date(now.getTime() + 120_000).toISOString() });
    return f.sources.observeWatch(fact, undefined, retained);
  });
  expect(failures).toHaveLength(1); expect(failures[0]?.error).toMatchObject({ code: "STALE" });
  const s = await f.store.read(); expect(s.inbox.events).toHaveLength(2);
  expect(s.inbox.assignments.map(a => a.state)).toEqual(["observed", "assigned"]);
});
