import { describe, expect, it } from "vitest";

import { CAPTAIN_MESSAGE_ID_PREFIX, CaptainMessageSchema, type CaptainMessage } from "../shared/attachments";
import { captainMessage, toAttachment } from "./attachments";
import { captainMessageId, createSentImageStore, keepSentImages } from "./sent-images";
import { ATTACHMENTS_ONLY, transcriptRows, type TimelineEntry } from "./transcript-rows";

const png = { data: "iVBORw0KGgo=", mimeType: "image/png" };
const jpeg = { data: "/9j/4AAQSkZJRg==", mimeType: "image/jpeg" };

/**
 * What the daemon records for a sent message, as Paseo 0.11's `recordSubmittedPrompt` does: the words
 * alone (`submittedPromptText` keeps only text blocks), under the send's `messageId` as `clientMessageId`.
 */
function daemonEcho(message: CaptainMessage, seq: number): TimelineEntry {
  return {
    provider: "claude",
    item: {
      type: "user_message",
      text: message.text,
      ...(message.messageId === undefined ? {} : { clientMessageId: message.messageId }),
    },
    timestamp: "2026-10-15T15:00:00.000Z",
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    collapsed: [],
  } as TimelineEntry;
}

/** The images the chat draws in the captain's row for `entry`, the way `client/chat.tsx` finds them. */
function drawnImages(store: ReturnType<typeof createSentImageStore>, entries: TimelineEntry[]) {
  return transcriptRows(entries).map((row) => (row.kind === "captain" ? store.get(row.messageId) : []));
}

describe("a sent image in the first mate's chat", () => {
  it("is drawn in the captain's row once the daemon echoes the message without it", () => {
    const store = createSentImageStore({});
    const picked = toAttachment({ fileName: "trail.png", mimeType: "image/png", size: 8, data: png.data }, "a");
    const outgoing = keepSentImages(captainMessage("I believe the angle of this trail needs to be higher", [picked]), store);

    expect(CaptainMessageSchema.parse(outgoing)).toEqual(outgoing);
    expect(outgoing.images).toEqual([png]);
    const rows = transcriptRows([daemonEcho(outgoing, 7)]);
    expect(rows).toEqual([
      {
        key: "7",
        kind: "captain",
        text: "I believe the angle of this trail needs to be higher",
        messageId: outgoing.messageId,
      },
    ]);
    expect(drawnImages(store, [daemonEcho(outgoing, 7)])).toEqual([[png]]);
  });

  it("is drawn for a message of images alone, which the row otherwise marks as attachments", () => {
    const store = createSentImageStore({});
    const outgoing = keepSentImages({ text: "", images: [png, jpeg] }, store);
    const [row] = transcriptRows([daemonEcho(outgoing, 3)]);
    expect(row).toMatchObject({ kind: "captain", text: ATTACHMENTS_ONLY, messageId: outgoing.messageId });
    expect(drawnImages(store, [daemonEcho(outgoing, 3)])).toEqual([[png, jpeg]]);
  });

  it("leaves words alone: no id, nothing kept, nothing drawn", () => {
    const store = createSentImageStore({});
    const outgoing = keepSentImages({ text: "Bearings, please." }, store);
    expect(outgoing).toEqual({ text: "Bearings, please." });
    expect(drawnImages(store, [daemonEcho(outgoing, 1)])).toEqual([[]]);
  });

  it("draws nothing for a message another device sent, or one sent before the bundle loaded", () => {
    const store = createSentImageStore({});
    expect(drawnImages(store, [daemonEcho({ text: "", messageId: captainMessageId() }, 1)])).toEqual([[]]);
  });

  it("is kept across a fresh evaluation of the bundle, which builds a new store on the same root", () => {
    const root = {};
    const outgoing = keepSentImages({ text: "look", images: [png] }, createSentImageStore(root));
    expect(createSentImageStore(root).get(outgoing.messageId)).toEqual([png]);
  });
});

describe("the sent-image store", () => {
  it("drops the oldest messages past its count, always keeping the newest", () => {
    const store = createSentImageStore({}, { messages: 2, chars: Number.MAX_SAFE_INTEGER });
    store.set("one", [png]);
    store.set("two", [png]);
    store.set("three", [jpeg]);
    expect([store.get("one"), store.get("two"), store.get("three")]).toEqual([[], [png], [jpeg]]);
  });

  it("drops the oldest past its size, but never the newest however large", () => {
    const store = createSentImageStore({}, { messages: 10, chars: png.data.length * 2 });
    store.set("one", [png]);
    store.set("two", [png]);
    store.set("three", [png, png, png]);
    expect([store.get("one"), store.get("two"), store.get("three")]).toEqual([[], [], [png, png, png]]);
  });

  it("forgets a message whose send failed, and tells its readers", () => {
    const store = createSentImageStore({});
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.version()));
    store.set("failed", [png]);
    store.forget("failed");
    store.forget("never-sent");
    expect(store.get("failed")).toEqual([]);
    expect(seen).toEqual([1, 2]);
  });

  it("makes ids the daemon's contract accepts and no other prefix claims", () => {
    const id = captainMessageId();
    expect(id.startsWith(CAPTAIN_MESSAGE_ID_PREFIX)).toBe(true);
    expect(id).not.toBe(captainMessageId());
    expect(CaptainMessageSchema.safeParse({ text: "hi", messageId: id }).success).toBe(true);
    expect(CaptainMessageSchema.safeParse({ text: "hi", messageId: "firstmate-watch-x" }).success).toBe(false);
    expect(CaptainMessageSchema.safeParse({ text: "hi", messageId: `${CAPTAIN_MESSAGE_ID_PREFIX}a b` }).success).toBe(false);
  });
});
