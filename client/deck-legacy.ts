/**
 * The deck's art as two of the manifests it was once served in — the atlas's (`DeckArtManifest`) and the extras'
 * (`DeckExtrasManifest`) — now read off a setting pack (`shared/deck-setting.ts`) by `legacyViews`, so the engine's
 * modules draw exactly as they did while the move to a scene engine reads the pack directly a part at a time. Each
 * step of that move takes a part out of these views; when they are empty this file goes. The manifests as they were
 * last served are kept as records in `docs/ship-deck-art/legacy/`, and `client/ship-pack.test.ts` holds these views to
 * them. The third, the environment's, went in step 5b: the sea and foam are the pack's own now.
 *
 * Image paths in the views are paths inside the pack's folder, as they once were inside `art/ship-deck/`.
 */
import type { SettingManifest } from "../shared/deck-setting";
import type { DeckArtManifest, DeckExtrasManifest } from "./deck-legacy-schema";

export type { DeckArtManifest, DeckExtrasManifest } from "./deck-legacy-schema";

/** Every image the extras manifest names, once each, in a stable order. */
export function extrasImagePaths(manifest: DeckExtrasManifest): string[] {
  const exit = manifest.exit === undefined ? [] : [...Object.values(manifest.exit.shark.frames), ...Object.values(manifest.exit.splash.frames)];
  const plank = manifest.plank === undefined ? [] : [manifest.plank.texture];
  const mast = manifest.mast === undefined ? [] : [manifest.mast.texture];
  return [...new Set([manifest.sail.texture, ...exit, ...plank, ...mast])];
}

/** The manifests a pack is read as, and each of its images' path by id. */
export interface LegacyViews {
  art: DeckArtManifest;
  extras: DeckExtrasManifest;
  /** Image id → its path in the pack, the key the views name it by. */
  paths: ReadonlyMap<string, string>;
}

type Rect = readonly [number, number, number, number];

/**
 * A pack read as the manifests the engine drew from before packs: the atlas's frames, and the extras' tall mast, sail,
 * shark and splash and plank. Each part is found by what it is, and a part the pack has none of is an error: these
 * views exist only for the ship's own pack. The sky and everything in it, the flyby, the sea, foam, wake and spindrift
 * are the pack's own now (`client/deck-ambience.ts`).
 */
export function legacyViews(manifest: SettingManifest): LegacyViews {
  const paths = new Map(Object.entries(manifest.images).map(([id, image]) => [id, image.path]));
  const path = (id: string) => {
    const found = paths.get(id);
    if (found === undefined) throw new Error(`the setting has no image ${id}`);
    return found;
  };
  const size = (id: string): [number, number] => {
    const image = manifest.images[id];
    if (image === undefined) throw new Error(`the setting has no image ${id}`);
    return [image.size[0], image.size[1]];
  };
  const rect = (sprite: { image: string; rect?: Rect | undefined }): [number, number, number, number] => {
    if (sprite.rect !== undefined) return [sprite.rect[0], sprite.rect[1], sprite.rect[2], sprite.rect[3]];
    const [width, height] = size(sprite.image);
    return [0, 0, width, height];
  };
  const pair = (point: readonly [number, number]): [number, number] => [point[0], point[1]];

  // The atlas: the backdrop and the pieces on it. Its crew and props are the cast's and the stage's now.
  const { stage } = manifest;
  const art: DeckArtManifest = {
    ship: { frame: rect(stage.backdrop.sprite) },
    pieces: Object.fromEntries(
      stage.pieces.flatMap((piece) =>
        piece.baseline === null || typeof piece.baseline === "number"
          ? [[piece.id, { frame: rect(piece.sprite), x: piece.at[0], y: piece.at[1], baseline: piece.baseline }] as const]
          : [],
      ),
    ),
  };

  // The extras.
  const tallMast = stage.parts.find((part) => part.replacesPiece !== undefined && part.cutout !== undefined);
  const topmast = stage.parts.find((part) => part.behaviour?.kind === "sway" && tallMast !== undefined && part.needs?.includes(tallMast.id) === true);
  const sail = stage.parts.find((part) => part.behaviour?.kind === "cycle");
  if (tallMast === undefined || topmast === undefined || sail?.behaviour?.kind !== "cycle") throw new Error("the setting has no tall mast and sail");
  const sailFrames = sail.behaviour.frames;
  const plank = stage.pieces.find((piece) => piece.baseline !== null && typeof piece.baseline === "object");
  const shark = manifest.effects.shark;
  const splash = manifest.effects.splash;
  const point = (effect: { points: Record<string, readonly [number, number]> }, name: string): [number, number] => pair(effect.points[name] ?? [0, 0]);
  const frameOf = (effect: { frames: Record<string, { image: string }> }, name: string) => path(effect.frames[name]?.image ?? "");
  const extras: DeckExtrasManifest = {
    sail: {
      texture: path(sail.sprite.image),
      frameSize: [rect(sailFrames.sprites[0]!)[2], rect(sailFrames.sprites[0]!)[3]],
      frames: sailFrames.sprites.length,
      position: pair(sail.at),
      frameMs: sailFrames.frameMs,
    },
    ...(shark === undefined || splash === undefined
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
        }),
    ...(plank === undefined ? {} : { plank: { texture: path(plank.sprite.image), size: size(plank.sprite.image), position: pair(plank.at) } }),
    mast: {
      texture: path(tallMast.sprite.image),
      size: size(tallMast.sprite.image),
      position: pair(topmast.at),
      sway: rect(topmast.sprite)[3],
      clears: rect({ image: tallMast.sprite.image, rect: tallMast.cutout }),
      replaces: tallMast.replacesPiece!.piece,
    },
  };
  return { art, extras, paths };
}

/**
 * Where the wake drawn in code (`client/deck-wake.ts`) stands in for the pack's own, until step 5c retires it: the cycle
 * in front whose opacity reads a weather channel — the ship's wake — by id, slot and order. Null for a pack without one.
 */
export function codeWakeSpot(manifest: SettingManifest): { id: string; slot: "back" | "front"; order: number } | null {
  const wake = manifest.ambience.find(
    (element) => element.behaviour.kind === "cycle" && typeof element.behaviour.opacity === "object" && "channel" in element.behaviour.opacity,
  );
  return wake === undefined ? null : { id: wake.id, slot: wake.slot, order: wake.order };
}
