export * from "../home-deck/stubs";
import { useRpc as baseRpc } from "../home-deck/stubs";
import { fleet, entries, now } from "../board-list/fixtures";
export const useHosts = () => [{ serverId: "fixture-host", label: "Fixture", status: "online" }];
export const getPaseoClient = () => ({ workspaces: { list: async () => ({ entries: [{ id: "worker-space", name: "Worker", workspaceDirectory: "C:/Sample/Worker", archivingAt: null }], pageInfo: { hasMore: false, nextCursor: null } }) } });
export const copyText = async text => { window.copiedText = text; };
const request = { id: "permission", name: "Bash", description: "Run the conversation checks", input: { command: "npm test" } };
const timeline = entries.slice(0, 4).map((entry, index) => ({ ...entry, seqStart: index + 20, seqEnd: index + 20 }));
timeline[0].item.text = "The panel is ready to review.\n\n```ts\nconst docked = drawerDocks(width);\n```\n\n![Worker preview](preview.png)";
const older = { ...entries[0], seqStart: 1, seqEnd: 1, item: { type: "assistant_message", text: "Earlier: keep the scene mounted while the conversation opens." } };
const paseo = { agents: { ref: id => ({
  timeline: {
    refetch: async options => ({ entries: (options?.direction === "before") ? [older] : timeline, agent: { ...fleet.cards[0].agent, pendingPermissions: window.showPermission ? [request] : [] }, hasOlder: !(options?.direction === "before"), startCursor: { epoch: "fixture", seq: (options?.direction === "before") ? 1 : 20 }, epoch: "fixture", window: { minSeq: 1, maxSeq: 23 }, direction: (options?.direction === "before") ? "before" : "tail", error: null }),
    subscribe: cb => { window.updateTimeline = cb; return () => {}; },
  },
  respondToPermission: async input => { window.fixtureCalls.push({ name: "permission", input: { agentId: id, ...input } }); },
}) } };
export const usePaseo = () => paseo;
const image = async input => {
  window.fixtureCalls.push({ name: "firstmate.images.read", input });
  // Host transport stand-in; routing and server containment are covered by their unit tests.
  return { status: "ready", dataUrl: "data:image/png;base64," + await (await fetch("/preview")).text() };
};
export function useRpc(contract) { return contract.name === "firstmate.images.read" ? image : baseRpc(contract); }
