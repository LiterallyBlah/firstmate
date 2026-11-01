/** Stage 2 acceptance authored before feature changes. Synthetic homes only. */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, it } from "vitest";
import { now } from "../supervision-inbox-fixture";
import { s04Fixture } from "../supervision-s04-fixture";
import { WatchConfigStore, WatchRouteHandoff } from "../../server/watch-config";
import { CutoverGate } from "../../server/supervision-gate";
import { SupervisionSources } from "../../server/supervision-sources";
import { digest } from "../../server/submissions";

async function fixture() {
  const f = await s04Fixture(), scope = await f.addScope(1, "plan", ["build"]);
  await f.draft(scope, [{ id: "build" }]); await f.launch(scope, "build");
  const state = await f.store.read(), task = state.tasks[0]!, config = new WatchConfigStore(join(f.home, "watch-config.json"));
  const sources = new SupervisionSources(f.store, { now: () => now });
  const gate = new CutoverGate(f.home, join(f.home, "legacy"));
  let pending: any[] = [];
  const target = { homeId: f.store.homeId, hostId: "local" as const, name: "checks", definitionDigest: digest("definition"),
    scopeId: scope.id, taskId: task.id, attemptId: task.currentAttempt!, planId: "plan", planHash: state.plans[0]!.plan.hash };
  const options = { config, gate, definition: async () => target.definitionDigest, pending: async () => pending,
    bind: async (input: typeof target, requestId: string) => sources.bindWatch(input, requestId) };
  const handoff = new WatchRouteHandoff(options);
  return { ...f, config, sources, gate, target, handoff, options, setPending: (rows: any[]) => { pending = rows; } };
}
it("A1/A8: exact concurrent assignment has one winner and replay retains its receipt", async () => {
  const f = await fixture(), request = { requestId: randomUUID(), expectedGeneration: 0, target: f.target };
  const winners = await Promise.allSettled([f.handoff.prepare(request), f.handoff.prepare({ ...request, requestId: randomUUID() })]);
  expect(winners.filter(r => r.status === "fulfilled")).toHaveLength(1);
  await expect(f.handoff.prepare(request)).resolves.toMatchObject({ requestId: request.requestId, stage: "prepared" });
  await expect(f.handoff.prepare({ ...request, target: { ...f.target, definitionDigest: digest("other") } })).rejects.toThrow(/different|conflict/i);
});
it("A8: prepare blocks old transport, restart commits one source association and never falls back", async () => {
  const f = await fixture(), request = { requestId: randomUUID(), expectedGeneration: 0, target: f.target };
  await f.handoff.prepare(request);
  expect((await f.gate.verdict({ source: "watch", id: "checks@old#output", payloadHash: digest("old") }, "send")).admit).toBe(false);
  const restarted = new WatchRouteHandoff(f.options);
  await restarted.commit(request.requestId); await restarted.commit(request.requestId);
  expect((await f.store.read()).sources.bindings.filter(b => b.kind === "watch")).toHaveLength(1);
  expect((await f.config.read()).assignments.checks).toMatchObject({ stage: "committed", generation: 1, target: f.target });
  expect((await f.gate.verdict({ source: "watch", id: "checks@new#output", payloadHash: digest("new") }, "enqueue")).admit).toBe(false);
});
it("A8: pending and uncertain old deliveries remain exact and prevent commit", async () => {
  const f = await fixture(), pending = [{ id: "old", payloadHash: digest("old"), delivery: { state: "uncertain" } }]; f.setPending(pending);
  const request = { requestId: randomUUID(), expectedGeneration: 0, target: f.target };
  await f.handoff.prepare(request);
  await expect(new WatchRouteHandoff(f.options).commit(request.requestId)).rejects.toThrow(/pending|uncertain|drain/i);
  expect((await f.config.read()).assignments.checks?.pending).toEqual(pending);
  expect((await f.store.read()).sources.bindings.filter(b => b.kind === "watch")).toHaveLength(0);
  await f.handoff.abort(request.requestId);
  expect((await f.gate.verdict({ source: "watch", id: "checks@old#output", payloadHash: digest("old") }, "send")).admit).toBe(true);
});
it("A1/A5/A8: changed definition refuses; changed plan target refuses at journal admission", async () => {
  const f = await fixture();
  await expect(f.handoff.prepare({ requestId: randomUUID(), expectedGeneration: 0, target: { ...f.target, definitionDigest: digest("renamed") } })).rejects.toThrow(/definition|stale/i);
  await expect(f.sources.bindWatch({ ...f.target, planHash: digest("old-plan") }, randomUUID())).rejects.toThrow(/stale|plan/i);
  expect((await f.store.read()).sources.bindings.filter(b => b.kind === "watch")).toEqual([]);
});
async function routed() {
  const f = await fixture(); await f.sources.bindWatch(f.target, randomUUID());
  const fact = { format: "firstmate.watch-fact/1" as const, watch: "checks", definitionDigest: f.target.definitionDigest,
    subject: "build-checks", state: "healthy", evidence: "checked exact trial", observedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 60_000).toISOString(), deadline: null, coverage: "complete" as const,
    policyDigest: digest("policy"), unknownEffects: false };
  return { ...f, fact };
}
it("A6: 100 represented healthy observations create zero actionable inputs and zero repeated writes", async () => {
  const f = await routed(); await f.sources.observeWatch(f.fact);
  const sequence = (await f.store.read()).sequence;
  for (let i = 0; i < 100; i++) await f.sources.observeWatch({ ...f.fact, observedAt: new Date(now.getTime() + i).toISOString() });
  const s = await f.store.read(); expect(s.sequence).toBe(sequence);
  expect(s.inbox.assignments.filter(a => a.state === "assigned")).toEqual([]);
  expect(s.effects).toHaveLength(3);
});
it("A6: A to B to A retains three transitions and one exact execution owner", async () => {
  const f = await routed(); for (const state of ["healthy", "failed", "healthy"]) await f.sources.observeWatch({ ...f.fact, state });
  const s = await f.store.read(); expect(s.inbox.events).toHaveLength(3);
  expect(new Set(s.inbox.assignments.map(a => a.scopeId))).toEqual(new Set([f.target.scopeId]));
});
it.each(["expired", "deadline", "gap", "unknown", "policy"])("A6/A7: %s observation cannot hide behind identical state", async kind => {
  const f = await routed(); await f.sources.observeWatch(f.fact);
  const changed = { ...f.fact, ...(kind === "expired" ? { validUntil: now.toISOString() } : kind === "deadline" ? { deadline: now.toISOString() } :
    kind === "gap" ? { coverage: "gap" as const } : kind === "unknown" ? { unknownEffects: true } : { policyDigest: digest("revoked") }) };
  await f.sources.observeWatch(changed); await f.sources.observeWatch(changed);
  const s = await f.store.read(), actionable = s.inbox.assignments.filter(a => a.state === "assigned");
  expect(actionable).toHaveLength(1); expect(actionable[0]?.scopeId).toBe(f.target.scopeId);
  expect(s.effects).toHaveLength(3); // ingress grants no action or retry
});
it("A8: overlapping watches coalesce the same fact, preserve provenance and cannot claim another owner", async () => {
  const f = await routed(); await f.sources.bindWatch({ ...f.target, name: "second" }, randomUUID());
  await f.sources.observeWatch({ ...f.fact, state: "failed" }); await f.sources.observeWatch({ ...f.fact, watch: "second", state: "failed" });
  const s = await f.store.read(); expect(s.inbox.events).toHaveLength(2);
  expect(s.inbox.assignments.filter(a => a.state === "assigned")).toHaveLength(1);
  await expect(f.sources.bindWatch({ ...f.target, scopeId: "00000000-0000-4000-8000-000000000011" }, randomUUID())).rejects.toThrow();
});
it("A7/A8: malformed or unassigned facts stay refused; no inferred prose ownership", async () => {
  const f = await routed(); await expect(f.sources.observeWatch({ ...f.fact, watch: "unknown" })).rejects.toThrow(/owner|route|assignment/i);
  await expect(f.sources.observeWatch({ ...f.fact, validUntil: "tomorrow" })).rejects.toThrow();
  expect((await f.store.read()).inbox.events).toEqual([]);
});
