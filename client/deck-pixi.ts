/**
 * The ship deck drawn with PixiJS 8 on WebGL, alive: hull C under sail on a moving sea, its wake behind
 * it, under the sky of the local time of day, one sailor sprite per live crewmate — each in its own look —
 * walking to where its state sends it, the hull's depth pieces drawn back over any sailor behind them, and
 * the deck's ambient life — the bob, the masthead's sway, the sail's billow, the lanterns, a gull now and then. What
 * the stage holds and how it moves is the setting pack's (`client/deck-parts.ts`, `client/deck-ambience.ts`).
 *
 * **Depth, back to front:** the setting's ambience behind the stage — the ship's sky, its overcast and stars, the
 * lightning, the clouds and the gull, in the pack's order — then the far sea (the `back` of
 * `client/deck-environment.ts`); the ship — the hull, the mast and its masthead, the sail — with its deck of
 * props, pieces, lanterns and crew; then the near sea, the wake and the foam over the hull's waterline (its
 * `front`). The weather layers lie among them (`client/deck-environment.ts`): each variant just over its element,
 * cycles over the foam. The hover label and legend are React, on top. The ship's parts — the tall mast, its topmast
 * (or the hull's own masthead in its place), the sail — are drawn over the hull in the pack's order, behind the crew;
 * the hull is drawn round what they cut out of it. The tall mast reaches into the sky above the hull, and the fit takes
 * in the setting's fit box (`deckBox`); its own rows below the sail stand in for the mast's depth piece, which leaves
 * the cloth alone.
 *
 * **The plank** (`client/deck-choreography.ts`) is a piece of the pack, drawn just in front of the near rail it stands over,
 * and a sailor walking it is drawn in front of the plank; where its image did not load, there is no board. Off its end
 * the sailor goes into the
 * `overboard` layer over the near sea — outside the ship's bob, as the shark's art asks — and the shark and
 * the splash are drawn there after it, at their water anchors.
 *
 * Who moves where is `client/deck-crew.ts`; the bob, the sway, the sail's cycle and the lanterns' flicker are
 * `client/deck-parts.ts`, and how lively it all is — the sea, the wind, the sail, the bob — `client/deck-atmosphere.ts`,
 * by how many of the crew are working; the sea, the sky and the gull are `client/deck-environment.ts`, from the
 * setting's ambience (`client/deck-ambience.ts`); when a frame
 * is drawn at all is `client/deck-loop.ts`; each state's badge is `client/deck-badges.ts`; which sailor the
 * pointer is over is `client/deck-hover.ts`, reported to the pane, which draws its label. This file only
 * turns those into sprites and reads the pointer off the canvas.
 *
 * **Pixi is handed in, never imported.** The plugin's client bundle is one script that a phone's Hermes
 * must parse whole before any of it runs, and Pixi is written with `class` syntax that React Native
 * 0.81's `hermesc` refuses with its default flags (`docs/ship-deck-canvas/compile.mjs` checks).
 * So Pixi stays out of the bundle: the daemon serves its browser build (`vendor/pixi.min.js`) through
 * `firstmate.deck.engine`, and `client/deck-mount.ts` evaluates it in a web renderer and passes the
 * namespace here. `PixiModule` is the narrow shape of it this file uses; `client/ship-deck.test.ts` holds
 * it to Pixi's own build. **So is the art**: the setting pack from `firstmate.deck.setting`, decoded once a session
 * by the mount and handed in compiled — its stage, cast and ambience — with every image of it that decoded.
 *
 * It is pixel art, so it is sampled `nearest` and every position is a whole art pixel; the deck is
 * scaled to fit the pane exactly, so it follows a resize smoothly (`fitDeck` says why not by whole
 * device pixels). The ticker never starts (`autoStart: false`): `deckAnimator` calls `render` itself, at most
 * 30 times a second, and not at all while the deck is hidden or under reduced motion. A still deck is drawn
 * again once a minute, so its sky keeps up with the clock.
 *
 * **Depth while moving.** The deck's layer sorts its children by `zIndex`, set from `depthOf` for every
 * prop, piece and lantern once and for every sailor on every frame, so a sailor walking aft passes
 * behind the mast, the bollards and the stairs' balustrade, and in front of them on its way back.
 */
import type { DeckPresentation } from "./deck-setting";
import type { SettingManifest } from "../shared/deck-setting";
import { availableLooks, laneOf, standing, type DeckCast } from "./deck-cast";
import type { MotionPlan } from "./deck-ambient";
import { clockOf, crewIntensity, deliveredWeather, levelAt, openingAtmosphere, shade, stepAtmosphere, weatherOf, type DeckAtmosphere } from "./deck-atmosphere";
import { ASK_PAPER, ASK_SIZE, askFramePixels, askLift, askPixels, BADGE_SIZE, badgeInk, badgePixels, DOZE_GLYPH, dozeAt, hexColour } from "./deck-badges";
import { applyCrew, createCrew, crewFigures, fading, figureScale, figureStanding, portalEffects, stepCrew, stepDepartures, type Figure } from "./deck-crew";
import { firstMateFigure, FIRST_MATE_KEY } from "./deck-first-mate";
import { boxMiddle, cameraFit, FOCUS_MS, FOCUS_VEIL_ALPHA, focusLayout, shotBetween, visibleWorld, WHOLE_DECK, type DeckShot } from "./deck-camera";
import { askMarks, badgeTop, figureBox, hoverChanged, hoverOf, sailorAt, showsBadge, toDeck, type AskMark, type DeckFit, type DeckHover } from "./deck-hover";
import { deckAnimator, type FrameScheduler, type MotionSignals } from "./deck-loop";
import type { DeckDrawing, DeckHost } from "./deck-mount";
import { depthOf, type DeckScene, type DeckState } from "./deck-scene";
import { elementMotion, type DeckAmbience } from "./deck-ambience";
import type { DrifterMasks } from "./deck-clouds";
import { createScenery } from "./deck-environment";
import { dutyFrame, flickerAt, glassTint, glyphRects, swayAt, type Cut, type DeckParts } from "./deck-parts";
import { stageMotionAt, stageToWorld, worldToStage, type StageTransform } from "./deck-stage-motion";
import type { DeckStage } from "./deck-stage";
import { localMinute, SKY_REFRESH_MS } from "./deck-sky";
import { phaseTintAt } from "./deck-phase-tint";
import { carrierAt, carrierHit, carrierHover, carrierRipples, type AttentionCarrier } from "./deck-attention";

/** Marks the canvas with its renderer, so the live check can read it in the app's DevTools. */
export const DECK_CANVAS_ATTRIBUTE = "data-firstmate-deck";
/** Marks the canvas with the motion in force: `full`, `lite` or `still`. */
export const DECK_MOTION_ATTRIBUTE = "data-firstmate-deck-motion";
/** Marks the canvas with the day phase whose backdrop shows most (`dawn` … `night`), or `none` without a backdrop. */
export const DECK_SKY_ATTRIBUTE = "data-firstmate-deck-sky";
/** Marks the canvas with the weather's intensity as drawn, `0.00` to `1.00` (`client/deck-atmosphere.ts`). */
export const DECK_WEATHER_ATTRIBUTE = "data-firstmate-deck-weather";
/** Marks the canvas with the weather's flashes showing, by id (`lightning`), or nothing (`client/deck-flash.ts`). */
export const DECK_FLASH_ATTRIBUTE = "data-firstmate-deck-flash";

