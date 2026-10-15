/**
 * Moments of weather without Pixi (`client/deck-flash.ts`): how often a flash comes at an intensity, never more than
 * the cap however the data is tuned, each frame for its time, and where one stands under a cloud.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import { DeckExtrasManifestSchema, extrasImagePaths } from "../shared/ship-deck";
import type { DeckExtrasImages } from "./deck-extras";
import { CLOUD_TUCK, drawnFlashes, FLASH_CAP_PER_MINUTE, flashAt, flashSalt, underCloud } from "./deck-flash";

const manifest = DeckExtrasManifestSchema.parse(JSON.parse(readFileSync(new URL("../art/ship-deck/extras.json", import.meta.url), "utf8")));
const extras: DeckExtrasImages = { manifest, images: new Map(extrasImagePaths(manifest).map((path) => [path, { image: path }])) };
const lightning = manifest.flashes![0]!;
const salt = flashSalt(lightning.id);

/** Every flash's start, and how many frames showed each frame index, over `minutes` at 30 frames a second. */
function watch(flash: Parameters<typeof flashAt>[1], intensity: number, minutes: number) {
  const starts: number[] = [];
  const frames = new Map<number, number>();
  let showing = false;
  for (let tick = 0; tick < minutes * 60 * 100; tick += 1) {
    const seconds = tick / 100;
    const moment = flashAt(seconds, flash, intensity, salt);
    if (moment !== null && !showing) starts.push(seconds);
    if (moment !== null) frames.set(moment.frame, (frames.get(moment.frame) ?? 0) + 1);
    showing = moment !== null;
  }
  return { starts, frames };
}

describe("a flash now and then", () => {
  it("is drawn only with every frame decoded", () => {
    expect(drawnFlashes(extras).map((flash) => flash.id)).toEqual(["lightning"]);
    expect(drawnFlashes({ manifest, images: new Map([...extras.images].filter(([path]) => path !== "storm/lightning/frame-1.png")) })).toEqual([]);
    expect(drawnFlashes(null)).toEqual([]);
  });

  it("comes about as often a minute as its curve says at the intensity, and never below its threshold", () => {
    expect(watch(lightning, 0.9, 10).starts).toEqual([]);
    const peak = watch(lightning, 1, 20).starts;
    expect(peak.length).toBeGreaterThan(20 * 2 * 0.6);
    expect(peak.length).toBeLessThan(20 * 2 * 1.4);
  });

  it("never comes more than the cap a minute, nor closer than half a slot, however the data is tuned", () => {
    const wild = { ...lightning, perMinute: [[0, 600]] as Array<[number, number]> };
    const { starts } = watch(wild, 1, 10);
    expect(starts.length).toBeLessThanOrEqual(10 * FLASH_CAP_PER_MINUTE);
    const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(60 / FLASH_CAP_PER_MINUTE / 2 - 0.25);
  });

  it("shows each frame for its own time at its share of the opacity, then is gone", () => {
    const { starts, frames } = watch(lightning, 1, 10);
    // 80 ms and 120 ms at a hundred looks a second.
    expect((frames.get(0) ?? 0) / starts.length).toBeCloseTo(8, 0);
    expect((frames.get(1) ?? 0) / starts.length).toBeCloseTo(12, 0);
    const start = starts[0]!;
    expect(flashAt(start + 0.01, lightning, 1, salt)).toMatchObject({ frame: 0, share: 1 });
    expect(flashAt(start + 0.1, lightning, 1, salt)).toMatchObject({ frame: 1, share: 0.45 });
    expect(flashAt(start + 0.25, lightning, 1, salt)).toBeNull();
  });
});

describe("a flash under a cloud", () => {
  const flash = { frameSize: [32, 48] as [number, number], anchor: [16, 4] as [number, number] };
  const horizon = 213;

  it("tucks its anchor under the underside of a cloud in view, along its middle, its lower edge above the horizon", () => {
    const bank = { x: 100, row: 120, width: 92, height: 25 };
    for (let slot = 0; slot < 40; slot += 1) {
      const spot = underCloud([bank], slot, flash, horizon, { left: 0, right: 512 })!;
      expect(spot.y + flash.anchor[1]).toBe(bank.row + bank.height - CLOUD_TUCK);
      expect(spot.y + flash.frameSize[1]).toBeLessThanOrEqual(horizon);
      expect(spot.x + flash.anchor[0]).toBeGreaterThanOrEqual(bank.x + bank.width * 0.3 - 1);
      expect(spot.x + flash.anchor[0]).toBeLessThanOrEqual(bank.x + bank.width * 0.7 + 1);
    }
  });

  it("stands under none out of view, or too near the horizon to fit, and then there is no flash", () => {
    const low = { x: 100, row: 170, width: 92, height: 25 };
    const away = { x: 600, row: 100, width: 92, height: 25 };
    expect(underCloud([low, away], 3, flash, horizon, { left: 0, right: 512 })).toBeNull();
    expect(underCloud([], 3, flash, horizon, { left: 0, right: 512 })).toBeNull();
  });
});
