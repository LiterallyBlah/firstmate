/**
 * The deck's animated water, without Pixi: the ship pack's sea, foam and wake placed exactly where the art's own
 * manifest (`docs/ship-deck-art/water/manifest.json`) says, which frame shows when, and the water's clock at the
 * weather's pace. Which of it is drawn is `deck-ambience.test.ts`'s; the sprites are `deck-environment.test.ts`'s.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import { cycleFrame } from "./deck-variants";
import { advanceWater, CALM_WATER } from "./deck-water";
import { shipElement, shipFile, shipManifest, shipWater } from "../test/ship-pack";

/** The art's generation records, kept out of the package (`docs/ship-deck-art/`). */
const sources = (path: string) => new URL(`../docs/ship-deck-art/${path}`, import.meta.url);
const sea = shipElement("sea", "tile");
const foam = shipElement("foam", "strip");
const wake = shipElement("wake", "cycle");
const parts = { sea, foam, wake } as const;
const pathOf = (image: string) => shipManifest().images[image]!.path;
const sizeOf = (image: string) => shipManifest().images[image]!.size;

/** The parts of the art's own manifest the deck is held to. */
const art = JSON.parse(readFileSync(sources("water/manifest.json"), "utf8")) as {
  assets: Record<"sea" | "foam" | "wake", { size: [number, number]; frameMs: number; stillFrame: number; frameOrder: number[]; frames: Array<{ path: string }> }>;
  placement: {
    horizonY: number;
    waterlineY: number;
    sea: { optionalDrift: { pixelsPerSecond: number } };
    foam: { topLeftY: number; clipX: [number, number]; repeatWidth: number; waterlineSourceRow: number };
    wake: { anchor: [number, number]; worldAnchor: [number, number]; topLeft: [number, number] };
    layerOrder: string[];
  };
};

describe("the animated water as the ship pack has it", () => {
  it("is the art's frames, in its order, at its size and timing", () => {
    for (const name of ["sea", "foam", "wake"] as const) {
      const asset = art.assets[name];
      const { frames } = parts[name];
      expect(frames.sprites.map((sprite) => pathOf(sprite.image)), name).toEqual(asset.frameOrder.map((index) => `water/${asset.frames[index]!.path}`));
      expect(frames.frameMs, name).toBe(asset.frameMs);
      expect(asset.stillFrame, name).toBe(0);
      for (const sprite of frames.sprites) {
        const png = readFileSync(shipFile(pathOf(sprite.image)));
        expect([png.readUInt32BE(16), png.readUInt32BE(20)], sprite.image).toEqual(asset.size);
        expect(sizeOf(sprite.image)).toEqual(asset.size);
      }
    }
  });

  it("lines up with the deck where the art's manifest places it", () => {
    // The sea's tile origin is the deck's horizon, and the near band starts at its waterline.
    const { horizon, waterline } = shipWater();
    expect([art.placement.horizonY, art.placement.waterlineY]).toEqual([horizon, waterline]);
    expect(sea.bands.map((band) => [band.slot, band.fromRow])).toEqual([
      ["back", horizon],
      ["front", waterline],
    ]);
    expect(sea.drift.pxPerSecond).toBe(art.placement.sea.optionalDrift.pixelsPerSecond);
    // The foam three rows higher than the still strip, its row 9 on the waterline, across the hull as before.
    expect(foam.top).toBe(art.placement.foam.topLeftY);
    expect(foam.top + art.placement.foam.waterlineSourceRow).toBe(waterline);
    expect(foam.span).toEqual(art.placement.foam.clipX);
    expect(foam.span).toEqual(shipElement("foam-still", "strip").span);
    expect(sizeOf(foam.frames.sprites[0]!.image)[0]).toBe(art.placement.foam.repeatWidth);
    // The wake's anchor on the stern's water contact, on the waterline.
    expect(wake.anchor).toEqual(art.placement.wake.anchor);
    expect(wake.at).toEqual(art.placement.wake.worldAnchor);
    expect(wake.at[1]).toBe(shipWater().waterline);
    expect([wake.at[0] - wake.anchor[0], wake.at[1] - wake.anchor[1]]).toEqual(art.placement.wake.topLeft);
  });

  it("falls back to the still tile and strip, on the same rows", () => {
    const still = shipElement("sea-still", "tile");
    expect([still.origin, still.bands]).toEqual([sea.origin, sea.bands]);
    expect(shipElement("foam-still", "strip").top).toBe(shipWater().waterline - 6);
  });
});

describe("the water's motion", () => {
  const frames = (part: { frames: { sprites: readonly unknown[]; frameMs: number } }) => ({ frames: part.frames.sprites, frameMs: part.frames.frameMs });

  it("plays each part's frames in order, 240 ms each, looping to the first", () => {
    const at = (ms: number, part: { frames: { sprites: readonly unknown[]; frameMs: number } }) => cycleFrame(ms / 1000, frames(part), true);
    expect([0, 239, 240, 480, 720, 959, 960].map((ms) => at(ms, sea))).toEqual([0, 0, 1, 2, 3, 3, 0]);
    expect([0, 240, 480, 720].map((ms) => at(ms, foam))).toEqual([0, 1, 2, 0]);
    expect([0, 240, 480, 720].map((ms) => at(ms, wake))).toEqual([0, 1, 2, 0]);
  });

  it("holds the calm first frame while the water is still, on a bad clock, or with one frame", () => {
    expect(cycleFrame(0.5, frames(sea), false)).toBe(0);
    expect(cycleFrame(Number.NaN, frames(sea), true)).toBe(0);
    expect(cycleFrame(5, { frames: ["only"], frameMs: 240 }, true)).toBe(0);
  });

  it("is the art's own timing at calm water, and runs faster on its own clock at a livelier pace", () => {
    expect(CALM_WATER).toEqual({ pace: 1, drift: 1 });
    expect([sea.drift.pxPerSecond, foam.drift.pxPerSecond]).toEqual([10, 6.25]);
    expect([sea.frames.clock, sea.drift.clock, foam.frames.clock, foam.drift.clock, wake.frames.clock]).toEqual([
      "water-frames",
      "water-drift",
      "water-frames",
      "water-drift",
      "water-frames",
    ]);
    // Twice the pace, the frames come twice as fast; twice the drift, the sea slides twice as far.
    const clock = advanceWater({ frames: 0, drift: 0 }, 0.24, { pace: 2, drift: 2 });
    expect(cycleFrame(clock.frames, frames(sea), true)).toBe(2);
    expect(clock.drift).toBe(0.48);
  });
});
