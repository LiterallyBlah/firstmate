/** Read-only projection of daemon gates. No hold detection, acknowledgement or count reconstruction. */
import type { FleetCard } from "../shared/fleet";
import type { NeedsYouRequest, NeedsYouSnapshot } from "../shared/needs-you";

/** Shared drawer seam: opens the current revision of an id, or the next decision. */
export type OpenDeckDecision = (decision: string | "next") => void;

export interface DeckDecisions {
  snapshot: NeedsYouSnapshot;
  byCard: ReadonlyMap<string, NeedsYouRequest>;
  inHand: ReadonlySet<string>;
  parked: ReadonlySet<string>;
  workerless: NeedsYouRequest[];
  workerlessCount: number | null;
}

export function deckDecisions(cards: readonly FleetCard[], snapshot: NeedsYouSnapshot, live: (card: FleetCard) => boolean): DeckDecisions {
  const byCard = new Map<string, NeedsYouRequest>();
  const inHand = new Set<string>(), parked = new Set<string>();
  const workerless: NeedsYouRequest[] = [];
  let assigned = 0;
  // An unavailable count is not zero, and cached requests in a disabled snapshot cannot light the bow.
  if (snapshot.actionCount !== null && snapshot.freshness.status !== "disabled") {
    for (const source of snapshot.parked) for (const card of cards) {
      if (card.taskId === source.taskId && (card.remote?.serverId ?? (card.remote === undefined ? "local" : null)) === source.hostId) parked.add(card.key);
    }
    for (const request of snapshot.requests) {
      const matching = cards.filter(card => card.taskId === request.source.taskId &&
        (card.remote?.serverId ?? (card.remote === undefined ? "local" : null)) === request.source.hostId);
      const open = request.state === "new" || request.state === "seen";
      if (open) {
        const workers = matching.filter(live);
        // Ambiguous matches stay with the first mate; never put the same gate on two sailors.
        if (workers.length === 1 && !byCard.has(workers[0]!.key)) {
          byCard.set(workers[0]!.key, request);
          assigned++;
        } else workerless.push(request);
      } else if (request.state === "answer-sent" || request.state === "delivery-uncertain") {
        for (const card of matching) inHand.add(card.key);
      } else if (request.state === "snoozed") {
        for (const card of matching) parked.add(card.key);
      }
    }
  }
  workerless.sort((a, b) => Number(b.state === "new") - Number(a.state === "new") || a.detectedAt - b.detectedAt || a.id.localeCompare(b.id));
  return { snapshot, byCard, inHand, parked, workerless, workerlessCount: snapshot.actionCount === null ? null : Math.max(0, snapshot.actionCount - assigned) };
}

export const DECK_MOVE_WORDS = { blocked: "needs you", waiting: "with the first mate", working: "at work", idle: "parked" } as const;
