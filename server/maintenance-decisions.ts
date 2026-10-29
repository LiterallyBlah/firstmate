/** Maintenance-origin captain choices. Checked durable context/outbox, separate from C presentation.
 * Neither a choice nor an answer changes a budget, launches work, grants authority or sends to General. */
import type { z } from "zod";
import type { SupervisionActor, SupervisionStatus } from "../shared/supervision";
import type { ScopedDecision, ScopedOutbox } from "../shared/supervision-policy";
import { MaintenanceEscalationSchema, MaintenanceAnswerSchema, type MaintenanceAnswer } from "../shared/maintenance-runtime";
import { ScopedCaptainDecisionSchema } from "../shared/scoped-captain-decision";
import { MaintenanceAnswerContextSchema } from "../shared/maintenance-answer";
import { maintenanceRows, refuse } from "./supervision-resources";
import { expectedFor, stableId } from "./supervision-effects";
import { activationEffects, supervisorSpend } from "./supervisor-sessions";
import { maintenanceAdmission } from "./maintenance-admission";
import { digest } from "./submissions";
import type { SupervisionStore, SupervisionMutation } from "./supervision-store";

const UI: SupervisionActor = { kind: "plugin-ui-unverified", id: "unauthenticated-plugin-call", source: "maintenance answer button (unverified)" };
const SYSTEM: SupervisionActor = { kind: "system", id: "maintenance-runtime", source: "maintenance budget exception origin" };
const result = { planId: null, planHash: null, decisionId: null, outboxId: null };
export const maintenanceAnswerRequest = (outbox: ScopedOutbox) => stableId("maintenance-answer-turn", outbox.id);
export const maintenanceAnswerDelivery = (s: SupervisionStatus, outbox: ScopedOutbox) => s.effects.find(e => e.requestId === maintenanceAnswerRequest(outbox) && e.scopeId === outbox.ownerScopeId && e.attemptId === null && e.operation === "agent.send");
export function maintenanceDecisionCurrent(s: SupervisionStatus, d: ScopedDecision) {
  const context = d.maintenance, job = maintenanceRows(s).jobs.find(j => j.id === context?.jobId), incident = maintenanceRows(s).incidents.find(i => i.id === context?.incidentId);
  return !!context && job?.scopeId === d.ownerScopeId && job.version === context.jobVersion && job.mode === "observe" && job.state === "active" &&
    incident?.jobId === job.id && incident.generation === context.generation && incident.state === "open" &&
    s.scopes.some(scope => scope.id === d.ownerScopeId && scope.kind === "maintenance" && ["active", "held"].includes(scope.state));
}
export function maintenanceCaptainDecisions(s: SupervisionStatus) {
  return s.decisions.filter(d => d.maintenance && d.state === "pending").map(d => maintenanceCaptainDecision(s, d));
}
export function maintenanceAnswerContext(s: SupervisionStatus, d: ScopedDecision) {
  if (s.freshness !== "current" || d.state !== "pending" || !maintenanceDecisionCurrent(s, d)) return undefined;
  return MaintenanceAnswerContextSchema.parse({ homeId: s.homeId, decisionId: d.id, revision: d.revision, subjectHash: d.subjectHash, evidence: d.maintenance!.evidence });
}
export function maintenanceCaptainDecision(s: SupervisionStatus, d: ScopedDecision) {
  return ScopedCaptainDecisionSchema.parse({
    format: "firstmate.scoped-captain-decision/1", homeId: s.homeId, scope: { kind: "maintenance", id: d.ownerScopeId },
    decisionId: d.id, revision: d.revision, subjectHash: d.subjectHash, origin: { kind: "maintenance", id: d.maintenance!.incidentId },
    title: d.title, question: d.question, options: d.options.map((o, i) => ({ ...o, number: i + 1 })), recommendation: d.maintenance!.recommendation,
    evidence: d.maintenance!.evidence, projectIds: s.scopes.find(scope => scope.id === d.ownerScopeId)?.projectIds ?? [],
    permittedActions: maintenanceAnswerContext(s, d) ? ["answer"] : [],
  });
}
export function maintenanceAnswerOwner(s: SupervisionStatus, outbox: ScopedOutbox, generalId: string) {
  const decision = s.decisions.find(d => d.id === outbox.decisionId), scope = s.scopes.find(scope => scope.id === outbox.ownerScopeId), binding = s.bindings.find(b => b.scopeId === scope?.id);
  if (!outbox.maintenance || outbox.state !== "pending" || !decision?.maintenance || decision.state !== "answered" || decision.answer?.outboxId !== outbox.id ||
    scope?.kind !== "maintenance" || scope.state !== "active" || binding?.state !== "active" || binding.purpose === "discussion" || binding.hostId !== "local" ||
    binding.agentId === generalId || activationEffects(s, scope.id, binding.epoch).send?.state !== "succeeded")
    refuse("HELD", "The exact maintenance answer/logical owner is not ready; no General or legacy fallback.");
  return { decision, binding };
}
export class MaintenanceDecisions {
  constructor(private readonly store: SupervisionStore, private readonly checked: (homeId: string) => Promise<unknown>, private readonly now: () => string) {}
  async escalate(requestId: string, actor: SupervisionActor, raw: z.infer<typeof MaintenanceEscalationSchema>, requestHash?: string, automatic = false) {
    const input = MaintenanceEscalationSchema.parse(raw);
    return this.store.transactCommand(requestId, digest(input), actor, async s => {
      await this.checked(s.homeId);
      const incident = maintenanceRows(s).incidents.find(i => i.id === input.incidentId), job = maintenanceRows(s).jobs.find(j => j.id === incident?.jobId);
      const binding = s.bindings.find(b => b.scopeId === job?.scopeId), scope = s.scopes.find(scope => scope.id === job?.scopeId);
      const limits = scope && maintenanceAdmission(s, scope.id)?.limits, scopeBudgetHeld = !!scope && !!limits && supervisorSpend(s, scope.id).turns >= limits.supervisorTurns;
      if (!limits || !job || job.state !== "active" || job.mode !== "observe" || !incident || incident.state !== "open" || incident.generation !== input.generation ||
        scope?.kind !== "maintenance" || scope.state !== "active" || binding?.state !== "active" || binding.purpose === "discussion" || binding.epoch !== input.epoch ||
        activationEffects(s, scope.id, binding.epoch).send?.state !== "succeeded" || (automatic ? actor.kind !== "system" || !scopeBudgetHeld && incident.kind !== "budget" : actor.kind !== "agent" || actor.id !== binding.agentId))
        refuse("UNKNOWN_OWNER", "Only the current verified maintenance owner can escalate this exact open incident; automatic origin is limited to real budget incidents.");
      if (input.kind === "budget" && incident.kind !== "budget" && incident.notify.state !== "held-budget" && !scopeBudgetHeld) refuse("HELD", "A budget choice needs a real job/owner budget hold.");
      const context = { kind: input.kind, jobId: job.id, jobVersion: job.version, incidentId: incident.id, generation: incident.generation,
        ownerEpoch: binding.epoch, ownerAgentId: binding.agentId, recommendation: input.recommendation, evidence: input.evidence };
      const subject = { context, title: `${job.name}: ${input.kind} exception`, question: input.question, options: input.options };
      const id = stableId("maintenance-captain-decision", incident.id, String(incident.generation), input.kind, String(job.version)), prior = s.decisions.find(d => d.id === id);
      const subjectHash = digest(subject);
      if (prior && prior.subjectHash !== subjectHash) refuse("CONFLICT", "This incident exception already has checked context; retain its existing question and evidence.");
      const value: ScopedDecision = { id, version: 1, ownerScopeId: scope.id, planId: job.id, nodeId: incident.id, revision: 1, subjectHash,
        state: "pending", title: subject.title, question: input.question, options: input.options, maintenance: context,
        sourceVector: [{ kind: "maintenance-job", id: job.id, version: job.version, digest: digest(job) },
          { kind: "maintenance-incident", id: incident.id, version: incident.version, digest: digest(incident) }], answer: null };
      const mutations: SupervisionMutation[] = prior ? [] : [
        ...s.decisions.filter(d => d.maintenance?.incidentId === incident.id && d.maintenance.kind === input.kind && d.state === "pending")
          .map(d => ({ kind: "decision" as const, value: { ...d, version: d.version + 1, state: "superseded" as const } })), { kind: "decision", value }];
      return { mutations, expectedVersions: expectedFor(s, mutations), result: { ...result, decisionId: id, ...(requestHash ? { maintenanceRequest: { inputHash: requestHash } } : {}) } };
    });
  }
  async budgets() {
    const s = await this.store.read();
    const candidates = maintenanceRows(s).incidents.filter(i => i.kind === "budget" && i.state === "open");
    for (const scope of s.scopes.filter(scope => scope.kind === "maintenance" && scope.state === "active")) {
      const limits = maintenanceAdmission(s, scope.id)?.limits;
      if (!limits || supervisorSpend(s, scope.id).turns < limits.supervisorTurns || candidates.some(i => maintenanceRows(s).jobs.some(j => j.id === i.jobId && j.scopeId === scope.id)) ||
        s.decisions.some(d => d.ownerScopeId === scope.id && d.maintenance?.kind === "budget" && d.state === "pending")) continue;
      const incident = maintenanceRows(s).incidents.find(i => i.state === "open" && i.notify.state === "pending" && maintenanceRows(s).jobs.some(j => j.id === i.jobId && j.scopeId === scope.id) &&
        !s.effects.some(e => e.requestId === stableId("maintenance-incident-turn", i.id, String(i.generation))));
      if (incident) candidates.push(incident);
    }
    for (const incident of candidates) {
      const job = maintenanceRows(s).jobs.find(j => j.id === incident.jobId), binding = s.bindings.find(b => b.scopeId === job?.scopeId);
      if (!job || job.state !== "active" || job.mode !== "observe" || !binding || binding.state !== "active" || binding.purpose === "discussion" || activationEffects(s, job.scopeId, binding.epoch).send?.state !== "succeeded") continue;
      const requestId = stableId("maintenance-budget-escalation", incident.id, String(incident.generation), String(job.version));
      if (s.commands.some(c => c.id === requestId) || incident.kind === "budget" && job.budget !== null && job.spentTurns < job.budget.turns) continue;
      await this.escalate(requestId, SYSTEM,
        { incidentId: incident.id, generation: incident.generation, epoch: binding.epoch, kind: "budget", question: `${incident.kind === "budget" ? incident.detail : "The captain-approved maintenance owner turn limit is spent."} Keep this job held, or request reviewed budget replanning? An answer does not change the budget or authorize work.`,
          options: [{ id: "keep-held", label: "Keep the budget hold" }, { id: "review-budget", label: "Request reviewed budget replanning" }], recommendation: "keep-held",
          evidence: [{ ref: `maintenance-incident:${incident.id}:${incident.generation}`, digest: digest(incident) },
            { ref: `maintenance-owner-budget:${job.scopeId}`, digest: digest({ limits: maintenanceAdmission(s, job.scopeId)?.limits ?? null, spent: supervisorSpend(s, job.scopeId) }) }] }, undefined, true);
    }
  }
  async answer(raw: MaintenanceAnswer) {
    const input = MaintenanceAnswerSchema.parse(raw);
    await this.checked(input.homeId);
    return this.store.transactCommand(input.submissionId, digest(input), UI, async s => {
      await this.checked(input.homeId);
      if (input.homeId !== s.homeId) refuse("STALE", "Maintenance answer belongs to another home.");
      const d = s.decisions.find(d => d.id === input.decisionId);
      if (!d?.maintenance || !maintenanceDecisionCurrent(s, d) || d.state !== "pending" || d.answer || d.revision !== input.revision ||
        d.subjectHash !== input.subjectHash || digest(d.maintenance.evidence) !== digest(input.evidence) || !d.options.some(o => o.id === input.option))
        refuse("STALE", "The displayed maintenance subject, evidence or options changed; preserve the draft and refresh.");
      const at = this.now(), outbox: ScopedOutbox = { id: input.submissionId, version: 1, ownerScopeId: d.ownerScopeId, planId: d.planId,
        kind: "decision.answer", causationId: input.submissionId, subjectHash: d.subjectHash, decisionId: d.id, at, state: "pending", handledEpoch: null, resultRef: null, maintenance: true };
      const mutations: SupervisionMutation[] = [{ kind: "decision", value: { ...d, version: d.version + 1, state: "answered",
        answer: { submissionId: input.submissionId, option: input.option, text: input.text, at, provenance: UI, outboxId: outbox.id } } }, { kind: "outbox", value: outbox }];
      return { mutations, expectedVersions: expectedFor(s, mutations), result: { ...result, decisionId: d.id, outboxId: outbox.id } };
    });
  }
  async handled(requestId: string, actor: SupervisionActor, input: { outboxId: string; epoch: number; evidence: { ref: string; digest: string }[] }, requestHash: string, generalId: string) {
    return this.store.transactCommand(requestId, digest(input), actor, async s => {
      await this.checked(s.homeId);
      const outbox = s.outbox.find(o => o.id === input.outboxId);
      if (!outbox) refuse("UNKNOWN_OWNER", "Unknown maintenance answer outbox.");
      const { binding } = maintenanceAnswerOwner(s, outbox, generalId), sent = maintenanceAnswerDelivery(s, outbox);
      if (actor.kind !== "agent" || actor.id !== binding.agentId || binding.epoch !== input.epoch || sent?.epoch !== binding.epoch || sent.state !== "succeeded")
        refuse("HELD", "Only the exact successfully notified owner/epoch can record handling; uncertain sends stay pending.");
      const mutations: SupervisionMutation[] = [{ kind: "outbox", value: { ...outbox, version: outbox.version + 1, state: "handled", handledEpoch: binding.epoch,
        resultRef: `maintenance-handled:${requestId}:${digest(input.evidence)}` } }];
      return { mutations, expectedVersions: expectedFor(s, mutations), result: { ...result, decisionId: outbox.decisionId, outboxId: outbox.id,
        maintenanceRequest: { inputHash: requestHash }, handling: { scopeId: binding.scopeId, epoch: binding.epoch,
          outboxes: [{ outboxId: outbox.id, decisionId: outbox.decisionId, causationId: outbox.causationId }] } } };
    });
  }
}
