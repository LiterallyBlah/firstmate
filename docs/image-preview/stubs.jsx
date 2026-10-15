/**
 * Host APIs for the image-preview replay. The board-list stubs, with a first mate whose timeline
 * records a sent message the way Paseo 0.11's daemon does: its words alone (`submittedPromptText`
 * drops every image block), under the send's `messageId` as `clientMessageId`.
 */
import { useRpc as boardRpc } from "../board-list/stubs";
import { fleet } from "../board-list/fixtures";
export * from "../board-list/stubs";

let seq = 10;
const entry = (item) => {
  seq += 1;
  return {
    provider: "claude",
    item,
    timestamp: new Date(Date.UTC(2026, 9, 15, 15, seq)).toISOString(),
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    turnId: `turn-${seq}`,
    collapsed: [],
  };
};
let entries = [entry({ type: "assistant_message", text: "Ahoy, captain. What needs doing?", messageId: "m-0" })];
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener({ type: "timeline" }));
window.imageSends = [];
const timeline = {
  refetch: async () => ({
    entries: structuredClone(entries),
    agent: { ...fleet.mate, pendingPermissions: [] },
    hasOlder: false,
    error: null,
  }),
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
const paseo = { agents: { ref: () => ({ timeline, respondToPermission: async () => {} }) } };
export const usePaseo = () => paseo;

async function ask(input) {
  window.imageSends.push({
    text: input.text,
    messageId: input.messageId ?? null,
    images: (input.images ?? []).map((image) => ({ mimeType: image.mimeType, chars: image.data.length })),
  });
  const clientMessageId = input.messageId ?? `daemon-${crypto.randomUUID()}`;
  entries = [...entries, entry({ type: "user_message", text: input.text, clientMessageId })];
  notify();
  entries = [...entries, entry({ type: "assistant_message", text: "Looking at it now.", messageId: `m-${seq}` })];
  notify();
  return { agentId: fleet.mate.id };
}
export function useRpc(contract) {
  return contract.name === "firstmate.mate.ask" ? ask : boardRpc(contract);
}
