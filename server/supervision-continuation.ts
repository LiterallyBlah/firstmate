/** S04 unfinished-goal reconciliation over the existing scoped plan, attempts, effects, holds and decisions.
 * Pure derivation plus one owner-recorded assessment row; no engine, watch, timer or second journal.
 * Triggers (finish, turn end, restart, heartbeat) all call the same derivation. Equal semantic inputs
 * coalesce. Excluded from those inputs: the assessment row itself, plan acknowledgements, and the
 * supervisor's own offer/turn delivery bookkeeping (visible separately), so none can retrigger a pass.
 */
import { dependenciesMet, planDecisionReady } from "../shared/plan-readiness";
import {
  ContinuationSchema, RecordedDisposition, type Continuation, type ContinuationDisposition, type ContinuationWait,
} from "../shared/supervision-continuation";
import type { SupervisionActor, SupervisionStatus } from "../shared/supervision";
import type { GatewayReceiver } from "../shared/supervision-effects";
import { decisionOwner, planSpent, type WorkflowPlan } from "../shared/workflow-plans";
import { scopedDecisionId } from "./supervision-commands";
import { expectedFor, refuse, stableId } from "./supervision-effects";
import { digest } from "./submissions";
import type { SupervisionMutation, SupervisionStore } from "./supervision-store";
import { observeWithin } from "./supervision-observation";

const LIVE_NODE = ["starting", "running"];
const LIVE_EFFECT = ["reserved", "dispatching", "uncertain", "accepted"];
const UNCERTAIN_EFFECT = ["dispatching", "uncertain", "accepted"];
/** Waits bounded by time; at `until` the obligation is due again (bounded backoff, not erasure). */
const BOUNDED = ["capacity", "prerequisite"];
const MAX_BACKOFF_MS = 7 * 24 * 3600 * 1000;
const effectClass = (state: string) => state === "reserved" ? "reserved" : UNCERTAIN_EFFECT.includes(state) ? "uncertain" : state;
export const objectiveHash = (plan: WorkflowPlan) => digest({ plan: plan.definition.id, request: plan.definition.request });
export const continuationId = (scopeId: string, planId: string) => stableId("continuation", scopeId, planId);
const nodeTuple = (id: string, plans: readonly WorkflowPlan[]) => {
  const s = plans.find(p => p.nodes[id])?.nodes[id];
  return s ? [id, s.state, s.attempt ?? null, !!s.held, s.invalidated ?? null, s.answer ?? null, !!s.closedWithoutLanding, s.spent ?? 0] : [id, null];
};
/** What an accepted completion rests on: graph, node outcomes (including invalidation) and external prerequisites. */
export function outcomeHash(status: SupervisionStatus, plan: WorkflowPlan): string {
  const plans = status.plans.map(p => p.plan);
  return digest({ definition: digest(plan.definition), status: plan.status, nodes: plan.definition.nodes.map(n => nodeTuple(n.id, [plan])),
    external: [...new Set(plan.definition.nodes.flatMap(n => n.after.map(e => e.node)).filter(id => !plan.nodes[id]))].sort().map(id => nodeTuple(id, plans)) });
}

/** A launch is definitively over once any of its attempt's effects failed or was cancelled (the gateway
 * cancels never-dispatched siblings on a definite launch refusal). Pending or uncertain effects stay live;
 * nothing here releases a reservation, refunds spend or relaunches.
 */
export const launchEnded = (status: SupervisionStatus, attemptId: string | undefined) =>
  !!attemptId && status.effects.some(e => e.attemptId === attemptId && ["failed", "cancelled"].includes(e.state));
/** Whether an external prerequisite is being advanced right now: a live (not definitively ended) started
 * attempt, or a captain decision the answer handler would accept. Same rule at admission and readback.
 */
