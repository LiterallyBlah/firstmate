/**
 * Each state's badge: a small pixel sign over a sailor's head, the same sign in the legend below the
 * canvas, so a state reads at a glance and not only by where the sailor stands. Pure.
 *
 * The poses alone did not tell the states apart: the art has one frame each for hauling, leaning and
 * waiting, and a blocked sailor stands in the plain front pose, so an idle sailor at the rail and a
 * blocked one in the bow were two figures standing still. The badge is drawn, not art — a pixel artist's
 * moving state poses (a haul cycle, a doze, a pacing fret) would carry it better, and the badge would
 * then be the backup it is for a reader who cannot tell the poses apart.
 *
 * - **working** — a play sign: running;
 * - **waiting** — an hourglass: Ready, and a wait on a job outside the worker;
 * - **blocked** — an exclamation mark: Blocked and Failed;
 * - **idle** — a Z, and under motion a small z drifting up off the sailor now and then: dozing.
 *
 * A badge is a 7 × 7 sign in the state's colour, its 5 × 5 glyph inked dark or light by the colour's
 * lightness (`badgeInk`), with a one-pixel tail pointing at the head.
 */
import type { DeckState } from "./deck-scene";

/** Each state's glyph: five rows of five, `#` inked. */
export const BADGE_GLYPHS: Record<DeckState, readonly string[]> = {
  working: ["#....", "###..", "#####", "###..", "#...."],
  waiting: ["#####", ".#.#.", "..#..", ".#.#.", "#####"],
  blocked: ["..#..", "..#..", "..#..", ".....", "..#.."],
  idle: ["#####", "...#.", "..#..", ".#...", "#####"],
};

/** The sign's size in art pixels, its tail included. */
export const BADGE_SIZE = { width: 7, height: 8 };

/** Gap between the top of a sailor's head and the tip of its badge's tail. */
export const BADGE_GAP = 1;

export interface BadgePixel {
  x: number;
  y: number;
  kind: "sign" | "ink";
}

/**
 * The badge's pixels, from its top left: the sign (a 7 × 7 square without its corners, and a tail
 * pixel under its middle) and the glyph's ink over it.
 */
export function badgePixels(state: DeckState): BadgePixel[] {
  const pixels: BadgePixel[] = [];
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const corner = (x === 0 || x === 6) && (y === 0 || y === 6);
      if (!corner) pixels.push({ x, y, kind: "sign" });
    }
  }
  pixels.push({ x: 3, y: 7, kind: "sign" });
  BADGE_GLYPHS[state].forEach(function (row, y) {
    for (let x = 0; x < row.length; x += 1) if (row[x] === "#") pixels.push({ x: x + 1, y: y + 1, kind: "ink" });
  });
  return pixels;
}

/** A `#rrggbb` colour as a number; a colour it cannot read is the deck's muted grey. */
export function hexColour(colour: string): number {
  const match = /^#?([0-9a-f]{6})/i.exec(colour);
  return match === null ? 0xa1a5a4 : parseInt(match[1]!, 16);
}

export const INK_DARK = 0x16191a;
export const INK_LIGHT = 0xf7f8f8;

/** The glyph's ink on a sign of `colour`: dark on a light sign, light on a dark one. */
export function badgeInk(colour: string): number {
  const value = hexColour(colour);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  // Where black and white tie for contrast against the sign.
  return luminance > 0.179 ? INK_DARK : INK_LIGHT;
}

/** The small z an idle sailor breathes out: three by three. */
export const DOZE_GLYPH: readonly string[] = ["###", ".#.", "###"];
/** One z every this long, a little out of step per sailor; it rises for `DOZE_RISE_MS` of it. */
export const DOZE_PERIOD_MS = 3200;
export const DOZE_RISE_MS = 2000;

/**
 * Where an idle sailor's z is at `nowMs`, relative to its badge's top right, or null between them:
 * it rises six pixels, drifting a pixel aft, and fades.
 */
export function dozeAt(seed: number, nowMs: number): { dx: number; dy: number; alpha: number } | null {
  const at = (nowMs + seed * 53) % DOZE_PERIOD_MS;
  if (at >= DOZE_RISE_MS) return null;
  const t = at / DOZE_RISE_MS;
  return { dx: Math.round(t * 2), dy: -Math.round(t * 6), alpha: Math.round((1 - t) * 100) / 100 };
}
