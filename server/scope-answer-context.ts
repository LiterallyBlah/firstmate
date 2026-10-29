import type { SupervisionStatus } from "../shared/supervision";
import type { ScopedDecision } from "../shared/supervision-policy";
import { ScopedAnswerContextSchema } from "../shared/scoped-commands";
import { currentPolicyVector } from "./supervision-policy";
import { planBudgetException } from "../shared/plan-supervisor-limits";

/** The displayed decision pins S03's actual read set. An answer never substitutes new vectors. */
export function scopeAnswerContext(status: SupervisionStatus, decision: ScopedDecision) {
  const scope = status.scopes.find(s => s.id === decision.ownerScopeId), binding = status.bindings.find(b => b.scopeId === scope?.id);
  const plan = status.plans.find(p => p.scopeId === scope?.id && p.plan.definition.id === decision.planId)?.plan;
  const node = plan?.definition.nodes.find(n => n.id === decision.nodeId);
  const hostId = status.tasks.find(t => t.ownerScopeId === scope?.id && t.planId === decision.planId && t.nodeId === decision.nodeId)?.hostId ?? binding?.hostId;
  if (!scope || !plan || !hostId || !node && !planBudgetException(status, decision)) return undefined;
  const bindings = (node?.after ?? []).map(e => {
    const candidates = status.plans.filter(p => p.plan.definition.nodes.some(n => n.id === e.node));
    if (candidates.length !== 1) return null;
    const p = candidates[0]!.plan;
    return { homeId: status.homeId, planId: p.definition.id, nodeId: e.node, outcome: e.on, planHash: p.hash, revision: p.revision, attemptId: p.nodes[e.node]?.attempt ?? null };
  });
  if (bindings.some(b => b === null)) return undefined;
  const target = { scopeId: scope.id, planId: plan.definition.id, projectIds: scope.projectIds, hostId };
  return ScopedAnswerContextSchema.parse({ homeId: status.homeId, scopeId: scope.id, epoch: binding?.epoch ?? 1, scopeVersion: scope.version,
    expectedPlanHash: plan.hash, revision: decision.revision, subjectHash: decision.subjectHash, decisionId: decision.id,
    dependencyBindings: bindings, policyVector: currentPolicyVector(status, { ...target, operation: "decision.answer" }),
    modelPolicyVector: currentPolicyVector(status, { ...target, operation: "model.use" }), evidenceVector: [], approvalId: null, head: null, artifactHash: null, briefHash: null });
}
