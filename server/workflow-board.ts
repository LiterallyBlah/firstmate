import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import type { PlanNeed, WorkflowSnapshot } from "../shared/workflow-rpc";
import type { Fleet, FleetCard } from "../shared/fleet";
import { RemoteSnapshot } from "../shared/remotes";
import { planFinished, type WorkflowPlan } from "../shared/workflow-plans";
import { compactWorkflowBearings } from "../shared/workflow-plan-summary";
import { workflowNodeOwnsCard } from "../shared/workflow-identity";
import { dependenciesMet, planSubjectHash, planBacklogLine, backlogSection, samePlanItem } from "./workflow-plans";
import { workflowStore } from "./workflow-service";
import { digest } from "./submissions";
import { parseBacklog } from "./backlog";
import { resolveInHome } from "./files";
import { resolveHost } from "./remote-cards";
import { quarantinedDependencyIds, type QuarantinedWorkflow } from "./workflow-ownership";
import { decisionBriefs } from "./decision-brief";
import { planDecisionRequest } from "../shared/plan-decisions";

/** Derive readiness from committed events, never the request's authored date or poll time. */
function decisionDueAt(plan: WorkflowPlan, node: WorkflowPlan["definition"]["nodes"][number], plans: readonly WorkflowPlan[]) {
  const times = [plan.nodes[node.id]?.introducedAt ?? plan.history[0]?.at];
  for (const edge of node.after) {
    const owner = plans.find(p => p.nodes[edge.node]), state = owner?.nodes[edge.node];
    times.push(state?.availableAt, state?.readyAt?.[edge.on]);
  }
  const latest = Math.max(...times.flatMap(at => at && Number.isFinite(Date.parse(at)) ? [Date.parse(at)] : []));
  return Number.isFinite(latest) ? new Date(latest).toISOString() : plan.definition.request.at;
}

export const workflowHomeId = (home: string) => digest(process.platform === "win32" ? resolve(home).toLowerCase() : resolve(home));
export async function workflowSnapshot(home: string): Promise<WorkflowSnapshot> {
  let read: { plans: WorkflowPlan[]; problems: string[]; warnings?: string[]; quarantined?: QuarantinedWorkflow[] };
  try { read = await workflowStore(home).read(); } catch (e) { read = { plans: [], problems: [`Plans unavailable: ${String(e)}`] }; }
  // The browser retains all history; due actions below still exclude finished plans.
  const allPlans = read.plans, plans = allPlans, now: PlanNeed[] = [], comingUp: PlanNeed[] = [];
  const unavailableDependencies = quarantinedDependencyIds(read.quarantined ?? []);
  for (const plan of plans) {
    if (plan.status === "abandoned" || planFinished(plan)) continue;
    if (plan.status === "review") now.push({ plan: plan.definition.id, title: plan.definition.title, question: "Approve this plan", waits: [], neededBy: [], recommendation: "Review the runs, dependencies and budget." });
    for (const node of plan.definition.nodes) {
      if (node.kind !== "decision" || plan.nodes[node.id]?.answer) continue;
      const need = { plan: plan.definition.id, node: node.id, title: plan.definition.title, question: node.title,
        waits: node.after.map(d => unavailableDependencies.has(d.node) ? `${d.node} (evidence unavailable)` : allPlans.flatMap(p => p.definition.nodes).find(n => n.id === d.node)?.title ?? d.node),
        neededBy: plan.definition.nodes.filter(n => n.after.some(d => d.node === node.id)).map(n => n.title),
        recommendation: `${node.options.find(o => o.id === node.recommendation)?.label ?? "None yet"} — ${node.rationale}`,
        waitingFor: node.after.some(d => d.on === "landed") ? "after earlier changes are landed" : node.after.some(d => d.on === "answered") ? "after an earlier decision is answered" : node.after.some(d => d.reason === "needs-evidence") ? "after the earlier review is complete" : "after earlier work is finished",
        decision: { homeId: workflowHomeId(home), revision: plan.revision, subjectHash: planSubjectHash(plan), ask: node.summary, options: node.options, at: decisionDueAt(plan, node, allPlans), held: !!plan.nodes[node.id]?.held } };
      (dependenciesMet(node, allPlans, unavailableDependencies) ? now : comingUp).push(need);
    }
  }
  return { homeId: workflowHomeId(home), version: digest({ plans: allPlans.map(p => p.hash), problems: read.problems, warnings: read.warnings ?? [], unavailableDependencies: [...unavailableDependencies].sort() }), plans,
    subjects: Object.fromEntries(plans.map(p => [p.definition.id, planSubjectHash(p)])), now, comingUp, problems: read.problems, warnings: read.warnings ?? [] };
}
async function backlog(home: string) { return parseBacklog(await readFile((await resolveInHome(home, "data/backlog.md")).absolute, "utf8")); }
async function catalog(home: string) {
  try { return RemoteSnapshot.parse(JSON.parse(await readFile((await resolveInHome(home, "data/remote-hosts.json")).absolute, "utf8"))); } catch { return null; }
}

