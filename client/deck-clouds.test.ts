/**
 * The sky's clouds, as arithmetic: the served sprites hold exactly the three colours the masks cut them by, the
 * field is seeded and spread across lanes the deck can show, the drift wraps each cloud whole and out of view,
 * and the colours follow the sky's blend. How they sit in the scene is `client/deck-environment.test.ts`'s.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { DeckEnvironmentManifestSchema, DeckExtrasManifestSchema, SKY_PHASES } from "../shared/ship-deck";
import { cutCloudMasks } from "./deck-mount";
import {
  CLOUD_LANES,
  CLOUD_MARGIN,
  CLOUD_TOP_MIN,
  cloudColours,
  cloudField,
  cloudPeriod,
  cloudSlotMasks,
  cloudX,
  drawnClouds,
  hexColour,
} from "./deck-clouds";
import { HORIZON } from "./deck-ambient";
import { skyBlend, skyHorizonRow, skyPlacement } from "./deck-sky";
import { DECK_WIDTH } from "./deck-scene";

const art = (path: string) => new URL(`../art/ship-deck/${path}`, import.meta.url);
/** The art's generation records, kept out of the package (`docs/ship-deck-art/`). */
const sources = (path: string) => new URL(`../docs/ship-deck-art/${path}`, import.meta.url);
const extras = DeckExtrasManifestSchema.parse(JSON.parse(readFileSync(art("extras.json"), "utf8")));
const clouds = extras.clouds!;
const environment = DeckEnvironmentManifestSchema.parse(JSON.parse(readFileSync(art("environment.json"), "utf8")));
const [skyWidth] = environment.sky.size;
const horizonRow = skyHorizonRow(environment.sky.size);
const artManifest = JSON.parse(readFileSync(sources("clouds/manifest.json"), "utf8")) as {
  palette: { colours: string[] };
  tint: { stagePalettes: Record<string, string[]> };
  assets: Array<{ id: string; path: string; size: [number, number] }>;
};

