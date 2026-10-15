/**
 * The deck's weather by how busy the crew is (`client/deck-atmosphere.ts`): what counts as work, the table and
 * its interpolation, the easing, the clocks that let a pace change without a jump, and the still deck's calm.
 * The parts it drives — the sail's billow, the bob and the sway — are checked here too; the deck drawing with it
 * is `client/deck-environment.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import {
  ACTIVITY_WEIGHTS,
  compileAtmosphere,
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
import { bobAt, dutyFrame, swayAt } from "./deck-parts";
import type { DeckState } from "./deck-scene";
import { hexColour } from "./deck-clouds";
import { shipElement, shipManifest } from "../test/ship-pack";

const ship = compileAtmosphere(shipManifest());
const ATMOSPHERE = shipManifest().atmosphere!.table;

const crew = (...states: DeckState[]) => states.map((state) => ({ state, stale: false }));
const working = (count: number) => crew(...Array.from({ length: count }, () => "working" as const));

/** Runs the weather `seconds` on at 30 frames a second towards `target`. */
function run(state: Atmosphere, seconds: number, target: number, moving = true): Atmosphere {
  let next = state;
  for (let frame = 0; frame < Math.round(seconds * 30); frame += 1) next = stepAtmosphere(ship, next, 1000 / 30, target, moving);
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
      for (const key of ["wind", "sail", "billow", "swell", "heave", "wake", "mood"] as const) expect(high[key]).toBeGreaterThanOrEqual(low[key]!);
      expect(high.pace!).toBeGreaterThan(low.pace!);
      expect(high.drift!).toBeGreaterThan(low.drift!);
    }
  });

  it("is glassy at idle, the art as delivered with two crewmates working, and spirited — not a storm — at the top", () => {
    const idle = atmosphereAt(ship, 0);
    expect(idle.pace!).toBeLessThan(1);
    expect(idle.drift!).toBeLessThan(1);
    expect(idle.wake!).toBeLessThan(1);
    expect(idle.mood!).toBe(0);
    const two = atmosphereAt(ship, crewIntensity(working(2)));
    expect([two.pace!, two.drift!]).toEqual([1, 1]);
    expect([two.wind!, two.sail!, two.billow!, two.swell!, two.heave!, two.mood!]).toEqual([1, 1, 0.5, 1, 1.2, 0]);
    const busy = atmosphereAt(ship, 1);
    expect(busy.pace!).toBeGreaterThan(1.5);
    expect(busy.wind!).toBeGreaterThan(2);
    expect(busy.sail!).toBeGreaterThan(2);
    // A pixel more of bob at the top of a swell, never two; the sail still rests a third of the time.
    expect(busy.heave!).toBeLessThan(2.5);
    expect(busy.billow!).toBeLessThan(0.7);
  });

  it("interpolates between rows and clamps past either end", () => {
    const [low, mid] = [ATMOSPHERE[0]!, ATMOSPHERE[1]!];
    const half = atmosphereAt(ship, (low.at + mid.at) / 2);
    expect(half.wind!).toBeCloseTo((low.wind! + mid.wind!) / 2);
    expect(half.pace!).toBeCloseTo((low.pace! + mid.pace!) / 2);
    expect(atmosphereAt(ship, -3)).toEqual(atmosphereAt(ship, 0));
    expect(atmosphereAt(ship, 7)).toEqual(atmosphereAt(ship, 1));
    expect(atmosphereAt(ship, Number.NaN)).toEqual(atmosphereAt(ship, 0));
  });
});

