import { describe, expect, it } from "vitest";
import { board, planTransfer, planTransferId, system, watch } from "../docs/native-chat-format/fixtures";
import { message, TEMPLATES } from "../server/templates";
import { MACHINE_NOTE_KIND, nativeChatTransformer, nativeNoteSummary } from "./native-chat-transform";
import { injectedSummary, transcriptRows, watchSummary, type TimelineEntry } from "./transcript-rows";

describe("native chat's host-wide FirstMate format recognition", () => {
  it("folds owned plan actions, preserves the original, and leaves pasted or incomplete examples visible", () => {
    const text = '<firstmate-plan>\nPlan action data.\n{"action":"changes","text":"Keep the trial read-only."}\n</firstmate-plan>';
    const clientMessageId = "firstmate-plan-11111111-1111-4111-8111-111111111111";
    expect(injectedSummary(text, clientMessageId)).toBe("Plan changes requested");
    expect(injectedSummary(text)).toBeNull(); expect(nativeNoteSummary(text)).toBeNull();
    expect(nativeNoteSummary(text + "\nExplain this", clientMessageId)).toBeNull();
    expect(nativeChatTransformer.transform({ item: { type: "user_message", text, clientMessageId }, phase: "complete" })?.items[0]?.data).toEqual({ summary: "Plan changes requested", original: text });
  });
  describe("the generated plan transfer note", () => {
    const id = planTransferId, clientMessageId = `firstmate-plan-${id}`, transfer = planTransfer;
    const action = { id, action: "transfer", text: "Delegate the scout <and its review> to FirstMate.", at: "2026-10-26T09:14:03.000Z", by: "board:captain" };
    const summary = "Plan owner transferred · ariadne-character-dialogue-scout";

    it("is exactly what the producer sends", async () => {
      // The same rendering as `queuePlanNotes` in server/workflow-service.ts.
      const json = JSON.stringify({ plan: "ariadne-character-dialogue-scout", ...action }).replace(/</g, "\\u003c");
      expect(await message(TEMPLATES.workflowNote, { action: json })).toBe(transfer);
    });

    it("folds in both chats behind the collapsed disclosure, keeping the original byte for byte", () => {
      expect(injectedSummary(transfer, clientMessageId)).toBe(summary);
      expect(nativeNoteSummary(transfer, clientMessageId)).toBe(summary);
      const rows = transcriptRows([{ seqStart: 4, seqEnd: 4, provider: "claude", item: { type: "user_message", text: transfer, clientMessageId } } as unknown as TimelineEntry]);
      expect(rows).toEqual([{ key: "4", kind: "event", text: summary }]);
      const output = nativeChatTransformer.transform({ item: { type: "user_message", text: transfer, clientMessageId }, phase: "complete" });
      expect(output?.items).toEqual([{ type: "plugin", kind: MACHINE_NOTE_KIND, version: 1, data: { summary, original: transfer } }]);
      const crlf = transfer.replaceAll("\n", "\r\n") + "\r\n";
      expect(nativeChatTransformer.transform({ item: { type: "user_message", text: crlf, clientMessageId }, phase: "streaming" })?.items[0]?.data).toEqual({ summary, original: crlf });
    });

    it("names every recorded captain action, and a future one generically", () => {
      const note = (name: string, plan?: string) => transfer.replace('"action":"transfer"', `"action":"${name}"`).replace('"plan":"ariadne-character-dialogue-scout",', plan === undefined ? "" : `"plan":"${plan}",`);
      expect(nativeNoteSummary(note("resume", "p-1"), clientMessageId)).toBe("Plan resumed · p-1");
      expect(nativeNoteSummary(note("approve"), clientMessageId)).toBe("Plan approved");
      expect(nativeNoteSummary(note("later-action", "p-1"), clientMessageId)).toBe("Plan updated · p-1");
      expect(nativeNoteSummary(note("transfer", "Not A Plan Id"), clientMessageId)).toBe("Plan owner transferred");
    });

    it.each([
      ["no owned message id", transfer, undefined],
      ["a captain message id", transfer, "firstmate-captain-6f1c2e8a-3b4d-4c5e-9f60-718293a4b5c6"],
      ["trailing captain words", `${transfer}\nWhy did this change hands?`, clientMessageId],
      ["leading captain words", `Look at this:\n${transfer}`, clientMessageId],
      ["a quoted example", `> ${transfer.replaceAll("\n", "\n> ")}`, clientMessageId],
      ["a fenced example", `\`\`\`xml\n${transfer}\n\`\`\``, clientMessageId],
      ["an unclosed envelope", transfer.replace("\n</firstmate-plan>", ""), clientMessageId],
      ["a nested envelope", transfer.replace("<firstmate-plan>\n", "<firstmate-plan>\n<firstmate-plan>\n"), clientMessageId],
      ["two envelopes", `${transfer}\n${transfer}`, clientMessageId],
      ["broken action JSON", transfer.replace('"by":"board:captain"}', '"by":"board:captain"'), clientMessageId],
      ["JSON without an action", transfer.replace('"action":"transfer",', ""), clientMessageId],
      ["a non-string action", transfer.replace('"action":"transfer"', '"action":7'), clientMessageId],
      ["a lookalike tag", transfer.replaceAll("firstmate-plan>", "firstmate-planner>"), clientMessageId],
    ])("leaves %s visible", (_name, text, id) => {
      expect(injectedSummary(text, id)).toBeNull();
      expect(nativeNoteSummary(text, id)).toBeNull();
      expect(nativeChatTransformer.transform({ item: { type: "user_message", text, ...(id ? { clientMessageId: id } : {}) }, phase: "complete" })).toBeUndefined();
    });
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
