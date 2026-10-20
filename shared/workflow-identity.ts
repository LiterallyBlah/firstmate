import type { FleetCard } from "./fleet";
import type { PlanNode, WorkflowPlan } from "./workflow-plans";
const norm = (s: string) => s.trim().toLowerCase();
/** A plan association and its full host/project/task scope are all required. */
export function workflowNodeOwnsCard(plan: WorkflowPlan, node: PlanNode, card: FleetCard): boolean {
  if (card.backlog?.plan !== plan.definition.id || card.taskId !== node.id) return false;
  if (node.kind === "decision") return !card.project && !card.remote && !card.backlog.host;
  if (card.project !== node.launch.project) return false;
  const host = norm(node.launch.host);
  return host === "local" ? !card.remote && (!card.backlog.host || norm(card.backlog.host) === "local") :
    !!card.remote && [card.remote.serverId, card.backlog.host].some(value => value && norm(value) === host);
}
export const workflowOwnsCard = (plan: WorkflowPlan, card: FleetCard) => plan.definition.nodes.some(node => workflowNodeOwnsCard(plan, node, card));
