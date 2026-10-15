import { describe, expect, it } from "vitest";

import { CAPTAIN_STEER_MESSAGE_ID_PREFIX, WATCH_MESSAGE_ID_PREFIX } from "../shared/fleet";
import { activityRows } from "./activity-rows";
import { DRAWER_MIN_SURFACE, DRAWER_WIDTH, converseTarget, drawerDocks } from "./converse-layout";
import {
  conversationRows,
  logCount,
  planText,
  promptCount,
  toolRunText,
  unseenSends,
  type ConversationRow,
  type SentMessage,
} from "./conversation-rows";
import type { TimelineEntry } from "./transcript-rows";

function entry(item: unknown, seq: number): TimelineEntry {
  return {
    provider: "claude",
    item,
    timestamp: "2026-10-15T10:00:00.000Z",
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [],
    collapsed: [],
  } as unknown as TimelineEntry;
}

const shell = (command: string, status = "completed") => ({
  type: "tool_call", callId: command, name: "Bash", status, error: null,
  detail: { type: "shell", command, output: "ok", exitCode: 0 },
});

describe("conversationRows", () => {
  const rows = activityRows([
    entry({ type: "user_message", text: "Brief: build it" }, 1),
    entry({ type: "reasoning", text: "Let me look around." }, 2),
    entry(shell("ls"), 3),
    entry(shell("npm test", "failed"), 4),
    entry({ type: "assistant_message", text: "Split into three steps." }, 5),
    entry({ type: "user_message", text: "Use the storm palette.", clientMessageId: `${CAPTAIN_STEER_MESSAGE_ID_PREFIX}1` }, 6),
    entry({ type: "todo", items: [{ text: "Frames", status: "completed" }, { text: "Wire", status: "in_progress" }, { text: "Docs" }] }, 7),
    entry(shell("git status", "running"), 8),
    entry({ type: "assistant_message", text: "Switched." }, 9),
  ]);

  it("keeps the words, says who said them, and folds tool runs and the plan", () => {
    const conversation = conversationRows(rows);
    expect(conversation.map((row) => (row.kind === "said" ? `${row.speaker}: ${row.text}` : row.kind))).toEqual([
      "prompt: Brief: build it",
      "tools",
      "worker: Split into three steps.",
      "you: Use the storm palette.",
      "plan",
      "tools",
      "worker: Switched.",
    ]);
    const [first, second] = conversation.filter((row): row is Extract<ConversationRow, { kind: "tools" }> => row.kind === "tools");
    expect(toolRunText(first!)).toBe("2 tool calls · 1 failed");
    expect(first!.running).toBe(false);
    expect(toolRunText(second!)).toBe("1 tool call");
    expect(second!.running).toBe(true);
    const plan = conversation.find((row) => row.kind === "plan");
    expect(planText(plan as Extract<ConversationRow, { kind: "plan" }>)).toBe("Plan 1/3 · Wire");
  });

  it("keys a tool run by its first call, so it keeps its place as the run grows", () => {
    const grown = conversationRows(activityRows([entry(shell("ls"), 3), entry(shell("pwd"), 4), entry(shell("cat"), 5)]));
    const short = conversationRows(activityRows([entry(shell("ls"), 3)]));
    expect(grown.map((row) => row.key)).toEqual(short.map((row) => row.key));
  });

  it("calls a prompt the captain's only by the steer id, never by its text or a watch id", () => {
    const prompts = activityRows([
      entry({ type: "user_message", text: "mine", clientMessageId: `${CAPTAIN_STEER_MESSAGE_ID_PREFIX}abc` }, 1),
      entry({ type: "user_message", text: "untagged" }, 2),
      entry({ type: "user_message", text: "other", clientMessageId: "firstmate-mate-ask-1" }, 3),
    ]);
    expect(prompts.map((row) => (row.kind === "prompt" ? row.captain : null))).toEqual([true, false, false]);
    // A watch message is still a folded note, not a prompt.
    expect(WATCH_MESSAGE_ID_PREFIX.startsWith(CAPTAIN_STEER_MESSAGE_ID_PREFIX)).toBe(false);
  });
});

describe("unseenSends", () => {
  const send = (id: string, text: string, state: SentMessage["state"], seenBefore = 0) => ({ id, text, state, seenBefore });

  it("hides a sent message once the transcript shows it, and keeps one sending or failed", () => {
    const sends = [send("a", "use pnpm", "sent"), send("b", "skip e2e", "sending"), send("c", "x", "failed")];
    expect(unseenSends(sends, () => 0).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(unseenSends(sends, (text) => (text === "use pnpm" ? 1 : 0)).map((s) => s.id)).toEqual(["b", "c"]);
  });

  it("tells a repeat from the first time it was said", () => {
    // Said twice before either arrived: each needs a prompt of its own.
    const twice = [send("a", "ok", "sent"), send("b", "ok", "sent")];
    expect(unseenSends(twice, () => 1).map((s) => s.id)).toEqual(["b"]);
    expect(unseenSends(twice, () => 2)).toEqual([]);
    // Said again after the first was already shown: the old prompt does not count for it.
    expect(unseenSends([send("c", "ok", "sent", 1)], () => 1).map((s) => s.id)).toEqual(["c"]);
  });

  it("counts prompts in rows and occurrences in a remote log", () => {
    const rows = activityRows([entry({ type: "user_message", text: " ok " }, 1), entry({ type: "assistant_message", text: "ok" }, 2)]);
    expect(promptCount(rows, "ok")).toBe(1);
    expect(logCount("[User] ok\n[Assistant] fine\n[User] ok", "ok")).toBe(2);
    expect(logCount("anything", "")).toBe(0);
  });
});

describe("the drawer's place", () => {
  it("docks beside the surface only where both fit", () => {
    expect(drawerDocks(DRAWER_WIDTH + DRAWER_MIN_SURFACE)).toBe(true);
    expect(drawerDocks(DRAWER_WIDTH + DRAWER_MIN_SURFACE - 1)).toBe(false);
    expect(drawerDocks(0)).toBe(false);
  });

  it("reads a watch key as a local agent or a remote worker", () => {
    expect(converseTarget("3f2a")).toEqual({ kind: "local", agentId: "3f2a" });
    expect(converseTarget("remote:srv-1:abc")).toEqual({ kind: "remote", serverId: "srv-1", agentId: "abc" });
    expect(converseTarget("remote:srv:with:colons:abc")).toEqual({ kind: "remote", serverId: "srv:with:colons", agentId: "abc" });
  });
});
