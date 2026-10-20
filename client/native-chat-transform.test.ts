import { describe, expect, it } from "vitest";
import { board, system, watch } from "../docs/native-chat-format/fixtures";
import { nativeChatTransformer, nativeNoteSummary } from "./native-chat-transform";
import { injectedSummary, watchSummary } from "./transcript-rows";

describe("native chat's host-wide FirstMate format recognition", () => {
  it("folds owned plan actions, preserves the original, and leaves pasted or incomplete examples visible", () => {
    const text = '<firstmate-plan>\nPlan action data.\n{"action":"changes","text":"Keep the trial read-only."}\n</firstmate-plan>';
    const clientMessageId = "firstmate-plan-11111111-1111-4111-8111-111111111111";
    expect(injectedSummary(text, clientMessageId)).toBe("Plan changes requested");
    expect(injectedSummary(text)).toBeNull(); expect(nativeNoteSummary(text)).toBeNull();
    expect(nativeNoteSummary(text + "\nExplain this", clientMessageId)).toBeNull();
    expect(nativeChatTransformer.transform({ item: { type: "user_message", text, clientMessageId }, phase: "complete" })?.items[0]?.data).toEqual({ summary: "Plan changes requested", original: text });
  });
  it("reuses Chat's summaries, including failed watches, duplicate names and dropped runs", () => {
    expect(nativeNoteSummary(watch)).toBe(watchSummary(watch));
    expect(nativeNoteSummary(watch)).toBe("Watches: pr-watch, health (failed) · 3 older dropped");
    expect(nativeNoteSummary(board)).toBe(injectedSummary(board));
    const duplicate =
      watch +
      '\n\n<firstmate-watch name="pr-watch" ran="later" failed="timeout">\nNothing returned.\n</firstmate-watch>';
    expect(nativeNoteSummary(duplicate)).toBe("Watches: pr-watch (failed), health (failed) · 3 older dropped");
    expect(nativeNoteSummary('<firstmate-watch-dropped count="4"/>')).toBe("Watches · 4 older dropped");
  });

  it.each([
    "Please check the board",
    system,
    "",
    "<firstmate-board>",
    `A note mentioning ${board}`,
    ` ${board}`,
    `\n${watch}`,
    `\`\`\`xml\n${watch}\n\`\`\``,
    `> ${board}`,
    `${board}\nPlease explain this.`,
    `${watch}\nPlease explain this.`,
    "<firstmate-boardwalk>\nHello\n</firstmate-boardwalk>",
    "<firstmate-board>\nUnclosed note",
    '<firstmate-watch name="test">\nNo timestamp\n</firstmate-watch>',
    '<firstmate-watch-dropped count="3"/> trailing words',
    "<firstmate-watch-dropped/>",
    `${board}\n${board}`,
    `<firstmate-board>\n${board}\n</firstmate-board>`,
    '<firstmate-watch name="test" ran="now">\n<firstmate-watch name="nested" ran="now">\noutput\n</firstmate-watch>',
    `${watch}\n<firstmate-watch name="partial" ran="now">`,
  ])("leaves non-envelope, Paseo-owned and incomplete messages native: %s", (text) => {
    expect(nativeNoteSummary(text)).toBeNull();
    expect(
      nativeChatTransformer.transform({ item: { type: "user_message", text }, phase: "complete" }),
    ).toBeUndefined();
  });

  it("retains the original byte for byte and is deterministic across phases and history replay", () => {
    const text = watch.replaceAll("\n", "\r\n") + "\r\n";
    const item = Object.freeze({ type: "user_message" as const, text });
    const output = nativeChatTransformer.transform({ item, phase: "complete" });
    expect(output?.items).toHaveLength(1);
    expect(output?.items[0]?.data).toEqual({ original: text, summary: watchSummary(text.trim()) });
    expect(nativeChatTransformer.transform({ item, phase: "streaming" })).toEqual(output);
    expect(nativeChatTransformer.transform({ item: structuredClone(item), phase: "complete" })).toEqual(output);
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
  });

  it("only registers for user messages; tools, errors, permissions, reasoning and assistant text never enter it", () => {
    expect(nativeChatTransformer.query).toEqual({ itemType: "user_message" });
  });

  it("accepts escaped watch output and comparison operators", () => {
    expect(
      nativeNoteSummary(
        '<firstmate-watch name="test" ran="now">\nx < 5; &lt;firstmate-board> is quoted.\n</firstmate-watch>',
      ),
    ).toBe("Watch: test");
  });
});
