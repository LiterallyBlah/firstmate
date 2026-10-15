/**
 * The deck's weather by how busy the crew is (`client/deck-atmosphere.ts`): what counts as work, the table and
 * its interpolation, the easing, the clocks that let a pace change without a jump, and the still deck's calm.
 * The parts it drives — the sail's billow, the bob, the code wake — are checked here too; the deck drawing with it
 * is `client/deck-environment.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import { HEAVE, mastSway, shipBob } from "./deck-ambient";
import {
  ACTIVITY_WEIGHTS,
  ATMOSPHERE,
  atmosphereAt,
  BUSY_CREW,
  crewIntensity,
  deliveredWeather,
  clockOf,
  EASE_SECONDS,
  levelAt,
  openingAtmosphere,
  shade,
  stepAtmosphere,
  tintToward,
  weatherOf,
  type Atmosphere,
} from "./deck-atmosphere";
import { sailFrame } from "./deck-extras";
import type { DeckState } from "./deck-scene";
import { CHURN_LENGTH, STERN, wakeRuns } from "./deck-wake";
import { advanceWater, CALM_WATER, waterFrame } from "./deck-water";
import { hexColour } from "./deck-clouds";
import { shipElement } from "../test/ship-pack";

const crew = (...states: DeckState[]) => states.map((state) => ({ state, stale: false }));
const working = (count: number) => crew(...Array.from({ length: count }, () => "working" as const));

/** Runs the weather `seconds` on at 30 frames a second towards `target`. */
function run(state: Atmosphere, seconds: number, target: number, moving = true): Atmosphere {
  let next = state;
  for (let frame = 0; frame < Math.round(seconds * 30); frame += 1) next = stepAtmosphere(next, 1000 / 30, target, moving);
  return next;
}

describe("how busy the crew is", () => {
  it("counts work in progress: working fully, waiting a little, blocked and idle not at all", () => {
    expect(ACTIVITY_WEIGHTS).toEqual({ working: 1, waiting: 0.25, blocked: 0, idle: 0 });
    expect(crewIntensity([])).toBe(0);
    expect(crewIntensity(crew("idle", "idle", "blocked", "idle"))).toBe(0);
    expect(crewIntensity(working(1))).toBeCloseTo(1 / BUSY_CREW);
    expect(crewIntensity(crew("waiting", "waiting", "waiting", "waiting"))).toBeCloseTo(1 / BUSY_CREW);
    expect(crewIntensity(crew("working", "idle", "blocked", "waiting"))).toBeCloseTo(1.25 / BUSY_CREW);
  });

  it("does not count a crewmate whose feed is lost: greyed is not working", () => {
    expect(crewIntensity([{ state: "working", stale: true }, ...working(1)])).toBeCloseTo(1 / BUSY_CREW);
  });

  it("tops out at a busy fleet, so a crowd is no stormier", () => {
    expect(crewIntensity(working(BUSY_CREW))).toBe(1);
    expect(crewIntensity(working(24))).toBe(1);
  });
});

describe("the weather table", () => {
  it("runs from calm to lively, every row in order", () => {
    expect(ATMOSPHERE[0]!.at).toBe(0);
    expect(ATMOSPHERE.at(-1)!.at).toBe(1);
    for (let index = 1; index < ATMOSPHERE.length; index += 1) {
      const [low, high] = [ATMOSPHERE[index - 1]!, ATMOSPHERE[index]!];
      expect(high.at).toBeGreaterThan(low.at);
      for (const key of ["wind", "sail", "billow", "swell", "heave", "wake", "mood"] as const) expect(high[key]).toBeGreaterThanOrEqual(low[key]);
      expect(high.water.pace).toBeGreaterThan(low.water.pace);
      expect(high.water.drift).toBeGreaterThan(low.water.drift);
    }
  });

  it("is glassy at idle, the art as delivered with two crewmates working, and spirited — not a storm — at the top", () => {
    const idle = atmosphereAt(0);
    expect(idle.water.pace).toBeLessThan(1);
    expect(idle.water.drift).toBeLessThan(1);
    expect(idle.wake).toBeLessThan(1);
    expect(idle.mood).toBe(0);
    const two = atmosphereAt(crewIntensity(working(2)));
    expect(two.water).toEqual(CALM_WATER);
    expect([two.wind, two.sail, two.billow, two.swell, two.heave, two.mood]).toEqual([1, 1, 0.5, 1, HEAVE, 0]);
    const busy = atmosphereAt(1);
    expect(busy.water.pace).toBeGreaterThan(1.5);
    expect(busy.wind).toBeGreaterThan(2);
    expect(busy.sail).toBeGreaterThan(2);
    // A pixel more of bob at the top of a swell, never two; the sail still rests a third of the time.
    expect(busy.heave).toBeLessThan(2.5);
    expect(busy.billow).toBeLessThan(0.7);
  });

  it("interpolates between rows and clamps past either end", () => {
    const [low, mid] = [ATMOSPHERE[0]!, ATMOSPHERE[1]!];
    const half = atmosphereAt((low.at + mid.at) / 2);
    expect(half.wind).toBeCloseTo((low.wind + mid.wind) / 2);
    expect(half.water.pace).toBeCloseTo((low.water.pace + mid.water.pace) / 2);
    expect(atmosphereAt(-3)).toEqual(atmosphereAt(0));
    expect(atmosphereAt(7)).toEqual(atmosphereAt(1));
    expect(atmosphereAt(Number.NaN)).toEqual(atmosphereAt(0));
  });
});

