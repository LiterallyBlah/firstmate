export * from "../shell-phase1/stubs.jsx";
import { useRpc as baseRpc } from "../shell-phase1/stubs.jsx";
import { fleet, entries } from "../board-list/fixtures.js";
import React, { useState } from "react";
import { useSettings as baseSettings } from "../shell-phase1/stubs.jsx";
import { taskSourceKey } from "../../client/task-presentation";
const viewFixture = new URLSearchParams(location.search).has("views");
window.fixtureDocuments = {};
window.fixtureSettingSaves = [];
export function useSettings(contract) {
  const base = baseSettings(contract);
  const [values, setValues] = useState(() => {
    const saved = JSON.parse(localStorage.getItem(`view-settings-${contract.id}`) ?? "null");
    const initial =
      saved ??
      (contract.id === "display"
        ? {
            columnOrder: ["done", "blocked", "working", "ready", "failed", "idle", "queued", "parked"],
            collapsedColumns: ["blocked"],
            ...(new URLSearchParams(location.search).has("remote") ? { hostTab: "sample-light" } : {}),
            ...(new URLSearchParams(location.search).has("dense") ? { density: "compact" } : {}),
            ...(new URLSearchParams(location.search).has("filtered") ? { tagFilter: ["excluded"] } : {}),
          }
        : {});
    return contract.schema.parse(initial);
  });
  if (!viewFixture) return base;
  if (contract.id === "task-layout" && new URLSearchParams(location.search).has("invalid"))
    return { status: "invalid" };
  window.fixtureDocuments[contract.id] = values;
  return {
    ...base,
    values,
    save: async (next) => {
      window.fixtureSettingSaves.push(contract.id);
      const saved = contract.schema.parse(next);
      localStorage.setItem(`view-settings-${contract.id}`, JSON.stringify(saved));
      setValues(saved);
      return true;
    },
  };
}
export const SidebarRow = ({ onPress, trailing }) => (
  <button aria-label="FirstMate sidebar" onClick={onPress} style={{ display: "flex", alignItems: "center", gap: 40, background: "transparent", color: "#a1a5a4", border: 0, fontSize: 14 }}>
    FirstMate {trailing}
  </button>
);
const at = Date.now();
function request(id, state, detectedAt, baseline = false) {
  return {
    id,
    state,
    generation: 1,
    revision: 1,
    detectedAt,
    updatedAt: detectedAt,
    baseline,
    originalAsk:
      "A long complete decision question with [the current review](https://example.com/review). Which approach should we take?",
    seenAt: null,
    seenRevision: null,
    snoozedUntil: state === "snoozed" ? at + 3600000 : null,
    submissions: [],
    resolution: null,
    source: {
      key: id,
      taskId: id,
      hostId: "local",
      project: "harbour",
      title: `Decision ${id}`,
      ask: "A long complete decision question with [the current review](https://example.com/review). Which approach should we take?",
      url: "https://example.com/review",
      reportPath: null,
      gateToken: null,
      section: "queued",
      disposition: "open",
      blockedBy: null,
    },
  };
}
window.attentionSnapshot = {
  homeId: "fixture-home",
  version: 1,
  actionCount: 3,
  newCount: 2,
  snoozedCount: 1,
  pendingAnswerCount: 1,
  freshness: { status: "fresh", asOf: at, checkedAt: at, problems: [] },
  requests: [
    request("b", "new", at - 1000),
    request("a", "new", at - 2000),
    request("seen", "seen", at - 4000, true),
    request("snooze", "snoozed", at),
    request("pending", "delivery-uncertain", at - 180000),
    request("settled", "resolved", at - 600000),
  ],
  parked: [{ ...request("parked", "seen", at).source, blockedBy: "The current rollout finishes" }],
  delivery: "off",
};
fleet.suggestions = [
  { label: "General action", prompt: "An unbound action" },
  {
    label: "Use the cautious option",
    prompt: "Choose cautious",
    decision: {
      homeId: "fixture-home",
      requestId: "a",
      recordRevision: 1,
      actionId: "cautious",
    },
  },
];
if (viewFixture) {
  const held = fleet.cards.find((card) => card.key === "block-0");
  const second = fleet.cards.find((card) => card.key === "block-1");
  const failed = structuredClone(held);
  failed.key = "failure-example";
  failed.taskId = "failure-example";
  failed.backlog.id = "failure-example";
  failed.title = failed.backlog.title = "Recover the failed validation run";
  failed.backlog.hold = null;
  failed.column = "failed";
  failed.agent.lastError = "Exact failure: validation exited with code 17";
  failed.agent.model = "private-model-detail";
  failed.agent.status = "error";
  held.agent.lastError = "A worker error must not replace the recorded question";
  const gate = (id, card, state = "new") => ({
    ...request(id, state, at - 120000),
    source: {
      ...request(id, state, at).source,
      key: taskSourceKey(card),
      taskId: card.taskId,
      project: card.project,
      title: card.title,
      ask: card.backlog.hold,
    },
  });
  window.attentionSnapshot.requests = [
    gate("a", held),
    gate("seen", second, "seen"),
    {
      ...request("b", "new", at - 60000),
      source: {
        ...request("b", "new", at).source,
        title: "Choose the next harbour without a worker",
        ask: "Which harbour should the first mate prepare next? This decision has no worker card.",
      },
    },
  ];
  window.attentionSnapshot.snoozedCount = 0;
  window.attentionSnapshot.pendingAnswerCount = 0;
  const duplicate = structuredClone(held);
  duplicate.key = "second-representation";
  duplicate.agent.id = "second-worker";
  duplicate.agent.title = "Second worker for the same decision";
  duplicate.agent.lastError = "The second worker's full diagnostic is also retained";
  const parked = fleet.cards.find((card) => card.key === "block-2");
  parked.backlog.blockedBy = "current rollout";
  const permission = fleet.cards.find((card) => card.key === "block-3");
  permission.backlog.hold = null;
  permission.agent.pendingPermissions = 1;
  fleet.cards.push(failed, duplicate);
  if (new URLSearchParams(location.search).has("many")) {
    for (let i = 0; i < 32; i++)
      window.attentionSnapshot.requests.push({
        ...request(`long-${i}`, "new", at + i),
        source: {
          ...request(`long-${i}`, "new", at).source,
          title: `Decision ${i}: a deliberately very long title to verify wrapping and full screen-reader names on the narrowest phone`,
          ask: "A complete question that remains available when host and tag filters exclude every task card.",
        },
      });
    window.attentionSnapshot.actionCount = 35;
    window.attentionSnapshot.newCount = 34;
  }
}
window.fixtureFleet = fleet;
const rpc = new Map();
export function useRpc(contract) {
  if (viewFixture && contract.name === "firstmate.fleet.load") return async () => structuredClone(fleet);
  if (!contract.name.startsWith("firstmate.needs-you.")) return baseRpc(contract);
  if (!rpc.has(contract.name))
    rpc.set(contract.name, async (input) => {
      window.fixtureCalls.push({ name: contract.name, input });
      if (window.attentionOffline) throw new Error("Host offline");
      const snapshot = window.attentionSnapshot;
      if (contract.name === "firstmate.needs-you.read") return structuredClone(snapshot);
      if (window.attentionRefuse) throw new Error("This decision changed. Refresh before acting.");
      const request = snapshot.requests.find((r) => r.id === (input.id ?? input.requestId));
      if (!request) throw new Error("Missing decision");
      if (request.revision !== (input.revision ?? input.recordRevision)) throw new Error("This decision changed. Refresh before acting.");
      if (contract.name.endsWith(".seen")) { request.state = "seen"; request.seenAt = Date.now(); request.seenRevision = request.revision; }
      if (contract.name.endsWith(".new")) { request.state = "new"; request.seenAt = null; request.seenRevision = null; }
      if (contract.name.endsWith(".snooze")) {
        request.state = "snoozed";
        request.snoozedUntil = input.until;
      }
      if (contract.name.endsWith(".unsnooze")) {
        request.state = "seen";
        request.snoozedUntil = null;
      }
      if (contract.name.endsWith(".answer")) {
        request.submissions.push({ submissionId: input.submissionId, revision: input.recordRevision, outcome: window.attentionUncertain ? "uncertain" : "accepted", recordedAt: Date.now(), settledAt: null, previousState: request.state, previousSnoozedUntil: request.snoozedUntil });
        request.state = window.attentionUncertain ? "delivery-uncertain" : "answer-sent";
      }
      if (contract.name.endsWith(".record-answer")) {
        let submission = request.submissions.find(s => s.submissionId === input.submissionId);
        if (!submission) { submission = { submissionId: input.submissionId, recordedAt: Date.now(), previousState: request.state }; request.submissions.push(submission); }
        submission.outcome = input.outcome;
        request.state = input.outcome === "failed" ? submission.previousState : "answer-sent";
      }
      snapshot.version++;
      snapshot.freshness.checkedAt = Date.now();
      snapshot.actionCount = snapshot.requests.filter((r) => ["new", "seen"].includes(r.state)).length;
      snapshot.newCount = snapshot.requests.filter((r) => r.state === "new").length;
      snapshot.pendingAnswerCount = snapshot.requests.filter((r) =>
        ["answer-sent", "delivery-uncertain"].includes(r.state),
      ).length;
      const result = structuredClone(snapshot);
      return contract.name.endsWith(".answer")
        ? {
            snapshot: result,
            outcome: window.attentionUncertain ? "uncertain" : "accepted",
          }
        : result;
    });
  return rpc.get(contract.name);
}
export const useToast = () => ({
  show: (message) => (window.attentionToasts ??= []).push(message),
  error: (message) => (window.attentionErrors ??= []).push(message),
});
if (new URLSearchParams(location.search).has("answer-chat")) {
  entries.push({ provider: "codex", item: { type: "user_message", clientMessageId: "firstmate-answer-fixture", text: `<firstmate-decision-answer>
The captain explicitly submitted an answer to this recorded question.
Decision context (JSON): ${JSON.stringify({ homeId: "fixture-home", id: "a", revision: 1, submissionId: "fixture", task: "a", title: "Choose the Windows host (waiting for the captain)", ask: "Light or Atlas" })}

Captain's answer:
Atlas. Keep Light for Ariadne.
</firstmate-decision-answer>

This binds the answer to the recorded question, not to a verified PR head or report digest. Review current material and keep the usual review checks. Reconcile the backlog explicitly after acting; sending an answer alone does not prove the task is complete.` }, timestamp: at, seqStart: 999, seqEnd: 999, sourceSeqRanges: [], collapsed: [] });
}
