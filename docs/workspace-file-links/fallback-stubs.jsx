/** API fixtures for the real FleetSurface. Native workspace bridge is loaded separately. */
export * from "../board-list/stubs";
import { useSyncExternalStore } from "react";
import { useRpc as originalRpc, usePaseo as originalPaseo } from "../board-list/stubs";
import { fleet } from "../board-list/fixtures";
import { externalOpener } from "./.generated/native-runtime.js";

window.fallbackEvidence = { workspaceNavigation: [], external: [], home: [], finds: [], lists: [], toasts: [], copies: [] };
window.linkEvidence = window.fallbackEvidence;
const initialHosts = [
  { serverId: "local-fixture", label: "Desktop", status: "online" },
  { serverId: "remote-fixture", label: "Remote Windows", status: "online" },
];
let hosts = initialHosts;
const listeners = new Set();
window.linkHosts = next => { hosts = next; for (const listener of listeners) listener(); };
window.resetLinkHosts = () => window.linkHosts(initialHosts);
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const useHosts = () => useSyncExternalStore(subscribe, () => hosts, () => hosts);
window.linkRoots = {
  "local-fixture": [
    { id: "local-workspace", name: "Quality review", workspaceDirectory: "C:/repo", archivingAt: null },
    { id: "unix-workspace", name: "Unix reports", workspaceDirectory: "/srv/repo", archivingAt: null },
    { id: "nested-workspace", name: "Nested reports", workspaceDirectory: "/srv/repo/nested", archivingAt: null },
  ],
  "remote-fixture": [{ id: "remote-workspace", name: "Remote review", workspaceDirectory: "C:/repo", archivingAt: null }],
};
export const getPaseoClient = serverId => ({ workspaces: { list: async options => {
  window.fallbackEvidence.lists.push({ serverId, options });
  if (window.failLinkHost === serverId) throw new Error("Fixture connection failed");
  const entries = window.linkRoots[serverId] ?? [];
  return { entries: structuredClone(entries), pageInfo: { hasMore: false, nextCursor: null } };
} } });
export const openExternalUrl = externalOpener;
export const copyText = async text => { window.fallbackEvidence.copies.push(text); };
const toast = { show: (message, options) => window.fallbackEvidence.toasts.push({ message, options }), error: message => window.fallbackEvidence.toasts.push({ message, error: true }) };
export const useToast = () => toast;
const findHome = async input => {
  window.fallbackEvidence.finds.push(input);
  return { files: input.paths.includes("data/backlog.md") ? { "data/backlog.md": "data/backlog.md" } : {} };
};
const listHome = async input => {
  window.fixtureCalls.push({ name: "firstmate.files.list", input });
  return { home: "C:/Sample/FirstMate", path: input.path, entries: [{ name: "backlog.md", path: "data/backlog.md", kind: "file", size: 20, modifiedMs: 1 }] };
};
const readHome = async input => ({ path: input.path, content: "# Backlog fixture\n", hash: "a".repeat(64), binary: false, tooLarge: false, size: 20, modifiedMs: 1 });
export const useRpc = contract => contract.name === "firstmate.files.find" ? findHome : contract.name === "firstmate.files.list" ? listHome : contract.name === "firstmate.files.read" ? readHome : originalRpc(contract);

const source = [
  "Workspace links open the named workspace. Select the identified file manually in its explorer.",
  '[Local report](<file:///C:/repo/reports/quality%20report.md#L12-L18> "firstmate:serverId=local-fixture&workspaceId=local-workspace")',
  '[Remote image](<reports/preview%20image.png> "firstmate:serverId=remote-fixture&workspaceId=remote-workspace")',
  '[Unique Unix report](/srv/repo/report.md:7)',
  '[Encoded filename](<reports/a%23b%3F%25%28c%29.md#L3> "firstmate:serverId=local-fixture&workspaceId=unix-workspace")',
  '[Ambiguous absolute](C:/repo/reports/report.md)',
  '[Nested absolute](/srv/repo/nested/report.md)',
  '[No provenance](reports/quality.md)',
  '[Missing workspace](report.md "firstmate:serverId=remote-fixture&workspaceId=missing-workspace")',
  '[Outside root](C:/other/report.md "firstmate:serverId=remote-fixture&workspaceId=remote-workspace")',
  '[Home backlog](data/backlog.md "firstmate:home")',
  '[Missing home](data/missing.md "firstmate:home")',
  '[HTTPS docs](<https://paseo.sh/docs?id=2#part> "Docs")',
  '[HTTPS home title](<https://paseo.sh/docs?id=3#part> "firstmate:home")',
].join("\n");
const base = originalPaseo();
const entry = { provider: "codex", item: { type: "assistant_message", text: source }, timestamp: "2026-10-11T15:00:00Z", seqStart: 1, seqEnd: 1, sourceSeqRanges: [], collapsed: [] };
const paseo = { ...base, agents: { ...base.agents, ref: id => ({
  ...base.agents.ref(id), timeline: {
    refetch: async () => ({ entries: [entry], agent: { ...fleet.mate, pendingPermissions: [], lastUsage: { contextWindowUsedTokens: 34000, contextWindowMaxTokens: 200000 } }, hasOlder: false, error: null }),
    subscribe: () => () => {},
  },
}) } };
export const usePaseo = () => paseo;
