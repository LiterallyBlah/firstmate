/**
 * The deck's art as the three manifests it was once served in — the atlas's (`DeckArtManifest`), the environment's
 * (`DeckEnvironmentManifest`) and the extras' (`DeckExtrasManifest`) — now read off a setting pack
 * (`shared/deck-setting.ts`) by `legacyViews`, so the engine's modules draw exactly as they did while the move
 * to a scene engine reads the pack directly a part at a time. Each step of that move takes a part out of these
 * views; when they are empty this file goes. The manifests as they were last served are kept as records in
 * `docs/ship-deck-art/legacy/`, and `client/ship-pack.test.ts` holds these views to them.
 *
 * Image paths in the views are paths inside the pack's folder, as they once were inside `art/ship-deck/`.
 */
import type { AmbienceBehaviour, SettingManifest } from "../shared/deck-setting";
import type { DeckArtManifest, DeckEnvironmentManifest, DeckExtrasManifest } from "./deck-legacy-schema";

export type { DeckArtManifest, DeckEnvironmentManifest, DeckExtrasManifest } from "./deck-legacy-schema";

export const SAILOR_POSES = [
  "front-idle",
  "front-walk-a",
  "front-walk-b",
  "side-idle",
  "side-walk-a",
  "side-walk-b",
  "hauling",
  "leaning",
  "waiting",
] as const;
export type SailorPose = (typeof SAILOR_POSES)[number];
export const SAILOR_OUTFITS = ["base", "outfit"] as const;
export type SailorOutfit = (typeof SAILOR_OUTFITS)[number];
export const DECK_PROP_NAMES = ["barrel", "crate", "rope"] as const;
export type DeckPropName = (typeof DECK_PROP_NAMES)[number];

/** The six sky phases, in the order of the day. */
export const SKY_PHASES = ["dawn", "morning", "midday", "afternoon", "dusk", "night"] as const;
export type SkyPhaseId = (typeof SKY_PHASES)[number];
export const GULL_POSES = ["up", "mid", "down"] as const;
export type GullPose = (typeof GULL_POSES)[number];

/** Every image the manifest names, once each, in a stable order. */
export function environmentImagePaths(manifest: DeckEnvironmentManifest): string[] {
  const paths = [
    manifest.sea.texture,
    manifest.foam.texture,
    ...manifest.sky.phases.map((phase) => phase.path),
    ...manifest.sky.overlays.map((overlay) => overlay.path),
    manifest.gull.sheet,
  ];
  return [...new Set(paths)];
}

/** Every image the extras manifest names, once each, in a stable order. */
export function extrasImagePaths(manifest: DeckExtrasManifest): string[] {
  const exit = manifest.exit === undefined ? [] : [...Object.values(manifest.exit.shark.frames), ...Object.values(manifest.exit.splash.frames)];
  const clouds = manifest.clouds?.sprites.map((sprite) => sprite.texture) ?? [];
  const plank = manifest.plank === undefined ? [] : [manifest.plank.texture];
  const mast = manifest.mast === undefined ? [] : [manifest.mast.texture];
  const water = manifest.water === undefined ? [] : [...manifest.water.sea.frames, ...manifest.water.foam.frames, ...manifest.water.wake.frames];
  const weather = [
    ...(manifest.variants ?? []).flatMap((variant) => variant.frames),
    ...(manifest.cycles ?? []).flatMap((cycle) => cycle.frames),
    ...(manifest.mood?.overlays ?? []).map((overlay) => overlay.texture),
    ...(manifest.flashes ?? []).flatMap((flash) => flash.frames),
  ];
  return [...new Set([manifest.sail.texture, ...manifest.crew.map((look) => look.texture), ...exit, ...clouds, ...plank, ...mast, ...water, ...weather])];
}

/** The three manifests a pack is read as, and each of its images' path by id. */
export interface LegacyViews {
  art: DeckArtManifest;
  environment: DeckEnvironmentManifest;
  extras: DeckExtrasManifest;
  /** Image id → its path in the pack, the key the views name it by. */
  paths: ReadonlyMap<string, string>;
}

type Element = SettingManifest["ambience"][number];
type Of<Kind extends AmbienceBehaviour["kind"]> = Extract<AmbienceBehaviour, { kind: Kind }>;
type Rect = readonly [number, number, number, number];
type Points = ReadonlyArray<readonly [number, number]>;

