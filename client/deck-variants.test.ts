/**
 * The deck's weather layers without Pixi (`client/deck-variants.ts`): curves over the weather's intensity, how an
 * element shares its place with its variants, and the heavy weather as the ship pack tunes it — calm up to three
 * crewmates working, a storm with a busy fleet. Which variants can be drawn over what is `client/deck-ambience.test.ts`'s.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import { BUSY_CREW, crewIntensity } from "./deck-atmosphere";
import { curveAt, curvePeak, cycleFrame, opacityAt, variantBlend } from "./deck-variants";
import { shipElement } from "../test/ship-pack";

const working = (count: number) => crewIntensity(Array.from({ length: count }, () => ({ state: "working" as const, stale: false })));

describe("a curve over the weather's intensity", () => {
  it("holds past either end and eases between its points, slowest at each", () => {
    const curve = [
      [0.5, 0],
      [0.9, 0.7],
    ] as const;
    expect(curveAt(curve, 0)).toBe(0);
    expect(curveAt(curve, 0.5)).toBe(0);
    expect(curveAt(curve, 1)).toBe(0.7);
    expect(curveAt(curve, 0.7)).toBeCloseTo(0.35);
    expect(curveAt(curve, 0.52)).toBeLessThan(0.7 * 0.05);
    expect(curveAt(curve, Number.NaN)).toBe(0);
    expect(curveAt([], 0.5)).toBe(0);
    // Several points: through each.
    const three = [
      [0, 1],
      [0.5, 3],
      [1, 2],
    ] as const;
    expect([curveAt(three, 0), curveAt(three, 0.5), curveAt(three, 1)]).toEqual([1, 3, 2]);
    expect(curvePeak(three)).toBe(3);
  });

  it("as an opacity: within 0 to 1, and nothing at all on a still deck", () => {
    expect(opacityAt([[0, 2]], 0.5)).toBe(1);
    expect(opacityAt([[0, 0.4]], 0.5)).toBe(0.4);
    expect(opacityAt([[0, 0.4]], null)).toBe(0);
  });
});

describe("an element under its variants", () => {
  it("is drawn whole under an `over` variant until that is wholly there, and fades under a `crossfade` one", () => {
    const over = { blend: "over" as const, opacity: [[0, 0], [1, 1]] as Array<[number, number]> };
    const fade = { blend: "crossfade" as const, opacity: [[0, 0], [1, 1]] as Array<[number, number]> };
    expect(variantBlend([over], 0.5)).toEqual({ base: 1, layers: [0.5] });
    expect(variantBlend([over], 1)).toEqual({ base: 0, layers: [1] });
    expect(variantBlend([fade], 0.5)).toEqual({ base: 0.5, layers: [0.5] });
    expect(variantBlend([fade], null)).toEqual({ base: 1, layers: [0] });
    expect(variantBlend([], 1)).toEqual({ base: 1, layers: [] });
  });

  it("loops a cycle on the clock it is handed, its first frame while the sea is still", () => {
    const cycle = { frames: ["a", "b", "c", "d"], frameMs: 120 };
    expect([0, 0.12, 0.24, 0.36, 0.48].map((seconds) => cycleFrame(seconds, cycle, true))).toEqual([0, 1, 2, 3, 0]);
    expect(cycleFrame(0.3, cycle, false)).toBe(0);
  });
});

describe("the heavy weather, as the ship pack tunes it", () => {
  const puff = shipElement("clouds", "drifters").sprites.find((sprite) => sprite.id === "puff")!;
  const overcast = shipElement("overcast", "overlay").alpha;
  const lightning = shipElement("lightning", "flash");
  const spray = shipElement("spindrift", "cycle").opacity;
  const opacities = (intensity: number) => {
    return {
      sea: opacityAt(shipElement("sea", "tile").variants![0]!.opacity, intensity),
      wake: opacityAt(shipElement("wake", "cycle").variants![0]!.opacity, intensity),
      clouds: opacityAt(puff.variants![0]!.opacity, intensity),
      spray: typeof spray === "object" && "curve" in spray ? opacityAt(spray.curve, intensity) : 0,
      overcast: overcast === "night" ? 0 : opacityAt(overcast.curve, intensity),
      lightning: opacityAt(lightning.opacity, intensity),
      flashes: curveAt(lightning.perMinute, intensity),
    };
  };

  it("leaves the low and middle of the dial exactly as it was: nothing at all up to three crewmates working", () => {
    for (const count of [0, 1, 2, 3]) expect(Object.values(opacities(working(count))).every((value) => value === 0)).toBe(true);
  });

  it("rolls in with four and five working, and is the whole storm — lightning and all — with a busy fleet", () => {
    const four = opacities(working(4));
    expect(four.clouds).toBeGreaterThan(0.4);
    expect(four.sea).toBeGreaterThan(0.2);
    expect(four.overcast).toBeGreaterThan(0.2);
    expect([four.spray, four.lightning, four.flashes]).toEqual([0, 0, 0]);
    const five = opacities(working(5));
    expect(five.sea).toBeGreaterThan(0.9);
    expect(five.spray).toBeGreaterThan(0);
    expect(five.flashes).toBe(0);
    expect(opacities(working(BUSY_CREW))).toEqual({ sea: 1, wake: 1, clouds: 1, spray: 0.65, overcast: 0.7, lightning: 0.28, flashes: 2 });
  });
});
