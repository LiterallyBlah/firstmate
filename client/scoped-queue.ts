/** Scoped decisions and paused plans as entries of the one Needs you queue. Pure.
 * They keep their own answer path: these ids never reach the backlog ledger or its answer RPC. */
import type { NeedsYouRequest, NeedsYouSnapshot } from "../shared/needs-you";
import { decisionCardSnapshot } from "../shared/plan-decisions";
import { decisionQueue } from "./needs-you-state";

export type ScopedRow = NonNullable<NeedsYouSnapshot["scopedDecisions"]>[number];
export type ScopedHold = NonNullable<NeedsYouSnapshot["scopedHolds"]>[number];
export type ScopedEntry =
  | { kind: "decision"; id: string; row: ScopedRow }
  | { kind: "hold"; id: string; planId: string; holds: ScopedHold[] };

const DECISION_PREFIX = "scope-decision:", HOLD_PREFIX = "scope-hold:";
export const scopedDecisionQueueId = (row: ScopedRow) => `${DECISION_PREFIX}${row.decision.ownerScopeId}:${row.decision.id}`;
export const scopedHoldQueueId = (planId: string) => `${HOLD_PREFIX}${planId}`;
export const isScopedQueueId = (id: string) => id.startsWith(DECISION_PREFIX) || id.startsWith(HOLD_PREFIX);

/** Exactly what the server counts (`withScopedNeedsYou`): each ready decision, and each held plan once. */
export function scopedEntries(snapshot: NeedsYouSnapshot | undefined): ScopedEntry[] {
  const decisions = (snapshot?.scopedDecisions ?? []).filter(row => row.ready)
    .map(row => ({ kind: "decision" as const, id: scopedDecisionQueueId(row), row }));
  const plans = [...new Set((snapshot?.scopedHolds ?? []).map(h => h.planId))];
  const holds = plans.map(planId => ({ kind: "hold" as const, id: scopedHoldQueueId(planId), planId,
    holds: snapshot!.scopedHolds!.filter(h => h.planId === planId) }));
  return [...decisions, ...holds];
}

export function scopedEntry(snapshot: NeedsYouSnapshot | undefined, id: string): ScopedEntry | undefined {
  return isScopedQueueId(id) ? scopedEntries(snapshot).find(e => e.id === id) : undefined;
}

/** A queue placeholder for navigation only; the drawer draws the scoped entry itself. */
export function scopedQueueRequest(entry: ScopedEntry, snapshot: NeedsYouSnapshot): NeedsYouRequest {
  const d = entry.kind === "decision" ? entry.row.decision : null;
  const title = d?.title ?? `${snapshot.scopeDirectory?.find(s => s.planId === (entry as { planId: string }).planId)?.title ?? "This plan"} is paused`;
  const ask = d?.question ?? (entry.kind === "hold" ? entry.holds.map(h => h.reason).join(" ") : "");
  return { id: entry.id, source: { key: JSON.stringify(["scope-queue", entry.id]), taskId: d?.nodeId ?? (entry as { planId: string }).planId, hostId: "local", project: null,
    title, ask, url: null, reportPath: null, gateToken: null, section: "in-flight", disposition: "open", blockedBy: null },
    generation: 1, revision: d?.revision ?? 1, state: "seen", detectedAt: 0, updatedAt: 0, originalAsk: ask, baseline: true,
    seenAt: null, seenRevision: null, snoozedUntil: null, submissions: [], resolution: null };
}

/** The drawer's "1 of N" queue: backlog and plan decisions first, then scoped ones. */
export function needsYouQueue(snapshot: NeedsYouSnapshot | undefined): NeedsYouRequest[] {
  if (!snapshot) return [];
  const ordinary = decisionQueue(decisionCardSnapshot(snapshot).requests).filter(r => r.state === "new" || r.state === "seen");
  return [...ordinary, ...scopedEntries(snapshot).map(e => scopedQueueRequest(e, snapshot))];
}
