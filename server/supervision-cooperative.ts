/** S11 conservative D6 integration: which scopes are demonstrably drained and reconciled for cooperative use.
 *
 * Pure read over the stored projection. It writes nothing, so it stays clear of every journal band (S08 at 128,
 * S10 at 160, S04/S09 at 192 and S07's release reservation); it only reports when those bands have stopped the
 * observations it relies on. Each dependency on an earlier slice is named and checked separately, and any one
 * unmet holds the scope: an unresolved scope stays visibly held with its reasons, never counted as relieved.
 * A ready scope is cooperative, nothing more (`COOPERATIVE_LIMITS`): no isolation, failover or takeover claim.
 */
import type { SupervisionStatus } from "../shared/supervision";
import { MAINTENANCE_ADMISSION_CEILING } from "../shared/supervision-maintenance";
import { SOURCE_LIMITS } from "../shared/supervision-sources";
import { COOPERATIVE_LIMITS } from "./supervision-capabilities";
import { SUPERVISION_INDEX_LIMITS } from "./supervision-store";

export type CooperativeDependencyId = "journal" | "scope" | "binding" | "cutover" | "deliveries" | "effects" | "workers"
  | "reservations" | "dependencies" | "board-sends" | "holds";
export interface CooperativeDependency { id: CooperativeDependencyId; slice: string; satisfied: boolean; reasons: string[] }
export interface CooperativeReadiness {
  format: "firstmate.cooperative-readiness/1"; scopeId: string; sequence: number; mode: "cooperative";
  /** Every dependency satisfied. Only then may General's relief be claimed for this scope. */
  ready: boolean; lowerBound: boolean; dependencies: CooperativeDependency[]; limits: readonly string[];
}

const UNSETTLED_EFFECT = ["dispatching", "accepted", "uncertain"];
const LIVE_NODE = ["starting", "running", "unresolved"];
/** The journal bands, as the slices that own them record them. */
export const JOURNAL_BANDS = [
  { slice: "S08", ceiling: SOURCE_LIMITS.observationCeiling, stops: "pull request, remote and board observation" },
  { slice: "S10", ceiling: MAINTENANCE_ADMISSION_CEILING, stops: "maintenance admissions and waiting-state observation" },
  { slice: "S04/S09", ceiling: SUPERVISION_INDEX_LIMITS.admissions, stops: "new admissions; settlement and S07's release reservation continue" },
] as const;

