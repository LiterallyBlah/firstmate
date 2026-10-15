/**
 * The deck's animated water, without Pixi: the water as served (`extras.json`'s `water`) placed exactly where
 * the art's own manifest (`docs/ship-deck-art/water/manifest.json`) says, which parts are drawn when a frame is
 * missing, which frame shows when, and the wake's place. The sprites are `deck-environment.test.ts`'s.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import { DeckExtrasManifestSchema, extrasImagePaths } from "../shared/ship-deck";
import { HORIZON, WATERLINE } from "./deck-ambient";
import { FOAM_SPAN } from "./deck-environment";
import type { DeckExtrasImages } from "./deck-extras";
import { STERN } from "./deck-wake";
import { CALM_WATER, drawnWater, wakeTopLeft, waterDrift, waterFrame } from "./deck-water";

const artFile = (path: string) => new URL(`../art/ship-deck/${path}`, import.meta.url);
/** The art's generation records, kept out of the package (`docs/ship-deck-art/`). */
const sources = (path: string) => new URL(`../docs/ship-deck-art/${path}`, import.meta.url);
const manifest = DeckExtrasManifestSchema.parse(JSON.parse(readFileSync(artFile("extras.json"), "utf8")));
const water = manifest.water!;
const extras: DeckExtrasImages = { manifest, images: new Map(extrasImagePaths(manifest).map((path) => [path, { image: path }])) };

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

describe("the animated water as served", () => {
  it("is the art's frames, in its order, at its size and timing", () => {
    for (const part of ["sea", "foam", "wake"] as const) {
      const asset = art.assets[part];
      expect(water[part].frames, part).toEqual(asset.frameOrder.map((index) => `water/${asset.frames[index]!.path}`));
      expect(water[part].frameSize, part).toEqual(asset.size);
      expect(water[part].frameMs, part).toBe(asset.frameMs);
      expect(asset.stillFrame, part).toBe(0);
      for (const path of water[part].frames) {
        const png = readFileSync(artFile(path));
        expect([png.readUInt32BE(16), png.readUInt32BE(20)], path).toEqual(water[part].frameSize);
      }
    }
  });

  it("lines up with the deck where the art's manifest places it", () => {
    // The sea's tile origin is the deck's horizon, and the near sea starts at its waterline.
    expect([art.placement.horizonY, art.placement.waterlineY]).toEqual([HORIZON, WATERLINE]);
    expect(water.sea.xPixelsPerSecond).toBe(art.placement.sea.optionalDrift.pixelsPerSecond);
    // The foam three rows higher than the old strip, its row 9 on the waterline, across the hull as before.
    expect(water.foam.top).toBe(art.placement.foam.topLeftY);
    expect(water.foam.top + art.placement.foam.waterlineSourceRow).toBe(WATERLINE);
    expect(water.foam.span).toEqual(art.placement.foam.clipX);
    expect(water.foam.span).toEqual([FOAM_SPAN.left, FOAM_SPAN.right]);
    expect(water.foam.frameSize[0]).toBe(art.placement.foam.repeatWidth);
    // The wake's anchor on the stern's water contact, the code wake's own stern.
    expect(water.wake.anchor).toEqual(art.placement.wake.anchor);
    expect(water.wake.position).toEqual(art.placement.wake.worldAnchor);
    expect(water.wake.position).toEqual([STERN.x, STERN.y]);
    const at = wakeTopLeft(water.wake);
    expect([at.x, at.y]).toEqual(art.placement.wake.topLeft);
  });
});

describe("which of the water is drawn", () => {
  it("is all of it when every frame decoded", () => {
    const drawn = drawnWater(extras)!;
    expect([drawn.sea, drawn.foam, drawn.wake]).toEqual([water.sea, water.foam, water.wake]);
    expect(drawn.images).toBe(extras.images);
  });

  it("leaves out a part with any frame missing, and keeps the others", () => {
    const without = (path: string): DeckExtrasImages => ({ manifest, images: new Map([...extras.images].filter(([key]) => key !== path)) });
    const noSea = drawnWater(without(water.sea.frames[2]!))!;
    expect([noSea.sea, noSea.foam, noSea.wake]).toEqual([null, water.foam, water.wake]);
    const noWake = drawnWater(without(water.wake.frames[0]!))!;
    expect([noWake.sea, noWake.foam, noWake.wake]).toEqual([water.sea, water.foam, null]);
  });

  it("is nothing without the extras, without their water, or with none of its frames", () => {
    expect(drawnWater(null)).toBeNull();
    const { water: _, ...dry } = manifest;
    expect(drawnWater({ manifest: dry, images: extras.images })).toBeNull();
    expect(drawnWater({ manifest, images: new Map() })).toBeNull();
  });
});

describe("the water's motion", () => {
  it("plays each part's frames in order, 240 ms each, looping to the first", () => {
    const at = (ms: number, part: { frames: readonly unknown[]; frameMs: number }) => waterFrame(ms / 1000, part, true);
    expect([0, 239, 240, 480, 720, 959, 960].map((ms) => at(ms, water.sea))).toEqual([0, 0, 1, 2, 3, 3, 0]);
    expect([0, 240, 480, 720].map((ms) => at(ms, water.foam))).toEqual([0, 1, 2, 0]);
    expect([0, 240, 480, 720].map((ms) => at(ms, water.wake))).toEqual([0, 1, 2, 0]);
  });

  it("holds the calm first frame while the water is still, on a bad clock, or with one frame", () => {
    expect(waterFrame(0.5, water.sea, false)).toBe(0);
    expect(waterFrame(Number.NaN, water.sea, true)).toBe(0);
    expect(waterFrame(5, { frames: ["only"], frameMs: 240 }, true)).toBe(0);
  });

  it("is the art's own timing at calm water, and scales from one place", () => {
    expect(CALM_WATER).toEqual({ pace: 1, drift: 1 });
    expect(waterDrift(water.sea)).toBe(10);
    expect(waterDrift(water.foam)).toBe(6.25);
    // Twice the pace, the frames come twice as fast; twice the drift, the sea slides twice as fast.
    expect(waterFrame(0.24, water.sea, true, { pace: 2, drift: 1 })).toBe(2);
    expect(waterDrift(water.sea, { pace: 1, drift: 2 })).toBe(20);
    expect(waterFrame(1, water.sea, true, { pace: 0, drift: 1 })).toBe(0);
  });
});
