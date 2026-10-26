import { decisionClock } from "./decision-copy";
import type { NeedsYouRequest, NeedsYouSnapshot } from "../shared/needs-you";
import type { Suggestion } from "../shared/fleet";
import type { DecisionIntent } from "./decision-discussion";

export type DecisionDestination = {
  /** A server request id, or the client destinations next, empty and all. */
  requestId: string;
  homeId?: string;
  recordRevision?: number;
};
export function decisionRoute(
  destination: DecisionDestination = { requestId: "next" },
  intent?: DecisionIntent,
) {
  return {
    screenId: "fleet",
    params: {
      decision: destination.requestId,
      ...(destination.homeId ? { decisionHome: destination.homeId } : {}),
      ...(destination.recordRevision
        ? { decisionRevision: String(destination.recordRevision) }
        : {}),
      ...(intent?.discussWith ? { discussMate: intent.discussWith, chat: "show" } : {}),
      ...(intent?.board ? { decisionBoard: "show" } : {}),
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
  const recordedCount =
    snapshot?.freshness.status === "unknown" ||
    snapshot?.freshness.status === "disabled"
      ? null
      : (snapshot?.actionCount ?? null);
  const partialPlans = recordedCount === null && (snapshot?.planNow?.length ?? 0) > 0;
  const partialScoped = recordedCount === null ? (snapshot?.scopedDecisions?.filter(r => r.ready).length ?? 0) + new Set(snapshot?.scopedHolds?.map(h => h.planId)).size : 0;
  const partialCount = partialPlans || partialScoped > 0;
  const unavailablePlans = !!snapshot?.planProblems?.length || snapshot?.scopedComplete === false;
  const count = partialCount ? (partialPlans ? snapshot!.planNow!.length : 0) + partialScoped : unavailablePlans && recordedCount === 0 ? null : recordedCount;
  const fresh = !offline && snapshot?.freshness.status === "fresh" && !unavailablePlans;
  const newCount = snapshot?.newCount ?? 0;
  const status = offline ? "stale" : (snapshot?.freshness.status ?? "unknown");
  const problems = decisionProblems(snapshot, offline);
  const explanation =
    problems.slice(0, 3).join(" ") +
    (problems.length > 3
      ? ` ${problems.length - 3} more problems in decisions.`
      : "");
  const extra = [
    newCount > 0 ? `${newCount} new` : "",
    status === "stale"
      ? offline
        ? "offline"
        : ""
      : status === "disabled"
        ? "disabled"
        : count === null
          ? "unavailable"
          : "",
    snapshot?.pendingAnswerCount
      ? `${snapshot.pendingAnswerCount} answer${snapshot.pendingAnswerCount === 1 ? "" : "s"} pending`
      : "",
    snapshot?.snoozedCount ? `${snapshot.snoozedCount} snoozed` : "",
    snapshot?.quarantined?.length
      ? `${snapshot.quarantined.length} unreadable task${snapshot.quarantined.length === 1 ? "" : "s"}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    count,
    newCount,
    fresh,
    amber: count !== null && count > 0,
    filled: fresh && newCount > 0,
    stale: !fresh && count !== null,
    unavailable: count === null,
    label:
      count === null
        ? "Can't read decisions"
        : count === 0 && fresh
          ? "Nothing needs you"
          : `Needs you · ${count}${unavailablePlans ? "+ · some plans unavailable" : partialScoped ? "+ · known actions only" : partialPlans ? "+ · plans only" : ""}${!fresh && snapshot?.freshness.asOf != null ? ` · as of ${decisionClock(snapshot.freshness.asOf)}` : ""}`,
    badge: count === null ? "!" : `${count}${partialCount || unavailablePlans ? "+" : ""}`,
    extra,
    accessibilityLabel: `Needs you, ${count === null ? "count unavailable" : unavailablePlans ? `at least ${count} items; some plans unavailable` : partialScoped ? `at least ${count} known actions; other decisions unavailable` : partialPlans ? `at least ${count} plan actions; other decisions unavailable` : `${count} items`}${extra ? `, ${extra}` : ""}${!fresh && count !== null && snapshot?.freshness.asOf != null ? `, as of ${decisionClock(snapshot.freshness.asOf)}` : ""}. ${explanation}${explanation ? " " : ""}Open decisions`,
  };
}

export function decisionProblems(
  snapshot: NeedsYouSnapshot | undefined,
  offline = false,
): string[] {
  return [
    ...new Set([
      ...(snapshot?.planProblems ?? []),
      ...(snapshot?.scopedProblems ?? []),
      ...(offline
        ? ["Could not refresh decision data. Check the host connection."]
        : []),
      ...(snapshot?.freshness.problems ?? []),
      ...(!offline &&
      snapshot &&
      snapshot.freshness.status !== "fresh" &&
      !snapshot.freshness.problems.length
        ? [
            snapshot.freshness.status === "disabled"
              ? "Decision observation is disabled."
              : "FirstMate cannot confirm the backlog. The last known decisions are read-only.",
          ]
        : []),
      ...(!snapshot ? ["Decision data is unavailable from the host."] : []),
    ]),
  ];
}

/** Every count surface uses the server total and explicitly labels an old count. */
export function decisionCountText(
  snapshot: NeedsYouSnapshot | undefined,
  offline = false,
): string {
  if (snapshot?.planProblems?.length || (snapshot?.actionCount == null && snapshot?.planNow?.length)) {
    const state = indicatorState(snapshot, offline);
    return state.count === null ? "unavailable" : `${state.badge} · ${snapshot?.planProblems?.length ? "some plans unavailable" : "plans only"}`;
  }
  if (
    snapshot?.actionCount == null ||
    snapshot.freshness.status === "unknown" ||
    snapshot.freshness.status === "disabled"
  )
    return "unavailable";
  return `${snapshot.actionCount}${offline || snapshot.freshness.status !== "fresh" ? " · stale" : ""}`;
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
  const base = next.freshness.checkedAt < previous.freshness.checkedAt ? previous :
    next.homeId === previous.homeId && next.version < previous.version ? { ...previous, freshness: next.freshness } : next;
  if (next.homeId !== previous.homeId || (previous.scopedSequence === undefined && next.scopedSequence === undefined)) return base;
  // The two journals have independent versions. A slower backlog read cannot regress an
  // already observed scoped answer, and a newer scope read cannot resurrect old backlog rows.
  const scoped = (next.scopedSequence ?? -1) >= (previous.scopedSequence ?? -1) ? next : previous;
  const contribution = (s: NeedsYouSnapshot) => (s.scopedDecisions?.filter(r => r.ready).length ?? 0) + new Set(s.scopedHolds?.map(h => h.planId)).size;
  const complete = scoped.scopedComplete === true && next.scopedComplete !== false;
  return { ...base, scopedDecisions: scoped.scopedDecisions, scopedSequence: scoped.scopedSequence, scopedHolds: scoped.scopedHolds,
    scopedComplete: complete, scopedAnswersEnabled: scoped.scopedAnswersEnabled === true && next.scopedAnswersEnabled !== false,
    scopedProblems: complete ? scoped.scopedProblems : [...new Set([...(scoped.scopedProblems ?? []), ...(next.scopedProblems ?? []), "Scoped decisions could not be confirmed; counts are a lower bound."])],
    scopedPendingAnswerCount: scoped.scopedPendingAnswerCount,
    actionCount: base.actionCount === null ? null : base.actionCount - contribution(base) + contribution(scoped),
    pendingAnswerCount: base.pendingAnswerCount === null ? null : base.pendingAnswerCount - (base.scopedPendingAnswerCount ?? 0) + (scoped.scopedPendingAnswerCount ?? 0) };
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
/** A decision's draft, by home, request and revision: the drawer's and the chat card's alike. */
export function decisionDraftKey(homeId: string | null, request: Pick<NeedsYouRequest, "id" | "revision">) {
  return JSON.stringify([homeId, request.id, request.revision]);
}
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
