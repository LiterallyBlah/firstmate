import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { quarantinesSource, type NeedsYouSnapshot } from "../shared/needs-you";
import type { PlanNeed, WorkflowSnapshot } from "../shared/workflow-rpc";
import type { Fleet, FleetCard } from "../shared/fleet";
import { RemoteSnapshot } from "../shared/remotes";
import { captainReviewRequired, decisionOwner, planOwner, planFinished, type WorkflowPlan } from "../shared/workflow-plans";
import { compactWorkflowBearings } from "../shared/workflow-plan-summary";
import { workflowNodeOwnsCard } from "../shared/workflow-identity";
import { dependenciesMet, planSubjectHash, planBacklogLine, backlogSection, samePlanItem, legacyCutoverWarning } from "./workflow-plans";
import { historicalCrewReport, historicalRuleRefusal } from "./workflow-reporting";
import { workflowStore } from "./workflow-service";
import { cutoverGate, cutoverProblems } from "./supervision-gate";
import { digest } from "./submissions";
import { parseBacklog } from "./backlog";
import { resolveInHome } from "./files";
import { resolveHost } from "./remote-cards";
import { quarantinedDependencyIds, type QuarantinedWorkflow } from "./workflow-ownership";
import { decisionBriefs } from "./decision-brief";
import { needsYouCount, planDecisionRequest } from "../shared/plan-decisions";
import { planDecisionReady } from "../shared/plan-readiness";

/** Derive readiness from committed events, never the request's authored date or poll time. */
function decisionDueAt(plan: WorkflowPlan, node: WorkflowPlan["definition"]["nodes"][number], plans: readonly WorkflowPlan[]) {
  const times = [plan.nodes[node.id]?.introducedAt ?? plan.history[0]?.at, plan.captainEvents?.filter(e => e.action === "approve" || e.action === "edit").at(-1)?.at];
  for (const edge of node.after) {
    const owner = plans.find(p => p.nodes[edge.node]), state = owner?.nodes[edge.node];
    times.push(state?.availableAt, state?.readyAt?.[edge.on]);
  }
  const latest = Math.max(...times.flatMap(at => at && Number.isFinite(Date.parse(at)) ? [Date.parse(at)] : []));
  return Number.isFinite(latest) ? new Date(latest).toISOString() : plan.definition.request.at;
}

export const workflowHomeId = (home: string) => digest(process.platform === "win32" ? resolve(home).toLowerCase() : resolve(home));
/** How long the decisions read waits for plans before answering without them. The host gives an RPC 30 s;
 * the rest of the combined read (ledger, briefs, the warm scoped projection) keeps the remainder.
 * A cold process still validates the whole scoped journal and every plan log once, which on a large
 * home is most of this budget, so it must leave the honest "still loading" answer for a genuinely
 * stuck store rather than for a normal cold start. */
export const PLAN_READ_BUDGET_MS = 15_000;
/** The whole combined decisions read (ledger, then plans, then scoped rows) against the same
 * host limit: the plan snapshot only ever gets what is left of this, so a slow ledger read
 * turns into an honest incomplete answer instead of an RPC timeout with no answer. */
export const NEEDS_READ_DEADLINE_MS = 20_000;
/** The plan snapshot, or null once `budgetMs` has passed. A fresh process verifies every plan log once (about
 * 12,000 events on a large home), which can outlast the host's RPC limit while startup work competes; the
 * snapshot then carries on and warms the cache, so the next read is quick. Each call starts its own snapshot,
 * so a read after an answer never reuses one that began before it. */
