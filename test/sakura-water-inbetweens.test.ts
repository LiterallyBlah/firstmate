import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { SettingManifestSchema } from "../shared/deck-setting";
import { decodePng } from "./png";
import keys from "./fixtures/sakura-water-keys.json";

const directory = new URL("../art/settings/japanese-ship/", import.meta.url);
const pack = SettingManifestSchema.parse(JSON.parse(readFileSync(new URL("setting.json", directory), "utf8")));

describe("Sakura water in-betweens", () => {
  it("keeps the 1920 ms water loop and registers every row-major pose, including phases and storm", () => {
    for (const id of ["bay-far", "bay-mid", "bay-near"]) {
      const motion = pack.ambience.find(element => element.id === id)!.behaviour;
      if (motion.kind !== "phase-strip" && motion.kind !== "tile") throw Error("expected water");
      expect(motion.frames.clock).toBe("water");
      expect(motion.frames.frameMs).toBe(80);
      const sets = [motion.frames.sprites];
      if (motion.kind === "tile") sets.push(...(motion.variants ?? []).map(variant => variant.frames));
      if (motion.kind === "phase-strip") sets.push(...Object.values(motion.byPhase));
      for (const frames of sets) {
        expect(frames.length * motion.frames.frameMs).toBe(1920);
        const [width, height] = pack.images[frames[0]!.image]!.size;
        frames.forEach((sprite, index) => expect(sprite.rect).toEqual([
          index % 4 * width / 4, Math.floor(index / 4) * height / 6, width / 4, height / 6,
        ]));
      }
    }
  });

  for (const [id, hashes] of Object.entries(keys)) {
    it(`${id} preserves the six approved poses and limits each step, including the wrap`, () => {
      const atlas = decodePng(readFileSync(new URL(pack.images[id]!.path, directory)));
      const width = atlas.width / 4, height = atlas.height / 6;
      const frames = Array.from({ length: 24 }, (_, index) => {
        const frame = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
          const start = ((Math.floor(index / 4) * height + y) * atlas.width + index % 4 * width) * 4;
          frame.set(atlas.rgba.subarray(start, start + width * 4), y * width * 4);
        }
        return frame;
      });
      hashes.forEach((hash, index) => expect(createHash("sha256").update(frames[index * 4]!).digest("hex")).toBe(hash));
      for (let index = 0; index < frames.length; index++) {
        const current = frames[index]!, next = frames[(index + 1) % frames.length]!;
        let changed = 0;
        for (let pixel = 0; pixel < current.length; pixel += 4) {
          if (current.subarray(pixel, pixel + 4).some((value, channel) => value !== next[pixel + channel])) changed++;
        }
        expect(changed / (width * height)).toBeLessThan(.15);
      }
    });
  }
});
