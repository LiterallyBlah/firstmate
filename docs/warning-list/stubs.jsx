import { useRpc as originalRpc } from "../board-list/stubs";
import { fleet as baseFleet } from "../board-list/fixtures";
export * from "../board-list/stubs";
// Keep the chat empty; older layout fixtures' example conversations are unrelated to this bug.
const fixturePaseo = { agents: { ref: () => ({ refresh: async () => ({ agent: baseFleet.mate }), timeline: {
  refetch: async () => ({ entries: [], agent: { ...baseFleet.mate, pendingPermissions: [] }, hasOlder: false, error: null }), subscribe: () => () => {},
} }) } };
export const usePaseo = () => fixturePaseo;
export function useRpc(contract) {
  if (contract.name === "firstmate.fleet.load") return async () => ({ ...structuredClone(baseFleet), ...structuredClone(window.warningFixture.fleet), homeReady: true,
    mate: { ...baseFleet.mate, status: "idle" }, mateInHome: true, charterOutdated: true, suggestions: [], watches: [] });
  if (contract.name === "firstmate.workflow.read") return async () => structuredClone(window.warningFixture.workflow);
  if (contract.name === "firstmate.workflow.act") return async () => { throw new Error("Plan actions are forbidden in this read-only preview"); };
  if (contract.name === "firstmate.needs-you.read") return async () => ({ homeId: "fixture", version: 1, actionCount: 0, newCount: 0, snoozedCount: 0, pendingAnswerCount: 0,
    freshness: { status: "fresh", asOf: Date.now(), checkedAt: Date.now(), problems: [] }, requests: [], parked: [], delivery: "off", planNow: [], comingUp: [] });
  return originalRpc(contract);
}