function externalAdvancing(status: SupervisionStatus, nodeId: string): boolean {
  const plans = status.plans.map(p => p.plan), owner = plans.find(p => p.nodes[nodeId]), state = owner?.nodes[nodeId];
  const node = owner?.definition.nodes.find(n => n.id === nodeId);
  if (!owner || !state || state.held || state.invalidated) return false;
  if (LIVE_NODE.includes(state.state)) return !launchEnded(status, state.attempt);
  return node?.kind === "decision" && planDecisionReady(owner, node, plans);
}
/** Only facts that change what the owner must do. */
export function semanticInputs(status: SupervisionStatus, scopeId: string, planId: string) {
  const plan = status.plans.find(p => p.scopeId === scopeId && p.plan.definition.id === planId)?.plan ?? null;
  const binding = status.bindings.find(b => b.scopeId === scopeId), scope = status.scopes.find(s => s.id === scopeId);
  const tasks = status.tasks.filter(t => t.ownerScopeId === scopeId && t.planId === planId);
  return {
    objective: plan ? objectiveHash(plan) : null, outcome: plan ? outcomeHash(status, plan) : null, budget: plan?.approvedBudget ?? null,
    holds: status.operationHolds.filter(h => h.scopeId === scopeId && h.planId === planId).map(h => [h.id, h.state, h.version]),
    decisions: status.decisions.filter(d => d.ownerScopeId === scopeId && d.planId === planId).map(d => [d.id, d.state]),
    attempts: status.attempts.filter(a => tasks.some(t => t.id === a.taskId)).map(a => [a.id, a.state, a.worker?.agentId ?? null]),
    // Worker effects only. Supervisor activation/turn delivery is bookkeeping for the owner session.
    effects: status.effects.filter(e => e.scopeId === scopeId && e.attemptId !== null).map(e => [e.id, effectClass(e.state)]),
    owner: binding ? [binding.epoch, binding.state] : null, scope: scope?.state ?? null,
    backend: status.backends.find(b => b.planId === planId)?.state ?? null,
    // Coarse liveness of external prerequisites: a definitive upstream launch failure is a new generation
    // (fresh wake key), while ordinary upstream effect progress does not churn this goal.
    externalLiveness: plan ? [...new Set(plan.definition.nodes.flatMap(n => n.after.map(e => e.node)).filter(id => !plan.nodes[id]))].sort()
      .map(id => [id, externalAdvancing(status, id)]) : [],
    // New semantic facts, not transport/disposition versions. Cross-source duplicates and our own
    // offer/ack/assessment writes must not generate another owner turn. All provenance stays in S02.
    facts: status.inbox.assignments.filter(a => a.scopeId === scopeId && a.id === a.primaryEventId &&
      tasks.some(t => status.attempts.some(attempt => attempt.id === a.attemptId && attempt.taskId === t.id)))
      .filter(a => status.inbox.events.find(e => e.id === a.id)?.critical)
      .map(a => a.consequenceKey).sort(),
    externalCommands: status.commands.filter(c => c.result.planId === planId && c.actor.kind !== "agent" &&
      status.outbox.some(o => o.ownerScopeId === scopeId && o.causationId === c.id)).map(c => c.id).sort(),
  };
}
export const continuationInputVersion = (status: SupervisionStatus, scopeId: string, planId: string) => digest(semanticInputs(status, scopeId, planId));

export interface DerivedContinuation {
  scopeId: string; planId: string; title: string; inputVersion: string; objectiveHash: string | null;
  derived: ContinuationDisposition; disposition: ContinuationDisposition; reason: string; responsible: "scope-owner" | "captain";
  nextNodes: string[]; waits: ContinuationWait[]; assessed: Continuation | null;
  /** The accepted completion applies to the current outcome; a stale one stays in history only. */
  completionApplies: boolean;
  /** True when the owner must take one bounded pass for this exact input generation. */
  due: boolean; deliverable: boolean; wakeKey: string;
  owner: { agentId: string; epoch: number; state: string } | null;
  activeWorkers: number; activeEffects: number; uncertainEffects: number;
  offers: { pending: number; uncertain: number };
  evidenceAt: string | null; projectIds: string[];
}

