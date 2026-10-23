import type { FleetCard } from "../shared/fleet";
import type { PlanNode, WorkflowPlan } from "../shared/workflow-plans";
import { workflowNodeOwnsCard } from "../shared/workflow-identity";
import { converseKey } from "./converse-layout";

/** Navigation references carry the saved card/host/worker identity, never a title lookup. */
export type WorkflowTaskRequest = { scope: string; plan: string; node: string; card: string; worker?: string };
export function workflowTaskRoute(request: WorkflowTaskRequest) {
  return { screenId: "fleet", params: {
    taskScope: request.scope, taskPlan: request.plan, taskNode: request.node, taskCard: request.card,
    ...(request.worker ? { taskWorker: request.worker } : {}),
  } };
}
export function routeWorkflowTask(params: Readonly<Record<string, string>>): WorkflowTaskRequest | null {
  return params.taskScope && params.taskPlan && params.taskNode && params.taskCard
    ? { scope: params.taskScope, plan: params.taskPlan, node: params.taskNode, card: params.taskCard, ...(params.taskWorker ? { worker: params.taskWorker } : {}) }
    : null;
}

export function workflowTaskTarget(plan: WorkflowPlan, node: PlanNode, cards: readonly FleetCard[]) {
  const matches = cards.filter(card => workflowNodeOwnsCard(plan, node, card));
  const card = matches.length === 1 ? matches[0]! : null;
  if (!card) return { card, worker: null, explanation: matches.length ? "Several task cards match this step. Open the task list to inspect them." : "This step has no matching task card in the current fleet." };
  const recorded = plan.nodes[node.id]?.agentId;
  const worker = card.agent ?? card.remote?.worker;
  const reason = !recorded ? "This step has no recorded worker identity." :
    !worker ? "The recorded worker is missing or archived; its conversation is unavailable." :
    worker.id !== recorded ? "The task card belongs to a different worker attempt; the recorded conversation is unavailable." :
    ["closed", "archived"].includes(worker.status) ? "The recorded worker is closed or archived; its conversation is unavailable." :
    card.remote && !card.remote.serverId ? "The worker's host is no longer saved; its conversation is unavailable." :
    card.remote && !card.remote.online ? `The saved host ${card.remote.host} is unavailable. Converse will be available when it reconnects.` : null;
  return { card, worker: reason ? null : converseKey(card), explanation: reason };
}
