/**
 * The generated environment drawn with Pixi (`art/ship-deck/ENVIRONMENT.md`): the sky behind the ship,
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
 * Without the environment (it failed to load, or names an image it did not send) the deck still draws:
 * a flat sea of the hull's navy over the theme's background, no sky, no gull — and the wake, on it.
 *
 * Every texture is cut from its own image once, except the foam's crops, which are made as the scroll
 * first reaches them and kept: at most a few hundred small objects on twenty images' sources.
 */
import { environmentImagePaths, GULL_POSES, type DeckEnvironmentManifest, type GullPose } from "../shared/ship-deck";
import { gullsAt, HORIZON, SEA_FALLBACK, WATERLINE, type MotionPlan } from "./deck-ambient";
import { cloudColours, cloudField, cloudX, type CloudImages } from "./deck-clouds";
import type { PixiContainer, PixiGraphics, PixiModule, PixiSprite, PixiTexture, PixiTextureSource } from "./deck-pixi";
import { DECK_HEIGHT, DECK_WIDTH } from "./deck-scene";
import { gullPose, scrollOffset, skyBlend, skyHorizonRow, skyPlacement, type SkyBlend } from "./deck-sky";
import { WAKE_COLOURS, WAKE_SPEED, wakeRuns } from "./deck-wake";
import { CALM_WATER, wakeTopLeft, waterDrift, waterFrame, type DrawnWater, type WaterManifest } from "./deck-water";

/** The environment as the mount hands it over: what the manifest says, and each image it names, decoded. */
export interface DeckEnvironmentImages {
  manifest: DeckEnvironmentManifest;
  images: ReadonlyMap<string, unknown>;
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
  /** Draws it at `seconds` on the scene clock and `minute` of the local day; the sky drawn, or null without one. */
  draw(seconds: number, plan: MotionPlan, minute: number | null): SkyBlend | null;
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

/** A wake on the deck: the generated one (`generatedWake`) or the one drawn in code (`codeWake`). */
interface WakeLayer {
  readonly view: PixiContainer;
  layout(visible: VisibleWorld): void;
  draw(seconds: number, plan: MotionPlan, pixelsPerSecond: number): void;
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
    view: graphics,
    layout(visible: VisibleWorld) {
      reach = { right: Math.ceil(visible.right), bottom: Math.ceil(visible.bottom) };
    },
    draw(seconds: number, plan: MotionPlan, pixelsPerSecond: number) {
      const shift = plan.ambient && Number.isFinite(seconds) ? Math.floor(seconds * pixelsPerSecond) : 0;
      const key = `${shift}:${reach.right}:${reach.bottom}`;
      if (key === drawn) return;
      drawn = key;
      graphics.clear();
      for (const run of wakeRuns(shift, reach)) graphics.rect(run.x, run.y, run.width, 1).fill(WAKE_COLOURS[run.tone]);
    },
  };
}

/** The generated wake: one sprite at the stern, its frames in turn while the sea moves, never drifting. */
function generatedWake(pixi: PixiModule, wake: WaterManifest["wake"], frames: PixiTexture[]): WakeLayer {
  const sprite = new pixi.Sprite(frames[0]!);
  sprite.label = "wake";
  const at = wakeTopLeft(wake);
  sprite.position.set(at.x, at.y);
  return {
    view: sprite,
    layout() {},
    draw(seconds, plan) {
      sprite.texture = frames[waterFrame(seconds, wake, plan.ambient, CALM_WATER)]!;
    },
  };
}

