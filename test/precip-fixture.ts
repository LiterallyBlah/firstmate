/** Temporary test sprites cut from the existing ship rain tile, never shipped as new art. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import type { SettingManifest } from "../shared/deck-setting";
import { capabilitiesUsed } from "../shared/deck-setting";
import type { Precip } from "../client/deck-precip";
import { shipManifest } from "./ship-pack";

export const precipFixture: Precip = {
  kind: "precip", opacity: [[0.55, 0], [1, 0.85]],
  wind: { angle: 18, jitter: 4, gust: 7, periodS: 13 },
  drops: ["far", "mid", "near"].map((depth) => ({ id: depth, depth: depth as "far" | "mid" | "near",
    sprite: { image: "rain-test", rect: [6, 0, 5, 8] }, angle: 27, anchor: [4, 7], length: 8 })),
  kinds: [
    { id: "drizzle", at: 0.55, density: 24, speed: [60, 95], length: [4, 8], opacity: [0.25, 0.5], depth: [0.4, 1], drops: ["far", "mid", "near"] },
    { id: "rain", at: 0.78, density: 48, speed: [95, 150], length: [8, 15], opacity: [0.4, 0.8], depth: [0.4, 1.2], drops: ["far", "mid", "near"] },
    { id: "downpour", at: 1, density: 90, speed: [160, 260], length: [13, 24], opacity: [0.6, 1], depth: [0.45, 1.4], drops: ["far", "mid", "near"] },
  ],
};
export const rainTile = readFileSync(new URL("./fixtures/precip/rain-tile.png", import.meta.url));
export function precipManifest(): SettingManifest {
  const manifest = structuredClone(shipManifest());
  manifest.images["rain-test"] = { path: "rain-tile.png", size: [96, 64], sha256: createHash("sha256").update(rainTile).digest("hex") };
  manifest.ambience.push({ id: "test-rain", slot: "front", order: 99, lite: "freeze", still: "hide", behaviour: structuredClone(precipFixture) });
  manifest.requires = capabilitiesUsed(manifest);
  return manifest;
}
