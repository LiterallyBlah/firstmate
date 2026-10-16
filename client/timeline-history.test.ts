import { expect, it } from "vitest";
import type { TimelinePage, TimelineEntry } from "./transcript-rows";
import { mergeTimelineHistory } from "./timeline-history";
const entry = (seq: number, text = `message ${seq}`) =>
  ({ seqStart: seq, seqEnd: seq, item: { type: "user_message", text } }) as TimelineEntry;
const page = (seqs: number[], patch: Partial<TimelinePage> = {}): TimelinePage =>
  ({
    entries: seqs.map((seq) => entry(seq)),
    direction: "tail",
    epoch: "one",
    reset: false,
    staleCursor: false,
    gap: false,
    startCursor: { epoch: "one", seq: seqs[0]! },
    endCursor: { epoch: "one", seq: seqs.at(-1)! },
    hasOlder: true,
    window: { minSeq: 1, maxSeq: 100, nextSeq: 101 },
    ...patch,
  }) as TimelinePage;

it("prepends a projected page without duplicating its boundary, and retains it through a tail update", () => {
  const history = mergeTimelineHistory(page([4, 5, 6]), page([1, 2, 3, 4], { direction: "before", hasOlder: false }));
  expect(history.entries.map((e) => e.seqStart)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(history.hasOlder).toBe(false);
  const live = mergeTimelineHistory(history, page([5, 6, 7], { entries: [entry(5), entry(6, "updated"), entry(7)] }));
  expect(live.entries.map((e) => e.seqStart)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(live.entries[5]?.item).toMatchObject({ text: "updated" });
  expect(live.hasOlder).toBe(false);
});

it("never preserves a stale prefix across epochs, rewinds, gaps or non-overlapping tails", () => {
  const previous = page([1, 2, 3]);
  for (const patch of [{ epoch: "two" }, { reset: true }, { gap: true }, { staleCursor: true }]) {
    const next = page([2, 3, 4], patch);
    expect(mergeTimelineHistory(previous, next)).toBe(next);
  }
  const disconnected = page([20, 21]);
  expect(mergeTimelineHistory(previous, disconnected)).toBe(disconnected);
  expect(mergeTimelineHistory(previous, page([])).entries).toEqual([]);
});

it("does not retain a projected row that overlaps a replacement row", () => {
  const previous = page([1, 2, 3], { entries: [{ ...entry(1), seqEnd: 3 }, entry(4)] });
  const result = mergeTimelineHistory(previous, page([2, 3, 4]));
  expect(result.entries.map((e) => e.seqStart)).toEqual([2, 3, 4]);
});
