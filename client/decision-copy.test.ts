import { expect, it } from "vitest";
import {
  decisionTitle,
  relativeDecisionTime,
  stableDecisionOrder,
  nextWaitingDecision,
  thisEvening,
} from "./decision-copy";
import {
  emptyLedger,
  reconcileNeedsYou,
  mutateNeedsYou,
  needsYouSnapshot,
} from "../server/needs-you-ledger";
import { observeNeedsYou } from "../server/needs-you-detect";
const document =
  "## In flight\n## Queued\n- [ ] task - Choose a host (hold: Light or Atlas?)\n## Done\n";
const ledger = () =>
  reconcileNeedsYou(
    emptyLedger("home", "/home"),
    observeNeedsYou(document, null),
    1000,
  );
it("trims only complete trailing parenthetical notes and keeps interior words", () => {
  expect(decisionTitle("Choose host (after review (Monday)) (notes)")).toBe(
    "Choose host",
  );
  expect(decisionTitle("Choose (Windows) host")).toBe("Choose (Windows) host");
  expect(decisionTitle("Choose host (unfinished")).toBe(
    "Choose host (unfinished",
  );
  expect(decisionTitle("(All of the title)")).toBe("(All of the title)");
});
it("retains the session order across acknowledgement, snooze, answer, and new arrivals", () => {
  const r = ledger().requests[0]!;
  const before = [
    { ...r, id: "a", state: "new" as const },
    { ...r, id: "b", state: "seen" as const },
  ];
  const after = [
    { ...before[1]!, state: "snoozed" as const },
    { ...before[0]!, state: "answer-sent" as const },
    { ...r, id: "c", state: "new" as const },
  ];
  expect(stableDecisionOrder(["a", "b"], after)).toEqual(["a", "b", "c"]);
  expect(nextWaitingDecision(["a", "b", "c"], "a", after)?.id).toBe("c");
  expect(nextWaitingDecision(["c", "a"], "a", after)?.id).toBe("c");
});
it("uses local future evening times and clamps clock skew in relative labels", () => {
  expect(relativeDecisionTime(120000, 60000)).toBe("just now");
  expect(relativeDecisionTime(0, 26 * 60000)).toBe("26 min");
  expect(relativeDecisionTime(0, 2 * 3600000)).toBe("2h");
  const morning = new Date(2026, 9, 19, 10).getTime();
  expect(new Date(thisEvening(morning)).getHours()).toBe(18);
  const evening = new Date(2026, 9, 19, 19).getTime();
  expect(thisEvening(evening)).toBeGreaterThan(evening);
});
it("Mark as new is revision-bound, restores the signal, preserves counts and refuses pending answers", () => {
  const before = ledger(),
    request = before.requests[0]!;
  const target = {
    homeId: before.homeId,
    id: request.id,
    revision: request.revision,
  };
  const seen = mutateNeedsYou(before, target, { kind: "seen" }, 2000);
  const marked = mutateNeedsYou(seen, target, { kind: "new" }, 3000);
  expect(marked.requests[0]).toMatchObject({
    state: "new",
    seenAt: null,
    seenRevision: null,
  });
  expect(
    needsYouSnapshot(marked, {
      status: "fresh",
      asOf: 3000,
      checkedAt: 3000,
      problems: [],
    }),
  ).toMatchObject({ actionCount: 1, newCount: 1 });
  expect(() =>
    mutateNeedsYou(seen, { ...target, revision: 99 }, { kind: "new" }, 3000),
  ).toThrow();
  const pending = mutateNeedsYou(
    seen,
    target,
    { kind: "answer", submissionId: "send", outcome: "uncertain" },
    3000,
  );
  expect(() => mutateNeedsYou(pending, target, { kind: "new" }, 4000)).toThrow(
    /pending/,
  );
});