/** A served cloud's pixels: enough of PNG for these (8-bit RGBA, not interlaced). */
function pixelsOf(path: string): { width: number; height: number; data: Uint8Array } {
  const file = readFileSync(art(path));
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  expect([file[24], file[25], file[28]]).toEqual([8, 6, 0]);
  const chunks: Buffer[] = [];
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at);
    if (file.toString("latin1", at + 4, at + 8) === "IDAT") chunks.push(file.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= 4 ? (data[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (data[(y - 1) * stride + x] ?? 0) : 0;
      const corner = x >= 4 && y > 0 ? (data[(y - 1) * stride + x - 4] ?? 0) : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      data[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return { width, height, data };
}

describe("the clouds the deck is sent", () => {
  it("are the art's five sprites at their sizes, with its palette and its six stage palettes", () => {
    expect(clouds.sprites.map((sprite) => [sprite.id, `clouds/${artManifest.assets.find((asset) => asset.id === sprite.id)!.path}`])).toEqual(
      clouds.sprites.map((sprite) => [sprite.id, sprite.texture]),
    );
    for (const sprite of clouds.sprites) {
      const { width, height } = pixelsOf(sprite.texture);
      expect([width, height], sprite.id).toEqual(sprite.size);
      expect(sprite.size).toEqual(artManifest.assets.find((asset) => asset.id === sprite.id)!.size);
    }
    expect(clouds.palette).toEqual(artManifest.palette.colours);
    for (const phase of SKY_PHASES) expect(clouds.stages[phase], phase).toEqual(artManifest.tint.stagePalettes[phase]);
  });

  it("hold only the palette's three colours, opaque, so the masks cover every pixel exactly once", () => {
    const palette = clouds.palette.map(hexColour);
    for (const sprite of clouds.sprites) {
      const { data } = pixelsOf(sprite.texture);
      const masks = cloudSlotMasks(data, clouds.palette);
      let opaque = 0;
      for (let at = 0; at < data.length; at += 4) {
        const alpha = data[at + 3]!;
        expect([0, 255]).toContain(alpha);
        const covering = masks.filter((mask) => mask[at + 3] === 255).length;
        if (alpha === 0) {
          expect(covering).toBe(0);
          continue;
        }
        opaque += 1;
        expect(covering).toBe(1);
        const slot = masks.findIndex((mask) => mask[at + 3] === 255);
        expect((data[at]! << 16) | (data[at + 1]! << 8) | data[at + 2]!, sprite.id).toBe(palette[slot]);
        expect([...masks[slot]!.subarray(at, at + 4)]).toEqual([255, 255, 255, 255]);
      }
      expect(opaque, sprite.id).toBeGreaterThan(50);
    }
  });

  it("send a near colour to its nearest slot, as a browser's decode might round", () => {
    const masks = cloudSlotMasks([0xa9, 0xb8, 0xbe, 255, 0xda, 0xd3, 0xbf, 255, 0, 0, 0, 0], clouds.palette);
    expect(masks.map((mask) => [mask[3], mask[7], mask[11]])).toEqual([
      [255, 0, 0],
      [0, 0, 0],
      [0, 255, 0],
    ]);
  });
});

describe("cutting a cloud in the browser", () => {
  it("reads it back off a scratch canvas and makes each slot's mask a bitmap", async () => {
    const { data } = pixelsOf("clouds/puff.png");
    const drawn: unknown[] = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (image: unknown) => drawn.push(image),
        getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(data.subarray(0, width * height * 4)) }),
      }),
    };
    class FakeImageData {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    }
    const masks = await cutCloudMasks({ image: "puff" }, [36, 14], clouds.palette, {
      document: { createElement: () => canvas },
      ImageData: FakeImageData,
      createImageBitmap: (made) => Promise.resolve({ bitmap: made }),
    });
    expect(drawn).toEqual([{ image: "puff" }]);
    expect([canvas.width, canvas.height]).toEqual([36, 14]);
    expect(masks).toHaveLength(3);
    const expected = cloudSlotMasks(data, clouds.palette);
    masks.forEach(function (mask, slot) {
      const made = (mask as { bitmap: FakeImageData }).bitmap;
      expect([made.width, made.height]).toEqual([36, 14]);
      expect([...made.data]).toEqual([...expected[slot]!]);
    });
  });

  it("refuses where there is no canvas or no bitmaps", async () => {
    await expect(cutCloudMasks({}, [36, 14], clouds.palette, {})).rejects.toThrow("cannot read pixels");
    await expect(
      cutCloudMasks({}, [36, 14], clouds.palette, {
        document: { createElement: () => ({ getContext: () => null }) },
        ImageData: class {},
        createImageBitmap: () => Promise.resolve({}),
      }),
    ).rejects.toThrow("no 2D canvas");
  });
});

