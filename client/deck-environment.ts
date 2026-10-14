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
 * - **Gull** — the three-pose sprite, registered at the beak, mirrored to fly left. Behind the ship, in
 *   daylight only: no gull sets off while the stars are more than half out.
 * - **Sea** — the 256 × 128 tile, repeated both ways from the horizon down, scrolled sideways a whole
 *   pixel at a time. The same tiles again in front of the hull from its waterline down, cut to line up,
 *   so the waterline is the hull's edge and not a seam across the water.
 * - **Foam** — the strip across the hull's waterline only, cut from a scrolling repeat into at most three
 *   sprites a frame, so it never runs out into open water. Generic, not fitted to hull C's curve.
 *
 * Without the environment (it failed to load, or names an image it did not send) the deck still draws:
 * a flat sea of the hull's navy over the theme's background, no sky, no gull.
 *
 * Every texture is cut from its own image once, except the foam's crops, which are made as the scroll
 * first reaches them and kept: at most a few hundred small objects on six images' sources.
 */
import { environmentImagePaths, GULL_POSES, type DeckEnvironmentManifest, type GullPose } from "../shared/ship-deck";
import { gullsAt, HORIZON, SEA_FALLBACK, WATERLINE, type MotionPlan } from "./deck-ambient";
import type { PixiContainer, PixiGraphics, PixiModule, PixiSprite, PixiTexture, PixiTextureSource } from "./deck-pixi";
import { gullPose, scrollOffset, skyBlend, skyHorizonRow, skyPlacement, type SkyBlend } from "./deck-sky";

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
  /** Behind the ship: the sky, the stars, the gull and the far sea. */
  readonly back: PixiContainer;
  /** In front of the hull from its waterline down: the near sea and the foam. */
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

export function createScenery(pixi: PixiModule, environment: DeckEnvironmentImages | null): Scenery {
  const back = new pixi.Container();
  back.label = "scenery:back";
  const front = new pixi.Container();
  front.label = "scenery:front";
  if (!environmentComplete(environment)) return flatScenery(pixi, back, front);

  const { manifest, images } = environment;
  const sources = new Map<string, PixiTextureSource>();
  const made: PixiTexture[] = [];
  function cut(path: string, x: number, y: number, width: number, height: number): PixiTexture {
    let source = sources.get(path);
    if (source === undefined) {
      source = new pixi.ImageSource({ resource: images.get(path) });
      source.scaleMode = "nearest";
      sources.set(path, source);
    }
    const texture = new pixi.Texture({ source, frame: new pixi.Rectangle(x, y, width, height) });
    made.push(texture);
    return texture;
  }

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

  // The water: one tile, and the same tile cut to start at the waterline for the near sea's first row.
  const [tileWidth, tileHeight] = manifest.sea.period;
  const water = cut(manifest.sea.texture, 0, 0, tileWidth, tileHeight);
  const nearFirstRow = (WATERLINE - HORIZON) % tileHeight;
  const waterFromWaterline = nearFirstRow === 0 ? water : cut(manifest.sea.texture, 0, nearFirstRow, tileWidth, tileHeight - nearFirstRow);
  const farSea = new pixi.Container();
  farSea.label = "sea:far";
  const nearSea = new pixi.Container();
  nearSea.label = "sea:near";
  let tiles: Array<[PixiContainer, PixiSprite]> = [];
  let tiled = { left: 0, right: 0, bottom: 0 };

  // The foam: up to three crops of the repeating strip a frame, laid end to end across the hull.
  const foamPeriod = manifest.foam.period;
  const foamCrops = new Map<string, PixiTexture>();
  function foamCrop(from: number, width: number): PixiTexture {
    const key = `${from}:${width}`;
    let texture = foamCrops.get(key);
    if (texture === undefined) {
      texture = cut(manifest.foam.texture, from, 0, width, FOAM_HEIGHT);
      foamCrops.set(key, texture);
    }
    return texture;
  }
  const foam = new pixi.Container();
  foam.label = "foam";
  const foamPieces: PixiSprite[] = [];
  for (let index = 0; index < 3; index += 1) {
    const sprite = new pixi.Sprite(foamCrop(0, 1));
    sprite.visible = false;
    foam.addChild(sprite);
    foamPieces.push(sprite);
  }
  let foamDrawn = -1;

  back.addChild(skyUnder, skyOver, ...overlays, ...gulls, farSea);
  front.addChild(nearSea, foam);

  function tile(parent: PixiContainer, texture: PixiTexture, x: number, y: number): void {
    const sprite = new pixi.Sprite(texture);
    sprite.position.set(x, y);
    parent.addChild(sprite);
    tiles.push([parent, sprite]);
  }

  return {
    back,
    front,
    generated: true,
    layout(visible) {
      const place = skyPlacement(visible, manifest.sky.size, skyHorizonRow(manifest.sky.size));
      for (const sprite of [skyUnder, skyOver, ...overlays]) {
        sprite.position.set(place.x, place.y);
        sprite.scale.set(place.scale);
      }
      if (tiles.length > 0 && visible.left >= tiled.left && visible.right <= tiled.right && visible.bottom <= tiled.bottom) return;
      // A tile's width of slack either side, so a scroll of up to a tile never shows an edge.
      tiled = { left: Math.floor(visible.left) - 8, right: Math.ceil(visible.right) + 8, bottom: Math.ceil(visible.bottom) + 8 };
      for (const [parent, sprite] of tiles) {
        parent.removeChild(sprite);
        sprite.destroy();
      }
      tiles = [];
      const first = Math.floor(tiled.left / tileWidth) * tileWidth - tileWidth;
      for (let x = first; x < tiled.right + tileWidth; x += tileWidth) {
        for (let y = HORIZON; y < tiled.bottom; y += tileHeight) tile(farSea, water, x, y);
        tile(nearSea, waterFromWaterline, x, WATERLINE);
        for (let y = WATERLINE - nearFirstRow + tileHeight; y < tiled.bottom; y += tileHeight) tile(nearSea, water, x, y);
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

      const drift = plan.ambient ? scrollOffset(seconds, manifest.sea.animation.xPixelsPerSecond, tileWidth) : 0;
      farSea.position.set(drift, 0);
      nearSea.position.set(drift, 0);

      const lap = plan.ambient ? scrollOffset(seconds, manifest.foam.xPixelsPerSecond, foamPeriod) : 0;
      if (lap !== foamDrawn) {
        const segments = foamSegments(FOAM_SPAN, foamPeriod, lap);
        foamPieces.forEach(function (sprite, index) {
          const segment = segments[index];
          sprite.visible = segment !== undefined;
          if (segment === undefined) return;
          sprite.texture = foamCrop(segment.from, segment.width);
          sprite.position.set(segment.x, FOAM_TOP);
        });
        foamDrawn = lap;
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
    destroy() {
      for (const texture of made) texture.destroy();
      for (const source of sources.values()) source.destroy();
    },
  };
}

/** The deck without its environment: a flat navy sea from the horizon, and again from the waterline in front of the hull. */
function flatScenery(pixi: PixiModule, back: PixiContainer, front: PixiContainer): Scenery {
  const farSea: PixiGraphics = new pixi.Graphics();
  farSea.label = "sea:far";
  const nearSea: PixiGraphics = new pixi.Graphics();
  nearSea.label = "sea:near";
  back.addChild(farSea);
  front.addChild(nearSea);
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
    },
    draw() {
      return null;
    },
    destroy() {},
  };
}
