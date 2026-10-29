import { randomUUID } from "node:crypto";
import { s04Fixture, captain } from "./supervision-s04-fixture";
import { PlanRuleRecordSchema, RuleVerificationSchema, type RuleVerification } from "../shared/plan-rules";
import { PlanRules, ruleRef } from "../server/plan-rules";
import { stableId, SupervisionGateway } from "../server/supervision-effects";
import { SupervisionCommands } from "../server/supervision-commands";
import { policyRef } from "../server/supervision-policy";
import { digest } from "../server/submissions";
import { expected } from "./supervision-fixture";

export async function ruleFixture() {
  const f = await s04Fixture(), scope = await f.addScope(1, "rules", ["build"]);
  await f.draft(scope, [{ id: "build", kind: "ship" }], true);
  const rules = new PlanRules(f.store, f.home), s = await f.store.read(), plan = s.plans[0]!.plan;
  const na = { applies: false as const, reason: "This bounded server-only fixture does not change design, product performance or run a heavy suite." };
  const record = PlanRuleRecordSchema.parse({ format: "firstmate.plan-rules/1", id: stableId("plan-rules", s.homeId, "rules", plan.revision), version: 1,
    homeId: s.homeId, scopeId: scope.id, planId: "rules", revision: plan.revision, sources: [policyRef("policy-source", s.policySources[0]!)],
    supervisorLimits: { sessions: 2, turns: 12 }, nodes: [{ nodeId: "build", checks: [{ id: "unit", command: "npm test", passCriterion: "Exit zero; no failed tests" }],
      design: na, performance: na, longRun: na, heavyTests: na }] });
  await rules.import(randomUUID(), record, captain);
  const commands = new SupervisionCommands(f.store, f.home, { enabled: true, rules });
  const gateway = new SupervisionGateway(f.store, commands, f.home, f.receiver, { enabled: true, rules });
  const input = async () => ({ ...await f.input(scope, { op: "start", plan: "rules", node: "build" }), planRules: ruleRef(record) });
  const start = async () => {
    const i = await input(), started = await gateway.startWorker(i, scope.owner);
    await gateway.dispatch(started.effects!.workspace); await gateway.dispatch(started.effects!.create);
    await gateway.verifyWorker(started.attemptId!); await gateway.dispatch(started.effects!.send);
    return { i, ...started };
  };
  const artifact = async (text = "Independent CI check output: all assertions passed.") => {
    const blob = await f.store.putBlob(Buffer.from(text));
    if (!(await f.store.read()).versions.some(v => v.kind === "blob" && v.id === blob.id)) {
      const mutations = [{ kind: "blob" as const, value: blob }]; await f.store.transact(expected(mutations), randomUUID(), mutations);
    }
    return { digest: blob.id, verifier: scope.owner.id, method: "automatic" as const, provenance: "isolated fixture CI job; exact output retained" };
  };
  async function report(attemptId: string): Promise<RuleVerification> {
    const worker = (await f.store.read()).attempts.find(a => a.id === attemptId)!.worker!, a = await artifact();
    return RuleVerificationSchema.parse({ format: "firstmate.rule-verification/1", id: randomUUID(), version: 1, homeId: s.homeId, scopeId: scope.id, planId: "rules", nodeId: "build",
      revision: plan.revision, rules: ruleRef(record), attemptId, head: "a".repeat(40), buildInputs: digest("build"), at: new Date().toISOString(),
      verifierId: scope.owner.id, workerId: worker.agentId, checks: [{ id: "unit", command: "npm test", result: "passed", artifact: a }], regressions: [], design: null,
      performance: null, budget: null, snapshot: null, blocker: { category: "none", description: "No blocker", evidence: a, correctiveNode: null, disposition: null } });
  }
  async function complete(attemptId: string, head = "a".repeat(40)) {
    return commands.planCommand({ ...await f.input(scope, { op: "record", plan: "rules", node: "build", attempt: attemptId, state: "done", evidence: "Verified CI artifact and independent report." }),
      planRules: ruleRef(record), head }, scope.owner);
  }
  return { ...f, scope, rules, record, commands, gateway, input, start, artifact, report, complete };
}
