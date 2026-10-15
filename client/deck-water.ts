/**
 * How lively the water is (`WaterMotion`), and its own clock (`WaterClock`): how fast the frames play and the water
 * drifts, each a multiple of the art's own timing (`CALM_WATER` is the art as delivered). The deck's weather
 * (`client/deck-atmosphere.ts`) picks one by how busy the crew is and runs the water on its own clock, advanced at that
 * motion (`advanceWater`), so a change of pace never jumps a frame or the drift. The pack's tiles, strips and cycles
 * name the clock they play on (`water-frames`, `water-drift`); `client/deck-environment.ts` draws them.
 */

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
