import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { chatReturnKey, chatReturnState } from "./chat-return";
import { useAgentTimeline, type AgentTimeline } from "./use-timeline";
import { useFollowEnd } from "./follow-end";
import type { TimelineEntry, TimelinePage } from "./transcript-rows";
const rpc = vi.hoisted(() => ({ refetch: vi.fn(), scroll: vi.fn(), end: vi.fn() }));
const paseo = { agents: { ref: () => ({ timeline: { refetch: rpc.refetch, subscribe: () => () => {} } }) } };
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => paseo }));
let tree: ReactTestRenderer, timeline: AgentTimeline, follow: ReturnType<typeof useFollowEnd>;
const entry = (seq: number) => ({ seqStart: seq, seqEnd: seq, item: { type: "user_message", text: `Message ${seq}` } }) as TimelineEntry;
const page = (seqs: number[], patch: Partial<TimelinePage> = {}) => ({ entries: seqs.map(entry), agent: null, error: null, direction: "tail", epoch: "one", reset: false, staleCursor: false, gap: false,
  startCursor: { epoch: "one", seq: seqs[0]! }, endCursor: { epoch: "one", seq: seqs.at(-1)! }, hasOlder: true, window: { minSeq: 1, maxSeq: 100, nextSeq: 101 }, ...patch }) as TimelinePage;
afterEach(async () => { await act(async () => tree?.unmount()); vi.clearAllMocks(); });
it("isolates return state by host/home/agent and survives bundle reevaluation", () => {
  const root = {}, key = chatReturnKey("host", "home", "mate");
  chatReturnState(key, root).scroll = { offset: 150, pinned: false };
  expect(chatReturnState(key, root).scroll?.offset).toBe(150);
  for (const other of [chatReturnKey("other", "home", "mate"), chatReturnKey("host", "other", "mate"), chatReturnKey("host", "home", "other")]) expect(chatReturnState(other, root).scroll).toBeUndefined();
});
it("retains opened history through remount and a live tail, then discards it on an epoch change", async () => {
  const key = chatReturnKey("test", "history", "mate");
  function Host() { timeline = useAgentTimeline("mate", "", 150, key); return null; }
  rpc.refetch.mockResolvedValueOnce(page([4, 5])).mockResolvedValueOnce(page([1, 2, 3], { direction: "before", hasOlder: false }));
  await act(async () => { tree = create(createElement(Host)); });
  await act(async () => timeline.loadOlder());
  expect(timeline.entries.map(e => e.seqStart)).toEqual([1, 2, 3, 4, 5]);
  await act(async () => tree.unmount());
  let resolve!: (value: TimelinePage) => void;
  rpc.refetch.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => { tree = create(createElement(Host)); });
  expect(timeline.entries.map(e => e.seqStart)).toEqual([1, 2, 3, 4, 5]);
  await act(async () => resolve(page([5, 6])));
  expect(timeline.entries.map(e => e.seqStart)).toEqual([1, 2, 3, 4, 5, 6]);
  await act(async () => tree.unmount());
  rpc.refetch.mockResolvedValueOnce(page([7], { epoch: "two" }));
  await act(async () => { tree = create(createElement(Host)); });
  expect(timeline.entries.map(e => e.seqStart)).toEqual([7]);
});
it("restores the reader's offset and keeps it when hidden content reports zero height", async () => {
  const saved = { scroll: { offset: 225, pinned: false } };
  function Host() { follow = useFollowEnd(saved); return createElement("ScrollView", follow.scrollProps); }
  await act(async () => { tree = create(createElement(Host), { createNodeMock: () => ({ scrollTo: rpc.scroll, scrollToEnd: rpc.end }) }); });
  await act(async () => follow.scrollProps.onContentSizeChange(300, 1000));
  expect(rpc.scroll).toHaveBeenCalledWith({ y: 225, animated: false });
  await act(async () => follow.scrollProps.onContentSizeChange(0, 0));
  expect(saved.scroll).toEqual({ offset: 225, pinned: false });
  expect(rpc.end).not.toHaveBeenCalled();
});