/**
 * A pack read as the three manifests the engine drew from before packs: the atlas's frames, the environment's sky,
 * still sea, foam and gull, and the extras' tall mast, sail, looks, shark and splash, clouds, plank, animated water and
 * weather. Each part is found by what it is — the tile with a still fallback is the sea, the overlay at night the
 * stars — and a part the pack has none of is an error: these views exist only for the ship's own pack.
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
  const curve = (points: Points): Array<[number, number]> => points.map(pair);
  function one<Kind extends AmbienceBehaviour["kind"]>(kind: Kind, test: (behaviour: Of<Kind>, element: Element) => boolean = () => true) {
    const found = manifest.ambience.filter((element) => element.behaviour.kind === kind && test(element.behaviour as Of<Kind>, element));
    if (found.length !== 1) throw new Error(`the setting has ${found.length} ${kind} elements where its legacy view wants one`);
    return { element: found[0]!, behaviour: found[0]!.behaviour as Of<Kind> };
  }
  const all = <Kind extends AmbienceBehaviour["kind"]>(kind: Kind, test: (behaviour: Of<Kind>) => boolean) =>
    manifest.ambience
      .filter((element) => element.behaviour.kind === kind && test(element.behaviour as Of<Kind>))
      .map((element) => ({ element, behaviour: element.behaviour as Of<Kind> }));
  const byId = (id: string | undefined) => manifest.ambience.find((element) => element.id === id);
  const curveOf = (level: unknown): Points | null =>
    typeof level === "object" && level !== null && "curve" in level ? (level as { curve: Points }).curve : null;
  const variantsOf = (variantOf: string, variants: Of<"tile">["variants"]) =>
    (variants ?? []).map((variant) => ({
      id: variant.id,
      variantOf,
      frames: variant.frames.map((frame) => path(frame.image)),
      frameSize: size(variant.frames[0]!.image),
      blend: variant.blend,
      opacity: curve(variant.opacity),
      ...(variant.palette === undefined ? {} : { palette: variant.palette }),
      ...(variant.byPhase === undefined ? {} : { stages: variant.byPhase as Record<SkyPhaseId, [string, string, string]> }),
    }));
  const frames = (behaviour: { frames: { sprites: ReadonlyArray<{ image: string }> } }) => behaviour.frames.sprites.map((sprite) => path(sprite.image));
  const frameSize = (behaviour: { frames: { sprites: ReadonlyArray<{ image: string }> } }) => size(behaviour.frames.sprites[0]!.image);

  // The atlas: the backdrop, the pieces on it, the crew's two lanes, the props.
  const { stage, cast } = manifest;
  const atlas = stage.backdrop.sprite.image;
  const lane = (name: string) =>
    Object.fromEntries(Object.entries(cast.lanes[name] ?? {}).map(([pose, standing]) => [pose, { frame: [...standing.rect], feet: pair(standing.feet) }])) as DeckArtManifest["crew"]["base"];
  const art: DeckArtManifest = {
    ship: { frame: rect(stage.backdrop.sprite) },
    pieces: Object.fromEntries(
      stage.pieces.flatMap((piece) =>
        piece.baseline === null || typeof piece.baseline === "number"
          ? [[piece.id, { frame: rect(piece.sprite), x: piece.at[0], y: piece.at[1], baseline: piece.baseline }] as const]
          : [],
      ),
    ),
    crew: { base: lane("base"), outfit: lane("outfit") },
    props: Object.fromEntries(stage.props.map((prop) => [prop.id, { frame: rect(prop.sprite), feet: pair(prop.feet) }])) as DeckArtManifest["props"],
  };

  // The environment: the sky and its stars, the still sea and foam the animated ones fall back to, the gull.
  const sky = one("backdrop-cycle");
  const sea = one("tile", (_behaviour, element) => element.fallback !== undefined);
  const foam = one("strip", (_behaviour, element) => element.fallback !== undefined);
  const seaStill = byId(sea.element.fallback)!.behaviour as Of<"tile">;
  const foamStill = byId(foam.element.fallback)!.behaviour as Of<"strip">;
  const gull = one("flyby").behaviour;
  const stars = one("overlay", (behaviour) => behaviour.alpha === "night").behaviour;
  const environment: DeckEnvironmentManifest = {
    sea: { texture: path(seaStill.frames.sprites[0]!.image), period: size(seaStill.frames.sprites[0]!.image), animation: { xPixelsPerSecond: seaStill.drift.pxPerSecond } },
    foam: { texture: path(foamStill.frames.sprites[0]!.image), period: size(foamStill.frames.sprites[0]!.image)[0], xPixelsPerSecond: foamStill.drift.pxPerSecond },
    sky: {
      size: pair(sky.behaviour.size),
      phases: (manifest.dayCycle?.phases ?? []).map((phase) => ({ id: phase.id as SkyPhaseId, path: path(sky.behaviour.phases[phase.id]!), localMinute: phase.localMinute })),
      overlays: [{ path: path(stars.image), size: size(stars.image) }],
    },
    gull: {
      sheet: path(Object.values(gull.poses)[0]!.image),
      frameSize: pair(gull.size),
      anchor: pair(gull.anchor),
      frames: Object.entries(gull.poses).map(([id, sprite]) => ({ id: id as GullPose, rect: rect(sprite) })),
      sequence: gull.sequence as GullPose[],
      frameMs: gull.frameMs,
    },
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
  const clouds = one("drifters").behaviour;
  const wake = one("cycle", (behaviour) => typeof behaviour.opacity === "object" && "channel" in behaviour.opacity);
  const cycles = all("cycle", (behaviour) => curveOf(behaviour.opacity) !== null);
  const moods = all("overlay", (behaviour) => behaviour.alpha !== "night");
  const flashes = all("flash", () => true);
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
    crew: cast.looks.filter((look) => look.image !== atlas).map((look) => ({ id: look.id, texture: path(look.image) })),
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
    clouds: {
      palette: clouds.palette,
      stages: clouds.byPhase as Record<SkyPhaseId, [string, string, string]>,
      sprites: clouds.sprites.map((sprite) => ({ id: sprite.id, texture: path(sprite.image), size: pair(sprite.size), pixelsPerSecond: sprite.pxPerSecond })),
    },
    ...(plank === undefined ? {} : { plank: { texture: path(plank.sprite.image), size: size(plank.sprite.image), position: pair(plank.at) } }),
    mast: {
      texture: path(tallMast.sprite.image),
      size: size(tallMast.sprite.image),
      position: pair(topmast.at),
      sway: rect(topmast.sprite)[3],
      clears: rect({ image: tallMast.sprite.image, rect: tallMast.cutout }),
      replaces: tallMast.replacesPiece!.piece,
    },
    water: {
      sea: { frames: frames(sea.behaviour), frameSize: frameSize(sea.behaviour), frameMs: sea.behaviour.frames.frameMs, xPixelsPerSecond: sea.behaviour.drift.pxPerSecond },
      foam: {
        frames: frames(foam.behaviour),
        frameSize: frameSize(foam.behaviour),
        frameMs: foam.behaviour.frames.frameMs,
        top: foam.behaviour.top,
        span: pair(foam.behaviour.span),
        xPixelsPerSecond: foam.behaviour.drift.pxPerSecond,
      },
      wake: {
        frames: frames(wake.behaviour),
        frameSize: frameSize(wake.behaviour),
        frameMs: wake.behaviour.frames.frameMs,
        anchor: pair(wake.behaviour.anchor),
        position: pair(wake.behaviour.at),
      },
    },
    variants: [
      ...variantsOf("sea", sea.behaviour.variants),
      ...variantsOf("foam", foam.behaviour.variants),
      ...variantsOf("wake", wake.behaviour.variants),
      ...cycles.flatMap((cycle) => variantsOf(`cycle:${cycle.element.id}`, cycle.behaviour.variants)),
      ...clouds.sprites.flatMap((sprite) => variantsOf(`cloud:${sprite.id}`, sprite.variants)),
    ],
    cycles: cycles.map((cycle) => ({
      id: cycle.element.id,
      frames: frames(cycle.behaviour),
      frameSize: frameSize(cycle.behaviour),
      frameMs: cycle.behaviour.frames.frameMs,
      anchor: pair(cycle.behaviour.anchor),
      position: pair(cycle.behaviour.at),
      opacity: curve(curveOf(cycle.behaviour.opacity) ?? []),
    })),
    mood: {
      overlays: moods.map((mood) => ({
        id: mood.element.id,
        texture: path(mood.behaviour.image),
        size: size(mood.behaviour.image),
        opacity: curve(curveOf(mood.behaviour.alpha) ?? []),
      })),
    },
    flashes: flashes.map((flash) => ({
      id: flash.element.id,
      frames: flash.behaviour.frames.map((frame) => path(frame.sprite.image)),
      frameSize: pair(flash.behaviour.size),
      frameMs: flash.behaviour.frames.map((frame) => frame.ms),
      frameAlpha: flash.behaviour.frames.map((frame) => frame.alpha),
      anchor: pair(flash.behaviour.anchor),
      place: "under-cloud" as const,
      opacity: curve(flash.behaviour.opacity),
      perMinute: curve(flash.behaviour.perMinute),
    })),
  };
  return { art, environment, extras, paths };
}
