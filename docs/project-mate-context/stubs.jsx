export * from "../board-list/stubs";
const rpcs = new Map();
export function useRpc(contract) {
  if (!rpcs.has(contract.name)) rpcs.set(contract.name, async input => {
    window.projectCalls.push({ name: contract.name, input });
    if (contract.name === "firstmate.projects.read") return structuredClone(window.projectSnapshot);
    if (contract.name === "firstmate.projects.provision-ui") {
      // Synthetic error only. No daemon, workspace, agent or model is contacted.
      throw Error(new URLSearchParams(location.search).get("stage") === "before"
        ? "Project conventions exceed the bounded context snapshot."
        : "AGENTS.md is too large to include in full (over 128 KiB). Keep the project rules in this file and move reference material into documentation, then resume setup.");
    }
    throw Error(`Unexpected fixture RPC: ${contract.name}`);
  });
  return rpcs.get(contract.name);
}
