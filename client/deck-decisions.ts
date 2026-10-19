/** Read-only projection of daemon gates. No hold detection, acknowledgement or count reconstruction. */
import type { FleetCard } from "../shared/fleet";
import type { DecisionSource, NeedsYouRequest, NeedsYouSnapshot } from "../shared/needs-you";
import type { DecisionDestination } from "./needs-you-state";

/** Bind the shared drawer to the ledger home and revision that the Deck is displaying. */
export function deckDecisionDestination(snapshot: NeedsYouSnapshot | undefined, requestId: string): DecisionDestination {
  const request = snapshot?.requests.find(request => request.id === requestId);
  return { requestId, ...(snapshot?.homeId ? { homeId: snapshot.homeId } : {}),
    ...(request === undefined ? {} : { recordRevision: request.revision }) };
}

export interface DeckDecisions {
  snapshot: NeedsYouSnapshot;
  byCard: ReadonlyMap<string, NeedsYouRequest>;
  inHand: ReadonlySet<string>;
  parked: ReadonlySet<string>;
  workerless: NeedsYouRequest[];
  workerlessCount: number | null;
}

function matchesSource(card: FleetCard, source: DecisionSource) {
  return card.taskId === source.taskId &&
    (card.backlog ? card.backlog.project : card.project) === source.project &&
    (card.remote?.serverId ?? (card.remote === undefined ? "local" : null)) === source.hostId;
}

export function deckDecisions(cards: readonly FleetCard[], snapshot: NeedsYouSnapshot, live: (card: FleetCard) => boolean): DeckDecisions {
  const byCard = new Map<string, NeedsYouRequest>();
  const inHand = new Set<string>(), parked = new Set<string>();
  const workerless: NeedsYouRequest[] = [];
  let assigned = 0;
  // An unavailable count is not zero, and cached requests in a disabled snapshot cannot light the bow.
  if (snapshot.actionCount !== null && snapshot.freshness.status !== "disabled") {
    for (const source of snapshot.parked) for (const card of cards) {
      if (matchesSource(card, source)) parked.add(card.key);
    }
    for (const request of snapshot.requests) {
      const matching = cards.filter(card => matchesSource(card, request.source));
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

/** Ledger total, never the number of figures at the bow. */
export function deckDecisionLabel(snapshot: NeedsYouSnapshot | undefined, offline = false): string {
  if (snapshot?.freshness.status === "disabled") return "Decisions are off";
  if (!snapshot || snapshot.actionCount === null || snapshot.freshness.status === "unknown") return "Can't read decisions";
  const label = snapshot.actionCount === 0 ? "Nothing needs you" : `${snapshot.actionCount} ${snapshot.actionCount === 1 ? "needs" : "need"} you`;
  return offline || snapshot.freshness.status === "stale"
    ? `${label} · as of ${snapshot.freshness.asOf === null ? "last good read" : new Date(snapshot.freshness.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : label;
}
