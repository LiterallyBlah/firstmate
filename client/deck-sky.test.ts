/**
 * The deck's day and night: which of a setting's day phases shows at a local time of day, with the clock handed in;
 * how smoothly one becomes the next; where a backdrop sits behind the stage; and the sea's, foam's and flyby's timing
 * — all against the ship pack's own (`art/settings/ship/setting.json`).
 */
import { describe, expect, it } from "vitest";

import type { DeckEnvironmentManifest } from "./deck-legacy";
import { shipElement, shipManifest, shipStage, shipViews } from "../test/ship-pack";
import { flybyPose, HORIZON } from "./deck-ambient";
import { FOAM_HEIGHT, FOAM_SPAN, foamSegments } from "./deck-environment";
import { backdropPlacement, dayBlend, dominantPhase, localMinute, MINUTES_PER_DAY, scrollOffset, type DayBlend } from "./deck-sky";

const manifest: DeckEnvironmentManifest = shipViews().environment;
const cycle = shipManifest().dayCycle!;
const { phases, fadeMinutes } = cycle;
const phaseId = (blend: DayBlend) => phases[dominantPhase(blend)]!.id;
const skyBlend = (minute: number | null) => dayBlend(minute, cycle);

/** A local wall-clock time on an ordinary day, whatever the machine's time zone. */
const at = (hours: number, minutes = 0, seconds = 0) => new Date(2026, 9, 14, hours, minutes, seconds);
const skyAt = (date: Date) => skyBlend(localMinute(date));

/** How much of each phase shows in a blend: the lower whole, less what the upper covers. */
function weights(blend: DayBlend): number[] {
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
    expect(phases.map((phase) => phase.id)).toEqual(["dawn", "morning", "midday", "afternoon", "dusk", "night"]);
    expect([cycle.night, cycle.fallback]).toEqual(["night", "midday"]);
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
      const fadeFrom = (next.localMinute - fadeMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
      const held = skyBlend(fadeFrom);
      expect([phases[held.from]!.id, held.t], phase.id).toEqual([phase.id, 0]);
      const halfway = skyBlend((fadeFrom + fadeMinutes / 2) % MINUTES_PER_DAY);
      expect([phases[halfway.from]!.id, phases[halfway.to]!.id], phase.id).toEqual([phase.id, next.id]);
      expect(halfway.t).toBeCloseTo(0.5);
    }
  });

  it("blends between two neighbours only, eased, and never jumps as the minutes pass", () => {
    let previous = weights(skyAt(at(0, 0)));
    for (let minute = 1; minute <= MINUTES_PER_DAY; minute += 1) {
      const blend = skyBlend(minute);
      expect(blend.to).toBe((blend.from + 1) % phases.length);
      expect(blend.t).toBeGreaterThanOrEqual(0);
      expect(blend.t).toBeLessThan(1);
      const now = weights(blend);
      // A minute moves no phase's share by more than a few percent: no visible step anywhere, midnight included.
      for (let index = 0; index < phases.length; index += 1) expect(Math.abs(now[index]! - previous[index]!), `minute ${minute}`).toBeLessThan(0.03);
      previous = now;
    }
    // Eased: halfway through the fade to midday (10:30 to 12:00) is half of each; a quarter of the way, under a quarter.
    expect(skyBlend(675).t).toBeCloseTo(0.5);
    expect(skyBlend(652.5).t).toBeLessThan(0.25);
    expect(skyBlend(600).t).toBe(0);
  });

  it("brings the night out, and none of it by day", () => {
    expect(skyAt(at(21, 0)).night).toBe(1);
    expect(skyAt(at(2, 0)).night).toBe(1);
    expect(skyAt(at(5, 30)).night).toBe(0);
    for (let hour = 6; hour < 19; hour += 1) expect(skyAt(at(hour, 0)).night, `${hour}:00`).toBe(0);
    const evening = skyAt(at(20, 0));
    expect(evening.night).toBeGreaterThan(0);
    expect(evening.night).toBeLessThan(1);
  });

  it("shows its fallback, midday, with no night, when the clock will not say", () => {
    const blend = skyBlend(null);
    expect(phaseId(blend)).toBe("midday");
    expect([blend.t, blend.night]).toEqual([0, 0]);
    expect(skyBlend(Number.NaN)).toEqual(blend);
  });

  it("fades over the whole gap when it is shorter than the fade, and holds a day of one phase", () => {
    const short = { ...cycle, phases: [{ id: "early", localMinute: 0 }, { id: "late", localMinute: 30 }, { id: "night", localMinute: 720 }] };
    expect(dayBlend(15, short)).toMatchObject({ from: 0, to: 1, t: 0.5 });
    expect(dayBlend(600, { ...cycle, phases: [{ id: "night", localMinute: 0 }] })).toEqual({ from: 0, to: 0, t: 0, night: 1 });
  });
});

describe("where a backdrop sits", () => {
  const sky = shipElement("sky", "backdrop-cycle");
  const { size, placement } = sky;
  const row = placement.horizonRow;

  it("lays the ship's sky's lower third under the sea, at the hull's own pixel scale, centred on the ship", () => {
    expect(placement).toEqual({ horizonRow: 213, stageRow: HORIZON });
    expect(row).toBe(Math.round(size[1] * (2 / 3)));
    const placed = backdropPlacement({ left: -9, right: shipStage().width + 9, top: -4 }, size, placement, shipStage().width);
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
      const placed = backdropPlacement(visible, size, placement, shipStage().width);
      expect(placed.scale).toBeGreaterThan(1);
      expect(placed.x).toBeLessThanOrEqual(visible.left + 1e-9);
      expect(placed.x + size[0] * placed.scale).toBeGreaterThanOrEqual(visible.right - 1e-9);
      expect(placed.y).toBeLessThanOrEqual(visible.top + 1e-9);
      expect(placed.y + row * placed.scale).toBeCloseTo(HORIZON);
    }
  });
});

describe("the sea, the foam and the gull, by the pack", () => {
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
    const gull = shipElement("gull", "flyby");
    expect(gull.sequence).toEqual(["up", "mid", "down", "mid"]);
    expect([0, 0.125, 0.25, 0.375, 0.5, 0.6].map((age) => flybyPose(age, gull))).toEqual(["up", "mid", "down", "mid", "up", "up"]);
    expect(gull.anchor).toEqual([26, 20]);
    expect(flybyPose(0, { ...gull, sequence: [] })).toBe(gull.glide);
  });
});
