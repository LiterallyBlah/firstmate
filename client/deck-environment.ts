/**
 * The generated environment drawn with Pixi (`docs/ship-deck-art/ENVIRONMENT.md`): the sky behind the ship,
 * following the local time of day, its stars at night, a gull now and then, and the scrolling sea with
 * foam at the hull's waterline. `client/deck-pixi.ts` puts `back` behind the ship and `front` in front of
 * it; the arithmetic is `client/deck-sky.ts`, and when a gull flies is `client/deck-ambient.ts`.
 *
 * - **Sky** — two of the six registered backdrops, the earlier whole and the later over it at the
 *   blend's opacity, never two over transparency (the manifest's rule), so clouds never jump in a fade.
 *   Placed once per layout at the hull's pixel scale, centred on the ship, never tiled.
 * - **Stars** — the overlay, faded with the night's share, above the sky and behind everything else.
 * - **Clouds** — the extras' sprites, over the stars and behind the gull, in the sky's own placement and
 *   pixels, drifting right and tinted with the sky's blend (`client/deck-clouds.ts`). Only with a sky.
 * - **Gull** — the three-pose sprite, registered at the beak, mirrored to fly left. Behind the ship, in
 *   daylight only: no gull sets off while the stars are more than half out.
 * - **Sea** — the 256 × 128 tile, repeated both ways from the horizon down, scrolled sideways a whole
 *   pixel at a time. The same tiles again in front of the hull from its waterline down, cut to line up,
 *   so the waterline is the hull's edge and not a seam across the water. With the extras' animated water
 *   (`client/deck-water.ts`), its four frames in turn, every tile on the same one.
 * - **Foam** — the strip across the hull's waterline only, cut from a scrolling repeat into at most three
 *   sprites a frame, so it never runs out into open water. The animated water's three frames where they
 *   loaded, three rows higher than the environment's generic strip, which is not fitted to hull C's curve.
 * - **Wake** — the animated water's stern wake, one sprite fixed at the stern over the near sea and under the
 *   foam, cycling its three frames. Where it did not load, the churn astern and the bow and stern waves' near
 *   arms drawn in code (`client/deck-wake.ts`), scrolling aft with the water, redrawn only when the scroll
 *   moves a whole pixel. Either is still under reduced motion and on a software renderer.
 *
 * **The weather** (`client/deck-atmosphere.ts`) is handed to `draw` each frame: the water's and the clouds' own
 * clocks, so a busier crew plays the sea's frames and drifts the sea, foam and clouds faster without a jump; how
 * much wake there is (the generated wake's opacity, the code wake's length); and the sky's mood, a tint a shade
 * greyer over the sky and the clouds. Without it, the art's own timing at the scene's clock.
 *
 * **The weather layers** (`client/deck-variants.ts`, `client/deck-flash.ts`) follow the weather's intensity, each
 * along its own curve from `extras.json`, and none is drawn while it is at nothing or on a still deck:
 *
 * - a **variant** over the sea (`sea:far:<id>`, `sea:near:<id>` over each band), the foam (`foam:<id>`), the wake
 *   (`wake:<id>`), a cycle or a cloud (its own three masks in the cloud's container), on that element's own frame,
 *   drift and place; the element is not drawn under a whole `over` variant, and fades under a `crossfade` one;
 * - a **cycle** (`cycle:<id>`), looping on the water's clock over the foam, in front of the hull's waterline and
 *   below the crew, who never stand that low;
 * - a **mood overlay** (`sky:<id>`) over the time of day's sky and under the stars, tinted with the mood, faded out by
 *   the night's share so a night is never brightened; the stars go in as far as it would show by day;
 * - a **flash** (`flash:<id>`) over the stars and behind the clouds, only while the sea moves.
 *
 * Without the environment (it failed to load, or names an image it did not send) the deck still draws:
 * a flat sea of the hull's navy over the theme's background, no sky, no gull — and the wake, on it.
 *
 * Every texture is cut from its own image once, except the foam's crops, which are made as the scroll
 * first reaches them and kept: at most a few hundred small objects on twenty images' sources.
 */
import { environmentImagePaths, GULL_POSES, type DeckEnvironmentManifest, type GullPose } from "../shared/ship-deck";
import { gullsAt, HORIZON, SEA_FALLBACK, WATERLINE, type MotionPlan } from "./deck-ambient";
import { deliveredWeather, moodTint, shade, type Weather } from "./deck-atmosphere";
import { cloudColours, cloudField, cloudX, variantPalette, type CloudImages } from "./deck-clouds";
import { flashAt, flashSalt, underCloud, type Flash } from "./deck-flash";
import type { PixiContainer, PixiGraphics, PixiModule, PixiSprite, PixiTexture, PixiTextureSource } from "./deck-pixi";
import { DECK_HEIGHT, DECK_WIDTH } from "./deck-scene";
import { gullPose, scrollOffset, skyBlend, skyHorizonRow, skyPlacement, type SkyBlend } from "./deck-sky";
import { cycleFrame, curvePeak, opacityAt, variantBlend, variantsOf, type DrawnVariants, type Variant } from "./deck-variants";
import { WAKE_COLOURS, WAKE_SPEED, wakeRuns } from "./deck-wake";
import { CALM_WATER, wakeTopLeft, waterDrift, waterFrame, type DrawnWater, type WaterManifest } from "./deck-water";

