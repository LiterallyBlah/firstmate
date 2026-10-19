import { describe, expect, it } from "vitest";
import { observeNeedsYou } from "./needs-you-detect";
import {
  emptyLedger,
  mutateNeedsYou,
  needsYouSnapshot,
  reconcileNeedsYou,
  type NeedsYouLedger,
} from "./needs-you-ledger";
import {
  currentDeliveryCandidates,
  readDecisionTransitions,
} from "./needs-you-outbox";

const document = (fields = "(hold: Merge?)", section = "Queued") =>
  `## In flight\n${section === "In flight" ? `- [ ] task - Task ${fields}` : ""}\n## Queued\n${section === "Queued" ? `- [ ] task - Task ${fields}` : ""}\n## Done\n${section === "Done" ? `- [x] task - Task ${fields}` : ""}\n`;
const observation = (fields?: string, section?: string) =>
  observeNeedsYou(document(fields, section), null);
const target = (ledger: NeedsYouLedger) => {
  const request = ledger.requests.at(-1)!;
  return { homeId: ledger.homeId, id: request.id, revision: request.revision };
};
const counts = (ledger: NeedsYouLedger) =>
  needsYouSnapshot(ledger, {
    status: "fresh",
    asOf: 100,
    checkedAt: 100,
    problems: [],
  });
function fresh() {
  const baseline = reconcileNeedsYou(
    emptyLedger("home", "/home"),
    observation(""),
    100,
  );
  return reconcileNeedsYou(baseline, observation(), 200);
}

