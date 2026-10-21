import { describe, expect, it } from "vitest";
import { observeNeedsYou } from "../server/needs-you-detect";
import { emptyLedger, mutateNeedsYou, needsYouSnapshot, reconcileNeedsYou, type NeedsYouLedger } from "../server/needs-you-ledger";
import { briefAnswerOptions } from "../server/decision-brief";
import { decisionAnswerOptions } from "../server/decision-options";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { entryTime, raisedChoices, raisedDecisions, raisedStatus, raisedWarning, withRaisedDecisions } from "./decision-raised";
import { transcriptRows, type TimelineEntry } from "./transcript-rows";

const backlog = (fields: string) =>
  `## In flight\n## Queued\n- [ ] host - Choose the Windows host (kind: captain) ${fields}\n## Done\n`;
const observe = (fields: string) => observeNeedsYou(backlog(fields), null);
const fresh = (ledger: NeedsYouLedger, at = 9000): NeedsYouSnapshot =>
  needsYouSnapshot(ledger, { status: "fresh", asOf: at, checkedAt: at, problems: [] });

/** The quiet baseline at 1000, then the first mate raising the hold at 5000. */
function raised() {
  const baseline = reconcileNeedsYou(emptyLedger("home", "/home"), observe(""), 1000);
  return reconcileNeedsYou(baseline, observe("(hold: Light or Atlas? I recommend Atlas.)"), 5000);
}

const at = (ms: number) => new Date(ms).toISOString();
/** This first mate took the helm at 1500, before the conversation began. */
const TENURE = at(1500);
function entry(seq: number, ms: number, item: TimelineEntry["item"]): TimelineEntry {
  return { provider: "claude", item, timestamp: at(ms), seqStart: seq, seqEnd: seq, sourceSeqRanges: [], collapsed: [] } as unknown as TimelineEntry;
}
const conversation = [
  entry(1, 2000, { type: "user_message", text: "Which host should the build use?" }),
  entry(2, 3000, { type: "tool_call", callId: "c", name: "Write", status: "completed", error: null, detail: { type: "write", filePath: "data/backlog.md" } } as never),
  entry(3, 6000, { type: "assistant_message", text: "I've raised it in Needs you." }),
];

const BRIEF = `## Background
Light is shared; Atlas is free.

## Options
1. **Atlas (recommended)** — free today.
2. **Light** — shared with Ariadne.

## Recommendation
Atlas, so Light stays free for Ariadne.
`;

describe("decisions raised in the chat", () => {
  it("places a newly raised decision once, before the first row recorded after it", () => {
    const snapshot = fresh(raised());
    const rows = withRaisedDecisions(transcriptRows(conversation), conversation, snapshot, TENURE);
    expect(rows.map((row) => row.kind)).toEqual(["captain", "tool", "decision-raised", "mate"]);
    const card = rows[2]!;
    expect(card).toMatchObject({ requestId: snapshot.requests[0]!.id, key: `decision:${snapshot.requests[0]!.id}` });
    // Polling again changes nothing: one card per request.
    expect(withRaisedDecisions(transcriptRows(conversation), conversation, fresh(raised(), 12000), TENURE)).toEqual(rows);
  });

  it("puts a decision raised after everything said at the end, and keeps its row as the question is reworded", () => {
    const early = conversation.slice(0, 2);
    const snapshot = fresh(raised());
    const rows = withRaisedDecisions(transcriptRows(early), early, snapshot, TENURE);
    expect(rows.at(-1)?.kind).toBe("decision-raised");
    const reworded = fresh(reconcileNeedsYou(raised(), observe("(hold: Light, Atlas or Kestrel?)"), 7000));
    expect(reworded.requests[0]!.revision).toBe(snapshot.requests[0]!.revision + 1);
    expect(withRaisedDecisions(transcriptRows(early), early, reworded, TENURE).at(-1)?.key).toBe(rows.at(-1)?.key);
  });

  it("leaves out the quiet baseline, decisions from before the loaded conversation, and an empty one", () => {
    const baseline = reconcileNeedsYou(emptyLedger("home", "/home"), observe("(hold: Light or Atlas?)"), 1000);
    expect(baseline.requests[0]?.baseline).toBe(true);
    expect(raisedDecisions(fresh(baseline), conversation, TENURE)).toEqual([]);
    const later = conversation.map((e, i) => entry(e.seqStart, 5001 + i, e.item));
    expect(raisedDecisions(fresh(raised()), later, TENURE)).toEqual([]);
    expect(raisedDecisions(fresh(raised()), [], TENURE)).toEqual([]);
    expect(raisedDecisions(undefined, conversation, TENURE)).toEqual([]);
    expect(raisedDecisions({ ...fresh(raised()), homeId: null }, conversation, TENURE)).toEqual([]);
  });

  it("shows only decisions raised in this first mate's tenure, whatever history is loaded", () => {
    // Adopted at 5200: the decision at 5000 was the previous first mate's, though inside its loaded history.
    const snapshot = fresh(raised());
    expect(raisedDecisions(snapshot, conversation, at(5200))).toEqual([]);
    expect(withRaisedDecisions(transcriptRows(conversation), conversation, snapshot, at(5200)).map((row) => row.kind))
      .toEqual(["captain", "tool", "mate"]);
    // Raised after adoption: the adopted first mate's own.
    const own = fresh(reconcileNeedsYou(reconcileNeedsYou(raised(), observe(""), 5300), observe("(hold: Kestrel?)"), 5400));
    expect(raisedDecisions(own, conversation, at(5200)).map((r) => r.detectedAt)).toEqual([5400]);
    // No recorded tenure shows nothing rather than guess; nor does an unreadable one.
    expect(raisedDecisions(snapshot, conversation, null)).toEqual([]);
    expect(raisedDecisions(snapshot, conversation, "not a time")).toEqual([]);
  });

  it("orders several cards in the same gap by detection and gives a re-raised question its own card", () => {
    const first = raised();
    const lifted = reconcileNeedsYou(first, observe(""), 5500);
    const again = reconcileNeedsYou(lifted, observe("(hold: Atlas after all?)"), 5800);
    const snapshot = fresh(again);
    const rows = withRaisedDecisions(transcriptRows(conversation), conversation, snapshot, TENURE);
    const cards = rows.filter((row) => row.kind === "decision-raised");
    expect(cards.map((row) => row.kind === "decision-raised" && row.requestId)).toEqual(snapshot.requests.map((r) => r.id));
    expect(rows.at(-1)?.kind).toBe("mate");
    expect(snapshot.requests.map((r) => raisedStatus(r).label)).toEqual(["Settled · hold lifted", "Decision needs you"]);
  });

  it("reads entry times the host may give as text, a number or a Date", () => {
    const base = conversation[0]!;
    expect(entryTime(base)).toBe(2000);
    expect(entryTime({ ...base, timestamp: 2500 } as never)).toBe(2500);
    expect(entryTime({ ...base, timestamp: new Date(2600) } as never)).toBe(2600);
    expect(entryTime({ ...base, timestamp: "not a time" } as never)).toBeNull();
  });
});

