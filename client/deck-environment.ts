/**
 * The setting's scenery drawn with Pixi: its ambience, behind the stage and in front of it — for the ship, the sky of
 * the local time of day, its overcast and stars, the lightning, the drifting clouds and a gull now and then behind the
 * hull, and the scrolling sea across both, with the wake, the foam at the waterline and the spindrift in front.
 * `client/deck-pixi.ts` puts `back` behind the stage and `front` in front of it; which elements there are is the pack's
 * (`client/deck-ambience.ts`), and the arithmetic is `client/deck-sky.ts`, `client/deck-clouds.ts`,
 * `client/deck-flash.ts`, `client/deck-ambient.ts` and `client/deck-variants.ts`.
 *
 * Each element is drawn in its slot in the pack's order, by its behaviour:
 *
 * - **A backdrop cycle** (`backdrop-cycle@1`, the sky) — two of its day phases' backdrops, the earlier whole and the
 *   later over it at the day's blend, never two over transparency, so nothing drifting over it jumps in a fade. Placed
 *   once per layout at the stage's pixel scale, centred on the stage, never tiled; tinted towards its `tint` by its
 *   level (the ship's mood: a shade greyer as the crew gets busy).
 * - **An overlay** (`overlay@1`) — a sprite in a backdrop's placement: the stars, faded with the night's share and
 *   hidden as far as the overcast shows; the overcast, along its curve over the weather's intensity, by day only and in
 *   the backdrop's tint. Intensity-driven overlays extend their edge pixels into any uncovered viewport area;
 *   their original image and horizon stay fixed. Night overlays retain the backdrop's placement alone.
 * - **A flash** (`flash@1`, the lightning) — now and then, under a drifter in view (`client/deck-flash.ts`).
 * - **Drifters** (`drifters@1`, the clouds) — in a backdrop's own placement and pixels, drifting right on their clock
 *   and coloured by the day and the backdrop's tint (`client/deck-clouds.ts`), each under its variants as the weather
 *   has them.
 * - **A flyby** (`flyby@1`, the gull) — its poses, registered at its anchor, mirrored to fly left; never while the
 *   night's share is past its `nightBelow`.
 * - **A tile** (`tile@1`, the sea) — its frames repeated both ways in each of its bands, every band from its own row
 *   (`<id>:back` from the ship's horizon behind the hull, `<id>:front` from its waterline in front of it) and all of
 *   them on one tile origin, so the second band's first row is cut to line up and the waterline is the hull's edge,
 *   not a seam across the water. A single band starting at or above stage row zero fills the viewport upward too,
 *   on the same grid. Every tile on the same frame, scrolled sideways a whole pixel at a time.
 * - **A strip** (`strip@1`, the foam) — its frames repeated sideways within its span from its top row, cut from a
 *   scrolling repeat into a few sprites a frame, so it never runs out past the span.
 * - **A cycle** (`cycle@1`, the wake and the spindrift) — one sprite, its anchor on its point, its frames in turn, its
 *   opacity its level (the wake's the weather's wake channel, the spindrift's a curve over intensity).
 * - **Phase frames** (`phase-frames@1`) — one anchored sprite selected by the local hour or minute, modulo its
 *   frame count. Independent of simulation time and intensity; held at frame zero or hidden in reduced motion.
 * - **Phase strips** (`phase-strip@1`) — a strip's day sets sharing its frame index and crops. Eased phase weights
 *   sum into a transparent intermediate, preserving opaque pixels and fading transparent details both ways.
 *
 * Each runs, holds still (its first frame, no drift) or is not drawn as its element says for a software renderer and
 * reduced motion (`elementMotion`). A tile, strip or cycle has its **variants** over it (`client/deck-variants.ts`):
 * frame for frame on its frame and drift and place (`<id>:<variant>`, and per band for a tile), each faded in along its
 * curve over the weather's intensity; the element is not drawn under a whole `over` variant, and fades under a
 * `crossfade` one. None shows on a still deck, which has no intensity.
 *
 * **The weather** (`client/deck-atmosphere.ts`) is handed to `draw` each frame: each clock an element names (the
 * water's frames and drift, the wind), so a busier crew plays the sea's frames and drifts the sea, foam and clouds
 * faster without a jump, and the channels levels read (the wake, the mood). Without it, the art's own timing at the
 * scene's clock.
 *
 * **What is missing is never a hole**: an element that failed is left out by itself or stood in for by its fallback
 * (the ship's still sea and foam), and a tile with neither is a flat `fallbackFill` across its bands. Nothing is
 * drawn in code in an element's place any more: without its art and a fallback, an element is not drawn (the wake).
 *
 * Every texture is cut from its own image once, except a strip's crops, which are made as the scroll first reaches them
 * and kept: bounded by the repeat width, crop widths and distinct frame sets, sharing their image sources.
 */
