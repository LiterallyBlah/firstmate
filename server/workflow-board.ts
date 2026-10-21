import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import type { PlanNeed, WorkflowSnapshot } from "../shared/workflow-rpc";
import type { Fleet, FleetCard } from "../shared/fleet";
import { RemoteSnapshot } from "../shared/remotes";
import { planFinished, type WorkflowPlan } from "../shared/workflow-plans";
import { workflowNodeOwnsCard } from "../shared/workflow-identity";
import { dependenciesMet, planSubjectHash, planBacklogLine, backlogSection, samePlanItem } from "./workflow-plans";
import { workflowStore } from "./workflow-service";
import { digest } from "./submissions";
import { parseBacklog } from "./backlog";
import { resolveInHome } from "./files";
import { resolveHost } from "./remote-cards";
import { quarantinedDependencyIds, type QuarantinedWorkflow } from "./workflow-ownership";

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
        recommendation: `${node.options.find(o => o.id === node.recommendation)?.label ?? "None yet"} — ${node.rationale}` };
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
  return { ...snapshot, requests: snapshot.requests.filter(r => !owned(r.source)), parked: snapshot.parked.filter(r => !owned(r)),
    actionCount: snapshot.actionCount === null ? null : Math.max(0, snapshot.actionCount - removed.filter(r => r.state === "new" || r.state === "seen").length) + view.now.length,
    newCount: snapshot.newCount === null ? null : Math.max(0, snapshot.newCount - removed.filter(r => r.state === "new").length),
    planNow: view.now, comingUp: view.comingUp, planProblems: problems };
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
      const column = state.invalidated || state.state === "unresolved" ? "ready" : state.state === "failed" ? "failed" : backlogSection(node, state.state) === "done" ? "done" : state.state === "done" ? "ready" : state.state === "planned" ? "queued" : "working";
      if (!existing && column === "done") continue;
      const item = parseBacklog(`## ${column === "done" ? "Done" : column === "queued" ? "Queued" : "In flight"}\n${planBacklogLine(plan, node, existing?.backlog ?? undefined)}`)[0]!;
      const note = state.invalidated ? "Evidence needs renewed verification" : state.held ? "Dependencies need review" : plan.status === "review" ? "awaiting your approval" : plan.status === "held" ? "plan held" : state.state === "planned" ? node.after.length ? `after ${node.after.map(d => d.node).join(", ")}` : "planned" : state.state === "done" ? "Deliverable ready; landing unconfirmed" : state.state;
      if (existing) {
        existing.backlog = { ...(existing.backlog ?? item), ...item };
        if (state.state === "done" && node.launch.kind === "ship" && existing.column === "done") { existing.column = "ready"; existing.note = note; }
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
export async function workflowBearings(home: string, nowMs = Date.now()): Promise<string> {
  const snapshot = await workflowSnapshot(home);
  const plans = snapshot.plans.filter(p => !p.definition.implicit || !planFinished(p));
  if (!plans.length && !snapshot.problems?.length && !snapshot.warnings?.length) return "";
  const now = snapshot.now.map(n => `- ${n.title}: ${n.question}. Recommended: ${n.recommendation}`);
  const done: { line: string; at: string }[] = [], running: string[] = [], queued: string[] = [];
  for (const plan of plans) for (const node of plan.definition.nodes) {
    if (node.kind === "decision") continue;
    const state = plan.nodes[node.id]!, line = `- ${plan.definition.title} · ${node.title}: ${state.state}${state.evidence ? ` · ${state.evidence}` : ""}`;
    if (state.invalidated) running.push(`${line}. Evidence unresolved: ${state.invalidated}`);
    else if (backlogSection(node, state.state) === "done") {
      if (state.completedAt && nowMs - Date.parse(state.completedAt) < 7 * 86400000) done.push({ line, at: state.completedAt });
    } else if (state.state !== "planned") running.push(line);
    else if (plan.status !== "abandoned") queued.push(`${line}. After: ${node.after.map(d => d.node).join(", ") || (plan.status === "review" ? "plan approval" : "ready")}`);
  }
  return ["Captain's Call", ...now, ...(snapshot.problems ?? []).map(p => `- Plans unavailable: ${p}`), "Recently Landed", ...done.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10).map(d => d.line), "Underway", ...running, "Charted Next", ...queued, "Coming up", ...snapshot.comingUp.map(n => `- ${n.question}. After ${n.waits.join(", ")}. Recommended: ${n.recommendation}`), ...(snapshot.warnings ?? []).map(p => `- Workflow note: ${p}`)].join("\n");
}
