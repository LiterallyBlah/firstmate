import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { expect, it } from "vitest";
import { SettingManifestSchema } from "../shared/deck-setting";
import { decodePng } from "./png";

it("keeps Sakura's eight looks inside their pose crops without adjacent-frame bleed", () => {
  const directory = new URL("../art/settings/japanese-ship/", import.meta.url);
  const pack = SettingManifestSchema.parse(JSON.parse(readFileSync(new URL("setting.json", directory), "utf8")));
  expect(pack.cast.looks.map(look => look.id)).toEqual(["kasa", "cook", "elder", "rigger", "fisher", "padded", "moss", "ochre"]);
  for (const look of pack.cast.looks) {
    const image = decodePng(readFileSync(new URL(pack.images[look.image]!.path, directory)));
    expect([image.width, image.height]).toEqual([480, 36]);
    const poses = Object.values(pack.cast.lanes[look.lane]!);
    expect(poses).toHaveLength(15);
    for (const { rect: [left, top, width, height], feet } of poses) {
      expect(top + feet[1], `${look.id} feet baseline`).toBe(34);
      let pixels = 0;
      for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) if (image.alpha(x, y)) pixels++;
      expect(pixels, `${look.id} nonempty pose at ${left}`).toBeGreaterThan(0);
    }
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const alpha = image.alpha(x, y);
      if (alpha === 0) continue;
      expect(alpha, `${look.id} opaque pixel`).toBe(255);
      expect(poses.some(({ rect: [left, top, width, height] }) => x >= left && x < left + width && y >= top && y < top + height),
        `${look.id} stray pixel at ${x},${y}`).toBe(true);
    }
  }
});
