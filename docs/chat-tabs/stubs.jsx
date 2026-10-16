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
if (params.has("parity") && sessionStorage.parityEntries) {
  entries = JSON.parse(sessionStorage.parityEntries);
  seq = entries.at(-1)?.seqEnd ?? 0;
}
let epoch = "fixture-1";
function notify() {
  if (params.has("parity")) sessionStorage.parityEntries = JSON.stringify(entries);
  listeners.forEach((listener) => listener({ type: "timeline" }));
}
window.appendChatItems = (items) => {
  entries = [...entries, ...items.map(entry)];
  notify();
};
window.replaceChatItems = (items) => {
  seq = 0;
  epoch += "-new";
  entries = items.map(entry);
  notify();
};
window.copiedText = [];
export const copyText = async (text) => {
  window.copiedText.push(text);
};
const timeline = {
  refetch: async (input) => {
    window.timelineReads.push(input);
    if (input.direction === "before" && window.failHistory) throw new Error("History is offline");
    const available =
      input.direction === "before" ? entries.filter((entry) => entry.seqEnd < input.cursor.seq) : entries;
    const shown = available.slice(-(input.limit ?? 150));
    return {
      entries: structuredClone(shown),
      agent: { ...window.chatMate, pendingPermissions: [] },
      epoch,
      direction: input.direction,
      reset: false,
      staleCursor: input.cursor !== undefined && input.cursor.epoch !== epoch,
      gap: false,
      window: { minSeq: entries[0]?.seqStart ?? 0, maxSeq: seq, nextSeq: seq + 1 },
      startCursor: shown.length ? { epoch, seq: shown[0].seqStart } : null,
      endCursor: shown.length ? { epoch, seq: shown.at(-1).seqEnd } : null,
      hasOlder: shown.length > 0 && shown[0].seqStart > entries[0].seqStart,
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
  notify();
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
