import { snapshot, plan } from "./fixture";
export * from "../../board-list/stubs";
window.attachCalls = [];
const methods = new Map();
export function useRpc(contract) {
  if (!methods.has(contract.name)) methods.set(contract.name, async input => {
    if (contract.name === "firstmate.mate.targets") return { targets: [{ provider: "codex/test", label: "Test supervisor", modes: [{ id: "read-only", label: "Read only" }], thinking: [] }] };
    if (contract.name === "firstmate.supervision.attach-ui") {
      window.attachCalls.push(structuredClone(input));
      return { ...snapshot, plans: [{ ...plan, canAttach: false, binding: "active", opening: "succeeded" }],
        audits: [...snapshot.audits, { at: "2026-10-28T12:05:00Z", plan: input.plan, supervisor: input.supervisorId,
          source: "client UI (unverified)", authorization: "by convention, not verified" }] };
    }
    throw new Error(`Unexpected fixture RPC: ${contract.name}`);
  });
  return methods.get(contract.name);
}
