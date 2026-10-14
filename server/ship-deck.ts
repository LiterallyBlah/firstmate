/**
 * The ship deck's switch: `FIRSTMATE_SHIP_DECK` in the daemon's environment, **off by default** — and
 * the two things the deck needs from the daemon while it is on: PixiJS's browser build, and its art.
 *
 * The deck itself is client-side (`client/ship-deck.tsx`), drawn from the cards the board already loads;
 * the client cannot read the daemon's environment, so the fleet load carries the switch. Off, nothing
 * changes: the load is the very object it was, with no `shipDeck` key, the screen offers no Deck, and
 * `firstmate.deck.engine` and `firstmate.deck.art` refuse, so no Pixi or art is ever read, sent or evaluated.
 *
 * **Pixi is served, not bundled.** The client bundle is one script that a phone's Hermes must parse whole,
 * and React Native 0.81's `hermesc` refuses Pixi's `class` syntax by default; see `client/deck-pixi.ts`. So the
 * plugin ships Pixi's prebuilt browser build as a file, `vendor/pixi.min.js`, found beside `templates/`
 * (the same `paseo plugin ls` lookup), read once per process and sent to a web renderer that opens the deck.
 *
 * **So is the art**, for the same reason and to keep the bundle small: `art/ship-deck/deck.png`, one
 * atlas of about 84 KB, and `deck.json`, its manifest, are read once per process and sent as base64 and
 * JSON (`readDeckArt`). Neither is in the client bundle. The generated sea, sky and gull likewise:
 * `art/ship-deck/environment.json` and the ten small PNGs it draws with, about 50 KB together, read once
 * per process and sent as base64 (`readDeckEnvironment`).
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Fleet } from "../shared/fleet";
import {
  DeckArtManifestSchema,
  DeckEnvironmentManifestSchema,
  environmentImagePaths,
  type DeckArt,
  type DeckEngineSource,
  type DeckEnvironment,
} from "../shared/ship-deck";
import { templatesDirectory } from "./templates";

export const SHIP_DECK_ENV = "FIRSTMATE_SHIP_DECK";

/** Where the vendored Pixi build sits, relative to the plugin's folder. */
export const PIXI_BUILD = "vendor/pixi.min.js";
/** Where the deck's art sits, likewise: the atlas and its manifest, built by `docs/ship-deck-art/build-art.py`. */
export const DECK_ATLAS = "art/ship-deck/deck.png";
export const DECK_MANIFEST = "art/ship-deck/deck.json";
/** The generated environment's manifest; the images it names are relative to its folder. */
export const DECK_ENVIRONMENT_DIR = "art/ship-deck";
export const DECK_ENVIRONMENT_MANIFEST = "art/ship-deck/environment.json";

/** The switch. Anything but an explicit yes is off, as for the receipt journal. */
export function shipDeckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|on|yes)$/i.test((env[SHIP_DECK_ENV] ?? "").trim());
}

/** The fleet as the screen gets it: unchanged while the switch is off, marked `shipDeck` while it is on. */
export function withShipDeck(fleet: Fleet, env: NodeJS.ProcessEnv = process.env): Fleet {
  return shipDeckEnabled(env) ? { ...fleet, shipDeck: true } : fleet;
}

/**
 * The build as the client evaluates it: its version from the banner, the source map comment dropped (the
 * map is not shipped) and a `sourceURL` named for DevTools.
 */
export function deckEngineSource(build: string): DeckEngineSource {
  const version = /PixiJS - v(\d+\.\d+\.\d+)/.exec(build.slice(0, 2000))?.[1];
  if (version === undefined) throw new Error(`${PIXI_BUILD} is not a PixiJS build. Reinstall the plugin.`);
  const source = build.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n");
  return { version, source: `${source}//# sourceURL=firstmate-pixi-${version}.js\n` };
}

/** The build read from each plugin folder, once per process; a failed read is not kept. */
const cache = new Map<string, Promise<DeckEngineSource>>();

function refuseWhenOff(env: NodeJS.ProcessEnv): void {
  if (!shipDeckEnabled(env)) {
    throw new Error(`The ship deck is off; set ${SHIP_DECK_ENV}=1 for the daemon to use it.`);
  }
}

const defaultRoot = () => templatesDirectory().then(dirname);

/** The vendored build, for `firstmate.deck.engine`. Refused while the switch is off, before anything is read. */
export async function readDeckEngine(
  env: NodeJS.ProcessEnv = process.env,
  pluginRoot: () => Promise<string> = defaultRoot,
): Promise<DeckEngineSource> {
  refuseWhenOff(env);
  const root = await pluginRoot();
  let read = cache.get(root);
  if (read === undefined) {
    read = readFile(join(root, PIXI_BUILD), "utf8").then(deckEngineSource);
    cache.set(root, read);
    read.catch(() => cache.delete(root));
  }
  return read;
}

/** The art read from each plugin folder, once per process; a failed read is not kept. */
const artCache = new Map<string, Promise<DeckArt>>();

/** The atlas and its manifest, checked against the contract, for `firstmate.deck.art`. Refused while the switch is off, before anything is read. */
export async function readDeckArt(
  env: NodeJS.ProcessEnv = process.env,
  pluginRoot: () => Promise<string> = defaultRoot,
): Promise<DeckArt> {
  refuseWhenOff(env);
  const root = await pluginRoot();
  let read = artCache.get(root);
  if (read === undefined) {
    read = Promise.all([readFile(join(root, DECK_ATLAS)), readFile(join(root, DECK_MANIFEST), "utf8")]).then(function ([png, manifest]) {
      return { png: png.toString("base64"), manifest: DeckArtManifestSchema.parse(JSON.parse(manifest)) };
    });
    artCache.set(root, read);
    read.catch(() => artCache.delete(root));
  }
  return read;
}

/** The environment read from each plugin folder, once per process; a failed read is not kept. */
const environmentCache = new Map<string, Promise<DeckEnvironment>>();

/**
 * The generated sea, sky and gull, for `firstmate.deck.environment`: the manifest checked against the
 * contract — whose paths cannot leave `art/ship-deck/` — and every image it names. Refused while the
 * switch is off, before anything is read.
 */
export async function readDeckEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  pluginRoot: () => Promise<string> = defaultRoot,
): Promise<DeckEnvironment> {
  refuseWhenOff(env);
  const root = await pluginRoot();
  let read = environmentCache.get(root);
  if (read === undefined) {
    read = readFile(join(root, DECK_ENVIRONMENT_MANIFEST), "utf8").then(async function (text) {
      const manifest = DeckEnvironmentManifestSchema.parse(JSON.parse(text));
      const paths = environmentImagePaths(manifest);
      const images = await Promise.all(paths.map((path) => readFile(join(root, DECK_ENVIRONMENT_DIR, path))));
      return { manifest, images: Object.fromEntries(paths.map((path, index) => [path, images[index]!.toString("base64")])) };
    });
    environmentCache.set(root, read);
    read.catch(() => environmentCache.delete(root));
  }
  return read;
}