describe("the weather over time", () => {
  it("opens in the crew's weather, every clock at the start", () => {
    expect(openingAtmosphere(ship, 0.5)).toEqual({ intensity: 0.5, clocks: { "water-frames": 0, "water-drift": 0, wind: 0, sail: 0, swell: 0 } });
    expect(openingAtmosphere(ship).intensity).toBe(0);
    expect(openingAtmosphere(ship, 4).intensity).toBe(1);
  });

  it("eases towards the crew's, never snapping: most of the way in a few seconds, there within a quarter of a minute", () => {
    let state = openingAtmosphere(ship, 0);
    state = stepAtmosphere(ship, state, 1000 / 30, 1, true);
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
    let state = openingAtmosphere(ship, 0);
    const busy = atmosphereAt(ship, 1);
    for (let frame = 0; frame < 1800; frame += 1) {
      const target = frame < 600 ? 0 : frame < 1200 ? 1 : 0;
      const next = stepAtmosphere(ship, state, 1000 / 30, target, true);
      const step = 1 / 30;
      expect(next.clocks["water-frames"]! - state.clocks["water-frames"]!).toBeGreaterThan(0);
      expect(next.clocks["water-frames"]! - state.clocks["water-frames"]!).toBeLessThanOrEqual(step * busy.pace! + 1e-9);
      expect(next.clocks["water-drift"]! - state.clocks["water-drift"]!).toBeLessThanOrEqual(step * busy.drift! + 1e-9);
      expect(next.clocks.wind! - state.clocks.wind!).toBeLessThanOrEqual(step * busy.wind! + 1e-9);
      expect(next.clocks.sail! - state.clocks.sail!).toBeLessThanOrEqual(step * busy.sail! + 1e-9);
      expect(next.clocks.swell! - state.clocks.swell!).toBeLessThanOrEqual(step * busy.swell! + 1e-9);
      state = next;
    }
    // At idle the water runs at half the art's pace: a minute of idle is half a minute of its frames.
    const idle = run(openingAtmosphere(ship, 0), 60, 0);
    expect(idle.clocks["water-frames"]!).toBeCloseTo(60 * atmosphereAt(ship, 0).pace!, 6);
    // With two crewmates working the clocks keep the scene's time.
    const two = crewIntensity(working(2));
    const steady = run(openingAtmosphere(ship, two), 60, two);
    expect(steady.clocks["water-frames"]!).toBeCloseTo(60, 6);
    expect(steady.clocks.wind!).toBeCloseTo(60, 6);
  });

  it("is still under reduced motion: clocks stand, the crew's intensity taken at once and unseen", () => {
    const state = run(openingAtmosphere(ship, 0), 2, 1);
    const still = stepAtmosphere(ship, state, 1000, 0.2, false);
    expect(still.intensity).toBe(0.2);
    expect(still.clocks).toBe(state.clocks);
  });

  it("hands the deck its clocks, its wake, mood, billow and heave and the intensity its layers follow; the art's own weather, with no layers, when none is given", () => {
    const state = run(openingAtmosphere(ship, 1), 2, 1);
    expect(weatherOf(ship, state)).toEqual({ clocks: state.clocks, channels: atmosphereAt(ship, 1), intensity: state.intensity });
    expect(deliveredWeather(ship, 12)).toEqual({
      clocks: { "water-frames": 12, "water-drift": 12, wind: 12, sail: 12, swell: 12 },
      channels: shipManifest().atmosphere!.delivered,
      intensity: null,
    });
  });
});

describe("the sky's mood", () => {
  const tint = shipElement("sky", "backdrop-cycle").tint!;
  const shade_ = hexColour(tint.to);
  const moodTint = (mood: number) => tintToward(shade_, levelAt(tint.amount, { ...deliveredWeather(ship, 0), channels: { mood } }));

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
  const weather = { ...deliveredWeather(ship, 7), channels: { wake: 0.6, mood: 0.25 }, intensity: 0.5 };

  it("reads a number as it is, a channel times its scale, and a curve at the intensity — nothing on a still deck", () => {
    expect(levelAt(3, weather)).toBe(3);
    expect(levelAt({ channel: "wake" }, weather)).toBe(0.6);
    expect(levelAt({ channel: "mood", scale: 2 }, weather)).toBe(0.5);
    expect(levelAt({ channel: "nothing" }, weather)).toBe(0);
    expect(levelAt({ curve: [[0, 0], [1, 1]] }, weather)).toBe(0.5);
    expect(levelAt({ curve: [[0, 0.4]] }, deliveredWeather(ship, 7))).toBe(0);
  });

  it("reads the water's, the wind's, the sail's, the swell's, or the scene's own clock; the billow and the heave", () => {
    const clocked = { ...weather, clocks: { "water-frames": 1, "water-drift": 2, wind: 3, sail: 4, swell: 5 }, channels: { billow: 0.6, heave: 1.4 } };
    expect(["water-frames", "water-drift", "wind", "sail", "swell", "other"].map((clock) => clockOf(clocked, clock, 9))).toEqual([1, 2, 3, 4, 5, 9]);
    expect([levelAt({ channel: "billow" }, clocked), levelAt({ channel: "heave" }, clocked)]).toEqual([0.6, 1.4]);
  });
});

describe("what the weather drives", () => {
  it("holds the sail out longer in a fresher wind, and evenly by default", () => {
    const sail = { count: 2, frameMs: 850 };
    const share = (billow?: number) => {
      let out = 0;
      for (let ms = 0; ms < 1700; ms += 10) out += dutyFrame(ms / 1000, sail, true, billow);
      return out / 170;
    };
    expect(share()).toBeCloseTo(0.5, 2);
    expect(share(0.5)).toBeCloseTo(0.5, 2);
    expect(share(0.65)).toBeCloseTo(0.65, 2);
    expect(dutyFrame(0.5, sail, false, 0.9)).toBe(0);
    // Three frames: the first for the rest of the cycle, the others sharing its duty evenly.
    const three = [0, 0.4, 0.7, 0.95].map((turn) => dutyFrame((turn * 3 * 100) / 1000, { count: 3, frameMs: 100 }, true, 0.5));
    expect(three).toEqual([0, 0, 1, 2]);
  });

  it("bobs the ship a pixel more at the top of a livelier swell, the masthead still a pixel each way", () => {
    const bobs = (heave: number) => new Set(Array.from({ length: 620 }, (_, tenth) => bobAt(tenth / 100, 6.2, heave)));
    expect([...bobs(1.2)].sort()).toEqual([-1, 0, 1]);
    expect([...bobs(atmosphereAt(ship, 1).heave!)].sort()).toEqual([-1, -2, 0, 1, 2].sort());
    const sway = { periodS: 6.2, phase: -1, limit: 1 };
    for (let tenth = 0; tenth < 620; tenth += 1) expect(Math.abs(swayAt(tenth / 100, sway, atmosphereAt(ship, 1).heave! * 1.3))).toBeLessThanOrEqual(1);
  });
});

