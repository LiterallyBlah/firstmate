/**
 * What the Deck needs from the daemon: PixiJS's browser build, and the setting packs it draws.
 *
 * The deck itself is client-side (`client/ship-deck.tsx`), drawn from the cards the board already loads. It is a
 * standard part of the screen, offered in the desktop app's wide layout (`deckOffered`); the `FIRSTMATE_SHIP_DECK`
 * switch it began behind is gone, and the daemon no longer reads it. The fleet load carries nothing for the deck.
 *
 * **Pixi is served, not bundled.** The client bundle is one script that a phone's Hermes must parse whole, and React
 * Native 0.81's `hermesc` refuses Pixi's `class` syntax by default; see `client/deck-pixi.ts`. So the plugin ships
 * Pixi's prebuilt browser build as a file, `vendor/pixi.min.js`, found beside `templates/` (the same `paseo plugin ls`
 * lookup), read once per process and sent to a web renderer that opens the deck. A phone never opens it, so never asks.
 *
 * **So are the settings** (`shared/deck-setting.ts`, served by `shared/deck-rpc.ts`'s contracts), for the same reason and to keep the bundle small. Each pack is a
 * folder of `art/settings/` beside it: `setting.json` and the PNGs it names, every one inside the folder. Listed
 * (`listDeckSettings`) and read (`readDeckSetting`) once per process, and sent whole: the manifest, and every image
 * by its id, base64. Only ids the scan found are read, a path that would leave its pack is refused, and no pack may
 * serve more than `PACK_BYTES_MAX` of images, so one cannot balloon the WebSocket message. A pack this engine cannot
 * draw — a newer format, a behaviour it does not have — is listed as incompatible and refused.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { z } from "zod";

import type { DeckEngineSource, DeckSetting, DeckSettingSummary } from "../shared/deck-rpc";
import { incompatibility, SettingId, SettingManifestSchema, settingImageIds, type SettingManifest } from "../shared/deck-setting";
import { templatesDirectory } from "./templates";

/** Where the vendored Pixi build sits, relative to the plugin's folder. */
export const PIXI_BUILD = "vendor/pixi.min.js";
/** Where the setting packs sit, relative to the plugin's folder: one folder each, named by its id. */
export const SETTINGS_DIR = "art/settings";
/** Each pack's manifest, in its folder. */
export const SETTING_MANIFEST = "setting.json";
/**
 * Raw image budget. The 2 MB fixture measures 2,708,070 JSON bytes / 3,610,816 relay bytes:
 * under 11% of Cloudflare's 32 MiB message limit, with Paseo 0.11's 64 MiB queue backstop.
 * See docs/deck-pack-budget/README.md for transport sources, measurements and their scope.
 */
export const PACK_BYTES_MAX = 2_000_000;

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

const defaultRoot = () => templatesDirectory().then(dirname);

/** Runs `read` once per key and keeps its answer; a failed read is not kept, so the next call tries again. */
function cached<T>(cache: Map<string, Promise<T>>, key: string, read: () => Promise<T>): Promise<T> {
  let promise = cache.get(key);
  if (promise === undefined) {
    promise = read();
    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
  }
  return promise;
}

/** The build read from each plugin folder, once per process. */
const engineCache = new Map<string, Promise<DeckEngineSource>>();

/** The vendored build, for `firstmate.deck.engine`. */
export async function readDeckEngine(pluginRoot: () => Promise<string> = defaultRoot): Promise<DeckEngineSource> {
  const root = await pluginRoot();
  return cached(engineCache, root, () => readFile(join(root, PIXI_BUILD), "utf8").then(deckEngineSource));
}

/**
 * What a pack says of itself before anything else is read: enough to list it, and to tell whether this engine can
 * draw it at all — a pack in a newer format may not parse as this one.
 */
const PackHead = z.object({ id: z.string(), name: z.string(), version: z.string(), formatVersion: z.number(), requires: z.array(z.string()) });

/** A pack as the server knows it: what it says of itself, why it cannot be drawn, and when it can, its manifest checked whole and its images' bytes. */
type Pack =
  | { head: z.infer<typeof PackHead>; reason: string; manifest: null; images: Record<string, Buffer> }
  | { head: z.infer<typeof PackHead>; reason: null; manifest: SettingManifest; images: Record<string, Buffer> };

