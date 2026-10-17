import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "./png";

const pack = new URL("../art/settings/ghost-ship/", import.meta.url);
const read = (id: string) => decodePng(readFileSync(fileURLToPath(new URL(`${id}.png`, pack))));

describe("Ghost ship's registered motion", () => {
  it("moves every rain pixel downward through all four transitions, including the loop", () => {
    const frames = Array.from({ length: 4 }, (_, i) => read(`rain-${i}`));
    for (const [index, from] of frames.entries()) {
      const to = frames[(index + 1) % frames.length]!;
      expect(to.rgba, `transition ${index} moves`).not.toEqual(from.rgba);
      for (let y = 0; y < from.height; y++) {
        const source = from.rgba.subarray(y * from.width * 4, (y + 1) * from.width * 4);
        const row = (y + 8) % from.height;
        expect(to.rgba.subarray(row * to.width * 4, (row + 1) * to.width * 4), `transition ${index}, row ${y}`).toEqual(source);
      }
    }
  });

  it("keeps the right half of the crow's nest on the fixed mast, outside every flutter frame", () => {
    const fixed = read("fixed");
    let basketPixels = 0;
    for (let y = 28; y < 58; y++) for (let x = 0; x < 22; x++) {
      if (fixed.rgba[((y + 30) * fixed.width + x + 302) * 4 + 3]) basketPixels++;
    }
    expect(basketPixels).toBeGreaterThan(100);
    for (let frame = 0; frame < 4; frame++) {
      const flag = read(`flag-main-${frame}`);
      for (let y = 28; y < 58; y++) for (let x = 0; x < 18; x++) {
        expect(flag.rgba[(y * flag.width + x) * 4 + 3], `basket in flutter ${frame} at ${x},${y}`).toBe(0);
      }
    }
  });
});
