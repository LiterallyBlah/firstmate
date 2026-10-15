/**
 * The deck's animated water (`art/ship-deck/water/README.md`): the generated sea, the foam at the hull's
 * waterline and the wake astern, served with the extras (`extras.json`'s `water`, `firstmate.deck.extras`).
 * Pure: which parts can be drawn, which frame each shows, how far the water has drifted, and where the wake
 * sits. The sprites are `client/deck-environment.ts`'s.
 *
 * - **Part by part.** The sea, the foam and the wake are drawn each only when every one of its frames decoded.
 *   A part left out leaves what it replaces: the environment's still tile, its foam strip, or the wake drawn
 *   in code (`client/deck-wake.ts`). None of them is drawn on the flat sea the deck falls back to without its
 *   environment, except the wake, which needs nothing of it.
 * - **The frames play in order**, `frameMs` each (240 ms), looping, while the sea drifts (`plan.ambient`).
 *   Under reduced motion and on a software renderer every part holds its first frame, the calm one.
 * - **The sea** is one tile for both bands, the far sea from the horizon and the near sea from the waterline,
 *   on the same frame, drift and tile origin (the horizon), so the near band's first row is the tile's 55th.
 * - **The foam** lies across the hull's waterline from its `top` (its row 9 on the waterline), repeating
 *   sideways only within its `span`, and drifting with the world as the environment's strip did.
 * - **The wake** is one sprite fixed at the stern, its `anchor` on the stern's water contact: the frames do
 *   the moving, the sprite never drifts. It opens aft and down, in front of the near sea and under the foam.
 *
 * **How lively the water is lives here**, in `WaterMotion`: how fast the frames play and how fast the sea
 * and foam drift, each a multiple of the art's own timing (`CALM_WATER` is the art as delivered). The deck's
 * weather (`client/deck-atmosphere.ts`) picks one by how busy the crew is and runs the water on its own
 * `WaterClock`, advanced at that motion (`advanceWater`), so a change of pace never jumps a frame or the drift.
 */
import type { DeckExtrasManifest } from "../shared/ship-deck";
import type { DeckExtrasImages } from "./deck-extras";

export type WaterManifest = NonNullable<DeckExtrasManifest["water"]>;

/** The water parts that can be drawn — each null where a frame of it did not decode — and the extras' decoded images. */
export interface DrawnWater {
  sea: WaterManifest["sea"] | null;
  foam: WaterManifest["foam"] | null;
  wake: WaterManifest["wake"] | null;
  images: ReadonlyMap<string, unknown>;
}

/** What of the extras' water can be drawn; null when none of it can. */
export function drawnWater(extras: DeckExtrasImages | null): DrawnWater | null {
  const water = extras?.manifest.water;
  if (water === undefined || extras === null) return null;
  const whole = <Part extends { frames: string[] }>(part: Part): Part | null => (part.frames.every((path) => extras.images.has(path)) ? part : null);
  const drawn = { sea: whole(water.sea), foam: whole(water.foam), wake: whole(water.wake), images: extras.images };
  return drawn.sea === null && drawn.foam === null && drawn.wake === null ? null : drawn;
}

/**
 * How lively the water is, against the art's own timing: `pace` multiplies how fast every part's frames play
 * (1 is `frameMs`), `drift` how fast the sea and the foam slide sideways (1 is their `xPixelsPerSecond`).
 */
export interface WaterMotion {
  pace: number;
  drift: number;
}

/** The water as the art delivers it. */
export const CALM_WATER: WaterMotion = { pace: 1, drift: 1 };

/**
 * The water's own clock, in seconds of the art's timing: how far its frames have played (`frames`) and how far
 * the sea and the foam have drifted (`drift`). At `CALM_WATER` both keep step with the scene's clock.
 */
export interface WaterClock {
  frames: number;
  drift: number;
}

/** The water's clock `seconds` on at `motion`. */
export function advanceWater(clock: WaterClock, seconds: number, motion: WaterMotion): WaterClock {
  const step = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return { frames: clock.frames + step * Math.max(0, motion.pace), drift: clock.drift + step * Math.max(0, motion.drift) };
}

/** Which of a part's frames shows `seconds` into the scene: in order while the water `moving`, the first while it is still. */
export function waterFrame(seconds: number, part: { frames: readonly unknown[]; frameMs: number }, moving: boolean, motion: WaterMotion = CALM_WATER): number {
  const count = part.frames.length;
  if (!moving || count <= 1 || !Number.isFinite(seconds) || !(motion.pace > 0)) return 0;
  const step = Math.floor((seconds * 1000 * motion.pace) / part.frameMs) % count;
  return step < 0 ? step + count : step;
}

/** How fast a part drifts sideways, pixels a second, at `motion`. */
export function waterDrift(part: { xPixelsPerSecond: number }, motion: WaterMotion = CALM_WATER): number {
  return part.xPixelsPerSecond * Math.max(0, motion.drift);
}

/** Where the wake's sprite has its upper left: its anchor on the stern's water contact. */
export function wakeTopLeft(wake: WaterManifest["wake"]): { x: number; y: number } {
  return { x: wake.position[0] - wake.anchor[0], y: wake.position[1] - wake.anchor[1] };
}
