export * from "../board-list/stubs";
import { fleet } from "../board-list/fixtures";
import { observedBoundary } from "./fixtures";

let entries = structuredClone(observedBoundary);
let connected = true;
const listeners = new Set();
window.boundaryReads = [];
window.boundarySnapshot = (next) => {
  entries = structuredClone(next);
  for (const listener of listeners) listener({ type: "timeline" });
};
window.boundaryConnection = (next) => {
  connected = next;
  for (const listener of listeners) listener({ type: "replacement" });
};
const timeline = {
  refetch: async (options) => {
    window.boundaryReads.push(options);
    if (!connected) throw new Error("Fixture disconnected");
    return {
      entries: structuredClone(entries),
      agent: { ...fleet.mate, pendingPermissions: [] },
      hasOlder: false,
      error: null,
    };
  },
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
const paseo = {
  agents: { ref: () => ({ timeline, respondToPermission: async () => {} }) },
};
export const usePaseo = () => paseo;
