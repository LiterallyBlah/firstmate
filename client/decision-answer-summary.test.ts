import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { URL } from "node:url";
import { decisionAnswerSummary } from "./decision-answer-summary";
import { nativeChatTransformer } from "./native-chat-transform";
import { transcriptRows, type TimelineEntry } from "./transcript-rows";
const context = {
  homeId: "home",
  id: "request",
  revision: 2,
  submissionId: "submission",
  task: "task",
  title: "Choose a host (notes)",
  ask: "Light or Atlas?",
};
const template = readFileSync(
  new URL("../templates/messages/decision-answer.md", import.meta.url),
  "utf8",
).trim();
const envelope = (
  data: object = context,
  answer = "Atlas.\nKeep Light for Ariadne.",
) =>
  template
    .replace("{{context}}", JSON.stringify(data))
    .replace("{{answer}}", answer);
it("folds the actual template only for its identified submission and preserves the complete original", () => {
  const text = envelope();
  expect(decisionAnswerSummary(text, "firstmate-answer-submission")).toEqual({
    homeId: "home",
    requestId: "request",
    recordRevision: 2,
    title: context.title,
    ask: context.ask,
    answer: "Atlas.\nKeep Light for Ariadne.",
    original: text,
  });
  for (const id of [
    undefined,
    "ordinary-message",
    "firstmate-answer-someone-else",
  ])
    expect(decisionAnswerSummary(text, id)).toBeNull();
  for (const text of [
    envelope().slice(0, -10),
    `${envelope()}\nCaptain's additional words`,
    `Example:\n${envelope()}`,
    envelope({ ...context, revision: "2" }),
    envelope({ ...context, id: "" }),
  ])
    expect(
      decisionAnswerSummary(text, "firstmate-answer-submission"),
    ).toBeNull();
});
it("supports older context without a title and treats XML-shaped answer text as words", () => {
  const { title, ...old } = context;
  expect(
    decisionAnswerSummary(envelope(old), "firstmate-answer-submission")?.title,
  ).toBe("task");
  expect(
    decisionAnswerSummary(
      envelope(context, "Keep <firstmate-decision-answer> as literal text."),
      "firstmate-answer-submission",
    )?.answer,
  ).toContain("<firstmate-decision-answer>");
});
it("projects the same answer in the plugin chat and native timeline without hiding ordinary messages", () => {
  const item = {
    type: "user_message" as const,
    text: envelope(),
    clientMessageId: "firstmate-answer-submission",
  };
  const entry = { item, seqStart: 1 } as TimelineEntry;
  expect(transcriptRows([entry])[0]?.kind).toBe("decision-answer");
  expect(
    nativeChatTransformer.transform({ item, phase: "complete" } as never),
  ).toMatchObject({
    items: [
      {
        kind: "firstmate-decision-answer",
        version: 1,
        data: { answer: "Atlas.\nKeep Light for Ariadne." },
      },
    ],
  });
  expect(
    transcriptRows([
      { ...entry, item: { type: "user_message", text: envelope() } },
    ])[0]?.kind,
  ).toBe("captain");
});