describe("any setting's atmosphere", () => {
  const definition = compileAtmosphere({
    atmosphere: {
      table: [{ at: 0.2, speed: 2, glow: -1 }, { at: 0.8, speed: 4, glow: 1 }],
      delivered: { speed: 0.5, glow: 0.25 },
      clocks: { conveyor: "speed", fan: "speed" },
    },
  });

  it("interpolates arbitrary channels linearly and holds the end values", () => {
    const halfway = atmosphereAt(definition, 0.5);
    expect(halfway.speed).toBeCloseTo(3);
    expect(halfway.glow).toBeCloseTo(0);
    expect(atmosphereAt(definition, -1)).toEqual({ speed: 2, glow: -1 });
    expect(atmosphereAt(definition, 2)).toEqual({ speed: 4, glow: 1 });
    expect(atmosphereAt(definition, Number.NaN)).toEqual({ speed: 2, glow: -1 });
  });

  it("runs two named clocks on one channel, preserving their phases across a pace change", () => {
    const opening = openingAtmosphere(definition, 0.2);
    const first = stepAtmosphere(definition, opening, 500, 0.2, true);
    expect(first.clocks).toEqual({ conveyor: 1, fan: 1 });
    const changed = stepAtmosphere(definition, first, 500, 0.8, true);
    expect(changed.clocks.conveyor).toBeGreaterThan(2);
    expect(changed.clocks.conveyor).toBeLessThan(3);
    expect(changed.clocks.fan).toBe(changed.clocks.conveyor);
    expect(opening.clocks).toEqual({ conveyor: 0, fan: 0 });
    expect(levelAt({ channel: "glow", scale: 2 }, weatherOf(definition, first))).toBe(-2);
  });

  it("uses this pack's delivered channels and rates, disabling intensity layers", () => {
    const calm = deliveredWeather(definition, 8);
    expect(calm).toEqual({ clocks: { conveyor: 4, fan: 4 }, channels: { speed: 0.5, glow: 0.25 }, intensity: null });
    expect(levelAt({ channel: "glow" }, calm)).toBe(0.25);
    expect(levelAt({ curve: [[0, 1], [1, 1]] }, calm)).toBe(0);
    expect(clockOf(calm, "conveyor", 8)).toBe(4);
    expect(clockOf(calm, undefined, 8)).toBe(8);
    expect(clockOf(calm, "constructor", 8)).toBe(8);
    expect(levelAt({ channel: "constructor" }, calm)).toBe(0);
  });

  it("supports a single row, a stopped clock, invalid elapsed time, and resuming a still deck", () => {
    const constant = compileAtmosphere({ atmosphere: { table: [{ at: 0.5, speed: -2 }], clocks: { fan: "speed" }, delivered: { speed: 0 } } });
    expect(atmosphereAt(constant, 1)).toEqual({ speed: -2 });
    expect(stepAtmosphere(constant, openingAtmosphere(constant), 1000, 1, true).clocks.fan).toBe(0);
    const first = stepAtmosphere(definition, openingAtmosphere(definition, 0.2), 500, 0.2, true);
    for (const ms of [0, -1, Number.NaN, Infinity]) expect(stepAtmosphere(definition, first, ms, 1, true)).toEqual(first);
    const still = stepAtmosphere(definition, first, 60000, 0.8, false);
    expect(still.clocks).toBe(first.clocks);
    expect(still.intensity).toBe(0.8);
    expect(stepAtmosphere(definition, still, 500, 0.8, true).clocks).toEqual({ conveyor: 3, fan: 3 });
  });

  it("supports a pack without atmosphere, without inheriting the last pack's channels or clocks", () => {
    const empty = compileAtmosphere({});
    expect(atmosphereAt(empty, 1)).toEqual({});
    expect(weatherOf(empty, stepAtmosphere(empty, openingAtmosphere(empty, 1), 1000, 1, true))).toEqual({ clocks: {}, channels: {}, intensity: 1 });
    expect(deliveredWeather(empty, 8)).toEqual({ clocks: {}, channels: {}, intensity: null });
    expect(openingAtmosphere(definition).clocks).toEqual({ conveyor: 0, fan: 0 });
  });
});