/** The environment as the mount hands it over: what the manifest says, and each image it names, decoded. */
export interface DeckEnvironmentImages {
  manifest: DeckEnvironmentManifest;
  images: ReadonlyMap<string, unknown>;
}

/** The weather layers to draw, as the deck finds them in the extras: variants, cycles and mood overlays, and flashes. */
export interface WeatherLayers {
  variants: DrawnVariants | null;
  flashes: readonly Flash[];
}

/** The part of the world the screen shows, in deck coordinates. */
export interface VisibleWorld {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Where the foam runs: the hull's width where it meets the water, and a few pixels of wake past each end. */
export const FOAM_SPAN = { left: 68, right: 392 } as const;
/** The foam strip's height, as `environment.json` lists its file: transparent above and below the foam, never repeated down. */
export const FOAM_HEIGHT = 16;
/** The foam strip's top row: its densest rows, 6 to 10, lie on the waterline and just below it. */
export const FOAM_TOP = WATERLINE - 6;
/** How many gulls can be in the sky at once (`gullsAt` looks at two slots). */
const GULL_SPRITES = 2;

export interface Scenery {
  /** Behind the ship: the sky, the stars, the clouds, the gull and the far sea. */
  readonly back: PixiContainer;
  /** In front of the hull from its waterline down: the near sea, the wake and the foam. */
  readonly front: PixiContainer;
  /** Whether the generated environment is drawn, or the flat fallback sea. */
  readonly generated: boolean;
  /** Covers `visible`; cheap when it has not grown. */
  layout(visible: VisibleWorld): void;
  /**
   * Draws it at `seconds` on the scene clock and `minute` of the local day, in `weather` (the art's own timing at
   * `seconds` when not given); the sky drawn, or null without one.
   */
  draw(seconds: number, plan: MotionPlan, minute: number | null, weather?: Weather): SkyBlend | null;
  /** The flashes showing in what was last drawn, by id. */
  flashing(): string[];
  /** Lets go of its textures; `back` and `front` go with the stage they are on. */
  destroy(): void;
}

/** Whether every image the manifest names arrived, so the environment can be drawn whole. */
export function environmentComplete(environment: DeckEnvironmentImages | null): environment is DeckEnvironmentImages {
  return environment !== null && environmentImagePaths(environment.manifest).every((path) => environment.images.has(path));
}

/**
 * The foam's pieces across `span` at `offset`: where each starts on the deck, and the part of the
 * repeating strip it shows. The strip is anchored to the world, so it scrolls with the water.
 */
export function foamSegments(span: { left: number; right: number }, period: number, offset: number): Array<{ x: number; from: number; width: number }> {
  const segments: Array<{ x: number; from: number; width: number }> = [];
  for (let x = span.left; x < span.right; ) {
    const from = (((x - offset) % period) + period) % period;
    const width = Math.min(period - from, span.right - x);
    segments.push({ x, from, width });
    x += width;
  }
  return segments;
}

type Cut = (path: string, x: number, y: number, width: number, height: number) => PixiTexture;

/**
 * A sprite and its variants' sprites over it (`client/deck-variants.ts`), one frame index for all: `draw` puts every
 * one on the frame, the element's opacity times `strength`, each variant's by the weather's intensity.
 */
function framedStack(pixi: PixiModule, label: string, frames: PixiTexture[], variants: readonly Variant[], cut: (path: string) => PixiTexture) {
  const sprite = new pixi.Sprite(frames[0]!);
  sprite.label = label;
  const layers = variants.map(function (variant) {
    const over = new pixi.Sprite(cut(variant.frames[0]!));
    over.label = `${label}:${variant.id}`;
    over.visible = false;
    return { over, frames: variant.frames.map(cut) };
  });
  return {
    views: [sprite, ...layers.map((layer) => layer.over)],
    place(x: number, y: number) {
      for (const view of [sprite, ...layers.map((layer) => layer.over)]) view.position.set(x, y);
    },
    draw(frame: number, strength: number, intensity: number | null) {
      const blend = variantBlend(variants, intensity);
      sprite.texture = frames[frame]!;
      sprite.alpha = strength * blend.base;
      sprite.visible = sprite.alpha > 0;
      layers.forEach(function (layer, index) {
        layer.over.texture = layer.frames[frame]!;
        layer.over.alpha = strength * blend.layers[index]!;
        layer.over.visible = layer.over.alpha > 0;
      });
    },
  };
}

/** A wake on the deck: the generated one (`generatedWake`) or the one drawn in code (`codeWake`). */
interface WakeLayer {
  /** What it draws, back to front: the wake, and over the generated one its variants. */
  readonly views: PixiContainer[];
  layout(visible: VisibleWorld): void;
  draw(weather: Weather, plan: MotionPlan, pixelsPerSecond: number): void;
}

/**
 * The code wake's layer: its foam drawn as rectangles, again only when the sea has scrolled a whole pixel or
 * the screen shows more of the water than it did.
 */
function codeWake(pixi: PixiModule): WakeLayer {
  const graphics: PixiGraphics = new pixi.Graphics();
  graphics.label = "wake";
  let reach = { right: DECK_WIDTH, bottom: DECK_HEIGHT };
  let drawn: string | null = null;
  return {
    views: [graphics],
    layout(visible: VisibleWorld) {
      reach = { right: Math.ceil(visible.right), bottom: Math.ceil(visible.bottom) };
    },
    draw(weather: Weather, plan: MotionPlan, pixelsPerSecond: number) {
      const shift = plan.ambient && Number.isFinite(weather.water.drift) ? Math.floor(weather.water.drift * pixelsPerSecond) : 0;
      // Its length in twentieths, so an easing weather redraws it a step at a time and not every frame.
      const strength = Math.round(weather.wake * 20) / 20;
      const key = `${shift}:${strength}:${reach.right}:${reach.bottom}`;
      if (key === drawn) return;
      drawn = key;
      graphics.clear();
      for (const run of wakeRuns(shift, reach, strength)) graphics.rect(run.x, run.y, run.width, 1).fill(WAKE_COLOURS[run.tone]);
    },
  };
}

/** The generated wake: one sprite at the stern, its frames in turn while the sea moves, never drifting; its variants over it. */
function generatedWake(pixi: PixiModule, wake: WaterManifest["wake"], cut: Cut, variants: readonly Variant[]): WakeLayer {
  const frame = (path: string) => cut(path, 0, 0, wake.frameSize[0], wake.frameSize[1]);
  const stack = framedStack(pixi, "wake", wake.frames.map(frame), variants, frame);
  const at = wakeTopLeft(wake);
  stack.place(at.x, at.y);
  return {
    views: stack.views,
    layout() {},
    draw(weather, plan) {
      stack.draw(waterFrame(weather.water.frames, wake, plan.ambient, CALM_WATER), Math.max(0, Math.min(1, weather.wake)), weather.intensity);
    },
  };
}

/** The wake to draw: the generated one where every frame of it decoded, with its variants; or the one drawn in code. */
function wakeOf(pixi: PixiModule, water: DrawnWater | null, layers: WeatherLayers | null, cut: Cut): WakeLayer {
  const wake = water?.wake ?? null;
  return wake === null ? codeWake(pixi) : generatedWake(pixi, wake, cut, variantsOf(layers?.variants ?? null, "wake"));
}

/** A cycle (`client/deck-variants.ts`): its frames looping on the water's clock at its place, its opacity by the weather. */
function cycleLayer(pixi: PixiModule, cycle: NonNullable<DrawnVariants["cycles"]>[number], cut: Cut, variants: readonly Variant[]) {
  const frame = (path: string) => cut(path, 0, 0, cycle.frameSize[0], cycle.frameSize[1]);
  const stack = framedStack(pixi, `cycle:${cycle.id}`, cycle.frames.map(frame), variants, frame);
  stack.place(cycle.position[0] - cycle.anchor[0], cycle.position[1] - cycle.anchor[1]);
  return {
    views: stack.views,
    draw(weather: Weather, plan: MotionPlan) {
      stack.draw(cycleFrame(weather.water.frames, cycle, plan.ambient), opacityAt(cycle.opacity, weather.intensity), weather.intensity);
    },
  };
}

/** Cuts textures from decoded images, a source per image made once; `destroy` lets go of them all. */
function textureCutter(pixi: PixiModule, images: (path: string) => unknown) {
  const sources = new Map<string, PixiTextureSource>();
  const made: PixiTexture[] = [];
  return {
    sources,
    made,
    cut(path: string, x: number, y: number, width: number, height: number): PixiTexture {
      let source = sources.get(path);
      if (source === undefined) {
        source = new pixi.ImageSource({ resource: images(path) });
        source.scaleMode = "nearest";
        sources.set(path, source);
      }
      const texture = new pixi.Texture({ source, frame: new pixi.Rectangle(x, y, width, height) });
      made.push(texture);
      return texture;
    },
    destroy() {
      for (const texture of made) texture.destroy();
      for (const source of sources.values()) source.destroy();
    },
  };
}

/**
 * The scenery behind and in front of the ship. `clouds`, when there are any, drift across the sky, laid out
 * from `seed`; without the environment's sky there is nowhere for them, and they are not drawn. `water` is the
 * extras' animated sea, foam and wake, each drawn in place of the environment's own where it loaded. `layers` are the
 * extras' weather layers, drawn over all of it as the weather's intensity says (`client/deck-variants.ts`).
 */
export function createScenery(
  pixi: PixiModule,
  environment: DeckEnvironmentImages | null,
  clouds: CloudImages | null = null,
  seed = 0,
  water: DrawnWater | null = null,
  layers: WeatherLayers | null = null,
): Scenery {
  const back = new pixi.Container();
  back.label = "scenery:back";
  const front = new pixi.Container();
  front.label = "scenery:front";
  const extraImage = (path: string) => water?.images.get(path) ?? layers?.variants?.images.get(path);
  if (!environmentComplete(environment)) return flatScenery(pixi, back, front, water, layers, extraImage);

  const { manifest, images } = environment;
  const cutter = textureCutter(pixi, (path) => (images.has(path) ? images.get(path) : extraImage(path)));
  const { sources, made, cut } = cutter;
  const variants = layers?.variants ?? null;

  // The sky: the two backdrops of the blend, and the stars over them.
  const [skyWidth, skyHeight] = manifest.sky.size;
  const phases = manifest.sky.phases.map((phase) => cut(phase.path, 0, 0, skyWidth, skyHeight));
  const skyUnder = new pixi.Sprite(phases[0]!);
  skyUnder.label = "sky:under";
  const skyOver = new pixi.Sprite(phases[0]!);
  skyOver.label = "sky:over";
  const overlays = manifest.sky.overlays.map(function (overlay) {
    const sprite = new pixi.Sprite(cut(overlay.path, 0, 0, overlay.size[0], overlay.size[1]));
    sprite.label = "sky:stars";
    return sprite;
  });
  // The sky's mood overlays, over the time of day's sky and under the stars: only those registered to the same sky.
  const moods = (variants?.overlays ?? [])
    .filter((overlay) => overlay.size[0] === skyWidth && overlay.size[1] === skyHeight)
    .map(function (overlay) {
      const sprite = new pixi.Sprite(cut(overlay.texture, 0, 0, skyWidth, skyHeight));
      sprite.label = `sky:${overlay.id}`;
      sprite.visible = false;
      return { overlay, sprite, peak: curvePeak(overlay.opacity) };
    });

  // The clouds: each its three slot masks, one over the other in a container placed in the sky's pixels.
  const horizonRow = skyHorizonRow(manifest.sky.size);
  const cloudSprites = clouds?.manifest.sprites ?? [];
  const cloudLayer = new pixi.Container();
  cloudLayer.label = "clouds";
  const maskTextures = (masks: readonly unknown[], key: string, size: readonly [number, number]) =>
    masks.map(function (mask, slot) {
      const source = new pixi.ImageSource({ resource: mask });
      source.scaleMode = "nearest";
      sources.set(`${key}#${slot}`, source);
      const texture = new pixi.Texture({ source, frame: new pixi.Rectangle(0, 0, size[0], size[1]) });
      made.push(texture);
      return texture;
    });
  const cloudSlots = cloudSprites.map((sprite) => maskTextures(clouds!.masks.get(sprite.texture)!, sprite.texture, sprite.size));
  // Each cloud's variants, where it has any: the same size, so the same place in the same lane.
  const cloudVariants = cloudSprites.map((sprite) =>
    (clouds?.variants?.get(sprite.id) ?? []).map(({ variant, masks }) => ({ variant, textures: maskTextures(masks, variant.frames[0]!, sprite.size) })),
  );
  const SLOTS = ["shadow", "body", "highlight"];
  const field = cloudField(seed, cloudSprites, skyWidth, horizonRow).map(function (cloud) {
    const container = new pixi.Container();
    container.label = `cloud:${cloudSprites[cloud.sprite]!.id}`;
    const masked = (textures: PixiTexture[], prefix: string) =>
      textures.map(function (texture, slot) {
        const sprite = new pixi.Sprite(texture);
        sprite.label = `${prefix}${SLOTS[slot]}`;
        container.addChild(sprite);
        return sprite;
      });
    const slots = masked(cloudSlots[cloud.sprite]!, "cloud:");
    const over = cloudVariants[cloud.sprite]!.map(function ({ variant, textures }) {
      const masks = masked(textures, `cloud:${variant.id}:`);
      for (const mask of masks) mask.visible = false;
      return { variant, masks };
    });
    cloudLayer.addChild(container);
    const [width, height] = cloudSprites[cloud.sprite]!.size;
    return { cloud, width, height, container, slots, over };
  });
  let skyPlace = { x: 0, y: 0, scale: 1 };
  let cloudTint = "";
  let skyTint = 0xffffff;
  let cloudDrift = { seconds: 0, drifting: false };
  /** Puts each cloud where its drift has it, in the sky's pixels at the sky's placement: whole sky pixels. */
  function placeClouds(): void {
    for (const { cloud, width, container } of field) {
      const x = cloudX(cloud, width, skyWidth, cloudDrift.seconds, cloudDrift.drifting);
      container.position.set(skyPlace.x + x * skyPlace.scale, skyPlace.y + cloud.row * skyPlace.scale);
      container.scale.set(skyPlace.scale);
    }
  }

  // The flashes, over the stars and behind the clouds: `under-cloud` ones only where there are clouds to stand under.
  const flashes = (field.length > 0 ? (layers?.flashes ?? []) : []).map(function (flash) {
    const frames = flash.frames.map((path) => cut(path, 0, 0, flash.frameSize[0], flash.frameSize[1]));
    const sprite = new pixi.Sprite(frames[0]!);
    sprite.label = `flash:${flash.id}`;
    sprite.visible = false;
    return { flash, frames, sprite, salt: flashSalt(flash.id) };
  });
  /** The part of the sky that shows, in its own columns: where a flash may stand. */
  let skyView = { left: 0, right: skyWidth };

  // The gull: its three poses, registered at the beak.
  const [gullWidth, gullHeight] = manifest.gull.frameSize;
  const poses = new Map<GullPose, PixiTexture>(
    manifest.gull.frames.map((frame) => [frame.id, cut(manifest.gull.sheet, frame.rect[0], frame.rect[1], frame.rect[2], frame.rect[3])]),
  );
  const gulls: PixiSprite[] = [];
  for (let index = 0; index < GULL_SPRITES; index += 1) {
    const sprite = new pixi.Sprite(poses.get("mid") ?? poses.get(GULL_POSES[0])!);
    sprite.label = "gull";
    sprite.anchor.set(manifest.gull.anchor[0] / gullWidth, manifest.gull.anchor[1] / gullHeight);
    sprite.visible = false;
    gulls.push(sprite);
  }

  // The water: each frame of the tile — the animated sea's four, or the environment's one — and the same frame
  // cut to start at the waterline for the near sea's first row, so both bands share one tile origin.
  const sea = water?.sea ?? null;
  const [tileWidth, tileHeight] = sea?.frameSize ?? manifest.sea.period;
  const seaPaths = sea?.frames ?? [manifest.sea.texture];
  const seaSpeed = sea === null ? manifest.sea.animation.xPixelsPerSecond : waterDrift(sea, CALM_WATER);
  const nearFirstRow = (WATERLINE - HORIZON) % tileHeight;
  const seaTextures = (path: string) => {
    const whole = cut(path, 0, 0, tileWidth, tileHeight);
    return { whole, fromWaterline: nearFirstRow === 0 ? whole : cut(path, 0, nearFirstRow, tileWidth, tileHeight - nearFirstRow) };
  };
  const seaFrames = seaPaths.map(seaTextures);
  let seaFrame = 0;
  const farSea = new pixi.Container();
  farSea.label = "sea:far";
  const nearSea = new pixi.Container();
  nearSea.label = "sea:near";
  // The sea's variants, frame for frame over the animated sea (`drawnVariants` holds them to its frames and size): a
  // band of tiles over each band of it.
  const seaVariants = sea === null ? [] : variantsOf(variants, "sea");
  const seaOver = seaVariants.map(function (variant) {
    const far = new pixi.Container();
    far.label = `sea:far:${variant.id}`;
    far.visible = false;
    const near = new pixi.Container();
    near.label = `sea:near:${variant.id}`;
    near.visible = false;
    return { far, near, frames: variant.frames.map(seaTextures) };
  });
  /** Every tile, whether it is the near sea's first row, cut at the waterline, and each variant's tile over it. */
  let tiles: Array<{ parent: PixiContainer; sprite: PixiSprite; atWaterline: boolean; over: PixiSprite[] }> = [];
  let tiled = { left: 0, right: 0, bottom: 0 };

  // The foam: up to three crops of the repeating strip a frame, laid end to end across the hull — the animated
  // water's frames from its own top and span, or the environment's one strip — and the same crops of each variant's.
  const waterFoam = water?.foam ?? null;
  const foamPaths = waterFoam?.frames ?? [manifest.foam.texture];
  const foamPeriod = waterFoam?.frameSize[0] ?? manifest.foam.period;
  const foamHeight = waterFoam?.frameSize[1] ?? FOAM_HEIGHT;
  const foamTop = waterFoam?.top ?? FOAM_TOP;
  const foamSpan = waterFoam === null ? FOAM_SPAN : { left: waterFoam.span[0], right: waterFoam.span[1] };
  const foamSpeed = waterFoam === null ? manifest.foam.xPixelsPerSecond : waterDrift(waterFoam, CALM_WATER);
  const foamCrops = new Map<string, PixiTexture>();
  function foamCrop(paths: readonly string[], frame: number, from: number, width: number): PixiTexture {
    const key = `${paths[frame]}:${from}:${width}`;
    let texture = foamCrops.get(key);
    if (texture === undefined) {
      texture = cut(paths[frame]!, from, 0, width, foamHeight);
      foamCrops.set(key, texture);
    }
    return texture;
  }
  const foamStrip = (label: string, paths: readonly string[]) => {
    const container = new pixi.Container();
    container.label = label;
    const pieces: PixiSprite[] = [];
    for (let index = 0; index < 3; index += 1) {
      const sprite = new pixi.Sprite(foamCrop(paths, 0, 0, 1));
      sprite.visible = false;
      container.addChild(sprite);
      pieces.push(sprite);
    }
    return { container, pieces, paths };
  };
  const foam = foamStrip("foam", foamPaths);
  const foamVariants = waterFoam === null ? [] : variantsOf(variants, "foam");
  const foamOver = foamVariants.map((variant) => foamStrip(`foam:${variant.id}`, variant.frames));
  for (const strip of foamOver) strip.container.visible = false;
  let foamDrawn = "";

  const wake = wakeOf(pixi, water, layers, cut);
  const cycles = (variants?.cycles ?? []).map((cycle) => cycleLayer(pixi, cycle, cut, variantsOf(variants, `cycle:${cycle.id}`)));

  back.addChild(
    skyUnder,
    skyOver,
    ...moods.map((mood) => mood.sprite),
    ...overlays,
    ...flashes.map((flash) => flash.sprite),
    ...(field.length > 0 ? [cloudLayer] : []),
    ...gulls,
    farSea,
    ...seaOver.map((band) => band.far),
  );
  front.addChild(
    nearSea,
    ...seaOver.map((band) => band.near),
    ...wake.views,
    foam.container,
    ...foamOver.map((strip) => strip.container),
    ...cycles.flatMap((cycle) => cycle.views),
  );

  function tile(parent: PixiContainer, atWaterline: boolean, x: number, y: number): void {
    const textures = (frames: typeof seaFrames) => (atWaterline ? frames[seaFrame]!.fromWaterline : frames[seaFrame]!.whole);
    const sprite = new pixi.Sprite(textures(seaFrames));
    sprite.position.set(x, y);
    parent.addChild(sprite);
    const over = seaOver.map(function (band) {
      const tile = new pixi.Sprite(textures(band.frames));
      tile.position.set(x, y);
      (parent === farSea ? band.far : band.near).addChild(tile);
      return tile;
    });
    tiles.push({ parent, sprite, atWaterline, over });
  }

  return {
    back,
    front,
    generated: true,
    layout(visible) {
      const place = skyPlacement(visible, manifest.sky.size, horizonRow);
      for (const sprite of [skyUnder, skyOver, ...moods.map((mood) => mood.sprite), ...overlays]) {
        sprite.position.set(place.x, place.y);
        sprite.scale.set(place.scale);
      }
      skyPlace = place;
      skyView = { left: (visible.left - place.x) / place.scale, right: (visible.right - place.x) / place.scale };
      // Again here, not only in `draw`: a still deck's camera can lay the sky out anew without a draw after.
      placeClouds();
      wake.layout(visible);
      if (tiles.length > 0 && visible.left >= tiled.left && visible.right <= tiled.right && visible.bottom <= tiled.bottom) return;
      // A tile's width of slack either side, so a scroll of up to a tile never shows an edge.
      tiled = { left: Math.floor(visible.left) - 8, right: Math.ceil(visible.right) + 8, bottom: Math.ceil(visible.bottom) + 8 };
      for (const { parent, sprite, over } of tiles) {
        parent.removeChild(sprite);
        sprite.destroy();
        over.forEach(function (tile, index) {
          (parent === farSea ? seaOver[index]!.far : seaOver[index]!.near).removeChild(tile);
          tile.destroy();
        });
      }
      tiles = [];
      const first = Math.floor(tiled.left / tileWidth) * tileWidth - tileWidth;
      for (let x = first; x < tiled.right + tileWidth; x += tileWidth) {
        for (let y = HORIZON; y < tiled.bottom; y += tileHeight) tile(farSea, false, x, y);
        tile(nearSea, true, x, WATERLINE);
        for (let y = WATERLINE - nearFirstRow + tileHeight; y < tiled.bottom; y += tileHeight) tile(nearSea, false, x, y);
      }
    },
    draw(seconds, plan, minute, weather = deliveredWeather(seconds)) {
      const { intensity } = weather;
      const blend = skyBlend(minute, manifest.sky.phases);
      // The sky's mood: the backdrops, and the clouds below, a shade greyer as the crew gets busy.
      const tint = moodTint(weather.mood);
      if (tint !== skyTint) {
        skyTint = tint;
        skyUnder.tint = tint;
        skyOver.tint = tint;
      }
      skyUnder.texture = phases[blend.from]!;
      skyOver.texture = phases[blend.to]!;
      skyOver.alpha = blend.t;
      skyOver.visible = blend.to !== blend.from && blend.t > 0;
      // The mood's overlays over the day's sky, never over the night's; the stars go in as far as they would show by day.
      let covered = 0;
      for (const { overlay, sprite, peak } of moods) {
        const alpha = opacityAt(overlay.opacity, intensity);
        if (peak > 0) covered = Math.max(covered, alpha / peak);
        sprite.alpha = alpha * (1 - blend.stars);
        sprite.visible = sprite.alpha > 0;
        sprite.tint = tint;
      }
      const stars = blend.stars * (1 - covered);
      for (const sprite of overlays) {
        sprite.alpha = stars;
        sprite.visible = stars > 0;
      }
      if (clouds !== null && field.length > 0) {
        // The clouds in the sky's pixels, whole ones, drifting only while the sea scrolls; recoloured when the sky's blend moves them.
        cloudDrift = { seconds: weather.wind, drifting: plan.ambient };
        placeClouds();
        const colours = cloudColours(clouds.manifest, manifest.sky.phases, blend).map((colour) => shade(colour, tint));
        const variantColours = new Map(
          cloudVariants
            .flat()
            .map(({ variant }) => [variant.id, cloudColours(variantPalette(variant, clouds.manifest), manifest.sky.phases, blend).map((colour) => shade(colour, tint))]),
        );
        const key = [...colours, ...[...variantColours.values()].flat()].join(":");
        if (key !== cloudTint) {
          cloudTint = key;
          for (const { slots, over } of field) {
            slots.forEach((sprite, slot) => (sprite.tint = colours[slot]!));
            for (const { variant, masks } of over) masks.forEach((sprite, slot) => (sprite.tint = variantColours.get(variant.id)![slot]!));
          }
        }
        // Each cloud under its variants, as the weather has them.
        for (const { slots, over } of field) {
          if (over.length === 0) continue;
          const mix = variantBlend(
            over.map(({ variant }) => variant),
            intensity,
          );
          for (const sprite of slots) {
            sprite.alpha = mix.base;
            sprite.visible = mix.base > 0;
          }
          over.forEach(function ({ masks }, index) {
            for (const sprite of masks) {
              sprite.alpha = mix.layers[index]!;
              sprite.visible = sprite.alpha > 0;
            }
          });
        }
      }
      for (const { flash, frames, sprite, salt } of flashes) {
        // A flash now and then, tucked under a cloud in view; never while the sea is still.
        const moment = plan.ambient && intensity !== null ? flashAt(seconds, flash, intensity, salt) : null;
        const alpha = moment === null ? 0 : opacityAt(flash.opacity, intensity) * moment.share;
        const places = () =>
          field.map(({ cloud, width, height }) => ({ x: cloudX(cloud, width, skyWidth, cloudDrift.seconds, cloudDrift.drifting), row: cloud.row, width, height }));
        const spot = moment === null || alpha <= 0 ? null : underCloud(places(), moment.slot, flash, horizonRow, skyView, salt);
        sprite.visible = spot !== null;
        if (moment === null || spot === null) continue;
        sprite.texture = frames[moment.frame]!;
        sprite.alpha = alpha;
        sprite.position.set(skyPlace.x + spot.x * skyPlace.scale, skyPlace.y + spot.y * skyPlace.scale);
        sprite.scale.set(skyPlace.scale);
      }

      // The sea: every tile on the same frame, both bands drifting together, its variants over it on the same frame and drift.
      const drift = plan.ambient ? scrollOffset(weather.water.drift, seaSpeed, tileWidth) : 0;
      const seaMix = variantBlend(seaVariants, intensity);
      for (const band of [farSea, nearSea]) {
        band.position.set(drift, 0);
        band.visible = seaMix.base > 0;
        band.alpha = seaMix.base;
      }
      seaOver.forEach(function (band, index) {
        for (const over of [band.far, band.near]) {
          over.position.set(drift, 0);
          over.alpha = seaMix.layers[index]!;
          over.visible = over.alpha > 0;
        }
      });
      const nextSea = sea === null ? 0 : waterFrame(weather.water.frames, sea, plan.ambient, CALM_WATER);
      if (nextSea !== seaFrame) {
        seaFrame = nextSea;
        for (const tile of tiles) {
          tile.sprite.texture = tile.atWaterline ? seaFrames[seaFrame]!.fromWaterline : seaFrames[seaFrame]!.whole;
          tile.over.forEach((over, index) => (over.texture = tile.atWaterline ? seaOver[index]!.frames[seaFrame]!.fromWaterline : seaOver[index]!.frames[seaFrame]!.whole));
        }
      }
      wake.draw(weather, plan, seaSpeed);

      const lap = plan.ambient ? scrollOffset(weather.water.drift, foamSpeed, foamPeriod) : 0;
      const foamFrame = waterFoam === null ? 0 : waterFrame(weather.water.frames, waterFoam, plan.ambient, CALM_WATER);
      const foamMix = variantBlend(foamVariants, intensity);
      foam.container.alpha = foamMix.base;
      foam.container.visible = foamMix.base > 0;
      foamOver.forEach(function (strip, index) {
        strip.container.alpha = foamMix.layers[index]!;
        strip.container.visible = strip.container.alpha > 0;
      });
      if (`${foamFrame}:${lap}` !== foamDrawn) {
        const segments = foamSegments(foamSpan, foamPeriod, lap);
        for (const strip of [foam, ...foamOver]) {
          strip.pieces.forEach(function (sprite, index) {
            const segment = segments[index];
            sprite.visible = segment !== undefined;
            if (segment === undefined) return;
            sprite.texture = foamCrop(strip.paths, foamFrame, segment.from, segment.width);
            sprite.position.set(segment.x, foamTop);
          });
        }
        foamDrawn = `${foamFrame}:${lap}`;
      }
      for (const cycle of cycles) cycle.draw(weather, plan);

      const flying = plan.ambient && blend.stars < 0.5 ? gullsAt(seconds) : [];
      gulls.forEach(function (sprite, index) {
        const gull = flying[index];
        sprite.visible = gull !== undefined;
        if (gull === undefined) return;
        sprite.texture = poses.get(gull.flapping ? gullPose(gull.age, manifest.gull) : "mid")!;
        sprite.scale.set(gull.flip ? -1 : 1, 1);
        sprite.position.set(gull.x, gull.y);
      });
      return blend;
    },
    flashing: () => flashes.filter((each) => each.sprite.visible).map((each) => each.flash.id),
    destroy: cutter.destroy,
  };
}

/**
 * The deck without its environment: a flat navy sea from the horizon, and again from the waterline in front of
 * the hull, with the wake — the generated one where it loaded with the extras, since it needs nothing of the environment
 * — and its variants, and the cycles.
 */
function flatScenery(
  pixi: PixiModule,
  back: PixiContainer,
  front: PixiContainer,
  water: DrawnWater | null,
  layers: WeatherLayers | null,
  images: (path: string) => unknown,
): Scenery {
  const farSea: PixiGraphics = new pixi.Graphics();
  farSea.label = "sea:far";
  const nearSea: PixiGraphics = new pixi.Graphics();
  nearSea.label = "sea:near";
  const cutter = textureCutter(pixi, images);
  const wake = wakeOf(pixi, water, layers, cutter.cut);
  const variants = layers?.variants ?? null;
  const cycles = (variants?.cycles ?? []).map((cycle) => cycleLayer(pixi, cycle, cutter.cut, variantsOf(variants, `cycle:${cycle.id}`)));
  back.addChild(farSea);
  front.addChild(nearSea, ...wake.views, ...cycles.flatMap((cycle) => cycle.views));
  return {
    back,
    front,
    generated: false,
    layout(visible) {
      const left = Math.floor(visible.left) - 8;
      const width = Math.ceil(visible.right) + 8 - left;
      const bottom = Math.ceil(visible.bottom) + 8;
      farSea.clear().rect(left, HORIZON, width, bottom - HORIZON).fill(SEA_FALLBACK);
      nearSea.clear().rect(left, WATERLINE, width, bottom - WATERLINE).fill(SEA_FALLBACK);
      wake.layout(visible);
    },
    draw(seconds, plan, _minute, weather = deliveredWeather(seconds)) {
      wake.draw(weather, plan, WAKE_SPEED);
      for (const cycle of cycles) cycle.draw(weather, plan);
      return null;
    },
    flashing: () => [],
    destroy: cutter.destroy,
  };
}
