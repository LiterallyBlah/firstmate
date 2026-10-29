export * from "../board-list/stubs";
export function useRpc(contract) { return async () => {
  window.policyReads.push(contract.name);
  if (contract.name === "firstmate.maintenance.read") return window.policyMaintenance;
  throw new Error(`Unexpected fixture RPC: ${contract.name}`);
}; }
export const useWorkflowPlans = () => ({ activation: window.policyActivation });
export const workflowRequestId = () => { throw new Error("No request allocation in a read fixture"); };
