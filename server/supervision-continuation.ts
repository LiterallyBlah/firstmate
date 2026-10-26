/** S04 unfinished-goal reconciliation over the existing scoped plan, attempts, effects, holds and decisions.
 * Pure derivation plus one owner-recorded assessment row; no engine, watch, timer or second journal.
 * Triggers (finish, turn end, restart, heartbeat) all call the same derivation; equal semantic inputs
 * coalesce, and recording an assessment is excluded from those inputs, so it cannot retrigger itself.
 */
import { dependenciesMet, planDecisionReady } from "../shared/plan-readiness";
import { ContinuationSchema, type Continuation, type ContinuationDisposition, type ContinuationWait } from "../shared/supervision-continuation";
import type { SupervisionActor, SupervisionStatus } from "../shared/supervision";
import type { GatewayReceiver } from "../shared/supervision-effects";
import { decisionOwner, planSpent, type WorkflowPlan } from "../shared/workflow-plans";
import { scopedDecisionId } from "./supervision-commands";
import { expectedFor, refuse, stableId } from "./supervision-effects";
import { digest } from "./submissions";
import type { SupervisionMutation, SupervisionStore } from "./supervision-store";

const LIVE_NODE = ["starting", "running"];
const effectClass = (state: string) => ["reserved"].includes(state) ? "reserved" : ["dispatching", "uncertain", "accepted"].includes(state) ? "uncertain" : state;
export const objectiveHash = (plan: WorkflowPlan) => digest({ plan: plan.definition.id, request: plan.definition.request });
export const continuationId = (scopeId: string, planId: string) => stableId("continuation", scopeId, planId);

/** Only facts that change what the owner must do. Plan hash, sequence, acknowledgements and the
 * assessment row itself are deliberately excluded (self-trigger prevention).
 */
export function semanticInputs(status: SupervisionStatus, scopeId: string, planId: string) {
  const plan = status.plans.find(p => p.scopeId === scopeId && p.plan.definition.id === planId)?.plan ?? null;
  const binding = status.bindings.find(b => b.scopeId === scopeId);
  const pick = (id: string, plans: readonly WorkflowPlan[]) => {
    const owner = plans.find(p => p.nodes[id]), s = owner?.nodes[id];
    return s ? [id, s.state, s.attempt ?? null, !!s.held, !!s.invalidated, s.answer ?? null, !!s.closedWithoutLanding, s.spent ?? 0] : [id, null];
  };
  const plans = status.plans.map(p => p.plan);
  const tasks = status.tasks.filter(t => t.ownerScopeId === scopeId && t.planId === planId);
  return {
    objective: plan ? objectiveHash(plan) : null, definition: plan ? digest(plan.definition) : null, status: plan?.status ?? null,
    budget: plan?.approvedBudget ?? null,
    nodes: plan ? plan.definition.nodes.map(n => pick(n.id, [plan])) : [],
    external: plan ? [...new Set(plan.definition.nodes.flatMap(n => n.after.map(e => e.node)).filter(id => !plan.nodes[id]))].sort().map(id => pick(id, plans)) : [],
    holds: status.operationHolds.filter(h => h.scopeId === scopeId && h.planId === planId).map(h => [h.id, h.state, h.version]),
    decisions: status.decisions.filter(d => d.ownerScopeId === scopeId && d.planId === planId).map(d => [d.id, d.state]),
    attempts: status.attempts.filter(a => tasks.some(t => t.id === a.taskId)).map(a => [a.id, a.state, a.worker?.agentId ?? null]),
    effects: status.effects.filter(e => e.scopeId === scopeId).map(e => [e.id, effectClass(e.state)]),
    owner: binding ? [binding.epoch, binding.state] : null, backend: status.backends.find(b => b.planId === planId)?.state ?? null,
  };
}
export const continuationInputVersion = (status: SupervisionStatus, scopeId: string, planId: string) => digest(semanticInputs(status, scopeId, planId));

export interface DerivedContinuation {
  scopeId: string; planId: string; title: string; inputVersion: string; objectiveHash: string | null;
  derived: ContinuationDisposition; disposition: ContinuationDisposition; reason: string; responsible: "scope-owner" | "captain";
  nextNodes: string[]; waits: ContinuationWait[]; assessed: Continuation | null;
  /** True when the owner must take one bounded pass for this exact input generation. */
  due: boolean; deliverable: boolean; wakeKey: string;
  owner: { agentId: string; epoch: number; state: string } | null;
  activeWorkers: number; activeEffects: number; uncertainEffects: number; evidenceAt: string | null; projectIds: string[];
}

