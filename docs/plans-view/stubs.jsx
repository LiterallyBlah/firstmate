import { useRpc as originalRpc } from "../board-list/stubs";
export * from "../board-list/stubs";
export function useRpc(contract) {
  const original = originalRpc(contract);
  if (contract.name === "firstmate.needs-you.read") return async () => ({
    homeId: "fixture-home", version: 1, actionCount: 0, newCount: 0, snoozedCount: 0, pendingAnswerCount: 0,
    freshness: { status: "fresh", asOf: Date.now(), checkedAt: Date.now(), problems: [] }, requests: [], parked: [], delivery: "off", planNow: [], comingUp: [],
  });
  if (contract.name === "firstmate.workflow.read") return async () => {
    window.planReads++;
    if (window.plansScenario === "error") throw new Error("Fixture host is offline");
    return structuredClone(window.workflowFixture);
  };
  if (contract.name === "firstmate.workflow.act") return async input => {
    window.planActions.push(input);
    return structuredClone(window.workflowFixture);
  };
  return original;
}