describe("the weather over time", () => {
  it("opens in the crew's weather, every clock at the start", () => {
    expect(openingAtmosphere(0.5)).toEqual({ intensity: 0.5, water: { frames: 0, drift: 0 }, wind: 0, sail: 0, swell: 0 });
    expect(openingAtmosphere().intensity).toBe(0);
    expect(openingAtmosphere(4).intensity).toBe(1);
  });

  it("eases towards the crew's, never snapping: most of the way in a few seconds, there within a quarter of a minute", () => {
    let state = openingAtmosphere(0);
    state = stepAtmosphere(state, 1000 / 30, 1, true);
    expect(state.intensity).toBeGreaterThan(0);
    expect(state.intensity).toBeLessThan(0.05);
    state = run(state, EASE_SECONDS, 1);
    expect(state.intensity).toBeGreaterThan(0.6);
    expect(state.intensity).toBeLessThan(0.7);
    state = run(state, 15, 1);
    expect(state.intensity).toBeGreaterThan(0.99);
    // And back down when the crew finishes, as gently.
    const calming = run(state, 1, 0);
    expect(calming.intensity).toBeGreaterThan(0.6);
  });

  it("advances each clock at its pace, so a change of pace never jumps a frame back or forward", () => {
    // A minute that turns from idle to busy and back: every clock only ever moves on, by at most a frame's worth at the top pace.
    let state = openingAtmosphere(0);
    const busy = atmosphereAt(1);
    for (let frame = 0; frame < 1800; frame += 1) {
      const target = frame < 600 ? 0 : frame < 1200 ? 1 : 0;
      const next = stepAtmosphere(state, 1000 / 30, target, true);
      const step = 1 / 30;
      expect(next.water.frames - state.water.frames).toBeGreaterThan(0);
      expect(next.water.frames - state.water.frames).toBeLessThanOrEqual(step * busy.water.pace + 1e-9);
      expect(next.water.drift - state.water.drift).toBeLessThanOrEqual(step * busy.water.drift + 1e-9);
      expect(next.wind - state.wind).toBeLessThanOrEqual(step * busy.wind + 1e-9);
      expect(next.sail - state.sail).toBeLessThanOrEqual(step * busy.sail + 1e-9);
      expect(next.swell - state.swell).toBeLessThanOrEqual(step * busy.swell + 1e-9);
      state = next;
    }
    // At idle the water runs at half the art's pace: a minute of idle is half a minute of its frames.
    const idle = run(openingAtmosphere(0), 60, 0);
    expect(idle.water.frames).toBeCloseTo(60 * atmosphereAt(0).water.pace, 6);
    // With two crewmates working the clocks keep the scene's time.
    const two = crewIntensity(working(2));
    const steady = run(openingAtmosphere(two), 60, two);
    expect(steady.water.frames).toBeCloseTo(60, 6);
    expect(steady.wind).toBeCloseTo(60, 6);
  });

  it("is still under reduced motion: clocks stand, the crew's intensity taken at once and unseen", () => {
    const state = run(openingAtmosphere(0), 2, 1);
    const still = stepAtmosphere(state, 1000, 0.2, false);
    expect(still.intensity).toBe(0.2);
    expect([still.water, still.wind, still.sail, still.swell]).toEqual([state.water, state.wind, state.sail, state.swell]);
  });

  it("hands the scenery its clocks, its wake, its mood and the intensity its layers follow; the art's own weather, with no layers, when none is given", () => {
    const state = run(openingAtmosphere(1), 2, 1);
    expect(weatherOf(state)).toEqual({ water: state.water, wind: state.wind, wake: atmosphereAt(1).wake, mood: atmosphereAt(1).mood, intensity: state.intensity });
    expect(deliveredWeather(12)).toEqual({ water: { frames: 12, drift: 12 }, wind: 12, wake: 1, mood: 0, intensity: null });
  });
});

