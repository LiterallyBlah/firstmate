import type { TimelinePage } from "./transcript-rows";

/** Keep an explicitly opened history prefix as the live tail changes; never join different epochs or gaps. */
export function mergeTimelineHistory(previous: TimelinePage | null, page: TimelinePage): TimelinePage {
  if (previous === null || previous.epoch !== page.epoch || page.reset || page.staleCursor || page.gap) return page;
  if (page.direction === "before") {
    const first = previous.entries[0]?.seqStart ?? Infinity;
    const prefix = page.entries.filter((entry) => entry.seqEnd < first);
    return {
      ...previous,
      entries: [...prefix, ...previous.entries],
      startCursor: prefix.length ? page.startCursor : previous.startCursor,
      hasOlder: page.hasOlder,
    };
  }
  const first = page.entries[0]?.seqStart;
  const last = previous.entries.at(-1)?.seqEnd;
  if (first === undefined || last === undefined || first > last + 1) return page;
  const prefix = previous.entries.filter((entry) => entry.seqEnd < first && entry.seqStart >= page.window.minSeq);
  return prefix.length === 0
    ? page
    : {
        ...page,
        entries: [...prefix, ...page.entries],
        startCursor: { epoch: page.epoch, seq: prefix[0]!.seqStart },
        hasOlder: previous.hasOlder,
      };
}
