/**
 * The deck's day and night, and the backdrop's and the scroll's arithmetic, as pure functions: which of a
 * setting's day phases shows at a local time of day, where a backdrop sits behind the stage, and how far a
 * repeating strip has scrolled. No Pixi and no browser globals; the clock is handed in, so the tests pick any
 * hour (`client/deck-sky.test.ts`). `client/deck-environment.ts` draws it.
 *
 * **The day follows the machine's own clock.** A pack's `dayCycle` gives each phase a local wall-clock minute —
 * the ship's: dawn 05:30, morning 08:00, midday 12:00, afternoon 16:00, dusk 18:30, night 21:00 — and from that
 * minute that phase shows alone, until the last `fadeMinutes` before the next anchor, when the next is drawn over
 * it, eased in (`dayBlend`); round through midnight from the last phase to the first. So the ship's night holds
 * until 04:00 and is dawn by 05:30, dusk is full at 18:30 and gives way to night from 19:30. (Fading across the
 * whole gap would show half a dawn at a quarter past one.) The night's share of what shows is the stars' opacity,
 * and keeps a flyby home. These are illustrative hours, not the sun's: no location or season is read. A clock that
 * will not say (an invalid date) shows the cycle's `fallback`.
 */
import type { DayCycle } from "./deck-ambience";

export const MINUTES_PER_DAY = 1440;

/** The local minute of the day, with seconds as a fraction, or null when the clock gives no real time. */
export function localMinute(now: Date): number | null {
  const time = now.getTime();
  if (!Number.isFinite(time)) return null;
  return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
}

/** Which two phases show and how: `from` drawn whole, `to` over it at opacity `t`, and the night's share of it. */
export interface DayBlend {
  /** Index into the cycle's phases of the phase drawn whole. */
  from: number;
  /** Index of the phase drawn over it. */
  to: number;
  /** The upper phase's opacity, 0 to 1. */
  t: number;
  /** The night's share of what shows, 0 to 1: the stars' opacity. */
  night: number;
}

/** The blend without a day: the first phase, whole, no night. */
export const NO_DAY: DayBlend = { from: 0, to: 0, t: 0, night: 0 };

/** Eased so a fade starts and ends gently: the change is slowest at each anchor. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The day at `minute` past local midnight (null: the clock will not say). One phase alone from its own anchor;
 * over the last `fadeMinutes` before the next, the next over it, eased; after the last anchor, round through
 * midnight to the first.
 */
export function dayBlend(minute: number | null, cycle: Pick<DayCycle, "phases" | "fadeMinutes" | "night" | "fallback">): DayBlend {
  const { phases } = cycle;
  const count = phases.length;
  const night = phases.findIndex((phase) => phase.id === cycle.night);
  const fallback = Math.max(0, phases.findIndex((phase) => phase.id === cycle.fallback));
  if (count === 0) return NO_DAY;
  if (minute === null || !Number.isFinite(minute)) return { from: fallback, to: fallback, t: 0, night: fallback === night ? 1 : 0 };
  const at = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  // The last phase at or before `at`, round through midnight: before the first anchor, it is the last.
  let from = count - 1;
  for (let index = 0; index < count; index += 1) if (phases[index]!.localMinute <= at) from = index;
  const to = (from + 1) % count;
  const start = phases[from]!.localMinute;
  const span = (phases[to]!.localMinute - start + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
  const fade = Math.min(span, cycle.fadeMinutes);
  const elapsed = (at - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const t = ease(Math.max(0, Math.min(1, (elapsed - (span - fade)) / fade)));
  const share = (from === night ? 1 - t : 0) + (to === night ? t : 0);
  return { from, to, t, night: share };
}

/** The phase that shows most at a blend: its id names the deck's sky for the live check. */
export function dominantPhase(blend: DayBlend): number {
  return blend.t < 0.5 ? blend.from : blend.to;
}

/** How long the sky is left before it is looked at again when nothing else redraws the deck: a minute. */
export const SKY_REFRESH_MS = 60_000;

/** A backdrop's place in the stage's coordinates: its upper left, and its scale. */
export interface Placement {
  x: number;
  y: number;
  scale: number;
}

/**
 * Where a backdrop sits in the stage's coordinates: one of `size`, centred on a stage `stageWidth` wide, its row
 * `placement.horizonRow` on the stage's row `placement.stageRow`, at the stage's own pixel scale — larger only when
 * the part of the world on screen, `visible`, would show past its edges. It is never tiled, so what drifts across
 * it never repeats.
 */
export function backdropPlacement(
  visible: { left: number; right: number; top: number },
  size: readonly [number, number],
  placement: { horizonRow: number; stageRow: number },
  stageWidth: number,
): Placement {
  const [width] = size;
  const { horizonRow, stageRow } = placement;
  const centre = stageWidth / 2;
  const halfWide = Math.max(centre - visible.left, visible.right - centre, 0);
  const tall = Math.max(stageRow - visible.top, 0);
  const scale = Math.max(1, (halfWide * 2) / width, horizonRow > 0 ? tall / horizonRow : 1);
  return { x: centre - (width * scale) / 2, y: stageRow - horizonRow * scale, scale };
}

/** How far a strip repeating every `period` pixels has scrolled at `seconds`: whole pixels, 0 to period - 1. */
export function scrollOffset(seconds: number, pixelsPerSecond: number, period: number): number {
  if (period <= 0 || !Number.isFinite(seconds)) return 0;
  const offset = Math.floor(seconds * pixelsPerSecond) % period;
  return offset < 0 ? offset + period : offset;
}