export async function workflowSnapshotWithin(home: string, budgetMs = PLAN_READ_BUDGET_MS,
  read: (home: string) => Promise<WorkflowSnapshot> = workflowSnapshot): Promise<WorkflowSnapshot | null> {
  const pending = read(home); pending.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([pending, new Promise<null>(done => { timer = setTimeout(() => done(null), budgetMs); })]); }
  finally { clearTimeout(timer); }
}
type ScopedStatus = import("../shared/supervision").SupervisionStatus;
let scopedReader: ((home: string) => Promise<ScopedStatus>) | null = null;
let fallbackReader: { root: string; reader: import("./supervision-status-reader").SupervisionStatusReader } | null = null;
/** The plugin hands in its runtime's reader, so every snapshot shares one validated, warm journal projection.
 * A reader is warm per instance: a new one re-validated the whole journal, about 2.7 s of CPU on a large home,
 * on every snapshot (fleet, Plans, decisions and the clock alike), which put a cold decisions read past its budget. */
export function shareScopedStatusReader(read: (home: string) => Promise<ScopedStatus>): () => void {
  scopedReader = read;
  return () => { if (scopedReader === read) scopedReader = null; };
}
async function readScopedStatus(home: string): Promise<ScopedStatus> {
  if (scopedReader) return scopedReader(home);
  const { SupervisionStatusReader } = await import("./supervision-status-reader");
  const { pluginDir } = await import("./data-dir");
  const root = pluginDir();
  if (fallbackReader?.root !== root) fallbackReader = { root, reader: new SupervisionStatusReader(root) };
  return fallbackReader.reader.read(home);
}
export async function workflowSnapshot(home: string, scoped?: ScopedStatus): Promise<WorkflowSnapshot> {
  let read: { plans: WorkflowPlan[]; problems: string[]; warnings?: string[]; quarantined?: QuarantinedWorkflow[] };
  const store = workflowStore(home);
  // The scoped projection is read alongside the plan logs, not after them.
  const scopedRead = scoped ? Promise.resolve(scoped) : readScopedStatus(home);
  scopedRead.catch(() => undefined);
  try { read = await store.read(); } catch (e) { read = { plans: [], problems: [`Plans unavailable: ${String(e)}`] }; }
  // S07: damaged cutover records and held cutovers are visible, with their owner, wherever plan problems are.
  const cutover = await cutoverProblems(cutoverGate(home));
  read = { ...read, problems: [...read.problems, ...cutover.problems], warnings: [...(read.warnings ?? []), ...cutover.warnings] };
  // The browser retains all history; due actions below still exclude finished plans. A plan in an S07
  // cutover is no longer the legacy mate's: its retained history still resolves dependencies only.
  scoped = await scopedRead;
  const scopedPlans = scoped?.freshness === "current" ? scoped.plans.filter(p => scoped!.backends.some(b => b.planId === p.plan.definition.id && b.ownerScopeId === p.scopeId && b.backend === "scoped")) : [];
  const currentScoped = new Set(scopedPlans.map(p => p.plan.definition.id));
  // A readable same-plan overlay alone cannot reconcile independently persisted ownership.
  // Only the exact committed sidecar owner, uniquely present in both projections, replaces it.
  const replacedLegacyNotices = new Set<string>();
  const gate = cutoverGate(home);
  for (const id of currentScoped) {
    if (!read.warnings?.includes(legacyCutoverWarning(id, "committed"))) continue;
    const owners = scopedPlans.filter(p => p.plan.definition.id === id), backends = scoped!.backends.filter(b => b.planId === id);
    const committed = await gate.sidecar(id, "committed").catch(() => null);
    if (committed && owners.length === 1 && owners[0]!.scopeId === committed.scopeId && backends.length === 1 &&
      backends[0]!.backend === "scoped" && backends[0]!.ownerScopeId === committed.scopeId && ["active", "retired"].includes(backends[0]!.state))
      replacedLegacyNotices.add(legacyCutoverWarning(id, "committed"));
  }
  read.warnings = (read.warnings ?? []).filter(w => !replacedLegacyNotices.has(w));
  if (scoped?.freshness === "held") read.problems.push("Scoped plans are held; their retained legacy copies remain historical.");
  const ruleRefusals = (scoped?.ruleViolations ?? []).map(record => ({ record, historical: historicalRuleRefusal(scoped!, record) }));
  for (const { record: violation } of ruleRefusals.filter(r => !r.historical).slice(-32))
    read.warnings = [...(read.warnings ?? []), `Retained rule refusal ${violation.planId}/${violation.nodeId}: ${violation.conditions.join("; ")}`];
  const allPlans = [...read.plans.filter(p => !currentScoped.has(p.definition.id)), ...scopedPlans.map(p => scoped!.backends.some(b => b.planId === p.plan.definition.id && b.state === "retired") ? { ...p.plan, status: "abandoned" as const } : p.plan)], held = new Set<string>(), folders = await store.cutoverFolders();
  for (const plan of allPlans) if (!currentScoped.has(plan.definition.id) && await store.cutover(plan.definition.id, folders).catch(() => "damaged")) held.add(plan.definition.id);
  const plans = allPlans.filter(p => !held.has(p.definition.id)), now: PlanNeed[] = [], comingUp: PlanNeed[] = [];
  const unavailableDependencies = quarantinedDependencyIds(read.quarantined ?? []);
  for (const plan of plans) {
    if (currentScoped.has(plan.definition.id) && !scoped?.backends.some(b => b.planId === plan.definition.id && b.state === "active")) continue;
    if (plan.status === "abandoned" || planFinished(plan)) continue;
    if (plan.status === "review" && (planOwner(plan) === "captain" || captainReviewRequired(plan))) now.push({ plan: plan.definition.id, title: plan.definition.title, question: "Review the plan", waits: [], neededBy: [], recommendation: "Review the runs, dependencies and budget.", review: { revision: plan.revision, at: plan.history.at(-1)?.at ?? plan.definition.request.at } });
    for (const node of plan.definition.nodes) {
      if (node.kind !== "decision" || plan.nodes[node.id]?.answer) continue;
      if (currentScoped.has(plan.definition.id)) continue; // Scoped decisions already enter the one shared inbox.
      const need = { plan: plan.definition.id, node: node.id, title: plan.definition.title, question: node.title,
        waits: node.after.map(d => unavailableDependencies.has(d.node) ? `${d.node} (evidence unavailable)` : allPlans.flatMap(p => p.definition.nodes).find(n => n.id === d.node)?.title ?? d.node),
        neededBy: plan.definition.nodes.filter(n => n.after.some(d => d.node === node.id)).map(n => n.title),
        recommendation: `${node.options.find(o => o.id === node.recommendation)?.label ?? "None yet"} — ${node.rationale}`,
        waitingFor: plan.status === "review" ? "after plan approval and required evidence" : plan.status === "held" || plan.nodes[node.id]?.held ? "after the hold is lifted and required evidence is ready" : node.after.some(d => d.on === "landed") ? "after earlier changes are landed" : node.after.some(d => d.on === "answered") ? "after an earlier decision is answered" : node.after.some(d => d.reason === "needs-evidence") ? "after the earlier review is complete" : "after earlier work is finished",
        decision: { homeId: workflowHomeId(home), revision: plan.revision, subjectHash: planSubjectHash(plan), ask: node.summary, options: node.options, at: decisionDueAt(plan, node, allPlans), held: !!plan.nodes[node.id]?.held, ready: planDecisionReady(plan, node, allPlans, unavailableDependencies) } };
      if (decisionOwner(plan, node) === "captain") (planDecisionReady(plan, node, allPlans, unavailableDependencies) ? now : comingUp).push(need);
    }
  }
  return { homeId: workflowHomeId(home), version: digest({ plans: allPlans.map(p => p.hash), held: [...held].sort(), problems: read.problems, warnings: read.warnings ?? [], ruleRefusals, unavailableDependencies: [...unavailableDependencies].sort() }), plans,
    ...(held.size ? { planHelpPending: allPlans.filter(p => held.has(p.definition.id)).map(p => ({ plan: p.definition.id, title: p.definition.title })) } : {}),
    subjects: Object.fromEntries(plans.map(p => [p.definition.id, planSubjectHash(p)])), now, comingUp, problems: read.problems, warnings: read.warnings ?? [], ruleRefusals };
}
async function backlog(home: string) { return parseBacklog(await readFile((await resolveInHome(home, "data/backlog.md")).absolute, "utf8")); }
async function catalog(home: string) {
  try { return RemoteSnapshot.parse(JSON.parse(await readFile((await resolveInHome(home, "data/remote-hosts.json")).absolute, "utf8"))); } catch { return null; }
}

