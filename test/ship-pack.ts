/**
 * The ship's setting pack for the tests: its folder, its manifest checked whole, and the manifests the engine still
 * draws from (`legacyViews`), read once.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { legacyViews, type LegacyViews } from "../client/deck-legacy";
import { SettingManifestSchema, type SettingManifest } from "../shared/deck-setting";

/** The pack's folder. */
export const SHIP_PACK = fileURLToPath(new URL("../art/settings/ship/", import.meta.url));

/** A file in the pack, by its path there. */
export function shipFile(path: string): string {
  return fileURLToPath(new URL(path, new URL("../art/settings/ship/", import.meta.url)));
}

let manifest: SettingManifest | null = null;
let views: LegacyViews | null = null;

export function shipManifest(): SettingManifest {
  manifest ??= SettingManifestSchema.parse(JSON.parse(readFileSync(shipFile("setting.json"), "utf8")));
  return manifest;
}

/** The atlas's, the environment's and the extras' manifests, as the engine draws them. */
export function shipViews(): LegacyViews {
  views ??= legacyViews(shipManifest());
  return views;
}

/** Every image the pack serves, base64 by id, as `firstmate.deck.setting` sends them. */
export function shipImages(): Record<string, string> {
  return Object.fromEntries(Object.entries(shipManifest().images).map(([id, image]) => [id, readFileSync(shipFile(image.path)).toString("base64")]));
}
