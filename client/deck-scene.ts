/**
 * The ship deck's scene: the board's own cards turned into sailors on one deck, placed by state. Pure.
 *
 * The deck draws nothing the board does not already know. It reads the cards `firstmate.fleet.load`
 * already filed into columns — the same query the board, the panels and the sidebar share — so a
 * sailor stands where its card's column says, and the column rules stay in `server/fleet.ts`.
 *
 * Four places on deck, from the column:
 *
 * - **working** — Working, hauling at the stations amidships, round the mast;
 * - **waiting** — Ready (finished, waiting on the first mate) and Working with the `waiting` note (a
 *   wait on a job outside the worker), arms folded by the helm on the quarterdeck;
 * - **blocked** — Blocked and Failed, in the bow;
 * - **idle** — Idle and Parked, leaning at the near rail.
 *
 * Only live crew stand on deck: a local crewmate Paseo has not closed, or a remote worker that is
 * crew, not a followed session. Queued and Done cards, and cards with no worker, are left off.
 *
 * **Coordinates are the art's.** The deck is the hull's own logical pixels (`art/ship-deck/deck.json`'s
 * ship frame, 426 × 161): the bow on the left, the quarterdeck and helm on the right. A sailor's `x, y`
 * is where its feet are. **Depth is the deck row**: `deckLayers` draws the hull, then props, sailors and
 * the hull's own depth pieces (the mast, bollards, the near rail) in order of the row they stand on, so
 * a sailor behind the mast is hidden by it and one in front of it covers it.
 */
import type { PluginTheme } from "@getpaseo/plugin";

import type { FleetCard, FleetDeckSwitch } from "../shared/fleet";
import type { DeckArtManifest, DeckPropName, SailorOutfit, SailorPose } from "../shared/ship-deck";

export const DECK_STATES = ["working", "waiting", "blocked", "idle"] as const;
export type DeckState = (typeof DECK_STATES)[number];

/** The deck's own coordinates: the hull's logical pixels. The canvas scales them to fit. */
export const DECK_WIDTH = 426;
export const DECK_HEIGHT = 161;

interface Zone {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where each state's feet stand, in deck coordinates: clear deck, inside the near rail. */
export const DECK_ZONES: Record<DeckState, Zone> = {
  // The quarterdeck, in front of the wheel's foot (row 88) and behind its front rail (row 97).
  waiting: { x: 358, y: 90, width: 48, height: 5 },
  // Amidships, between the hatch and the stairs, behind and before the mast (which stands on row 110).
  working: { x: 128, y: 96, width: 172, height: 20 },
  // The bow, behind its two bollards.
  blocked: { x: 66, y: 90, width: 46, height: 14 },
  // Along the near rail, behind its two bollards (which stand on row 121).
  idle: { x: 128, y: 117, width: 172, height: 3 },
};

/** Each state's pose. The side poses face the bow's other way (right); `flip` turns them round. */
export const DECK_POSES: Record<DeckState, SailorPose> = {
  working: "hauling",
  waiting: "waiting",
  blocked: "front-idle",
  idle: "leaning",
};

/** The mast's column: a sailor working aft of it turns to face it. */
const MAST_X = 211;

/** Props on deck, where each stands: out of the zones' way, so the sailors are what moves. */
export const DECK_PROPS: ReadonlyArray<{ name: DeckPropName; x: number; y: number }> = [
  { name: "barrel", x: 252, y: 88 },
  { name: "crate", x: 306, y: 90 },
  { name: "rope", x: 178, y: 115 },
];

/** The smallest gap between two sailors' feet before a crowded zone squeezes them. */
const SPACING = 13;

export interface DeckPalette {
  sea: string;
  states: Record<DeckState, string>;
}

export interface DeckSailor {
  /** The card's key, so a sailor keeps its identity across polls. */
  key: string;
  label: string;
  state: DeckState;
  /** Where its feet are. */
  x: number;
  y: number;
  pose: SailorPose;
  outfit: SailorOutfit;
  /** Mirrored, to face the bow. */
  flip: boolean;
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

/**
 * `count` points spread over `zone`, row by row, as square as the zone allows. A single row is
 * staggered a little front and back, so a line of sailors stands about the deck rather than in file.
 */
export function zoneSlots(zone: Zone, count: number): Array<{ x: number; y: number }> {
  if (count <= 0) return [];
  const across = Math.max(1, Math.round(zone.width / SPACING));
  const columns = Math.min(count, Math.max(across, Math.ceil(Math.sqrt((count * zone.width) / zone.height))));
  const rows = Math.ceil(count / columns);
  const stepX = zone.width / columns;
  const stepY = zone.height / rows;
  const stagger = rows === 1 && count > 1 ? zone.height / 4 : 0;
  return Array.from({ length: count }, (_, index) => ({
    x: Math.round(zone.x + stepX * ((index % columns) + 0.5)),
    y: Math.round(zone.y + stepY * (Math.floor(index / columns) + 0.5) + (index % 2 === 0 ? -stagger : stagger)),
  }));
}

/** A stable choice of outfit for a card: the same sailor keeps the same clothes from poll to poll. */
export function sailorOutfit(key: string): SailorOutfit {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return hash % 2 === 0 ? "base" : "outfit";
}

export function deckPalette(theme: PluginTheme): DeckPalette {
  const { colors } = theme;
  return {
    sea: colors.surface0,
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
      sailors.push({
        key: card.key,
        label: card.title,
        state,
        x: slot.x,
        y: slot.y,
        pose: DECK_POSES[state],
        outfit: sailorOutfit(card.key),
        flip: state === "working" && slot.x > MAST_X,
      });
    });
  }
  return { width: DECK_WIDTH, height: DECK_HEIGHT, palette: deckPalette(theme), sailors, counts };
}

export type DeckLayer =
  | { kind: "ship" }
  | { kind: "piece"; name: string }
  | { kind: "prop"; name: DeckPropName; x: number; y: number }
  | { kind: "sailor"; sailor: DeckSailor };

/**
 * Everything on deck in the order it is drawn, back to front: the hull, then props, sailors and the
 * hull's depth pieces by the row they stand on — a piece after anything on its own row, so a sailor's
 * feet on the mast's row are behind the mast — and last the near rail (`baseline: null`). Sailors on
 * one row go left to right.
 */
export function deckLayers(scene: DeckScene, pieces: DeckArtManifest["pieces"]): DeckLayer[] {
  const sorted: Array<{ layer: DeckLayer; row: number; rank: number; x: number }> = [];
  for (const prop of DECK_PROPS) sorted.push({ layer: { kind: "prop", ...prop }, row: prop.y, rank: 0, x: prop.x });
  for (const sailor of scene.sailors) sorted.push({ layer: { kind: "sailor", sailor }, row: sailor.y, rank: 0, x: sailor.x });
  for (const [name, piece] of Object.entries(pieces)) {
    sorted.push({ layer: { kind: "piece", name }, row: piece.baseline ?? Number.POSITIVE_INFINITY, rank: 1, x: piece.x });
  }
  sorted.sort((a, b) => a.row - b.row || a.rank - b.rank || a.x - b.x);
  return [{ kind: "ship" }, ...sorted.map((entry) => entry.layer)];
}

/**
 * Whether the screen offers the Deck at all: only when the daemon says the switch is on, only in a web
 * renderer (the desktop app), and only on the wide layout, where it takes the right-hand pane.
 */
export function deckOffered(fleet: FleetDeckSwitch | null, os: string, compact: boolean): boolean {
  return fleet?.shipDeck === true && os === "web" && !compact;
}
