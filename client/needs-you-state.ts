import type { NeedsYouRequest, NeedsYouSnapshot } from "../shared/needs-you";
import type { Suggestion } from "../shared/fleet";

export type DecisionDestination = {
  requestId: string;
  homeId?: string;
  recordRevision?: number;
};
export function decisionRoute(
  destination: DecisionDestination = { requestId: "next" },
) {
  return {
    screenId: "fleet",
    params: {
      decision: destination.requestId,
      ...(destination.homeId ? { decisionHome: destination.homeId } : {}),
      ...(destination.recordRevision
        ? { decisionRevision: String(destination.recordRevision) }
        : {}),
    },
  };
}
export function routeDecision(
  params: Readonly<Record<string, string>>,
): DecisionDestination | null {
  if (!params.decision) return null;
  const revision = Number(params.decisionRevision);
  return {
    requestId: params.decision,
    ...(params.decisionHome ? { homeId: params.decisionHome } : {}),
    ...(Number.isSafeInteger(revision) && revision > 0
      ? { recordRevision: revision }
      : {}),
  };
}
export function indicatorState(
  snapshot: NeedsYouSnapshot | undefined,
  offline = false,
) {
  const count = snapshot?.actionCount ?? null;
  const fresh = !offline && snapshot?.freshness.status === "fresh";
  const newCount = snapshot?.newCount ?? 0;
  const status = offline ? "stale" : (snapshot?.freshness.status ?? "unknown");
  const extra = [
    newCount > 0 ? `${newCount} new` : "",
    status === "stale"
      ? "stale"
      : status === "disabled"
        ? "disabled"
        : count === null
          ? "unavailable"
          : "",
    snapshot?.pendingAnswerCount
      ? `${snapshot.pendingAnswerCount} answer${snapshot.pendingAnswerCount === 1 ? "" : "s"} pending`
      : "",
    snapshot?.snoozedCount ? `${snapshot.snoozedCount} snoozed` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    count,
    newCount,
    fresh,
    amber: fresh && newCount > 0,
    label: `Needs you · ${count ?? "?"}`,
    extra,
    accessibilityLabel: `Needs you, ${count === null ? "count unavailable" : `${count} decisions`}${extra ? `, ${extra}` : ""}. Open decisions`,
  };
}
/** Queue is unfiltered and never changes an already selected ID. */
export function decisionQueue(requests: readonly NeedsYouRequest[]) {
  const rank = (r: NeedsYouRequest) =>
    r.state === "new"
      ? 0
      : r.state === "seen"
        ? 1
        : r.state === "snoozed"
          ? 3
          : 2;
  return requests
    .filter((r) => r.state !== "resolved")
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.detectedAt - b.detectedAt ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}
export function boundAnswers(
  suggestions: readonly Suggestion[],
  homeId: string,
  request: NeedsYouRequest,
) {
  const matches = suggestions.filter(
    (s) =>
      s.decision?.homeId === homeId &&
      s.decision.requestId === request.id &&
      s.decision.recordRevision === request.revision,
  );
  return matches.filter(
    (s) =>
      matches.filter(
        (other) => other.decision!.actionId === s.decision!.actionId,
      ).length === 1,
  );
}
export function mergeDecisionSnapshot(
  previous: NeedsYouSnapshot | undefined,
  next: NeedsYouSnapshot,
): NeedsYouSnapshot {
  if (!previous) return next;
  if (next.freshness.checkedAt < previous.freshness.checkedAt) return previous;
  if (next.homeId === previous.homeId && next.version < previous.version)
    return { ...previous, freshness: next.freshness };
  return next;
}
export function tomorrowNine(now: number) {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}
/** Explicit local time, with round-trip validation (including nonexistent DST times). */
export function chosenWake(text: string, now: number): number | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(
    text.trim(),
  );
  if (!parts) return null;
  const [, y, m, d, h, min] = parts.map(Number);
  const date = new Date(y!, m! - 1, d!, h!, min!, 0, 0);
  return date.getFullYear() === y &&
    date.getMonth() === m! - 1 &&
    date.getDate() === d &&
    date.getHours() === h &&
    date.getMinutes() === min &&
    date.getTime() > now
    ? date.getTime()
    : null;
}

export interface DecisionSession {
  surfaces: Set<() => boolean>;
  batches: Map<string, Set<string>>;
  drafts: Map<string, string>;
}
const slot = Symbol.for("paseo.firstmate.decisions.v2");
export function decisionSession(
  owner: object,
  root: object = globalThis,
): DecisionSession {
  let sessions = Reflect.get(root, slot) as
    | WeakMap<object, DecisionSession>
    | undefined;
  if (!sessions) {
    sessions = new WeakMap();
    Reflect.set(root, slot, sessions);
  }
  let session = sessions.get(owner);
  if (!session) {
    session = { surfaces: new Set(), batches: new Map(), drafts: new Map() };
    sessions.set(owner, session);
  }
  return session;
}
/** One quiet batch per observed set of new transitions; initial/reloaded baselines are silent. */
export function newDecisionBatch(
  session: DecisionSession,
  snapshot: NeedsYouSnapshot | undefined,
): NeedsYouRequest[] {
  if (!snapshot?.homeId || snapshot.freshness.status !== "fresh") return [];
  const seen = session.batches.get(snapshot.homeId);
  const current = snapshot.requests.filter(
    (r) => r.state === "new" && !r.baseline,
  );
  const token = (r: NeedsYouRequest) => r.id;
  const added = seen ? current.filter((r) => !seen.has(token(r))) : [];
  const next = new Set<string>();
  current.forEach((r) => next.add(token(r)));
  session.batches.set(snapshot.homeId, next);
  return [...session.surfaces].some((visible) => visible()) ? [] : added;
}
