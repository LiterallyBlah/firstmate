export * from "../attention-deck/drawer-stubs.jsx";
import { useRpc as original } from "../attention-deck/drawer-stubs.jsx";
export function useRpc(contract) {
  if (contract.name === "firstmate.workflow.read") return async () => structuredClone(window.workflowFixture);
  return original(contract);
}
