import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "./png";

const pack = new URL("../art/settings/ghost-ship/", import.meta.url);
const read = (id: string) => decodePng(readFileSync(fileURLToPath(new URL(`${id}.png`, pack))));

describe("Ghost ship's registered motion", () => {
  // Particle rain's art registration and downward travel are checked for every scene in deck-rain.test.ts.

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