/** The wake to draw: the generated one where every frame of it decoded, or the one drawn in code. */
function wakeOf(pixi: PixiModule, water: DrawnWater | null, cut: (path: string, x: number, y: number, width: number, height: number) => PixiTexture): WakeLayer {
  const wake = water?.wake ?? null;
  if (wake === null) return codeWake(pixi);
  return generatedWake(
    pixi,
    wake,
    wake.frames.map((path) => cut(path, 0, 0, wake.frameSize[0], wake.frameSize[1])),
  );
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
 * extras' animated sea, foam and wake, each drawn in place of the environment's own where it loaded.
 */
export function createScenery(
  pixi: PixiModule,
  environment: DeckEnvironmentImages | null,
  clouds: CloudImages | null = null,
  seed = 0,
  water: DrawnWater | null = null,
): Scenery {
  const back = new pixi.Container();
  back.label = "scenery:back";
  const front = new pixi.Container();
  front.label = "scenery:front";
  if (!environmentComplete(environment)) return flatScenery(pixi, back, front, water);

  const { manifest, images } = environment;
  const cutter = textureCutter(pixi, (path) => (images.has(path) ? images.get(path) : water?.images.get(path)));
  const { sources, made, cut } = cutter;

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

  // The clouds: each its three slot masks, one over the other in a container placed in the sky's pixels.
  const horizonRow = skyHorizonRow(manifest.sky.size);
  const cloudSprites = clouds?.manifest.sprites ?? [];
  const cloudLayer = new pixi.Container();
  cloudLayer.label = "clouds";
  const cloudSlots = cloudSprites.map(function (sprite) {
    const masks = clouds!.masks.get(sprite.texture)!;
    return masks.map(function (mask, slot) {
      const source = new pixi.ImageSource({ resource: mask });
      source.scaleMode = "nearest";
      sources.set(`${sprite.texture}#${slot}`, source);
      const texture = new pixi.Texture({ source, frame: new pixi.Rectangle(0, 0, sprite.size[0], sprite.size[1]) });
      made.push(texture);
      return texture;
    });
  });
  const field = cloudField(seed, cloudSprites, skyWidth, horizonRow).map(function (cloud) {
    const container = new pixi.Container();
    container.label = `cloud:${cloudSprites[cloud.sprite]!.id}`;
    const slots = cloudSlots[cloud.sprite]!.map(function (texture, slot) {
      const sprite = new pixi.Sprite(texture);
      sprite.label = `cloud:${["shadow", "body", "highlight"][slot]}`;
      container.addChild(sprite);
      return sprite;
    });
    cloudLayer.addChild(container);
    return { cloud, width: cloudSprites[cloud.sprite]!.size[0], container, slots };
  });
  let skyPlace = { x: 0, y: 0, scale: 1 };
  let cloudTint = "";
  let cloudDrift = { seconds: 0, drifting: false };
  /** Puts each cloud where its drift has it, in the sky's pixels at the sky's placement: whole sky pixels. */
  function placeClouds(): void {
    for (const { cloud, width, container } of field) {
      const x = cloudX(cloud, width, skyWidth, cloudDrift.seconds, cloudDrift.drifting);
      container.position.set(skyPlace.x + x * skyPlace.scale, skyPlace.y + cloud.row * skyPlace.scale);
      container.scale.set(skyPlace.scale);
    }
  }

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
  const seaFrames = seaPaths.map(function (path) {
    const whole = cut(path, 0, 0, tileWidth, tileHeight);
    return { whole, fromWaterline: nearFirstRow === 0 ? whole : cut(path, 0, nearFirstRow, tileWidth, tileHeight - nearFirstRow) };
  });
  let seaFrame = 0;
  const farSea = new pixi.Container();
  farSea.label = "sea:far";
  const nearSea = new pixi.Container();
  nearSea.label = "sea:near";
  /** Every tile, and whether it is the near sea's first row, cut at the waterline. */
  let tiles: Array<{ parent: PixiContainer; sprite: PixiSprite; atWaterline: boolean }> = [];
  let tiled = { left: 0, right: 0, bottom: 0 };

  // The foam: up to three crops of the repeating strip a frame, laid end to end across the hull — the animated
  // water's frames from its own top and span, or the environment's one strip.
  const waterFoam = water?.foam ?? null;
  const foamPaths = waterFoam?.frames ?? [manifest.foam.texture];
  const foamPeriod = waterFoam?.frameSize[0] ?? manifest.foam.period;
  const foamHeight = waterFoam?.frameSize[1] ?? FOAM_HEIGHT;
  const foamTop = waterFoam?.top ?? FOAM_TOP;
  const foamSpan = waterFoam === null ? FOAM_SPAN : { left: waterFoam.span[0], right: waterFoam.span[1] };
  const foamSpeed = waterFoam === null ? manifest.foam.xPixelsPerSecond : waterDrift(waterFoam, CALM_WATER);
  const foamCrops = new Map<string, PixiTexture>();
  function foamCrop(frame: number, from: number, width: number): PixiTexture {
    const key = `${frame}:${from}:${width}`;
    let texture = foamCrops.get(key);
    if (texture === undefined) {
      texture = cut(foamPaths[frame]!, from, 0, width, foamHeight);
      foamCrops.set(key, texture);
    }
    return texture;
  }
  const foam = new pixi.Container();
  foam.label = "foam";
  const foamPieces: PixiSprite[] = [];
  for (let index = 0; index < 3; index += 1) {
    const sprite = new pixi.Sprite(foamCrop(0, 0, 1));
    sprite.visible = false;
    foam.addChild(sprite);
    foamPieces.push(sprite);
  }
  let foamDrawn = "";

  const wake = wakeOf(pixi, water, cut);

  back.addChild(skyUnder, skyOver, ...overlays, ...(field.length > 0 ? [cloudLayer] : []), ...gulls, farSea);
  front.addChild(nearSea, wake.view, foam);

  function tile(parent: PixiContainer, atWaterline: boolean, x: number, y: number): void {
    const frame = seaFrames[seaFrame]!;
    const sprite = new pixi.Sprite(atWaterline ? frame.fromWaterline : frame.whole);
    sprite.position.set(x, y);
    parent.addChild(sprite);
    tiles.push({ parent, sprite, atWaterline });
  }

  return {
    back,
    front,
    generated: true,
    layout(visible) {
      const place = skyPlacement(visible, manifest.sky.size, horizonRow);
      for (const sprite of [skyUnder, skyOver, ...overlays]) {
        sprite.position.set(place.x, place.y);
        sprite.scale.set(place.scale);
      }
      skyPlace = place;
      // Again here, not only in `draw`: a still deck's camera can lay the sky out anew without a draw after.
      placeClouds();
      wake.layout(visible);
      if (tiles.length > 0 && visible.left >= tiled.left && visible.right <= tiled.right && visible.bottom <= tiled.bottom) return;
      // A tile's width of slack either side, so a scroll of up to a tile never shows an edge.
      tiled = { left: Math.floor(visible.left) - 8, right: Math.ceil(visible.right) + 8, bottom: Math.ceil(visible.bottom) + 8 };
      for (const { parent, sprite } of tiles) {
        parent.removeChild(sprite);
        sprite.destroy();
      }
      tiles = [];
      const first = Math.floor(tiled.left / tileWidth) * tileWidth - tileWidth;
      for (let x = first; x < tiled.right + tileWidth; x += tileWidth) {
        for (let y = HORIZON; y < tiled.bottom; y += tileHeight) tile(farSea, false, x, y);
        tile(nearSea, true, x, WATERLINE);
        for (let y = WATERLINE - nearFirstRow + tileHeight; y < tiled.bottom; y += tileHeight) tile(nearSea, false, x, y);
      }
    },
    draw(seconds, plan, minute) {
      const blend = skyBlend(minute, manifest.sky.phases);
      skyUnder.texture = phases[blend.from]!;
      skyOver.texture = phases[blend.to]!;
      skyOver.alpha = blend.t;
      skyOver.visible = blend.to !== blend.from && blend.t > 0;
      for (const sprite of overlays) {
        sprite.alpha = blend.stars;
        sprite.visible = blend.stars > 0;
      }
      if (clouds !== null && field.length > 0) {
        // The clouds in the sky's pixels, whole ones, drifting only while the sea scrolls; recoloured when the sky's blend moves them.
        cloudDrift = { seconds, drifting: plan.ambient };
        placeClouds();
        const colours = cloudColours(clouds.manifest, manifest.sky.phases, blend);
        const tint = colours.join(":");
        if (tint !== cloudTint) {
          cloudTint = tint;
          for (const { slots } of field) slots.forEach((sprite, slot) => (sprite.tint = colours[slot]!));
        }
      }

      // The sea: every tile on the same frame, both bands drifting together.
      const drift = plan.ambient ? scrollOffset(seconds, seaSpeed, tileWidth) : 0;
      farSea.position.set(drift, 0);
      nearSea.position.set(drift, 0);
      const nextSea = sea === null ? 0 : waterFrame(seconds, sea, plan.ambient, CALM_WATER);
      if (nextSea !== seaFrame) {
        seaFrame = nextSea;
        const frame = seaFrames[seaFrame]!;
        for (const { sprite, atWaterline } of tiles) sprite.texture = atWaterline ? frame.fromWaterline : frame.whole;
      }
      wake.draw(seconds, plan, seaSpeed);

      const lap = plan.ambient ? scrollOffset(seconds, foamSpeed, foamPeriod) : 0;
      const foamFrame = waterFoam === null ? 0 : waterFrame(seconds, waterFoam, plan.ambient, CALM_WATER);
      if (`${foamFrame}:${lap}` !== foamDrawn) {
        const segments = foamSegments(foamSpan, foamPeriod, lap);
        foamPieces.forEach(function (sprite, index) {
          const segment = segments[index];
          sprite.visible = segment !== undefined;
          if (segment === undefined) return;
          sprite.texture = foamCrop(foamFrame, segment.from, segment.width);
          sprite.position.set(segment.x, foamTop);
        });
        foamDrawn = `${foamFrame}:${lap}`;
      }

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
    destroy: cutter.destroy,
  };
}

/**
 * The deck without its environment: a flat navy sea from the horizon, and again from the waterline in front of
 * the hull, with the wake — the generated one where it loaded with the extras, since it needs nothing of the environment.
 */
function flatScenery(pixi: PixiModule, back: PixiContainer, front: PixiContainer, water: DrawnWater | null): Scenery {
  const farSea: PixiGraphics = new pixi.Graphics();
  farSea.label = "sea:far";
  const nearSea: PixiGraphics = new pixi.Graphics();
  nearSea.label = "sea:near";
  const cutter = textureCutter(pixi, (path) => water?.images.get(path));
  const wake = wakeOf(pixi, water, cutter.cut);
  back.addChild(farSea);
  front.addChild(nearSea, wake.view);
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
    draw(seconds, plan) {
      wake.draw(seconds, plan, WAKE_SPEED);
      return null;
    },
    destroy: cutter.destroy,
  };
}
