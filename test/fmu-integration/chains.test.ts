/** Same scripted necessary-work schedule over the already-direct production runtime.
 * Native effects are synthetic; no model/provider latency or billing is measured. */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { fixture } from "../fmu-review-runtime-fixture";
import { RuleVerificationSchema } from "../../shared/plan-rules";
import { ruleRef } from "../../server/plan-rules";
import { digest } from "../../server/submissions";
import { expected } from "../supervision-fixture";
import { oneAtATime } from "../../server/mate";
import { supervisorView } from "../../server/supervisor-configuration";
import { summarizeSupervisorCost } from "../../server/supervision-metrics";
import { workflowSnapshot } from "../../server/workflow-board";

it("A9/A10/A12: both checked build/review chains finish while General stays busy; shared status adds zero model work", async () => {
  async function replay(controls: boolean) {
    const f = await fixture(true);
    let release!: () => void, entered!: () => void, generalBusy = true;
    const ready = new Promise<void>(r => { entered = r; }), held = oneAtATime(async () => { entered(); await new Promise<void>(r => { release = r; }); generalBusy = false; }); await ready;
    const checkpoints = [];
    try {
      for (const phase of [0, 1]) {
        const starts = [];
        for (const [i, scope] of f.scopes.entries()) starts.push(await f.queue(scope, "plan", {
          ...await f.input(scope, { op: "start", plan: scope.planId, node: scope.nodes[phase]! }), planRules: ruleRef(f.records[i]!) }));
        await f.service.tick(); for (const id of starts) expect(await f.result(id)).toMatchObject({ ok: true });
        for (const [i, scope] of f.scopes.entries()) {
          const s = await f.store.read(), task = s.tasks.find(t => t.ownerScopeId === scope.id && t.nodeId === scope.nodes[phase])!, attempt = s.attempts.find(a => a.id === task.currentAttempt)!;
          expect(attempt.worker).toBeTruthy();
          const blob = await f.store.putBlob(Buffer.from(`Synthetic verified CI output for ${attempt.id}`));
          await f.store.transact(expected([{ kind: "blob", value: blob }]), randomUUID(), [{ kind: "blob", value: blob }]);
          const artifact = { digest: blob.id, verifier: scope.owner.id, method: "automatic", provenance: `Synthetic independent CI job for ${attempt.id}` };
          const verification = RuleVerificationSchema.parse({ format: "firstmate.rule-verification/1", id: randomUUID(), version: 1, homeId: s.homeId, scopeId: scope.id,
            planId: scope.planId, nodeId: task.nodeId, revision: f.records[i]!.revision, rules: ruleRef(f.records[i]!), attemptId: attempt.id, head: "a".repeat(40), buildInputs: digest(attempt.id),
            at: new Date().toISOString(), verifierId: scope.owner.id, workerId: attempt.worker!.agentId, checks: [{ id: "unit", command: "node check.mjs", result: "passed", artifact }],
            regressions: [], design: null, performance: null, budget: null, snapshot: null, blocker: { category: "none", description: "No blocker", evidence: artifact, correctiveNode: null, disposition: null } });
          const check = await f.queue(scope, "rule-verification", verification); await f.service.tick(); expect(await f.result(check)).toMatchObject({ ok: true });
          const done = await f.queue(scope, "plan", { ...await f.input(scope, { op: "record", plan: scope.planId, node: task.nodeId, attempt: attempt.id, state: "done", evidence: "Verified exact synthetic CI output" }), planRules: ruleRef(f.records[i]!), head: verification.head });
          await f.service.tick(); expect(await f.result(done)).toMatchObject({ ok: true });
          const prior = await f.store.read();
          if (controls) for (let n = 0; n < 100; n++) { supervisorView(prior, scope.id); summarizeSupervisorCost(prior, [], { sessions: 0, turns: 0 }); }
          expect((await f.store.read()).hash).toBe(prior.hash); expect(generalBusy).toBe(true);
          checkpoints.push({ phase, plan: scope.planId, node: task.nodeId, generalBusy, state: "done" });
        }
      }
      const s = await f.store.read(), plans = await workflowSnapshot(f.home, s);
      expect(plans.plans.every(p => Object.values(p.nodes).every(n => n.state === "done"))).toBe(true);
      expect(s.attempts).toHaveLength(4); expect(f.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(6);
      expect(f.receiver.sends.every(send => send.agentId !== "general")).toBe(true);
      const cost = summarizeSupervisorCost(s, [], { sessions: 0, turns: 0 });
      expect(cost.worker).toEqual({ sessions: 4, turns: 4 }); expect(cost.complete).toBe(true);
      expect(cost.uniqueOperations).toBe(cost.operations.length); expect(cost.uncertainOperations).toBe(0);
      return { checkpoints, cost: { ...cost, operations: cost.operations.map(e => ({ operation: e.operation, state: e.state, epoch: e.epoch, hasAttempt: e.attempt !== null })) },
        statusReads: controls ? 400 : 0, paidStatusTurns: 0, generalRoutineTurns: 0,
        liveQueueWait: null, measuredSavings: null, sourceDetectionDelay: null };
    } finally { release(); await held; await f.service.stop(); await f.runtime.stop(); }
  }
  const baseline = await replay(false), proposed = await replay(true);
  expect(proposed.cost).toEqual(baseline.cost); expect(proposed.checkpoints).toEqual(baseline.checkpoints);
  if (process.env.FIRSTMATE_PILOT_EVIDENCE === "1") {
    const out = resolve(".local/fmu-integration"); await mkdir(out, { recursive: true });
    await writeFile(resolve(out, "total-cost-trace.json"), JSON.stringify({
      sourceHead: process.env.FIRSTMATE_PILOT_SOURCE_HEAD ?? null, baseline, proposed,
      schedule: "Two independent local build -> review chains; same rule checks, four successful worker reservations, two configured synthetic owners, General lifecycle lock held throughout.",
      baselineBoundary: "Existing direct scoped runtime, already independent of project model provisioning. Current-source controls off/on comparison; original 27ffa47 baseline remains unchanged. No assumed relay hierarchy or claimed rename saving.",
      observationBoundary: "Model inputs are scripted synthetic outcomes. Count retained reservations across worker/owner/inspector/General; no provider, billing, live model start or human queue-wait sample. Quiet typed ingress and stalled-owner isolation have separate production-path fixtures. No fleet-wide coverage claim."
    }, null, 2));
  }
}, 180000);