/** Deduplicate only the exact local, project-less decision projection this plan owns. */
export async function withWorkflowNeeds(snapshot: NeedsYouSnapshot, home: string, workflow?: WorkflowSnapshot): Promise<NeedsYouSnapshot> {
  const view = workflow ?? await workflowSnapshot(home), problems = [...(view.problems ?? [])];
  let items: Awaited<ReturnType<typeof backlog>> = [];
  try { items = await backlog(home); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") problems.push("Plan backlog projections could not be matched; legacy decisions are retained."); }
  const ids = new Set(view.plans.flatMap(p => p.definition.nodes.filter(n => n.kind === "decision" && items.some(i => samePlanItem(i, p, n))).map(n => n.id)));
  const owned = (source: { taskId: string; hostId: string; project: string | null }) => ids.has(source.taskId) && source.hostId === "local" && !source.project;
  const removed = snapshot.requests.filter(r => owned(r.source));
  const candidates = view.now.flatMap(n => {
    const request = planDecisionRequest(n);
    return request ? [request] : [];
  });
  // Include every scope in the brief reader's ambiguity guard, replacing only owned projections.
  const remaining = Math.max(0, 512 * 1024 - (snapshot.briefs ?? []).reduce((sum, b) => sum + Buffer.byteLength(b.content), 0));
  const briefs = await decisionBriefs(home, { requests: [...candidates, ...snapshot.requests.filter(r => !owned(r.source))], parked: snapshot.parked.filter(r => !owned(r)) }, remaining);
  const planNow = view.now.map(n => {
    const request = planDecisionRequest(n), brief = briefs.find(b => b.requestId === request?.id && b.recordRevision === request?.revision);
    return n.decision && brief ? { ...n, decision: { ...n.decision, brief: { path: brief.path, content: brief.content } } } : n;
  });
  return { ...snapshot, requests: snapshot.requests.filter(r => !owned(r.source)), parked: snapshot.parked.filter(r => !owned(r)),
    actionCount: snapshot.actionCount === null ? null : Math.max(0, snapshot.actionCount - removed.filter(r => r.state === "new" || r.state === "seen").length) + view.now.length,
    newCount: snapshot.newCount === null ? null : Math.max(0, snapshot.newCount - removed.filter(r => r.state === "new").length),
    planNow, comingUp: view.comingUp, planProblems: problems };
}

/** Pending cards carry scope and no invented worker. Bad plans never affect unrelated cards. */
export async function withWorkflowCards(cards: FleetCard[], home: string, workflow?: WorkflowSnapshot): Promise<FleetCard[]> {
  const result = cards.map(c => ({ ...c })), view = workflow ?? await workflowSnapshot(home), hosts = await catalog(home);
  for (const plan of view.plans) {
    const removed = [...(plan.removed ?? []).map(r => r.node), ...(plan.status === "abandoned" ? plan.definition.nodes : [])];
    for (let i = result.length - 1; i >= 0; i--) {
      const card = result[i]!;
      if (!removed.some(n => workflowNodeOwnsCard(plan, n, card))) continue;
      if (!card.agent && !card.remote?.worker && !card.backlog?.agentId) result.splice(i, 1);
      else card.note = "Removed from plan; inspect the worker and preserve its work.";
    }
    if (plan.status === "abandoned" || (plan.definition.implicit && plan.status !== "review")) continue;
    for (const node of plan.definition.nodes) {
      if (node.kind !== "run") continue;
      const state = plan.nodes[node.id]!, existing = result.find(c => workflowNodeOwnsCard(plan, node, c));
      const column = state.invalidated || state.state === "unresolved" ? "ready" : state.state === "failed" ? "failed" : backlogSection(node, state.state, !!state.closedWithoutLanding) === "done" ? "done" : state.state === "done" ? "ready" : state.state === "planned" ? "queued" : "working";
      if (!existing && column === "done") continue;
      const item = parseBacklog(`## ${column === "done" ? "Done" : column === "queued" ? "Queued" : "In flight"}\n${planBacklogLine(plan, node, existing?.backlog ?? undefined)}`)[0]!;
      const note = state.invalidated ? "Evidence needs renewed verification" : state.held ? "Dependencies need review" : state.closedWithoutLanding ? "Closed without landing; evidence retained" : plan.status === "review" ? "awaiting your approval" : plan.status === "held" ? "plan held" : state.state === "planned" ? node.after.length ? `after ${node.after.map(d => d.node).join(", ")}` : "planned" : state.state === "done" ? "Deliverable ready; landing unconfirmed" : state.state;
      if (existing) {
        existing.backlog = { ...(existing.backlog ?? item), ...item };
        if (state.state === "done" && !state.closedWithoutLanding && node.launch.kind === "ship" && existing.column === "done") { existing.column = "ready"; existing.note = note; }
        if (!existing.agent && !existing.remote?.worker) { existing.column = column; existing.note = note; }
      } else {
        const host = resolveHost(node.launch.host, hosts);
        result.push({ key: `plan:${plan.definition.id}:${node.id}`, taskId: node.id, title: node.title, project: node.launch.project, kind: node.launch.kind, column, backlog: item, agent: null, report: null, url: null, note,
          ...(host.kind === "local" ? {} : { remote: { serverId: host.kind === "remote" ? host.host.serverId : null, host: host.kind === "remote" ? host.host.label : node.launch.host, online: host.kind === "remote" && host.host.online, clockSkewSeconds: null, worker: null } }) });
      }
    }
  }
  return result;
}
/** Fleet and Needs you share a single plan read/publication snapshot. */
export async function withWorkflowFleet(fleet: Fleet): Promise<Fleet> {
  const view = await workflowSnapshot(fleet.home);
  return { ...fleet, cards: await withWorkflowCards(fleet.cards, fleet.home, view), ...(fleet.needsYou ? { needsYou: await withWorkflowNeeds(fleet.needsYou, fleet.home, view) } : {}),
    warnings: [...fleet.warnings, ...[...(view.problems ?? []), ...(view.warnings ?? [])].map(p => `Workflow: ${p}`)] };
}
export async function workflowBearings(home: string): Promise<string> {
  const snapshot = await workflowSnapshot(home);
  return compactWorkflowBearings(snapshot);
}
