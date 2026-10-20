import { useRpc as originalRpc } from "../board-list/stubs";
export * from "../board-list/stubs";
export function useRpc(contract) {
  const original = originalRpc(contract);
  if (contract.name === "firstmate.workflow.read") return async () => structuredClone(window.workflowFixture);
  if (contract.name === "firstmate.workflow.act") return async input => {
    window.workflowActions.push(input);
    if (input.command.subjectHash !== window.workflowFixture.subjects.scheduler) throw new Error("This plan changed on another device. Refresh and review it again.");
    window.workflowFixture.plans[0].captainEvents = [{ id: input.requestId, at: new Date().toISOString(), action: input.command.action, text: input.command.text, by: "board:captain" }];
    return structuredClone(window.workflowFixture);
  };
  return original;
}
