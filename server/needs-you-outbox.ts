import type { NeedsYouTransition } from "../shared/needs-you";
import type { NeedsYouLedger } from "./needs-you-ledger";

/** Read-only cursor, not a delivery acknowledgement. No sender is registered. */
export function readDecisionTransitions(
  ledger: NeedsYouLedger,
  after = 0,
  limit = 100,
): NeedsYouTransition[] {
  return structuredClone(
    ledger.outbox
      .filter((event) => event.sequence > after)
      .slice(0, Math.max(0, Math.min(1000, limit))),
  );
}

/** A future adapter must revalidate immediately before delivery, with fresh source data. */
export function currentDeliveryCandidates(
  ledger: NeedsYouLedger,
  enabled = false,
  fresh = false,
): NeedsYouTransition[] {
  if (!enabled || !fresh) return [];
  const latest = new Map<string, NeedsYouTransition>();
  for (const event of ledger.outbox) {
    const request = ledger.requests.find(
      (entry) => entry.id === event.requestId,
    );
    if (
      !request ||
      request.state !== "new" ||
      request.revision !== event.revision
    )
      continue;
    if (
      [
        "actionable",
        "snooze-due",
        "updated",
        "unsnoozed",
        "answer-failed",
      ].includes(event.kind)
    )
      latest.set(request.id, event);
  }
  return structuredClone([...latest.values()]);
}