/** A path inside the pack's folder, or an error: the schema refuses `..` and absolute paths, and this checks again. */
function inside(folder: string, path: string): string {
  const full = resolve(folder, path);
  const from = relative(folder, full);
  if (from === "" || from.startsWith("..") || isAbsolute(from)) throw new Error(`${path} is not inside its pack`);
  return full;
}

async function readPack(root: string, id: string): Promise<Pack> {
  const folder = join(root, SETTINGS_DIR, id);
  const json: unknown = JSON.parse(await readFile(join(folder, SETTING_MANIFEST), "utf8"));
  const head = PackHead.parse(json);
  if (head.id !== id) throw new Error(`the setting in ${SETTINGS_DIR}/${id} calls itself ${head.id}`);
  const reason = incompatibility(head);
  if (reason !== null) return { head, reason, manifest: null, images: {} };
  const manifest = SettingManifestSchema.parse(json);
  const ids = settingImageIds(manifest);
  const files = await Promise.all(ids.map((image) => readFile(inside(folder, manifest.images[image]!.path))));
  const bytes = files.reduce((sum, file) => sum + file.length, 0);
  if (bytes > PACK_BYTES_MAX) throw new Error(`the setting ${id} serves ${bytes} bytes of images; at most ${PACK_BYTES_MAX}`);
  return { head, reason: null, manifest, images: Object.fromEntries(ids.map((image, index) => [image, files[index]!])) };
}

/** Each pack read from each plugin folder, once per process. */
const packCache = new Map<string, Promise<Pack>>();
/** The packs found in each plugin folder, once per process. */
const scanCache = new Map<string, Promise<string[]>>();

/** The ids of the packs in the plugin's folder: each folder of `art/settings/` with a manifest, by name. */
function scan(root: string): Promise<string[]> {
  return cached(scanCache, root, async function () {
    const entries = await readdir(join(root, SETTINGS_DIR), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && SettingId.safeParse(entry.name).success)
      .map((entry) => entry.name)
      .sort();
  });
}

function pack(root: string, id: string): Promise<Pack> {
  return cached(packCache, `${root}\0${id}`, () => readPack(root, id));
}

/**
 * The installed packs, for `firstmate.deck.settings`: each one's name and version, whether it can be drawn, its
 * preview and size. A pack that will not read is listed by its folder, incompatible, with why.
 */
export async function listDeckSettings(pluginRoot: () => Promise<string> = defaultRoot): Promise<DeckSettingSummary[]> {
  const root = await pluginRoot();
  const ids = await scan(root);
  return Promise.all(
    ids.map((id) =>
      pack(root, id).then(
        (read): DeckSettingSummary => ({
          id,
          name: read.head.name,
          version: read.head.version,
          formatVersion: read.head.formatVersion,
          compatible: read.reason === null,
          reason: read.reason,
          preview: read.manifest?.preview === undefined ? null : (read.images[read.manifest.preview]?.toString("base64") ?? null),
          bytes: Object.values(read.images).reduce((sum, file) => sum + file.length, 0),
        }),
        (error: unknown): DeckSettingSummary => ({
          id,
          name: id,
          version: "",
          formatVersion: 0,
          compatible: false,
          reason: error instanceof Error ? error.message : String(error),
          preview: null,
          bytes: 0,
        }),
      ),
    ),
  );
}

/** One pack, for `firstmate.deck.setting`: its manifest and every image it names, base64, by id. Refused if it cannot be drawn. */
export async function readDeckSetting(id: string, pluginRoot: () => Promise<string> = defaultRoot): Promise<DeckSetting> {
  const root = await pluginRoot();
  if (!SettingId.safeParse(id).success || !(await scan(root)).includes(id)) throw new Error(`there is no deck setting called ${id}`);
  const read = await pack(root, id);
  if (read.manifest === null) throw new Error(`the deck setting ${id} cannot be drawn: ${read.reason}. Update FirstMate.`);
  return { manifest: read.manifest, images: Object.fromEntries(Object.entries(read.images).map(([image, file]) => [image, file.toString("base64")])) };
}
