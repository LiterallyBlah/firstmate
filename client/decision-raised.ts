/**
 * Where a decision the first mate raised appears in its chat: once, as a card
 * built from the Needs-you snapshot, at the moment the ledger first saw it.
 * The card reads the request afresh on every render, so the chat never holds
 * a copy of the decision of its own. Pure.
 */
import type { DecisionAnswerOption, NeedsYouRequest, NeedsYouSnapshot } from "../shared/needs-you";
import { boundAnswers } from "./needs-you-state";
import type { TimelineEntry, TranscriptRow } from "./transcript-rows";

/** When an entry was recorded, in milliseconds; null when the host gave nothing readable. */
export function entryTime(entry: TimelineEntry): number | null {
  const raw: unknown = (entry as { timestamp?: unknown }).timestamp;
  const at =
    raw instanceof Date ? raw.getTime() : typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isFinite(at) ? at : null;
}

/**
 * The decisions this conversation raised: every request the ledger detected
 * (not the quiet baseline it started from) no earlier than the first loaded
 * entry. One raised before that belongs to earlier history or to a previous
 * first mate, and appears only once that history is loaded.
 */
export function raisedDecisions(
  snapshot: NeedsYouSnapshot | undefined,
  entries: readonly TimelineEntry[],
): NeedsYouRequest[] {
  if (!snapshot?.homeId) return [];
  const first = entries.map(entryTime).find((at) => at !== null);
  if (first === undefined || first === null) return [];
  return snapshot.requests
    .filter((request) => !request.baseline && request.detectedAt >= first)
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
): TranscriptRow[] {
  const raised = raisedDecisions(snapshot, entries);
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
