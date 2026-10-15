/**
 * Which sailor the pointer is over, and where its label goes. Pure — no Pixi, no DOM.
 *
 * The canvas draws the crew; the label is React's (`client/ship-deck.tsx`), laid over the canvas, so its
 * text is the app's own type at the app's own size rather than pixel text scaled with the deck.
 * `client/deck-pixi.ts` turns pointer events into deck coordinates with the same fit and bob the frame
 * was drawn with, asks `sailorAt` who is there, and reports `DeckHover` — the sailor's key and where its
 * head and feet are on screen — whenever the sailor or its place on screen changes.
 *
 * A sailor is hit by the box its sprite is drawn in this frame, its badge (and reply marker) above it included, and the
 * frontmost wins: the same order the deck draws in, so the sailor you see is the sailor you get.
 *
 * A sailor in a zone with a label floor (the setting's `labelFloor`: on the ship, the rest areas) has its label
 * hang from that row, under the near rail, rather than over its head: the rest areas pack sleepers close, and a
 * label over one would cover the others' badges and the crew at work beside them.
 */
import type { DeckArtManifest } from "./deck-legacy";
import { ASK_GAP, ASK_SIZE, BADGE_GAP, BADGE_SIZE } from "./deck-badges";
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
   * For a sailor in a zone with a label floor, the canvas row its label may hang from instead: on the ship, just
   * under the near rail, where no sailor ever stands, so the label covers no one. Null for the others.
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

/** Whether a figure shows its reply marker: replies waiting, its badge showing, and its feed live. */
export function showsAsk(figure: Figure): boolean {
  return figure.asks === true && !figure.stale && showsBadge(figure);
}

/** A sailor's badge, in deck pixels: where it is drawn, its tail included. */
export function badgeBox(figure: Figure, manifest: DeckArtManifest): DeckBox {
  const top = badgeTop(figure, manifest);
  const left = figure.x - Math.floor(BADGE_SIZE.width / 2);
  return { left, top, right: left + BADGE_SIZE.width, bottom: top + BADGE_SIZE.height };
}

/**
 * Where a sailor's reply marker is drawn this frame (`askMarks`): its top left in deck pixels, and mirrored
 * when it hangs on the badge's left, so its tail still points at the badge. `framed` is the fallback when no
 * place round the badge is clear: the marker is drawn on the badge itself, as a paper frame round its sign.
 */
export interface AskMark {
  left: number;
  top: number;
  flip: boolean;
  framed: boolean;
}

export function markBox(mark: AskMark): DeckBox {
  return mark.framed
    ? { left: mark.left, top: mark.top, right: mark.left + BADGE_SIZE.width, bottom: mark.top + BADGE_SIZE.height }
    : { left: mark.left, top: mark.top, right: mark.left + ASK_SIZE.width, bottom: mark.top + ASK_SIZE.height };
}