/** Check one scope. The dependencies are read in a fixed order and each lists every reason it is unmet. */
export function cooperativeReadiness(status: SupervisionStatus, scopeId: string): CooperativeReadiness {
  const dep = (id: CooperativeDependencyId, slice: string, reasons: string[]): CooperativeDependency => ({ id, slice, satisfied: reasons.length === 0, reasons });
  const scope = status.scopes.find(s => s.id === scopeId);
  const plans = new Set(status.plans.filter(p => p.scopeId === scopeId).map(p => p.plan.definition.id));
  const tasks = status.tasks.filter(t => t.ownerScopeId === scopeId), taskIds = new Set(tasks.map(t => t.id));
  const attempts = status.attempts.filter(a => taskIds.has(a.taskId));
  const migrations = (status.migrations ?? []).filter(m => m.scopeId === scopeId);
  const reached = JOURNAL_BANDS.filter(b => status.sequence >= b.ceiling);

  const journal = dep("journal", "S01", [
    ...(status.freshness !== "current" ? [`The journal is ${status.freshness}; nothing can be shown drained.`] : []),
    ...reached.map(b => `Journal sequence ${status.sequence} reached ${b.slice}'s band at ${b.ceiling}: ${b.stops} stopped, so observations may be stale.`),
  ]);
  const scopeDep = dep("scope", "S03", !scope ? ["The scope is not registered."] : [
    ...(scope.mode !== "scoped" ? ["The scope is still legacy."] : []),
    ...(["held", "transferring", "retired"].includes(scope.state) ? [`The scope is ${scope.state}.`] : []),
  ]);
  const binding = dep("binding", "S04", status.bindings.filter(b => b.scopeId === scopeId && (b.state === "prepared" || b.state === "suspect"))
    .map(b => `Supervisor epoch ${b.epoch} is ${b.state}: its owner is not shown current, and a replacement is manual only.`));

  // S07: a plan this scope owns is cut over only by a committed migration; prepared/barrier hold both writers.
  const cutoverReasons: string[] = [];
  for (const b of status.backends.filter(b => b.ownerScopeId === scopeId || plans.has(b.planId)))
    if (!(b.backend === "scoped" && (b.state === "active" || b.state === "retired"))) cutoverReasons.push(`Plan ${b.planId} backend is ${b.backend}/${b.state}.`);
  for (const plan of new Set(migrations.map(m => m.planId))) {
    const last = migrations.filter(m => m.planId === plan).at(-1)!;
    if (last.state === "prepared" || last.state === "barrier") cutoverReasons.push(`Plan ${plan} migration ${last.id} is ${last.state}.`);
    else if (last.state === "aborted") cutoverReasons.push(`Plan ${plan} was released back to the legacy backend (migration ${last.id}).`);
  }
  const cutover = dep("cutover", "S07", cutoverReasons);
  const deliveries = dep("deliveries", "S07", (status.dispositions ?? []).filter(d => d.scopeId === scopeId).flatMap(d => [
    ...(d.route === "hold" && !d.resolvedBy ? [`Legacy ${d.source} delivery ${d.id} is held: ${d.reason}`.slice(0, 300)] : []),
    ...(d.removal.state === "pending" || d.removal.state === "mismatch" ? [`Legacy ${d.source} delivery ${d.id} removal is ${d.removal.state}.`] : []),
    // As S07's report: a committed transfer is not handled until the current owner's result is recorded.
    ...(d.route === "transfer-fact" && !d.receipts.ack ? [`Transferred ${d.source} delivery ${d.id} awaits its owner's result.`] : []),
  ]));

  const effects = dep("effects", "S04", status.effects.filter(e => e.scopeId === scopeId && UNSETTLED_EFFECT.includes(e.state))
    .map(e => `Effect ${e.id} (${e.operation}) is ${e.state}; it keeps its reservation and is never retried automatically.`));

  // A legacy worker still running reports to its original creator: without U2 it drains or is held, never re-prompted.
  const nodeState = (planId: string, attempt: string) => {
    const plan = status.plans.find(p => p.plan.definition.id === planId)?.plan;
    if (!plan) return null;
    const all = [...Object.values(plan.nodes), ...(plan.removed ?? []).map(r => r.state)];
    const flat = all.flatMap(s => [s, ...(s.priorAttempts ?? [])]);
    return flat.find(s => s.attempt === attempt)?.state ?? null;
  };
  const workers = dep("workers", "S07", attempts.flatMap(a => {
    const out: string[] = [];
    if (a.notificationStatus === "unknown") out.push(`Attempt ${a.id}'s native callback owner is unknown.`);
    if (a.importedFrom) {
      const state = nodeState(tasks.find(t => t.id === a.taskId)!.planId, a.importedFrom.legacyAttempt);
      if (state === null || LIVE_NODE.includes(state)) out.push(`Imported legacy attempt ${a.importedFrom.legacyAttempt} is ${state ?? "unaccounted"}; its callback still goes to ${a.originalNotificationOwner ?? "an unknown owner"}.`);
    }
    return out;
  }).concat(status.plans.filter(p => p.scopeId === scopeId).flatMap(p => Object.entries(p.plan.nodes)
    .filter(([, s]) => s.state === "unresolved").map(([node]) => `Plan ${p.plan.definition.id} node ${node} is unresolved (an uncertain launch).`))));

  const rows = status.maintenance;
  const reservations = dep("reservations", "S10", (rows?.reservations ?? []).filter(r => r.scopeId === scopeId && r.state === "suspect")
    .map(r => `Reservation ${r.id} is suspect: its holder's lease expired without terminal evidence.`));
  const dependencies = dep("dependencies", "S09", (status.projects?.dependencies ?? []).filter(d => d.scopeId === scopeId && d.state === "held")
    .map(d => `Plan ${d.planId} node ${d.nodeId}'s dependency on ${d.edge.node} is held (${d.reason}).`));
  const boardSends = dep("board-sends", "S08", status.sources.submissions.filter(x => x.scopeId === scopeId && (x.state === "reserved" || x.state === "uncertain"))
    .map(x => `Board message ${x.messageId} to ${x.agentId} has ${x.state === "reserved" ? "no recorded outcome" : "an unknown outcome"}.`));
  const holds = dep("holds", "S03/S09", status.operationHolds.filter(h => h.scopeId === scopeId && h.state === "held")
    .map(h => `Operations ${h.operations.join(", ")} are held: ${h.reason}`));

  const dependencyList = [journal, scopeDep, binding, cutover, deliveries, effects, workers, reservations, dependencies, boardSends, holds];
  return { format: "firstmate.cooperative-readiness/1", scopeId, sequence: status.sequence, mode: "cooperative",
    ready: dependencyList.every(d => d.satisfied), lowerBound: status.freshness !== "current" || reached.length > 0,
    dependencies: dependencyList.map(d => ({ ...d, reasons: d.reasons.slice(0, 16) })), limits: COOPERATIVE_LIMITS };
}

/** Every non-General scope's readiness. Fleet-wide relief is never claimed here: a held scope, or any legacy source
 * outside the census S12 owns, still delivers to General. */
export function cooperativeRollout(status: SupervisionStatus) {
  const scopes = status.scopes.filter(s => s.kind !== "general" && s.state !== "retired").map(s => cooperativeReadiness(status, s.id));
  return { format: "firstmate.cooperative-rollout/1" as const, sequence: status.sequence, ready: scopes.filter(s => s.ready).map(s => s.scopeId),
    held: scopes.filter(s => !s.ready).map(s => ({ scopeId: s.scopeId, unmet: s.dependencies.filter(d => !d.satisfied).map(d => d.id) })),
    fleetWideRelief: false as const, scopes };
}
