import { useRpc as baseRpc } from "../../board-list/stubs";
import { snapshot, threads, needs, maintenanceNeeds } from "./fixtures";
export * from "../../board-list/stubs";
const clone = value => JSON.parse(JSON.stringify(value));
window.scopeActions = []; window.scopeSnapshot = clone(snapshot); window.scopeNeeds = clone(location.search.includes("maintenance") ? maintenanceNeeds : needs); window.holdSend = false; window.holdRead = false;
const methods = new Map();
export function useRpc(contract) {
  if (!contract.name.startsWith("firstmate.scope.") && contract.name !== "firstmate.maintenance.answer-ui") return baseRpc(contract);
  if (!methods.has(contract.name)) methods.set(contract.name, async input => {
    window.scopeActions.push({ name: contract.name, input: clone(input) });
    switch (contract.name) {
      case "firstmate.scope.read":
        if (window.failScopeRead) throw new Error("Scope read unavailable (recovery fixture)");
        return { ...clone(window.scopeSnapshot), uiEnabled: !location.search.includes("before") };
      case "firstmate.scope.conversation": return clone(threads.get(input.scopeId) ?? { key: "unknown", title: "Unknown", messages: [] });
      case "firstmate.scope.discuss": {
        if (window.refuseNext) { window.refuseNext = false; return { outcome: "refused", code: "STALE", message: "The captured binding changed. Preserve this draft and refresh." }; }
        if (window.holdSend) await new Promise(resolve => { window.releaseSend = resolve; });
        const scope = window.scopeSnapshot.scopes.find(s => s.id === input.route.target.scopeId), thread = threads.get(scope.id);
        thread.messages.push({ id: input.id, text: input.text, route: input.route, agentId: scope.target.agentId ?? "created-on-send", kind: "discuss", delivery: "sent", reply: null, createdAt: new Date().toISOString() });
        if (scope.target.epoch === 0) { scope.target.epoch = 1; scope.target.agentId = "created-on-send"; scope.target.scopeVersion++; scope.session = "unknown"; scope.discussionOnly = true; }
        window.scopeSnapshot.sequence++;
        return { outcome: "recorded", thread: clone(thread) };
      }
      case "firstmate.scope.needs":
        if (window.holdRead) throw new Error("Combined decision read unavailable");
        return clone(window.scopeNeeds);
      case "firstmate.scope.answer":
      case "firstmate.maintenance.answer-ui": {
        if (window.refuseAnswer) return { outcome: "refused", code: "STALE", message: "Policy vector changed; reread the scoped rules." };
        if (window.loseAnswerReply) throw new Error("Answer response unavailable (recovery fixture)");
        const row = window.scopeNeeds.scopedDecisions[0];
        row.ready = false; row.decision.state = "answered"; row.decision.answer = { submissionId: input.submissionId, option: input.option, text: input.text,
          at: new Date().toISOString(), provenance: { kind: "captain-ui", id: "fixture", source: "fixture" }, outboxId: "00000000-0000-4000-8000-000000000401" };
        window.scopeNeeds.actionCount = 0; window.scopeNeeds.scopedPendingAnswerCount = 1; window.scopeNeeds.pendingAnswerCount = 1; window.scopeNeeds.scopedSequence++;
        if (contract.name === "firstmate.maintenance.answer-ui") return { decisions: [clone(row.decision)] };
        return clone(window.scopeNeeds);
      }
      default: throw new Error(`Unexpected scope method ${contract.name}`);
    }
  });
  return methods.get(contract.name);
}
