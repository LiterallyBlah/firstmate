/** Historical manifest adapters for regression tests only. Never imported by the runtime or shipped in the package. */
import type { SettingManifest } from "../shared/deck-setting";
import type { DeckExtrasManifest } from "./deck-legacy-schema";

export type { DeckExtrasManifest } from "./deck-legacy-schema";

/** The extras as the mount hands them over: what the view says, and each image that decoded. */
export interface DeckExtrasImages {
  manifest: DeckExtrasManifest;
  images: ReadonlyMap<string, unknown>;
}

/** Every image the extras manifest names, once each, in a stable order. */
export function extrasImagePaths(manifest: DeckExtrasManifest): string[] {
  const exit = manifest.exit === undefined ? [] : [...Object.values(manifest.exit.shark.frames), ...Object.values(manifest.exit.splash.frames)];
  return [...new Set(exit)];
}

/** The manifest a pack is read as, and each of its images' path by id. */
export interface LegacyViews {
  extras: DeckExtrasManifest;
  /** Image id → its path in the pack, the key the view names it by. */
  paths: ReadonlyMap<string, string>;
}

/**
 * A pack read as the extras' manifest the engine drew from before packs: the shark and the splash the plank's way off
 * draws, found by name (its effects `shark` and `splash`); a pack without them has none.
 */
export function legacyViews(manifest: SettingManifest): LegacyViews {
  const paths = new Map(Object.entries(manifest.images).map(([id, image]) => [id, image.path]));
  const path = (id: string) => {
    const found = paths.get(id);
    if (found === undefined) throw new Error(`the setting has no image ${id}`);
    return found;
  };
  const pair = (point: readonly [number, number]): [number, number] => [point[0], point[1]];
  const shark = manifest.effects.shark;
  const splash = manifest.effects.splash;
  const point = (effect: { points: Record<string, readonly [number, number]> }, name: string): [number, number] => pair(effect.points[name] ?? [0, 0]);
  const frameOf = (effect: { frames: Record<string, { image: string }> }, name: string) => path(effect.frames[name]?.image ?? "");
  const extras: DeckExtrasManifest =
    shark === undefined || splash === undefined
      ? {}
      : {
          exit: {
            shark: {
              size: pair(shark.size),
              anchor: point(shark, "anchor"),
              mouth: [point(shark, "mouth")[0] - point(shark, "anchor")[0], point(shark, "mouth")[1] - point(shark, "anchor")[1]] as [number, number],
              frames: { fin: frameOf(shark, "fin"), surface: frameOf(shark, "surface"), chomp: frameOf(shark, "chomp"), submerge: frameOf(shark, "submerge") },
            },
            splash: { size: pair(splash.size), anchor: point(splash, "anchor"), frames: { impact: frameOf(splash, "impact"), burst: frameOf(splash, "burst") } },
          },
        };
  return { extras, paths };
}
