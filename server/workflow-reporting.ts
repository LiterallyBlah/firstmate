/** Reporting only: accepted outcomes supersede alerts, never alter admission or retained evidence. */
import type { FleetCard } from "../shared/fleet";
import type { RuleViolation } from "../shared/plan-rules";
import type { SupervisionStatus } from "../shared/supervision";
import type { PlanNodeState, WorkflowPlan } from "../shared/workflow-plans";

function accepted(state: PlanNodeState | undefined): state is PlanNodeState & { completedAt: string } {
  return !!state && !state.invalidated && !state.held && ["done", "landed"].includes(state.state) &&
    !!state.evidence?.trim() && !!state.completedAt && Number.isFinite(Date.parse(state.completedAt));
}
function attempts(state: PlanNodeState): PlanNodeState[] {
  return [state, ...(state.priorAttempts ?? []).flatMap(attempts)];
}
export function historicalRuleRefusal(status: SupervisionStatus, refusal: RuleViolation): boolean {
  if (status.freshness !== "current") return false;
  const owners = status.plans.filter(p => p.plan.definition.id === refusal.planId);
  if (owners.length !== 1 || owners[0]!.scopeId !== refusal.scopeId || !status.backends.some(b => b.backend === "scoped" && b.ownerScopeId === refusal.scopeId && b.planId === refusal.planId && b.state === "active")) return false;
  const plan = owners[0]!.plan, state = plan.nodes[refusal.nodeId];
  return plan.status !== "held" && plan.status !== "abandoned" && plan.definition.nodes.some(n => n.id === refusal.nodeId) &&
    accepted(state) && Date.parse(state.completedAt) > Date.parse(refusal.at) &&
    (refusal.attemptId === null || attempts(state).some(a => a.attempt === refusal.attemptId));
}
/** No title joins or inference from a worker's closing line. A reused/ambiguous session stays unknown. */
export function historicalCrewReport(card: FleetCard, plans: readonly WorkflowPlan[]): boolean {
  const agent = card.agent;
  if (!agent || card.remote || !["idle", "closed"].includes(agent.status) || agent.pendingPermissions || agent.lastError) return false;
  // Count attempts, not nodes: a native session may be reused by a replacement within one
  // node, or by work subsequently removed from the plan. Neither association is unique.
  const records = plans.flatMap(plan => [
    ...plan.definition.nodes.map(node => ({ node, state: plan.nodes[node.id], removed: false })),
    ...(plan.removed ?? []).map(({ node, state }) => ({ node, state, removed: true })),
  ].flatMap(({ node, state, removed }) => node.kind === "run" && state
    ? attempts(state).map(attempt => ({ plan, node, state, attempt, removed })) : []));
  const matches = records.filter(record => record.attempt.agentId === agent.id);
  if (matches.length !== 1) return false;
  const { plan, node, state, attempt, removed } = matches[0]!;
  if (removed || !state.attempt?.trim() || !attempt.attempt?.trim() ||
    records.filter(record => record.attempt.attempt === state.attempt).length !== 1 ||
    records.filter(record => record.attempt.attempt === attempt.attempt).length !== 1) return false;
  return node.kind === "run" && node.launch.host.trim().toLowerCase() === "local" && card.taskId === node.id && card.project === node.launch.project &&
    (!card.backlog?.plan || card.backlog.plan === plan.definition.id) &&
    plan.status !== "held" && plan.status !== "abandoned" && accepted(state);
}
