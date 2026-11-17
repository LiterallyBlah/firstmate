/**
 * The entries of one ended turn, read back from the agent's timeline.
 *
 * Paseo's `agent.turn_ended` hook carries no history: from 0.16 the SDK no longer declares
 * `timeline`, and the daemon fills the field with an empty compatibility array
 * (`plugins/runtime.ts` in Paseo). The hook's own documentation says how to read the turn:
 * `timeline.refetch({ direction: "tail", limit: 1, wholeTurns: true })`, keeping the entries
 * whose `turnId` is the ended one. `wholeTurns` (Paseo 0.16.0, hence the manifest's floor)
 * extends a page back to the start of the oldest turn it touches, so one page is one or more
 * whole turns.
 *
 * A newer turn can start before the read — a steer the provider could not join cancels the
 * running turn and starts one — so a tail page without the ended turn walks back a few whole
 * turns, on the same epoch. Anything short of finding the turn is `incomplete`, with why:
 * never an empty turn. Callers treat incomplete as "not seen", not as "seen and empty".
 */
import type { PaseoApi, TimelineItem, TimelinePage } from "./host-types";

/** Whole turns walked back past the newest before giving up: turns rarely start this fast. */
export const TURN_READ_PAGES = 4;

export type TurnRead =
  | { complete: true; turnId: string; items: TimelineItem[]; entries: TimelinePage["entries"] }
  | { complete: false; reason: "no-turn-id" | "fetch-failed" | "page-error" | "page-gap" | "epoch-changed" | "not-found" };

export async function readEndedTurn(paseo: PaseoApi, agentId: string, turnId: string | null, pages = TURN_READ_PAGES): Promise<TurnRead> {
  if (!turnId) return { complete: false, reason: "no-turn-id" };
  let cursor: TimelinePage["startCursor"] = null, epoch: string | null = null;
  for (let page = 0; page < pages; page++) {
    let read: TimelinePage;
    try {
      read = await paseo.agents.ref(agentId).timeline.refetch({
        direction: cursor ? "before" : "tail", limit: 1, wholeTurns: true, projection: "projected", ...(cursor ? { cursor } : {}),
      });
    } catch {
      return { complete: false, reason: "fetch-failed" };
    }
    if (read.error || read.agentId !== agentId) return { complete: false, reason: "page-error" };
    if (read.gap || read.reset || read.staleCursor) return { complete: false, reason: "page-gap" };
    if (epoch !== null && read.epoch !== epoch) return { complete: false, reason: "epoch-changed" };
    epoch = read.epoch;
    const entries = read.entries.filter((entry) => entry.turnId === turnId);
    if (entries.length > 0) return { complete: true, turnId, items: entries.map((entry) => entry.item), entries };
    if (!read.hasOlder || !read.startCursor) break;
    cursor = read.startCursor;
  }
  return { complete: false, reason: "not-found" };
}