describe("decision ledger", () => {
  it("baselines once, silently, without claiming a human saw it", () => {
    const baseline = reconcileNeedsYou(
      emptyLedger("home", "/home"),
      observation(),
      100,
    );
    expect(counts(baseline)).toMatchObject({
      actionCount: 1,
      newCount: 0,
      pendingAnswerCount: 0,
    });
    expect(baseline.requests[0]).toMatchObject({
      state: "seen",
      baseline: true,
      seenAt: null,
      seenRevision: null,
    });
    expect(baseline.outbox).toEqual([]);
    expect(
      reconcileNeedsYou(
        JSON.parse(JSON.stringify(baseline)),
        observation(),
        200,
      ),
    ).toEqual(baseline);
  });

  it("New becomes Seen across clients without dropping the action count", () => {
    const before = fresh();
    const seen = mutateNeedsYou(before, target(before), { kind: "seen" }, 300);
    expect(counts(seen)).toMatchObject({ actionCount: 1, newCount: 0 });
    expect(mutateNeedsYou(seen, target(seen), { kind: "seen" }, 400)).toBe(
      seen,
    );
    expect(readDecisionTransitions(seen).map((event) => event.kind)).toEqual([
      "actionable",
      "seen",
    ]);
  });

  it("absolute snooze survives serialization and wakes once, including a previously seen gate", () => {
    const before = fresh();
    const seen = mutateNeedsYou(before, target(before), { kind: "seen" }, 300);
    const snoozed = mutateNeedsYou(
      seen,
      target(seen),
      { kind: "snooze", until: 1000 },
      400,
    );
    expect(counts(snoozed)).toMatchObject({ actionCount: 0, snoozedCount: 1 });
    expect(reconcileNeedsYou(snoozed, observation(), 999)).toBe(snoozed);
    const due = reconcileNeedsYou(
      JSON.parse(JSON.stringify(snoozed)),
      observation(),
      1000,
    );
    expect(counts(due)).toMatchObject({
      actionCount: 1,
      newCount: 1,
      snoozedCount: 0,
    });
    expect(reconcileNeedsYou(due, observation(), 2000)).toBe(due);
    expect(
      due.outbox.filter((event) => event.kind === "snooze-due"),
    ).toHaveLength(1);
    const reseen = mutateNeedsYou(due, target(due), { kind: "seen" }, 2001);
    expect(counts(reseen).newCount).toBe(0);
  });

  it.each([
    ["2026-03-29T00:59:59Z", "2026-03-29T01:00:00Z"],
    ["2026-10-25T00:59:59Z", "2026-10-25T01:00:00Z"],
  ])(
    "uses absolute instants through the London clock change at %s",
    (before, until) => {
      const ledger = fresh();
      const snoozed = mutateNeedsYou(
        ledger,
        target(ledger),
        { kind: "snooze", until: Date.parse(until) },
        Date.parse(before),
      );
      expect(
        counts(reconcileNeedsYou(snoozed, observation(), Date.parse(until)))
          .newCount,
      ).toBe(1);
    },
  );

  it("unsnooze restores quiet acknowledgement and validates deadlines", () => {
    const ledger = reconcileNeedsYou(
      emptyLedger("home", "/home"),
      observation(),
      100,
    );
    const snoozed = mutateNeedsYou(
      ledger,
      target(ledger),
      { kind: "snooze", until: 500 },
      200,
    );
    const awake = mutateNeedsYou(
      snoozed,
      target(snoozed),
      { kind: "unsnooze" },
      300,
    );
    expect(counts(awake)).toMatchObject({ actionCount: 1, newCount: 0 });
    expect(() =>
      mutateNeedsYou(awake, target(awake), { kind: "snooze", until: 299 }, 300),
    ).toThrow("future");
  });

  it.each(["accepted", "uncertain"] as const)(
    "keeps %s answers pending until authoritative reconciliation",
    (outcome) => {
      const before = fresh();
      const answered = mutateNeedsYou(
        before,
        target(before),
        { kind: "answer", submissionId: "send-1", outcome },
        300,
      );
      expect(counts(answered)).toMatchObject({
        actionCount: 0,
        pendingAnswerCount: 1,
      });
      expect(
        reconcileNeedsYou(
          JSON.parse(JSON.stringify(answered)),
          observation(),
          1000000,
        ),
      ).toEqual(answered);
      expect(
        mutateNeedsYou(
          answered,
          target(answered),
          { kind: "answer", submissionId: "send-1", outcome },
          400,
        ),
      ).toBe(answered);
      expect(() =>
        mutateNeedsYou(
          answered,
          target(answered),
          { kind: "answer", submissionId: "send-2", outcome },
          400,
        ),
      ).toThrow("already pending");
      const resolved = reconcileNeedsYou(answered, observation(""), 500);
      expect(resolved.requests[0]?.resolution?.reason).toBe("answered");
    },
  );

  it("uncertain is durable and may settle once; definitive failure restores actionability", () => {
    const before = fresh();
    const pending = mutateNeedsYou(
      before,
      target(before),
      { kind: "answer", submissionId: "send-1", outcome: "uncertain" },
      300,
    );
    const failed = mutateNeedsYou(
      JSON.parse(JSON.stringify(pending)),
      target(pending),
      { kind: "answer", submissionId: "send-1", outcome: "failed" },
      400,
    );
    expect(counts(failed)).toMatchObject({
      actionCount: 1,
      newCount: 1,
      pendingAnswerCount: 0,
    });
    expect(() =>
      mutateNeedsYou(
        failed,
        target(failed),
        { kind: "answer", submissionId: "send-1", outcome: "accepted" },
        500,
      ),
    ).toThrow("definitive");
    const retried = mutateNeedsYou(
      failed,
      target(failed),
      { kind: "answer", submissionId: "explicit-retry", outcome: "accepted" },
      500,
    );
    expect(counts(retried).pendingAnswerCount).toBe(1);
  });

  it("definite failure and unknown outcome never mark Seen or Resolved", () => {
    const before = fresh();
    for (const outcome of ["failed", "uncertain"] as const) {
      const recorded = mutateNeedsYou(
        before,
        target(before),
        { kind: "answer", submissionId: "send-1", outcome },
        300,
      );
      expect(recorded.requests[0]).toMatchObject({
        seenAt: null,
        resolution: null,
      });
    }
  });

  it.each([
    ["", "Queued", "answered"],
    ["(hold: Merge?)", "Done", "completed"],
    ["(hold: Merge?) (blocked-by: other)", "Queued", "deferred"],
  ])("resolves with evidence: %s in %s → %s", (fields, section, reason) => {
    const ledger = reconcileNeedsYou(
      fresh(),
      observation(fields, section),
      300,
    );
    expect(ledger.requests[0]?.resolution).toEqual({ reason, at: 300 });
    expect(counts(ledger).actionCount).toBe(0);
  });

  it("never resolves disappearance, malformed input, or a partial section move", () => {
    const before = fresh();
    for (const markdown of [
      "",
      document("", "absent"),
      document().replace("(hold: Merge?)", "(hold:"),
      document() + "## Queued\n- [ ] task - Task (hold: Merge?)",
    ]) {
      const detection = observeNeedsYou(markdown, null);
      expect(reconcileNeedsYou(before, detection, 300)).toBe(before);
      expect(reconcileNeedsYou(before, detection, 100000)).toBe(before);
    }
  });

  it("preserves identity and acknowledgement through section, worker, title, tag and cosmetic changes", () => {
    const before = fresh();
    const seen = mutateNeedsYou(before, target(before), { kind: "seen" }, 300);
    const detection = observeNeedsYou(
      document(
        "(hold: MERGE? ) (tags: new) (agent: replaced)",
        "In flight",
      ).replace("task - Task", "task - Renamed"),
      null,
    );
    const after = reconcileNeedsYou(seen, detection, 400);
    expect(after.requests).toHaveLength(1);
    expect(after.requests[0]).toMatchObject({
      id: before.requests[0]!.id,
      revision: 1,
      generation: 1,
      state: "seen",
      seenAt: 300,
    });
    expect(after.outbox).toEqual(seen.outbox);
  });

  it("wording edits invalidate stale actions but retain Seen and snooze in the same generation", () => {
    const before = fresh();
    const seen = mutateNeedsYou(before, target(before), { kind: "seen" }, 300);
    const after = reconcileNeedsYou(
      seen,
      observation("(hold: Deploy instead?)"),
      400,
    );
    expect(after.requests[0]).toMatchObject({
      generation: 1,
      revision: 2,
      state: "seen",
      seenRevision: 1,
    });
    expect(() =>
      mutateNeedsYou(after, target(before), { kind: "seen" }, 500),
    ).toThrow("changed");
    const snoozed = mutateNeedsYou(
      after,
      target(after),
      { kind: "snooze", until: 2000 },
      500,
    );
    expect(
      reconcileNeedsYou(snoozed, observation("(hold: Deploy now?)"), 600)
        .requests[0]?.state,
    ).toBe("snoozed");
  });

  it.each([
    "(hold: Merge?) https://github.com/example/repo/pull/2",
    "(hold: Merge?) (report: data/new/report.md)",
    "(hold: Merge?) (gate: second)",
  ])("a material target/gate change overrides a snooze: %s", (fields) => {
    const before = fresh();
    const snoozed = mutateNeedsYou(
      before,
      target(before),
      { kind: "snooze", until: 2000 },
      300,
    );
    const after = reconcileNeedsYou(snoozed, observation(fields), 400);
    expect(after.requests).toHaveLength(2);
    expect(after.requests[0]?.resolution?.reason).toBe("superseded");
    expect(after.requests[1]).toMatchObject({
      state: "new",
      generation: 2,
      revision: 2,
    });
  });

  it("a revised answered ask and a resolved/reopened task each get a new generation", () => {
    const before = fresh();
    const answered = mutateNeedsYou(
      before,
      target(before),
      { kind: "answer", submissionId: "s", outcome: "accepted" },
      300,
    );
    const revised = reconcileNeedsYou(
      answered,
      observation("(hold: Deploy?)"),
      400,
    );
    expect(revised.requests.at(-1)).toMatchObject({
      state: "new",
      generation: 2,
    });
    const resolved = reconcileNeedsYou(before, observation(""), 300);
    const reopened = reconcileNeedsYou(resolved, observation(), 400);
    expect(reopened.requests.at(-1)).toMatchObject({
      state: "new",
      generation: 2,
    });
    expect(reconcileNeedsYou(reopened, observation(), 500)).toBe(reopened);
  });

  it("does not claim same-URL PR-head or report-content freshness", () => {
    const before = reconcileNeedsYou(
      emptyLedger("h", "/home"),
      observation(
        "(hold: Review?) https://github.com/example/repo/pull/1 (review-head: old)",
      ),
      100,
    );
    const after = reconcileNeedsYou(
      before,
      observation(
        "(hold: Review?) https://github.com/example/repo/pull/1 (review-head: new)",
      ),
      200,
    );
    expect(after).toBe(before);
  });

  it("rejects another home and superseded revision", () => {
    const ledger = fresh();
    expect(() =>
      mutateNeedsYou(
        ledger,
        { ...target(ledger), homeId: "other" },
        { kind: "seen" },
        300,
      ),
    ).toThrow("home changed");
    expect(() =>
      mutateNeedsYou(
        ledger,
        { ...target(ledger), revision: 2 },
        { kind: "seen" },
        300,
      ),
    ).toThrow("changed");
  });

  it("persists metadata-only transitions with stable cursor IDs, disabled delivery and revocation", () => {
    const before = fresh();
    expect(currentDeliveryCandidates(before)).toEqual([]);
    expect(currentDeliveryCandidates(before, true, false)).toEqual([]);
    expect(currentDeliveryCandidates(before, true, true)).toHaveLength(1);
    const seen = mutateNeedsYou(before, target(before), { kind: "seen" }, 300);
    expect(currentDeliveryCandidates(seen, true, true)).toEqual([]);
    expect(
      readDecisionTransitions(JSON.parse(JSON.stringify(seen)), 1),
    ).toEqual([seen.outbox[1]]);
    const serialized = JSON.stringify(seen.outbox);
    expect(serialized).not.toContain("Merge");
    expect(serialized).not.toContain("Task");
    expect(serialized).not.toContain("submissionId");
    expect(new Set(seen.outbox.map((event) => event.eventId)).size).toBe(
      seen.outbox.length,
    );
  });
});
