/**
 * Which sailor the pointer is over, and where its label goes. Pure — no Pixi, no DOM.
 *
 * The canvas draws the crew; the label is React's (`client/ship-deck.tsx`), laid over the canvas, so its
 * text is the app's own type at the app's own size rather than pixel text scaled with the deck.
 * `client/deck-pixi.ts` turns pointer events into deck coordinates with the same fit and bob the frame
 * was drawn with, asks `sailorAt` who is there, and reports `DeckHover` — the sailor's key and where its
 * head and feet are on screen — whenever the sailor or its place on screen changes.
 *
 * A sailor is hit by the box its sprite is drawn in this frame, its badge above it included, and the
 * frontmost wins: the same order the deck draws in, so the sailor you see is the sailor you get.
 *
 * A resting sailor's label hangs under the near rail rather than over its head (`REST_LABEL_ROW`): the
 * rest areas pack sleepers close, and a label over one would cover the others' badges and the crew at
 * work beside them.
 */
import type { DeckArtManifest } from "../shared/ship-deck";
import { BADGE_GAP, BADGE_SIZE } from "./deck-badges";
import type { Figure } from "./deck-crew";
import { depthOf } from "./deck-scene";

/** How the deck sits on the canvas: `world`'s scale and offset (`fitDeck`), in CSS pixels. */
export interface DeckFit {
  scale: number;
  x: number;
  y: number;
}

/** The ship's bob this frame, in deck pixels. */
export interface DeckOffset {
  x: number;
  y: number;
}

export interface DeckBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the canvas reports while the pointer is over a sailor: its key, and where it is on the canvas. */
export interface DeckHover {
  key: string;
  /** The sailor's middle, across. */
  x: number;
  /** The top of its badge, or of its head while it has none. */
  top: number;
  /** Its feet. */
  bottom: number;
  /** The canvas's size, for placing the label inside it. */
  width: number;
  height: number;
  /**
   * For a sailor at rest, the canvas row its label may hang from instead: just under the near rail
   * (`REST_LABEL_ROW`), where no sailor ever stands, so the label covers no one. Null for the others.
   */
  floor: number | null;
}

/** Where a sailor's badge goes: its top, in deck pixels from the feet's row, for a sprite drawn at `figure`. */
export function badgeTop(figure: Figure, manifest: DeckArtManifest): number {
  const standing = manifest.crew[figure.outfit][figure.pose];
  return figure.y - standing.feet[1] - BADGE_GAP - BADGE_SIZE.height;
}

/** Whether a figure shows its badge: once it is out of the hatch, and until it leaves the crew. */
export function showsBadge(figure: Figure): boolean {
  return figure.reveal >= 1 && !figure.departing;
}

/** A sailor's box on deck this frame, in deck pixels, its badge included; null while under the hatch. */
export function figureBox(figure: Figure, manifest: DeckArtManifest): DeckBox | null {
  const standing = manifest.crew[figure.outfit][figure.pose];
  const [, , width, height] = standing.frame;
  const rows = Math.round(height * figure.reveal);
  if (rows <= 0) return null;
  // Mirrored, the sprite turns about its feet.
  const left = figure.x - (figure.flip ? width - standing.feet[0] : standing.feet[0]);
  if (rows < height) return { left, top: figure.y - rows, right: left + width, bottom: figure.y };
  const top = figure.y - standing.feet[1];
  return {
    left: Math.min(left, figure.x - 4),
    top: badgeTop(figure, manifest),
    right: Math.max(left + width, figure.x + 4),
    bottom: top + height,
  };
}

/** The canvas point `(x, y)` in deck pixels. */
export function toDeck(point: { x: number; y: number }, fit: DeckFit, bob: DeckOffset): { x: number; y: number } {
  return { x: (point.x - fit.x) / fit.scale - bob.x, y: (point.y - fit.y) / fit.scale - bob.y };
}

/** The deck point `(x, y)` on the canvas. */
export function toCanvas(point: { x: number; y: number }, fit: DeckFit, bob: DeckOffset): { x: number; y: number } {
  return { x: fit.x + (point.x + bob.x) * fit.scale, y: fit.y + (point.y + bob.y) * fit.scale };
}

