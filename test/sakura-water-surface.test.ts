import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { SettingManifestSchema } from "../shared/deck-setting";
import { decodePng } from "./png";

const directory = new URL("../art/settings/japanese-ship/", import.meta.url);
const pack = SettingManifestSchema.parse(JSON.parse(readFileSync(new URL("setting.json", directory), "utf8")));
const body = pack.ambience.find(element => element.id === "umibozu")!;
const submerged = pack.ambience.find(element => element.id === "umibozu-submerged")!;
const sea = pack.ambience.find(element => element.id === "coast")!;

describe("Sakura spirit's shared sea surface", () => {
  it("splits the original strip into registered pieces on opposite sides of the sea", () => {
    if (body.behaviour.kind !== "strip" || submerged.behaviour.kind !== "strip") throw Error("expected strips");
    expect(body.slot).toBe("back");
    expect(submerged.slot).toBe(body.slot);
    expect(submerged.order).toBeLessThan(sea.order);
    expect(body.order).toBeGreaterThan(sea.order);
    expect(body.behaviour.top).toBe(100);
    expect(submerged.behaviour.top).toBe(160);
    expect(submerged.behaviour.drift).toEqual(body.behaviour.drift);
    expect(body.behaviour.drift).toEqual({ pxPerSecond: 2.4, clock: "voyage" });
    expect(submerged.behaviour.span).toEqual(body.behaviour.span);
    expect(submerged.behaviour.frames.frameMs).toBe(body.behaviour.frames.frameMs);
    expect(submerged.behaviour.frames.clock).toBe(body.behaviour.frames.clock);
    expect(body.behaviour.frames).toMatchObject({ frameMs: 500, clock: "swell" });
    expect(submerged.behaviour.variants?.map(({ frames: _frames, ...rest }) => rest))
      .toEqual(body.behaviour.variants?.map(({ frames: _frames, ...rest }) => rest));
    for (const element of [body, submerged]) {
      expect(element.lite).toBe("hide");
      expect(element.still).toBe("hide");
    }
    const above = [...body.behaviour.frames.sprites, ...body.behaviour.variants!.flatMap(variant => variant.frames)];
    const below = [...submerged.behaviour.frames.sprites, ...submerged.behaviour.variants!.flatMap(variant => variant.frames)];
    expect(below).toHaveLength(above.length);
    above.forEach((sprite, index) => {
      const [x, y, width, height] = sprite.rect!;
      expect(height).toBe(60);
      expect(sprite.image).toBe("voyage-umibozu");
      expect(below[index]).toEqual({ image: sprite.image, rect: [x, y + height, width, 80 - height] });
    });
  });

  it("uses the existing opaque sea in every day phase, with no replacement water art", () => {
    if (sea.behaviour.kind !== "backdrop-cycle") throw Error("expected sea backdrop");
    for (const id of new Set(Object.values(sea.behaviour.phases))) {
      const pixels = decodePng(readFileSync(new URL(pack.images[id]!.path, directory)));
      for (let y = sea.behaviour.placement.horizonRow; y < pixels.height; y++) {
        for (let x = 0; x < pixels.width; x++) {
          if (pixels.alpha(x, y) !== 255) throw Error(`${id} sea is transparent at ${x},${y}`);
        }
      }
    }
  });
});
