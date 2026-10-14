/**
 * The deck's day and night, and the rest of the generated environment's arithmetic, as pure functions:
 * which sky shows at a local time of day, where the sky sits behind the ship, how far the sea and the
 * foam have scrolled, and which pose the gull is in. No Pixi and no browser globals; the clock is handed
 * in, so the tests pick any hour (`client/deck-sky.test.ts`). `client/deck-environment.ts` draws it.
 *
 * **The sky follows the machine's own clock.** `art/ship-deck/environment.json` gives each of its six
 * backdrops a local wall-clock minute — dawn 05:30, morning 08:00, midday 12:00, afternoon 16:00, dusk
 * 18:30, night 21:00 — and from that minute that sky shows alone, until the last `SKY_FADE_MINUTES`
 * before the next anchor, when the next is drawn over it, eased in (`skyBlend`); round through midnight
 * from night to dawn. So night holds until 04:00 and is dawn by 05:30, dusk is full at 18:30 and gives way
 * to night from 19:30. (The manifest suggests fading across the whole gap; across the eight and a half
 * hours from night to dawn that would show half a dawn at a quarter past one.) The stars fade with the
 * night's share of what shows. These are the manifest's illustrative hours, not the
 * sun's: no location or season is read. A clock that will not say (an invalid date) shows midday.
 */
import type { DeckEnvironmentManifest, GullPose } from "../shared/ship-deck";
import { HORIZON } from "./deck-ambient";
import { DECK_WIDTH } from "./deck-scene";

export const MINUTES_PER_DAY = 1440;
/** How long one sky takes to become the next, ending at the next one's anchor: an hour and a half, or the whole gap if shorter. */
export const SKY_FADE_MINUTES = 90;

/** The local minute of the day, with seconds as a fraction, or null when the clock gives no real time. */
export function localMinute(now: Date): number | null {
  const time = now.getTime();
  if (!Number.isFinite(time)) return null;
  return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
}

/** Which two skies show and how: `from` drawn whole, `to` over it at opacity `t`, the stars at `stars`. */
export interface SkyBlend {
  /** Index into the manifest's phases of the sky drawn whole. */
  from: number;
  /** Index of the sky drawn over it. */
  to: number;
  /** The upper sky's opacity, 0 to 1. */
  t: number;
  /** The stars' opacity: the night's share of what shows, 0 to 1. */
  stars: number;
}

/** Eased so a fade starts and ends gently: the change is slowest at each anchor. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The sky at `minute` past local midnight (null: the clock will not say). One phase alone from its own
 * anchor; over the last `SKY_FADE_MINUTES` before the next, the next over it, eased; after the last
 * anchor, round through midnight to the first. `phases` is the manifest's, in the order of the day.
 */
export function skyBlend(minute: number | null, phases: DeckEnvironmentManifest["sky"]["phases"]): SkyBlend {
  const count = phases.length;
  const night = phases.findIndex((phase) => phase.id === "night");
  const fallback = Math.max(0, phases.findIndex((phase) => phase.id === "midday"));
  if (count === 0) return { from: 0, to: 0, t: 0, stars: 0 };
  if (minute === null || !Number.isFinite(minute)) return { from: fallback, to: fallback, t: 0, stars: fallback === night ? 1 : 0 };
  const at = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  // The last phase at or before `at`, round through midnight: before the first anchor, it is the last.
  let from = count - 1;
  for (let index = 0; index < count; index += 1) if (phases[index]!.localMinute <= at) from = index;
  const to = (from + 1) % count;
  const start = phases[from]!.localMinute;
  const span = (phases[to]!.localMinute - start + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
  const fade = Math.min(span, SKY_FADE_MINUTES);
  const elapsed = (at - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const t = ease(Math.max(0, Math.min(1, (elapsed - (span - fade)) / fade)));
  const stars = (from === night ? 1 - t : 0) + (to === night ? t : 0);
  return { from, to, t, stars };
}

/** The phase that shows most at a blend: its id names the deck's sky for the live check. */
export function dominantPhase(blend: SkyBlend): number {
  return blend.t < 0.5 ? blend.from : blend.to;
}

/** How long the sky is left before it is looked at again when nothing else redraws the deck: a minute. */
export const SKY_REFRESH_MS = 60_000;

/**
 * Where the sky sits in the deck's coordinates: a backdrop of `size`, centred on the ship, its row
 * `horizonRow` on the sea's horizon, at the hull's own pixel scale — larger only when the part of the
 * world on screen, `visible`, would show past its edges. It is never tiled, so its clouds never repeat.
 */
export function skyPlacement(
  visible: { left: number; right: number; top: number },
  size: readonly [number, number],
  horizonRow: number,
): { x: number; y: number; scale: number } {
  const [width] = size;
  const centre = DECK_WIDTH / 2;
  const halfWide = Math.max(centre - visible.left, visible.right - centre, 0);
  const tall = Math.max(HORIZON - visible.top, 0);
  const scale = Math.max(1, (halfWide * 2) / width, horizonRow > 0 ? tall / horizonRow : 1);
  return { x: centre - (width * scale) / 2, y: HORIZON - horizonRow * scale, scale };
}

/**
 * The sky's row laid on the horizon. The backdrops run to their bottom edge with no horizon of their
 * own; the asset preview puts the sea over their lowest third, so the warm band just above that meets
 * the water, and so does this.
 */
export function skyHorizonRow(size: readonly [number, number]): number {
  return Math.round(size[1] * (2 / 3));
}

/** How far a strip repeating every `period` pixels has scrolled at `seconds`: whole pixels, 0 to period - 1. */
export function scrollOffset(seconds: number, pixelsPerSecond: number, period: number): number {
  if (period <= 0 || !Number.isFinite(seconds)) return 0;
  const offset = Math.floor(seconds * pixelsPerSecond) % period;
  return offset < 0 ? offset + period : offset;
}

/** The gull's pose `ageSeconds` into a flap: the manifest's sequence at its frame time, round and round. */
export function gullPose(ageSeconds: number, gull: Pick<DeckEnvironmentManifest["gull"], "sequence" | "frameMs">): GullPose {
  const step = Math.floor((Math.max(0, ageSeconds) * 1000) / gull.frameMs);
  return gull.sequence[step % gull.sequence.length] ?? "mid";
}
