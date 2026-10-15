/** Where the Converse drawer goes, and which worker it is for. Pure. */

/** The drawer's width when it docks beside a surface, and the least that surface keeps beside it. */
export const DRAWER_WIDTH = 380;
export const DRAWER_MIN_SURFACE = 300;

/** Whether a pane this wide fits the drawer beside its surface; otherwise the drawer takes the pane. */
export function drawerDocks(paneWidth: number): boolean {
  return paneWidth >= DRAWER_WIDTH + DRAWER_MIN_SURFACE;
}

/** What a `watchKey` names: a local crewmate's agent id, or a remote worker by host and id. */
export type ConverseTarget = { kind: "local"; agentId: string } | { kind: "remote"; serverId: string; agentId: string };

export function converseTarget(key: string): ConverseTarget {
  const remote = /^remote:(.+):([^:]+)$/.exec(key);
  return remote === null
    ? { kind: "local", agentId: key }
    : { kind: "remote", serverId: remote[1] ?? "", agentId: remote[2] ?? "" };
}