export function deriveContinuation(status: SupervisionStatus, scopeId: string, planId: string): DerivedContinuation {
  const plan = status.plans.find(p => p.scopeId === scopeId && p.plan.definition.id === planId)?.plan ?? null;
  const scope = status.scopes.find(s => s.id === scopeId), binding = status.bindings.find(b => b.scopeId === scopeId);
  const inputVersion = continuationInputVersion(status, scopeId, planId), objective = plan ? objectiveHash(plan) : null;
  const assessed = status.continuations.find(c => c.scopeId === scopeId && c.planId === planId) ?? null;
  const plans = status.plans.map(p => p.plan), waits: ContinuationWait[] = [], nextNodes: string[] = [];
  const tasks = status.tasks.filter(t => t.ownerScopeId === scopeId && t.planId === planId);
  const effects = status.effects.filter(e => e.scopeId === scopeId);
  const failedLaunch = (attempt: string | undefined) => !!attempt && effects.some(e => e.attemptId === attempt && ["failed", "cancelled"].includes(e.state));
  let activeWorkers = 0;
  for (const node of plan?.definition.nodes ?? []) {
    const state = plan!.nodes[node.id];
    if (state && LIVE_NODE.includes(state.state) && !failedLaunch(state.attempt)) {
      activeWorkers++; waits.push({ kind: "attempt", id: state.attempt ?? node.id, detail: `${node.title}: ${state.state}` });
    }
  }
  for (const e of effects.filter(e => ["reserved", "dispatching", "uncertain", "accepted"].includes(e.state)))
    waits.push({ kind: "effect", id: e.id, detail: `${e.operation} ${effectClass(e.state)}${e.epoch !== binding?.epoch ? " (previous owner epoch; needs reconsideration)" : ""}` });
  const holds = status.operationHolds.filter(h => h.scopeId === scopeId && h.planId === planId && h.state === "held");
  const paused = plan?.status === "held" || holds.some(h => h.id === scopedDecisionId(scopeId, planId, "admission-stop"));
  const spent = plan ? planSpent(plan.nodes, plan.removed) : 0, budgetFull = !!plan && spent >= plan.approvedBudget.agents;
  let captain = plan?.status === "review";
  if (plan && plan.status === "active") for (const node of plan.definition.nodes) {
    const state = plan.nodes[node.id];
    if (node.kind === "run" && state?.state === "planned" && !state.held && !state.invalidated && dependenciesMet(node, plans)) {
      if (budgetFull) waits.push({ kind: "capacity", id: node.id, detail: `Cumulative budget ${spent}/${plan.approvedBudget.agents} is spent; one scoped budget decision.` });
      else nextNodes.push(node.id);
    }
    if (planDecisionReady(plan, node, plans)) {
      if (decisionOwner(plan, node) === "captain") { captain = true; waits.push({ kind: "decision", id: node.id, detail: `Captain decision: ${node.title}` }); }
      else nextNodes.push(node.id);
    }
  }
  // Spent budget blocks only a run that is otherwise ready; a finished plan at its cap is not "blocked".
  const budgetBlocked = waits.some(w => w.kind === "capacity"), scopeHeld = scope?.state === "held";
  if (scopeHeld) waits.push({ kind: "hold", id: scopeId, detail: "Scope admissions are held; obligations are retained, nothing is woken." });
  for (const h of holds) waits.push({ kind: "hold", id: h.id, detail: h.reason });
  const completed = !!assessed?.completion && assessed.objectiveHash === objective;
  const derived: ContinuationDisposition = !plan ? "needs-planning" : completed ? "completed" : paused ? "paused" : scopeHeld ? "blocked" : nextNodes.length ? "ready-action" :
    captain ? "captain-decision" : activeWorkers || waits.some(w => w.kind === "effect") ? "waiting" :
    holds.length || budgetBlocked ? "blocked" : "needs-planning";
  const actionable = derived === "ready-action" || derived === "needs-planning";
  const current = assessed?.inputVersion === inputVersion && assessed.epoch === binding?.epoch;
  // A current quiet assessment (capacity wait, concrete blocker, escalation) explains an obligation; it never erases it.
  const quiet = current && actionable && assessed!.disposition !== "completed";
  const disposition = quiet ? assessed!.disposition : derived;
  const reason = quiet ? assessed!.reason : !plan ? "No plan is recorded for this scope." : reasonFor(derived, nextNodes, waits);
  const deliverable = scope?.state === "active" && binding?.state === "active";
  return { scopeId, planId, title: plan?.definition.title ?? planId, inputVersion, objectiveHash: objective, derived, disposition, reason,
    responsible: derived === "captain-decision" || (derived === "blocked" && (scopeHeld || (!holds.length && budgetBlocked))) || paused ? "captain" : "scope-owner",
    nextNodes, waits, assessed, due: actionable && !current, deliverable, wakeKey: digest({ continuation: scopeId, planId, inputVersion }),
    owner: binding ? { agentId: binding.agentId, epoch: binding.epoch, state: binding.state } : null, activeWorkers,
    activeEffects: effects.filter(e => ["reserved", "dispatching", "accepted", "uncertain"].includes(e.state)).length,
    uncertainEffects: effects.filter(e => ["dispatching", "uncertain", "accepted"].includes(e.state)).length,
    evidenceAt: [...Object.values(plan?.nodes ?? {}).map(n => n.completedAt ?? null), assessed?.at ?? null].filter((v): v is string => !!v).sort().at(-1) ?? null,
    projectIds: scope?.projectIds ?? [] };
}
function reasonFor(d: ContinuationDisposition, next: string[], waits: ContinuationWait[]): string {
  if (d === "ready-action") return `Start or answer: ${next.join(", ")}.`;
  if (d === "needs-planning") return "Outcome unresolved with no ready, live or decided next step; the owner must plan the continuation.";
  if (d === "completed") return "Outcome accepted with evidence.";
  return waits.map(w => w.detail).join("; ").slice(0, 1024) || d;
}
/** Every scoped plan in the store. Reads only; heartbeat/restart/turn-end triggers all use this. */
export function continuationAgenda(status: SupervisionStatus): DerivedContinuation[] {
  if (status.freshness !== "current") return [];
  return status.backends.filter(b => b.backend === "scoped" && b.state === "active" && !status.retirements.some(r => r.plan === b.planId))
    .map(b => deriveContinuation(status, b.ownerScopeId, b.planId));
}
/** Goal and project level truth for S05: owner, next action or wait, live worker/effect counts and evidence age. */
export function goalStatus(status: SupervisionStatus) {
  const goals = continuationAgenda(status).map(c => ({ scopeId: c.scopeId, planId: c.planId, title: c.title, state: c.disposition,
    owner: c.owner?.state === "active" ? c.owner.agentId : null, responsible: c.responsible, next: c.reason, due: c.due,
    activeWorkers: c.activeWorkers, activeEffects: c.activeEffects, uncertainEffects: c.uncertainEffects, evidenceAt: c.evidenceAt, projectIds: c.projectIds }));
  const projects = [...new Set(goals.flatMap(g => g.projectIds))].sort().map(projectId => {
    const own = goals.filter(g => g.projectIds.includes(projectId));
    return { projectId, goals: own.length, activeWorkers: own.reduce((n, g) => n + g.activeWorkers, 0), activeEffects: own.reduce((n, g) => n + g.activeEffects, 0),
      needsPlanning: own.filter(g => g.state === "needs-planning").length, due: own.filter(g => g.due).length,
      evidenceAt: own.map(g => g.evidenceAt).filter((v): v is string => !!v).sort().at(-1) ?? null };
  });
  return { freshness: status.freshness, sequence: status.sequence, goals, projects };
}

