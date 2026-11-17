/**
 * A whole-turn timeline page, as Paseo 0.16's `timeline.refetch({ direction: "tail", limit: 1, wholeTurns: true })`
 * answers it: the ended turn's entries, each carrying its `turnId`. The `agent.turn_ended` hook no longer carries
 * history, so a test that ends a turn serves the turn through this.
 */
import type { TimelineItem, TimelinePage } from "../server/host-types";

export function turnPage(agentId: string, turnId: string | null, items: readonly unknown[], extra: Partial<TimelinePage> = {}): TimelinePage {
  return {
    agentId, epoch: "epoch-1", direction: "tail", projection: "projected", reset: false, staleCursor: false, gap: false,
    hasOlder: false, hasNewer: false, startCursor: null, endCursor: null, error: null,
    window: { minSeq: 1, maxSeq: items.length, nextSeq: items.length + 1 },
    entries: items.map((item, index) => ({
      seqStart: index + 1, seqEnd: index + 1, ...(turnId === null ? {} : { turnId }),
      timestamp: new Date(0).toISOString(), item: item as TimelineItem,
    })),
    ...extra,
  } as unknown as TimelinePage;
}

type Ending = { agent: { id: string }; turnId: string | null; timeline?: readonly unknown[] };

/**
 * A turn's end the way Paseo 0.16 delivers it: the hook's `timeline` emptied (the compatibility array), and
 * what the turn contained served instead by `paseo.agents.ref(agentId).timeline.refetch`. Everything else
 * on `paseo` is the caller's own.
 */
export function asDelivered<E extends Ending>(event: E, paseo: unknown): { event: E; paseo: never } {
  const items = event.timeline ?? [];
  const base = (paseo ?? {}) as { agents?: { ref?: (id: string) => Record<string, unknown> } & Record<string, unknown> } & Record<string, unknown>;
  const agents = base.agents ?? {};
  const served = {
    ...base,
    agents: {
      ...agents,
      ref: (id: string) => {
        const original = agents.ref?.(id) ?? {};
        if (id !== event.agent.id) return original;
        return { ...original, timeline: { ...(original.timeline as object | undefined), refetch: async () => turnPage(id, event.turnId, items) } };
      },
    },
  };
  return { event: { ...event, timeline: [] }, paseo: served as never };
}
