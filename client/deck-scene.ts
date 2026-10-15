/**
 * The ship deck's scene: the board's own cards turned into sailors on one deck, sent by state. Pure.
 *
 * The deck draws nothing the board does not already know. It reads the cards `firstmate.fleet.load`
 * already filed into columns — the same query the board, the panels and the sidebar share — so a
 * sailor goes where its card's column says, and the column rules stay in `server/fleet.ts`.
 *
 * Four states, from the column, each sent to its zone by the setting (`zones.byState`, read by
 * `client/deck-stage.ts`) — on the ship:
 *
 * - **working** — Working, hauling at the stations amidships, round the mast and the stores;
 * - **waiting** — Ready (finished, waiting on the first mate) and Working with the `waiting` note (a
 *   wait on a job outside the worker), arms folded by the helm on the quarterdeck;
 * - **blocked** — Blocked and Failed, fretting in the bow;
 * - **idle** — Idle and Parked, resting off the working deck: on the foredeck by the hatch, and from
 *   the seventh sleeper at the foot of the quarterdeck stairs too.
 *
 * Only live crew stand on deck: a local crewmate Paseo has not closed, or a remote worker that is
 * crew, not a followed session. Queued and Done cards, and cards with no worker, are left off. A card
 * that leaves the deck says why (`departureOf`: done, failed or closed; a card gone from the board is
 * removed), and `client/deck-plank.ts` decides from that how its sailor goes.
 *
 * The scene says only what each sailor is doing, and who it is: its `caption`, what the deck shows
 * when the pointer is over it (`sailorCaption`). Where it stands, and its walk there, are
 * `client/deck-crew.ts`'s.
 *
 * **Coordinates are the setting's.** The deck is the stage's own logical pixels (the ship's backdrop,
 * 426 × 161: the bow on the left, the quarterdeck and helm on the right). A sailor's `x, y`
 * is where its feet are. **Depth is the deck row**: `depthOf` orders props, sailors and the hull's own
 * depth pieces (the mast, bollards, the near rail) by the row each stands on, every frame, so a sailor
 * walking behind the mast is hidden by it and one passing in front of it covers it.
 */
import type { PluginTheme } from "@getpaseo/plugin";

import type { FleetCard } from "../shared/fleet";
import type { Figure } from "./deck-crew";
import type { DeckDeparture } from "./deck-plank";
import { cardHeadline } from "./format";

export const DECK_STATES = ["working", "waiting", "blocked", "idle"] as const;
export type DeckState = (typeof DECK_STATES)[number];

export interface DeckPalette {
  sea: string;
  states: Record<DeckState, string>;
  /** The reply marker's dots: the theme's accent, no state's colour. */
  ask: string;
}

/**
 * Who a sailor is, for the label the deck shows over it on hover: the card's title, its state in the
 * board's words, where it works, and the one line its card shows at rest.
 */
export interface SailorCaption {
  title: string;
  /** The column's word and, where the column alone does not say it, why: "Ready · finished, waiting on the first mate". */
  status: string;
  project: string | null;
  /** "This machine", or the remote host's label. */
  host: string;
  /** The card's line at rest (`cardHeadline`): "Captain's call: …", a status line, an error. */
  line: string | null;
  /** Why the sailor is greyed, or null while its feed is live. */
  stale: string | null;
}

/** One live crewmate on deck: what it is doing and who it is, never where it stands. */
export interface DeckSailor {
  /** The card's key, so a sailor keeps its identity across polls. */
  key: string;
  label: string;
  state: DeckState;
  /**
   * Whose look it wears: its agent's id (a remote worker's host and id), so the same crewmate looks the
   * same from poll to poll and from one opening of the deck to the next. `client/deck-crew.ts` dresses it.
   */
  identity: string;
  /**
   * Its feed is lost — the fleet load failing, or its remote host unreachable. It keeps its last state
   * and its place, greyed; it never reads as idle.
   */
  stale: boolean;
  caption: SailorCaption;
  /**
   * Replies wait for the captain over it: first mate's suggestions that name its crewmate
   * (`client/deck-replies.ts`), so it wears the reply marker and speaks them in a bubble. Never while stale.
   */
  asks?: boolean;
}

export interface DeckScene {
  palette: DeckPalette;
  sailors: DeckSailor[];
  /** Why each card on the board but not on deck is not, by card key: how a sailor that was there leaves. */
  departures: Record<string, DeckDeparture>;
  counts: Record<DeckState, number>;
  /** How many of the sailors are stale. */
  stale: number;
}

/** Whether a card has a live crew worker behind it. */
export function hasLiveWorker(card: FleetCard): boolean {
  if (card.agent !== null) return card.agent.status !== "closed";
  const worker = card.remote?.worker ?? null;
  return worker !== null && !worker.followed && worker.status !== "closed";
}

/** What a card's sailor is doing on deck, or null for a card that is not on deck. */
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

/** Why a card's sailor is not on deck: its work done, failed, or its worker closed (or never there). */
export function departureOf(card: FleetCard): DeckDeparture {
  if (card.column === "done") return "done";
  if (card.column === "failed") return "failed";
  return "closed";
}

/** The longest the hover label's line runs before it is cut with an ellipsis. */
export const CAPTION_LINE_MAX = 160;

/** What a card's column means for a sailor on deck, in the board's words. */
function captionStatus(card: FleetCard): string {
  switch (card.column) {
    case "working":
      return card.note === "waiting" ? "Working · waiting on a job it started" : "Working";
    case "ready":
      return "Ready · finished, waiting on the first mate";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "idle":
      return card.note === "stalled" ? "Idle · stalled: said working, then stopped" : "Idle · its turn ended with no status line";
    case "parked":
      return "Parked · paused";
    case "queued":
      return "Queued";
    case "done":
      return "Done";
  }
}