/** A row explicitly tagged with this plan is the decision's backlog projection, even if annotated with a project. */
export async function withWorkflowNeeds(snapshot: NeedsYouSnapshot, home: string, workflow?: WorkflowSnapshot): Promise<NeedsYouSnapshot> {
  const view = workflow ?? await workflowSnapshot(home), problems = [...(view.problems ?? [])];
  let items: Awaited<ReturnType<typeof backlog>> = [];
  try { items = await backlog(home); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") problems.push("Plan backlog projections could not be matched; legacy decisions are retained."); }
  const ownedRows = items.filter(i => view.plans.some(p => p.definition.nodes.some(n => n.kind === "decision" && n.id === i.id && i.plan === p.definition.id)));
  const owned = (source: { taskId: string; hostId: string; project: string | null }) => ownedRows.some(i => i.id === source.taskId && (i.host ?? "local").toLowerCase() === source.hostId.toLowerCase() && (i.project ?? null) === source.project);
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
  // A plan's own decision is the entry for its unreadable backlog line, as the open gate it replaces was.
  const replaced = removed.filter(r => r.state === "new" || r.state === "seen");
  const quarantined = snapshot.quarantined?.map(row => row.taskId !== null && replaced.some(r => quarantinesSource([row], r.source)) ? { ...row, hasHold: false } : row);
  const combined: NeedsYouSnapshot = { ...snapshot, ...(quarantined ? { quarantined } : {}), requests: snapshot.requests.filter(r => !owned(r.source)), parked: snapshot.parked.filter(r => !owned(r)),
    newCount: snapshot.newCount === null ? null : Math.max(0, snapshot.newCount - removed.filter(r => r.state === "new").length),
    planNow, comingUp: view.comingUp, planProblems: problems };
  return { ...combined, actionCount: snapshot.actionCount === null ? null : needsYouCount(combined) };
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
export async function withWorkflowFleet(fleet: Fleet, budgetMs = PLAN_READ_BUDGET_MS,
  read: (home: string) => Promise<WorkflowSnapshot> = workflowSnapshot): Promise<Fleet> {
  // Bounded like the decisions read: a cold plan read on a large home must not take the whole board
  // past the host's RPC limit. The read carries on and warms the cache for the next poll.
  const view = await workflowSnapshotWithin(fleet.home, budgetMs, read);
  // Still loading: no plan evidence, so every crew-report warning stays global.
  if (!view) return { ...fleet, ...(fleet.needsYou ? { needsYou: { ...fleet.needsYou, plansLoading: true } } : {}),
    warnings: [...fleet.warnings, "Plans are still loading; plan steps will appear on the next refresh."] };
  // Only a warning carried by its exact card can be superseded; all unrelated/read-failure alerts survive.
  // An incomplete plan read is insufficient evidence even if it retained an older successful projection.
  const historicalReports = new Set((view.problems?.length ? [] : fleet.cards.filter(c => c.reportWarning && historicalCrewReport(c, view.plans))).flatMap(c => c.reportWarning ? [c.reportWarning] : []));
  return { ...fleet, cards: await withWorkflowCards(fleet.cards, fleet.home, view), ...(fleet.needsYou ? { needsYou: await withWorkflowNeeds(fleet.needsYou, fleet.home, view) } : {}),
    warnings: [...fleet.warnings.filter(w => !historicalReports.has(w)), ...[...(view.problems ?? []), ...(view.warnings ?? [])].map(p => `Workflow: ${p}`)] };
}
export async function workflowBearings(home: string): Promise<string> {
  const snapshot = await workflowSnapshot(home);
  return compactWorkflowBearings(snapshot);
}
