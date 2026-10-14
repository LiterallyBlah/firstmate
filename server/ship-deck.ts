/**
 * The ship deck's switch: `FIRSTMATE_SHIP_DECK` in the daemon's environment, **off by default** — and
 * the one thing the deck needs from the daemon while it is on, PixiJS's browser build.
 *
 * The deck itself is client-side (`client/ship-deck.tsx`), drawn from the cards the board already loads;
 * the client cannot read the daemon's environment, so the fleet load carries the switch. Off, nothing
 * changes: the load is the very object it was, with no `shipDeck` key, the screen offers no Deck, and
 * `firstmate.deck.engine` refuses, so no Pixi is ever read, sent or evaluated.
 *
 * **Pixi is served, not bundled.** The client bundle is one script that a phone's Hermes must parse whole,
 * and React Native 0.81's `hermesc` refuses Pixi's `class` syntax by default; see `client/deck-pixi.ts`. So the
 * plugin ships Pixi's prebuilt browser build as a file, `vendor/pixi.min.js`, found beside `templates/`
 * (the same `paseo plugin ls` lookup), read once per process and sent to a web renderer that opens the deck.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Fleet } from "../shared/fleet";
import type { DeckEngineSource } from "../shared/ship-deck";
import { templatesDirectory } from "./templates";

export const SHIP_DECK_ENV = "FIRSTMATE_SHIP_DECK";

/** Where the vendored Pixi build sits, relative to the plugin's folder. */
export const PIXI_BUILD = "vendor/pixi.min.js";

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

/** The vendored build, for `firstmate.deck.engine`. Refused while the switch is off, before anything is read. */
export async function readDeckEngine(
  env: NodeJS.ProcessEnv = process.env,
  pluginRoot: () => Promise<string> = () => templatesDirectory().then(dirname),
): Promise<DeckEngineSource> {
  if (!shipDeckEnabled(env)) {
    throw new Error(`The ship deck is off; set ${SHIP_DECK_ENV}=1 for the daemon to use it.`);
  }
  const root = await pluginRoot();
  let read = cache.get(root);
  if (read === undefined) {
    read = readFile(join(root, PIXI_BUILD), "utf8").then(deckEngineSource);
    cache.set(root, read);
    read.catch(() => cache.delete(root));
  }
  return read;
}
