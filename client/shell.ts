import type { Fleet } from "../shared/fleet";

/** Fixed identities: Paseo owns opening, focusing, closing and restoring these tabs. */
export const FLEET_PANELS = {
  deck: { id: "firstmate-deck", title: "Deck", icon: "Ship" },
  board: { id: "firstmate-board", title: "Board", icon: "Columns3" },
  crew: { id: "firstmate-crew", title: "Crew", icon: "Users" },
} as const;

export type FleetView = keyof typeof FLEET_PANELS;
export type FleetShell = {
  openView(view: FleetView, workspaceId: string): void;
  openHome(): void;
};

/** An adopted agent outside the home must never lend its workspace to the launcher. */
export function homeWorkspace(fleet: Fleet | null): string | null {
  return fleet?.mateInHome === true ? (fleet.mate?.workspaceId ?? null) : null;
}

export function chatIsVisible(view: FleetView | "home", compact: boolean, tab: string, collapsed: boolean): boolean {
  return view === "home" && (compact ? tab === "chat" : !collapsed);
}
