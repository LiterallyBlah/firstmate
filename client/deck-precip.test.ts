import { describe, expect, it } from "vitest";
import { createPrecip, precipBudget, precipKinds, PRECIP_CAP } from "./deck-precip";
import { precipFixture } from "../test/precip-fixture";

const pane = { width: 3840, height: 2160 };
const bounds = { left: -210, right: 750, top: -280, bottom: 260 };
function field(scene = "test", seed = 123) {
  const rain = createPrecip(precipFixture, scene, seed);
  rain.layout(bounds, pane);
  return rain;
}
const shown = (rain: ReturnType<typeof field>) => rain.drops.filter((drop) => drop.alpha > 0);

describe("independent seeded precipitation", () => {
  it("replays the same session exactly, with separate scene and session salts", () => {
    const a = field(), b = field(), c = field("other"), d = field("test", 124);
    for (let i = 0; i < 1800; i++) for (const rain of [a, b, c, d]) rain.draw(i / 30, 0.9, "run");
    expect(a.drops).toEqual(b.drops);
    expect(a.drops).not.toEqual(c.drops);
    expect(a.drops).not.toEqual(d.drops);
    expect(new Set(a.drops.map((drop) => drop.life)).size).toBeGreaterThan(3);
  });
  it("bounds work by pane area and never multiplies the cap on enormous panes", () => {
    expect(precipBudget(3840, 2160)).toBe(PRECIP_CAP);
    expect(precipBudget(100000, 100000)).toBe(PRECIP_CAP);
    expect(precipBudget(0, 100)).toBe(0);
    expect(precipBudget(Infinity, 100)).toBe(0);
    expect(precipBudget(640, 480)).toBeLessThan(310);
    const rain = field();
    rain.draw(0, 1, "run");
    expect(shown(rain)).toHaveLength(PRECIP_CAP);
    rain.layout(bounds, { width: 640, height: 480 });
    rain.draw(1, 1, "run");
    expect(rain.drops.length).toBe(precipBudget(640, 480));
  });
  it.each([[1600, 700], [650, 1500], [3840, 2160]])("covers every quadrant and negative sky rows at %sx%s", (width, height) => {
    const rain = field();
    const visible = { left: -width / 8, right: width / 8, top: -height / 8, bottom: height / 8 };
    rain.layout(visible, { width, height });
    rain.draw(0, 1, "run");
    for (const left of [true, false]) for (const top of [true, false])
      expect(shown(rain).some((drop) => (drop.x < 0) === left && (drop.y < 0) === top)).toBe(true);
    expect(new Set(shown(rain).map((drop) => drop.x)).size).toBe(shown(rain).length);
  });
  it("falls downward with rightward wind, with individual speed, length, alpha, depth and angle", () => {
    const rain = field();
    rain.draw(0, 0.9, "run");
    const before = structuredClone(rain.drops);
    rain.draw(1 / 30, 0.901, "run");
    const moving = shown(rain).filter((drop, i) => drop.life === before[i]!.life && Math.abs(drop.x - before[i]!.x) < 20);
    expect(moving.length).toBeGreaterThan(400);
    for (const drop of moving) {
      const previous = before[rain.drops.indexOf(drop)]!;
      expect(drop.y).toBeGreaterThan(previous.y);
      expect(drop.x).toBeGreaterThan(previous.x);
      expect(drop.y - previous.y).toBeLessThan(15);
    }
    for (const key of ["length", "alpha", "depth", "angle"] as const)
      expect(new Set(moving.map((drop) => drop[key])).size).toBeGreaterThan(100);
  });
  it("blends kind ranges continuously, retains the threshold and sways gently", () => {
    const middle = precipKinds(precipFixture.kinds, (0.55 + 0.78) / 2);
    expect(middle.t).toBeCloseTo(0.5);
    expect(middle.density).toBeCloseTo(36);
    const rain = field();
    rain.draw(0, 0.55, "run");
    expect(shown(rain)).toHaveLength(0);
    rain.draw(1, 0.56, "run");
    expect(shown(rain).length).toBeGreaterThan(0);
    const angle = rain.drops[0]!.angle;
    rain.draw(1.03, 0.56, "run");
    expect(Math.abs(rain.drops[0]!.angle - angle)).toBeLessThan(0.2);
  });
  it("holds the same seeded field in lite, skips unchanged frames and hides still weather", () => {
    const rain = field();
    rain.draw(23, 0.9, "run");
    rain.draw(24, 0.9, "hold");
    const held = structuredClone(rain.drops);
    expect(rain.draw(50, 0.9, "hold")).toBe(false);
    expect(rain.drops).toEqual(held);
    expect(rain.draw(51, 1, "hold")).toBe(true);
    const reference = field();
    reference.draw(0, 1, "hold");
    expect(rain.drops).toEqual(reference.drops);
    rain.draw(52, null, "hide");
    expect(shown(rain)).toHaveLength(0);
  });
  it("supports optional finite splashes within the same total cap, never in lite", () => {
    const definition = structuredClone(precipFixture);
    definition.splashes = { frames: [definition.drops[0]!.sprite, definition.drops[1]!.sprite], frameMs: 80, rows: [100, 160], chance: 1, scale: [0.5, 1] };
    const rain = createPrecip(definition, "splash", 123);
    rain.layout(bounds, pane);
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      rain.draw(i / 30, 1, "run");
      const showing = rain.splashes.filter((splash) => splash.alpha > 0);
      peak = Math.max(peak, showing.length);
      expect(rain.drops.length + rain.splashes.length).toBeLessThanOrEqual(PRECIP_CAP);
      for (const splash of showing) { expect(splash.frame).toBeLessThan(2); expect(splash.y).toBeGreaterThanOrEqual(100); }
    }
    expect(peak).toBeGreaterThan(0);
    rain.draw(21, 1, "hold");
    expect(rain.splashes.every((splash) => splash.alpha === 0)).toBe(true);
  });
});