/** Whether two boxes share a pixel. */
export function boxesOverlap(a: DeckBox, b: DeckBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Every reply marker's place this frame, by sailor key. The frontmost sailor chooses first, from over its
 * badge, then beside it on the right, then on the left, raised so the tail points at the badge: the first
 * place that covers no other sailor (badge included) and no marker already placed. On a deck crowded past
 * that — sleepers packed a badge apart, a full place's spots three rows apart — the marker is the badge's
 * frame instead, which takes no room the badge did not, so a marker never covers another sailor's state.
 */
export function askMarks(figures: readonly Figure[], manifest: DeckArtManifest): Map<string, AskMark> {
  const marks = new Map<string, AskMark>();
  const asking = figures.filter(showsAsk);
  if (asking.length === 0) return marks;
  const others = figures
    .filter((figure) => !figure.departing)
    .map((figure) => ({ key: figure.key, box: figureBox(figure, manifest) }))
    .filter((each): each is { key: string; box: DeckBox } => each.box !== null);
  const placed: DeckBox[] = [];
  asking.sort((a, b) => depthOf(b.row, 0) + b.x / 10000 - (depthOf(a.row, 0) + a.x / 10000));
  for (const figure of asking) {
    const badge = badgeBox(figure, manifest);
    const raised = badge.top - Math.ceil(ASK_SIZE.height / 2);
    const candidates: AskMark[] = [
      { left: figure.x - Math.floor(ASK_SIZE.width / 2), top: badge.top - ASK_GAP - ASK_SIZE.height, flip: false, framed: false },
      { left: badge.right, top: raised, flip: false, framed: false },
      { left: badge.left - ASK_SIZE.width, top: raised, flip: true, framed: false },
    ];
    const clear = candidates.find(function (mark) {
      const box = markBox(mark);
      return !placed.some((other) => boxesOverlap(other, box)) && !others.some((other) => other.key !== figure.key && boxesOverlap(other.box, box));
    });
    const mark = clear ?? { left: badge.left, top: badge.top, flip: false, framed: true };
    placed.push(markBox(mark));
    marks.set(figure.key, mark);
  }
  return marks;
}

/**
 * A sailor's box on deck this frame, in deck pixels, its badge included, and its reply marker when it wears
 * one (`mark`); null while under the hatch.
 */
export function figureBox(figure: Figure, manifest: DeckArtManifest, mark?: AskMark): DeckBox | null {
  const standing = manifest.crew[figure.outfit][figure.pose];
  const [, , width, height] = standing.frame;
  const rows = Math.round(height * figure.reveal);
  if (rows <= 0) return null;
  // Mirrored, the sprite turns about its feet.
  const left = figure.x - (figure.flip ? width - standing.feet[0] : standing.feet[0]);
  if (rows < height) return { left, top: figure.y - rows, right: left + width, bottom: figure.y };
  const top = figure.y - standing.feet[1];
  const box = {
    left: Math.min(left, figure.x - 4),
    top: badgeTop(figure, manifest),
    right: Math.max(left + width, figure.x + 4),
    bottom: top + height,
  };
  if (mark === undefined) return box;
  const marker = markBox(mark);
  return { left: Math.min(box.left, marker.left), top: Math.min(box.top, marker.top), right: Math.max(box.right, marker.right), bottom: box.bottom };
}

/** The canvas point `(x, y)` in deck pixels. */
export function toDeck(point: { x: number; y: number }, fit: DeckFit, bob: DeckOffset): { x: number; y: number } {
  return { x: (point.x - fit.x) / fit.scale - bob.x, y: (point.y - fit.y) / fit.scale - bob.y };
}

/** The deck point `(x, y)` on the canvas. */
export function toCanvas(point: { x: number; y: number }, fit: DeckFit, bob: DeckOffset): { x: number; y: number } {
  return { x: fit.x + (point.x + bob.x) * fit.scale, y: fit.y + (point.y + bob.y) * fit.scale };
}

/**
 * The sailor at deck point `point`, frontmost first, or null. One on its way out (`departing`) has no card to
 * show. A reply marker (`marks`) is its sailor's, wherever it hangs.
 */
export function sailorAt(
  figures: readonly Figure[],
  manifest: DeckArtManifest,
  point: { x: number; y: number },
  marks?: ReadonlyMap<string, AskMark>,
): Figure | null {
  let best: Figure | null = null;
  let bestDepth = -Infinity;
  for (const figure of figures) {
    if (figure.departing) continue;
    const box = figureBox(figure, manifest, marks?.get(figure.key));
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

/**
 * What the canvas reports for `figure`: where its badge (or its reply marker, `mark`, over it) and feet are on the
 * canvas, and the canvas row of `labelFloor` (its zone's, in stage rows) when it has one.
 */
export function hoverOf(
  figure: Figure,
  manifest: DeckArtManifest,
  fit: DeckFit,
  bob: DeckOffset,
  canvas: { width: number; height: number },
  labelFloor: number | null,
  mark?: AskMark,
): DeckHover {
  const box = figureBox(figure, manifest, mark);
  const top = toCanvas({ x: figure.x, y: box?.top ?? figure.y }, fit, bob);
  const feet = toCanvas({ x: figure.x, y: figure.row }, fit, bob);
  const floor = labelFloor === null ? null : toCanvas({ x: figure.x, y: labelFloor }, fit, bob).y;
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
