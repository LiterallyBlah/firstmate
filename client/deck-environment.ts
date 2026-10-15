/**
 * The setting's scenery drawn with Pixi: its ambience behind the stage — for the ship, the sky of the local time of
 * day, its overcast and stars, the lightning, the drifting clouds and a gull now and then — and the scrolling sea with
 * foam at the hull's waterline. `client/deck-pixi.ts` puts `back` behind the stage and `front` in front of it; which
 * elements there are is the pack's (`client/deck-ambience.ts`), and the arithmetic is `client/deck-sky.ts`,
 * `client/deck-clouds.ts`, `client/deck-flash.ts` and `client/deck-ambient.ts`.
 *
 * The ambience, each element of it in its slot in the pack's order, by its behaviour:
 *
 * - **A backdrop cycle** (`backdrop-cycle@1`, the sky) — two of its day phases' backdrops, the earlier whole and the
 *   later over it at the day's blend, never two over transparency, so nothing drifting over it jumps in a fade. Placed
 *   once per layout at the stage's pixel scale, centred on the stage, never tiled; tinted towards its `tint` by its
 *   level (the ship's mood: a shade greyer as the crew gets busy).
 * - **An overlay** (`overlay@1`) — a sprite in a backdrop's placement: the stars, faded with the night's share and
 *   hidden as far as the overcast shows; the overcast, along its curve over the weather's intensity, by day only and in
 *   the backdrop's tint.
 * - **A flash** (`flash@1`, the lightning) — now and then, under a drifter in view (`client/deck-flash.ts`).
 * - **Drifters** (`drifters@1`, the clouds) — in a backdrop's own placement and pixels, drifting right on their clock
 *   and coloured by the day and the backdrop's tint (`client/deck-clouds.ts`), each under its variants as the weather
 *   has them.
 * - **A flyby** (`flyby@1`, the gull) — its poses, registered at its anchor, mirrored to fly left; never while the
 *   night's share is past its `nightBelow`.
 *
 * Each runs, holds still or is not drawn as its element says for a software renderer and reduced motion
 * (`elementMotion`).
 *
 * The sea, until step 5b of the migration reads it from the pack, is the legacy views' (`client/deck-legacy.ts`):
 *
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
 * **The weather** (`client/deck-atmosphere.ts`) is handed to `draw` each frame: the water's and the drifters' own
 * clocks, so a busier crew plays the sea's frames and drifts the sea, foam and clouds faster without a jump; how
 * much wake there is (the generated wake's opacity, the code wake's length); and the channels the backdrop's tint
 * reads. Without it, the art's own timing at the scene's clock.
 *
 * **The weather layers** over the water (`client/deck-variants.ts`) follow the weather's intensity, each along its own
 * curve from the setting pack, and none is drawn while it is at nothing or on a still deck:
 *
 * - a **variant** over the sea (`sea:far:<id>`, `sea:near:<id>` over each band), the foam (`foam:<id>`), the wake
 *   (`wake:<id>`) or a cycle, on that element's own frame, drift and place; the element is not drawn under a whole
 *   `over` variant, and fades under a `crossfade` one;
 * - a **cycle** (`cycle:<id>`), looping on the water's clock over the foam, in front of the hull's waterline and
 *   below the crew, who never stand that low.
 *
 * Without the still sea (it failed to load) the deck still draws: a flat sea of the pack's `fallbackFill` over the
 * theme's background — and the wake, on it. An ambience element that failed is left out by itself.
 *
 * Every texture is cut from its own image once, except the foam's crops, which are made as the scroll
 * first reaches them and kept: at most a few hundred small objects on a few dozen images' sources.
 */
