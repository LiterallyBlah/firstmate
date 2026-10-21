import { planFinished, type PlanNode, type PlanNodeState, type WorkflowPlan } from "../shared/workflow-plans";

export const PLAN_PAGE_SIZE = 10;
export const planClosed = (plan: WorkflowPlan) => plan.status === "abandoned" || planFinished(plan);

/** Completion order uses recorded outcomes, rather than the date a plan was drafted. */
export function planActivity(plan: WorkflowPlan): number {
  const dates = [plan.definition.request.at, ...plan.history.map(h => h.at),
    ...(plan.captainEvents ?? []).map(e => e.at), ...Object.values(plan.nodes).map(n => n.completedAt)];
  return Math.max(0, ...dates.map(at => at ? Date.parse(at) || 0 : 0));
}

export function planGroups(plans: readonly WorkflowPlan[], search = "") {
  const term = search.trim().toLowerCase();
  const matches = plans.filter(p => !term || [p.definition.id, p.definition.title, ...p.definition.nodes.flatMap(n => {
    const state = p.nodes[n.id];
    const launch = state?.launch ?? (n.kind === "run" ? n.launch : null);
    return [n.title, state?.agentId ?? "", launch?.agentTitle ?? "", launch?.host ?? ""];
  })].some(value => value.toLowerCase().includes(term)));
  const recent = (a: WorkflowPlan, b: WorkflowPlan) => planActivity(b) - planActivity(a) || a.definition.id.localeCompare(b.definition.id);
  return {
    open: matches.filter(p => !planClosed(p)).sort((a, b) => Number(b.status === "review") - Number(a.status === "review") || recent(a, b)),
    finished: matches.filter(planClosed).sort(recent),
  };
}

export function planStatus(plan: WorkflowPlan): string {
  return plan.status === "abandoned" ? "Declined" : planFinished(plan) ? "Finished" :
    plan.status === "review" ? "Awaiting approval" : plan.status === "held" ? "On hold" : "Active";
}

export function runState(state: PlanNodeState | undefined): string {
  if (!state || state.invalidated) return "uncertain";
  return state.state === "planned" ? "ready" : state.state === "unresolved" ? "uncertain" : state.state;
}

/** spent is cumulative across replacements; priorAttempts must not be counted again. */
export function planBudgetUsed(plan: WorkflowPlan) {
  const states = new Map(Object.entries(plan.nodes));
  for (const removed of plan.removed ?? []) if (!states.has(removed.node.id)) states.set(removed.node.id, removed.state);
  const used = [...states.values()].reduce((sum, state) => sum + (state.spent ?? (state.attempt ? 1 : 0)), 0);
  return { agents: used, turns: used };
}

export function dependencyText(edge: PlanNode["after"][number], plans: readonly WorkflowPlan[]): string {
  const title = plans.flatMap(p => p.definition.nodes).find(n => n.id === edge.node)?.title ?? edge.node;
  const reason = { "builds-on": "needs its code", "needs-evidence": "needs its evidence", "decision": "needs your answer", "shared-state": "shares mutable state" }[edge.reason];
  return `${title} — ${reason}; ${edge.on === "landed" ? "after landing" : edge.on === "answered" ? "once answered" : "once done"}`;
}