import { elementMotion, elementsOf, type AmbientElement, type DayCycle, type DeckAmbience } from "./deck-ambience";
import { flybyPose, flybysAt, type MotionPlan } from "./deck-ambient";
import { clockOf, deliveredWeather, levelAt, shade, tintToward, type DeckAtmosphere, type Weather } from "./deck-atmosphere";
import { cloudColours, cloudField, cloudX, hexColour, variantPalette, type DrifterMasks } from "./deck-clouds";
import { flashAt, flashSalt, underCloud } from "./deck-flash";
import { phaseFrameAt } from "./deck-phase-frames";
import { phaseStripSets, phaseStripWeights } from "./deck-phase-strip";
import { precipLayer } from "./deck-precip-view";
import { depthWashAt, depthWashAlpha } from "./deck-depth-wash";
import type { PixiContainer, PixiGraphics, PixiModule, PixiSprite, PixiTexture, PixiTextureSource } from "./deck-pixi";
import { backdropPlacement, dayBlend, dominantPhase, NO_DAY, scrollOffset, type DayBlend, type Placement } from "./deck-sky";
import { cycleFrame, curvePeak, opacityAt, variantBlend, type Variant } from "./deck-variants";

/** What the scenery is drawn from. */
export interface SceneryArt {
  /** The setting's ambience (`client/deck-ambience.ts`), drawn from `images`, the pack's by id, and `masks`, by image id. */
  ambience: DeckAmbience;
  atmosphere: DeckAtmosphere;
  images: ReadonlyMap<string, unknown>;
  masks: ReadonlyMap<string, DrifterMasks>;
}

/** The part of the world the screen shows, in deck coordinates. */
export interface VisibleWorld {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Scenery {
  /** Behind the stage: the elements in the back slot, and the bands of tiles there. */
  readonly back: PixiContainer;
  /** In front of the stage: the elements in the front slot, and the bands of tiles there. */
  readonly front: PixiContainer;
  /** Whether a tile is drawn from its art, not filled flat. */
  readonly generated: boolean;
  /** Covers `visible`; cheap when it has not grown. */
  layout(visible: VisibleWorld, pane?: { width: number; height: number }): void;
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

/**
 * A strip's pieces across `span` at `offset`: where each starts on the deck, and the part of the repeating strip it
 * shows. The strip is anchored to the world, so it scrolls with the water.
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
  const effects: Array<{ destroy(): void }> = [];
  return {
    sources,
    made,
    effects,
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
      for (const effect of effects) effect.destroy();
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
  const cutter = textureCutter(pixi, (image) => art.images.get(image));
  const layers = ambienceLayers(pixi, stage, art.ambience, art.masks, cutter, seed);
  if (layers.back.length > 0) back.addChild(...layers.back);
  if (layers.front.length > 0) front.addChild(...layers.front);
  return {
    back,
    front,
    generated: layers.generated,
    layout: layers.layout,
    draw(seconds, plan, minute, weather = deliveredWeather(art.atmosphere, seconds)) {
      return layers.draw(seconds, plan, minute, weather);
    },
    flashing: layers.flashing,
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

/** What an element puts in each slot. */
interface SlotViews {
  back: PixiContainer[];
  front: PixiContainer[];
}

/**
 * The ambience's layers: each element the pack's compiled ambience draws, built after what it is drawn in or under,
 * each tile with nothing to draw it filled flat; all of it put in its slot in the pack's order.
 */
function ambienceLayers(
  pixi: PixiModule,
  stage: StageSize,
  ambience: DeckAmbience,
  masks: ReadonlyMap<string, DrifterMasks>,
  cutter: Cutter,
  seed: number,
) {
  const { cut } = cutter;
  const { dayCycle } = ambience;
  const phases = phasesOf(dayCycle);
  const views = new Map<string, SlotViews>();
  /** An element's views, all in its own slot. */
  const own = (element: Pick<AmbientElement, "slot">, containers: PixiContainer[]): SlotViews => ({
    back: element.slot === "back" ? containers : [],
    front: element.slot === "front" ? containers : [],
  });

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
    views.set(element.id, own(element, [under, over]));
  }

