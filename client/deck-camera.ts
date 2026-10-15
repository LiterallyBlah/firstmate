/**
 * The deck's camera: the exact fit (`fitDeck`), or a shot closed in on one sailor, and the eased way
 * between them. Pure — no Pixi, no DOM.
 *
 * Clicking a sailor focuses it (`nextFocus`): the camera zooms and pans until the sailor stands enlarged in
 * the part of the canvas the panel leaves free (`focusLayout`), the rest of the deck dims behind it, and the
 * pane shows that crewmate's card in a compact panel beside it. Esc, the panel's close button, or a click
 * anywhere but the focused sailor pulls the camera back out.
 *
 * A shot is how far in the camera is (`amount`, 0 the whole deck, 1 the sailor) and which deck point it
 * closes in on. `cameraFit` turns a shot into the world's scale and offset for the canvas as it is now, so a
 * resize mid-zoom or while focused re-fits from the pane's new size: the base fit is recomputed and the
 * focused sailor stays where the layout puts it. The scale grows geometrically with `amount` and the point
 * travels in a straight line on screen, so the zoom reads as one move, not a slide then a swell. At 0 the
 * point does not matter: any point gives the exact fit.
 */
import type { DeckBox, DeckFit } from "./deck-hover";

/** How long the zoom in or out takes, in milliseconds of the deck's clock. */
export const FOCUS_MS = 520;
/** The panel's width beside the sailor, and the room it keeps from the canvas's edges. */
export const FOCUS_PANEL_WIDTH = 300;
export const FOCUS_PANEL_MARGIN = 12;
/** The narrowest canvas that puts the panel beside the sailor; narrower, it docks under it. */
export const FOCUS_SIDE_MIN = 620;
/** The share of the canvas's height a docked panel may take; the sailor stands in the rest. */
export const FOCUS_DOCK_SHARE = 0.46;
/** The share of the free room's height the focused sailor fills, badge to feet. */
export const FOCUS_FILL = 0.34;
/** How far the camera closes in, as a multiple of the exact fit: never less, never more. */
export const FOCUS_ZOOM_MIN = 1.6;
export const FOCUS_ZOOM_MAX = 3;
/** How dark the deck behind a focused sailor goes, at the end of the zoom. */
export const FOCUS_VEIL_ALPHA = 0.55;

export interface DeckPoint {
  x: number;
  y: number;
}

/** How far in the camera is, 0 to 1, and the deck point it closes in on. */
export interface DeckShot {
  amount: number;
  point: DeckPoint;
}

export const WHOLE_DECK: DeckShot = { amount: 0, point: { x: 0, y: 0 } };

/**
 * Where the focus panel goes on a canvas of `size`, and the room it leaves for the sailor: beside it on the
 * right of a wide canvas, docked along the bottom of a narrow one. `anchor` is where the sailor's middle
 * lands, the middle of that room. The panel's placement is absolute within the canvas, so the pane and the
 * camera read the same rectangle.
 */
export interface FocusLayout {
  side: "right" | "bottom";
  panel: { left: number; top: number; width: number; maxHeight: number } | { left: number; right: number; bottom: number; maxHeight: number };
  room: { width: number; height: number };
  anchor: DeckPoint;
}

export function focusLayout(size: { width: number; height: number }): FocusLayout {
  const width = Math.max(0, size.width);
  const height = Math.max(0, size.height);
  const margin = FOCUS_PANEL_MARGIN;
  if (width >= FOCUS_SIDE_MIN) {
    const roomWidth = Math.max(0, width - FOCUS_PANEL_WIDTH - margin * 2);
    return {
      side: "right",
      panel: { left: width - FOCUS_PANEL_WIDTH - margin, top: margin, width: FOCUS_PANEL_WIDTH, maxHeight: Math.max(0, height - margin * 2) },
      room: { width: roomWidth, height },
      anchor: { x: roomWidth / 2 + margin, y: height / 2 },
    };
  }
  const panelHeight = Math.round(height * FOCUS_DOCK_SHARE);
  const roomHeight = Math.max(0, height - panelHeight - margin);
  return {
    side: "bottom",
    panel: { left: margin, right: margin, bottom: margin, maxHeight: Math.max(0, panelHeight - margin) },
    room: { width, height: roomHeight },
    anchor: { x: width / 2, y: roomHeight / 2 },
  };
}

