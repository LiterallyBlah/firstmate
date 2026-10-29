/** Cooperative evidence gate. Never reauthorizes historical accepted requests or workflow replay. */
import { createHash } from "node:crypto";
import type { SupervisionActor, SupervisionEffect, SupervisionStatus } from "../shared/supervision";
import { PlanRuleRecordSchema, RuleFailureSchema, RuleVerificationSchema, type PlanRuleRecord, type PlanRuleRef, type RuleViolation } from "../shared/plan-rules";
import type { ScopedPlanCommand } from "../shared/scoped-commands";
import { digest } from "./submissions";
import { checkPolicySource, policyRef } from "./supervision-policy";
import { SupervisionError, type SupervisionMutation, type SupervisionStore } from "./supervision-store";
import { readFile, stat } from "node:fs/promises";
import { resolveInHome } from "./files";
import { z } from "zod";
import { planOwner, type WorkflowPlan } from "../shared/workflow-plans";
import { PolicyEvidenceSchema } from "../shared/supervision-policy";
import { planSubjectHash } from "./workflow-plans";
import { planSupervisorLimits } from "../shared/plan-supervisor-limits";
import { ScopedCaptainDecisionSchema } from "../shared/scoped-captain-decision";

const stable = (...parts: unknown[]) => { const h = digest(parts); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const result = { planId: null, planHash: null, decisionId: null, outboxId: null };
const SYSTEM: SupervisionActor = { kind: "system", id: "plan-rules", source: "checked rule refusal" };
export const ruleRef = (r: PlanRuleRecord): PlanRuleRef => ({ id: r.id, version: r.version, digest: digest(r) });
export const ruleSubjectHash = (plan: WorkflowPlan, nodeId: string) => digest({ definition: plan.definition, revision: plan.revision,
  owner: planOwner(plan), ownerEvents: plan.ownerEvents, captainActions: plan.captainEvents?.map(c => c.id) ?? [],
  node: { id: nodeId, attempt: plan.nodes[nodeId]?.attempt, briefHash: plan.nodes[nodeId]?.briefHash, launch: plan.nodes[nodeId]?.launch } });
export const snapshotKey = (r: Extract<PlanRuleRecord["nodes"][number]["heavyTests"], { applies: true }>) =>
  digest({ suite: r.suite, inputs: r.inputs, dependencyLock: r.dependencyLock, toolchain: r.toolchain, platform: r.platform, fixtures: r.fixtures });
class RuleRefusal extends SupervisionError {
  constructor(readonly violation: RuleViolation) { super("HELD", `Plan rules: ${violation.conditions.join("; ")}`); }
}
function expected(s: SupervisionStatus, mutations: SupervisionMutation[]) {
  return mutations.map(m => {
    if (m.kind === "workflow") return { kind: m.kind, id: m.event.plan, version: s.versions.find(v => v.kind === "workflow" && v.id === m.event.plan)?.version ?? 0 };
    if (!("value" in m) || !("id" in m.value)) throw new Error("Rule mutation must be an identified row");
    const id = m.value.id;
    return { kind: m.kind, id, version: s.versions.find(v => v.kind === m.kind && v.id === id)?.version ?? 0 }; });
}
export class PlanRules {
  constructor(readonly store: SupervisionStore, readonly home: string, private readonly now = () => new Date().toISOString()) {}
  private owner(s: SupervisionStatus, scopeId: string, actor: SupervisionActor, project = false) {
    const b = s.bindings.find(b => b.scopeId === scopeId), scope = s.scopes.find(v => v.id === scopeId);
    if (s.freshness !== "current" || !scope || !(scope.kind === "plan" || project && scope.kind === "project") || b?.state !== "active" || b.agentId !== actor.id || actor.kind !== "agent")
      throw new SupervisionError("UNKNOWN_OWNER", "Only the bound plan supervisor may verify its evidence.");
  }
  async artifact(requestId: string, raw: unknown, actor: SupervisionActor) {
    const input = z.object({ scopeId: z.uuid(), file: z.string().min(1).max(1024), digest: z.string().regex(/^[0-9a-f]{64}$/) }).strict().parse(raw);
    const s = await this.store.read();
    if (s.commands.some(c => c.id === requestId)) return this.store.transactCommand(requestId, digest({ artifact: input }), actor, async () => { throw new Error("Expected accepted artifact replay"); });
    const global = actor.kind === "mate-chat";
    if (!global) this.owner(s, input.scopeId, actor, true);
    const path = (await resolveInHome(this.home, input.file)).absolute, before = await stat(path);
    if (!before.isFile() || before.size <= 0 || before.size > 512 * 1024) throw new SupervisionError("HELD", "Artifact must be a nonempty confined file of at most 512 KiB.");
    const bytes = await readFile(path), after = await stat(path);
    if (["size", "mtimeMs", "ctimeMs", "ino"].some(k => before[k as keyof typeof before] !== after[k as keyof typeof after]) || createHash("sha256").update(bytes).digest("hex") !== input.digest)
      throw new SupervisionError("STALE", "Artifact changed from its inspected digest.");
    const blob = await this.store.putBlob(bytes);
    return this.store.transactCommand(requestId, digest({ artifact: input }), actor, async current => {
      if (!global) this.owner(current, input.scopeId, actor, true);
      const mutations: SupervisionMutation[] = current.versions.some(v => v.kind === "blob" && v.id === blob.id) ? [] : [{ kind: "blob", value: blob }];
      return { expectedVersions: expected(current, mutations), mutations, result: { ...result, evidenceArtifact: { digest: blob.id, bytes: blob.bytes } } };
    });
  }
  async import(requestId: string, raw: PlanRuleRecord, actor: SupervisionActor) {
    const record = PlanRuleRecordSchema.parse(raw);
    return this.store.transactCommand(requestId, digest({ rules: record }), actor, async s => {
      const p = s.plans.find(p => p.scopeId === record.scopeId && p.plan.definition.id === record.planId)?.plan;
      if (record.homeId !== s.homeId || p?.revision !== record.revision || record.id !== stable("plan-rules", s.homeId, record.planId, record.revision))
        throw new SupervisionError("STALE", "Rules name the current exact plan revision and deterministic identity.");
      if (!["captain-ui", "mate-chat"].includes(actor.kind)) {
        this.owner(s, record.scopeId, actor);
        const prior = s.planRules?.filter(r => r.scopeId === record.scopeId && r.planId === record.planId && r.revision <= record.revision).sort((a, b) => b.revision - a.revision)[0];
        if (planOwner(p) !== "firstmate" || !prior || digest(prior.sources) !== digest(record.sources) || digest(prior.supervisorLimits) !== digest(record.supervisorLimits) ||
          prior.nodes.some(old => { const next = record.nodes.find(n => n.nodeId === old.nodeId); return next &&
            (["design", "performance", "longRun", "heavyTests"].some(k => digest(old[k as keyof typeof old]) !== digest(next[k as keyof typeof next])) || old.checks.some(c => !next.checks.some(n => digest(n) === digest(c)))); }))
          throw new SupervisionError("HELD", "Delegated repairs may add checks/runs with the same reviewed sources; baseline, applicability, caps or existing criteria changes require reviewed authority.");
      }
      if (p.definition.nodes.filter(n => n.kind === "run").some(n => !record.nodes.some(r => r.nodeId === n.id)) ||
        record.nodes.some(n => !p.definition.nodes.some(d => d.kind === "run" && d.id === n.nodeId)))
        throw new SupervisionError("HELD", "Every current run needs exactly one explicit applicability record.");
      await this.sources(s, record);
      const mutations: SupervisionMutation[] = [{ kind: "plan-rules", value: record }, { kind: "outbox", value: { id: requestId, version: 1,
        ownerScopeId: record.scopeId, planId: record.planId, kind: "plan.command", causationId: requestId, subjectHash: digest(record), decisionId: null,
        at: this.now(), state: "pending", handledEpoch: null, resultRef: null } }];
      for (const decision of s.decisions.filter(d => d.ownerScopeId === record.scopeId && d.state === "pending")) {
        const exception = s.commands.map(c => c.result.budgetException).find(e => e?.decisionId === decision.id && e.subjectHash === decision.subjectHash);
        if (exception && digest(exception.limits) !== digest(record.supervisorLimits)) mutations.push({ kind: "decision", value: { ...decision, version: decision.version + 1, state: "superseded" } });
      }
      return { expectedVersions: expected(s, mutations), mutations, result: { ...result, planId: record.planId, planHash: p.hash, outboxId: requestId } };
    });
  }
  async evidence(requestId: string, kind: "rule-verification" | "rule-failure", raw: unknown, actor: SupervisionActor) {
    const value = kind === "rule-verification" ? RuleVerificationSchema.parse(raw) : RuleFailureSchema.parse(raw);
    return this.store.transactCommand(requestId, digest({ kind, value }), actor, async s => {
      this.owner(s, value.scopeId, actor);
      const task = s.tasks.find(t => t.ownerScopeId === value.scopeId && t.planId === value.planId && t.nodeId === value.nodeId);
      const attempt = s.attempts.find(a => a.id === value.attemptId && a.taskId === task?.id);
      if (value.homeId !== s.homeId || !attempt || !attempt.worker) throw new SupervisionError("HELD", "Evidence names an exact retained worker attempt.");
      if ("verifierId" in value && (value.verifierId !== actor.id || value.workerId !== attempt.worker.agentId || value.verifierId === value.workerId))
        throw new SupervisionError("HELD", "Verification retains the distinct supervisor and worker identities.");
      if (Date.parse(value.at) > Date.parse(this.now()) || attempt.reservedAt && Date.parse(value.at) < Date.parse(attempt.reservedAt)) throw new SupervisionError("STALE", "Evidence timestamp is outside its admitted attempt.");
      await this.artifacts(value);
      const mutation = { kind, value } as SupervisionMutation;
      return { expectedVersions: expected(s, [mutation]), mutations: [mutation], result };
    });
  }
  /** Evidence transport does not create a grant or a captain approval. */
  async policyEvidence(requestId: string, raw: unknown, actor: SupervisionActor) {
    const value = PolicyEvidenceSchema.parse(raw);
    return this.store.transactCommand(requestId, digest({ policyEvidence: value }), actor, async s => {
      this.owner(s, value.scopeId, actor);
      const plan = s.plans.find(p => p.scopeId === value.scopeId)?.plan;
      if (!plan || value.subjectHash !== planSubjectHash(plan)) throw new SupervisionError("STALE", "Policy evidence must name this owner's current exact plan subject.");
      for (const hash of new Set([value.sourceDigest, ...value.reviews.map(r => r.sourceDigest), ...(value.artifactHash ? [value.artifactHash] : [])]))
        if (!(await this.store.readBlob(hash)).length) throw new SupervisionError("HELD", "Policy evidence needs actual nonempty retained artifacts.");
      const mutations: SupervisionMutation[] = [{ kind: "policy-evidence", value }];
      return { expectedVersions: expected(s, mutations), mutations, result };
    });
  }
  async prepareFactual(input: ScopedPlanCommand) {
    const c = input.command;
    if (c.op !== "record" || !["failed", "unresolved"].includes(c.state) || (await this.store.read()).commands.some(v => v.id === input.requestId)) return undefined;
    return this.store.putBlob(Buffer.from(c.evidence));
  }
  factual(s: SupervisionStatus, input: ScopedPlanCommand, blob?: { id: string; bytes: number }): SupervisionMutation[] {
    const c = input.command;
    if (c.op !== "record" || !["failed", "unresolved"].includes(c.state)) return [];
    const id = stable("reported-live-failure", s.homeId, c.plan, c.node, c.attempt, c.state, c.evidence);
    if (s.ruleFailures?.some(f => f.id === id)) return [];
    if (!blob || blob.id !== createHash("sha256").update(c.evidence).digest("hex")) throw new SupervisionError("HELD", "Factual failure artifact must be staged before the checked transaction.");
    return [...(s.versions.some(v => v.kind === "blob" && v.id === blob.id) ? [] : [{ kind: "blob" as const, value: blob }]),
      { kind: "rule-failure", value: RuleFailureSchema.parse({ format: "firstmate.rule-failure/1", id, version: 1, homeId: s.homeId,
        scopeId: input.scopeId, planId: c.plan, nodeId: c.node, attemptId: c.attempt, head: input.head, at: this.now(),
        category: `reported-${c.state}`, description: "Factual worker outcome retained; diagnose and reproduce before another changed attempt.",
        evidence: { digest: blob.id, verifier: "bound-plan-owner", method: "model", provenance: "Checked factual plan.record; report text is evidence of the report, not independent proof of a fix." }, caseId: null, reproduction: null }) }];
  }
  private async sources(s: SupervisionStatus, r: PlanRuleRecord) {
    const superseded = new Set(s.policySources.flatMap(v => v.supersedes));
    for (const ref of r.sources) {
      const source = s.policySources.find(v => v.id === ref.id);
      if (!source || superseded.has(source.id) || digest(policyRef("policy-source", source)) !== digest(ref))
        throw new SupervisionError("STALE", "Rule source was superseded or changed.");
      await checkPolicySource(this.home, source);
    }
  }
  private async artifacts(value: unknown): Promise<void> {
    if (!value || typeof value !== "object") return;
    if ("digest" in value && "verifier" in value) {
      const a = value as { digest: string; verifier: string };
      const bytes = await this.store.readBlob(a.digest);
      if (!bytes.length || createHash("sha256").update(bytes).digest("hex") !== a.digest)
        throw new SupervisionError("HELD", "Actual check/capture artifact is empty or changed.");
      return;
    }
    for (const v of Object.values(value)) await this.artifacts(v);
  }
  /** Facts, not completions: each observed failed turn keeps one stable regression obligation. */
  async observeFailures() {
    const s = await this.store.read();
    let observed = 0;
    for (const event of s.inbox.events) {
      if (observed >= 16) break;
      const assignment = s.inbox.assignments.find(a => a.id === event.id && a.id === a.primaryEventId && a.scopeId && a.attemptId);
      const attempt = s.attempts.find(a => a.id === assignment?.attemptId), task = s.tasks.find(t => t.id === attempt?.taskId);
      if (!assignment?.scopeId || !attempt || !task || s.ruleFailures?.some(f => f.id === stable("live-failure", event.consequenceKey))) continue;
      const blob = event.envelope.evidence[0]?.digest;
      if (!blob) continue;
      const bytes = await this.store.readBlob(blob);
      let payload: unknown;
      try { payload = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { continue; }
      if (!payload || typeof payload !== "object" || !("kind" in payload) || payload.kind !== "failed") continue;
      const value = RuleFailureSchema.parse({ format: "firstmate.rule-failure/1", id: stable("live-failure", event.consequenceKey), version: 1,
        homeId: s.homeId, scopeId: assignment.scopeId, planId: task.planId, nodeId: task.nodeId, attemptId: attempt.id,
        head: event.envelope.subject.head ?? null, at: event.envelope.observedAt, category: "failed-live-turn", description: "Observed failed worker turn; diagnose and reproduce before a changed retry.",
        evidence: { digest: blob, verifier: "scoped-ingress", method: "automatic", provenance: `reported native turn event ${event.id}; failure cause requires supervisor diagnosis` }, caseId: null, reproduction: null });
      await this.store.transactCommand(value.id, digest(value), SYSTEM, async current => {
        const mutations: SupervisionMutation[] = [{ kind: "rule-failure", value }];
        return { expectedVersions: expected(current, mutations), mutations, result };
      });
      observed++;
    }
  }
  /** Existing-clock checkpoints request a checked stop; they never claim native cancellation. */
  async requestStops() {
    const s = await this.store.read(), notified: string[] = [];
    for (const task of s.tasks) {
      const p = s.plans.find(p => p.scopeId === task.ownerScopeId && p.plan.definition.id === task.planId)?.plan,
        attempt = s.attempts.find(a => a.id === task.currentAttempt), record = s.planRules?.find(r => r.scopeId === task.ownerScopeId && r.planId === task.planId && r.revision === p?.revision),
        limits = record?.nodes.find(n => n.nodeId === task.nodeId)?.longRun;
      if (!attempt || !record || !p || !["starting", "running"].includes(p.nodes[task.nodeId]?.state ?? "") || !limits?.applies) continue;
      const checkpoint = s.ruleVerifications?.filter(v => v.attemptId === attempt.id).at(-1)?.budget;
      if (Date.parse(this.now()) < Date.parse(limits.deadline) && attempt.reservedAt && Date.parse(this.now()) - Date.parse(attempt.reservedAt) < limits.runtimeMs &&
        (!checkpoint || checkpoint.remainingMs > 0 && checkpoint.remainingSpend > 0 && checkpoint.remainingSessions > 0 && checkpoint.remainingTurns > 0)) continue;
      const id = stable("rule-stop-request", attempt.id, ruleRef(record));
      if (s.commands.some(c => c.id === id)) continue;
      const reason = "Long-run bounds exhausted or checkpoint unavailable: hold new paid effects and request checked stop/reconciliation of the exact admitted worker. Native cancellation is unverified.";
      await this.store.transactCommand(id, digest({ attempt: attempt.id, rules: ruleRef(record) }), SYSTEM, async current => {
        if (current.tasks.find(t => t.id === task.id)?.currentAttempt !== attempt.id || !current.planRules?.some(r => digest(ruleRef(r)) === digest(ruleRef(record)))) throw new SupervisionError("STALE", "Attempt or rule bounds changed before its stop request.");
        const mutations: SupervisionMutation[] = [{ kind: "rule-violation", value: { format: "firstmate.rule-violation/1", id, version: 1, homeId: s.homeId,
          scopeId: task.ownerScopeId, planId: task.planId, nodeId: task.nodeId, attemptId: attempt.id, stage: "dispatch", subjectHash: ruleSubjectHash(p, task.nodeId), rules: ruleRef(record), conditions: [reason], at: this.now() } },
          { kind: "outbox", value: { id, version: 1, ownerScopeId: task.ownerScopeId, planId: task.planId, kind: "policy.hold", causationId: id,
            subjectHash: p.hash, decisionId: null, at: this.now(), state: "pending", handledEpoch: null, resultRef: null } }];
        return { expectedVersions: expected(current, mutations), mutations, result: { ...result, planId: task.planId, planHash: p.hash, outboxId: id,
          ruleStopRequest: { scopeId: task.ownerScopeId, attemptId: attempt.id, ruleId: record.id, ruleVersion: record.version, reason } } };
      });
      notified.push(task.ownerScopeId);
    }
    return notified;
  }
  /** A fixed, actual budget exception, never a routine rule repair or a budget grant. */
  async budgetDecision(scopeId: string): Promise<void> {
    const initial = await this.store.read(), cap = planSupervisorLimits(initial, scopeId), scope = initial.scopes.find(s => s.id === scopeId);
    const plan = initial.plans.find(p => p.scopeId === scopeId)?.plan;
    if (scope?.kind !== "plan" || !plan || !cap.limits || cap.spent.turns < cap.limits.turns) return;
    const counted = { scopeId, limits: cap.limits, spent: cap.spent }, subject = { ...counted, planHash: plan.hash }, requestId = stable("supervisor-budget-exception", subject);
    await this.store.transactCommand(requestId, digest(subject), SYSTEM, async s => {
      const current = planSupervisorLimits(s, scopeId), own = s.scopes.find(v => v.id === scopeId), binding = s.bindings.find(b => b.scopeId === scopeId), p = s.plans.find(p => p.scopeId === scopeId)?.plan;
      if (!p || own?.state !== "active" || binding?.state !== "active" || !current.limits || digest({ scopeId, limits: current.limits, spent: current.spent, planHash: p.hash }) !== digest(subject))
        throw new SupervisionError("STALE", "Budget or owner changed before its scoped exception.");
      const nodeId = `supervisor-budget-${digest(counted).slice(0, 24)}`, id = stable(scopeId, p.definition.id, nodeId), old = s.decisions.find(d => d.id === id);
      if (old?.answer) return { expectedVersions: [], mutations: [], result: { ...result, decisionId: id } };
      const hash = digest(subject), at = this.now(), record = s.planRules!.find(r => r.id === current.recordId)!;
      const question = `This supervisor has reserved ${current.spent.sessions} sessions and ${current.spent.turns} turns against limits ${current.limits.sessions}/${current.limits.turns}. Keep this scope held, or review a source-bound budget revision? Answering alone grants no paid effect or extra budget.`;
      const presentation = ScopedCaptainDecisionSchema.parse({ format: "firstmate.scoped-captain-decision/1", homeId: s.homeId,
        scope: { kind: "plan", id: scopeId }, decisionId: id, revision: p.revision, subjectHash: hash, origin: { kind: "plan", id: p.definition.id },
        title: "Plan supervisor budget exhausted", question, options: [{ number: 1, id: "keep-held", label: "Keep this scope held" }, { number: 2, id: "review-budget", label: "Review a source-bound budget revision" }],
        recommendation: "keep-held", evidence: [{ ref: `plan-rules:${record.id}@${record.version}`, digest: digest(record) }], projectIds: own.projectIds, permittedActions: ["answer"] });
      const mutations: SupervisionMutation[] = [{ kind: "decision", value: { id, version: (old?.version ?? 0) + 1, ownerScopeId: scopeId, planId: p.definition.id,
        nodeId, revision: p.revision, subjectHash: hash, state: "pending", title: presentation.title, question: presentation.question, options: presentation.options.map(({ id, label }) => ({ id, label })),
        sourceVector: [{ kind: "plan-rules", ...ruleRef(record) }], answer: null } },
        { kind: "outbox", value: { id: requestId, version: 1, ownerScopeId: scopeId, planId: p.definition.id, kind: "policy.hold", causationId: requestId,
          subjectHash: p.hash, decisionId: null, at, state: "pending", handledEpoch: null, resultRef: null } }];
      return { expectedVersions: expected(s, mutations), mutations, result: { planId: p.definition.id, planHash: p.hash, decisionId: id, outboxId: requestId, captainDecisions: [presentation],
        budgetException: { ...counted, planId: p.definition.id, decisionId: id, subjectHash: hash, planHash: p.hash, revision: p.revision, rules: ruleRef(record) } } };
    });
  }
  async command(s: SupervisionStatus, input: ScopedPlanCommand) {
    const c = input.command;
    if (!["start", "implicit", "claim", "record", "close", "replace", "validate"].includes(c.op)) return;
    if (c.op === "record" && !["done", "landed"].includes(c.state)) return; // Factual failures never become successes by omission.
    const planId = c.op === "implicit" ? c.launch.id : "plan" in c ? c.plan : "";
    const nodeId = c.op === "implicit" ? c.launch.id : "node" in c ? c.node ?? "" : "";
    const attemptId = c.op === "replace" ? null : "attempt" in c ? c.attempt ?? null : null;
    if (c.op === "replace" && !(s.ruleVerifications ?? []).some(v => v.attemptId === c.attempt && v.scopeId === input.scopeId)) {
      await this.check(s, { scopeId: input.scopeId, planId, nodeId, revision: input.revision, ref: input.planRules, head: input.head, subjectHash: input.subjectHash ?? digest(c), attemptId: null, stage: "dispatch", condition: "prior attempt report with its biggest blocker is required before replacement" });
    }
    if (c.op === "replace" && c.kind === "promote") await this.check(s, { scopeId: input.scopeId, planId, nodeId, revision: input.revision,
      ref: input.planRules, head: input.head, subjectHash: input.subjectHash ?? digest(c), attemptId: c.attempt, stage: "completion" });
    await this.check(s, { scopeId: input.scopeId, planId, nodeId, revision: input.revision, ref: input.planRules,
      head: input.head, subjectHash: input.subjectHash ?? digest(c), attemptId,
      stage: c.op === "record" || c.op === "close" || c.op === "validate" ? "completion" : "dispatch" });
  }
  async effect(s: SupervisionStatus, e: SupervisionEffect) {
    if (!e.attemptId || ["agent.interrupt", "agent.archive"].includes(e.operation)) return;
    const a = s.attempts.find(a => a.id === e.attemptId), t = s.tasks.find(t => t.id === a?.taskId);
    if (!t) throw new SupervisionError("HELD", "Rule admission requires the retained task.");
    const p = s.plans.find(p => p.plan.definition.id === t.planId)?.plan;
    await this.check(s, { scopeId: e.scopeId, planId: t.planId, nodeId: t.nodeId, revision: p?.revision ?? 0,
      ref: e.planRules, head: null, subjectHash: e.subjectHash, attemptId: e.attemptId, stage: "dispatch",
      condition: !p || e.ruleSubjectHash !== ruleSubjectHash(p, t.nodeId) ? "plan subject changed since this worker admission" : undefined });
  }
  private async check(s: SupervisionStatus, target: { scopeId: string; planId: string; nodeId: string; revision: number;
    ref?: PlanRuleRef | undefined; head: string | null; subjectHash: string; attemptId: string | null; stage: "dispatch" | "completion"; condition?: string | undefined }) {
    const r = s.planRules?.find(r => r.planId === target.planId && r.scopeId === target.scopeId && r.revision === target.revision);
    const n = r?.nodes.find(n => n.nodeId === target.nodeId), conditions: string[] = target.condition ? [target.condition] : [];
    if (!r || !n || !target.ref || digest(target.ref) !== digest(ruleRef(r))) conditions.push("current source-bound rule record and digest required");
    if (r && n) {
      try { await this.sources(s, r); await this.artifacts(n); } catch (error) { conditions.push(error instanceof Error ? error.message : String(error)); }
      const failures = s.ruleFailures?.filter(f => f.planId === target.planId && f.nodeId === target.nodeId && (target.stage === "completion" || f.attemptId !== target.attemptId)) ?? [];
      for (const f of failures) {
        const resolution = (s.ruleVerifications ?? []).filter(v => v.attemptId === f.attemptId).flatMap(v => v.regressions).find(r => r.failureId === f.id);
        const caseId = f.caseId ?? resolution?.caseId, reproduced = f.reproduction ?? resolution?.reproducedFailure;
        if (!caseId || !reproduced || !n.checks.some(c => c.id === caseId)) conditions.push(`failure ${f.id} needs its reproduced regression case in the next attempt`);
      }
      const prior = [...new Map((s.ruleVerifications ?? []).filter(v => v.planId === target.planId && v.nodeId === target.nodeId && v.attemptId !== target.attemptId).map(v => [v.attemptId, v])).values()];
      const category = prior.at(-1)?.blocker.category;
      if (category && category !== "none" && prior.filter(v => v.blocker.category === category).length >= 2 &&
        !prior.at(-1)?.blocker.disposition && !s.plans.some(p => p.plan.definition.nodes.some(d => d.kind === "run" && d.id !== target.nodeId && d.id === prior.at(-1)?.blocker.correctiveNode)))
        conditions.push(`recurring blocker ${category} needs corrective work or evidenced disposition`);
      if (n.longRun.applies && target.stage === "dispatch") {
        const attempt = s.attempts.find(a => a.id === target.attemptId);
        const checkpoint = s.ruleVerifications?.filter(v => v.attemptId === target.attemptId).at(-1)?.budget;
        if (checkpoint?.remainingSpend === 0) conditions.push("reported long-run spend exhausted; request checked stop/reconciliation");
        if (Date.parse(this.now()) >= Date.parse(n.longRun.deadline) || attempt && (!attempt.reservedAt || Date.parse(this.now()) - Date.parse(attempt.reservedAt) >= n.longRun.runtimeMs)) conditions.push("long-run deadline/runtime exhausted; request checked stop/reconciliation");
      }
      if (target.stage === "completion") {
        const task = s.tasks.find(t => t.ownerScopeId === target.scopeId && t.planId === target.planId && t.nodeId === target.nodeId);
        for (const binding of s.sources.bindings.filter(b => b.state === "active" && b.scopeId === target.scopeId && b.taskId === task?.id)) {
          const latest = s.inbox.events.filter(e => e.envelope.subject.repositoryId === binding.repository && e.envelope.subject.pr === binding.pr && e.envelope.subject.head).at(-1);
          if (!latest || latest.envelope.subject.head !== target.head || s.inbox.sources.some(source => source.scopeId === target.scopeId &&
            ["pr", "watch"].includes(source.kind) && source.gaps.some(g => g === "fetch-failed" || g === "queue-pressure")))
            conditions.push("bound PR head is changed, unknown or gapped; refresh current-build evidence before completion");
        }
        const v = (s.ruleVerifications ?? []).filter(v => v.planId === target.planId && v.nodeId === target.nodeId && v.attemptId === target.attemptId).at(-1);
        if (!v || v.head !== target.head || v.revision !== target.revision || digest(v.rules) !== digest(target.ref)) conditions.push("current head/attempt/rules verification required");
        else {
          try { await this.artifacts(v); } catch { conditions.push("verification artifacts unavailable"); }
          for (const check of n.checks) if (!v.checks.some(c => c.id === check.id && c.command === check.command && c.result === "passed")) conditions.push(`automatic check ${check.id} has not passed`);
          for (const f of failures) {
            const old = (s.ruleVerifications ?? []).filter(v => v.attemptId === f.attemptId).flatMap(v => v.regressions).find(r => r.failureId === f.id);
            if (!v.regressions.some(r => r.failureId === f.id && r.caseId === (f.caseId ?? old?.caseId) && r.fixedResult === "passed" && digest(r.reproducedFailure) === digest(f.reproduction ?? old?.reproducedFailure))) conditions.push(`regression ${f.id} has not passed on this fix`);
          }
          if (n.design.applies && (!v.design || v.design.baseline !== n.design.baseline.digest || v.design.verdict !== "passed" || n.design.captures.some(c => !v.design!.captures.some(a => a.viewport === c.viewport && a.state === c.state)))) conditions.push("approved baseline comparison and required current-build captures must pass");
          if (n.performance.applies) {
            const p = n.performance, actual = v.performance;
            if (!actual || actual.measured === null || actual.metric !== p.metric || actual.unit !== p.unit || actual.workload !== p.workload || actual.environment !== p.environment ||
              (p.comparison === "at-most" ? actual.measured > p.threshold : actual.measured < p.threshold)) conditions.push("numerical performance target is missing or failed");
          }
          if (n.longRun.applies) {
            const b = v.budget, limits = n.longRun, a = s.attempts.find(a => a.id === target.attemptId);
            if (!b || !a?.reservedAt || b.startedAt !== a.reservedAt || b.consumedMs < Date.parse(v.at) - Date.parse(b.startedAt) || Date.parse(v.at) > Date.parse(limits.deadline) || b.consumedSessions < (a?.spentAgents ?? 1) || b.consumedTurns < (a?.spentTurns ?? 1) || b.consumedSessions + b.remainingSessions !== limits.sessions || b.consumedTurns + b.remainingTurns !== limits.turns ||
              b.consumedMs + b.remainingMs !== limits.runtimeMs || b.consumedSpend + b.remainingSpend !== limits.spend || Date.parse(v.at) - Date.parse(b.startedAt) > limits.runtimeMs)
              conditions.push("counted consumed/remaining long-run budget checkpoint required");
          }
          if (n.heavyTests.applies && (!v.snapshot || v.snapshot.key !== snapshotKey(n.heavyTests) || v.snapshot.baseline !== n.heavyTests.baseline.digest || v.snapshot.restoredForAttempt !== v.attemptId || v.snapshot.result !== "passed" || v.buildInputs !== n.heavyTests.inputs || v.snapshot.resultArtifact.digest === n.heavyTests.baseline.digest)) conditions.push("isolated verified matching warm snapshot and fresh suite result required");
        }
      }
    }
    if (conditions.length) {
      const violation: RuleViolation = { format: "firstmate.rule-violation/1", id: stable("rule-violation", s.homeId, target, conditions), version: 1,
        homeId: s.homeId, scopeId: target.scopeId, planId: target.planId, nodeId: target.nodeId, attemptId: target.attemptId,
        stage: target.stage, subjectHash: target.subjectHash, rules: target.ref ?? null, conditions: conditions.slice(0, 64), at: this.now() };
      throw new RuleRefusal(violation);
    }
  }
  /** Called outside the failed admission transaction; a refusal never loses factual progress/spend. */
  async refused(error: unknown): Promise<never> {
    if (error instanceof RuleRefusal) {
      const v = error.violation;
      if (!(await this.store.read()).ruleViolations?.some(r => r.id === v.id)) {
        await this.store.transactCommand(v.id, digest({ violation: { ...v, at: null } }), SYSTEM, async s => {
          const mutations: SupervisionMutation[] = [{ kind: "rule-violation", value: v }];
          return { expectedVersions: expected(s, mutations), mutations, result };
        });
      }
    }
    throw error;
  }
}