/** The sailor at deck point `point`, frontmost first, or null. One on its way out (`departing`) has no card to show. */
export function sailorAt(figures: readonly Figure[], manifest: DeckArtManifest, point: { x: number; y: number }): Figure | null {
  let best: Figure | null = null;
  let bestDepth = -Infinity;
  for (const figure of figures) {
    if (figure.departing) continue;
    const box = figureBox(figure, manifest);
    if (box === null) continue;
    if (point.x < box.left || point.x >= box.right || point.y < box.top || point.y >= box.bottom) continue;
    const depth = depthOf(figure.row, 0) + figure.x / 10000;
    if (depth > bestDepth) {
      best = figure;
      bestDepth = depth;
    }
  }
  return best;
}

/** What the canvas reports for `figure`: where its badge and feet are on the canvas. */
export function hoverOf(figure: Figure, manifest: DeckArtManifest, fit: DeckFit, bob: DeckOffset, canvas: { width: number; height: number }): DeckHover {
  const box = figureBox(figure, manifest);
  const top = toCanvas({ x: figure.x, y: box?.top ?? figure.y }, fit, bob);
  const feet = toCanvas({ x: figure.x, y: figure.row }, fit, bob);
  const floor = figure.state === "idle" ? toCanvas({ x: figure.x, y: REST_LABEL_ROW }, fit, bob).y : null;
  return { key: figure.key, x: top.x, top: top.y, bottom: feet.y, width: canvas.width, height: canvas.height, floor };
}

/**
 * Whether a new report says anything new: another sailor, or the same one moved by more than a pixel
 * or two. Idle motion moves a sailor a pixel to and fro; the label does not need to follow that.
 */
export function hoverChanged(previous: DeckHover | null, next: DeckHover | null): boolean {
  if (previous === null || next === null) return previous !== next;
  if (previous.key !== next.key || previous.width !== next.width || previous.height !== next.height) return true;
  if ((previous.floor === null) !== (next.floor === null)) return true;
  return (
    Math.abs(previous.x - next.x) > 2 ||
    Math.abs(previous.top - next.top) > 2 ||
    Math.abs(previous.bottom - next.bottom) > 2 ||
    Math.abs((previous.floor ?? 0) - (next.floor ?? 0)) > 2
  );
}

/** The label's widest, and the room it keeps from the canvas's edges and from the sailor. */
export const LABEL_WIDTH = 260;
export const LABEL_MARGIN = 8;
export const LABEL_GAP = 6;
/** The room above a sailor the label needs before it goes above rather than below. */
export const LABEL_ROOM = 120;

/**
 * The deck row a resting sailor's label hangs from: a row under the near rail's top along the rest
 * areas and under every sailor's feet (the walkable deck ends at row 119), so a label hung there covers
 * the hull's side and nothing on deck — not the sleepers packed round the one hovered, not the crew at
 * work beside them, not the sail, the mast or another sailor's badge.
 */
export const REST_LABEL_ROW = 122;

/**
 * Where the label sits on the canvas: for a sailor at rest, under the near rail when the canvas has room
 * for it there; otherwise above the sailor's badge when there is room, else below its feet. Centred on
 * the sailor across, but never past the canvas's edges. Given as `bottom` above, so its height need not
 * be measured.
 */
export function labelPlacement(hover: DeckHover): { left: number; width: number; top?: number; bottom?: number } {
  const width = Math.max(120, Math.min(LABEL_WIDTH, hover.width - LABEL_MARGIN * 2));
  const left = Math.round(Math.max(LABEL_MARGIN, Math.min(hover.x - width / 2, hover.width - width - LABEL_MARGIN)));
  if (hover.floor !== null && hover.height - hover.floor - LABEL_GAP - LABEL_MARGIN >= LABEL_ROOM) {
    return { left, width, top: Math.round(hover.floor + LABEL_GAP) };
  }
  if (hover.top >= LABEL_ROOM) return { left, width, bottom: Math.round(hover.height - hover.top + LABEL_GAP) };
  return { left, width, top: Math.round(hover.bottom + LABEL_GAP) };
}
