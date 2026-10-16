export * from "../board-list/stubs.jsx";
import { useRpc as baseRpc, useSettings as baseSettings } from "../board-list/stubs.jsx";
import { fleet } from "../board-list/fixtures.js";
const params = new URLSearchParams(location.search);
window.chatMate = params.has("no-mate") ? null : { ...fleet.mate, requiresAttention: true };
window.sends = [];
window.timelineReads = [];
let seq = 0;
const entry = (item) => ({
  item,
  provider: "claude",
  timestamp: new Date().toISOString(),
  seqStart: ++seq,
  seqEnd: seq,
  sourceSeqRanges: [],
  turnId: "t",
  collapsed: [],
});
let entries = [
  entry({ type: "assistant_message", text: "Ahoy. Current first mate here.", messageId: "hello" }),
  entry({
    type: "user_message",
    text: '<firstmate-watch name="test" ran="now">HIDDEN WATCH PAYLOAD</firstmate-watch>',
    clientMessageId: "firstmate-watch-test",
  }),
];
const listeners = new Set();
const timeline = {
  refetch: async (input) => {
    window.timelineReads.push(input);
    return {
      entries: structuredClone(entries),
      agent: { ...window.chatMate, pendingPermissions: [] },
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
  agents: {
    ref: (id) => {
      window.lastAgentRead = id;
      return { timeline, respondToPermission: async () => {} };
    },
  },
  providers: { listAvailable: async () => ({ providers: [] }) },
};
export const usePaseo = () => paseo;
export const useWorkspace = () => ({ name: "Other project", directory: "/other" });
export const useAgent = () => "Worker";
async function ask(input) {
  window.sends.push(input);
  if (window.holdSend)
    await new Promise((done) => {
      window.releaseSend = done;
    });
  if (window.failSend) throw new Error("Fixture send failed");
  entries = [...entries, entry({ type: "user_message", text: input.text, clientMessageId: input.messageId })];
  listeners.forEach((listener) => listener({ type: "timeline" }));
  return { agentId: window.chatMate.id };
}
const rpcs = new Map();
export function useRpc(contract) {
  if (contract.name === "firstmate.mate.ask") return ask;
  if (!rpcs.has(contract.name))
    rpcs.set(contract.name, async (input) => {
      if (contract.name === "firstmate.fleet.load")
        return { ...structuredClone(fleet), mate: window.chatMate, cards: [], suggestions: [] };
      if (contract.name === "firstmate.mate.seen") {
        window.fixtureCalls.push({ name: contract.name });
        return { cleared: false };
      }
      if (contract.name === "firstmate.mate.candidates") return { agents: [] };
      if (contract.name === "firstmate.config.read")
        return { config: { mateProvider: "", mateModeId: "", migration: null, previousMateIds: [] } };
      return baseRpc(contract)(input);
    });
  return rpcs.get(contract.name);
}
export function useSettings(contract) {
  const result = baseSettings(contract);
  return { ...result, values: { ...result.values, boardCollapsed: true } };
}
