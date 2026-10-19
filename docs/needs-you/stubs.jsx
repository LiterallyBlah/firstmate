export * from "../shell-phase1/stubs.jsx";
import { useRpc as baseRpc } from "../shell-phase1/stubs.jsx";
import { fleet } from "../board-list/fixtures.js";
import React from "react";
export const SidebarRow = ({ onPress, trailing }) => (
  <button aria-label="FirstMate sidebar" onClick={onPress}>
    {trailing}
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
  ],
  parked: [],
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
const rpc = new Map();
export function useRpc(contract) {
  if (!contract.name.startsWith("firstmate.needs-you."))
    return baseRpc(contract);
  if (!rpc.has(contract.name))
    rpc.set(contract.name, async (input) => {
      window.fixtureCalls.push({ name: contract.name, input });
      if (window.attentionOffline) throw new Error("Host offline");
      const snapshot = window.attentionSnapshot;
      if (contract.name === "firstmate.needs-you.read")
        return structuredClone(snapshot);
      if (window.attentionRefuse)
        throw new Error("This decision changed. Refresh before acting.");
      const request = snapshot.requests.find(
        (r) => r.id === (input.id ?? input.requestId),
      );
      if (!request) throw new Error("Missing decision");
      if (contract.name.endsWith(".seen")) request.state = "seen";
      if (contract.name.endsWith(".snooze")) {
        request.state = "snoozed";
        request.snoozedUntil = input.until;
      }
      if (contract.name.endsWith(".unsnooze")) {
        request.state = "seen";
        request.snoozedUntil = null;
      }
      if (contract.name.endsWith(".answer"))
        request.state = window.attentionUncertain
          ? "delivery-uncertain"
          : "answer-sent";
      snapshot.version++;
      snapshot.freshness.checkedAt = Date.now();
      snapshot.actionCount = snapshot.requests.filter((r) =>
        ["new", "seen"].includes(r.state),
      ).length;
      snapshot.newCount = snapshot.requests.filter(
        (r) => r.state === "new",
      ).length;
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
