/** Small read interface for C. Counts opening turns and all uncertain reservations. No model wake. */
import type { SupervisionStatus } from "./supervision";
import type { ScopedDecision } from "./supervision-policy";
export function planSupervisorLimits(status: SupervisionStatus, scopeId: string) {
  const plan = status.plans.find(p => p.scopeId === scopeId)?.plan;
  const record = status.planRules?.find(r => r.scopeId === scopeId && r.planId === plan?.definition.id && r.revision === plan.revision);
  const effects = status.effects.filter(e => e.scopeId === scopeId && e.attemptId === null);
  const spent = { sessions: effects.filter(e => e.operation === "agent.create").length, turns: effects.filter(e => e.operation === "agent.send").length };
  return { scopeId, recordId: record?.id ?? null, recordVersion: record?.version ?? null,
    limits: record?.supervisorLimits ?? null, spent,
    remaining: record ? { sessions: Math.max(0, record.supervisorLimits.sessions - spent.sessions), turns: Math.max(0, record.supervisorLimits.turns - spent.turns) } : null,
    uncertain: effects.filter(e => ["dispatching", "accepted", "uncertain"].includes(e.state)).map(e => e.id) };
}
/** Exact checked domain context; presentation never substitutes for this read set. */
export function planBudgetException(status: SupervisionStatus, decision: ScopedDecision) {
  const cap = planSupervisorLimits(status, decision.ownerScopeId), plan = status.plans.find(p => p.scopeId === decision.ownerScopeId)?.plan;
  const command = [...status.commands].reverse().find(c => c.actor.kind === "system" && c.actor.id === "plan-rules" &&
    c.result.budgetException?.decisionId === decision.id && c.result.budgetException.subjectHash === decision.subjectHash);
  const e = command?.result.budgetException;
  const backend = status.backends.find(b => b.planId === decision.planId);
  return e && cap.limits && plan && backend?.backend === "scoped" && backend.state === "active" && backend.ownerScopeId === decision.ownerScopeId && e.scopeId === decision.ownerScopeId && e.planId === decision.planId && e.planHash === plan.hash && e.revision === plan.revision &&
    e.limits.sessions === cap.limits.sessions && e.limits.turns === cap.limits.turns && e.spent.sessions === cap.spent.sessions && e.spent.turns === cap.spent.turns &&
    cap.spent.turns >= cap.limits.turns && status.outbox.some(o => o.id === command.result.outboxId && o.ownerScopeId === e.scopeId && o.causationId === command.id) ? e : undefined;
}