describe("a raised decision's card", () => {
  it("shows answered and lifted decisions as settled", () => {
    const ledger = raised();
    const request = ledger.requests[0]!;
    expect(raisedStatus(request)).toEqual({ settled: false, label: "Decision needs you" });
    const target = { homeId: ledger.homeId, id: request.id, revision: request.revision };
    const sent = mutateNeedsYou(ledger, target, { kind: "answer", submissionId: "s", outcome: "accepted" }, 6000);
    expect(raisedStatus(sent.requests[0]!)).toEqual({ settled: true, label: "Answered · waiting for the first mate" });
    const uncertain = mutateNeedsYou(ledger, target, { kind: "answer", submissionId: "u", outcome: "uncertain" }, 6000);
    expect(raisedStatus(uncertain.requests[0]!).settled).toBe(true);
    const lifted = reconcileNeedsYou(sent, observe(""), 7000);
    expect(raisedStatus(lifted.requests[0]!)).toEqual({ settled: true, label: "Settled · hold lifted" });
    const done = reconcileNeedsYou(ledger, observeNeedsYou("## In flight\n## Queued\n## Done\n- [x] host - Choose the Windows host\n", null), 7000);
    expect(raisedStatus(done.requests[0]!).label).toBe("Settled · task completed");
  });

  it("offers the drawer's own bound answers for the current revision, and none once settled", () => {
    const ledger = raised();
    const base = fresh(ledger);
    const request = base.requests[0]!;
    const context = { ...base, briefs: [{ requestId: request.id, recordRevision: request.revision, path: "data/host/decision.md", content: BRIEF }] };
    const suggestion = { label: "Use Light", prompt: "For host: use Light." };
    const snapshot = { ...context, answerOptions: [...decisionAnswerOptions(context, [suggestion]), ...briefAnswerOptions(context)] };
    expect(raisedChoices(snapshot, request).map((choice) => choice.label)).toEqual(["Use Light", "Atlas", "Light"]);
    // A stale binding is not this revision's answer.
    const reworded = fresh(reconcileNeedsYou(ledger, observe("(hold: Kestrel?)"), 7000));
    expect(raisedChoices({ ...snapshot, requests: reworded.requests }, reworded.requests[0]!)).toEqual([]);
    expect(raisedChoices({ ...snapshot, homeId: null }, request)).toEqual([]);
  });
});

describe("a raised decision's warning", () => {
  it("never prints a time it does not have", () => {
    const snapshot = fresh(raised());
    const request = snapshot.requests[0]!;
    expect(raisedWarning(snapshot, request)).toBeNull();
    const unknown = { ...snapshot, freshness: { ...snapshot.freshness, status: "stale" as const, asOf: null } };
    expect(raisedWarning(unknown, request)?.headline).toBe("Can’t read decisions");
    expect(raisedWarning({ ...snapshot, freshness: { ...snapshot.freshness, status: "disabled" as const } }, request)?.headline)
      .toBe("Decision observation is disabled");
  });
});