type Style = string | number | { color?: string | number; width?: number; alpha?: number };

export interface PixiPoint {
  x: number;
  y: number;
  set(x: number, y?: number): void;
}

export interface PixiContainer {
  label: string;
  position: PixiPoint;
  scale: PixiPoint;
  rotation: number;
  zIndex: number;
  sortableChildren: boolean;
  visible: boolean;
  alpha: number;
  tint: number;
  blendMode?: string;
  filters?: unknown[];
  cacheAsTexture?(options: boolean | { resolution: number; antialias: boolean; scaleMode: "nearest" }): void;
  updateCacheTexture?(): void;
  addChild(...children: PixiContainer[]): unknown;
  removeChild(...children: PixiContainer[]): unknown;
  destroy(options?: { children?: boolean }): void;
}

export interface PixiGraphics extends PixiContainer {
  clear(): this;
  rect(x: number, y: number, width: number, height: number): this;
  circle(x: number, y: number, radius: number): this;
  ellipse(x: number, y: number, halfWidth: number, halfHeight: number): this;
  fill(style?: Style): this;
  stroke(style?: Style): this;
}

export interface PixiSprite extends PixiContainer {
  anchor: PixiPoint;
  texture: PixiTexture;
}

export interface PixiTextureSource {
  scaleMode: string;
  destroy(): void;
}

export interface PixiTexture {
  destroy(destroySource?: boolean): void;
}

export interface PixiApplication {
  init(options: {
    preference: "webgl";
    width: number;
    height: number;
    background: string;
    antialias: boolean;
    roundPixels: boolean;
    autoDensity: boolean;
    resolution: number;
    autoStart: boolean;
    sharedTicker: boolean;
  }): Promise<void>;
  readonly canvas: unknown;
  readonly renderer: {
    readonly name: string;
    readonly resolution: number;
    resize(width: number, height: number): void;
    background: { color: string | number | object };
  };
  readonly stage: PixiContainer;
  readonly screen: { width: number; height: number };
  render(): void;
  destroy(rendererOptions?: { removeView?: boolean }, options?: { children?: boolean }): void;
}

/** The part of Pixi's namespace the deck uses. */
export interface PixiModule {
  readonly AlphaFilter: new (options: { alpha: number }) => { destroy(): void };
  readonly VERSION: string;
  readonly Application: new () => PixiApplication;
  readonly Container: new () => PixiContainer;
  readonly Graphics: new () => PixiGraphics;
  readonly Sprite: new (texture: PixiTexture) => PixiSprite;
  readonly ImageSource: new (options: { resource: unknown }) => PixiTextureSource;
  readonly Texture: new (options: { source: PixiTextureSource; frame: unknown }) => PixiTexture;
  readonly Rectangle: new (x: number, y: number, width: number, height: number) => unknown;
}

/**
 * The deck's art as the mount hands it over: the setting's stage, cast, parts and ambience, compiled
 * (`client/deck-stage.ts`, `client/deck-cast.ts`, `client/deck-parts.ts`, `client/deck-ambience.ts`); every image of
 * the pack that decoded, by id, and each drifter's slot masks by image id; the decoded backdrop image; and the effect definitions.
 */
export interface DeckArtImage {
  attentionCarrier?: AttentionCarrier | undefined;
  stage: DeckStage;
  cast: DeckCast;
  parts: DeckParts;
  ambience: DeckAmbience;
  atmosphere: DeckAtmosphere;
  images: ReadonlyMap<string, unknown>;
  masks: ReadonlyMap<string, DrifterMasks>;
  image: unknown;
  effects: SettingManifest["effects"];
  presentation: DeckPresentation;
}

/** What the deck needs to decide when to move: a frame scheduler and the motion signals; and what time it is. */
export interface DeckMotionEnvironment {
  scheduler: FrameScheduler;
  signals: MotionSignals;
  /** The local time, for the sky. */
  clock: () => Date;
  /** Runs `run` every `ms`; returns the way to stop. */
  every: (ms: number, run: () => void) => () => void;
}

type Frame = readonly [number, number, number, number];

/**
 * Whether a WebGL renderer string names a software rasteriser: SwiftShader (Chromium's fallback when
 * the GPU is blocklisted or acceleration is off), Mesa's llvmpipe and softpipe, Windows' basic renderer.
 */
