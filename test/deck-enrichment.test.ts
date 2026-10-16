import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { shipElement, shipFile, shipManifest } from "./ship-pack";
import { decodePng } from "./png";

const ship = shipManifest();
const palette = JSON.parse(readFileSync(new URL("../docs/ship-deck-art/legacy/environment.json", import.meta.url), "utf8")).palette;
const allowed = new Set<string>([...palette.deckColours, ...palette.environmentExtension]);
const png = (id: string) => decodePng(readFileSync(shipFile(ship.images[id]!.path)));

describe("registered enrichment art", () => {
  it("uses the ship's exact palette, hard transparency and two clear border pixels", () => {
    for (const id of Object.keys(ship.images).filter((id) => id.startsWith("enrichment-") || id.startsWith("below-deck-"))) {
      const frame = png(id);
      let visible = 0;
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
        const at = (y * frame.width + x) * 4;
        const alpha = frame.rgba[at + 3];
        expect([0, 255], id).toContain(alpha);
        if (x < 2 || y < 2 || x >= frame.width - 2 || y >= frame.height - 2) expect(alpha, id).toBe(0);
        if (alpha) {
          visible++;
          const hex = "#" + [...frame.rgba.slice(at, at + 3)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
          expect(allowed.has(hex), `${id}: ${hex}`).toBe(true);
        }
      }
      expect(visible, id).toBeGreaterThan(20);
    }
  });

  it("registers silhouettes and surfaced frames pixel for pixel inside the existing fit", () => {
    for (const id of ["serpent", "kraken"]) {
      const cycle = shipElement(`weather-${id}`, "cycle");
      for (let frame = 0; frame < 4; frame++) {
        const body = png(`enrichment-${id}-${frame}`), shadow = png(`enrichment-${id}-loom-${frame}`);
        expect([body.width, body.height]).toEqual([shadow.width, shadow.height]);
        for (let y = 0; y < body.height; y++) for (let x = 0; x < body.width; x++) expect(body.alpha(x, y)).toBe(shadow.alpha(x, y));
        expect(cycle.at[0] - cycle.anchor[0]).toBeGreaterThanOrEqual(0);
        expect(cycle.at[0] - cycle.anchor[0] + body.width).toBeLessThanOrEqual(ship.stage.size[0]);
        expect(cycle.at[1] - cycle.anchor[1] + body.height).toBeLessThanOrEqual(ship.stage.fit.bottom);
      }
    }
  });
});
