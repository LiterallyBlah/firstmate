import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { captain } from "../test/supervision-s04-fixture";
import { PlanRules, ruleRef, snapshotKey } from "./plan-rules";
import { SupervisionGateway } from "./supervision-effects";
import { digest } from "./submissions";

import { ruleFixture as fixture } from "../test/plan-rules-fixture";
import { SupervisorSessions } from "./supervisor-sessions";
import { expectedFor } from "./supervision-effects";
import { scopeAnswerContext } from "./scope-answer-context";

it("refuses missing rules before any worker reservation and repairs admission without resetting spend", async () => {
  const f = await fixture(), { planRules: _rules, ...input } = await f.input();
  await expect(f.gateway.startWorker(input, f.scope.owner)).rejects.toThrow("rule record");
  expect((await f.store.read()).attempts).toHaveLength(0); expect((await f.store.read()).ruleViolations).toHaveLength(1);
  const other = await f.addScope(2, "other", ["other-build"]); await f.draft(other, [{ id: "other-build" }], true);
  expect((await f.start()).attemptId).toBeTruthy();
});
it.each(["checks", "design", "performance", "longRun", "heavyTests"])("refuses a dispatch contract with missing %s declarations before reserving a worker", async field => {
  const f = await fixture(), record = structuredClone(f.record) as unknown as { nodes: Record<string, unknown>[] };
  delete record.nodes[0]![field];
  await expect(f.rules.import(randomUUID(), record as never, captain)).rejects.toThrow();
  expect((await f.store.read()).attempts).toHaveLength(0);
});
it("retains factual failure and regression repair evidence while preserving immutable failed history", async () => {
  const f = await fixture(), start = await f.start();
  await f.commands.planCommand({ ...await f.input(), command: { op: "record", plan: "rules", node: "build", attempt: start.attemptId!, state: "failed", evidence: "Product assertion crashed." } }, f.scope.owner);
  const failure = (await f.store.read()).ruleFailures![0]!;
  expect(failure.attemptId).toBe(start.attemptId);
  const v = await f.report(start.attemptId!); await f.rules.evidence(randomUUID(), "rule-verification", v, f.scope.owner);
  await expect(f.complete(start.attemptId!)).rejects.toThrow("regression");
  const reproducedFailure = await f.artifact("Reproduced the original assertion crash on the old build"), fixedArtifact = await f.artifact("Same assertion case passed on the fixed build");
  const repaired = { ...v, id: randomUUID(), regressions: [{ failureId: failure.id, caseId: "unit", reproducedFailure, fixedResult: "passed" as const, fixedArtifact }] };
  await f.rules.evidence(randomUUID(), "rule-verification", repaired, f.scope.owner);
  await expect(f.complete(start.attemptId!)).rejects.toThrow("history is immutable");
  await expect(f.rules.command(await f.store.read(), { ...await f.input(), command: { op: "start", plan: "rules", node: "build" } })).resolves.toBeUndefined();
  expect((await f.store.read()).plans[0]!.plan.nodes.build!.state).toBe("failed");
  expect((await f.store.read()).attempts).toHaveLength(1);
});
it("checks real baseline/captures, numbers, counted budget and an isolated matching snapshot; repairing reports creates no worker", async () => {
  const f = await fixture(), baseline = await f.artifact("Reviewed approved baseline and isolated reusable suite snapshot"), node = f.record.nodes[0]!;
  node.design = { applies: true, baseline, captures: [{ viewport: "390x844", state: "ready" }] };
  node.performance = { applies: true, metric: "latency", unit: "ms", threshold: 10, comparison: "at-most", workload: "fixture", environment: "isolated host" };
  node.longRun = { applies: true, sessions: 1, turns: 1, runtimeMs: 60000, deadline: "2099-01-01T00:00:00Z", spend: 10, spendUnit: "cents" };
  node.heavyTests = { applies: true, suite: "heavy", inputs: digest("inputs"), dependencyLock: digest("lock"), toolchain: "node24", platform: "win32", fixtures: digest("fixtures"), baseline, restore: "fresh isolated directory", verifyIsolation: "digest and clean-state inspection" };
  f.record.version++; await f.rules.import(randomUUID(), f.record, captain);
  const start = await f.start(), v = await f.report(start.attemptId!), artifact = await f.artifact("Current-build screenshots, numeric result and fresh heavy-suite check output");
  const attempt = (await f.store.read()).attempts[0]!, at = new Date().toISOString(), elapsed = Date.parse(at) - Date.parse(attempt.reservedAt!);
  const complete = { ...v, at, buildInputs: node.heavyTests.inputs, design: { baseline: baseline.digest, captures: [{ viewport: "390x844", state: "ready", artifact }], verdict: "passed" as const, comparison: artifact },
    performance: { metric: "latency", unit: "ms", workload: "fixture", environment: "isolated host", measured: 8, artifact },
    budget: { startedAt: attempt.reservedAt!, consumedSessions: 1, consumedTurns: 1, consumedMs: elapsed, consumedSpend: 1, remainingSessions: 0, remainingTurns: 0, remainingMs: 60000 - elapsed, remainingSpend: 9, artifact },
    snapshot: { key: snapshotKey(node.heavyTests), baseline: baseline.digest, isolated: true as const, clean: true as const, verified: true as const, restoredForAttempt: attempt.id, provenance: baseline, reused: true, setupMs: 20, result: "passed" as const, resultArtifact: artifact } };
  await f.rules.evidence(randomUUID(), "rule-verification", { ...complete, snapshot: { ...complete.snapshot, key: digest("stale lock") } }, f.scope.owner);
  await expect(f.complete(attempt.id)).rejects.toThrow("snapshot");
  await f.rules.evidence(randomUUID(), "rule-verification", { ...complete, id: randomUUID(), performance: { ...complete.performance, measured: 11 } }, f.scope.owner);
  await expect(f.complete(attempt.id)).rejects.toThrow("performance");
  await f.rules.evidence(randomUUID(), "rule-verification", { ...complete, id: randomUUID() }, f.scope.owner); await f.complete(attempt.id);
  expect((await f.store.read()).attempts).toHaveLength(1);
});
it("a long-run deadline refuses final dispatch and records one durable stop request without claiming cancellation", async () => {
  const f = await fixture(), deadline = new Date(Date.now() + 60000).toISOString();
  f.record.nodes[0]!.longRun = { applies: true, sessions: 1, turns: 1, runtimeMs: 60000, deadline, spend: 10, spendUnit: "cents" };
  f.record.version++; await f.rules.import(randomUUID(), f.record, captain);
  const start = await f.gateway.startWorker(await f.input(), f.scope.owner), future = new PlanRules(f.store, f.home, () => "2099-01-02T00:00:00Z");
  const gateway = new SupervisionGateway(f.store, f.commands, f.home, f.receiver, { enabled: true, rules: future });
  await expect(gateway.dispatch(start.effects!.workspace)).rejects.toThrow("deadline");
  await future.requestStops(); await future.requestStops();
  expect((await f.store.read()).commands.filter(c => c.result.ruleStopRequest)).toHaveLength(1); expect(f.receiver.calls).toHaveLength(0);
});
it("recurring blockers count distinct attempts and need corrective work or retained evidence", async () => {
  const f = await fixture(), start = await f.start(), v = await f.report(start.attemptId!), input = await f.input(), s = await f.store.read();
  const reports = [1, 2].map(() => ({ ...v, id: randomUUID(), attemptId: randomUUID(), blocker: { ...v.blocker, category: "fixture-setup", description: "Setup repeatedly failed" } }));
  await expect(f.rules.command({ ...s, ruleVerifications: reports }, input)).rejects.toThrow("recurring blocker");
  await expect(f.rules.command({ ...s, ruleVerifications: [reports[0]!, { ...reports[0]!, id: randomUUID() }] }, input)).resolves.toBeUndefined();
  const artifact = await f.artifact("Inspected repeat root cause; explicit corrective disposition retained");
  reports[1]!.blocker.disposition = artifact;
  await expect(f.rules.command({ ...s, ruleVerifications: reports }, input)).resolves.toBeUndefined();
});
it.each(["keep-held", "review-budget"])("a true supervisor-cap exception makes one checked scoped question; %s grants no budget or effect", async option => {
  const f = await fixture(); f.record.version++; f.record.supervisorLimits.turns = 1; await f.rules.import(randomUUID(), f.record, captain);
  const sessions = new SupervisorSessions(f.store, f.gateway, f.receiver, { enabled: true, limits: { supervisorSessions: 1, supervisorTurns: 1 },
    globalMateId: async () => "general", budgetRefused: scopeId => f.rules.budgetDecision(scopeId) });
  const actor = { kind: "system" as const, id: "fixture-lifecycle", source: "checked counted owner pass" };
  const turn = await sessions.reserveTurn({ requestId: randomUUID(), scopeId: f.scope.id, epoch: 1, causation: "first counted turn", text: "bounded owner pass" }, actor);
  const s = await f.store.read(), effect = s.effects.find(e => e.id === turn)!, mutation = { kind: "effect" as const, value: { ...effect, state: "cancelled" as const, version: effect.version + 1 } };
  await f.store.transact(expectedFor(s, [mutation]), randomUUID(), [mutation]);
  const second = { requestId: randomUUID(), scopeId: f.scope.id, epoch: 1, causation: "next owner pass", text: "another pass" };
  await expect(sessions.reserveTurn(second, actor)).rejects.toThrow("budget is exhausted");
  await expect(sessions.reserveTurn(second, actor)).rejects.toThrow("budget is exhausted");
  const asked = await f.store.read(); expect(asked.decisions).toHaveLength(1);
  const decision = asked.decisions[0]!, presentation = asked.commands.flatMap(c => c.result.captainDecisions ?? []);
  expect(presentation).toHaveLength(1); expect(presentation[0]).toMatchObject({ format: "firstmate.scoped-captain-decision/1", decisionId: decision.id });
  expect(scopeAnswerContext({ ...asked, backends: asked.backends.map(b => ({ ...b, state: "held" as const })) }, decision)).toBeUndefined();
  await f.commands.answer({ ...scopeAnswerContext(asked, decision)!, submissionId: randomUUID(), option, text: "Retain the actual source and counted spend." }, captain);
  expect((await f.store.read()).effects).toHaveLength(1); expect(f.receiver.calls).toHaveLength(0);
  expect((await f.store.read()).operationHolds.filter(h => h.state === "held")).toHaveLength(option === "keep-held" ? 1 : 0);
});
it("pins updates at final dispatch and preserves exact accepted-request replay without resetting spend", async () => {
  const f = await fixture(), i = await f.input(), started = await f.gateway.startWorker(i, f.scope.owner);
  const updated = { ...f.record, version: 2, supervisorLimits: { sessions: 2, turns: 13 } };
  await f.rules.import(randomUUID(), updated, captain);
  await expect(f.gateway.dispatch(started.effects!.workspace)).rejects.toThrow("rule record");
  expect((await f.gateway.startWorker(i, f.scope.owner)).receipt).toEqual(started.receipt);
  expect((await f.store.read()).attempts).toHaveLength(1); expect(f.receiver.calls).toHaveLength(0);
});
it("requires actual artifact bytes, distinct verifier provenance, same head and attempt, then accepts evidence repair without another worker", async () => {
  const f = await fixture(), start = await f.start(), v = await f.report(start.attemptId!);
  await expect(f.complete(start.attemptId!)).rejects.toThrow("verification required");
  await expect(f.rules.evidence(randomUUID(), "rule-verification", { ...v, verifierId: v.workerId }, f.scope.owner)).rejects.toThrow("distinct");
  await expect(f.rules.evidence(randomUUID(), "rule-verification", { ...v, checks: [{ ...v.checks[0]!, artifact: { ...v.checks[0]!.artifact, digest: "f".repeat(64) } }] }, f.scope.owner)).rejects.toThrow();
  await f.rules.evidence(randomUUID(), "rule-verification", v, f.scope.owner);
  await expect(f.complete(start.attemptId!, "b".repeat(40))).rejects.toThrow("verification required");
  await f.complete(start.attemptId!);
  expect((await f.store.read()).plans[0]!.plan.nodes.build!.state).toBe("done");
  expect((await f.store.read()).attempts).toHaveLength(1);
});
it.each(["check", "design", "performance", "budget", "snapshot", "blocker"])("refuses successful completion for the missing %s rule", async kind => {
  const f = await fixture(), a = await f.artifact(), node = f.record.nodes[0]!;
  if (kind === "design") node.design = { applies: true, baseline: a, captures: [{ viewport: "390x844", state: "ready" }] };
  if (kind === "performance") node.performance = { applies: true, metric: "latency", unit: "ms", threshold: 10, comparison: "at-most", workload: "fixture request", environment: "isolated machine" };
  if (kind === "budget") node.longRun = { applies: true, sessions: 1, turns: 1, runtimeMs: 60000, deadline: "2099-01-01T00:00:00Z", spend: 10, spendUnit: "cents" };
  if (kind === "snapshot") node.heavyTests = { applies: true, suite: "heavy", inputs: digest("inputs"), dependencyLock: digest("lock"), toolchain: "node24", platform: "win32", fixtures: digest("fixtures"), baseline: a, restore: "restore into isolated attempt directory", verifyIsolation: "compare clean snapshot digest" };
  f.record.version++; await f.rules.import(randomUUID(), f.record, captain);
  const start = await f.start(), v = await f.report(start.attemptId!);
  if (kind === "check") v.checks = [];
  if (kind !== "blocker") await f.rules.evidence(randomUUID(), "rule-verification", v, f.scope.owner);
  else { const malformed = { ...v } as Record<string, unknown>; delete malformed.blocker; await expect(f.rules.evidence(randomUUID(), "rule-verification", malformed, f.scope.owner)).rejects.toThrow(); }
  await expect(f.complete(start.attemptId!)).rejects.toMatchObject({ code: "HELD" });
  expect((await f.store.read()).plans[0]!.plan.nodes.build!.state).not.toBe("done");
  expect((await f.store.read()).ruleViolations!.at(-1)?.stage).toBe("completion");
});
it("refuses an unreproduced live failure on the next changed attempt, and never treats command replay as its regression", async () => {
  const f = await fixture(), started = await f.start(), evidence = await f.artifact("Observed old product failure, fixture crash output");
  await f.rules.evidence(randomUUID(), "rule-failure", { format: "firstmate.rule-failure/1", id: randomUUID(), version: 1,
    homeId: f.store.homeId, scopeId: f.scope.id, planId: "rules", nodeId: "build", attemptId: started.attemptId,
    head: "a".repeat(40), at: new Date().toISOString(), category: "product", description: "Live crash", evidence, caseId: null, reproduction: null }, f.scope.owner);
  await expect(f.gateway.startWorker(started.i, f.scope.owner)).resolves.toMatchObject({ attemptId: started.attemptId });
  await expect(f.rules.command(await f.store.read(), { ...await f.input(), requestId: randomUUID() })).rejects.toThrow("reproduced regression");
});