describe("the sky's mood", () => {
  const tint = shipElement("sky", "backdrop-cycle").tint!;
  const shade_ = hexColour(tint.to);
  const moodTint = (mood: number) => tintToward(shade_, levelAt(tint.amount, { ...deliveredWeather(0), mood }));

  it("is untinted when calm and a shade greyer, never dark, at its fullest: the ship's sky by the mood channel", () => {
    expect(tint.amount).toEqual({ channel: "mood" });
    expect(moodTint(0)).toBe(0xffffff);
    expect(moodTint(1)).toBe(shade_);
    expect(moodTint(9)).toBe(shade_);
    for (const shift of [16, 8, 0]) expect((shade_ >> shift) & 0xff).toBeGreaterThan(0xc8);
    const half = moodTint(0.5);
    expect(half).toBeLessThan(0xffffff);
    expect(half).toBeGreaterThan(shade_);
  });

  it("shades a colour as Pixi's tint does, channel by channel", () => {
    expect(shade(0xa8b9bd, 0xffffff)).toBe(0xa8b9bd);
    expect(shade(0xffffff, shade_)).toBe(shade_);
    expect(shade(0x804020, 0x808080)).toBe(0x402010);
  });
});

describe("a pack's levels and clocks, read off the weather", () => {
  const weather = { ...deliveredWeather(7), wake: 0.6, mood: 0.25, intensity: 0.5 };

  it("reads a number as it is, a channel times its scale, and a curve at the intensity — nothing on a still deck", () => {
    expect(levelAt(3, weather)).toBe(3);
    expect(levelAt({ channel: "wake" }, weather)).toBe(0.6);
    expect(levelAt({ channel: "mood", scale: 2 }, weather)).toBe(0.5);
    expect(levelAt({ channel: "nothing" }, weather)).toBe(0);
    expect(levelAt({ curve: [[0, 0], [1, 1]] }, weather)).toBe(0.5);
    expect(levelAt({ curve: [[0, 0.4]] }, deliveredWeather(7))).toBe(0);
  });

  it("reads the water's, the wind's, or the scene's own clock", () => {
    const clocked = { ...weather, water: { frames: 1, drift: 2 }, wind: 3 };
    expect(["water-frames", "water-drift", "wind", "other"].map((clock) => clockOf(clocked, clock, 9))).toEqual([1, 2, 3, 9]);
  });
});

describe("what the weather drives", () => {
  it("plays the water on its own clock at its pace", () => {
    const clock = advanceWater({ frames: 1, drift: 2 }, 0.5, { pace: 2, drift: 3 });
    expect(clock).toEqual({ frames: 2, drift: 3.5 });
    expect(advanceWater(clock, -1, CALM_WATER)).toEqual(clock);
    expect(advanceWater(clock, Number.NaN, CALM_WATER)).toEqual(clock);
    const sea = { frames: [0, 1, 2, 3], frameMs: 240 };
    expect(waterFrame(advanceWater({ frames: 0, drift: 0 }, 0.24, { pace: 2, drift: 1 }).frames, sea, true)).toBe(2);
  });

  it("holds the sail out longer in a fresher wind, and evenly by default", () => {
    const sail = { frames: 2, frameMs: 850 };
    const share = (billow?: number) => {
      let out = 0;
      for (let ms = 0; ms < 1700; ms += 10) out += sailFrame(ms / 1000, sail, true, billow);
      return out / 170;
    };
    expect(share()).toBeCloseTo(0.5, 2);
    expect(share(0.5)).toBeCloseTo(0.5, 2);
    expect(share(0.65)).toBeCloseTo(0.65, 2);
    expect(sailFrame(0.5, sail, false, 0.9)).toBe(0);
  });

  it("bobs the ship a pixel more at the top of a livelier swell, the masthead still a pixel each way", () => {
    const bobs = (heave: number) => new Set(Array.from({ length: 620 }, (_, tenth) => shipBob(tenth / 100, heave).y));
    expect([...bobs(HEAVE)].sort()).toEqual([-1, 0, 1]);
    expect([...bobs(atmosphereAt(1).heave)].sort()).toEqual([-1, -2, 0, 1, 2].sort());
    expect(shipBob(1.3)).toEqual(shipBob(1.3, HEAVE));
    for (let tenth = 0; tenth < 620; tenth += 1) expect(Math.abs(mastSway(tenth / 100, atmosphereAt(1).heave))).toBeLessThanOrEqual(1);
  });

  it("runs the code wake shorter in a calm and all of it at full strength", () => {
    const reach = { right: 1000, bottom: 1000 };
    const furthest = (strength: number) =>
      Math.max(
        ...wakeRuns(0, reach, strength)
          .filter((run) => run.y <= STERN.y + 3)
          .map((run) => run.x + run.width),
      );
    expect(wakeRuns(0, reach)).toEqual(wakeRuns(0, reach, 1));
    expect(furthest(1)).toBeGreaterThan(furthest(0.55));
    expect(furthest(0.55)).toBeLessThanOrEqual(STERN.x + Math.round(CHURN_LENGTH * 0.55) + 1);
  });
});