  // Overlays, in their backdrop's placement.
  const overlays = elementsOf(ambience, "overlay").map(function (element) {
    const { behaviour } = element;
    const space = backdrops.get(behaviour.space)!;
    const sprite = new pixi.Sprite(spriteTexture(cut, { image: behaviour.image }, ambience.sizes));
    sprite.label = `${space.element.id}:${element.id}`;
    if (behaviour.alpha !== "night") sprite.visible = false;
    // Weather overlays fill beyond their backdrop with its edge pixels. Keep the original image
    // untouched (including its horizon); night art such as moons and stars stays in its own space.
    const [width, height] = ambience.sizes.get(behaviour.image)!;
    const edges = behaviour.alpha === "night" ? [] : [-1, 0, 1].flatMap((row) => [-1, 0, 1].flatMap((column) => {
      if (row === 0 && column === 0) return [];
      const texture = cut(behaviour.image, column < 0 ? 0 : column > 0 ? width - 1 : 0,
        row < 0 ? 0 : row > 0 ? height - 1 : 0, column === 0 ? width : 1, row === 0 ? height : 1);
      const edge = new pixi.Sprite(texture);
      edge.label = `${sprite.label}:edge:${column}:${row}`;
      return [{ row, column, sprite: edge }];
    }));
    const sprites = [sprite, ...edges.map((edge) => edge.sprite)];
    views.set(element.id, own(element, sprites));
    return { element, space, sprite, sprites, edges, width, height, peak: behaviour.alpha === "night" ? 0 : curvePeak(behaviour.alpha.curve) };
  });

  // Drifters, each sprite its three slot masks, one over the other in a container placed in its backdrop's pixels.
  const drifters = new Map<string, DrifterLayer>();
  for (const element of elementsOf(ambience, "drifters")) {
    const layer = drifterLayer(pixi, element, backdrops.get(element.behaviour.space)!, phases, masks, cutter, seed);
    drifters.set(element.id, layer);
    views.set(element.id, own(element, [layer.container]));
  }

  // Flashes, under their drifters.
  const flashes = elementsOf(ambience, "flash").map(function (element) {
    const { behaviour } = element;
    const frames = behaviour.frames.map((frame) => spriteTexture(cut, frame.sprite, ambience.sizes));
    const sprite = new pixi.Sprite(frames[0]!);
    sprite.label = `flash:${element.id}`;
    sprite.visible = false;
    views.set(element.id, own(element, [sprite]));
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
    views.set(element.id, own(element, sprites));
    return { element, poses, sprites };
  });

  // Wall-clock frames: one anchored sprite, with no simulation clock, interpolation or intensity binding.
  const phaseFrames = elementsOf(ambience, "phase-frames").map(function (element) {
    const { behaviour } = element;
    const frames = behaviour.frames.map((frame) => spriteTexture(cut, frame, ambience.sizes));
    const sprite = new pixi.Sprite(frames[0]!);
    sprite.label = element.place;
    sprite.position.set(behaviour.at[0] - behaviour.anchor[0], behaviour.at[1] - behaviour.anchor[1]);
    views.set(element.id, own(element, [sprite]));
    return { element, frames, sprite };
  });

  // The water: tiles, strips and cycles, each its own layer; a tile with nothing to draw it, filled flat.
  const placedLayer = <Layer extends SlotViews>(id: string, layer: Layer) => {
    views.set(id, layer);
    return layer;
  };
  const tiles = elementsOf(ambience, "tile").map((element) => placedLayer(element.id, tileLayer(pixi, element, cut, ambience.sizes, phases)));
  const precipitation = elementsOf(ambience, "precip").map((element) => {
    const layer = precipLayer(pixi, element, ambience.sceneId ?? "", seed,
      (sprite) => spriteTexture(cut, sprite, ambience.sizes), ambience.sizes);
    views.set(element.id, own(element, [layer.container]));
    return layer;
  });
  const water: WaterLayer[] = [
    ...tiles,
    ...elementsOf(ambience, "strip").map((element) => placedLayer(element.id, stripLayer(pixi, element, cut, ambience.sizes))),
    ...elementsOf(ambience, "phase-strip").map((element) => placedLayer(element.id, stripLayer(pixi, element, cut, ambience.sizes, phases, cutter.effects))),
    ...elementsOf(ambience, "cycle").map((element) => placedLayer(element.id, cycleLayer(pixi, element, cut, ambience.sizes))),
  ];
  const flats = ambience.flats.map((element) => ({ element, layer: flatLayer(pixi, element, ambience.fallbackFill) }));
  water.push(...flats.map(({ layer }) => layer));

