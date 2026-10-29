/**
 * Where a decision the first mate raised appears in its chat: once, as a card
 * built from the Needs-you snapshot, at the moment the ledger first saw it.
 * The card reads the request afresh on every render, so the chat never holds
 * a copy of the decision of its own. Pure.
 */
import { quarantinesSource, type DecisionAnswerOption, type NeedsYouRequest, type NeedsYouSnapshot } from "../shared/needs-you";
import { boundAnswers, decisionProblems } from "./needs-you-state";
import type { TimelineEntry, TranscriptRow } from "./transcript-rows";

/** When an entry was recorded, in milliseconds; null when the host gave nothing readable. */
export function entryTime(entry: TimelineEntry): number | null {
  const raw: unknown = (entry as { timestamp?: unknown }).timestamp;
  const at =
    raw instanceof Date ? raw.getTime() : typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isFinite(at) ? at : null;
}

/**
 * The decisions this first mate raised: every request the ledger detected (not
 * the quiet baseline it started from) since this first mate took the helm
 * (`mateSince`, the config's record of its tenure). An adopted agent's history
 * goes back before its adoption; what the ledger saw then was another first
 * mate's, so neither adoption nor loading earlier history brings it in. A
 * tenure not yet recorded shows nothing. Within the tenure, a decision before
 * the first loaded entry waits for that history to load, so it is never drawn
 * above the conversation it belongs in.
 */
export function raisedDecisions(
  snapshot: NeedsYouSnapshot | undefined,
  entries: readonly TimelineEntry[],
  mateSince: string | null,
): NeedsYouRequest[] {
  if (!snapshot?.homeId || mateSince === null) return [];
  const since = Date.parse(mateSince);
  const first = entries.map(entryTime).find((at) => at !== null);
  if (!Number.isFinite(since) || first === undefined || first === null) return [];
  return snapshot.requests
    .filter((request) => !request.baseline && request.detectedAt >= since && request.detectedAt >= first)
    .sort((a, b) => a.detectedAt - b.detectedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The transcript with each raised decision's row before the first row recorded
 * after it, or at the end when nothing has been said since. Rows keep their
 * order and keys; a decision row is keyed by its request id, which is stable
 * across revisions, so a reworded question updates its card in place.
 */
export function withRaisedDecisions(
  rows: readonly TranscriptRow[],
  entries: readonly TimelineEntry[],
  snapshot: NeedsYouSnapshot | undefined,
  mateSince: string | null,
): TranscriptRow[] {
  const raised = raisedDecisions(snapshot, entries, mateSince);
  if (raised.length === 0) return [...rows];
  const times = new Map<string, number>();
  for (const entry of entries) {
    const at = entryTime(entry);
    if (at !== null) times.set(String(entry.seqStart), at);
  }
  const out: TranscriptRow[] = [];
  let next = 0;
  const card = (request: NeedsYouRequest): TranscriptRow => ({
    key: `decision:${request.id}`,
    kind: "decision-raised",
    text: request.source.title,
    requestId: request.id,
  });
  for (const row of rows) {
    const at = times.get(row.key);
    while (next < raised.length && at !== undefined && at > raised[next]!.detectedAt) out.push(card(raised[next++]!));
    out.push(row);
  }
  while (next < raised.length) out.push(card(raised[next++]!));
  return out;
}

export type RaisedStatus = { settled: boolean; label: string };

/** What the card says about where the decision stands; answered and lifted both read as settled. */
export function raisedStatus(request: NeedsYouRequest): RaisedStatus {
  switch (request.state) {
    case "answer-sent":
      return { settled: true, label: "Answered · waiting for the first mate" };
    case "delivery-uncertain":
      return { settled: true, label: "Answered · delivery not confirmed" };
    case "resolved":
      return {
        settled: true,
        label: `Settled · ${
          request.resolution?.reason === "completed"
            ? "task completed"
            : request.resolution?.reason === "deferred"
              ? "parked for later"
              : request.resolution?.reason === "superseded"
                ? "question replaced"
                : "hold lifted"
        }`,
      };
    case "snoozed":
      return { settled: false, label: "Decision needs you · snoozed" };
    default:
      return { settled: false, label: "Decision needs you" };
  }
}

/** The answers the drawer offers for this revision: the same bound options, through the same send. */
export function raisedChoices(snapshot: NeedsYouSnapshot, request: NeedsYouRequest): DecisionAnswerOption[] {
  if (!snapshot.homeId) return [];
  const bound = new Set(boundAnswers(snapshot.answerOptions ?? [], snapshot.homeId, request));
  return (snapshot.answerOptions ?? []).filter((option) => bound.has(option));
}

export type RaisedWarning = { headline: string; details: string[] };

/**
 * Why the card's content may be out of date, the drawer's words for one decision: a backlog
 * FirstMate cannot read (stale, disabled, unknown, offline), or this task's own line unreadable
 * (quarantined). The card keeps the last known question and recommendation beside it, with its
 * answers disabled. Null when the snapshot is current for this decision.
 */
export function raisedWarning(
  snapshot: NeedsYouSnapshot,
  request: NeedsYouRequest,
  offline = false,
): RaisedWarning | null {
  const scoped = (snapshot.quarantined ?? []).filter((row) => quarantinesSource([row], request.source));
  const unreadable = scoped
    .filter((row) => row.hasHold)
    .map((row) => `Couldn't read this task${row.taskId ? `: ${row.taskId}` : ""}. Check the Board and data/backlog.md${row.line ? `, line ${row.line}` : ""}.`);
  const status = snapshot.freshness.status;
  if (!offline && status === "fresh")
    return scoped.length ? { headline: "Some backlog lines need repair", details: [...scoped.map((row) => row.problem), ...unreadable] } : null;
  return {
    headline:
      (status === "stale" || offline) && snapshot.freshness.asOf != null
        ? "This decision may be out of date. You can answer once FirstMate can read the backlog again."
        : status === "disabled"
          ? "Decision observation is disabled"
          : "Can’t read decisions",
    details: [...decisionProblems(snapshot, offline), ...unreadable],
  };
}
