import type { WorkflowSnapshot } from "./workflow-rpc";
import { decisionOwner, planFinished, planOwner, type PlanNode, type PlanNodeState, type WorkflowPlan } from "./workflow-plans";

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
  const matches = uniquePlans(plans).filter(p => !term || [p.definition.id, p.definition.title, ...p.definition.nodes.flatMap(n => {
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

type RunNode = Extract<PlanNode, { kind: "run" }>;
const taskIdentity = (plan: WorkflowPlan, node: RunNode) => {
  const launch = plan.nodes[node.id]?.launch ?? node.launch;
  return JSON.stringify([node.id, launch.project, launch.host.trim().toLowerCase()]);
};

/** Hide planned copies or copies whose owner records work; never erase an unaccounted live run. */
export function uniquePlans(plans: readonly WorkflowPlan[]): WorkflowPlan[] {
  const byId = new Map<string, WorkflowPlan>();
  for (const plan of plans) {
    const previous = byId.get(plan.definition.id);
    if (!previous || plan.sequence > previous.sequence) byId.set(plan.definition.id, plan);
  }
  const ordered = [...byId.values()].sort((a, b) => Number(a.definition.implicit) - Number(b.definition.implicit));
  const tasks = new Map<string, PlanNodeState | undefined>();
  return ordered.filter(plan => {
    const runs = plan.definition.nodes.filter((n): n is RunNode => n.kind === "run");
    const run = runs[0], identity = run ? taskIdentity(plan, run) : "", owner = tasks.get(identity);
    const duplicate = plan.definition.implicit && runs.length === 1 && tasks.has(identity) &&
      (plan.nodes[run!.id]?.state === "planned" || !!owner && owner.state !== "planned");
    for (const node of runs) if (!tasks.has(taskIdentity(plan, node))) tasks.set(taskIdentity(plan, node), plan.nodes[node.id]);
    return !duplicate;
  });
}

export interface PlanStep { node: PlanNode; reviews: RunNode[] }

/** No role field exists in v1: require both a review name and one explicit evidence-linked build. */
export function planSteps(plan: WorkflowPlan): PlanStep[] {
  const rows = plan.definition.nodes.map(node => ({ node, reviews: [] as RunNode[] }));
  const folded = new Set<string>();
  for (const node of plan.definition.nodes) {
    if (node.kind !== "run" || node.launch.kind !== "scout" || !/\breview\b/i.test(node.title)) continue;
    const builds = rows.filter(row => row.node.kind === "run" && row.node.launch.kind === "ship" &&
      row.node.launch.project === node.launch.project && node.after.some(edge => edge.node === row.node.id && edge.reason === "needs-evidence"));
    if (builds.length !== 1) continue; // An ambiguous or independent investigation stays visible.
    builds[0]!.reviews.push(node);
    folded.add(node.id);
  }
  return rows.filter(row => !folded.has(row.node.id));
}

function dependencyState(edge: PlanNode["after"][number], plan: WorkflowPlan, plans: readonly WorkflowPlan[]) {
  // Resolve inside the owning plan first; an automatic copy must not override its durable evidence.
  return plan.nodes[edge.node] ?? plans.find(p => p.definition.nodes.some(n => n.id === edge.node))?.nodes[edge.node];
}

export function unmetDependencies(plan: WorkflowPlan, node: PlanNode, plans: readonly WorkflowPlan[]) {
  return node.after.filter(edge => {
    const state = dependencyState(edge, plan, plans);
    if (!state || state.held || state.invalidated) return true;
    return !(edge.on === "answered" ? !!state.answer : edge.on === "landed" ? state.state === "landed" : ["done", "landed"].includes(state.state));
  });
}

function dependencyName(edge: PlanNode["after"][number], plan: WorkflowPlan, plans: readonly WorkflowPlan[], compact = false) {
  const target = plan.definition.nodes.find(n => n.id === edge.node) ?? plans.flatMap(p => p.definition.nodes).find(n => n.id === edge.node);
  const title = target?.title ?? edge.node;
  return `${compact ? shortStepTitle(title) : title}${edge.on === "landed" ? " (landing)" : edge.on === "answered" ? " (answer)" : ""}`;
}

export function stepState(plan: WorkflowPlan, node: PlanNode, plans: readonly WorkflowPlan[], compact = false): string {
  const state = plan.nodes[node.id];
  if (!state || state.invalidated) return "uncertain";
  if (state.held) return "on hold";
  if (state.closedWithoutLanding) return "closed without landing";
  if (node.kind === "decision" && state.answer) return "answered";
  if (state.state !== "planned") return runState(state);
  const waits = unmetDependencies(plan, node, plans);
  if (waits.length) return `waiting on ${waits.map(edge => dependencyName(edge, plan, plans, compact)).join(", ")}`;
  if (plan.status === "abandoned") return "declined";
  if (plan.status === "held") return "on hold";
  if (plan.status === "review") return "awaiting plan approval";
  return node.kind === "decision" ? decisionOwner(plan, node) === "firstmate" ? "FirstMate to decide" : "waiting for your decision" : "ready";
}

export function reviewLabel(node: RunNode, state?: PlanNodeState): string {
  const provider = (state?.launch ?? node.launch).agent.provider;
  return /astra/i.test(provider) ? "Astra" : /opus/i.test(provider) ? "Opus" : provider.split("/").at(-1) ?? node.launch.agentTitle;
}

export function reviewStatus(plan: WorkflowPlan, node: RunNode, plans: readonly WorkflowPlan[]): string {
  const state = stepState(plan, node, plans);
  return ["done", "landed"].includes(state) ? "✓" : state === "ready" || state.startsWith("waiting on ") || state === "awaiting plan approval" ? "pending" : state;
}

const compactNames = (names: string[]) => names.slice(0, 2).join("; ") + (names.length > 2 ? `; +${names.length - 2} more` : "");
export function planSummary(plan: WorkflowPlan, plans: readonly WorkflowPlan[], compact = false) {
  const steps = planSteps(plan);
  const runs = steps.map(row => row.node).filter((n): n is RunNode => n.kind === "run");
  const label = (node: PlanNode) => compact ? shortStepTitle(node.title) : node.title;
  const completed = runs.filter(node => {
    const state = plan.nodes[node.id];
    return state && !state.held && !state.invalidated && (node.launch.kind === "ship" ? state.state === "landed" || (state.state === "done" && !!state.closedWithoutLanding) : ["done", "landed"].includes(state.state));
  }).length;
  const active = (node: PlanNode) => ["running", "starting"].includes(stepState(plan, node, plans));
  const running = steps.flatMap(({ node, reviews }) => [
    ...(active(node) ? [`${label(node)}${plan.nodes[node.id]?.state === "starting" ? " (starting)" : ""}`] : []),
    ...(reviews.some(active) ? [`${label(node)} reviews (${reviews.filter(active).map(r => reviewLabel(r, plan.nodes[r.id])).join(", ")})`] : []),
  ]);
  const needsAttention = (node: PlanNode) => {
    const state = plan.nodes[node.id];
    return state?.invalidated ? "evidence uncertain" : state?.state === "unresolved" ? "unresolved" : state?.state === "failed" ? "failed" : state?.held ? "on hold" :
      node.kind === "run" && node.launch.kind === "ship" && state?.state === "done" && !state.closedWithoutLanding ? "awaiting landing" : "";
  };
  const attention = steps.flatMap(({ node, reviews }) => [
    ...(needsAttention(node) ? [`${label(node)} — ${needsAttention(node)}`] : []),
    ...(reviews.some(needsAttention) ? [`${label(node)} reviews (${reviews.filter(needsAttention).map(r => `${reviewLabel(r, plan.nodes[r.id])} ${needsAttention(r)}`).join(", ")})`] : []),
  ]);
  const pending = plan.definition.nodes.filter(n => n.kind === "run" && plan.nodes[n.id]?.state === "planned" && !needsAttention(n));
  const next = pending.filter(n => !unmetDependencies(plan, n, plans).length).slice(0, 2);
  if (!next.length && pending[0]) next.push(pending[0]);
  const decisions = plan.definition.nodes.filter(n => n.kind === "decision" && !plan.nodes[n.id]?.answer);
  return {
    progress: `${completed} of ${runs.length} steps ${runs.length && runs.every(n => n.launch.kind === "ship" && !plan.nodes[n.id]?.closedWithoutLanding) ? "landed" : "complete"}`,
    running: compactNames(running) || "none",
    attention: attention.join("; "),
    next: compactNames(next.map(n => {
      const row = steps.find(s => s.reviews.some(r => r.id === n.id));
      const name = row ? `${label(row.node)} reviews` : label(n);
      const state = stepState(plan, n, plans, compact);
      return `${name} — ${state}`;
    }).filter((text, i, all) => all.indexOf(text) === i)) || "no queued steps",
    decisions: compactNames(decisions.map(n => `${n.title} — ${stepState(plan, n, plans)}`)),
  };
}

/** Shorten repeated slice titles in message overviews, while leaving other work recognizable. */
export function shortStepTitle(title: string): string {
  const slice = title.match(/\b(slice|stage)\s+([a-z]*\d+)\b/i);
  return slice ? `${slice[1]!.toLowerCase()} ${slice[2]}` : title;
}

export function planStatus(plan: WorkflowPlan): string {
  return plan.status === "abandoned" ? "Declined" : planFinished(plan) ? "Finished" :
    plan.status === "review" ? "Awaiting approval" : plan.status === "held" ? "On hold" : "Active";
}

export function runState(state: PlanNodeState | undefined): string {
  if (!state || state.invalidated) return "uncertain";
  if (state.closedWithoutLanding) return "closed without landing";
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

/** Read-only overview. The mate reads full plans through workflow.mjs, rather than a step dump. */
export function compactWorkflowBearings(snapshot: WorkflowSnapshot): string {
  const plans = uniquePlans(snapshot.plans).filter(p => !planClosed(p));
  if (!plans.length && !snapshot.problems?.length && !snapshot.warnings?.length) return "";
  const line = (text: string, max = 180) => { const textLine = text.replace(/\s+/g, " ").trim(); return textLine.length > max ? textLine.slice(0, max - 1) + "…" : textLine; };
  const overview = plans.map(plan => {
    const summary = planSummary(plan, snapshot.plans, true);
    return `- ${plan.definition.id} — ${line(plan.definition.title)}: owner ${planOwner(plan) === "firstmate" ? "FirstMate" : "Captain"}; ${summary.progress}; running: ${line(summary.running)}${summary.attention ? `; attention: ${line(summary.attention, 220)}` : ""}; next: ${line(summary.next, 220)}.`;
  });
  const decisions = (needs: WorkflowSnapshot["now"]) => needs.filter(n => plans.some(p => p.definition.id === n.plan)).map(n =>
    `- ${n.plan}${n.node ? `/${n.node}` : ""}: ${line(n.question)}${n.waits.length ? `; waits: ${line(n.waits.join(", "))}` : ""}${n.recommendation ? `; recommended: ${line(n.recommendation, 160)}` : ""}`);
  const due = decisions(snapshot.now), upcoming = decisions(snapshot.comingUp);
  return ["Open plans", ...overview, ...(due.length ? ["Due", ...due] : []), ...(upcoming.length ? ["Coming up", ...upcoming] : []),
    ...(snapshot.problems ?? []).map(p => `- Plans unavailable: ${line(p.replace(/^Plans unavailable:\s*/i, ""))}`), ...(snapshot.warnings ?? []).map(p => `- Workflow note: ${line(p)}`)].join("\n");
}