  // Every element's views by order, the flats after what is drawn at the same order.
  const placed = [
    ...ambience.elements.map((element) => ({ order: element.order, views: views.get(element.id)! })),
    ...flats.map(({ element, layer }) => ({ order: element.order, views: layer })),
  ].sort((a, b) => a.order - b.order);
  const inSlot = (slot: AmbientElement["slot"]) => placed.flatMap(({ views: each }) => each[slot]);

  return {
    back: inSlot("back"),
    front: inSlot("front"),
    generated: tiles.length > 0,
    layout(visible: VisibleWorld, pane = { width: visible.right - visible.left, height: visible.bottom - visible.top }) {
      for (const layer of precipitation) layer.layout(visible, pane);
      for (const layer of water) layer.layout(visible);
      for (const layer of backdrops.values()) {
        const { behaviour } = layer.element;
        layer.place = backdropPlacement(visible, behaviour.size, behaviour.placement, stage.width);
        for (const sprite of layer.views) {
          sprite.position.set(layer.place.x, layer.place.y);
          sprite.scale.set(layer.place.scale);
        }
        layer.view = { left: (visible.left - layer.place.x) / layer.place.scale, right: (visible.right - layer.place.x) / layer.place.scale };
      }
      for (const { space, sprite, edges, width, height } of overlays) {
        sprite.position.set(space.place.x, space.place.y);
        sprite.scale.set(space.place.scale);
        const { x, y, scale } = space.place;
        const right = x + width * scale, bottom = y + height * scale;
        for (const edge of edges) {
          const left = edge.column < 0 ? Math.min(x, visible.left) : edge.column > 0 ? right : x;
          const top = edge.row < 0 ? Math.min(y, visible.top) : edge.row > 0 ? bottom : y;
          const w = edge.column < 0 ? x - left : edge.column > 0 ? Math.max(0, visible.right - right) : width * scale;
          const h = edge.row < 0 ? y - top : edge.row > 0 ? Math.max(0, visible.bottom - bottom) : height * scale;
          edge.sprite.position.set(left, top);
          edge.sprite.scale.set(w / (edge.column === 0 ? width : 1), h / (edge.row === 0 ? height : 1));
        }
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
      for (const { element, space, sprites } of overlays) {
        const { behaviour } = element;
        let alpha = alphas.get(element.id)!;
        if (behaviour.dayOnly === true) alpha = alpha * (1 - blend.night);
        if (behaviour.hiddenBy !== undefined && behaviour.hiddenBy.length > 0) {
          let covered = 0;
          for (const hider of overlays) if (behaviour.hiddenBy.includes(hider.element.id) && hider.peak > 0) covered = Math.max(covered, alphas.get(hider.element.id)! / hider.peak);
          alpha = alpha * (1 - covered);
        }
        for (const sprite of sprites) {
          sprite.alpha = alpha;
          sprite.visible = alpha > 0 && elementMotion(element, plan) !== "hide";
          if (behaviour.tint === "space") sprite.tint = space.tint;
        }
      }
      for (const layer of drifters.values()) layer.draw(seconds, plan, weather, blend);
      for (const { element, under, frames, sprite, salt } of flashes) {
        // A flash now and then, tucked under a drifter in view; only while it runs.
        const { behaviour } = element;
        const moment = plan.level === "full" && elementMotion(element, plan) === "run" && intensity !== null ? flashAt(seconds, behaviour, intensity, salt) : null;
        const alpha = moment === null ? 0 : Math.min(0.6, opacityAt(behaviour.opacity, intensity) * moment.share);
        const spot = moment === null || alpha <= 0 ? null : underCloud(under.places(), moment.slot, behaviour, under.space.element.behaviour.placement.horizonRow, under.space.view, salt);
        sprite.visible = spot !== null;
        if (moment === null || spot === null) continue;
        const { place } = under.space;
        sprite.texture = frames[moment.frame]!;
        sprite.alpha = alpha;
        sprite.position.set(place.x + spot.x * place.scale, place.y + spot.y * place.scale);
        sprite.scale.set(place.scale);
      }
      for (const layer of water) layer.draw(seconds, plan, weather, blend);
      for (const layer of precipitation) layer.draw(seconds, plan, intensity);
      for (const { element, frames, sprite } of phaseFrames) {
        const motion = elementMotion(element, plan);
        sprite.visible = motion !== "hide";
        sprite.texture = frames[phaseFrameAt(element.behaviour, minute, motion === "run")]!;
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

/** A sprite's size: its rectangle's, or its whole image's as the pack declares it. */
function spriteSize(sprite: { image: string; rect?: readonly [number, number, number, number] | undefined }, sizes: DeckAmbience["sizes"]): readonly [number, number] {
  return sprite.rect === undefined ? (sizes.get(sprite.image) ?? [1, 1]) : [sprite.rect[2], sprite.rect[3]];
}

/** Within 0 to 1. */
const unit = (value: number) => Math.max(0, Math.min(1, value));

/** Which of `count` frames shows on `clock` at `frameMs` each while the element runs: its first while it does not. */
function frameOn(weather: Weather, frames: { sprites: readonly unknown[]; frameMs: number; clock?: string | undefined }, seconds: number, run: boolean): number {
  return cycleFrame(clockOf(weather, frames.clock, seconds), { frames: frames.sprites, frameMs: frames.frameMs }, run);
}

/** What one element of the water puts on the deck: its views in each slot, and how it lays itself out and draws. */
interface WaterLayer {
  readonly back: PixiContainer[];
  readonly front: PixiContainer[];
  layout(visible: VisibleWorld): void;
  draw(seconds: number, plan: MotionPlan, weather: Weather, blend: DayBlend): void;
}

/**
 * A sprite and its variants' sprites over it (`client/deck-variants.ts`), one frame index for all: `draw` puts every
 * one on the frame, the element's opacity times `strength`, each variant's by the weather's intensity.
 */
function framedStack(pixi: PixiModule, label: string, frames: PixiTexture[], variants: ReadonlyArray<{ variant: Variant; frames: PixiTexture[] }>) {
  const sprite = new pixi.Sprite(frames[0]!);
  sprite.label = label;
  const layers = variants.map(function ({ variant, frames: textures }) {
    const over = new pixi.Sprite(textures[0]!);
    over.label = `${label}:${variant.id}`;
    over.visible = false;
    return { over, frames: textures };
  });
  const blends = variants.map(({ variant }) => variant);
  return {
    views: [sprite, ...layers.map((layer) => layer.over)],
    place(x: number, y: number) {
      for (const view of [sprite, ...layers.map((layer) => layer.over)]) view.position.set(x, y);
    },
    draw(frame: number, strength: number, intensity: number | null) {
      const blend = variantBlend(blends, intensity);
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

/**
 * A cycle (`cycle@1`): one sprite, its anchor on its point, its frames in turn on its clock while it runs, at its
 * opacity's level; its variants over it.
 */
function cycleLayer(pixi: PixiModule, element: AmbientElement<"cycle">, cut: Cut, sizes: DeckAmbience["sizes"]): WaterLayer {
  const { behaviour } = element;
  const textures = (sprites: ReadonlyArray<{ image: string; rect?: [number, number, number, number] | undefined }>) => sprites.map((sprite) => spriteTexture(cut, sprite, sizes));
  const stack = framedStack(
    pixi,
    element.place,
    textures(behaviour.frames.sprites),
    (behaviour.variants ?? []).map((variant) => ({ variant, frames: textures(variant.frames) })),
  );
  stack.place(behaviour.at[0] - behaviour.anchor[0], behaviour.at[1] - behaviour.anchor[1]);
  return {
    back: element.slot === "back" ? stack.views : [],
    front: element.slot === "front" ? stack.views : [],
    layout() {},
    draw(seconds, plan, weather) {
      const motion = elementMotion(element, plan);
      const strength = motion === "hide" ? 0 : unit(behaviour.opacity === undefined ? 1 : levelAt(behaviour.opacity, weather));
      stack.draw(frameOn(weather, behaviour.frames, seconds, motion === "run"), strength, weather.intensity);
    },
  };
}

/**
 * A tile (`tile@1`): its frames repeated both ways in each band from the band's row, all on one tile origin, every tile
 * on the same frame and the bands drifting together a whole pixel at a time; its variants a band of tiles over each band.
 */
function tileLayer(pixi: PixiModule, element: AmbientElement<"tile">, cut: Cut, sizes: DeckAmbience["sizes"], phases: DayCycle["phases"]) {
  const { behaviour } = element;
  const { sprites } = behaviour.frames;
  const [tileWidth, tileHeight] = spriteSize(sprites[0]!, sizes);
  const fullHeight = fullHeightTile(behaviour);
  // Each band's first row of tiles is cut to start where the band does, so every band shares the origin.
  const bands = behaviour.bands.map((band) => ({ ...band, cut: (((band.fromRow - behaviour.origin) % tileHeight) + tileHeight) % tileHeight }));
  const frameTextures = (sprite: { image: string; rect?: [number, number, number, number] | undefined }) => {
    const whole = spriteTexture(cut, sprite, sizes);
    const [x, y] = sprite.rect ?? [0, 0];
    return { whole, cut: bands.map((band) => (band.cut === 0 ? whole : cut(sprite.image, x, y + band.cut, tileWidth, tileHeight - band.cut))) };
  };
  const frames = sprites.map(frameTextures);
  const variants = behaviour.variants ?? [];
  const container = (label: string, visible: boolean) => {
    const made = new pixi.Container();
    made.label = label;
    made.visible = visible;
    return made;
  };
  const holders = bands.map((band) => container(`${element.place}:${band.slot}`, true));
  const washes = behaviour.depthWash === undefined ? [] : bands.map((band) => {
    const graphics = new pixi.Graphics();
    graphics.label = `${element.place}:${band.slot}:depth-wash`;
    return graphics;
  });
  let washed = "";
  const over = variants.map((variant) => ({ frames: variant.frames.map(frameTextures), holders: bands.map((band) => container(`${element.place}:${band.slot}:${variant.id}`, false)) }));
  let frame = 0;
  /** Every tile: its band, whether it is that band's first row (cut to line up), and each variant's tile over it. */
  let tiles: Array<{ band: number; sprite: PixiSprite; atCut: boolean; over: PixiSprite[] }> = [];
  let tiled = { left: 0, right: 0, top: 0, bottom: 0 };
  const texture = (of: typeof frames, band: number, atCut: boolean) => (atCut ? of[frame]!.cut[band]! : of[frame]!.whole);

  function tile(band: number, atCut: boolean, x: number, y: number): void {
    const sprite = new pixi.Sprite(texture(frames, band, atCut));
    sprite.position.set(x, y);
    holders[band]!.addChild(sprite);
    const layered = over.map(function (variant) {
      const tile = new pixi.Sprite(texture(variant.frames, band, atCut));
      tile.position.set(x, y);
      variant.holders[band]!.addChild(tile);
      return tile;
    });
    tiles.push({ band, sprite, atCut, over: layered });
  }

  const inSlot = (slot: string) => bands.flatMap((band, index) => (band.slot === slot ? [holders[index]!, ...over.map((variant) => variant.holders[index]!), ...(washes[index] ? [washes[index]!] : [])] : []));
  return {
    back: inSlot("back"),
    front: inSlot("front"),
    layout(visible: VisibleWorld) {
      if (tiles.length > 0 && visible.left >= tiled.left && visible.right <= tiled.right && (!fullHeight || visible.top >= tiled.top) && visible.bottom <= tiled.bottom) return;
      // A tile's width of slack either side, so a scroll of up to a tile never shows an edge.
      tiled = { left: Math.floor(visible.left) - 8, right: Math.ceil(visible.right) + 8, top: Math.floor(visible.top), bottom: Math.ceil(visible.bottom) + 8 };
      for (const { band, sprite, over: layered } of tiles) {
        holders[band]!.removeChild(sprite);
        sprite.destroy();
        layered.forEach(function (tile, index) {
          over[index]!.holders[band]!.removeChild(tile);
          tile.destroy();
        });
      }
      tiles = [];
      const first = Math.floor(tiled.left / tileWidth) * tileWidth - tileWidth;
      for (let x = first; x < tiled.right + tileWidth; x += tileWidth) {
        bands.forEach(function (band, index) {
          if (fullHeight && tiled.top < band.fromRow) {
            const top = behaviour.origin + Math.floor((tiled.top - behaviour.origin) / tileHeight) * tileHeight;
            for (let y = top; y < tiled.bottom; y += tileHeight) tile(index, false, x, y);
            return;
          }
          if (band.cut === 0) {
            for (let y = band.fromRow; y < tiled.bottom; y += tileHeight) tile(index, false, x, y);
            return;
          }
          tile(index, true, x, band.fromRow);
          for (let y = band.fromRow - band.cut + tileHeight; y < tiled.bottom; y += tileHeight) tile(index, false, x, y);
        });
      }
    },
    draw(seconds: number, plan: MotionPlan, weather: Weather, blend: DayBlend) {
      const motion = elementMotion(element, plan);
      const run = motion === "run";
      const drift = run ? scrollOffset(clockOf(weather, behaviour.drift.clock, seconds), behaviour.drift.pxPerSecond, tileWidth) : 0;
      const mix = variantBlend(variants, weather.intensity);
      if (behaviour.depthWash !== undefined) {
        const wash = behaviour.depthWash;
        const { colour, top, bottom } = depthWashAt(wash, phases, blend);
        const strength = unit(wash.opacity === undefined ? 1 : levelAt(wash.opacity, weather));
        // Sub-byte alpha changes during a 90-minute day fade need no geometry rebuild each frame.
        const key = `${colour}:${Math.round(top * 1024)}:${Math.round(bottom * 1024)}:${tiled.left}:${tiled.right}:${tiled.top}:${tiled.bottom}`;
        washes.forEach((graphics, index) => {
          graphics.visible = motion !== "hide" && strength > 0;
          graphics.alpha = strength;
          if (key === washed) return;
          graphics.clear();
          const start = fullHeight ? Math.min(bands[index]!.fromRow, tiled.top) : bands[index]!.fromRow;
          // World-aligned one-pixel colour blends, never a repeated gradient per texture tile.
          // The two constant regions are single rectangles even in extremely tall panes.
          const rect = (y: number, end: number, alpha: number) => {
            if (end > y && alpha > 0) graphics.rect(tiled.left, y, tiled.right - tiled.left, end - y).fill({ color: colour, alpha });
          };
          rect(start, Math.min(tiled.bottom, wash.rows[0]), top);
          for (let y = Math.max(start, wash.rows[0]); y < Math.min(tiled.bottom, wash.rows[1]); y++) {
            rect(y, y + 1, depthWashAlpha(y + .5, wash.rows, top, bottom));
          }
          rect(Math.max(start, wash.rows[1]), tiled.bottom, bottom);
        });
        washed = key;
      }
      for (const holder of holders) {
        holder.position.set(drift, 0);
        holder.visible = motion !== "hide" && mix.base > 0;
        holder.alpha = mix.base;
      }
      over.forEach(function (variant, index) {
        for (const holder of variant.holders) {
          holder.position.set(drift, 0);
          holder.alpha = mix.layers[index]!;
          holder.visible = motion !== "hide" && holder.alpha > 0;
        }
      });
      const next = frameOn(weather, behaviour.frames, seconds, run);
      if (next !== frame) {
        frame = next;
        for (const tile of tiles) {
          tile.sprite.texture = texture(frames, tile.band, tile.atCut);
          tile.over.forEach((layered, index) => (layered.texture = texture(over[index]!.frames, tile.band, tile.atCut)));
        }
      }
    },
  };
}

/** A single band starting at/above the stage top covers the whole scene, unlike horizon/waterline bands. */
function fullHeightTile(behaviour: AmbientElement<"tile">["behaviour"]): boolean {
  return behaviour.bands.length === 1 && behaviour.bands[0]!.fromRow <= 0;
}

/** A tile with nothing to draw it with: each band filled flat from its row down with the pack's `fallbackFill`. */
function flatLayer(pixi: PixiModule, element: AmbientElement<"tile">, fill: number): WaterLayer {
  const bands = element.behaviour.bands.map(function (band) {
    const graphics: PixiGraphics = new pixi.Graphics();
    graphics.label = `${element.place}:${band.slot}`;
    return { band, graphics };
  });
  const inSlot = (slot: string) => bands.filter(({ band }) => band.slot === slot).map(({ graphics }) => graphics);
  return {
    back: inSlot("back"),
    front: inSlot("front"),
    layout(visible) {
      const left = Math.floor(visible.left) - 8;
      const width = Math.ceil(visible.right) + 8 - left;
      const bottom = Math.ceil(visible.bottom) + 8;
      for (const { band, graphics } of bands) {
        const top = fullHeightTile(element.behaviour) ? Math.min(band.fromRow, Math.floor(visible.top)) : band.fromRow;
        graphics.clear().rect(left, top, width, bottom - top).fill(fill);
      }
    },
    draw() {},
  };
}

/**
 * A strip (`strip@1`): its frames repeated sideways within its span from its top row, drifting with the world, cut from
 * the repeat into a few sprites a frame; its variants' strips cut alike over it.
 */
function stripLayer(pixi: PixiModule, element: AmbientElement<"strip"> | AmbientElement<"phase-strip">, cut: Cut, sizes: DeckAmbience["sizes"], phases: DayCycle["phases"] = [], effects: Array<{ destroy(): void }> = []): WaterLayer {
  const { behaviour } = element;
  const [period, height] = spriteSize(behaviour.frames.sprites[0]!, sizes);
  const span = { left: behaviour.span[0], right: behaviour.span[1] };
  const crops = new Map<string, PixiTexture>();
  type Sprite = { image: string; rect?: [number, number, number, number] | undefined };
  function crop(sprites: readonly Sprite[], frame: number, from: number, width: number): PixiTexture {
    const sprite = sprites[frame]!;
    const [x, y] = sprite.rect ?? [0, 0];
    const key = `${sprite.image}:${x}:${y}:${from}:${width}`;
    let texture = crops.get(key);
    if (texture === undefined) {
      texture = cut(sprite.image, x + from, y, width, height);
      crops.set(key, texture);
    }
    return texture;
  }
  // As many pieces as the span can need at any scroll: one a repeat across it, and one more.
  const pieceCount = Math.ceil((span.right - span.left) / period) + 1;
  const strip = (label: string, sprites: readonly Sprite[]) => {
    const container = new pixi.Container();
    container.label = label;
    const pieces: PixiSprite[] = [];
    for (let index = 0; index < pieceCount; index += 1) {
      const sprite = new pixi.Sprite(crop(sprites, 0, 0, 1));
      sprite.visible = false;
      container.addChild(sprite);
      pieces.push(sprite);
    }
    return { container, pieces, sprites };
  };
  const phaseSets = behaviour.kind === "phase-strip" ? phaseStripSets(behaviour, phases) : null;
  const phaseLayers = phaseSets === null ? [] : [...new Set(phaseSets)].map((sprites, index) => strip(`${element.place}:phase-${index}`, sprites));
  const main = phaseSets === null ? strip(element.place, behaviour.frames.sprites) : null;
  const variants = behaviour.kind === "strip" ? behaviour.variants ?? [] : [];
  const over = variants.map((variant) => strip(`${element.place}:${variant.id}`, variant.frames));
  for (const layered of over) layered.container.visible = false;
  const layers = main === null ? phaseLayers : [main, ...over];
  let views = layers.map((layered) => layered.container);
  if (phaseSets !== null) {
    // Sum premultiplied phase colours/alpha into a transparent intermediate, then composite once.
    // Ordinary source-over crossfades dim opaque pixels and leave ghosts in transparent night beams.
    const holder = new pixi.Container();
    holder.label = element.place;
    const filter = new pixi.AlphaFilter({ alpha: 1 });
    effects.push(filter);
    holder.filters = [filter];
    for (const layered of phaseLayers) layered.container.blendMode = "add";
    holder.addChild(...views);
    views = [holder];
  }
  let drawn = "";
  return {
    back: element.slot === "back" ? views : [],
    front: element.slot === "front" ? views : [],
    layout() {},
    draw(seconds, plan, weather, blend) {
      const motion = elementMotion(element, plan);
      const run = motion === "run";
      const lap = run ? scrollOffset(clockOf(weather, behaviour.drift.clock, seconds), behaviour.drift.pxPerSecond, period) : 0;
      const frame = frameOn(weather, behaviour.frames, seconds, run);
      const mix = variantBlend(variants, weather.intensity);
      if (main !== null) {
        main.container.alpha = mix.base;
        main.container.visible = motion !== "hide" && mix.base > 0;
      }
      over.forEach(function (layered, index) {
        layered.container.alpha = mix.layers[index]!;
        layered.container.visible = motion !== "hide" && layered.container.alpha > 0;
      });
      if (phaseSets !== null) {
        const weights = phaseStripWeights<readonly Sprite[]>(phaseSets, blend);
        for (const layered of phaseLayers) {
          layered.container.alpha = weights.get(layered.sprites) ?? 0;
          layered.container.visible = motion !== "hide" && layered.container.alpha > 0;
        }
      }
      if (`${frame}:${lap}` === drawn) return;
      const segments = foamSegments(span, period, lap);
      for (const layered of layers) {
        layered.pieces.forEach(function (sprite, index) {
          const segment = segments[index];
          sprite.visible = segment !== undefined;
          if (segment === undefined) return;
          sprite.texture = crop(layered.sprites, frame, segment.from, segment.width);
          sprite.position.set(segment.x, behaviour.top);
        });
      }
      drawn = `${frame}:${lap}`;
    },
  };
}

