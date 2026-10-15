/**
 * What the ship deck needs from the daemon: PixiJS's browser build, and its art.
 *
 * The deck itself is client-side (`client/ship-deck.tsx`), drawn from the cards the board already loads.
 * It is a standard part of the screen, offered in the desktop app's wide layout (`deckOffered`); the
 * `FIRSTMATE_SHIP_DECK` switch it began behind is gone, and the daemon no longer reads it. The fleet load
 * carries nothing for the deck. These reads are what its RPCs answer with.
 *
 * **Pixi is served, not bundled.** The client bundle is one script that a phone's Hermes must parse whole,
 * and React Native 0.81's `hermesc` refuses Pixi's `class` syntax by default; see `client/deck-pixi.ts`. So the
 * plugin ships Pixi's prebuilt browser build as a file, `vendor/pixi.min.js`, found beside `templates/`
 * (the same `paseo plugin ls` lookup), read once per process and sent to a web renderer that opens the deck.
 * A phone never opens it, so never asks.
 *
 * **So is the art**, for the same reason and to keep the bundle small: `art/ship-deck/deck.png`, one
 * atlas of about 84 KB, and `deck.json`, its manifest, are read once per process and sent as base64 and
 * JSON (`readDeckArt`). Neither is in the client bundle. The generated sea, sky and gull likewise:
 * `art/ship-deck/environment.json` and the ten small PNGs it draws with, about 50 KB together, read once
 * per process and sent as base64 (`readDeckEnvironment`). And the sail, the crew's extra looks, and the
 * shark and splash of the way off by the plank: `art/ship-deck/extras.json` and the fourteen PNGs it names,
 * about 35 KB, the same way (`readDeckExtras`).
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  DeckArtManifestSchema,
  DeckEnvironmentManifestSchema,
  DeckExtrasManifestSchema,
  environmentImagePaths,
  extrasImagePaths,
  type DeckArt,
  type DeckEngineSource,
  type DeckEnvironment,
  type DeckExtras,
} from "../shared/ship-deck";
import { templatesDirectory } from "./templates";

/** Where the vendored Pixi build sits, relative to the plugin's folder. */
export const PIXI_BUILD = "vendor/pixi.min.js";
/** Where the deck's art sits, likewise: the atlas and its manifest, built by `docs/ship-deck-art/build-art.py`. */
export const DECK_ATLAS = "art/ship-deck/deck.png";
export const DECK_MANIFEST = "art/ship-deck/deck.json";
/** The generated environment's manifest; the images it names are relative to its folder. */
export const DECK_ENVIRONMENT_DIR = "art/ship-deck";
export const DECK_ENVIRONMENT_MANIFEST = "art/ship-deck/environment.json";
/** The sail and the crew's extra looks; the images it names are relative to the same folder. */
export const DECK_EXTRAS_MANIFEST = "art/ship-deck/extras.json";

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

const defaultRoot = () => templatesDirectory().then(dirname);

/** The vendored build, for `firstmate.deck.engine`. */
export async function readDeckEngine(pluginRoot: () => Promise<string> = defaultRoot): Promise<DeckEngineSource> {
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

/** The atlas and its manifest, checked against the contract, for `firstmate.deck.art`. */
export async function readDeckArt(pluginRoot: () => Promise<string> = defaultRoot): Promise<DeckArt> {
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
 * contract — whose paths cannot leave `art/ship-deck/` — and every image it names.
 */
export async function readDeckEnvironment(pluginRoot: () => Promise<string> = defaultRoot): Promise<DeckEnvironment> {
  const root = await pluginRoot();
  let read = environmentCache.get(root);
  if (read === undefined) {
    read = readManifestImages(root, DECK_ENVIRONMENT_MANIFEST, (json) => DeckEnvironmentManifestSchema.parse(json), environmentImagePaths);
    environmentCache.set(root, read);
    read.catch(() => environmentCache.delete(root));
  }
  return read;
}

/** A manifest in `art/ship-deck/`, parsed, and every image it names there, base64, keyed by its path. */
async function readManifestImages<M>(root: string, file: string, parse: (json: unknown) => M, paths: (manifest: M) => string[]) {
  const manifest = parse(JSON.parse(await readFile(join(root, file), "utf8")));
  const names = paths(manifest);
  const images = await Promise.all(names.map((path) => readFile(join(root, DECK_ENVIRONMENT_DIR, path))));
  return { manifest, images: Object.fromEntries(names.map((path, index) => [path, images[index]!.toString("base64")])) };
}

/** The extras read from each plugin folder, once per process; a failed read is not kept. */
const extrasCache = new Map<string, Promise<DeckExtras>>();

/**
 * The sail, the crew's extra looks and the shark and splash, for `firstmate.deck.extras`: the manifest checked against the
 * contract — whose paths cannot leave `art/ship-deck/` either — and every image it names.
 */
export async function readDeckExtras(pluginRoot: () => Promise<string> = defaultRoot): Promise<DeckExtras> {
  const root = await pluginRoot();
  let read = extrasCache.get(root);
  if (read === undefined) {
    read = readManifestImages(root, DECK_EXTRAS_MANIFEST, (json) => DeckExtrasManifestSchema.parse(json), extrasImagePaths);
    extrasCache.set(root, read);
    read.catch(() => extrasCache.delete(root));
  }
  return read;
}
