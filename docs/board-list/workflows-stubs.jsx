import { useRpc as originalRpc } from "./stubs";
import { fleet } from "./fixtures";
export * from "./stubs";
export function useRpc(contract) {
  const original = originalRpc(contract);
  return async input => {
    if (contract.name === "firstmate.workflow.read") return structuredClone(window.integratedWorkflow.plans);
    if (contract.name === "firstmate.needs-you.read") return structuredClone(window.integratedWorkflow.needs);
    if (contract.name === "firstmate.fleet.load") return { ...structuredClone(fleet), cards: structuredClone(window.integratedWorkflow.cards), needsYou: structuredClone(window.integratedWorkflow.needs) };
    if (contract.name === "firstmate.workflow.act") throw new Error("This fixture exercises viewing/filtering only; no action should be submitted.");
    return original(input);
  };
}
