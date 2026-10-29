import { describe, expect, it } from "vitest";
import { decisionClock } from "./decision-copy";
import {
  emptyLedger,
  needsYouSnapshot,
  reconcileNeedsYou,
} from "../server/needs-you-ledger";
import { observeNeedsYou } from "../server/needs-you-detect";
import {
  boundAnswers,
  chosenWake,
  decisionQueue,
  decisionRoute,
  decisionSession,
  indicatorState,
  decisionCountText,
  mergeDecisionSnapshot,
  newDecisionBatch,
  routeDecision,
  tomorrowNine,
} from "./needs-you-state";
import type { NeedsYouSnapshot } from "../shared/needs-you";
function snapshot(): NeedsYouSnapshot {
  const ledger = reconcileNeedsYou(
    emptyLedger("home", "/home"),
    observeNeedsYou(
      "# Backlog\n## In flight\n## Queued\n- [ ] task - Workerless (hold: Decide?)\n## Done\n",
      null,
    ),
    1000,
  );
  return needsYouSnapshot(ledger, {
    status: "fresh",
    asOf: 1000,
    checkedAt: 1000,
    problems: [],
  });
}
it("takes counts only from server data, even with no cards/requests and all seen", () => {
  const data = { ...snapshot(), requests: [], actionCount: 42, newCount: 0 };
  expect(indicatorState(data)).toMatchObject({
    count: 42,
    amber: true,
    label: "Needs you · 42",
  });
  expect(indicatorState({ ...data, newCount: 3 })).toMatchObject({
    amber: true,
    extra: "3 new",
  });
});
it("explains quarantined lines and never labels an unknown or stale total as a current zero", () => {
  const data = snapshot();
  const problem = "Line 12, task blocked: Could not read metadata; check parentheses.";
  data.freshness.problems = [problem];
  expect(indicatorState(data).accessibilityLabel).toContain(problem);
  expect(decisionCountText(undefined)).toBe("Loading decisions…");
  for (const status of ["unknown", "disabled", "stale"] as const) {
    const unavailable = { ...data, actionCount: 0, freshness: { ...data.freshness, status } };
    expect(decisionCountText(unavailable)).toBe(status === "stale" ? `0 · as of ${decisionClock(1000)}` : "unavailable");
    expect(indicatorState(unavailable).fresh).toBe(false);
  }
  expect(decisionCountText(data, true)).toBe(`1 · as of ${decisionClock(1000)}`);
  expect(decisionCountText(data)).toBe("1");
});
it("distinguishes zero, disabled, unknown, stale and pending at zero with accessible names", () => {
  expect(indicatorState(undefined).label).toBe("Loading decisions…");
  const data = snapshot();
  expect(
    indicatorState({ ...data, actionCount: 0, pendingAnswerCount: 1 })
      .accessibilityLabel,
  ).toContain("1 answer pending");
  expect(indicatorState(data, true)).toMatchObject({
    amber: true,
    fresh: false,
    extra: "offline",
  });
  expect(
    indicatorState({
      ...data,
      freshness: { ...data.freshness, status: "disabled" },
    }).extra,
  ).toBe("disabled");
});
it("separates pending, failed, updating and bounded readiness without inventing a zero", () => {
  for (const read of [{ pending: true, fetching: true }, { readiness: "loading" as const }]) {
    expect(indicatorState(undefined, false, read)).toMatchObject({ count: null, loading: true, unavailable: false, badge: "…" });
    expect(indicatorState(undefined, false, read).accessibilityLabel).not.toContain("unavailable");
    expect(decisionCountText(undefined, false, read)).toBe("Loading decisions…");
  }
  expect(indicatorState(undefined, false, { error: true })).toMatchObject({ loading: false, unavailable: true, badge: "!" });
  const data = snapshot();
  expect(decisionCountText(data, false, { readiness: "failed" })).toContain("as of");
  expect(indicatorState(data, false, { fetching: true }).label).toContain(`as of ${decisionClock(1000)}`);
  expect(indicatorState(data, false, { fetching: true }).label).toContain("Updating…");
  expect(indicatorState({ ...data, actionCount: 0 }, false, { readiness: "partial" }).count).toBeNull();
  expect(indicatorState(data, false, { readiness: "partial" }).badge).toBe("1+");
  expect(indicatorState({ ...data, actionCount: 0 }, false, { readiness: "complete" }).label).toBe("Nothing needs you");
});
it("orders new first, then longest waiting, then stable IDs without mutating input", () => {
  const first = snapshot().requests[0]!;
  const requests = [
    { ...first, id: "z", state: "new" as const, detectedAt: 20 },
    { ...first, id: "a", state: "new" as const, detectedAt: 20 },
    { ...first, id: "old", state: "seen" as const, detectedAt: 0 },
    { ...first, id: "resolved", state: "resolved" as const },
  ];
  expect(decisionQueue(requests).map((r) => r.id)).toEqual(["a", "z", "old"]);
  expect(requests[0]!.id).toBe("z");
});
it("routes exact workerless targets with home and revision, without executable inputs", () => {
  const destination = {
    homeId: "home",
    requestId: "opaque:id",
    recordRevision: 7,
  };
  expect(routeDecision(decisionRoute(destination).params)).toEqual(destination);
  expect(routeDecision({})).toBeNull();
});
it("ignores delayed snapshots but keeps newer freshness on a stale ledger result", () => {
  const old = snapshot(),
    current = {
      ...old,
      version: 5,
      actionCount: 3,
      freshness: { ...old.freshness, checkedAt: 5000 },
    };
  expect(mergeDecisionSnapshot(current, old)).toBe(current);
  expect(
    mergeDecisionSnapshot(current, {
      ...old,
      freshness: { ...old.freshness, status: "stale", checkedAt: 6000 },
    }),
  ).toMatchObject({
    version: 5,
    actionCount: 3,
    freshness: { status: "stale" },
  });
});
it("offers only unambiguous options bound to this home, gate and revision", () => {
  const data = snapshot(),
    request = data.requests[0]!;
  const bound = {
    label: "Yes",
    prompt: "Yes",
    decision: {
      homeId: data.homeId!,
      requestId: request.id,
      recordRevision: request.revision,
      actionId: "yes",
    },
  };
  expect(
    boundAnswers(
      [
        { label: "Unbound", prompt: "act" },
        bound,
        { ...bound, decision: { ...bound.decision, recordRevision: 999 } },
      ],
      data.homeId!,
      request,
    ),
  ).toEqual([bound]);
  expect(boundAnswers([bound, bound], data.homeId!, request)).toEqual([]);
});
describe("quiet toast batches", () => {
  it("is silent at baseline, deduplicates copies/reloads, and suppresses visible arrivals without delayed replay", () => {
    const owner = {},
      root = {},
      session = decisionSession(owner, root),
      data = snapshot();
    expect(newDecisionBatch(session, data)).toEqual([]);
    const request = {
      ...data.requests[0]!,
      state: "new" as const,
      baseline: false,
    };
    const next = { ...data, requests: [request] };
    expect(newDecisionBatch(session, next)).toEqual([request]);
    expect(newDecisionBatch(decisionSession(owner, root), next)).toEqual([]);
    expect(
      newDecisionBatch(session, {
        ...next,
        requests: [{ ...request, revision: 2, updatedAt: 5000 }],
      }),
    ).toEqual([]);
    let visible = true;
    session.surfaces.add(() => visible);
    const arrival = { ...request, id: "second" };
    expect(
      newDecisionBatch(session, { ...next, requests: [request, arrival] }),
    ).toEqual([]);
    visible = false;
    expect(
      newDecisionBatch(session, { ...next, requests: [request, arrival] }),
    ).toEqual([]);
    expect(
      newDecisionBatch(session, {
        ...next,
        requests: [request, arrival, { ...arrival, id: "hidden-pane-arrival" }],
      }),
    ).toHaveLength(1);
    expect(decisionSession({}, root)).not.toBe(session);
  });
  it("never toasts a baselined or stale item", () => {
    const session = decisionSession({}, {}),
      data = snapshot();
    newDecisionBatch(session, data);
    expect(
      newDecisionBatch(session, {
        ...data,
        requests: [{ ...data.requests[0]!, state: "new" }],
      }),
    ).toEqual([]);
    expect(
      newDecisionBatch(session, {
        ...data,
        freshness: { ...data.freshness, status: "stale" },
      }),
    ).toEqual([]);
  });
});
it("converts local snoozes to absolute times and rejects invalid/past calendar input", () => {
  const now = new Date(2026, 9, 24, 23, 30).getTime();
  const tomorrow = new Date(tomorrowNine(now));
  expect([tomorrow.getDate(), tomorrow.getHours()]).toEqual([25, 9]);
  expect(chosenWake("2026-10-25 09:00", now)).toBe(tomorrow.getTime());
  expect(chosenWake("2026-02-31 09:00", now)).toBeNull();
  expect(chosenWake("2026-10-24 09:00", now)).toBeNull();
});
it("merges independent scoped and backlog versions without resurrecting an answered decision or double counting", () => {
  const decision = { id: "d", version: 1, ownerScopeId: "scope", planId: "plan", nodeId: "choose", revision: 1, subjectHash: "a".repeat(64),
    state: "pending" as const, title: "Choose", question: "Which?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], sourceVector: [], answer: null };
  const old: NeedsYouSnapshot = { ...snapshot(), version: 8, scopedSequence: 9, scopedComplete: true, scopedDecisions: [{ decision, ready: true, waitingFor: null, ownerEpoch: 1 }],
    actionCount: 2, pendingAnswerCount: 0, scopedPendingAnswerCount: 0, maintenanceAnswersEnabled: true };
  const current: NeedsYouSnapshot = { ...old, scopedSequence: 10, scopedDecisions: [{ ...old.scopedDecisions![0]!, decision: { ...decision, state: "answered" }, ready: false }],
    actionCount: 1, pendingAnswerCount: 1, scopedPendingAnswerCount: 1 };
  const merged = mergeDecisionSnapshot(current, { ...old, freshness: { ...old.freshness, checkedAt: 6000 } });
  expect(merged.scopedSequence).toBe(10); expect(merged.scopedDecisions?.[0]?.decision.state).toBe("answered");
  expect(merged.actionCount).toBe(1); expect(merged.pendingAnswerCount).toBe(1);
  expect(mergeDecisionSnapshot(merged, { ...current, version: 7 }).version).toBe(8);
  expect(merged.maintenanceAnswersEnabled).toBe(true);
  expect(mergeDecisionSnapshot(merged, { ...old, maintenanceAnswersEnabled: false }).maintenanceAnswersEnabled).toBe(false);
});
it("labels a failed scoped inventory and a disabled backlog count as incomplete while retaining known scoped actions", () => {
  const data = snapshot(), scoped = { ...data, scopedSequence: 2, scopedComplete: false, scopedProblems: ["Scope journal held"], actionCount: 0 };
  expect(indicatorState(scoped)).toMatchObject({ count: null, fresh: false });
  expect(indicatorState(scoped).accessibilityLabel).toContain("Scope journal held");
  const holds = [{ id: "h", version: 1, scopeId: "s", planId: "p", operations: ["model.use" as const], reason: "Capacity", sourceVector: [], state: "held" as const }];
  const disabled = { ...data, freshness: { ...data.freshness, status: "disabled" as const }, scopedHolds: holds, scopedComplete: true };
  expect(indicatorState(disabled)).toMatchObject({ count: 1, fresh: false, badge: "1+" });
});