export function deriveContinuation(status: SupervisionStatus, scopeId: string, planId: string, now = Date.now()): DerivedContinuation {
  const plan = status.plans.find(p => p.scopeId === scopeId && p.plan.definition.id === planId)?.plan ?? null;
  const scope = status.scopes.find(s => s.id === scopeId), binding = status.bindings.find(b => b.scopeId === scopeId);
  const inputVersion = continuationInputVersion(status, scopeId, planId), objective = plan ? objectiveHash(plan) : null;
  const assessed = status.continuations.find(c => c.scopeId === scopeId && c.planId === planId) ?? null;
  const plans = status.plans.map(p => p.plan), waits: ContinuationWait[] = [], nextNodes: string[] = [];
  const effects = status.effects.filter(e => e.scopeId === scopeId), workerEffects = effects.filter(e => e.attemptId !== null);
  const failedLaunch = (attempt: string | undefined) => launchEnded(status, attempt);
  let activeWorkers = 0;
  for (const node of plan?.definition.nodes ?? []) {
    const state = plan!.nodes[node.id];
    if (state && LIVE_NODE.includes(state.state) && !failedLaunch(state.attempt)) {
      if (status.attempts.some(a => a.id === state.attempt && a.worker !== null)) activeWorkers++;
      waits.push({ kind: "attempt", id: state.attempt ?? node.id, detail: `${node.title}: ${state.state}` });
    }
  }
  for (const e of workerEffects.filter(e => LIVE_EFFECT.includes(e.state)))
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
  const completionApplies = !!plan && !!assessed?.completion && assessed.objectiveHash === objective && assessed.completion.outcomeHash === outcomeHash(status, plan);
  if (assessed?.completion && !completionApplies) waits.push({ kind: "prerequisite", id: "completion", detail: "The accepted completion no longer matches the current outcome evidence; reconcile it." });
  const derived: ContinuationDisposition = !plan ? "needs-planning" : completionApplies ? "completed" : paused ? "paused" : scopeHeld ? "blocked" :
    nextNodes.length ? "ready-action" : captain ? "captain-decision" : activeWorkers || waits.some(w => w.kind === "effect") ? "waiting" :
    holds.length || budgetBlocked ? "blocked" : "needs-planning";
  const actionable = derived === "ready-action" || derived === "needs-planning";
  const expired = (assessed?.waits ?? []).some(w => w.until && Date.parse(w.until) <= now);
  // A current, validated quiet assessment explains an obligation; it never erases it, and a bounded wait expires.
  const applies = !!plan && !!assessed && assessed.waits.every(w => !waitProblem(status, scopeId, waits, plan, w, now, false)) && readyWorkBlocked(nextNodes, assessed.waits);
  const quiet = actionable && assessed?.inputVersion === inputVersion && assessed.epoch === binding?.epoch && assessed.disposition !== "completed" && !expired && applies;
  const disposition = quiet ? assessed!.disposition : derived;
  const reason = quiet ? assessed!.reason : !plan ? "No plan is recorded for this scope." : reasonFor(derived, nextNodes, waits);
  const deliverable = scope?.state === "active" && binding?.state === "active";
  const offers = effects.filter(e => e.attemptId === null && e.operation === "agent.send");
  const backoff = actionable && assessed?.inputVersion === inputVersion && expired ? assessed.version : null;
  return { scopeId, planId, title: plan?.definition.title ?? planId, inputVersion, objectiveHash: objective, derived, disposition, reason,
    responsible: derived === "captain-decision" || (derived === "blocked" && (scopeHeld || (!holds.length && budgetBlocked))) || paused ? "captain" : "scope-owner",
    nextNodes, waits, assessed, completionApplies, due: actionable && !quiet, deliverable,
    wakeKey: digest({ continuation: scopeId, planId, inputVersion, backoff }),
    owner: binding ? { agentId: binding.agentId, epoch: binding.epoch, state: binding.state } : null, activeWorkers,
    activeEffects: workerEffects.filter(e => LIVE_EFFECT.includes(e.state)).length,
    uncertainEffects: effects.filter(e => UNCERTAIN_EFFECT.includes(e.state)).length,
    offers: { pending: offers.filter(e => e.state === "reserved").length, uncertain: offers.filter(e => UNCERTAIN_EFFECT.includes(e.state)).length },
    evidenceAt: [...Object.values(plan?.nodes ?? {}).map(n => n.completedAt ?? null), assessed?.at ?? null].filter((v): v is string => !!v).sort().at(-1) ?? null,
    projectIds: scope?.projectIds ?? [] };
}
function reasonFor(d: ContinuationDisposition, next: string[], waits: ContinuationWait[]): string {
  if (d === "ready-action") return `Start or answer: ${next.join(", ")}.`;
  if (d === "needs-planning") return `Outcome unresolved with no ready, live or decided next step; the owner must plan the continuation.${waits.some(w => w.id === "completion") ? " The accepted completion no longer applies." : ""}`;
  if (d === "completed") return "Outcome accepted with evidence.";
  return waits.map(w => w.detail).join("; ").slice(0, 1024) || d;
}
/** Every scoped plan in the store. Reads only; heartbeat/restart/turn-end triggers all use this. */
export function continuationAgenda(status: SupervisionStatus, now = Date.now()): DerivedContinuation[] {
  if (status.freshness !== "current") return [];
  return status.backends.filter(b => b.backend === "scoped" && b.state === "active" && !status.retirements.some(r => r.plan === b.planId))
    .map(b => deriveContinuation(status, b.ownerScopeId, b.planId, now));
}
/** Goal and project level truth for S05: owner, next action or wait, live worker/effect counts and evidence age. */
export function goalStatus(status: SupervisionStatus, now = Date.now()) {
  const age = (at: string | null) => at ? Math.max(0, now - Date.parse(at)) : null;
  const goals = continuationAgenda(status, now).map(c => {
    const failure = status.effects.filter(e => e.scopeId === c.scopeId && e.attemptId === null && e.operation === "agent.send" && e.state === "failed").at(-1);
    return { scopeId: c.scopeId, planId: c.planId, title: c.title, state: c.disposition,
    owner: c.owner?.state === "active" ? c.owner.agentId : null, ownerEpoch: c.owner?.epoch ?? null, responsible: c.responsible, next: c.reason, due: c.due,
    activeWorkers: c.activeWorkers, activeEffects: c.activeEffects, uncertainEffects: c.uncertainEffects, offers: c.offers,
    evidenceAt: c.evidenceAt, evidenceAgeMs: age(c.evidenceAt), projectIds: c.projectIds,
    lastSupervisorFailure: failure ? { effectId: failure.id, epoch: failure.epoch, reason: failure.receiptRef } : null };
  });
  const projects = [...new Set(goals.flatMap(g => g.projectIds))].sort().map(projectId => {
    const own = goals.filter(g => g.projectIds.includes(projectId));
    const evidenceAt = own.map(g => g.evidenceAt).filter((v): v is string => !!v).sort().at(-1) ?? null;
    return { projectId, goals: own.length, activeWorkers: own.reduce((n, g) => n + g.activeWorkers, 0), activeEffects: own.reduce((n, g) => n + g.activeEffects, 0),
      needsPlanning: own.filter(g => g.state === "needs-planning").length, due: own.filter(g => g.due).length,
      owners: [...new Set(own.map(g => g.owner).filter((v): v is string => !!v))], next: own.map(g => ({ planId: g.planId, state: g.state, reason: g.next, lastSupervisorFailure: g.lastSupervisorFailure })),
      evidenceAt, evidenceAgeMs: age(evidenceAt) };
  });
  return { freshness: status.freshness, sequence: status.sequence, goals, projects };
}

