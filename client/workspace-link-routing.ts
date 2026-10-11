/** Supported workspace inventory/navigation only; no file stat, read, execution or credentials. */
import type { getPaseoClient, PluginHostSummary, PluginScreenProps } from "@getpaseo/plugin/client";
import { relativeWorkspaceFile, type FileReference } from "./workspace-links";

// Project types through the host-injected module: the daemon resolves type-only imports too.
type WorkspaceList = ReturnType<typeof getPaseoClient>["workspaces"]["list"];
type PaseoWorkspace = Awaited<ReturnType<WorkspaceList>>["entries"][number];
type PaseoWorkspaceListOptions = NonNullable<Parameters<WorkspaceList>[0]>;
type WorkspaceIdentity = Pick<PaseoWorkspace, "id" | "name" | "workspaceDirectory" | "archivingAt">;
export interface WorkspaceLinkClient {
  workspaces: { list(options?: PaseoWorkspaceListOptions): Promise<{
    entries: WorkspaceIdentity[];
    pageInfo: { hasMore: boolean; nextCursor: string | null };
  }> };
}
export interface WorkspaceLinkServices {
  hosts(): readonly PluginHostSummary[];
  client(serverId: string): WorkspaceLinkClient;
}
export interface WorkspaceFileSelection {
  host: PluginHostSummary;
  workspace: WorkspaceIdentity;
  relativePath: string;
  reference: FileReference;
}

function hostSignature(hosts: readonly PluginHostSummary[]): string {
  return JSON.stringify(hosts.map(host => [host.serverId, host.status]).sort());
}
function hostOf(hosts: readonly PluginHostSummary[], serverId: string): PluginHostSummary {
  const matches = hosts.filter(host => host.serverId === serverId);
  if (matches.length !== 1) throw new Error("The file link's host is missing or ambiguous. Use an exact configured Paseo serverId.");
  if (matches[0]!.status !== "online") throw new Error(`Host ${matches[0]!.label} is offline or disconnected. Reconnect it before opening this workspace.`);
  return matches[0]!;
}

async function workspaceInventory(client: WorkspaceLinkClient): Promise<WorkspaceIdentity[]> {
  const entries: WorkspaceIdentity[] = [], cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    let result;
    try {
      result = await client.workspaces.list({
        page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
      });
    } catch { throw new Error("The workspace inventory could not be read. Reconnect the named host and retry; no workspace was chosen."); }
    entries.push(...result.entries.map(workspace => ({ ...workspace })));
    if (!result.pageInfo.hasMore) {
      if (result.pageInfo.nextCursor !== null) throw new Error("The workspace inventory is incomplete or inconsistent. Use an explicit host/workspace link and retry.");
      return entries;
    }
    const next = result.pageInfo.nextCursor;
    if (!next || next === cursor || cursors.has(next) || result.entries.length === 0) break;
    cursors.add(next); cursor = next;
  }
  throw new Error("The workspace inventory is incomplete. Use an explicit host/workspace link and retry.");
}

function clientFor(services: WorkspaceLinkServices, serverId: string): WorkspaceLinkClient {
  try { return services.client(serverId); }
  catch { throw new Error("The named host's Paseo connection is unavailable. Reconnect it and retry; no other host will be used."); }
}

/** Resolves at click time; explicit identities never fall back to another host, workspace or home. */
export async function resolveWorkspaceFile(reference: FileReference, services: WorkspaceLinkServices): Promise<WorkspaceFileSelection> {
  const before = services.hosts().map(host => ({ ...host }));
  const identity = reference.provenance;
  if (!reference.absolute && identity === null) {
    throw new Error("A relative workspace file needs host and workspace provenance in its link title. For a home file, use firstmate:home.");
  }
  let selection: WorkspaceFileSelection;
  if (identity !== null) {
    const host = hostOf(before, identity.serverId);
    // 0.11 accepts idPrefix but documents it as ignored. Page the inventory and match exactly here.
    const workspaces = await workspaceInventory(clientFor(services, host.serverId));
    const matches = workspaces.filter(workspace => workspace.id === identity.workspaceId);
    if (matches.length !== 1) throw new Error("The file link's workspace is missing, archived, or ambiguous on its named host.");
    const workspace = matches[0]!;
    if (workspace.archivingAt !== null) throw new Error("The file link's workspace is being archived. No other workspace will be opened.");
    const relativePath = relativeWorkspaceFile(workspace.workspaceDirectory, reference);
    if (relativePath === null) throw new Error("The file link is outside the named workspace, or names the workspace root rather than a file.");
    selection = { host, workspace, relativePath, reference };
  } else {
    if (before.length === 0 || new Set(before.map(host => host.serverId)).size !== before.length) throw new Error("No complete, unambiguous host inventory is available. Add exact host/workspace provenance to the file link.");
    before.forEach(host => hostOf(before, host.serverId));
    const inventories = await Promise.all(before.map(async function (host) { return { host, workspaces: await workspaceInventory(clientFor(services, host.serverId)) }; }));
    const matches: WorkspaceFileSelection[] = [];
    for (const { host, workspaces } of inventories) {
      for (const workspace of workspaces) {
        const relativePath = relativeWorkspaceFile(workspace.workspaceDirectory, reference);
        if (relativePath !== null) matches.push({ host, workspace, relativePath, reference });
      }
    }
    if (matches.length === 0) throw new Error("No known workspace contains this absolute file path. Its workspace may be missing or archived; add exact host/workspace provenance.");
    if (matches.length !== 1) throw new Error("This absolute path belongs to multiple hosts or nested workspaces. Add exact host/workspace provenance; no workspace was chosen.");
    selection = matches[0]!;
    if (selection.workspace.archivingAt !== null) throw new Error("The matching workspace is being archived. No other workspace will be opened.");
  }
  hostOf(services.hosts(), selection.host.serverId);
  if (identity === null && hostSignature(before) !== hostSignature(services.hosts())) throw new Error("The host inventory changed while resolving this link. Open the link again.");
  return selection;
}

/** Revalidate when the dialog's button is pressed; only the public identity fields reach navigation. */
export async function openWorkspaceForFile(selection: WorkspaceFileSelection, services: WorkspaceLinkServices, navigation: PluginScreenProps["navigation"], isCurrent: () => boolean = () => true): Promise<boolean> {
  if (navigation === undefined) throw new Error("This Paseo client cannot open workspaces from plugins.");
  const current = await resolveWorkspaceFile(selection.reference, services);
  if (current.host.serverId !== selection.host.serverId || current.workspace.id !== selection.workspace.id || current.workspace.workspaceDirectory !== selection.workspace.workspaceDirectory || current.relativePath !== selection.relativePath) {
    throw new Error("The workspace changed while this link was open. Open the link again before navigating.");
  }
  if (!isCurrent()) return false;
  navigation.openWorkspace({ serverId: current.host.serverId, workspaceId: current.workspace.id });
  return true;
}
