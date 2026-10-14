/**
 * The ship deck's scene: the board's own cards turned into sailors on one deck, placed by state. Pure.
 *
 * The deck draws nothing the board does not already know. It reads the cards `firstmate.fleet.load`
 * already filed into columns — the same query the board, the panels and the sidebar share — so a
 * sailor stands where its card's column says, and the column rules stay in `server/fleet.ts`.
 *
 * Four places on deck, from the column:
 *
 * - **working** — Working, at a station amidships;
 * - **waiting** — Ready (finished, waiting on the first mate) and Working with the `waiting` note (a
 *   wait on a job outside the worker), at the helm on the quarterdeck;
 * - **blocked** — Blocked and Failed, in the bow rigging;
 * - **idle** — Idle and Parked, at the rail.
 *
 * Only live crew stand on deck: a local crewmate Paseo has not closed, or a remote worker that is
 * crew, not a followed session. Queued and Done cards, and cards with no worker, are left off.
 */
import type { PluginTheme } from "@getpaseo/plugin";

import type { FleetCard, FleetDeckSwitch } from "../shared/fleet";

export const DECK_STATES = ["working", "waiting", "blocked", "idle"] as const;
export type DeckState = (typeof DECK_STATES)[number];

/** The deck's own coordinates; the canvas scales them to fit. */
export const DECK_WIDTH = 960;
export const DECK_HEIGHT = 420;

interface Zone {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where each state stands, in deck coordinates: the stern is on the left, the bow on the right; the wheel is aft of the helm. */
export const DECK_ZONES: Record<DeckState, Zone> = {
  waiting: { x: 150, y: 125, width: 100, height: 170 },
  working: { x: 300, y: 120, width: 320, height: 150 },
  idle: { x: 300, y: 300, width: 320, height: 50 },
  blocked: { x: 690, y: 140, width: 130, height: 140 },
};

/** The smallest gap between two sailors' centres before a crowded zone squeezes them. */
const SPACING = 44;

export interface DeckPalette {
  sea: string;
  hull: string;
  deck: string;
  plank: string;
  rail: string;
  mark: string;
  states: Record<DeckState, string>;
}

export interface DeckSailor {
  /** The card's key, so a sailor keeps its identity across polls. */
  key: string;
  label: string;
  state: DeckState;
  x: number;
  y: number;
}

export interface DeckScene {
  width: number;
  height: number;
  palette: DeckPalette;
  sailors: DeckSailor[];
  counts: Record<DeckState, number>;
}

/** Whether a card has a live crew worker behind it. */
export function hasLiveWorker(card: FleetCard): boolean {
  if (card.agent !== null) return card.agent.status !== "closed";
  const worker = card.remote?.worker ?? null;
  return worker !== null && !worker.followed && worker.status !== "closed";
}

/** Where a card's sailor stands, or null for a card that is not on deck. */
export function deckState(card: FleetCard): DeckState | null {
  if (!hasLiveWorker(card)) return null;
  switch (card.column) {
    case "working":
      return card.note === "waiting" ? "waiting" : "working";
    case "ready":
      return "waiting";
    case "blocked":
    case "failed":
      return "blocked";
    case "idle":
    case "parked":
      return "idle";
    case "queued":
    case "done":
      return null;
  }
}

/** `count` points spread over `zone`, row by row, as square as the zone allows. */
export function zoneSlots(zone: Zone, count: number): Array<{ x: number; y: number }> {
  if (count <= 0) return [];
  const across = Math.max(1, Math.round(zone.width / SPACING));
  const columns = Math.min(count, Math.max(across, Math.ceil(Math.sqrt((count * zone.width) / zone.height))));
  const rows = Math.ceil(count / columns);
  const stepX = zone.width / columns;
  const stepY = zone.height / rows;
  return Array.from({ length: count }, (_, index) => ({
    x: Math.round(zone.x + stepX * ((index % columns) + 0.5)),
    y: Math.round(zone.y + stepY * (Math.floor(index / columns) + 0.5)),
  }));
}

export function deckPalette(theme: PluginTheme): DeckPalette {
  const { colors } = theme;
  return {
    sea: colors.surface0,
    hull: "#5b3a22",
    deck: "#a0703f",
    plank: "#8a5d33",
    rail: "#3f2716",
    mark: "#f2d3a8",
    states: {
      working: colors.statusSuccess,
      waiting: colors.statusWarning,
      blocked: colors.statusDanger,
      idle: colors.foregroundMuted,
    },
  };
}

/** The deck for these cards: one sailor per live crew worker, in card-key order within its place. */
export function deckScene(cards: readonly FleetCard[], theme: PluginTheme): DeckScene {
  const byState = new Map<DeckState, FleetCard[]>(DECK_STATES.map((state) => [state, []]));
  for (const card of cards) {
    const state = deckState(card);
    if (state !== null) byState.get(state)?.push(card);
  }
  const sailors: DeckSailor[] = [];
  const counts = Object.fromEntries(DECK_STATES.map((state) => [state, 0])) as Record<DeckState, number>;
  for (const state of DECK_STATES) {
    const crew = [...(byState.get(state) ?? [])].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    counts[state] = crew.length;
    const slots = zoneSlots(DECK_ZONES[state], crew.length);
    crew.forEach((card, index) => {
      const slot = slots[index] ?? { x: DECK_ZONES[state].x, y: DECK_ZONES[state].y };
      sailors.push({ key: card.key, label: card.title, state, x: slot.x, y: slot.y });
    });
  }
  return { width: DECK_WIDTH, height: DECK_HEIGHT, palette: deckPalette(theme), sailors, counts };
}

/**
 * Whether the screen offers the Deck at all: only when the daemon says the switch is on, only in a web
 * renderer (the desktop app), and only on the wide layout, where it takes the right-hand pane.
 */
export function deckOffered(fleet: FleetDeckSwitch | null, os: string, compact: boolean): boolean {
  return fleet?.shipDeck === true && os === "web" && !compact;
}
