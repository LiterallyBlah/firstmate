import { join, resolve } from "node:path";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import type { PlanNeed, WorkflowSnapshot } from "../shared/workflow-rpc";
import { dependenciesMet, planSubjectHash } from "./workflow-plans";
import { pluginDir } from "./data-dir";
import { digest } from "./submissions";
import type { FleetCard } from "../shared/fleet";
import { parseBacklog } from "./backlog";
import { planBacklogLine, WorkflowPlanStore } from "./workflow-plans";
import { planFinished } from "../shared/workflow-plans";
const workflowStore = (home: string) => new WorkflowPlanStore(join(pluginDir(), "workflow-plans"), home);

export const workflowHomeId = (home: string) => digest(resolve(home));
export async function workflowSnapshot(home: string): Promise<WorkflowSnapshot> {
  const plans = await workflowStore(home).list(), now: PlanNeed[] = [], comingUp: PlanNeed[] = [];
  for (const plan of plans) {
    if (plan.status === "abandoned" || planFinished(plan) || plan.definition.implicit) continue;
    if (plan.status === "review") now.push({ plan: plan.definition.id, title: plan.definition.title, question: "Approve this plan", waits: [], neededBy: [], recommendation: "Review the runs, dependencies and budget." });
    for (const node of plan.definition.nodes) {
      if (node.kind !== "decision" || plan.nodes[node.id]?.answer) continue;
      const need = { plan: plan.definition.id, node: node.id, title: plan.definition.title, question: node.title,
        waits: node.after.map(d => plans.flatMap(p => p.definition.nodes).find(n => n.id === d.node)?.title ?? d.node),
        neededBy: plan.definition.nodes.filter(n => n.after.some(d => d.node === node.id)).map(n => n.title),
        recommendation: `${node.options.find(o => o.id === node.recommendation)?.label ?? "None yet"} — ${node.rationale}` };
      (dependenciesMet(node, plans) ? now : comingUp).push(need);
    }
  }
  return { homeId: workflowHomeId(home), version: digest(plans.map(p => p.hash)), plans,
    subjects: Object.fromEntries(plans.map(p => [p.definition.id, planSubjectHash(p)])), now, comingUp };
}

/** Add planned decisions without double-counting their backlog projections. Future choices never count. */
export async function withWorkflowNeeds(snapshot: NeedsYouSnapshot, home: string): Promise<NeedsYouSnapshot> {
  const workflow = await workflowSnapshot(home);
  if (!workflow.plans.length) return snapshot;
  const ids = new Set(workflow.plans.flatMap(p => p.definition.nodes.filter(n => n.kind === "decision").map(n => n.id)));
  const removed = snapshot.requests.filter(r => ids.has(r.source.taskId));
  return { ...snapshot, requests: snapshot.requests.filter(r => !ids.has(r.source.taskId)), parked: snapshot.parked.filter(r => !ids.has(r.taskId)),
    actionCount: snapshot.actionCount === null ? null : Math.max(0, snapshot.actionCount - removed.filter(r => r.state === "new" || r.state === "seen").length) + workflow.now.length,
    newCount: snapshot.newCount === null ? null : Math.max(0, snapshot.newCount - removed.filter(r => r.state === "new").length),
    planNow: workflow.now, comingUp: workflow.comingUp };
}

/** Log-owned planned runs remain visible while the first mate reconciles its backlog. No fake workers. */
export async function withWorkflowCards(cards: FleetCard[], home: string): Promise<FleetCard[]> {
  const result = [...cards];
  for (const plan of await workflowStore(home).list()) {
    if (plan.status === "abandoned") {
      for (let i = result.length - 1; i >= 0; i--) {
        const card = result[i]!;
        if (card.backlog?.plan === plan.definition.id && card.column === "queued" && !card.agent && !card.remote?.worker && !card.backlog.agentId) result.splice(i, 1);
      }
      continue;
    }
    if (plan.definition.implicit) continue;
    for (const node of plan.definition.nodes) {
      if (node.kind !== "run") continue;
      const state = plan.nodes[node.id]!, existing = result.find(c => c.taskId === node.id);
      const column = ["done", "landed", "cancelled"].includes(state.state) ? "done" : state.state === "failed" ? "failed" : state.state === "planned" ? "queued" : "working";
      const backlog = parseBacklog(`## ${column === "done" ? "Done" : column === "queued" ? "Queued" : "In flight"}\n${planBacklogLine(plan, node)}`)[0]!;
      const note = plan.status === "review" ? "awaiting your approval" : plan.status === "held" ? "plan held" : node.after.length ? `after ${node.after.map(d => d.node).join(", ")}` : "planned";
      if (existing) {
        existing.backlog = { ...backlog, ...(existing.backlog ?? {}), plan: plan.definition.id };
        if (!existing.agent && !existing.remote?.worker) { existing.column = column; existing.note = note; }
      } else result.push({ key: `plan:${plan.definition.id}:${node.id}`, taskId: node.id, title: node.title, project: node.launch.project, kind: node.launch.kind, column, backlog, agent: null, report: null, url: null, note });
    }
  }
  return result;
}

export async function workflowBearings(home: string): Promise<string> {
  const snapshot = await workflowSnapshot(home);
  if (!snapshot.plans.length) return "";
  const now = snapshot.now.map(n => `- ${n.title}: ${n.question}. Recommended: ${n.recommendation}`);
  const done: string[] = [], running: string[] = [], queued: string[] = [];
  for (const plan of snapshot.plans) for (const node of plan.definition.nodes) {
    const state = plan.nodes[node.id]!;
    if (node.kind === "decision") continue;
    const line = `- ${plan.definition.title} · ${node.title}: ${state.answer ?? state.state}${state.evidence ? ` · ${state.evidence}` : ""}`;
    if (state.state === "landed" || (state.state === "done" && node.workflow === "scout@1")) done.push(line);
    else if (state.state === "done") running.push(line);
    else if (["running", "starting", "unresolved"].includes(state.state)) running.push(line);
    else if (node.kind === "run" && plan.status !== "abandoned") queued.push(`${line}. After: ${node.after.map(d => d.node).join(", ") || (plan.status === "review" ? "plan approval" : "ready")}`);
  }
  return ["Captain's Call", ...now, "Recently Landed", ...done, "Underway", ...running, "Charted Next", ...queued, "Coming up", ...snapshot.comingUp.map(n => `- ${n.question}. After ${n.waits.join(", ")}. Recommended: ${n.recommendation}`)].join("\n");
}
