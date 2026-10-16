export * from "../board-list/stubs";
import { useRpc as originalRpc, usePaseo as originalPaseo } from "../board-list/stubs";
import { fleet } from "../board-list/fixtures";
const hosts = [{ serverId: "fixture-local", label: "Desktop fixture", status: "online" }];
export const useHosts = () => hosts;
export const getPaseoClient = () => ({ workspaces: { list: async () => ({ entries: [window.imageFixture.workspace], pageInfo: { hasMore: false, nextCursor: null } }) } });
window.imageRequests = [];
const read = async input => {
  const response = await fetch("/rpc", { method: "POST", body: JSON.stringify(input) });
  const result = await response.json();
  window.imageRequests.push({ input, status: result.status, reason: result.reason, size: result.size });
  return result;
};
export const useRpc = contract => contract.name === "firstmate.images.read" ? read : originalRpc(contract);
const base = originalPaseo();
const title = '"firstmate:serverId=fixture-local&workspaceId=worktree"';
const f = window.imageFixture;
const source = location.search.includes("refused") ? [
  "Refused image requests stay in the chat:",
  `![Non-image file](notes.txt ${title})`,
  `![Oversized image](large.png ${title})`,
  `![Symlink path escape](escape/preview.png ${title})`,
  `![Outside every workspace](<${f.outside}/preview.png>)`,
].join("\n\n") : [
  "The deck render is stored in the registered worktree. Its bytes are read by FirstMate's server.",
  `![Deck render](<${f.workspace.workspaceDirectory}/preview.png>)`,
  `[Open the deck image](preview.png ${title})`,
].join("\n\n");
const entry = { provider: "codex", item: { type: "assistant_message", text: source, messageId: "file-images" }, timestamp: "2026-10-16T13:00:00Z", seqStart: 1, seqEnd: 1, sourceSeqRanges: [], collapsed: [] };
const paseo = { ...base, agents: { ...base.agents, ref: id => ({ ...base.agents.ref(id), timeline: {
  refetch: async () => ({ entries: [entry], agent: { ...fleet.mate, pendingPermissions: [] }, hasOlder: false, error: null }), subscribe: () => () => {},
} }) } };
export const usePaseo = () => paseo;
