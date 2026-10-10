import { describe, expect, it } from "vitest";

import { assistant, completionReply, finalReply, observedBoundary } from "../docs/chat-message-boundaries/fixtures";
import { activityRows, type ActivityRow } from "./activity-rows";
import { parseMarkdown } from "./markdown-parse";
import { transcriptRows, type TimelineEntry, type TranscriptRow } from "./transcript-rows";

function textOf(row: ActivityRow | TranscriptRow): string | undefined {
  return "text" in row ? row.text : undefined;
}

for (const [view, project, kind] of [
  ["chat", transcriptRows, "mate"],
  ["Watch", activityRows, "reply"],
] as const) {
  describe(`${view} assistant boundaries`, () => {
    it("separates the reported final reply from the worker-triggered turn with no system entry", () => {
      expect(project(observedBoundary)).toEqual([
        { key: "1522", kind, text: finalReply },
        { key: "1582", kind, text: completionReply },
      ]);
    });

    it("separates adjacent complete messages within one turn by message ID alone", () => {
      expect(
        project([
          assistant("First message.", 1),
          assistant("Second message.", 2, 2, "codex-turn-35", "another-message"),
        ]).map(textOf),
      ).toEqual(["First message.", "Second message."]);
    });

    it("joins arbitrary chunks only within the same message, preserving Markdown byte for byte", () => {
      const chunks = ["**Ari", "adne** proposes:\n\n- chapter ", "2\n- chapter 3\n\n```ts\ncon", "st n = 2;\n```"];
      const rows = project(chunks.map((text, i) => assistant(text, i + 1)));
      expect(rows).toEqual([{ key: "1", kind, text: chunks.join("") }]);
      expect(parseMarkdown(textOf(rows[0]!)!).map((block) => block.kind)).toEqual(["paragraph", "list", "code"]);
    });

    it("preserves separate Markdown blocks when a final fence is followed by a new message", () => {
      const code = "```ts\nconst n = 2;\n```";
      const next = "# Captain\n\n- Gates are green";
      expect(
        project([assistant(code, 1), assistant(next, 2, 2, "codex-turn-36", "completion-commentary")]).map(textOf),
      ).toEqual([code, next]);
    });

    it("keeps keys and message boundaries stable through streaming snapshots and a reconnect", () => {
      const first = observedBoundary[0]!;
      const partial = assistant("Cap", 1582, 1582, "codex-turn-36", "completion-commentary");
      const streaming = [first, partial];
      expect(project(streaming)).toEqual([
        { key: "1522", kind, text: finalReply },
        { key: "1582", kind, text: "Cap" },
      ]);
      const completed = project(observedBoundary);
      expect(completed.map((row) => row.key)).toEqual(project(streaming).map((row) => row.key));
      expect(project(structuredClone(observedBoundary))).toEqual(completed);
      // Canonical chunks replayed by an older host must produce the same rows.
      expect(
        project([
          first,
          partial,
          assistant(completionReply.slice(3), 1583, 1589, "codex-turn-36", "completion-commentary"),
        ]),
      ).toEqual(completed);
      expect(project([observedBoundary[1]!])).toEqual([completed[1]]);
    });

    it("retains provider message boundaries when rebuilt history omits daemon turn IDs", () => {
      const history = observedBoundary.map(({ turnId: _, ...entry }) => entry);
      expect(project(history)).toEqual([
        { key: "1522", kind, text: finalReply },
        { key: "1582", kind, text: completionReply },
      ]);
    });

    it("keeps legacy chunks continuous when both identifiers are absent", () => {
      const chunks = [assistant("re", 1), assistant("pair", 2)].map(({ turnId: _, item, ...entry }) => ({
        ...entry,
        item: {
          type: "assistant_message" as const,
          text: item.type === "assistant_message" ? item.text : "",
        },
      }));
      expect(project(chunks)).toEqual([{ key: "1", kind, text: "repair" }]);
    });

    it.each(["turn", "message", "provider", "sequence", "missing turn", "missing message"])(
      "does not join across a changed %s boundary",
      (boundary) => {
        const first = assistant("reach.", 1);
        const next = assistant("Captain", 2);
        if (boundary === "turn") next.turnId = "codex-turn-36";
        if (boundary === "message" && next.item.type === "assistant_message") next.item.messageId = "other";
        if (boundary === "provider") next.provider = "claude";
        if (boundary === "sequence") next.seqStart = next.seqEnd = 3;
        if (boundary === "missing turn") delete next.turnId;
        if (boundary === "missing message" && next.item.type === "assistant_message") delete next.item.messageId;
        expect(project([first, next]).map(textOf)).toEqual(["reach.", "Captain"]);
      },
    );

    it("does not bridge a hidden entry or a removed plan", () => {
      for (const item of [
        { type: "reasoning" as const, text: "Next turn" },
        { type: "todo" as const, items: [] },
      ]) {
        const hidden: TimelineEntry = { ...assistant("", 2), item };
        const replies = project([assistant("reach.", 1), hidden, assistant("Captain", 3)]).filter(
          (row) => row.kind === kind,
        );
        expect(replies.map(textOf)).toEqual(["reach.", "Captain"]);
      }
    });

    it("retains the ordinary captain or injected-note boundary", () => {
      for (const text of ["Please check the gates", "<paseo-system>\nWorker finished.\n</paseo-system>"]) {
        const prompt: TimelineEntry = {
          ...assistant("", 2),
          item: { type: "user_message", text },
        };
        expect(
          project([assistant("reach.", 1), prompt, assistant("Captain", 3)])
            .filter((row) => row.kind === kind)
            .map(textOf),
        ).toEqual(["reach.", "Captain"]);
      }
    });
  });
}

it("separates Watch reasoning in different turns while preserving normal reasoning chunks", () => {
  const reasoning = (text: string, seq: number, turnId: string): TimelineEntry => ({
    ...assistant("", seq, seq, turnId),
    item: { type: "reasoning", text },
  });
  expect(
    activityRows([
      reasoning("rea", 1, "turn-1"),
      reasoning("soning", 2, "turn-1"),
      reasoning("Next turn", 3, "turn-2"),
    ]),
  ).toEqual([
    { key: "1", kind: "reasoning", text: "reasoning" },
    { key: "3", kind: "reasoning", text: "Next turn" },
  ]);
});