/**
 * The scale of a shot closed in on a sailor `actorHeight` tall with its badge (the setting's `stage.actorHeight`):
 * it fills `FOCUS_FILL` of the free room's height, within the zoom's bounds.
 */
export function focusScale(base: DeckFit, layout: FocusLayout, actorHeight: number): number {
  if (base.scale <= 0) return 0;
  const wanted = (layout.room.height * FOCUS_FILL) / actorHeight;
  return Math.max(base.scale * FOCUS_ZOOM_MIN, Math.min(base.scale * FOCUS_ZOOM_MAX, wanted));
}

/**
 * The world's scale and offset for `shot`, from the exact fit `base` on a canvas laid out as `layout`, closing in on
 * a sailor `actorHeight` tall. The offset is snapped to whole device pixels at `resolution`, like the exact fit's.
 */
export function cameraFit(base: DeckFit, shot: DeckShot, layout: FocusLayout, resolution: number, actorHeight: number): DeckFit {
  const amount = Math.max(0, Math.min(1, shot.amount));
  if (amount === 0 || base.scale <= 0) return base;
  const scale = base.scale * Math.pow(focusScale(base, layout, actorHeight) / base.scale, amount);
  // Where the point is on screen: from where the exact fit draws it to the layout's anchor, in a line.
  const fromX = base.x + shot.point.x * base.scale;
  const fromY = base.y + shot.point.y * base.scale;
  const atX = fromX + (layout.anchor.x - fromX) * amount;
  const atY = fromY + (layout.anchor.y - fromY) * amount;
  const snap = (value: number) => Math.round(value * resolution) / resolution;
  return { scale, x: snap(atX - shot.point.x * scale), y: snap(atY - shot.point.y * scale) };
}

/** The part of the world a canvas of `size` shows at `fit`, in deck pixels. */
export function visibleWorld(fit: DeckFit, size: { width: number; height: number }): DeckBox {
  if (fit.scale <= 0) return { left: 0, top: 0, right: 0, bottom: 0 };
  return { left: -fit.x / fit.scale, top: -fit.y / fit.scale, right: (size.width - fit.x) / fit.scale, bottom: (size.height - fit.y) / fit.scale };
}

/** Eased in and out: a zoom that gathers, travels and settles. */
export function easeFocus(t: number): number {
  const at = Math.max(0, Math.min(1, t));
  return at < 0.5 ? 4 * at * at * at : 1 - Math.pow(-2 * at + 2, 3) / 2;
}

/**
 * The shot `t` of the way from `from` to `to`, eased. From the whole deck the point is the target's from the
 * start, so the camera closes straight in; back out, it stays on the sailor it leaves.
 */
export function shotBetween(from: DeckShot, to: DeckShot, t: number): DeckShot {
  const eased = easeFocus(t);
  const start = from.amount <= 0 ? to.point : from.point;
  const end = to.amount <= 0 ? start : to.point;
  return {
    amount: from.amount + (to.amount - from.amount) * eased,
    point: { x: start.x + (end.x - start.x) * eased, y: start.y + (end.y - start.y) * eased },
  };
}

/** The middle of a sailor's box, badge included: the point a shot closes in on. */
export function boxMiddle(box: DeckBox): DeckPoint {
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
}

/**
 * What a click on the canvas does to the focus: on the whole deck a sailor is focused; while one is focused,
 * a click on it keeps it, and a click anywhere else — open deck, sea, another sailor — lets it go.
 */
export function nextFocus(focused: string | null, clicked: string | null): string | null {
  if (focused === null) return clicked;
  return clicked === focused ? focused : null;
}

/**
 * The sailor an arrow key moves the focus to, through `keys` in the deck's order: the next or the previous,
 * round the end, from the one focused or last focused; the first (or last) when there is neither.
 */
export function stepFocus(keys: readonly string[], from: string | null, direction: 1 | -1): string | null {
  if (keys.length === 0) return null;
  const at = from === null ? -1 : keys.indexOf(from);
  if (at < 0) return direction === 1 ? keys[0]! : keys[keys.length - 1]!;
  return keys[(at + direction + keys.length) % keys.length]!;
}
