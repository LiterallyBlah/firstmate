import { expect, it } from "vitest";
import { compactPlansFixture } from "../test/compact-plans-fixture";
import type { WorkflowSnapshot } from "../shared/workflow-rpc";
import { withPlanReviews } from "./plan-ready";
import type { TimelineEntry, TranscriptRow } from "./transcript-rows";

const at = "2026-10-23T12:00:00Z";
const entries = [{ seqStart: 1, timestamp: "2026-10-23T11:00:00Z" }, { seqStart: 2, timestamp: "2026-10-23T13:00:00Z" }] as unknown as TimelineEntry[];
const rows: TranscriptRow[] = [{ key: "1", kind: "captain", text: "Make a plan" }, { key: "2", kind: "mate", text: "Ready" }];
function snapshot(): WorkflowSnapshot {
  const plan = structuredClone(compactPlansFixture()[0]!);
  plan.definition.implicit = false; plan.status = "review"; plan.history = [{ revision: 1, at, by: "mate", reason: "draft" }];
  return { homeId: "test-home", version: "1", plans: [plan], subjects: {}, now: [], comingUp: [] };
}
it("projects one compact plan reference at a durable time, including after polling, reconnect and revision", () => {
  const s = snapshot(), result = withPlanReviews(rows, entries, s, entries[0]!.timestamp as string);
  expect(result.map(r => r.kind)).toEqual(["captain", "plan-ready", "mate"]);
  const row = result[1]!;
  expect(row).toEqual({ key: `plan-ready:test-home:${s.plans[0]!.definition.id}`, kind: "plan-ready", text: s.plans[0]!.definition.title, planId: s.plans[0]!.definition.id });
  expect(withPlanReviews(rows, entries, structuredClone(s), entries[0]!.timestamp as string)).toEqual(result);
  s.plans[0]!.revision++; s.plans[0]!.status = "active";
  expect(withPlanReviews(result, entries, s, entries[0]!.timestamp as string)).toEqual(result);
  expect(JSON.stringify(row)).not.toContain(s.plans[0]!.definition.request.text);
});
it("keeps other tenures, unloaded history and automatic runs without a review out of chat", () => {
  const s = snapshot();
  expect(withPlanReviews(rows, entries, s, "2026-10-23T12:30:00Z")).toEqual(rows);
  expect(withPlanReviews(rows, entries.slice(1), s, "2026-10-23T11:00:00Z")).toEqual(rows);
  expect(withPlanReviews(rows, entries, s, null)).toEqual(rows);
  s.plans[0]!.definition.implicit = true; s.plans[0]!.status = "active"; s.plans[0]!.posture = "sail"; s.plans[0]!.captainEvents = [];
  expect(withPlanReviews(rows, entries, s, "2026-10-23T11:00:00Z")).toEqual(rows);
});
