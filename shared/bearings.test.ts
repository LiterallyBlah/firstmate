import { expect, it } from "vitest";
import { bearingsMessage, readBearingsMessage } from "./bearings";
import { compactWorkflowBearings, planGroups, planSummary } from "./workflow-plan-summary";
import { compactPlansFixture } from "../test/compact-plans-fixture";
import { nativeChatTransformer } from "../client/native-chat-transform";
import { transcriptRows, type TimelineEntry } from "../client/transcript-rows";
import { planProblems } from "./workflow-plans";
import type { PlanNodeState } from "./workflow-plans";
const messageId = "firstmate-bearings-11111111-1111-4111-8111-111111111111";
it("folds only complete owned Bearings envelopes, preserving captain words and the full overview", () => {
  const overview = "Open plans\n- scheduler: running; next: review.", text = bearingsMessage("Bearings, please.", overview);
  expect(readBearingsMessage(text, messageId)).toEqual({ visible: "Bearings, please.", overview });
  for (const [copy, id] of [[text, undefined], [text, "captain-id"], [text + "\nExplain this", messageId], [text.replace("</firstmate-bearings>", ""), messageId], [text.replace("Open plans", "<firstmate-bearings>"), messageId]]) {
    expect(readBearingsMessage(copy!, id)).toBeNull();
  }
  expect(readBearingsMessage(bearingsMessage("Bearings, please.", "A title with </firstmate-bearings>"), messageId)?.overview).toContain("\\u003c/firstmate-bearings>");
  expect(transcriptRows([{ seqStart: 1, seqEnd: 1, item: { type: "user_message", text, clientMessageId: messageId } } as TimelineEntry])).toEqual([
    { key: "1", kind: "captain", text: "Bearings, please.", overview, messageId },
  ]);
  expect(nativeChatTransformer.transform({ item: { type: "user_message", text, clientMessageId: messageId }, phase: "complete" })?.items[0]?.data).toEqual({ visible: "Bearings, please.", summary: "Plan overview", original: overview });
});
it("keeps real-shaped Bearings to one open-plan line each and one line per due/upcoming decision", () => {
  const plans = compactPlansFixture(), before = JSON.stringify(plans);
  const snapshot = { homeId: "fixture", version: "1", plans, subjects: {},
    now: [{ plan: "starpath-scheduler", title: plans[0]!.definition.title, question: "Approve the plan", waits: [], neededBy: [], recommendation: "Review the budget." }],
    comingUp: [{ plan: "ariadne-reader-pass", node: "deploy", title: plans[1]!.definition.title, question: "Deploy the reader pass", waits: ["Reader probe"], neededBy: [], recommendation: "Review the probe evidence." }],
  };
  const text = compactWorkflowBearings(snapshot), lines = text.split("\n");
  expect(lines).toHaveLength(7);
  expect(text).toContain("3 of 7 steps landed; running: slice 13 reviews (Opus)");
  expect(text).toContain("waiting on slice 13 (landing)");
  expect(text).toContain("Due\n- starpath-scheduler: Approve the plan");
  expect(text).toContain("Coming up\n- ariadne-reader-pass/deploy: Deploy the reader pass; waits: Reader probe");
  for (const p of plans.slice(0, 2)) expect(text.split(p.definition.title)).toHaveLength(2);
  expect(text).not.toContain("Independent astra review"); expect(text).not.toContain("Earlier work:");
  expect(text.length).toBeLessThan(1300); expect(JSON.stringify(plans)).toBe(before);
  const trial = plans[2]!; trial.nodes[trial.definition.nodes[0]!.id] = { state: "done", closedWithoutLanding: { at: "2026-10-21T12:00:00Z", by: "mate", evidence: "Verified trial; nothing to land" } };
  expect(planGroups([trial]).finished).toEqual([trial]);
  expect(planSummary(trial, [trial]).progress).toBe("1 of 1 steps complete");
  expect(compactWorkflowBearings({ ...snapshot, plans: [trial], now: [], comingUp: [] })).toBe("");
});
it("retains terminal consumers as history when a prerequisite is closed, while refusing future landing dependents", () => {
  const [source, consumer] = compactPlansFixture();
  const build = source!.definition.nodes[0]!;
  source!.nodes[build.id] = { state: "done", closedWithoutLanding: { at: "2026-10-21T12:00:00Z", by: "mate", evidence: "Verified trial, nothing to land" } };
  const next = consumer!.definition.nodes[0]!;
  next.after = [{ node: build.id, reason: "builds-on", on: "landed" }];
  consumer!.nodes[next.id] = { state: "cancelled" };
  expect(planProblems(source!.definition, [source!, consumer!]).filter(p => p.includes("closed without landing"))).toEqual([]);
  consumer!.nodes[next.id] = { state: "planned" };
  expect(planProblems(source!.definition, [source!, consumer!]).some(p => p.includes("closed without landing"))).toBe(true);
});
it.each([
  [{ state: "unresolved" }, "unresolved"],
  [{ state: "landed", invalidated: "Head changed" }, "evidence uncertain"],
  [{ state: "failed" }, "failed"],
  [{ state: "done" }, "awaiting landing"],
] satisfies [PlanNodeState, string][])("exposes %j work in both plan-summary and Bearings attention", (state, label) => {
  const plans = compactPlansFixture(), plan = plans[0]!, build = plan.definition.nodes[0]!;
  plan.nodes[build.id] = state;
  expect(planSummary(plan, plans).attention).toContain(`${build.title} — ${label}`);
  const text = compactWorkflowBearings({ homeId: "fixture", version: "1", plans, subjects: {}, now: [], comingUp: [] });
  expect(text).toContain(`attention: slice 10 — ${label}`);
});
it("groups troubled reviews under their build in attention instead of listing review titles separately", () => {
  const plans = compactPlansFixture(), plan = plans[0]!, review = plan.definition.nodes[1]!;
  plan.nodes[review.id] = { state: "failed" };
  const attention = planSummary(plan, plans, true).attention;
  expect(attention).toContain("slice 10 reviews (Astra failed)");
  expect(attention).not.toContain(review.title);
});
it("omits empty decision sections after filtering copied, finished and missing plans", () => {
  const plans = compactPlansFixture(), hidden = plans[2]!;
  const need = (plan: string) => ({ plan, title: "Question", question: "Decide", waits: [], neededBy: [], recommendation: "Wait" });
  const text = compactWorkflowBearings({ homeId: "fixture", version: "1", plans, subjects: {},
    now: [need(hidden.definition.id), need(plans[3]!.definition.id), need("missing")], comingUp: [need(hidden.definition.id)] });
  expect(text).toContain("Open plans");
  expect(text.split("\n")).not.toContain("Due");
  expect(text.split("\n")).not.toContain("Coming up");
});
it.each(["Failed to read ledger", "Plans unavailable: Failed to read ledger"])("adds the unavailable prefix once to %s", problem => {
  const text = compactWorkflowBearings({ homeId: "fixture", version: "1", plans: [], subjects: {}, now: [], comingUp: [], problems: [problem] });
  expect(text).toBe("Open plans\n- Plans unavailable: Failed to read ledger");
});