describe("the field of clouds", () => {
  const field = (seed: number) => cloudField(seed, clouds.sprites, skyWidth, horizonRow);

  it("is the same sky for the same seed, and another for another", () => {
    expect(field(1_760_000_000)).toEqual(field(1_760_000_000));
    expect(field(1_760_000_001)).not.toEqual(field(1_760_000_000));
    expect(field(Number.NaN)).toEqual(field(0));
    expect(cloudField(5, [], skyWidth, horizonRow)).toEqual([]);
  });

  it("puts one cloud a lane, lowest first, inside the sky and above the horizon, never the lane below's twin", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const sky = field(seed * 7919);
      expect(sky).toHaveLength(CLOUD_LANES.length);
      let below = -1;
      sky.forEach(function (cloud, lane) {
        const [width, height] = clouds.sprites[cloud.sprite]!.size;
        const [low, high] = CLOUD_LANES[lane]!;
        const lift = horizonRow - (cloud.row + height);
        expect(cloud.row).toBeGreaterThanOrEqual(CLOUD_TOP_MIN);
        if (cloud.row > CLOUD_TOP_MIN) {
          expect(lift).toBeGreaterThanOrEqual(low - 1);
          expect(lift).toBeLessThanOrEqual(high + 1);
        }
        expect(cloud.sprite).not.toBe(below);
        below = cloud.sprite;
        expect(cloud.offset).toBeGreaterThanOrEqual(0);
        expect(cloud.offset).toBeLessThan(cloudPeriod(skyWidth, width));
        // Slow: a fraction of a pixel a second, where the gull flies 26.
        expect(cloud.pixelsPerSecond).toBeGreaterThan(0.15);
        expect(cloud.pixelsPerSecond).toBeLessThan(0.8);
      });
    }
  });

  it("varies the sprites, smaller low and banks high, and spreads the clouds round their laps", () => {
    const used = new Set<number>();
    let lowSmall = 0;
    let highBig = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const sky = field(seed * 104_729);
      for (const cloud of sky) used.add(cloud.sprite);
      if (clouds.sprites[sky[0]!.sprite]!.size[0] <= 44) lowSmall += 1;
      if (clouds.sprites[sky.at(-1)!.sprite]!.size[0] >= 80) highBig += 1;
      // Never all bunched: the starts fill most of the lap's sevenths.
      const sevenths = new Set(sky.map((cloud) => Math.floor((cloud.offset / cloudPeriod(skyWidth, clouds.sprites[cloud.sprite]!.size[0])) * 7)));
      expect(sevenths.size).toBeGreaterThanOrEqual(5);
    }
    expect(used.size).toBe(clouds.sprites.length);
    expect(lowSmall).toBeGreaterThan(150);
    expect(highBig).toBeGreaterThan(150);
  });

  it("keeps the lowest lanes in a pane that fits the deck's height, and every lane in a tall one", () => {
    // A pane exactly the deck's shape shows rows 0 down: the sky at its own scale, and its top 117 rows above the frame.
    const fits = skyPlacement({ left: 0, right: DECK_WIDTH, top: 0 }, environment.sky.size, horizonRow);
    const tall = skyPlacement({ left: -40, right: DECK_WIDTH + 40, top: -260 }, environment.sky.size, horizonRow);
    for (let seed = 0; seed < 50; seed += 1) {
      const sky = field(seed);
      // The lowest two wholly in view, the third at least in part.
      const whole = sky.filter((cloud) => fits.y + cloud.row * fits.scale >= 0);
      const part = sky.filter((cloud) => fits.y + (cloud.row + clouds.sprites[cloud.sprite]!.size[1]) * fits.scale >= 6);
      expect(whole.length).toBeGreaterThanOrEqual(2);
      expect(part.length).toBeGreaterThanOrEqual(3);
      expect(sky.every((cloud) => tall.y + cloud.row * tall.scale >= -260)).toBe(true);
      // Every cloud's bottom above the horizon, whatever the scale.
      for (const place of [fits, tall]) {
        for (const cloud of sky) expect(place.y + (cloud.row + clouds.sprites[cloud.sprite]!.size[1]) * place.scale).toBeLessThan(HORIZON);
      }
    }
  });
});

describe("a cloud's drift", () => {
  const [cloud] = cloudField(42, clouds.sprites, skyWidth, horizonRow);
  const width = clouds.sprites[cloud!.sprite]!.size[0];
  const period = cloudPeriod(skyWidth, width);

  it("moves right a whole pixel at a time, and holds still when the deck does", () => {
    const start = cloudX(cloud!, width, skyWidth, 0, true);
    expect(start).toBe(-width - CLOUD_MARGIN + cloud!.offset);
    expect(cloudX(cloud!, width, skyWidth, 600, false)).toBe(start);
    let previous = start;
    for (let seconds = 0.5; seconds < 60; seconds += 0.5) {
      const x = cloudX(cloud!, width, skyWidth, seconds, true);
      expect(Number.isInteger(x)).toBe(true);
      const step = (((x - previous) % period) + period) % period;
      expect(step).toBeLessThanOrEqual(1);
      previous = x;
    }
  });

  it("wraps only once it is wholly out of the sky, and comes back in from wholly out on the other side", () => {
    const seen = new Set<number>();
    let wraps = 0;
    let previous = cloudX(cloud!, width, skyWidth, 0, true);
    const lap = period / cloud!.pixelsPerSecond;
    for (let seconds = 0; seconds < lap * 2.2; seconds += 0.25) {
      const x = cloudX(cloud!, width, skyWidth, seconds, true);
      seen.add(x);
      expect(x).toBeGreaterThanOrEqual(-width - CLOUD_MARGIN);
      expect(x).toBeLessThan(skyWidth + CLOUD_MARGIN);
      if (x < previous) {
        wraps += 1;
        // Out past the right edge, in from past the left: nowhere in view either side of the jump.
        expect(previous).toBeGreaterThanOrEqual(skyWidth);
        expect(x + width).toBeLessThanOrEqual(0);
      }
      previous = x;
    }
    expect(wraps).toBe(2);
    // Every column of the lap is passed through: no gap in the drift.
    expect(seen.size).toBe(period);
  });
});