export interface ContinuationRecord {
  requestId: string; scopeId: string; planId: string; epoch: number; inputVersion: string;
  disposition: RecordedDisposition; reason: string; waits: ContinuationWait[]; completion: { evidence: string } | null;
}
/** Whether one wait still names a current, unresolved fact that accounts for the obligation. Used when
 * recording and again on every quiet derivation, so a persisted wait cannot outlive its supporting fact.
 */
function waitProblem(status: SupervisionStatus, scopeId: string, derivedWaits: readonly ContinuationWait[], plan: WorkflowPlan,
  w: ContinuationWait, now: number, recording: boolean): string | null {
  const plans = status.plans.map(p => p.plan);
  if (BOUNDED.includes(w.kind)) {
    const until = w.until ? Date.parse(w.until) : NaN;
    if (!(until > now) || (recording && until - now > MAX_BACKOFF_MS)) return `A ${w.kind} wait needs a bounded backoff (until, at most seven days ahead).`;
    return null;
  }
  if (w.until) return `Only capacity and prerequisite waits are time-bounded.`;
  if (w.kind === "attempt") return derivedWaits.some(d => d.kind === "attempt" && d.id === w.id) ? null : `Attempt ${w.id} is not live in this goal.`;
  if (w.kind === "effect") return status.effects.some(e => e.id === w.id && e.scopeId === scopeId && e.attemptId !== null && LIVE_EFFECT.includes(e.state)) ? null : `Effect ${w.id} is not live in this goal.`;
  if (w.kind === "hold") return derivedWaits.some(d => d.kind === "hold" && d.id === w.id) ? null : `Hold ${w.id} is not held.`;
  if (w.kind === "decision") {
    // Only a captain-authority decision the answer handler would accept now (prerequisites met, unanswered).
    const node = plan.definition.nodes.find(n => n.id === w.id);
    return node?.kind === "decision" && decisionOwner(plan, node) === "captain" && planDecisionReady(plan, node, plans) ? null :
      `A routine continuation stays with its owner; ${w.id} is not a currently answerable captain-authority decision.`;
  }
  if (w.kind === "dependency") {
    // An external prerequisite accounts for the wait only while something is advancing it.
    const edge = plan.definition.nodes.some(n => !plan.nodes[w.id] && n.after.some(e => e.node === w.id && !dependenciesMet({ ...n, after: [e] }, plans)));
    return edge && externalAdvancing(status, w.id) ? null :
      `Dependency ${w.id} is unmet without live progress (a definitively failed or cancelled launch is not progress); plan around it or name a bounded prerequisite wait.`;
  }
  return null;
}
/** Each recorded wait must name something real that accounts for the obligation. */
function validateWaits(status: SupervisionStatus, derived: DerivedContinuation, plan: WorkflowPlan, waits: ContinuationWait[], now: number) {
  for (const w of waits) {
    const problem = waitProblem(status, derived.scopeId, derived.waits, plan, w, now, true);
    if (problem) refuse("HELD", problem);
  }
  if (!readyWorkBlocked(derived.nextNodes, waits)) refuse("HELD", "Ready work stays due unless a capacity, hold or prerequisite wait blocks it.");
}
/** Ready work must actually be blocked. Live work elsewhere or a captain decision does not block a step whose prerequisites are met. */
const readyWorkBlocked = (nextNodes: readonly string[], waits: readonly ContinuationWait[]) =>
  !nextNodes.length || waits.some(w => ["capacity", "hold", "prerequisite"].includes(w.kind));