import { environmentImagePaths, type DeckEnvironmentManifest } from "./deck-legacy";
import { elementMotion, elementsOf, type AmbientElement, type DayCycle, type DeckAmbience } from "./deck-ambience";
import { flybyPose, flybysAt, HORIZON, SEA_FALLBACK, WATERLINE, type MotionPlan } from "./deck-ambient";
import { clockOf, deliveredWeather, levelAt, shade, tintToward, type Weather } from "./deck-atmosphere";
import { cloudColours, cloudField, cloudX, hexColour, variantPalette, type DrifterMasks } from "./deck-clouds";
import { flashAt, flashSalt, underCloud } from "./deck-flash";
import type { PixiContainer, PixiGraphics, PixiModule, PixiSprite, PixiTexture, PixiTextureSource } from "./deck-pixi";
import { backdropPlacement, dayBlend, dominantPhase, NO_DAY, scrollOffset, type DayBlend, type Placement } from "./deck-sky";
import { cycleFrame, curvePeak, opacityAt, variantBlend, variantsOf, type DrawnVariants, type Variant } from "./deck-variants";
import { WAKE_COLOURS, WAKE_SPEED, wakeRuns } from "./deck-wake";
import { CALM_WATER, wakeTopLeft, waterDrift, waterFrame, type DrawnWater, type WaterManifest } from "./deck-water";

/** The still sea and foam as the mount hands them over: what the legacy view says, and each image it names, decoded. */
export interface DeckEnvironmentImages {
  manifest: DeckEnvironmentManifest;
  images: ReadonlyMap<string, unknown>;
}

/** The weather layers over the water to draw, as the deck finds them in the extras: variants and cycles. */
export interface WeatherLayers {
  variants: DrawnVariants | null;
}