export interface ContinuationRecord {
  requestId: string; scopeId: string; planId: string; epoch: number; inputVersion: string;
  disposition: Exclude<ContinuationDisposition, "ready-action">; reason: string; waits: ContinuationWait[]; completion: { evidence: string } | null;
}
/** The owner's durable result for one input generation. "I will continue" is not a disposition: ready
 * work is cleared only by committing it (a start/revision), never by narrative acknowledgement.
 */
export async function recordContinuation(store: SupervisionStore, input: ContinuationRecord, actor: SupervisionActor, enabled = false) {
  if (!enabled) refuse("UNSUPPORTED", "Scoped continuation records are disabled.");
  if ((input.disposition as string) === "ready-action") refuse("UNSUPPORTED", "Ready work is cleared by committing it, not by recording intent.");
  return store.transactCommand(input.requestId, digest({ continuation: input }), actor, async status => {
    const scope = status.scopes.find(s => s.id === input.scopeId), binding = status.bindings.find(b => b.scopeId === input.scopeId);
    if (!scope || scope.mode !== "scoped" || scope.kind !== "plan") refuse("UNKNOWN_OWNER", "Exact scoped plan owner required.");
    if (!binding || binding.epoch !== input.epoch) refuse("STALE", "The owner epoch changed; a previous owner's assessment cannot commit.");
    if (actor.kind === "agent" ? actor.id !== binding.agentId : actor.kind !== "captain-ui")
      refuse("UNKNOWN_OWNER", "Only the bound owner or an explicit captain action records a continuation; General is not a bypass.");
    if (actor.kind === "agent" && (binding.state !== "active" || scope.state !== "active")) refuse("HELD", "The owner is not active.");
    if (input.disposition === "paused" && actor.kind !== "captain-ui") refuse("UNSUPPORTED", "Use the checked plan stop for an owner pause; idleness is never a pause.");
    const derived = deriveContinuation(status, input.scopeId, input.planId);
    if (derived.inputVersion !== input.inputVersion) refuse("STALE", "Facts changed since this assessment; reread before deciding.");
    const plan = status.plans.find(p => p.scopeId === input.scopeId && p.plan.definition.id === input.planId)?.plan ?? refuse("UNKNOWN_OWNER", "No scoped plan.");
    const old = derived.assessed;
    if (old && old.inputVersion === input.inputVersion && old.epoch === input.epoch) refuse("CONFLICT", "This input generation is already assessed; an unchanged retry is not progress.");
    if (input.disposition === "completed") {
      if (!input.completion?.evidence.trim()) refuse("HELD", "Completion needs acceptance evidence for the outcome, not an empty queue.");
      if (derived.activeWorkers || derived.activeEffects) refuse("HELD", "Completion needs quiescent workers and settled effects.");
    } else if (input.completion) refuse("CONFLICT", "Only completion carries completion evidence.");
    if (["waiting", "blocked"].includes(input.disposition) && !input.waits.length) refuse("HELD", "A wait or block must name what it is waiting on.");
    if (input.disposition === "captain-decision" && !input.waits.some(w => w.kind === "decision" &&
      plan.definition.nodes.some(n => n.id === w.id && n.kind === "decision" && decisionOwner(plan, n) === "captain")))
      refuse("HELD", "A routine continuation stays with its owner; only a captain-authority decision escalates.");
    const value = ContinuationSchema.parse({ id: continuationId(input.scopeId, input.planId), version: (old?.version ?? 0) + 1,
      scopeId: input.scopeId, planId: input.planId, objectiveHash: objectiveHash(plan), inputVersion: input.inputVersion, epoch: input.epoch,
      disposition: input.disposition, reason: input.reason, responsible: input.disposition === "captain-decision" || input.disposition === "paused" ? "captain" : "scope-owner",
      nextNodes: derived.nextNodes, waits: input.waits,
      completion: input.completion ? { evidence: input.completion.evidence, planHash: plan.hash } : null, provenance: actor, at: new Date().toISOString() });
    const mutations: SupervisionMutation[] = [{ kind: "continuation", value }];
    return { expectedVersions: expectedFor(status, mutations), mutations, result: { planId: input.planId, planHash: plan.hash, decisionId: null, outboxId: null } };
  });
}

/** Restart / lost-callback scan: observe the exact workers of live attempts. Read-only facts for the
 * owner; it neither retargets a native callback, reprompts to "rearm", nor creates a worker.
 */
export async function livenessScan(status: SupervisionStatus, receiver: GatewayReceiver) {
  const out: { attemptId: string; agentId: string; observed: string; ownerReview: boolean }[] = [];
  for (const attempt of status.attempts.filter(a => a.worker && ["active", "prompted"].includes(a.state))) {
    const task = status.tasks.find(t => t.id === attempt.taskId), node = task ? status.plans.find(p => p.plan.definition.id === task.planId)?.plan.nodes[task.nodeId] : undefined;
    if (!node || !LIVE_NODE.includes(node.state) || task?.currentAttempt !== attempt.id) continue;
    const observed = await receiver.findAgent(attempt.worker!.agentId);
    const state = !observed ? "not visible (unknown, not absent)" : observed.archivedAt ? "archived" : observed.status;
    out.push({ attemptId: attempt.id, agentId: attempt.worker!.agentId, observed: state,
      ownerReview: !!observed && (observed.archivedAt !== null || ["idle", "error", "closed"].includes(observed.status) || observed.pendingPermissions > 0) });
  }
  return out;
}