export function isSoftwareRenderer(name: string | null): boolean {
  return name !== null && /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

interface GlContext {
  getExtension(name: string): { UNMASKED_RENDERER_WEBGL: number } | null;
  getParameter(parameter: number): unknown;
  RENDERER: number;
}

/** The GPU's name from the renderer's own WebGL context, or null when it will not say. */
function glRendererName(renderer: unknown): string | null {
  const gl = Reflect.get(renderer as object, "gl") as GlContext | undefined;
  if (gl === undefined || typeof gl.getParameter !== "function") return null;
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL);
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/**
 * One texture per frame the stage draws, each on its image's `nearest`-sampled source, and crops made on demand: the
 * backdrop in slices round the parts' cutout, each part and each of a cycle's frames, the pieces, the props, the shark
 * and splash, and every pose of each look the cast has, cut from the look's own image at its lane's rectangles.
 */
function atlasTextures(pixi: PixiModule, art: DeckArtImage) {
  const sources: PixiTextureSource[] = [];
  const sourceOf = (image: unknown) => {
    const made = new pixi.ImageSource({ resource: image });
    made.scaleMode = "nearest";
    sources.push(made);
    return made;
  };
  const source = sourceOf(art.image);
  // A source per image of the pack, the backdrop's the one above: looks and props on one image share it.
  const byImage = new Map<unknown, PixiTextureSource>([[art.image, source]]);
  const sourceFor = (image: unknown) => {
    let found = byImage.get(image);
    if (found === undefined) {
      found = sourceOf(image);
      byImage.set(image, found);
    }
    return found;
  };
  const made: PixiTexture[] = [];
  const frame = ([x, y, width, height]: Frame, from: PixiTextureSource = source) => {
    const texture = new pixi.Texture({ source: from, frame: new pixi.Rectangle(x, y, width, height) });
    made.push(texture);
    return texture;
  };
  /** A cut of the pack's: its rectangle of its own image's source. */
  const cutOf = (cut: Cut) => frame(cut.rect, sourceFor(art.images.get(cut.image)));
  const { parts } = art;
  const [shipX, shipY, shipWidth, shipHeight] = parts.backdrop.rect;
  // The backdrop in slices round what is cut out of it for the parts drawn in its place: the ship's masthead, to sway;
  // or, under the tall mast, the hull's whole short rig, which is not drawn at all.
  let hull: Array<{ texture: PixiTexture; x: number; y: number }> = [{ texture: frame([shipX, shipY, shipWidth, shipHeight]), x: 0, y: 0 }];
  if (parts.cutout !== null) {
    const [cutX, cutY, cutWidth, cutHeight] = parts.cutout;
    const cutRight = cutX + cutWidth;
    const cutBottom = cutY + cutHeight;
    hull = [
      { texture: frame([shipX, shipY, cutX, shipHeight]), x: 0, y: 0 },
      ...(cutY > 0 ? [{ texture: frame([shipX + cutX, shipY, cutWidth, cutY]), x: cutX, y: 0 }] : []),
      { texture: frame([shipX + cutX, shipY + cutBottom, cutWidth, shipHeight - cutBottom]), x: cutX, y: cutBottom },
      { texture: frame([shipX + cutRight, shipY, shipWidth - cutRight, shipHeight]), x: cutRight, y: 0 },
    ];
  }
  // Each part drawn, and a cycle's frames; each piece drawn, or the part standing in for it.
  const rig = parts.parts.map((part) => ({ part, texture: cutOf(part.cut), frames: part.frames.map(cutOf) }));
  const pieces = parts.pieces.map((piece) => ({ piece, texture: cutOf(piece.cut) }));
  const props = new Map(
    art.stage.props.flatMap(function (prop) {
      const image = art.images.get(prop.image);
      return image === undefined || prop.rect === null ? [] : [[prop.id, frame(prop.rect, sourceFor(image))] as const];
    }),
  );

  // Each look's image — the atlas for its own two outfits, an extra look's own otherwise — cut at its lane's frames.
  const { cast } = art;
  const lookSources = new Map<string, PixiTextureSource>();
  for (const look of [...cast.looks, ...(cast.firstMate == null ? [] : [cast.firstMate])]) {
    const image = art.images.get(look.image);
    if (image !== undefined && !lookSources.has(look.id)) lookSources.set(look.id, sourceFor(image));
  }
  const crew = new Map(
    [...lookSources].map(([look, from]) => {
      const lane = cast.lanes.get(laneOf(cast, look))!;
      return [look, new Map([...lane].map(([pose, entry]) => [pose, frame(entry.frame, from)]))] as const;
    }),
  );
  const firstLook = cast.looks[0]!.id;
  const appearances = new Map([...art.stage.zones.values()].flatMap(({ appearance }) =>
    appearance === null || !art.images.has(appearance.image) ? [] : [[appearance, cutOf({ image: appearance.image, rect: appearance.frame })] as const],
  ));

  // Effects use their own frame rectangles (or whole images); a missing frame costs only that key.
  const effects = new Map(Object.entries(art.effects).map(([id, effect]) => [id, new Map(
    Object.entries(effect.frames).flatMap(([name, sprite]) => art.images.has(sprite.image)
      ? [[name, cutOf({ image: sprite.image, rect: sprite.rect ?? [0, 0, ...effect.size] })] as const] : []),
  )]));

  const crops = new Map<string, PixiTexture>();
  const carrier = art.attentionCarrier;
  const attention = carrier?.frames.map(sprite => {
    if (!art.images.has(sprite.image)) return null;
    const [x, y, w, h] = sprite.rect ?? [0, 0, ...carrier.size];
    return cutOf({ image: sprite.image, rect: [x, y, w, carrier.surface?.row ?? h] });
  }) ?? [];
  const attentionBody = carrier?.frames.map(sprite => {
    if (!art.images.has(sprite.image)) return null;
    const [x, y, w, h] = sprite.rect ?? [0, 0, ...carrier.size];
    const top = carrier.bubbleHeight ?? 0;
    return cutOf({ image: sprite.image, rect: [x, y + top, w, (carrier.surface?.row ?? h) - top] });
  }) ?? [];
  const submerged = carrier?.surface === undefined ? [] : carrier.frames.map(sprite => {
    if (!art.images.has(sprite.image)) return null;
    const [x, y, w, h] = sprite.rect ?? [0, 0, ...carrier.size];
    const row = carrier.surface!.row;
    return cutOf({ image: sprite.image, rect: [x, y + row, w, h - row] });
  });
  return {
    attention,
    attentionBody,
    submerged,
    hull,
    effects,
    rig,
    pieces,
    props,
    appearances,
    /** A look's whole pose. */
    pose(look: string, pose: string): PixiTexture {
      return (crew.get(look) ?? crew.get(firstLook)!).get(pose)!;
    },
    /** `rows` rows of a look's pose from `top`: what shows of it on the hatch's ladder, or its two halves on an out-breath. */
    rows(look: string, pose: string, top: number, rows: number): PixiTexture {
      const drawn = crew.has(look) ? look : firstLook;
      const key = `${drawn}:${pose}:${top}:${rows}`;
      let texture = crops.get(key);
      if (texture === undefined) {
        const [x, y, width] = standing(cast, laneOf(cast, drawn), pose).frame;
        texture = frame([x, y + top, width, rows], lookSources.get(drawn)!);
        crops.set(key, texture);
      }
      return texture;
    },
    destroy() {
      for (const texture of made) texture.destroy();
      for (const each of sources) each.destroy();
    },
  };
}

type Textures = ReturnType<typeof atlasTextures>;

/** A sprite's anchor on its feet: whole pixels of the frame, so it stands on whole art pixels, mirrored or not. */
function stand(sprite: PixiSprite, standing: { frame: readonly number[]; feet: readonly [number, number] }): void {
  const [, , width = 1, height = 1] = standing.frame;
  sprite.anchor.set(standing.feet[0] / width, standing.feet[1] / height);
}

/**
 * The scale and offset that fit the deck in the screen with a small margin: the exact fit at every size,
 * so the ship grows and shrinks smoothly with the pane. The offset is snapped to whole device pixels.
 *
 * It used to round the scale down to whole device pixels per art pixel once there were two or more, to
 * keep every art pixel the same size. That made the ship a staircase of sizes: at 2× it held one size
 * from about 665 to 1000 CSS px of pane and lost a third of its size the moment the pane was dragged a
 * pixel narrower than a step (3 device pixels an art pixel to 2). Sampled `nearest`, a fractional scale
 * makes some art pixels one device pixel wider than others, which at three or more device pixels an
 * art pixel hardly shows; a ship that jumps does.
 *
 * What is fitted is the deck's rows from `top` (0, the stage's top row, unless a part reaches above it) to
 * `height`, with the setting's `margin` round it.
 */
export function fitDeck(screen: { width: number; height: number }, deck: { width: number; height: number; top?: number }, resolution: number, margin: number) {
  const top = deck.top ?? 0;
  const rows = deck.height - top;
  const scale = Math.max(0, Math.min(screen.width / deck.width, screen.height / rows) * margin);
  const snap = (value: number) => Math.round(value * resolution) / resolution;
  return { scale, x: snap((screen.width - deck.width * scale) / 2), y: snap((screen.height - rows * scale) / 2 - top * scale) };
}

/**
 * The stage's rows the fit takes in: the stage's own, or, once a part drawn reaches above it (`rigTop` below 0:
 * the ship's tall mast), the setting's fit box — on the ship from the mast's top down to the lowest the plank's
 * shark and splash reach in the near sea, so the taller fit keeps the whole of the way off the plank in view in a
 * wide pane, as the hull's own did.
 */
export function deckBox(stage: Pick<DeckStage, "width" | "height" | "fit">, rigTop: number, rocking = false): { width: number; height: number; top?: number } {
  return rigTop >= 0 && !rocking ? { width: stage.width, height: stage.height } : { width: stage.width, height: Math.max(stage.height, stage.fit.bottom), top: stage.fit.top };
}

/**
 * One sailor's sprites: the state's mark under its feet, the figure itself, its head and shoulders apart
 * on an at-ease out-breath, its state's badge over its head, an idle sailor's z, and the reply marker over the
 * badge while replies wait for the captain.
 */
interface SailorSprites {
  root: PixiContainer;
  mark: PixiGraphics;
  sprite: PixiSprite;
  /** The top rows of the cast's breath, drawn on their own only while they have settled; hidden otherwise. */
  upper: PixiSprite;
  badge: PixiGraphics;
  doze: PixiGraphics;
  ask: PixiGraphics;
  /** What the reply marker was last drawn as: its form and the accent, or empty. */
  asked: string;
  /** What the mark and badge were last drawn as, so they are redrawn only when the state, the feed or the hover changes. */
  marked: string;
  /** Which layer holds it: the deck's, the spotlight over the veil, or the sea's off the plank. */
  parent: PixiContainer;
}

/** Draws `state`'s badge (`client/deck-badges.ts`) into `graphics`, its top left at the origin. */
function drawBadge(graphics: PixiGraphics, state: DeckState, colour: string): void {
  const sign = hexColour(colour);
  const ink = badgeInk(colour);
  graphics.clear();
  for (const pixel of badgePixels(state)) graphics.rect(pixel.x, pixel.y, 1, 1).fill(pixel.kind === "sign" ? sign : ink);
}

/** Draws the reply marker (`client/deck-badges.ts`) into `graphics`, its top left at the origin: the bubble, or the badge's frame. */
function drawAsk(graphics: PixiGraphics, accent: string, mark: AskMark): void {
  const dot = hexColour(accent);
  graphics.clear();
  for (const pixel of mark.framed ? askFramePixels() : askPixels(mark.flip)) graphics.rect(pixel.x, pixel.y, 1, 1).fill(pixel.kind === "bubble" ? ASK_PAPER : dot);
}

/** How often a still deck is drawn again while someone fades out. */
const FADE_STEP_MS = 50;

/** Pointer events as the deck reads them off the canvas: CSS pixels from its top left. */
interface CanvasPointerEvent {
  offsetX: number;
  offsetY: number;
  pointerType?: string;
}

interface DeckCanvas {
  style: Record<string, string>;
  setAttribute(name: string, value: string): void;
  addEventListener?(type: string, listener: (event: CanvasPointerEvent) => void): void;
  removeEventListener?(type: string, listener: (event: CanvasPointerEvent) => void): void;
}

/**
 * Starts Pixi on `host`, draws `scene` at `size`, and hands back what updates and tears it down.
 * `onHover` hears which sailor the pointer is over, and where it is on the canvas (`client/deck-hover.ts`);
 * `onSelect` hears which sailor a click landed on, or null for anywhere else (`client/deck-camera.ts`).
 */
export async function startDeck(
  pixi: PixiModule,
  art: DeckArtImage,
  host: DeckHost,
  scene: DeckScene,
  size: { width: number; height: number },
  environment: DeckMotionEnvironment,
  onHover: (hover: DeckHover | null) => void = function () {},
  onSelect: (key: string | null, action?: "attention") => void = function () {},
  onFirstMate: (anchor: DeckHover | null) => void = function () {},
): Promise<DeckDrawing> {
  const app = new pixi.Application();
  await app.init({
    preference: "webgl",
    width: Math.max(1, size.width),
    height: Math.max(1, size.height),
    background: scene.palette.sea,
    antialias: false,
    roundPixels: true,
    autoDensity: true,
    resolution: (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1,
    autoStart: false,
    sharedTicker: false,
  });
  const software = isSoftwareRenderer(glRendererName(app.renderer));
  const canvas = app.canvas as DeckCanvas;
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.imageRendering = "pixelated";
  canvas.setAttribute(DECK_CANVAS_ATTRIBUTE, app.renderer.name);
  canvas.setAttribute("data-firstmate-deck-setting", art.presentation.id);
  host.appendChild(app.canvas);

  const { stage, cast, parts } = art;
  const textures: Textures = atlasTextures(pixi, art);
  let current = scene;
  const crew = createCrew(stage, cast, availableLooks(cast, (image) => art.images.has(image)));
  const breathRows = cast.breath?.rows ?? 0;

  const world = new pixi.Container();
  world.label = "world";
  app.stage.addChild(world);

  // The ambience: the sky and the far sea behind the hull; the near sea, the wake and the foam in front of its
  // waterline, each under its weather's variants as the crew gets busy (`client/deck-variants.ts`). The drifters are
  // laid out from the clock's second the deck opens at, so each opening has its own sky.
  const scenery = createScenery(
    pixi,
    stage,
    { ambience: art.ambience, atmosphere: art.atmosphere, images: art.images, masks: art.masks },
    Math.floor(environment.clock().getTime() / 1000),
  );

  // The ship: the hull, its parts — the tall mast, the swaying topmast or masthead, the sail, each riding the bob and the
  // sail not the sway — and the deck's layer of props, pieces, lanterns and crew.
  const ship = new pixi.Container();
  ship.label = "ship";
  // Tint artwork, not the shared parents of badges, interaction marks and the focus veil.
  const stageInk: PixiContainer[] = [];
  for (const [index, slice] of textures.hull.entries()) {
    const sprite = new pixi.Sprite(slice.texture);
    sprite.label = `hull:${index}`;
    sprite.position.set(slice.x, slice.y);
    ship.addChild(sprite);
    stageInk.push(sprite);
  }
  const rig = textures.rig.map(function ({ part, texture, frames }) {
    const sprite = new pixi.Sprite(frames[0] ?? texture);
    sprite.label = part.place;
    sprite.position.set(part.at[0], part.at[1]);
    ship.addChild(sprite);
    stageInk.push(sprite);
    return { part, sprite, frames };
  });

  const deck = new pixi.Container();
  deck.label = "deck";
  deck.sortableChildren = true;
  ship.addChild(deck);
  for (const prop of stage.props) {
    const texture = textures.props.get(prop.id);
    if (texture === undefined || prop.rect === null) continue;
    const sprite = new pixi.Sprite(texture);
    sprite.label = `prop:${prop.id}`;
    stand(sprite, { frame: prop.rect, feet: prop.feet });
    sprite.position.set(prop.x, prop.y);
    sprite.zIndex = depthOf(prop.y, 0);
    deck.addChild(sprite);
    stageInk.push(sprite);
  }
  // The pieces at their rows — a part's own rows where it stands in for one (the tall mast's for the mast's), the plank
  // just in front of the near rail it stands over.
  for (const { piece, texture } of textures.pieces) {
    const sprite = new pixi.Sprite(texture);
    sprite.label = piece.by === null ? `piece:${piece.id}` : `piece:${piece.id}:${piece.by}`;
    sprite.position.set(piece.at[0], piece.at[1]);
    sprite.zIndex = piece.depth;
    deck.addChild(sprite);
    stageInk.push(sprite);
  }
  // The lights: each its glow, then its glyph by ink, the glass's ink tinted by its level.
  const lanterns = parts.lights.map(function (light) {
    const { style } = light;
    const root = new pixi.Container();
    root.label = `light:${light.id}`;
    root.zIndex = light.depth;
    const glow = new pixi.Graphics();
    for (const halo of style.glow) glow.circle(halo.at[0], halo.at[1], halo.radius).fill({ color: hexColour(halo.colour), alpha: halo.alpha });
    root.addChild(glow);
    let glass: PixiGraphics | null = null;
    for (const [ink, rects] of glyphRects(style.glyph, style.origin)) {
      const graphics = new pixi.Graphics();
      for (const [x, y, width, height] of rects) graphics.rect(x, y, width, height).fill(hexColour(style.inks[ink] ?? "#000000"));
      if (ink === style.glass) glass = graphics;
      root.addChild(graphics);
    }
    root.position.set(light.at[0], light.at[1]);
    deck.addChild(root);
    stageInk.push(root);
    return { light, root, glow, glass };
  });

  const sailors = new Map<string, SailorSprites>();
  // What the last frame drew, for finding the sailor under the pointer between frames.
  let drawnFigures: Figure[] = [];
  /** Where each reply marker hangs in that frame (`askMarks`). */
  let drawnMarks: ReadonlyMap<string, AskMark> = new Map();
  let drawnBob: StageTransform = { x: 0, y: 0 };
  let drawnTint = 0xffffff;
  // The weather opens at the crew's, as the crew already aboard is simply there.
  let atmosphere = openingAtmosphere(art.atmosphere, crewIntensity(scene.sailors));
  let drawnFit: DeckFit = { scale: 0, x: 0, y: 0 };
  let drawnLayout = "";
  let pointer: { x: number; y: number } | null = null;
  let hoveredKey: string | null = null;
  let reported: DeckHover | null = null;
  let mateReported: DeckHover | null = null;
  // The camera: the sailor focused, the shot last drawn, and the zoom under way (`client/deck-camera.ts`).
  let focusKey: string | null = null;
  /** The sailor in the spotlight: the one focused, or the one the camera is pulling back from. */
  let spotKey: string | null = null;
  let shot: DeckShot = WHOLE_DECK;
  /** Where the focused sailor was last seen, for a shot whose sailor has left the deck. */
  let focusPoint = WHOLE_DECK.point;
  let zoom: { from: DeckShot; start: number } | null = null;
  // Over the deck while a sailor is focused: a veil that dims the rest, and the spotlight it stands in, which rides the bob.
  const veil = new pixi.Graphics();
  veil.label = "veil";
  veil.visible = false;
  const spot = new pixi.Container();
  spot.label = "spot";
  // Over the near sea, outside the bob: a sailor off the plank, then the sharks, then the splashes.
  const overboard = new pixi.Container();
  overboard.label = "overboard";
  overboard.sortableChildren = true;
  const effects = new Map<string, PixiSprite>();
  world.addChild(scenery.back, ship, scenery.front, overboard, veil, spot);
  const carrier = art.attentionCarrier;
  const attention = new pixi.Container();
  attention.label = "attention-carrier";
  const attentionSprite = new pixi.Sprite(textures.attention.find(texture => texture !== null) ?? textures.hull[0]!.texture);
  attentionSprite.label = "carrier-above-surface";
  const submergedSprite = new pixi.Sprite(textures.submerged.find(texture => texture !== null) ?? textures.hull[0]!.texture);
  submergedSprite.label = "carrier-submerged";
  submergedSprite.visible = false;
  const rippleBack = new pixi.Graphics();
  const rippleFront = new pixi.Graphics();
  rippleBack.label = "carrier-ripple-back";
  rippleFront.label = "carrier-ripple-front";
  const attentionFallback = new pixi.Graphics();
  attentionFallback.label = "carrier-fallback";
  // Image failure retains a marker while suggestions exist, plus the keyboard action.
  if (carrier !== undefined) {
    const scale = Math.min(1, carrier.size[0] / ASK_SIZE.width, carrier.size[1] / ASK_SIZE.height);
    attentionFallback.scale.set(scale);
    attentionFallback.position.set(Math.floor((carrier.size[0] - ASK_SIZE.width * scale) / 2), Math.floor((carrier.size[1] - ASK_SIZE.height * scale) / 2));
  }
  attention.addChild(rippleBack, attentionSprite, submergedSprite, rippleFront, attentionFallback);
  world.addChild(attention);
  let carrierKey: string | null = null;
  let carrierPlace = { x: 0, y: 0, frame: 0 };

  function drawAttention(ms: number, plan: MotionPlan, surfaceMs: number, tint: number): void {
    carrierKey = carrier === undefined || focusKey !== null ? null : "suggestions";
    attention.visible = carrierKey !== null;
    if (carrier === undefined || carrierKey === null) return;
    const clock = carrier.surface === undefined ? ms : surfaceMs;
    carrierPlace = carrierAt(carrier, clock, plan.level === "full");
    attention.position.set(carrierPlace.x, carrierPlace.y);
    const frames = current.hasSuggestions ? textures.attention : textures.attentionBody;
    const texture = frames[carrierPlace.frame] ?? frames.find(each => each !== null);
    attentionSprite.position.set(0, current.hasSuggestions ? 0 : carrier.bubbleHeight ?? 0);
    attentionSprite.visible = texture != null;
    if (texture != null) attentionSprite.texture = texture;
    const under = textures.submerged[carrierPlace.frame] ?? textures.submerged.find(each => each !== null);
    submergedSprite.visible = texture != null && under != null;
    if (carrier.surface !== undefined && under != null) {
      submergedSprite.texture = under;
      submergedSprite.position.set(0, carrier.surface.row);
      submergedSprite.tint = hexColour(carrier.surface.submergedTint);
      submergedSprite.alpha = carrier.surface.submergedAlpha;
      rippleBack.clear(); rippleFront.clear();
      rippleBack.visible = rippleFront.visible = texture != null;
      rippleBack.tint = rippleFront.tint = tint;
      for (const arc of carrierRipples(carrier, clock, plan.level === "full")) {
        (arc.back ? rippleBack : rippleFront).rect(arc.x, arc.y, arc.width, 1)
          .fill(hexColour(arc.foam ? carrier.surface.ripple.colour : carrier.surface.ripple.shade));
      }
    }
    attentionFallback.visible = texture == null && current.hasSuggestions === true;
    if (texture == null) drawAsk(attentionFallback, current.palette.ask, { left: 0, top: 0, flip: false, framed: false });
  }

  function carrierUnder(point: { x: number; y: number }): string | null {
    return carrier !== undefined && carrierKey !== null && focusKey === null && drawnFit.scale > 0 &&
      carrierHit(carrier, carrierPlace, toDeck(point, drawnFit, { x: 0, y: 0 })) ? carrierKey : null;
  }

  function sailorSprites(figure: Figure): SailorSprites {
    let sprites = sailors.get(figure.key);
    if (sprites === undefined) {
      const root = new pixi.Container();
      root.label = figure.key;
      const mark = new pixi.Graphics();
      const sprite = new pixi.Sprite(textures.pose(figure.look, figure.pose));
      const upper = new pixi.Sprite(textures.pose(figure.look, figure.pose));
      upper.label = "breath";
      upper.visible = false;
      const badge = new pixi.Graphics();
      badge.label = "badge";
      const doze = new pixi.Graphics();
      doze.label = "doze";
      const ask = new pixi.Graphics();
      ask.label = "ask";
      ask.visible = false;
      root.addChild(mark, sprite, upper, badge, doze, ask);
      deck.addChild(root);
      sprites = { root, mark, sprite, upper, badge, doze, ask, asked: "", marked: "", parent: deck };
      sailors.set(figure.key, sprites);
    }
    return sprites;
  }

  function drawSailors(figures: readonly Figure[], marks: ReadonlyMap<string, AskMark>, nowMs: number, still: boolean): void {
    const present = new Set<string>();
    for (const figure of figures) {
      present.add(figure.key);
      const sprites = sailorSprites(figure);
      const posed = figureStanding(cast, figure);
      const scale = figureScale(cast, figure);
      const height = posed.frame[3];
      const rows = Math.round(height * figure.reveal);
      sprites.root.visible = rows > 0;
      if (rows <= 0) continue;
      const [, , width] = posed.frame;
      const [feetX, feetY] = posed.feet;
      const breathing = rows >= height && figure.sink > 0 && height > breathRows;
      const appearanceTexture = figure.appearance === undefined ? undefined : textures.appearances.get(figure.appearance);
      // Failed optional art leaves the engine's badge/mark and its hit target intact.
      sprites.sprite.visible = figure.appearance === undefined || appearanceTexture !== undefined;
      if (figure.appearance !== undefined) {
        if (appearanceTexture !== undefined) sprites.sprite.texture = appearanceTexture;
        stand(sprites.sprite, posed);
      } else if (rows < height) {
        // Climbing the hatch's ladder: only the top of the sailor is out, its cut edge on the hatch.
        sprites.sprite.texture = textures.rows(figure.look, figure.pose, 0, rows);
        sprites.sprite.anchor.set(feetX / width, 1);
      } else if (breathing) {
        // An out-breath: the body below the shoulders where it stands, the head and shoulders settled over it.
        // Both are placed by their top edge, in whole pixels: a fractional anchor could round the body a
        // device pixel away from where the whole sailor stands.
        const top = figure.y - figure.row - feetY * scale;
        sprites.sprite.texture = textures.rows(figure.look, figure.pose, breathRows, height - breathRows);
        sprites.sprite.anchor.set(feetX / width, 0);
        sprites.sprite.position.set(0, top + breathRows * scale);
        sprites.upper.texture = textures.rows(figure.look, figure.pose, 0, breathRows);
        sprites.upper.anchor.set(feetX / width, 0);
        sprites.upper.position.set(0, top + figure.sink * scale);
      } else {
        sprites.sprite.texture = textures.pose(figure.look, figure.pose);
        stand(sprites.sprite, posed);
      }
      sprites.upper.visible = breathing;
      const bodyTint = figure.stale ? stage.palette.staleTint : 0xffffff;
      const tint = figure.layer === "effects" || drawnTint === 0xffffff ? bodyTint : shade(bodyTint, drawnTint);
      for (const part of [sprites.sprite, sprites.upper]) {
        part.scale.set(figure.flip ? -scale : scale, scale);
        part.tint = tint;
        part.alpha = (figure.stale ? stage.palette.staleAlpha : 1) * figure.alpha;
      }
      const hovered = figure.key === hoveredKey || figure.key === focusKey;
      sprites.mark.visible = figure.offFloor !== true;
      // The focused sailor stands over the veil; it goes back among the pieces once the camera is out. One off
      // the plank is in the sea.
      const parent = figure.layer === "effects" ? overboard : figure.key === spotKey ? spot : deck;
      if (sprites.parent !== parent) {
        sprites.parent.removeChild(sprites.root);
        parent.addChild(sprites.root);
        sprites.parent = parent;
      }
      const marked = `${figure.state}:${figure.stale ? "stale" : "live"}:${rows < height ? "hatch" : "deck"}:${hovered ? "hover" : ""}:${figure.departing ? "gone" : ""}`;
      const stateColour = current.palette.states[figure.state];
      if (sprites.marked !== marked) {
        sprites.mark.clear();
        const colour = hexColour(stateColour);
        if (rows < height || figure.departing) {
          // Nothing under the feet while still on the ladder, or once its card has gone.
        } else if (figure.stale) {
          // A lost feed: the last state's colour, hollow — greyed, never idle.
          sprites.mark.ellipse(0, 0, 6, 2).stroke({ color: colour, width: 1, alpha: 0.7 });
        } else {
          sprites.mark.ellipse(0, 0, 6, 2).fill({ color: colour, alpha: 0.9 });
        }
        // The sailor under the pointer: a ring round its mark, so the label and the sailor are plainly one.
        if (hovered && rows >= height) sprites.mark.ellipse(0, 0, 9, 3).stroke({ color: 0xffffff, width: 1, alpha: 0.85 });
        drawBadge(sprites.badge, figure.state, stateColour);
        sprites.doze.clear();
        DOZE_GLYPH.forEach(function (line, y) {
          for (let x = 0; x < line.length; x += 1) if (line[x] === "#") sprites.doze.rect(x, y, 1, 1).fill(colour);
        });
        sprites.marked = marked;
      }
      // The mark stays on the deck row; the figure above it rises and leans with its motion.
      sprites.root.position.set(figure.x, figure.row);
      if (!breathing) sprites.sprite.position.set(0, figure.y - figure.row);
      sprites.root.zIndex = (typeof figure.layer === "object" ? parts.pieceDepths.get(figure.layer.front)! + 1 : figure.layer === "effects" ? 0 : depthOf(figure.row, 0)) + figure.x / 10000;
      // The badge rides over the head, with it: greyed with a stale sailor, not shown on the ladder.
      const badgeY = badgeTop(figure, cast) - figure.row;
      sprites.badge.visible = showsBadge(figure);
      sprites.badge.alpha = figure.stale ? 0.5 : 1;
      sprites.badge.position.set(-Math.floor(BADGE_SIZE.width / 2), badgeY - (figure.decisionNew && !figure.stale && !still ? askLift(figure.seed, nowMs) : 0));
      // A settled idle sailor dozes: a small z drifts up off its badge now and then. Never under reduced motion.
      const doze = figure.state === "idle" && !figure.stale && !figure.moving && !still && showsBadge(figure) ? dozeAt(figure.seed, nowMs) : null;
      sprites.doze.visible = doze !== null;
      if (doze !== null) {
        sprites.doze.position.set(Math.ceil(BADGE_SIZE.width / 2) + doze.dx, badgeY - 3 + doze.dy);
        sprites.doze.alpha = doze.alpha;
      }
      // Replies wait for the captain: the marker where `askMarks` found room, bobbing a pixel now and then, or the
      // badge's frame, pulsing; still under reduced motion.
      const ask = marks.get(figure.key);
      sprites.ask.visible = ask !== undefined;
      if (ask !== undefined) {
        const asked = `${ask.framed ? "frame" : ask.flip ? "left" : "bubble"}:${current.palette.ask}`;
        if (sprites.asked !== asked) {
          drawAsk(sprites.ask, current.palette.ask, ask);
          sprites.asked = asked;
        }
        const lift = still ? 0 : askLift(figure.seed, nowMs);
        sprites.ask.position.set(ask.left - figure.x, ask.top - figure.row - (ask.framed ? 0 : lift));
        sprites.ask.alpha = ask.framed && lift > 0 ? 0.55 : 1;
      }
    }
    for (const [key, sprites] of [...sailors.entries()]) {
      if (present.has(key)) continue;
      sprites.parent.removeChild(sprites.root);
      sprites.root.destroy({ children: true });
      sailors.delete(key);
    }
  }

  /** Draw each track in its pack-defined order, anchored and mirrored about the effect's named anchor. */
  function drawEffects(): void {
    const present = new Set<string>();
    for (const effect of portalEffects(crew)) {
      present.add(effect.key);
      const sprite = shown(effects.get(effect.key) ?? null, textures.effects.get(effect.effect)?.get(effect.frame), effect.order, effect.effect);
      if (sprite === null) continue;
      effects.set(effect.key, sprite);
      const definition = art.effects[effect.effect]!;
      sprite.anchor.set(definition.points.anchor![0] / definition.size[0], definition.points.anchor![1] / definition.size[1]);
      sprite.scale.set(effect.flip ? -1 : 1, 1);
      sprite.position.set(effect.x, effect.y);
    }
    for (const [key, sprite] of effects) {
      if (present.has(key)) continue;
      overboard.removeChild(sprite);
      sprite.destroy();
      effects.delete(key);
    }
  }

  /** A sprite in the sea's layer at `depth` showing `texture`, made on first use; hidden while there is none. */
  function shown(sprite: PixiSprite | null, texture: PixiTexture | undefined, depth: number, label: string): PixiSprite | null {
    if (texture === undefined) {
      if (sprite !== null) sprite.visible = false;
      return sprite;
    }
    if (sprite === null) {
      sprite = new pixi.Sprite(texture);
      sprite.label = label;
      sprite.zIndex = depth;
      overboard.addChild(sprite);
    }
    sprite.texture = texture;
    sprite.visible = true;
    return sprite;
  }

  /** Draws the deck as it is at `elapsedMs` on the scene clock. */
  function draw(elapsedMs: number, stepMs: number, plan: MotionPlan): void {
    const seconds = elapsedMs / 1000;
    const moving = plan.level !== "still";
    if (stepMs > 0) stepCrew(crew, stepMs);
    // Reduced motion turned on mid-walk: everyone to their anchor, nobody frozen on the way or on the ladder,
    // and anyone on the way out fading where they are.
    if (!moving) applyCrew(crew, current.sailors, { snap: true, departures: current.departures });
    // The weather: eased towards how busy the crew is, each animation on its own clock; as it always was when still.
    atmosphere = stepAtmosphere(art.atmosphere, atmosphere, stepMs, crewIntensity(current.sailors), moving);
    const weather = moving ? weatherOf(art.atmosphere, atmosphere) : deliveredWeather(art.atmosphere, seconds);
    // The stage's bob, never on a still deck; each part's sway and cycle as it says it moves.
    const bob = stageMotionAt(parts.motion, seconds, weather, moving);
    ship.position.set(bob.x, bob.y);
    ship.rotation = bob.rotation ?? 0;
    for (const { part, sprite, frames } of rig) {
      const run = elementMotion(part, plan) === "run";
      const { behaviour } = part;
      if (behaviour?.kind === "sway") {
        const sway = run ? swayAt(clockOf(weather, behaviour.clock, seconds), behaviour, levelAt(behaviour.amplitude, weather)) : 0;
        sprite.position.set(part.at[0] + sway, part.at[1]);
      } else if (behaviour?.kind === "cycle") {
        const duty = behaviour.duty === undefined ? undefined : levelAt(behaviour.duty, weather);
        sprite.texture = frames[dutyFrame(clockOf(weather, behaviour.frames.clock, seconds), { count: frames.length, frameMs: behaviour.frames.frameMs }, run, duty)]!;
      }
    }
    const minute = currentMinute();
    const sky = scenery.draw(seconds, plan, minute, weather);
    const tint = phaseTintAt(stage.phaseTint, minute);
    if (tint !== drawnTint) {
      for (const ink of stageInk) ink.tint = tint;
      drawnTint = tint;
    }
    for (const { light, root, glow, glass } of lanterns) {
      const motion = elementMotion(light, plan);
      const { flicker, glowAlpha, tints } = light.style;
      const level = motion === "run" ? flickerAt(seconds, light.seed, flicker) : flicker.still;
      root.visible = motion !== "hide";
      glow.alpha = glowAlpha.base + glowAlpha.gain * level;
      if (glass !== null) glass.tint = hexColour(glassTint(level, tints));
    }
    drawnFigures = crewFigures(crew, elapsedMs, { still: !moving });
    for (const figure of drawnFigures) figure.decisionNew = current.decisions?.byCard.get(figure.key)?.state === "new";
    const mateFigure = firstMateFigure(stage, cast, current);
    if (mateFigure !== null) drawnFigures.push(mateFigure);
    drawnMarks = askMarks(drawnFigures, cast);
    drawnBob = bob;
    spot.position.set(bob.x, bob.y);
    spot.rotation = bob.rotation ?? 0;
    aim(elapsedMs, moving);
    drawAttention(elapsedMs, plan, clockOf(weather, carrier?.surface?.ripple.clock, seconds) * 1000, tint);
    findHover();
    drawSailors(drawnFigures, drawnMarks, elapsedMs, !moving);
    drawEffects();
    watchFades();
    canvas.setAttribute(DECK_MOTION_ATTRIBUTE, plan.level);
    canvas.setAttribute(DECK_WEATHER_ATTRIBUTE, moving ? atmosphere.intensity.toFixed(2) : "still");
    canvas.setAttribute(DECK_FLASH_ATTRIBUTE, scenery.flashing().join(" "));
    canvas.setAttribute(DECK_SKY_ATTRIBUTE, sky ?? "none");
    app.render();
  }

  /**
   * Finds the sailor under the pointer in what was last drawn, and tells `onHover` when that sailor, or
   * its place on the canvas, changes. Says whether the sailor changed, so its ring is redrawn.
   *
   * While a sailor is focused, the report is instead where the focused sailor stands, and only while it
   * wears the reply marker: the pane hangs its speech bubble there, through the zoom and every resize.
   */
  function findHover(): boolean {
    const mate = drawnFigures.find(figure => figure.key === FIRST_MATE_KEY);
    const mateAnchor = mate === undefined || drawnFit.scale <= 0 || focusKey !== null ? null : hoverOf(mate, cast, drawnFit, drawnBob, app.screen, null);
    if (hoverChanged(mateReported, mateAnchor)) { mateReported = mateAnchor; onFirstMate(mateAnchor); }
    const attentionKey = current.suggestionsOpen && focusKey === null ? carrierKey : pointer === null ? null : carrierUnder(pointer);
    // While a sailor is focused its panel says who it is: no label, no ring, for anyone else.
    const figure =
      pointer === null || drawnFit.scale <= 0 || focusKey !== null ? null : sailorAt(drawnFigures, cast, toDeck(pointer, drawnFit, drawnBob), drawnMarks);
    canvas.style.cursor = figure === null && attentionKey === null ? "default" : "pointer";
    const key = attentionKey ?? figure?.key ?? null;
    const changed = key !== hoveredKey;
    hoveredKey = key;
    const speaker = focusKey === null || drawnFit.scale <= 0 ? null : (drawnFigures.find((each) => each.key === focusKey && drawnMarks.has(each.key)) ?? null);
    const shown = figure ?? speaker;
    const next = attentionKey !== null && carrier !== undefined ? carrierHover(attentionKey, carrier, carrierPlace, drawnFit, app.screen)
      : shown === null ? null : hoverOf(shown, cast, drawnFit, drawnBob, app.screen, stage.zoneOf(shown.state).labelFloor, drawnMarks.get(shown.key));
    if (hoverChanged(reported, next)) {
      reported = next;
      onHover(next);
    }
    return changed;
  }

  /** The local minute of the day for the sky, or null when the clock will not say (midday is drawn then). */
  function currentMinute(): number | null {
    try {
      return localMinute(environment.clock());
    } catch {
      return null;
    }
  }

  /**
   * Moves the camera on to `elapsedMs`: follows the focused sailor wherever it walks, eases a zoom in or out
   * under way, and snaps when the deck is still (reduced motion), then fits the world to the shot.
   */
  function aim(elapsedMs: number, moving: boolean): void {
    if (focusKey !== null) {
      const figure = drawnFigures.find((each) => each.key === focusKey);
      const box = figure === undefined ? null : figureBox(figure, cast);
      if (box !== null) focusPoint = parts.motion?.rock === undefined ? boxMiddle(box) : stageToWorld(boxMiddle(box), drawnBob);
    }
    const target: DeckShot = { amount: focusKey === null ? 0 : 1, point: focusPoint };
    if (zoom !== null && moving) {
      const t = (elapsedMs - zoom.start) / FOCUS_MS;
      shot = shotBetween(zoom.from, target, t);
      if (t >= 1) zoom = null;
    } else {
      zoom = null;
      shot = target;
    }
    if (focusKey === null && shot.amount <= 0) spotKey = null;
    fit();
  }

  /** Fits the world to the canvas through the camera's shot, and lays the scenery and veil out over what shows. */
  function fit(): void {
    const base = fitDeck(app.screen, deckBox(stage, parts.top, parts.motion?.rock !== undefined), app.renderer.resolution, stage.fit.margin);
    const { scale, x, y } = cameraFit(base, shot, focusLayout(app.screen), app.renderer.resolution, stage.actorHeight);
    veil.visible = shot.amount > 0;
    veil.alpha = FOCUS_VEIL_ALPHA * Math.max(0, Math.min(1, shot.amount));
    // The scenery and the veil are laid out again only when what shows has changed: the shot, or the canvas.
    const laid = `${scale}:${x}:${y}:${app.screen.width}:${app.screen.height}`;
    const layoutChanged = laid !== drawnLayout;
    if (!layoutChanged && parts.motion?.rock === undefined) return;
    drawnLayout = laid;
    world.scale.set(scale);
    world.position.set(x, y);
    drawnFit = { scale, x, y };
    if (scale <= 0) return;
    const visible = visibleWorld(drawnFit, app.screen);
    if (layoutChanged) scenery.layout(visible, app.screen);
    if (parts.motion?.rock !== undefined) {
      // The veil rides the stage too; inverse viewport corners ensure its rotated rectangle still covers the screen.
      const corners = [visible.left, visible.right].flatMap(x => [visible.top, visible.bottom].map(y => worldToStage({ x, y }, drawnBob)));
      const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y));
      veil.position.set(drawnBob.x, drawnBob.y);
      veil.rotation = drawnBob.rotation ?? 0;
      veil.clear().rect(left - 1, top - 1, Math.max(...corners.map(p => p.x)) - left + 2, Math.max(...corners.map(p => p.y)) - top + 2).fill(stage.palette.veil);
    } else veil.clear().rect(visible.left - 1, visible.top - 1, visible.right - visible.left + 2, visible.bottom - visible.top + 2).fill(stage.palette.veil);
  }

  /**
   * A still deck draws only when something changes, so while anyone fades out it is drawn again every
   * `FADE_STEP_MS`, the fade stepped on as much, until nobody is fading. Stepped but not drawn while hidden.
   */
  let stopFades: (() => void) | null = null;
  function watchFades(): void {
    if (stopFades !== null || !fading(crew)) return;
    stopFades = environment.every(FADE_STEP_MS, function () {
      if (animator.plan().level === "still") stepDepartures(crew, FADE_STEP_MS);
      if (!fading(crew)) {
        stopFades?.();
        stopFades = null;
      }
      if (!environment.signals.documentHidden()) animator.invalidate();
    });
  }

  applyCrew(crew, scene.sailors, { snap: true, departures: scene.departures });
  fit();
  const animator = deckAnimator({ scheduler: environment.scheduler, signals: environment.signals, software, size, frame: draw });
  // A running loop reads the clock every frame; a still deck is drawn again once a minute, so its sky keeps up.
  const stopSky = environment.every(SKY_REFRESH_MS, function () {
    if (animator.plan().level === "still" && !environment.signals.documentHidden()) animator.invalidate();
  });

  // The pointer, in CSS pixels on the canvas. A touch's pointer leaves as the finger lifts, so its label
  // stays until the next tap; a mouse's goes when it leaves the canvas.
  function onPointer(event: CanvasPointerEvent): void {
    pointer = { x: event.offsetX, y: event.offsetY };
    if (findHover()) animator.invalidate();
  }
  function onLeave(event: CanvasPointerEvent): void {
    if (event.pointerType === "touch") return;
    pointer = null;
    if (findHover()) animator.invalidate();
  }
  // A click names the sailor under it, found through the camera as drawn, or nobody; the pane decides what it does.
  function onClick(event: CanvasPointerEvent): void {
    const key = carrierUnder({ x: event.offsetX, y: event.offsetY });
    if (key !== null) { onSelect(key, "attention"); return; }
    const figure = drawnFit.scale <= 0 ? null : sailorAt(drawnFigures, cast, toDeck({ x: event.offsetX, y: event.offsetY }, drawnFit, drawnBob), drawnMarks);
    onSelect(figure?.key ?? null);
  }
  canvas.addEventListener?.("pointermove", onPointer);
  canvas.addEventListener?.("pointerdown", onPointer);
  canvas.addEventListener?.("pointerleave", onLeave);
  canvas.addEventListener?.("click", onClick);

  return {
    renderer: app.renderer.name,
    presentation: art.presentation,
    update(next) {
      if (next.palette.sea !== current.palette.sea) app.renderer.background.color = next.palette.sea;
      if (next.palette !== current.palette) {
        for (const sprites of sailors.values()) sprites.marked = "";
      }
      current = next;
      applyCrew(crew, next.sailors, { snap: animator.plan().level === "still", departures: next.departures });
      animator.invalidate();
    },
    focus(key) {
      if (key === focusKey) return;
      // From wherever the camera is now, mid-zoom included, so a change of mind never jumps.
      zoom = { from: shot, start: animator.elapsed() };
      focusKey = key;
      if (key !== null) spotKey = key;
      findHover();
      animator.invalidate();
    },
    resize(width, height) {
      if (width >= 1 && height >= 1) {
        app.renderer.resize(width, height);
        fit();
      }
      animator.resize(width, height);
      animator.invalidate();
    },
    destroy() {
      canvas.removeEventListener?.("pointermove", onPointer);
      canvas.removeEventListener?.("pointerdown", onPointer);
      canvas.removeEventListener?.("pointerleave", onLeave);
      canvas.removeEventListener?.("click", onClick);
      if (reported !== null) onHover(null);
      if (mateReported !== null) onFirstMate(null);
      reported = null;
      stopSky();
      stopFades?.();
      stopFades = null;
      animator.destroy();
      app.destroy({ removeView: true }, { children: true });
      textures.destroy();
      scenery.destroy();
    },
  };
}