/** What the scenery is drawn from. */
export interface SceneryArt {
  /** The setting's ambience (`client/deck-ambience.ts`), drawn from `images`, the pack's by id, and `masks`, by image id. */
  ambience: DeckAmbience;
  images: ReadonlyMap<string, unknown>;
  masks: ReadonlyMap<string, DrifterMasks>;
  /** The still sea and foam, or null for the plain sea. */
  environment: DeckEnvironmentImages | null;
  /** The extras' animated sea, foam and wake, each drawn in place of the still one where it loaded. */
  water: DrawnWater | null;
  /** The extras' weather layers over the water, drawn as the weather's intensity says (`client/deck-variants.ts`). */
  layers: WeatherLayers | null;
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
/** The still foam strip's height, as the ship pack declares its image: transparent above and below the foam, never repeated down. */
export const FOAM_HEIGHT = 16;
/** The foam strip's top row: its densest rows, 6 to 10, lie on the waterline and just below it. */
export const FOAM_TOP = WATERLINE - 6;

export interface Scenery {
  /** Behind the stage: the ambience in the back slot, and the far sea. */
  readonly back: PixiContainer;
  /** In front of the hull from its waterline down: the near sea, the wake and the foam, and the ambience in the front slot. */
  readonly front: PixiContainer;
  /** Whether the generated sea is drawn, or the flat fallback. */
  readonly generated: boolean;
  /** Covers `visible`; cheap when it has not grown. */
  layout(visible: VisibleWorld): void;
  /**
   * Draws it at `seconds` on the scene clock and `minute` of the local day, in `weather` (the art's own timing at
   * `seconds` when not given); the day phase whose backdrop shows most, or null without a backdrop.
   */
  draw(seconds: number, plan: MotionPlan, minute: number | null, weather?: Weather): string | null;
  /** The flashes showing in what was last drawn, by id. */
  flashing(): string[];
  /** Lets go of its textures; `back` and `front` go with the stage they are on. */
  destroy(): void;
}

/** Whether every image the still sea and foam name arrived, so the generated sea can be drawn. */
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

type Cut = (image: string, x: number, y: number, width: number, height: number) => PixiTexture;

/** Cuts textures from decoded images, a source per image made once; `destroy` lets go of them all. */
function textureCutter(pixi: PixiModule, images: (image: string) => unknown) {
  const sources = new Map<string, PixiTextureSource>();
  const made: PixiTexture[] = [];
  return {
    sources,
    made,
    cut(image: string, x: number, y: number, width: number, height: number): PixiTexture {
      let source = sources.get(image);
      if (source === undefined) {
        source = new pixi.ImageSource({ resource: images(image) });
        source.scaleMode = "nearest";
        sources.set(image, source);
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

type Cutter = ReturnType<typeof textureCutter>;

/** The stage's size in its own pixels (`client/deck-stage.ts`): what the scenery is centred on and runs across. */
export interface StageSize {
  width: number;
  height: number;
}

/**
 * The scenery behind and in front of the stage, on a stage of `stage`'s size, from `art`. Drifters are laid out from
 * `seed`, so each opening has its own sky.
 */
export function createScenery(pixi: PixiModule, stage: StageSize, art: SceneryArt, seed = 0): Scenery {
  const back = new pixi.Container();
  back.label = "scenery:back";
  const front = new pixi.Container();
  front.label = "scenery:front";
  const { environment, water, layers } = art;
  // The pack's images by id, the still sea's and the extras' by path: the two never share a name.
  const cutter = textureCutter(
    pixi,
    (image) => art.images.get(image) ?? environment?.images.get(image) ?? water?.images.get(image) ?? layers?.variants?.images.get(image),
  );
  const ambience = ambienceLayers(pixi, stage, art.ambience, art.masks, cutter, seed);
  const sea = environmentComplete(environment) ? generatedSea(pixi, stage, environment, water, layers, cutter.cut) : flatSea(pixi, stage, water, layers, cutter.cut);
  // Until the sea is the pack's (step 5b), the ambience's back slot is behind all of it and its front slot in front.
  back.addChild(...ambience.back, ...sea.back);
  front.addChild(...sea.front, ...ambience.front);
  return {
    back,
    front,
    generated: sea.generated,
    layout(visible) {
      ambience.layout(visible);
      sea.layout(visible);
    },
    draw(seconds, plan, minute, weather = deliveredWeather(seconds)) {
      const phase = ambience.draw(seconds, plan, minute, weather);
      sea.draw(plan, weather);
      return phase;
    },
    flashing: ambience.flashing,
    destroy: cutter.destroy,
  };
}

/** A sprite of the pack: a rectangle of its image, or the whole image at the size the pack declares. */
function spriteTexture(cut: Cut, sprite: { image: string; rect?: readonly [number, number, number, number] | undefined }, sizes: DeckAmbience["sizes"]): PixiTexture {
  const [width, height] = sizes.get(sprite.image) ?? [1, 1];
  const [x, y, w, h] = sprite.rect ?? [0, 0, width, height];
  return cut(sprite.image, x, y, w, h);
}

/** A backdrop cycle on the deck: each day phase's texture, its two sprites, where it is placed, the part of it in view, and its tint. */
interface BackdropLayer {
  readonly element: AmbientElement<"backdrop-cycle">;
  readonly textures: readonly PixiTexture[];
  readonly views: readonly [PixiSprite, PixiSprite];
  place: Placement;
  /** The part of it that shows, in its own columns. */
  view: { left: number; right: number };
  tint: number;
}

/** A drifting field on the deck: its container, and where each of its sprites is, in its backdrop's pixels. */
interface DrifterLayer {
  readonly element: AmbientElement<"drifters">;
  readonly space: BackdropLayer;
  readonly container: PixiContainer;
  places(): Array<{ x: number; row: number; width: number; height: number }>;
  layout(): void;
  draw(seconds: number, plan: MotionPlan, weather: Weather, blend: DayBlend): void;
}

/** The phases of the day in order, or none. */
const phasesOf = (cycle: DayCycle | null) => cycle?.phases ?? [];

/**
 * The ambience's layers: each element the pack's compiled ambience draws, built after what it is drawn in or under,
 * and put in its slot in the pack's order.
 */
function ambienceLayers(pixi: PixiModule, stage: StageSize, ambience: DeckAmbience, masks: ReadonlyMap<string, DrifterMasks>, cutter: Cutter, seed: number) {
  const { cut } = cutter;
  const { dayCycle } = ambience;
  const phases = phasesOf(dayCycle);
  const views = new Map<string, PixiContainer[]>();

  // Backdrops: the two phases of the blend, the later over the earlier.
  const backdrops = new Map<string, BackdropLayer>();
  for (const element of elementsOf(ambience, "backdrop-cycle")) {
    const { behaviour } = element;
    const textures = phases.map((phase) => spriteTexture(cut, { image: behaviour.phases[phase.id]! }, ambience.sizes));
    const under = new pixi.Sprite(textures[0]!);
    under.label = `${element.id}:under`;
    const over = new pixi.Sprite(textures[0]!);
    over.label = `${element.id}:over`;
    const layer: BackdropLayer = { element, textures, views: [under, over], place: { x: 0, y: 0, scale: 1 }, view: { left: 0, right: behaviour.size[0] }, tint: 0xffffff };
    backdrops.set(element.id, layer);
    views.set(element.id, [under, over]);
  }

  // Overlays, in their backdrop's placement.
  const overlays = elementsOf(ambience, "overlay").map(function (element) {
    const { behaviour } = element;
    const space = backdrops.get(behaviour.space)!;
    const sprite = new pixi.Sprite(spriteTexture(cut, { image: behaviour.image }, ambience.sizes));
    sprite.label = `${space.element.id}:${element.id}`;
    if (behaviour.alpha !== "night") sprite.visible = false;
    views.set(element.id, [sprite]);
    return { element, space, sprite, peak: behaviour.alpha === "night" ? 0 : curvePeak(behaviour.alpha.curve) };
  });

  // Drifters, each sprite its three slot masks, one over the other in a container placed in its backdrop's pixels.
  const drifters = new Map<string, DrifterLayer>();
  for (const element of elementsOf(ambience, "drifters")) {
    const layer = drifterLayer(pixi, element, backdrops.get(element.behaviour.space)!, phases, masks, cutter, seed);
    drifters.set(element.id, layer);
    views.set(element.id, [layer.container]);
  }

  // Flashes, under their drifters.
  const flashes = elementsOf(ambience, "flash").map(function (element) {
    const { behaviour } = element;
    const frames = behaviour.frames.map((frame) => spriteTexture(cut, frame.sprite, ambience.sizes));
    const sprite = new pixi.Sprite(frames[0]!);
    sprite.label = `flash:${element.id}`;
    sprite.visible = false;
    views.set(element.id, [sprite]);
    return { element, under: drifters.get(behaviour.under)!, frames, sprite, salt: flashSalt(element.id) };
  });

  // Flybys: as many sprites as can be in the air at once, each registered at its anchor.
  const flybys = elementsOf(ambience, "flyby").map(function (element) {
    const { behaviour } = element;
    const poses = new Map(Object.entries(behaviour.poses).map(([id, sprite]) => [id, spriteTexture(cut, sprite, ambience.sizes)]));
    const sprites = Array.from({ length: behaviour.most }, function () {
      const sprite = new pixi.Sprite(poses.get(behaviour.glide) ?? poses.values().next().value!);
      sprite.label = element.id;
      sprite.anchor.set(behaviour.anchor[0] / behaviour.size[0], behaviour.anchor[1] / behaviour.size[1]);
      sprite.visible = false;
      return sprite;
    });
    views.set(element.id, sprites);
    return { element, poses, sprites };
  });

  const inSlot = (slot: AmbientElement["slot"]) => ambience.elements.filter((element) => element.slot === slot).flatMap((element) => views.get(element.id) ?? []);

  return {
    back: inSlot("back"),
    front: inSlot("front"),
    layout(visible: VisibleWorld) {
      for (const layer of backdrops.values()) {
        const { behaviour } = layer.element;
        layer.place = backdropPlacement(visible, behaviour.size, behaviour.placement, stage.width);
        for (const sprite of layer.views) {
          sprite.position.set(layer.place.x, layer.place.y);
          sprite.scale.set(layer.place.scale);
        }
        layer.view = { left: (visible.left - layer.place.x) / layer.place.scale, right: (visible.right - layer.place.x) / layer.place.scale };
      }
      for (const { space, sprite } of overlays) {
        sprite.position.set(space.place.x, space.place.y);
        sprite.scale.set(space.place.scale);
      }
      // Again here, not only in `draw`: a still deck's camera can lay the backdrop out anew without a draw after.
      for (const layer of drifters.values()) layer.layout();
    },
    draw(seconds: number, plan: MotionPlan, minute: number | null, weather: Weather): string | null {
      const { intensity } = weather;
      const blend = dayCycle === null ? NO_DAY : dayBlend(minute, dayCycle);
      let shown: string | null = null;
      for (const layer of backdrops.values()) {
        const { behaviour } = layer.element;
        const { textures } = layer;
        const [under, over] = layer.views;
        // Its tint: the ship's sky a shade greyer as the crew gets busy.
        const tint = behaviour.tint === undefined ? 0xffffff : tintToward(hexColour(behaviour.tint.to), levelAt(behaviour.tint.amount, weather));
        if (tint !== layer.tint) {
          layer.tint = tint;
          under.tint = tint;
          over.tint = tint;
        }
        const drawn = elementMotion(layer.element, plan) !== "hide";
        under.texture = textures[blend.from]!;
        under.visible = drawn;
        over.texture = textures[blend.to]!;
        over.alpha = blend.t;
        over.visible = drawn && blend.to !== blend.from && blend.t > 0;
        if (drawn) shown ??= phases[dominantPhase(blend)]?.id ?? null;
      }
      // The overlays: each at its alpha, then each hidden as far as those that hide it show by day.
      const alphas = new Map(
        overlays.map(({ element }) => [element.id, element.behaviour.alpha === "night" ? blend.night : opacityAt(element.behaviour.alpha.curve, intensity)]),
      );
      for (const { element, space, sprite } of overlays) {
        const { behaviour } = element;
        let alpha = alphas.get(element.id)!;
        if (behaviour.dayOnly === true) alpha = alpha * (1 - blend.night);
        if (behaviour.hiddenBy !== undefined && behaviour.hiddenBy.length > 0) {
          let covered = 0;
          for (const hider of overlays) if (behaviour.hiddenBy.includes(hider.element.id) && hider.peak > 0) covered = Math.max(covered, alphas.get(hider.element.id)! / hider.peak);
          alpha = alpha * (1 - covered);
        }
        sprite.alpha = alpha;
        sprite.visible = alpha > 0 && elementMotion(element, plan) !== "hide";
        if (behaviour.tint === "space") sprite.tint = space.tint;
      }
      for (const layer of drifters.values()) layer.draw(seconds, plan, weather, blend);
      for (const { element, under, frames, sprite, salt } of flashes) {
        // A flash now and then, tucked under a drifter in view; only while it runs.
        const { behaviour } = element;
        const moment = elementMotion(element, plan) === "run" && intensity !== null ? flashAt(seconds, behaviour, intensity, salt) : null;
        const alpha = moment === null ? 0 : opacityAt(behaviour.opacity, intensity) * moment.share;
        const spot = moment === null || alpha <= 0 ? null : underCloud(under.places(), moment.slot, behaviour, under.space.element.behaviour.placement.horizonRow, under.space.view, salt);
        sprite.visible = spot !== null;
        if (moment === null || spot === null) continue;
        const { place } = under.space;
        sprite.texture = frames[moment.frame]!;
        sprite.alpha = alpha;
        sprite.position.set(place.x + spot.x * place.scale, place.y + spot.y * place.scale);
        sprite.scale.set(place.scale);
      }
      for (const { element, poses, sprites } of flybys) {
        const { behaviour } = element;
        const flying = elementMotion(element, plan) === "run" && blend.night < behaviour.nightBelow ? flybysAt(seconds, stage.width, behaviour) : [];
        sprites.forEach(function (sprite, index) {
          const flyer = flying[index];
          sprite.visible = flyer !== undefined;
          if (flyer === undefined) return;
          sprite.texture = poses.get(flyer.flapping ? flybyPose(flyer.age, behaviour) : behaviour.glide)!;
          sprite.scale.set(flyer.flip ? -1 : 1, 1);
          sprite.position.set(flyer.x, flyer.y);
        });
      }
      return shown;
    },
    flashing: () => flashes.filter((each) => each.sprite.visible).map((each) => each.element.id),
  };
}

/** The slot masks' names, shadow to highlight. */
const SLOTS = ["shadow", "body", "highlight"] as const;

/** A field of drifters over `space`, laid out from `seed`, coloured by the day's `phases`. */
function drifterLayer(
  pixi: PixiModule,
  element: AmbientElement<"drifters">,
  space: BackdropLayer,
  phases: ReadonlyArray<{ id: string }>,
  masks: ReadonlyMap<string, DrifterMasks>,
  cutter: Cutter,
  seed: number,
): DrifterLayer {
  const { behaviour } = element;
  const { sprites } = behaviour;
  const [skyWidth] = space.element.behaviour.size;
  const { horizonRow } = space.element.behaviour.placement;
  const container = new pixi.Container();
  container.label = element.id;
  const maskTextures = (image: string, size: readonly [number, number]) =>
    masks.get(image)!.map(function (mask, slot) {
      const source = new pixi.ImageSource({ resource: mask });
      source.scaleMode = "nearest";
      cutter.sources.set(`${image}#${slot}`, source);
      const texture = new pixi.Texture({ source, frame: new pixi.Rectangle(0, 0, size[0], size[1]) });
      cutter.made.push(texture);
      return texture;
    });
  const slotTextures = sprites.map((sprite) => maskTextures(sprite.image, sprite.size));
  // Each sprite's variants: the same size, so the same place in the same lane.
  const variantTextures = sprites.map((sprite) => (sprite.variants ?? []).map((variant) => ({ variant, textures: maskTextures(variant.frames[0]!.image, sprite.size) })));
  const field = cloudField(seed, sprites, skyWidth, horizonRow, behaviour).map(function (cloud) {
    const holder = new pixi.Container();
    holder.label = `${element.id}:${sprites[cloud.sprite]!.id}`;
    const masked = (textures: PixiTexture[], prefix: string) =>
      textures.map(function (texture, slot) {
        const sprite = new pixi.Sprite(texture);
        sprite.label = `${prefix}${SLOTS[slot]}`;
        holder.addChild(sprite);
        return sprite;
      });
    const slots = masked(slotTextures[cloud.sprite]!, `${element.id}:`);
    const over = variantTextures[cloud.sprite]!.map(function ({ variant, textures }) {
      const layered = masked(textures, `${element.id}:${variant.id}:`);
      for (const mask of layered) mask.visible = false;
      return { variant, masks: layered };
    });
    container.addChild(holder);
    const [width, height] = sprites[cloud.sprite]!.size;
    return { cloud, width, height, holder, slots, over };
  });
  let drift = { seconds: 0, drifting: false };
  let tinted = "";
  const x = (cloud: (typeof field)[number]["cloud"], width: number) => cloudX(cloud, width, skyWidth, behaviour.margin, drift.seconds, drift.drifting);
  /** Puts each where its drift has it, in the backdrop's pixels at its placement: whole backdrop pixels. */
  function place(): void {
    const { place } = space;
    for (const { cloud, width, holder } of field) {
      holder.position.set(place.x + x(cloud, width) * place.scale, place.y + cloud.row * place.scale);
      holder.scale.set(place.scale);
    }
  }
  return {
    element,
    space,
    container,
    places: () => field.map(({ cloud, width, height }) => ({ x: x(cloud, width), row: cloud.row, width, height })),
    layout: place,
    draw(seconds, plan, weather, blend) {
      // Drifting only while it runs, on its clock; recoloured when the day's blend or the backdrop's tint moves them.
      const motion = elementMotion(element, plan);
      container.visible = motion !== "hide";
      drift = { seconds: clockOf(weather, behaviour.clock, seconds), drifting: motion === "run" };
      place();
      const colours = cloudColours(behaviour, phases, blend).map((colour) => shade(colour, space.tint));
      const variantColours = new Map(
        variantTextures
          .flat()
          .map(({ variant }) => [variant.id, cloudColours(variantPalette(variant, behaviour), phases, blend).map((colour) => shade(colour, space.tint))]),
      );
      const key = [...colours, ...[...variantColours.values()].flat()].join(":");
      if (key !== tinted) {
        tinted = key;
        for (const { slots, over } of field) {
          slots.forEach((sprite, slot) => (sprite.tint = colours[slot]!));
          for (const { variant, masks } of over) masks.forEach((sprite, slot) => (sprite.tint = variantColours.get(variant.id)![slot]!));
        }
      }
      // Each under its variants, as the weather has them.
      for (const { slots, over } of field) {
        if (over.length === 0) continue;
        const mix = variantBlend(
          over.map(({ variant }) => variant),
          weather.intensity,
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
    },
  };
}

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
function codeWake(pixi: PixiModule, stage: StageSize): WakeLayer {
  const graphics: PixiGraphics = new pixi.Graphics();
  graphics.label = "wake";
  let reach = { right: stage.width, bottom: stage.height };
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
function wakeOf(pixi: PixiModule, stage: StageSize, water: DrawnWater | null, layers: WeatherLayers | null, cut: Cut): WakeLayer {
  const wake = water?.wake ?? null;
  return wake === null ? codeWake(pixi, stage) : generatedWake(pixi, wake, cut, variantsOf(layers?.variants ?? null, "wake"));
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

/** The sea's layers: behind the stage and in front of its waterline. */
interface SeaLayers {
  readonly back: PixiContainer[];
  readonly front: PixiContainer[];
  readonly generated: boolean;
  layout(visible: VisibleWorld): void;
  draw(plan: MotionPlan, weather: Weather): void;
}

/**
 * The generated sea: the still tile or the animated one, both bands; the wake; the foam; the extras' weather layers over
 * them, and the cycles.
 */
function generatedSea(pixi: PixiModule, stage: StageSize, environment: DeckEnvironmentImages, water: DrawnWater | null, layers: WeatherLayers | null, cut: Cut): SeaLayers {
  const { manifest } = environment;
  const variants = layers?.variants ?? null;

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

  const wake = wakeOf(pixi, stage, water, layers, cut);
  const cycles = (variants?.cycles ?? []).map((cycle) => cycleLayer(pixi, cycle, cut, variantsOf(variants, `cycle:${cycle.id}`)));

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
    back: [farSea, ...seaOver.map((band) => band.far)],
    front: [nearSea, ...seaOver.map((band) => band.near), ...wake.views, foam.container, ...foamOver.map((strip) => strip.container), ...cycles.flatMap((cycle) => cycle.views)],
    generated: true,
    layout(visible) {
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
    draw(plan, weather) {
      const { intensity } = weather;
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
    },
  };
}

/**
 * The sea without its still tile: a flat navy sea from the horizon, and again from the waterline in front of the hull,
 * with the wake — the generated one where it loaded with the extras, since it needs nothing of the still sea — and its
 * variants, and the cycles.
 */
function flatSea(pixi: PixiModule, stage: StageSize, water: DrawnWater | null, layers: WeatherLayers | null, cut: Cut): SeaLayers {
  const farSea: PixiGraphics = new pixi.Graphics();
  farSea.label = "sea:far";
  const nearSea: PixiGraphics = new pixi.Graphics();
  nearSea.label = "sea:near";
  const wake = wakeOf(pixi, stage, water, layers, cut);
  const variants = layers?.variants ?? null;
  const cycles = (variants?.cycles ?? []).map((cycle) => cycleLayer(pixi, cycle, cut, variantsOf(variants, `cycle:${cycle.id}`)));
  return {
    back: [farSea],
    front: [nearSea, ...wake.views, ...cycles.flatMap((cycle) => cycle.views)],
    generated: false,
    layout(visible) {
      const left = Math.floor(visible.left) - 8;
      const width = Math.ceil(visible.right) + 8 - left;
      const bottom = Math.ceil(visible.bottom) + 8;
      farSea.clear().rect(left, HORIZON, width, bottom - HORIZON).fill(SEA_FALLBACK);
      nearSea.clear().rect(left, WATERLINE, width, bottom - WATERLINE).fill(SEA_FALLBACK);
      wake.layout(visible);
    },
    draw(plan, weather) {
      wake.draw(weather, plan, WAKE_SPEED);
      for (const cycle of cycles) cycle.draw(weather, plan);
    },
  };
}