describe("the clouds' colours", () => {
  const phases = environment.sky.phases;
  const at = (hours: number, minutes = 0) => cloudColours(clouds, phases, skyBlend(hours * 60 + minutes, phases));
  const palette = (phase: (typeof SKY_PHASES)[number]) => clouds.stages[phase].map(hexColour);

  it("are each phase's own palette where it shows alone", () => {
    expect(at(12)).toEqual(palette("midday"));
    expect(at(12)).toEqual(clouds.palette.map(hexColour));
    expect(at(5, 30)).toEqual(palette("dawn"));
    expect(at(16)).toEqual(palette("afternoon"));
    expect(at(18, 30)).toEqual(palette("dusk"));
    expect(at(2)).toEqual(palette("night"));
    // A clock that will not say shows midday's sky, and its clouds.
    expect(cloudColours(clouds, phases, skyBlend(null, phases))).toEqual(palette("midday"));
  });

  it("fade from one to the next with the sky, slot by slot", () => {
    const blend = skyBlend(20 * 60 + 15, phases);
    expect(blend.t).toBeGreaterThan(0.3);
    expect(blend.t).toBeLessThan(0.7);
    const between = at(20, 15);
    between.forEach(function (colour, slot) {
      for (const shift of [16, 8, 0]) {
        const value = (colour >> shift) & 0xff;
        const a = (palette("dusk")[slot]! >> shift) & 0xff;
        const b = (palette("night")[slot]! >> shift) & 0xff;
        expect(value).toBeGreaterThanOrEqual(Math.min(a, b));
        expect(value).toBeLessThanOrEqual(Math.max(a, b));
      }
    });
    expect(between).not.toEqual(palette("dusk"));
    expect(between).not.toEqual(palette("night"));
  });

  it("dim blue by night and warm at dawn, against the day's", () => {
    const brightness = (colour: number) => ((colour >> 16) & 0xff) + ((colour >> 8) & 0xff) + (colour & 0xff);
    const [, nightBody] = at(2);
    const [, dayBody] = at(12);
    const [, dawnBody] = at(5, 30);
    expect(brightness(nightBody!)).toBeLessThan(brightness(dayBody!) / 2);
    expect(nightBody! & 0xff).toBeGreaterThan((nightBody! >> 16) & 0xff);
    expect((dawnBody! >> 16) & 0xff).toBeGreaterThan(dawnBody! & 0xff);
  });
});

describe("which clouds are drawn", () => {
  const images = new Map(clouds.sprites.map((sprite) => [sprite.texture, { image: sprite.texture }]));
  const masks = (sprite: { texture: string }) => [sprite.texture, ["s", "b", "h"]] as const;

  it("are those cut into masks, and none without the manifest's clouds or any mask", () => {
    expect(drawnClouds(null)).toBeNull();
    const { clouds: _clouds, ...bare } = extras;
    expect(drawnClouds({ manifest: bare, images })).toBeNull();
    expect(drawnClouds({ manifest: extras, images })).toBeNull();
    expect(drawnClouds({ manifest: extras, images, cloudMasks: new Map() })).toBeNull();
    const some = drawnClouds({ manifest: extras, images, cloudMasks: new Map(clouds.sprites.filter((sprite) => sprite.id !== "puff").map(masks)) });
    expect(some?.manifest.sprites.map((sprite) => sprite.id)).toEqual(["wisp", "cumulus", "long-bank", "twin-bank"]);
    expect(some?.masks.size).toBe(4);
    expect(some?.manifest.stages).toBe(clouds.stages);
  });
});
