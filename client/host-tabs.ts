/**
 * The board's host tabs, and what each one shows. Pure.
 *
 * With remote hosts saved, a row of tabs sits above the columns: All, this machine, then one per
 * saved host by its label. A tab filters the cards to that host's; All shows every card, including
 * a backlog line whose host is not a saved one. With no remote hosts saved there is no row.
 */
import type { FleetCard } from "../shared/fleet";

export const ALL_HOSTS = "all";
export const THIS_MACHINE = "local";

export interface HostTab {
  /** `all`, `local`, or a saved host's serverId. */
  id: string;
  label: string;
  /** Null for All and this machine; whether the host answered its last poll. */
  online: boolean | null;
  /** Cards in the Working column. */
  working: number;
  /** Cards in Blocked or Failed: waiting on someone, or stopped. */
  attention: number;
}

export interface HostSummary {
  serverId: string;
  label: string;
  online: boolean;
}

/** Whether a card belongs on a tab. */
export function onTab(card: FleetCard, tab: string): boolean {
  if (tab === ALL_HOSTS) return true;
  if (tab === THIS_MACHINE) return card.remote === undefined;
  return card.remote?.serverId === tab;
}

/** The tab to show: the saved one while its host is still saved, All otherwise. */
export function shownHostTab(saved: string, hosts: readonly HostSummary[]): string {
  if (hosts.length === 0) return ALL_HOSTS;
  if (saved === ALL_HOSTS || saved === THIS_MACHINE) return saved;
  return hosts.some((host) => host.serverId === saved) ? saved : ALL_HOSTS;
}

/** Every tab, with its counts; empty when no remote host is saved, which draws no row. */
export function hostTabs(cards: readonly FleetCard[], hosts: readonly HostSummary[]): HostTab[] {
  if (hosts.length === 0) return [];
  const tab = (id: string, label: string, online: boolean | null): HostTab => {
    const mine = cards.filter((card) => onTab(card, id));
    return {
      id,
      label,
      online,
      working: mine.filter((card) => card.column === "working").length,
      attention: mine.filter((card) => card.column === "blocked" || card.column === "failed").length,
    };
  };
  return [
    tab(ALL_HOSTS, "All", null),
    tab(THIS_MACHINE, "This machine", null),
    ...hosts.map((host) => tab(host.serverId, host.label, host.online)),
  ];
}

/**
 * What Watch remembers a card by: a local crewmate's agent id, or for a remote worker its host and
 * id together — the same id could come from two daemons.
 */
export function watchKey(card: FleetCard): string | null {
  if (card.agent !== null) return card.agent.id;
  const worker = card.remote?.worker ?? null;
  if (worker === null || card.remote?.serverId === null || card.remote?.serverId === undefined) return null;
  return `remote:${card.remote.serverId}:${worker.id}`;
}
