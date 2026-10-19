import type { Fleet } from "../shared/fleet";
import type { DecisionDestination } from "./needs-you-state";

/** Fixed identities: Paseo owns opening, focusing, closing and restoring these tabs. */
export const FLEET_PANELS = {
  deck: { id: "firstmate-deck", title: "Deck", icon: "Ship" },
  board: { id: "firstmate-board", title: "Board", icon: "Columns3" },
  crew: { id: "firstmate-crew", title: "Crew", icon: "Users" },
  chat: { id: "firstmate-chat", title: "Chat", icon: "MessageSquare" },
} as const;

export type FleetView = keyof typeof FLEET_PANELS;
export type FleetShell = {
  openView(view: FleetView, workspaceId: string): void;
  openHome(): void;
  openDecision(destination?: DecisionDestination): void;
};

/** An adopted agent outside the home must never lend its workspace to the launcher. */
export function homeWorkspace(fleet: Fleet | null): string | null {
  return fleet?.mateInHome === true ? (fleet.mate?.workspaceId ?? null) : null;
}

export function chatIsVisible(view: FleetView | "home", compact: boolean, tab: string, collapsed: boolean): boolean {
  return view === "chat" || (view === "home" && (compact ? tab === "chat" : !collapsed));
}
