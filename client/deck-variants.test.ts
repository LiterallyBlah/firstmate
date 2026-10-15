/**
 * The deck's weather layers without Pixi (`client/deck-variants.ts`): curves over the weather's intensity, which
 * variants and cycles can be drawn and over what, how an element shares its place with its variants, and the heavy
 * weather as the ship pack tunes it — calm up to three crewmates working, a storm with a busy fleet.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import { extrasImagePaths } from "./deck-legacy";
import { BUSY_CREW, crewIntensity } from "./deck-atmosphere";
import type { DeckExtrasImages } from "./deck-extras";
import { curveAt, curvePeak, cycleFrame, drawnVariants, opacityAt, variantBlend, variantsOf } from "./deck-variants";
import { drawnWater } from "./deck-water";
import { shipElement, shipViews } from "../test/ship-pack";

const manifest = shipViews().extras;
const extras: DeckExtrasImages = { manifest, images: new Map(extrasImagePaths(manifest).map((path) => [path, { image: path }])) };
const without = (...paths: string[]): DeckExtrasImages => ({ manifest, images: new Map([...extras.images].filter(([path]) => !paths.includes(path))) });
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

describe("which weather layers can be drawn", () => {
  it("draws every layer the extras send, each variant over the element it names", () => {
    const drawn = drawnVariants(extras, drawnWater(extras))!;
    expect([...drawn.variants.keys()]).toEqual(["sea", "wake"]);
    expect(variantsOf(drawn, "sea").map((variant) => variant.id)).toEqual(["rough-sea"]);
    expect(variantsOf(drawn, "foam")).toEqual([]);
    expect(drawn.cycles.map((cycle) => cycle.id)).toEqual(["spindrift"]);
    expect(drawnVariants(null, null)).toBeNull();
  });

  it("leaves out only the layer whose image did not decode", () => {
    const drawn = drawnVariants(without("storm/sea/frame-2.png", "storm/spray/frame-0.png"), drawnWater(extras))!;
    expect(variantsOf(drawn, "sea")).toEqual([]);
    expect(variantsOf(drawn, "wake").map((variant) => variant.id)).toEqual(["heavy-wake"]);
    expect(drawn.cycles).toEqual([]);
  });

  it("leaves out a variant that would not line up with its element, or whose element is not drawn, and keeps the element", () => {
    const water = drawnWater(extras)!;
    const misfit: DeckExtrasImages = {
      ...extras,
      manifest: {
        ...manifest,
        variants: manifest.variants!.map((variant) =>
          variant.id === "rough-sea" ? { ...variant, frameSize: [128, 128] } : variant.id === "heavy-wake" ? { ...variant, frames: variant.frames.slice(0, 2) } : variant,
        ),
      },
    };
    const drawn = drawnVariants(misfit, water)!;
    expect([variantsOf(drawn, "sea"), variantsOf(drawn, "wake")]).toEqual([[], []]);
    expect(variantsOf(drawnVariants(extras, { ...water, sea: null }), "sea")).toEqual([]);
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
  const opacities = (intensity: number) => {
    const drawn = drawnVariants(extras, drawnWater(extras))!;
    return {
      sea: opacityAt(variantsOf(drawn, "sea")[0]!.opacity, intensity),
      wake: opacityAt(variantsOf(drawn, "wake")[0]!.opacity, intensity),
      clouds: opacityAt(puff.variants![0]!.opacity, intensity),
      spray: opacityAt(drawn.cycles[0]!.opacity, intensity),
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
