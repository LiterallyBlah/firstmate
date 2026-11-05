import type { NeedsYouSnapshot } from "../shared/needs-you";

type Row = NonNullable<NeedsYouSnapshot["scopedDecisions"]>[number];
const hash = "a".repeat(64);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const SCOPE_ID = uuid(1);

export function scopedRow(n: number, ready: boolean, title = `Scoped decision ${n}`): Row {
  const id = uuid(100 + n);
  return { ready, waitingFor: ready ? null : "Waiting for current plan evidence or ownership reconciliation.", ownerEpoch: 1,
    decision: { id, version: 1, ownerScopeId: SCOPE_ID, planId: "scoped-plan", nodeId: `node-${n}`, revision: 2, subjectHash: hash, state: "pending",
      title, question: `Question ${n}?`, options: [{ id: "go", label: "Go" }, { id: "hold", label: "Hold" }],
      sourceVector: [{ kind: "workflow", id: "scoped-plan", version: 1, digest: hash }], answer: null },
    ...(ready ? { answerContext: { homeId: "sample-home", scopeId: SCOPE_ID, decisionId: id, revision: 2, subjectHash: hash, ownerEpoch: 1 } as never } : {}) };
}

/** Adds, as the server does (`withScopedNeedsYou`), one ready scoped decision, one still waiting, and three
 * holds over two plans: the count rises by each ready decision and each held plan once, here by three. */
export function withScopedNeeds(snapshot: NeedsYouSnapshot): NeedsYouSnapshot {
  const hold = (n: number, planId: string) => ({ id: uuid(200 + n), version: 1, scopeId: SCOPE_ID, planId, operations: ["decision.answer"] as never,
    reason: `Hold ${n}`, sourceVector: [{ kind: "workflow", id: planId, version: 1, digest: hash }] as never, state: "held" as const });
  return { ...snapshot, scopedComplete: true, scopedSequence: 1, scopedAnswersEnabled: true, scopedPendingAnswerCount: 0,
    scopedDecisions: [scopedRow(1, true, "Worker launch is broken"), scopedRow(2, false, "Install the release")],
    scopedHolds: [hold(1, "held-plan"), hold(2, "held-plan"), hold(3, "other-plan")],
    actionCount: snapshot.actionCount === null ? null : snapshot.actionCount + 3 };
}
