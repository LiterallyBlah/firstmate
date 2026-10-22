import { attentionCard } from "./attention-deck-fixture";
import { workflowFixture } from "./workflow-fixture";
import type { WorkflowPlan } from "../shared/workflow-plans";

export function workflowTaskFixture(remote = false) {
  const definition = workflowFixture(), node = definition.nodes[0]!;
  if (node.kind !== "run") throw new Error("Expected run fixture");
  if (remote) node.launch.host = "Saved lab";
  const card = attentionCard("task-worker", "working"), worker = card.agent!;
  card.taskId = node.id; card.project = node.launch.project;
  card.title = "A different display title";
  card.backlog = { id: node.id, title: card.title, project: card.project, kind: "scout", mode: null, agentId: worker.id,
    section: "in-flight", plan: definition.id, hold: null, blockedBy: null, since: null, url: null, reportPath: null, outcome: null,
    ...(remote ? { host: "Saved lab" } : {}) };
  if (remote) {
    card.agent = null;
    card.remote = { serverId: "lab-server-id", host: "Saved lab", online: true, clockSkewSeconds: null,
      worker: { id: worker.id, name: worker.title!, status: "running", updatedAt: worker.updatedAt, pendingPermissions: 0, permissionDetails: [], recentTools: [], followed: false } };
  }
  const plan: WorkflowPlan = { definition, revision: 1, sequence: 0, hash: "a".repeat(64), posture: "sail", status: "active",
    approvedBudget: { agents: 2, turns: 2 }, nodes: Object.fromEntries(definition.nodes.map(node => [node.id, { state: "planned" as const }])), told: [], handled: [], history: [] };
  plan.nodes[node.id] = { state: "running", agentId: worker.id, spent: 1 };
  return { plan, node, card, worker };
}
