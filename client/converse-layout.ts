/** Where the Converse drawer goes, and which worker it is for. Pure. */
import type { FleetCard } from "../shared/fleet";
import { threadKey } from "../shared/item-threads";
import { watchKey } from "./host-tabs";

/** Worker conversations keep their phase-1 identity; every other item gets a stable discussion. */
export const converseKey = (card: FleetCard): string => watchKey(card) ?? threadKey(card);
export const conversingWith = (card: FleetCard, key: string | null): boolean =>
  key !== null && (converseKey(card) === key || threadKey(card) === key);

/** The drawer's width when it docks beside a surface, and the least that surface keeps beside it. */
export const DRAWER_WIDTH = 380;
export const DRAWER_MIN_SURFACE = 300;

/** Whether a pane this wide fits the drawer beside its surface; otherwise the drawer takes the pane. */
export function drawerDocks(paneWidth: number): boolean {
  return paneWidth >= DRAWER_WIDTH + DRAWER_MIN_SURFACE;
}

/** What a `watchKey` names: a local crewmate's agent id, or a remote worker by host and id. */
export type ConverseTarget = { kind: "local"; agentId: string } | { kind: "remote"; serverId: string; agentId: string } | { kind: "thread"; itemKey: string };

export function converseTarget(key: string): ConverseTarget {
  if (key.startsWith("thread:")) return { kind: "thread", itemKey: decodeURIComponent(key.slice(7)) };
  const remote = /^remote:(.+):([^:]+)$/.exec(key);
  return remote === null
    ? { kind: "local", agentId: key }
    : { kind: "remote", serverId: remote[1] ?? "", agentId: remote[2] ?? "" };
}
