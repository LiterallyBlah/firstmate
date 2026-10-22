export * from "../board-list/stubs.jsx";
import { useRpc as original } from "../board-list/stubs.jsx";
export function useRpc(contract) {
  const base = original(contract);
  if (contract.name === "firstmate.workflow.read") return async () => structuredClone(window.workflowFixture);
  if (contract.name === "firstmate.workflow.act") return async input => {
    window.fixtureActions.push(input);
    const need = window.decisionFixture.planNow[0];
    if (input.homeId !== need.decision.homeId || input.command.subjectHash !== need.decision.subjectHash || input.command.revision !== need.decision.revision) throw new Error("Plan changed");
    window.decisionFixture.planNow = [];
    window.decisionFixture.actionCount--;
    window.decisionFixture.freshness.checkedAt = Date.now();
    return { ...structuredClone(window.workflowFixture), now: [] };
  };
  if (contract.name.startsWith("firstmate.needs-you.")) return async input => {
    window.fixtureCalls.push({ name: contract.name, input });
    const snapshot = window.decisionFixture;
    if (contract.name.endsWith(".read")) return structuredClone(snapshot);
    const request = snapshot.requests.find(r => r.id === (input.id ?? input.requestId));
    if (!request) throw new Error("No backlog request exists for this plan decision");
    if (contract.name.endsWith(".seen")) { request.state = "seen"; request.seenRevision = request.revision; }
    else if (contract.name.endsWith(".answer")) { request.state = "answer-sent"; snapshot.actionCount--; }
    else throw new Error(`Unexpected action: ${contract.name}`);
    snapshot.version++;
    snapshot.freshness.checkedAt = Date.now();
    return contract.name.endsWith(".answer") ? { outcome: "accepted", snapshot: structuredClone(snapshot) } : structuredClone(snapshot);
  };
  return base;
}
