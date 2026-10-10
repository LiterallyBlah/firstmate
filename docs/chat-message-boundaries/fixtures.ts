import type { TimelineEntry } from "../../client/transcript-rows";

/** Exact reported paragraphs and projected ranges; message IDs are anonymised. */
export const finalReply =
  "For that last case, should the reader choose a chapter range, or should Ariadne propose the affected range and seek approval? I favour Ariadne proposing it: the reader supplies the desired change and what must stay, while Ariadne explains how far the repair needs to reach.";
export const completionReply =
  "Captain, the tooltips and resizable divider are ready, with Windows and Linux checks green. I’ll verify the final merge gates.\n";

export function assistant(
  text: string,
  seqStart: number,
  seqEnd = seqStart,
  turnId: string | undefined = "codex-turn-35",
  messageId: string | undefined = "final-reply",
): TimelineEntry {
  return {
    provider: "codex",
    item: {
      type: "assistant_message",
      text,
      ...(messageId === undefined ? {} : { messageId }),
    },
    timestamp: "2026-10-10T20:53:47.493Z",
    seqStart,
    seqEnd,
    sourceSeqRanges: [{ startSeq: seqStart, endSeq: seqEnd }],
    ...(turnId === undefined ? {} : { turnId }),
    collapsed: seqStart === seqEnd ? [] : ["assistant_merge"],
  };
}

export const observedBoundary: TimelineEntry[] = [
  assistant(finalReply, 1522, 1581),
  {
    ...assistant(completionReply, 1582, 1589, "codex-turn-36", "completion-commentary"),
    timestamp: "2026-10-10T20:55:43.452Z",
  },
];
