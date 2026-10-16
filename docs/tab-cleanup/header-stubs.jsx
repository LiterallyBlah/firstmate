export * from "../shell-phase1/stubs.jsx";
import { useRpc as baseRpc } from "../shell-phase1/stubs.jsx";

const handlers = new Map();
const status = {
  state: "available",
  latest: "bbbbbbbb",
  token: "b".repeat(64),
  requested: false,
  explanation: "FirstMate bbbbbbbb is available. Ask the first mate to install this revision.",
};
export function useRpc(contract) {
  const base = baseRpc(contract);
  if (!handlers.has(contract.name))
    handlers.set(contract.name, async (input) => {
      if (contract.name === "firstmate.update.check") return status;
      if (contract.name === "firstmate.update.request") {
        window.fixtureCalls.push({ name: contract.name, input });
        return { status: { ...status, requested: true }, agentId: "mate" };
      }
      return base(input);
    });
  return handlers.get(contract.name);
}