/** The owner's durable result for one input generation. Planning and ready work are discharged only by
 * committing them; a recorded wait/block must be concrete and bounded; completion must be evidenced.
 */
export async function recordContinuation(store: SupervisionStore, input: ContinuationRecord, actor: SupervisionActor, enabled = false, now = () => Date.now()) {
  if (!enabled) refuse("UNSUPPORTED", "Scoped continuation records are disabled.");
  if (!RecordedDisposition.safeParse(input.disposition).success)
    refuse("UNSUPPORTED", "Planning and ready work are cleared by committing a revision or start, not by recording intent.");
  return store.transactCommand(input.requestId, digest({ continuation: input }), actor, async status => {
    const scope = status.scopes.find(s => s.id === input.scopeId), binding = status.bindings.find(b => b.scopeId === input.scopeId);
    if (!scope || scope.mode !== "scoped" || scope.kind !== "plan") refuse("UNKNOWN_OWNER", "Exact scoped plan owner required.");
    if (!binding || binding.epoch !== input.epoch) refuse("STALE", "The owner epoch changed; a previous owner's assessment cannot commit.");
    if (actor.kind === "agent" ? actor.id !== binding.agentId : actor.kind !== "captain-ui")
      refuse("UNKNOWN_OWNER", "Only the bound owner or an explicit captain action records a continuation; General is not a bypass.");
    if (actor.kind === "agent" && (binding.state !== "active" || scope.state !== "active")) refuse("HELD", "The owner is not active.");
    if (input.disposition === "paused" && actor.kind !== "captain-ui") refuse("UNSUPPORTED", "Use the checked plan stop for an owner pause; idleness is never a pause.");
    const at = now(), derived = deriveContinuation(status, input.scopeId, input.planId, at);
    if (derived.inputVersion !== input.inputVersion) refuse("STALE", "Facts changed since this assessment; reread before deciding.");
    const plan = status.plans.find(p => p.scopeId === input.scopeId && p.plan.definition.id === input.planId)?.plan ?? refuse("UNKNOWN_OWNER", "No scoped plan.");
    const old = derived.assessed;
    if (old && old.inputVersion === input.inputVersion && old.epoch === input.epoch && !derived.due && digest([old.disposition, old.waits]) === digest([input.disposition, input.waits]))
      refuse("CONFLICT", "This input generation is already assessed; an unchanged retry is not progress.");
    if (input.disposition === "completed") {
      if (!input.completion?.evidence.trim()) refuse("HELD", "Completion needs acceptance evidence for the outcome, not an empty queue.");
      if (derived.activeWorkers || derived.activeEffects) refuse("HELD", "Completion needs quiescent workers and settled effects.");
      if (derived.nextNodes.length || derived.waits.some(w => w.kind === "decision"))
        refuse("HELD", "Ready work or an open decision remains; cancel or revise it before accepting the outcome.");
    } else {
      if (input.completion) refuse("CONFLICT", "Only completion carries completion evidence.");
      if (!input.waits.length && input.disposition !== "paused") refuse("HELD", "A quiet disposition must name what accounts for the obligation.");
      validateWaits(status, derived, plan, input.waits, at);
    }
    if (input.disposition === "captain-decision" && !input.waits.some(w => w.kind === "decision"))
      refuse("HELD", "A routine continuation stays with its owner; only a captain-authority decision escalates.");
    const completion = input.completion ? { evidence: input.completion.evidence, planHash: plan.hash, outcomeHash: outcomeHash(status, plan) } : null;
    // Accepted completions are history: superseding one keeps it verbatim with why.
    const superseded = [...(old?.superseded ?? []), ...(old?.completion && digest(old.completion) !== digest(completion)
      ? [{ completion: old.completion, reason: derived.completionApplies ? input.reason : "Outcome evidence changed after acceptance.", at: new Date(at).toISOString() }] : [])];
    const value = ContinuationSchema.parse({ id: continuationId(input.scopeId, input.planId), version: (old?.version ?? 0) + 1,
      scopeId: input.scopeId, planId: input.planId, objectiveHash: objectiveHash(plan), inputVersion: input.inputVersion, epoch: input.epoch,
      disposition: input.disposition, reason: input.reason, responsible: input.disposition === "captain-decision" || input.disposition === "paused" ? "captain" : "scope-owner",
      nextNodes: derived.nextNodes, waits: input.waits, completion, superseded, provenance: actor, at: new Date(at).toISOString() });
    const mutations: SupervisionMutation[] = [{ kind: "continuation", value }];
    return { expectedVersions: expectedFor(status, mutations), mutations, result: { planId: input.planId, planHash: plan.hash, decisionId: null, outboxId: null } };
  });
}

