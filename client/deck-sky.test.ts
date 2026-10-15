/**
 * The deck's day and night: which of the generated skies shows at a local time of day, with the clock
 * handed in; how smoothly one becomes the next; where the sky sits behind the ship; and the sea's,
 * foam's and gull's timing — all against the ship pack's own (`art/settings/ship/setting.json`).
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import { SKY_PHASES, type DeckEnvironmentManifest } from "./deck-legacy";
import { shipManifest, shipStage, shipViews } from "../test/ship-pack";
import { HORIZON } from "./deck-ambient";
import { FOAM_HEIGHT, FOAM_SPAN, foamSegments } from "./deck-environment";
import {
  dominantPhase,
  gullPose,
  localMinute,
  MINUTES_PER_DAY,
  scrollOffset,
  SKY_FADE_MINUTES,
  skyBlend,
  skyHorizonRow,
  skyPlacement,
  type SkyBlend,
} from "./deck-sky";

const manifest: DeckEnvironmentManifest = shipViews().environment;
const phases = manifest.sky.phases;
const phaseId = (blend: SkyBlend) => phases[dominantPhase(blend)]!.id;

/** A local wall-clock time on an ordinary day, whatever the machine's time zone. */
const at = (hours: number, minutes = 0, seconds = 0) => new Date(2026, 9, 14, hours, minutes, seconds);
const skyAt = (date: Date) => skyBlend(localMinute(date), phases);

/** How much of each phase shows in a blend: the lower whole, less what the upper covers. */
function weights(blend: SkyBlend): number[] {
  const shown = phases.map(() => 0);
  shown[blend.from]! += 1 - blend.t;
  shown[blend.to]! += blend.t;
  return shown;
}

describe("the sky by the local time of day", () => {
  it("reads the machine's local wall clock, seconds as a fraction, and nothing from a clock that will not say", () => {
    expect(localMinute(at(0, 0))).toBe(0);
    expect(localMinute(at(18, 30))).toBe(1110);
    expect(localMinute(at(6, 15, 30))).toBe(375.5);
    expect(localMinute(new Date(Number.NaN))).toBeNull();
  });

  it("shows each phase alone at its anchor: dawn 05:30, morning 08:00, midday 12:00, afternoon 16:00, dusk 18:30, night 21:00", () => {
    expect(phases.map((phase) => phase.id)).toEqual([...SKY_PHASES]);
    const anchors: Array<[Date, string]> = [
      [at(5, 30), "dawn"],
      [at(8, 0), "morning"],
      [at(12, 0), "midday"],
      [at(16, 0), "afternoon"],
      [at(18, 30), "dusk"],
      [at(21, 0), "night"],
    ];
    for (const [date, id] of anchors) {
      const blend = skyAt(date);
      expect(phases[blend.from]!.id, date.toTimeString()).toBe(id);
      expect(blend.t).toBe(0);
    }
  });

  it("picks the right phase through the day, round midnight from night to dawn", () => {
    const expected: Array<[number, number, string]> = [
      [0, 0, "night"],
      [3, 0, "night"],
      [4, 0, "night"],
      [5, 0, "dawn"],
      [6, 30, "dawn"],
      [7, 30, "morning"],
      [10, 0, "morning"],
      [11, 30, "midday"],
      [14, 30, "midday"],
      [15, 30, "afternoon"],
      [17, 0, "afternoon"],
      [18, 0, "dusk"],
      [19, 30, "dusk"],
      [20, 30, "night"],
      [23, 59, "night"],
    ];
    for (const [hours, minutes, id] of expected) expect(phaseId(skyAt(at(hours, minutes))), `${hours}:${minutes}`).toBe(id);
    // Past the last anchor, night holds through the small hours and fades into the first: dawn is coming in by five.
    expect(skyAt(at(1, 15)).t).toBe(0);
    const late = skyAt(at(5, 0));
    expect([phases[late.from]!.id, phases[late.to]!.id]).toEqual(["night", "dawn"]);
    expect(late.t).toBeGreaterThan(0.5);
  });

  it("holds each sky after its anchor, and fades to the next over the hour and a half before that one's", () => {
    for (const [index, phase] of phases.entries()) {
      const next = phases[(index + 1) % phases.length]!;
      const fadeFrom = (next.localMinute - SKY_FADE_MINUTES + MINUTES_PER_DAY) % MINUTES_PER_DAY;
      const held = skyBlend(fadeFrom, phases);
      expect([phases[held.from]!.id, held.t], phase.id).toEqual([phase.id, 0]);
      const halfway = skyBlend((fadeFrom + SKY_FADE_MINUTES / 2) % MINUTES_PER_DAY, phases);
      expect([phases[halfway.from]!.id, phases[halfway.to]!.id], phase.id).toEqual([phase.id, next.id]);
      expect(halfway.t).toBeCloseTo(0.5);
    }
  });

  it("blends between two neighbours only, eased, and never jumps as the minutes pass", () => {
    let previous = weights(skyAt(at(0, 0)));
    for (let minute = 1; minute <= MINUTES_PER_DAY; minute += 1) {
      const blend = skyBlend(minute, phases);
      expect(blend.to).toBe((blend.from + 1) % phases.length);
      expect(blend.t).toBeGreaterThanOrEqual(0);
      expect(blend.t).toBeLessThan(1);
      const now = weights(blend);
      // A minute moves no phase's share by more than a few percent: no visible step anywhere, midnight included.
      for (let index = 0; index < phases.length; index += 1) expect(Math.abs(now[index]! - previous[index]!), `minute ${minute}`).toBeLessThan(0.03);
      previous = now;
    }
    // Eased: halfway through the fade to midday (10:30 to 12:00) is half of each; a quarter of the way, under a quarter.
    expect(skyBlend(675, phases).t).toBeCloseTo(0.5);
    expect(skyBlend(652.5, phases).t).toBeLessThan(0.25);
    expect(skyBlend(600, phases).t).toBe(0);
  });

  it("brings the stars out with the night, and none by day", () => {
    expect(skyAt(at(21, 0)).stars).toBe(1);
    expect(skyAt(at(2, 0)).stars).toBe(1);
    expect(skyAt(at(5, 30)).stars).toBe(0);
    for (let hour = 6; hour < 19; hour += 1) expect(skyAt(at(hour, 0)).stars, `${hour}:00`).toBe(0);
    const evening = skyAt(at(20, 0));
    expect(evening.stars).toBeGreaterThan(0);
    expect(evening.stars).toBeLessThan(1);
  });

  it("shows midday, starless, when the clock will not say", () => {
    const blend = skyBlend(null, phases);
    expect(phaseId(blend)).toBe("midday");
    expect([blend.t, blend.stars]).toEqual([0, 0]);
    expect(skyBlend(Number.NaN, phases)).toEqual(blend);
  });
});

