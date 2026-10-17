import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { SettingManifestSchema } from "../shared/deck-setting";
import { createPrecip } from "../client/deck-precip";
import { decodePng } from "./png";

describe.each([["ship", .55], ["japanese-ship", .55], ["sky-airship", .6], ["ghost-ship", .5]] as const)("%s particle rain", (id, threshold) => {
  it("keeps its onset and motion policy, with 36 distinct authored drops and no tiled rain", () => {
    const root = new URL(`../art/settings/${id}/`, import.meta.url);
    const pack = SettingManifestSchema.parse(JSON.parse(readFileSync(new URL("setting.json", root), "utf8")));
    const rain = pack.ambience.find((element) => element.behaviour.kind === "precip")!;
    expect([rain.lite, rain.still]).toEqual(["freeze", "hide"]);
    expect(pack.requires).toContain("precip@1");
    expect(Object.keys(pack.images).filter((key) => /^rain-[0-3]$/.test(key))).toEqual([]);
    const definition = rain.behaviour;
    if (definition.kind !== "precip") throw new Error("particle rain");
    expect(definition.opacity[0]).toEqual([threshold, 0]);
    expect(definition.drops).toHaveLength(36);
    expect(definition.kinds.map((kind) => kind.id)).toEqual(["drizzle", "rain", "downpour"]);
    const atlas = decodePng(readFileSync(new URL(pack.images["rain-drops"]!.path, root)));
    const signatures = new Set<string>();
    for (const drop of definition.drops) {
      const [x, y, w, h] = drop.sprite.rect!;
      const pixels = Array.from({ length: h }, (_, row) => [...atlas.rgba.subarray(((y + row) * atlas.width + x) * 4, ((y + row) * atlas.width + x + w) * 4)]).flat();
      signatures.add(pixels.join(","));
      expect(atlas.alpha(x + drop.anchor[0], y + drop.anchor[1])).toBeGreaterThan(0);
    }
    expect(signatures.size).toBe(36);
    const field = createPrecip(definition, id, 123);
    field.layout({ left: -200, right: 800, top: -300, bottom: 600 }, { width: 1600, height: 900 });
    field.draw(0, 1, "run");
    const before = structuredClone(field.drops);
    field.draw(1 / 30, 1, "run");
    field.drops.forEach((drop, i) => {
      if (drop.alpha <= 0 || drop.life !== before[i]!.life || Math.abs(drop.x - before[i]!.x) > 30) return;
      expect(drop.y).toBeGreaterThan(before[i]!.y);
      expect(Math.sign(drop.x - before[i]!.x)).toBe(Math.sign(definition.wind.angle));
      expect((drop.x - before[i]!.x) / (drop.y - before[i]!.y)).toBeCloseTo(Math.tan(drop.angle * Math.PI / 180));
    });
  });
});
