import { afterEach, expect, it } from "vitest";
import { attentionRequest, attentionSnapshot } from "../test/attention-deck-fixture";
import { planDecisionNeed } from "../test/plan-decision-fixture";
import { decisionCardSnapshot } from "../shared/plan-decisions";
import { drafts } from "./draft";
import { pendingAttachments } from "./attachments";
import { decisionRoute } from "./needs-you-state";
import { discussionRequest, prepareDiscussion, routeDiscussion, type DecisionDiscussion } from "./decision-discussion";

const reference: DecisionDiscussion = { homeId: "sample-home", requestId: "local:release", recordRevision: 1, mateId: "discussion-test-mate" };
const snapshot = () => attentionSnapshot([attentionRequest("release")]);
afterEach(() => { drafts.set(reference.mateId, ""); pendingAttachments.set(reference.mateId, []); });

it("carries the exact reference through Home's public screen params", () => {
  const route = decisionRoute(reference, { discussWith: reference.mateId });
  expect(route.screenId).toBe("fleet");
  expect(routeDiscussion(route.params)).toEqual(reference);
  for (const field of ["decisionHome", "decisionRevision", "discussMate"] as const) {
    const params: Record<string, string> = { ...route.params };
    delete params[field];
    expect(routeDiscussion(params)).toBeNull();
  }
});

it("uses the per-mate store to prepare an empty draft without sending anything", () => {
  expect(prepareDiscussion(reference, snapshot(), reference.mateId)?.id).toBe(reference.requestId);
  expect(drafts.get(reference.mateId)).toBe("About «release»: ");
});

it.each(["words", "attachments", "both"])("preserves existing %s", content => {
  const words = content === "attachments" ? "" : "My unsent question";
  const files = content === "words" ? [] : [{ id: "a", kind: "file" as const, fileName: "notes.txt", size: 5, mimeType: "text/plain", data: "aGVsbG8=" }];
  drafts.set(reference.mateId, words);
  pendingAttachments.set(reference.mateId, files);
  prepareDiscussion(reference, snapshot(), reference.mateId);
  expect(drafts.get(reference.mateId)).toBe(words);
  expect(pendingAttachments.get(reference.mateId)).toEqual(files);
});

it.each(["revision", "home", "mate", "missing", "resolved", "answer-sent", "delivery-uncertain", "offline", "stale"])("makes a %s reference inert", change => {
  const next = snapshot();
  if (change === "revision") next.requests[0]!.revision++;
  if (change === "home") next.homeId = "another-home";
  if (change === "missing") next.requests = [];
  if (change === "resolved" || change === "answer-sent" || change === "delivery-uncertain") next.requests[0]!.state = change;
  if (change === "stale") next.freshness.status = "stale";
  expect(prepareDiscussion(reference, next, change === "mate" ? "replacement-mate" : reference.mateId, change === "offline")).toBeNull();
  expect(drafts.get(reference.mateId)).toBe("");
});

it("checks a plan decision against the combined snapshot's exact revision", () => {
  const next = snapshot();
  next.planNow = [planDecisionNeed()];
  const request = decisionCardSnapshot(next).requests.find(r => r.id.startsWith("plan-decision:"))!;
  const plan = { ...reference, requestId: request.id, recordRevision: request.revision };
  expect(discussionRequest(plan, next, reference.mateId)?.id).toBe(request.id);
  next.planNow = [];
  expect(discussionRequest(plan, next, reference.mateId)).toBeNull();
});