describe("where the sky sits", () => {
  const size = manifest.sky.size;
  const row = skyHorizonRow(size);

  it("lays its lower third under the sea, at the hull's own pixel scale, centred on the ship", () => {
    expect(row).toBe(213);
    const placed = skyPlacement({ left: -9, right: shipStage().width + 9, top: -4 }, size, row, shipStage().width);
    expect(placed.scale).toBe(1);
    expect(placed.x + (size[0] * placed.scale) / 2).toBe(shipStage().width / 2);
    expect(placed.y + row * placed.scale).toBe(HORIZON);
  });

  it("grows only as much as a wide or tall pane needs, never tiled, never short of an edge", () => {
    for (const visible of [
      { left: -400, right: shipStage().width + 400, top: -10 },
      { left: -20, right: shipStage().width + 20, top: -400 },
      { left: -900, right: shipStage().width + 100, top: -600 },
    ]) {
      const placed = skyPlacement(visible, size, row, shipStage().width);
      expect(placed.scale).toBeGreaterThan(1);
      expect(placed.x).toBeLessThanOrEqual(visible.left + 1e-9);
      expect(placed.x + size[0] * placed.scale).toBeGreaterThanOrEqual(visible.right - 1e-9);
      expect(placed.y).toBeLessThanOrEqual(visible.top + 1e-9);
      expect(placed.y + row * placed.scale).toBeCloseTo(HORIZON);
    }
  });
});

describe("the sea, the foam and the gull, by the manifest", () => {
  it("scrolls the water a whole pixel at a time, round one tile, still at the scene clock's start", () => {
    const [width] = manifest.sea.period;
    expect(manifest.sea.animation.xPixelsPerSecond).toBe(10);
    for (let t = 0; t < 60; t += 0.37) {
      const offset = scrollOffset(t, manifest.sea.animation.xPixelsPerSecond, width);
      expect(Number.isInteger(offset) && offset >= 0 && offset < width).toBe(true);
    }
    expect(scrollOffset(0.1, 10, width)).toBe(1);
    expect(scrollOffset(25.6, 10, width)).toBe(0);
    expect(scrollOffset(Number.NaN, 10, width)).toBe(0);
  });

  it("cuts the foam across the hull's waterline only, in at most three pieces, seamless round the repeat", () => {
    const period = manifest.foam.period;
    expect(FOAM_HEIGHT).toBe(Object.values(shipManifest().images).find((image) => image.path === manifest.foam.texture)!.size[1]);
    for (let offset = 0; offset < period; offset += 1) {
      const segments = foamSegments(FOAM_SPAN, period, offset);
      expect(segments.length).toBeLessThanOrEqual(3);
      expect(segments[0]!.x).toBe(FOAM_SPAN.left);
      const end = segments.at(-1)!;
      expect(end.x + end.width).toBe(FOAM_SPAN.right);
      for (const [index, segment] of segments.entries()) {
        expect(segment.from + segment.width).toBeLessThanOrEqual(period);
        // Each piece shows the strip at the world's own position less the scroll: the pattern never breaks.
        expect(segment.from).toBe((((segment.x - offset) % period) + period) % period);
        if (index > 0) expect(segment.x).toBe(segments[index - 1]!.x + segments[index - 1]!.width);
      }
    }
  });

  it("flaps up, mid, down, mid at 125 ms a pose", () => {
    expect(manifest.gull.sequence).toEqual(["up", "mid", "down", "mid"]);
    expect([0, 0.125, 0.25, 0.375, 0.5, 0.6].map((age) => gullPose(age, manifest.gull))).toEqual(["up", "mid", "down", "mid", "up", "up"]);
    expect(manifest.gull.anchor).toEqual([26, 20]);
  });
});