/** Restart / lost-callback scan: observe the exact workers of live attempts. Read-only facts for the
 * owner; it neither retargets a native callback, reprompts to "rearm", nor creates a worker.
 */
export async function livenessScan(status: SupervisionStatus, receiver: GatewayReceiver, options: { scopeId?: string; timeoutMs?: number } = {}) {
  const live = status.attempts.filter(a => a.worker?.hostId.trim().toLowerCase() === "local" && ["active", "prompted"].includes(a.state)).filter(attempt => {
    const task = status.tasks.find(t => t.id === attempt.taskId), node = task ? status.plans.find(p => p.plan.definition.id === task.planId)?.plan.nodes[task.nodeId] : undefined;
    return !!node && LIVE_NODE.includes(node.state) && task?.currentAttempt === attempt.id && (!options.scopeId || task.ownerScopeId === options.scopeId);
  });
  return Promise.all(live.map(async attempt => {
    let found: Awaited<ReturnType<GatewayReceiver["findAgent"]>> = null;
    try { found = await observeWithin(receiver, `agent:${attempt.worker!.agentId}`, () => receiver.findAgent(attempt.worker!.agentId), options.timeoutMs); }
    catch { /* Unknown subject, including a pending lookup; retain the attempt. No absence/death inference. */ }
    const observed = found?.id === attempt.worker!.agentId ? found : null; // A misbound answer is no observation.
    const state = !observed ? "not visible (unknown, not absent)" : observed.archivedAt ? "archived" : observed.status;
    return { attemptId: attempt.id, agentId: attempt.worker!.agentId, observed: state,
      ownerReview: !!observed && (observed.archivedAt !== null || ["idle", "error", "closed"].includes(observed.status) || observed.pendingPermissions > 0) };
  }));
}
