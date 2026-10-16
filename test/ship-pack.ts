/** Ship pack fixtures and historical manifest views for regression tests. */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { legacyViews, type LegacyViews } from "./deck-legacy";
import { compileAmbience, type Behaviour, type DeckAmbience } from "../client/deck-ambience";
import { compileCast, type DeckCast } from "../client/deck-cast";
import { choreography, compileStage, type DeckStage } from "../client/deck-stage";
import type { PlankMarks } from "./ship-choreography";
import { SettingManifestSchema, type AmbienceBehaviour, type SettingManifest } from "../shared/deck-setting";

/** The pack's folder. */
export const SHIP_PACK = fileURLToPath(new URL("./fixtures/ship-baseline/", import.meta.url));

/** A file in the pack, by its path there. */
export function shipFile(path: string): string {
  return fileURLToPath(new URL(path, new URL("./fixtures/ship-baseline/", import.meta.url)));
}

let manifest: SettingManifest | null = null;
let views: LegacyViews | null = null;
let stage: DeckStage | null = null;

export function shipManifest(): SettingManifest {
  manifest ??= SettingManifestSchema.parse(JSON.parse(readFileSync(shipFile("setting.json"), "utf8")));
  return manifest;
}

/** Historical extras shape for art regression tests; the engine reads only the pack. */
export function shipViews(): LegacyViews {
  views ??= legacyViews(shipManifest());
  return views;
}

/** The ship's stage, compiled: its floor, zones, entry and exits, as the engine runs on them. */
export function shipStage(): DeckStage {
  stage ??= compileStage(shipManifest());
  return stage;
}

/** The ship's plank, its marks as the crew walks them. */
export function shipPlankMarks(): PlankMarks {
  const { marks } = choreography(shipStage(), "plank");
  return { foot: marks.foot!, rail: marks.rail!, tip: marks.tip!, water: marks.water! };
}

/** Every image the pack serves, base64 by id, as `firstmate.deck.setting` sends them. */
export function shipImages(): Record<string, string> {
  return Object.fromEntries(Object.entries(shipManifest().images).map(([id, image]) => [id, readFileSync(shipFile(image.path)).toString("base64")]));
}

let cast: DeckCast | null = null;

/** The ship's cast, compiled: its lanes, looks, roles, fidgets and breath, as the engine draws them. */
export function shipCast(): DeckCast {
  cast ??= compileCast(shipManifest());
  return cast;
}

let ambience: DeckAmbience | null = null;

/** The ship's ambience, compiled with every image there: its elements in order, and its day. */
export function shipAmbience(): DeckAmbience {
  ambience ??= compileAmbience(shipManifest(), () => true);
  return ambience;
}

/** One element of the ship's ambience, by id, as the pack writes it: its behaviour of `kind`. */
export function shipElement<K extends AmbienceBehaviour["kind"]>(id: string, kind: K): Behaviour<K> {
  const element = shipManifest().ambience.find((each) => each.id === id);
  if (element?.behaviour.kind !== kind) throw new Error(`the ship has no ${kind} ${id}`);
  return element.behaviour as Behaviour<K>;
}

/** The ship's horizon and waterline, in deck rows: its sea's tile origin, and where its front band starts. */
export function shipWater(): { horizon: number; waterline: number } {
  const sea = shipElement("sea", "tile");
  return { horizon: sea.origin, waterline: sea.bands.find((band) => band.slot === "front")!.fromRow };
}
