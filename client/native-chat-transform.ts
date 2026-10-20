import { decisionAnswerSummary, DECISION_ANSWER_KIND } from "./decision-answer-summary";
import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";

import { injectedSummary, watchSummary, planNoteSummary } from "./transcript-rows";

export const MACHINE_NOTE_KIND = "firstmate-machine-note";

/**
 * No agent context is available here. Only complete, FirstMate-owned envelopes
 * qualify; the existing Chat parser is deliberately more lenient and also knows
 * Paseo's system notes. Never apply that parser directly to arbitrary host rows.
 */
export function nativeNoteSummary(text: string, clientMessageId?: string): string | null {
  const plan = planNoteSummary(text, clientMessageId);
  if (plan) return plan;
  if (text.startsWith("<firstmate-board>")) {
    if (!/^<firstmate-board>\s*\n[\s\S]*\n<\/firstmate-board>\s*$/.test(text)) return null;
    const body = text.slice("<firstmate-board>".length, text.lastIndexOf("</firstmate-board>"));
    if (/<\/?firstmate-board>/.test(body)) return null;
    return injectedSummary(text);
  }
  if (!text.startsWith("<firstmate-watch")) return null;

  // Consume the whole batch, so a quoted example or trailing captain text cannot
  // disappear into a summary. Script output escapes tag-shaped '<' characters.
  let rest = text;
  const dropped = /^<firstmate-watch-dropped count="\d+"\/>\s*/.exec(rest);
  if (dropped) rest = rest.slice(dropped[0].length);
  let count = 0;
  while (rest !== "") {
    const block =
      /^<firstmate-watch name="[^"<>\r\n]+" ran="[^"<>\r\n]+"(?: failed="[^"\r\n]*")?>\r?\n(?:(?!<\/?firstmate-watch)[\s\S])*?\r?\n<\/firstmate-watch>\s*/.exec(
        rest,
      );
    if (!block) return null;
    rest = rest.slice(block[0].length);
    count += 1;
  }
  return dropped || count > 0 ? watchSummary(text.trimEnd()) : null;
}

/** Pure: no fleet query, global selection, clock, or renderer disclosure state. */
export const nativeChatTransformer: PluginTimelineTransformerContribution<"user_message"> = {
  id: MACHINE_NOTE_KIND,
  query: { itemType: "user_message" },
  transform({ item }) {
    const answer = decisionAnswerSummary(item.text, item.clientMessageId);
    if (answer) return { items: [{ type: "plugin", kind: DECISION_ANSWER_KIND, version: 1, data: answer }] };
    const summary = nativeNoteSummary(item.text, item.clientMessageId);
    if (summary === null) return undefined;
    return {
      items: [{ type: "plugin", kind: MACHINE_NOTE_KIND, version: 1, data: { summary, original: item.text } }],
    };
  },
};
