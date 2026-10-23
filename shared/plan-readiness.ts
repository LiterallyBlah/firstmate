import type { PlanNode, WorkflowPlan } from "./workflow-plans";

/** The same evidence gate is used by the store, Needs you and the plan dialog. */
export function dependenciesMet(node: PlanNode, plans: readonly WorkflowPlan[], unavailable?: ReadonlySet<string>): boolean {
  return node.after.every(edge => {
    if (unavailable?.has(edge.node)) return false;
    const owners = plans.filter(p => p.nodes[edge.node]);
    if (owners.length !== 1) return false;
    const state = owners[0]!.nodes[edge.node];
    if (state?.held || state?.invalidated) return false;
    return edge.on === "answered" ? !!state?.answer : edge.on === "landed" ? state?.state === "landed" : state?.state === "done" || state?.state === "landed";
  });
}

export function planDecisionReady(plan: WorkflowPlan, node: PlanNode, plans: readonly WorkflowPlan[], unavailable?: ReadonlySet<string>): boolean {
  const state = plan.nodes[node.id];
  return node.kind === "decision" && plan.status === "active" && state?.state === "planned" && !state.answer && !state.held && !state.invalidated && dependenciesMet(node, plans, unavailable);
}