/** Who a card's sailor is, for its hover label. `feedStale` is the whole fleet load failing. */
export function sailorCaption(card: FleetCard, options: { feedStale?: boolean } = {}): SailorCaption {
  const headline = cardHeadline(card);
  let line: string | null = null;
  if (headline !== null) {
    const flat = (headline.lead === null ? headline.text : `${headline.lead}: ${headline.text}`).replace(/\s+/g, " ").trim();
    line = flat === "" ? null : flat.length > CAPTION_LINE_MAX ? `${flat.slice(0, CAPTION_LINE_MAX - 1).trimEnd()}…` : flat;
  }
  const remote = card.remote ?? null;
  return {
    title: card.title,
    status: captionStatus(card),
    project: card.project,
    host: remote === null ? "This machine" : remote.host,
    line,
    stale:
      options.feedStale === true
        ? "Feed lost: shown where it last stood"
        : remote?.online === false
          ? `${remote.host} is out of reach: shown where it last stood`
          : null,
  };
}

/** Who a card's sailor is, for its look: the agent's id, a remote worker's host and id, or else the card's key. */
export function sailorIdentity(card: FleetCard): string {
  if (card.agent !== null) return card.agent.id;
  const remote = card.remote ?? null;
  if (remote?.worker != null) return `${remote.serverId ?? remote.host}:${remote.worker.id}`;
  return card.key;
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
    ask: colors.accent,
  };
}

/**
 * The deck for these cards: one sailor per live crew worker, in card-key order within its state.
 * `feedStale` — the fleet load failing — greys the whole crew; a remote host that cannot be reached
 * greys its own workers. `asking` names the cards with replies waiting for the captain.
 */
export function deckScene(
  cards: readonly FleetCard[],
  theme: PluginTheme,
  options: { feedStale?: boolean; asking?: ReadonlySet<string> } = {},
): DeckScene {
  const byState = new Map<DeckState, FleetCard[]>(DECK_STATES.map((state) => [state, []]));
  const departures: Record<string, DeckDeparture> = {};
  for (const card of cards) {
    const state = deckState(card);
    if (state !== null) byState.get(state)?.push(card);
    else departures[card.key] = departureOf(card);
  }
  const sailors: DeckSailor[] = [];
  const counts = Object.fromEntries(DECK_STATES.map((state) => [state, 0])) as Record<DeckState, number>;
  for (const state of DECK_STATES) {
    const crew = [...(byState.get(state) ?? [])].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    counts[state] = crew.length;
    for (const card of crew) {
      const stale = options.feedStale === true || card.remote?.online === false;
      sailors.push({
        key: card.key,
        label: card.title,
        state,
        identity: sailorIdentity(card),
        stale,
        caption: sailorCaption(card, options),
        ...(options.asking?.has(card.key) === true && !stale ? { asks: true } : {}),
      });
    }
  }
  return {
    palette: deckPalette(theme),
    sailors,
    departures,
    counts,
    stale: sailors.filter((sailor) => sailor.stale).length,
  };
}

/**
 * A depth for something standing on `row`: what is further back (a smaller row) is drawn first, and a
 * hull piece (`rank` 1) after anything else on its own row, so a sailor's feet on the mast's row are
 * behind the mast. `null` is the near rail, in front of everything. The renderer sets it as each
 * sprite's `zIndex` every frame, so a walking sailor passes behind the mast and then in front of it.
 */
export function depthOf(row: number | null, rank: 0 | 1): number {
  return row === null ? 1_000_000 : Math.round(row) * 2 + rank;
}

export type DeckLayer =
  | { kind: "ship" }
  | { kind: "piece"; name: string }
  | { kind: "prop"; name: string; x: number; y: number }
  | { kind: "sailor"; figure: Figure };

/**
 * Everything on deck in the order it is drawn, back to front: the hull, then props, sailors and the
 * hull's depth pieces by `depthOf`, and last the near rail. Ties go left to right.
 */
export function deckLayers(
  figures: readonly Figure[],
  pieces: ReadonlyArray<{ id: string; x: number; baseline: number | null }>,
  props: ReadonlyArray<{ id: string; x: number; y: number }>,
): DeckLayer[] {
  const sorted: Array<{ layer: DeckLayer; depth: number; x: number }> = [];
  for (const prop of props) sorted.push({ layer: { kind: "prop", name: prop.id, x: prop.x, y: prop.y }, depth: depthOf(prop.y, 0), x: prop.x });
  for (const figure of figures) sorted.push({ layer: { kind: "sailor", figure }, depth: depthOf(figure.row, 0), x: figure.x });
  for (const piece of pieces) sorted.push({ layer: { kind: "piece", name: piece.id }, depth: depthOf(piece.baseline, 1), x: piece.x });
  sorted.sort((a, b) => a.depth - b.depth || a.x - b.x);
  return [{ kind: "ship" }, ...sorted.map((entry) => entry.layer)];
}

/**
 * Whether the screen offers the Deck: in a web renderer (the desktop app), on the wide layout, where it
 * takes the right-hand pane. Not on a phone or in a narrow window; a renderer without WebGL is offered it
 * and says in words why it cannot draw (`deckStatusText`).
 */
export function deckOffered(os: string, compact: boolean): boolean {
  return os === "web" && !compact;
}
