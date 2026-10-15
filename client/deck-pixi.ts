/**
 * The ship deck drawn with PixiJS 8 on WebGL, alive: hull C under sail on a moving sea, its wake behind
 * it, under the sky of the local time of day, one sailor sprite per live crewmate — each in its own look —
 * walking to where its state sends it, the hull's depth pieces drawn back over any sailor behind them, and
 * the deck's ambient life — the bob, the masthead's sway, the sail's billow, the lanterns, a gull now and then.
 *
 * **Depth, back to front:** the sky, its stars and the gull, then the far sea (the `back` of
 * `client/deck-environment.ts`); the ship — the hull, the masthead, the sail — with its deck of props,
 * pieces, lanterns and crew; then the near sea, the wake and the foam over the hull's waterline (its
 * `front`). The hover label and legend are React, on top. The sail hangs behind the crew; while it shows, the
 * mast's depth piece is the occluder, which leaves the cloth alone (`client/deck-extras.ts`).
 *
 * Who moves where is `client/deck-crew.ts`; the ambient motion is `client/deck-ambient.ts`; the sea, the
 * sky and the gull are `client/deck-environment.ts`, from the generated art; the sail and the crew's looks
 * are `client/deck-extras.ts`; when a frame
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
 * it to Pixi's own build. **So is the art**: one atlas from `firstmate.deck.art`, decoded once a session
 * by the mount and handed in as an image with its manifest — and the environment's images beside it.
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
import type { DeckArtManifest, SailorPose } from "../shared/ship-deck";
import { LANTERNS, lanternFlicker, MASTHEAD, mastSway, shipBob, type MotionPlan } from "./deck-ambient";
import { BADGE_SIZE, badgeInk, badgePixels, DOZE_GLYPH, dozeAt, hexColour } from "./deck-badges";
import { applyCrew, BREATH_ROWS, createCrew, crewFigures, stepCrew, type Figure } from "./deck-crew";
import { ATLAS_LOOKS, crewLooks, drawnSail, lookLane, sailFrame, type DeckExtrasImages } from "./deck-extras";
import { boxMiddle, cameraFit, FOCUS_MS, FOCUS_VEIL_ALPHA, focusLayout, shotBetween, visibleWorld, WHOLE_DECK, type DeckShot } from "./deck-camera";
import { badgeTop, figureBox, hoverChanged, hoverOf, sailorAt, showsBadge, toDeck, type DeckFit, type DeckHover } from "./deck-hover";
import { deckAnimator, type FrameScheduler, type MotionSignals } from "./deck-loop";
import type { DeckDrawing, DeckHost } from "./deck-mount";
import { DECK_PROPS, depthOf, type DeckScene, type DeckState } from "./deck-scene";
import { createScenery, type DeckEnvironmentImages } from "./deck-environment";
import { dominantPhase, localMinute, SKY_REFRESH_MS } from "./deck-sky";

/** Marks the canvas with its renderer, so the live check can read it in the app's DevTools. */
export const DECK_CANVAS_ATTRIBUTE = "data-firstmate-deck";
/** Marks the canvas with the motion in force: `full`, `lite` or `still`. */
export const DECK_MOTION_ATTRIBUTE = "data-firstmate-deck-motion";
/** Marks the canvas with the sky that shows most (`dawn` … `night`), or `none` without the environment. */
export const DECK_SKY_ATTRIBUTE = "data-firstmate-deck-sky";

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
  zIndex: number;
  sortableChildren: boolean;
  visible: boolean;
  alpha: number;
  tint: number;
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
 * The deck's art as the mount hands it over: the decoded atlas image, and where everything is in it; the
 * generated sea, sky and gull, or null when they could not be loaded; and the sail and the crew's extra
 * looks, as many of them as decoded, or null.
 */
export interface DeckArtImage {
  image: unknown;
  manifest: DeckArtManifest;
  environment: DeckEnvironmentImages | null;
  extras: DeckExtrasImages | null;
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
 * One texture per frame of the atlas, all on one `nearest`-sampled source, and crops made on demand; and
 * the same for the extras: the sail's states, the mast occluder, and every pose of each extra look, cut
 * from its own image at the atlas's base-lane rectangles.
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
  const made: PixiTexture[] = [];
  const frame = ([x, y, width, height]: Frame, from: PixiTextureSource = source) => {
    const texture = new pixi.Texture({ source: from, frame: new pixi.Rectangle(x, y, width, height) });
    made.push(texture);
    return texture;
  };
  const { manifest } = art;
  const [shipX, shipY, shipWidth, shipHeight] = manifest.ship.frame;
  const mastRight = MASTHEAD.x + MASTHEAD.width;
  // The hull in four: everything but the masthead, which is cut out to sway.
  const hull = [
    { texture: frame([shipX, shipY, MASTHEAD.x, shipHeight]), x: 0, y: 0 },
    { texture: frame([shipX + MASTHEAD.x, shipY + MASTHEAD.height, MASTHEAD.width, shipHeight - MASTHEAD.height]), x: MASTHEAD.x, y: MASTHEAD.height },
    { texture: frame([shipX + mastRight, shipY, shipWidth - mastRight, shipHeight]), x: mastRight, y: 0 },
  ];
  const masthead = frame([shipX + MASTHEAD.x, shipY + MASTHEAD.y, MASTHEAD.width, MASTHEAD.height]);
  const pieces = new Map(Object.entries(manifest.pieces).map(([name, piece]) => [name, frame(piece.frame)]));
  const props = new Map(Object.entries(manifest.props).map(([name, entry]) => [name, frame(entry.frame)]));

  // Each look's image: the atlas for its own two outfits, an extra look's own texture otherwise.
  const { extras } = art;
  const lookSources = new Map<string, PixiTextureSource>(ATLAS_LOOKS.map((outfit) => [outfit, source]));
  for (const look of extras?.manifest.crew ?? []) {
    const image = extras!.images.get(look.texture);
    if (image !== undefined && !lookSources.has(look.id)) lookSources.set(look.id, sourceOf(image));
  }
  const crew = new Map(
    [...lookSources].map(([look, from]) => {
      const lane = manifest.crew[lookLane(look)];
      return [look, new Map(Object.entries(lane).map(([pose, entry]) => [pose, frame(entry.frame, from)]))] as const;
    }),
  );

  // The sail's states, side by side in its strip, and the occluder that stands in for the mast while it shows.
  const sailManifest = drawnSail(extras, manifest.pieces);
  let sail: { states: PixiTexture[]; occluder: PixiTexture } | null = null;
  if (sailManifest !== null) {
    const strip = sourceOf(extras!.images.get(sailManifest.texture));
    const [width, height] = sailManifest.frameSize;
    const states = Array.from({ length: sailManifest.frames }, (_, index) => frame([index * width, 0, width, height], strip));
    const occluderPiece = manifest.pieces[sailManifest.occluder.replaces]!;
    const [, , pieceWidth, pieceHeight] = occluderPiece.frame;
    const occluder = frame([0, 0, pieceWidth, pieceHeight], sourceOf(extras!.images.get(sailManifest.occluder.texture)));
    sail = { states, occluder };
  }

  const crops = new Map<string, PixiTexture>();
  return {
    hull,
    masthead,
    pieces,
    props,
    sail,
    sailManifest,
    /** A look's whole pose. */
    pose(look: string, pose: SailorPose): PixiTexture {
      return (crew.get(look) ?? crew.get("base")!).get(pose)!;
    },
    /** `rows` rows of a look's pose from `top`: what shows of it on the hatch's ladder, or its two halves on an out-breath. */
    rows(look: string, pose: SailorPose, top: number, rows: number): PixiTexture {
      const drawn = crew.has(look) ? look : "base";
      const key = `${drawn}:${pose}:${top}:${rows}`;
      let texture = crops.get(key);
      if (texture === undefined) {
        const [x, y, width] = manifest.crew[lookLane(drawn)][pose].frame;
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
 */
export function fitDeck(screen: { width: number; height: number }, deck: { width: number; height: number }, resolution: number) {
  const scale = Math.max(0, Math.min(screen.width / deck.width, screen.height / deck.height) * 0.96);
  const snap = (value: number) => Math.round(value * resolution) / resolution;
  return { scale, x: snap((screen.width - deck.width * scale) / 2), y: snap((screen.height - deck.height * scale) / 2) };
}

/**
 * One sailor's sprites: the state's mark under its feet, the figure itself, its head and shoulders apart
 * on an at-ease out-breath, its state's badge over its head, and an idle sailor's z.
 */
interface SailorSprites {
  root: PixiContainer;
  mark: PixiGraphics;
  sprite: PixiSprite;
  /** The top `BREATH_ROWS` rows, drawn on their own only while they have settled; hidden otherwise. */
  upper: PixiSprite;
  badge: PixiGraphics;
  doze: PixiGraphics;
  /** What the mark and badge were last drawn as, so they are redrawn only when the state, the feed or the hover changes. */
  marked: string;
  /** Whether it stands in the spotlight, over the veil, rather than among the deck's pieces. */
  spotlit: boolean;
}

/** Draws `state`'s badge (`client/deck-badges.ts`) into `graphics`, its top left at the origin. */
function drawBadge(graphics: PixiGraphics, state: DeckState, colour: string): void {
  const sign = hexColour(colour);
  const ink = badgeInk(colour);
  graphics.clear();
  for (const pixel of badgePixels(state)) graphics.rect(pixel.x, pixel.y, 1, 1).fill(pixel.kind === "sign" ? sign : ink);
}

/** The veil over the deck behind a focused sailor: the night sea's navy, faded in with the zoom. */
const VEIL_COLOUR = 0x050b14;

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
  onSelect: (key: string | null) => void = function () {},
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
  host.appendChild(app.canvas);

  const { manifest } = art;
  const textures: Textures = atlasTextures(pixi, art);
  let current = scene;
  const crew = createCrew(crewLooks(art.extras));

  const world = new pixi.Container();
  world.label = "world";
  app.stage.addChild(world);

  // The sky, the gull and the far sea behind the hull; the near sea and the foam in front of its waterline.
  const scenery = createScenery(pixi, art.environment);
  const skyPhases = art.environment?.manifest.sky.phases ?? [];

  // The ship: the hull, the swaying masthead, and the deck's layer of props, pieces, lanterns and crew.
  const ship = new pixi.Container();
  ship.label = "ship";
  for (const [index, slice] of textures.hull.entries()) {
    const sprite = new pixi.Sprite(slice.texture);
    sprite.label = `hull:${index}`;
    sprite.position.set(slice.x, slice.y);
    ship.addChild(sprite);
  }
  const masthead = new pixi.Sprite(textures.masthead);
  masthead.label = "masthead";
  masthead.position.set(MASTHEAD.x, MASTHEAD.y);
  ship.addChild(masthead);
  // The sail, on the mast under the crow's nest: it rides the bob, not the masthead's sway, and hangs behind the crew.
  const sailTextures = textures.sail;
  const sailManifest = textures.sailManifest;
  const sail = sailTextures === null || sailManifest === null ? null : new pixi.Sprite(sailTextures.states[0]!);
  if (sail !== null && sailManifest !== null) {
    sail.label = "sail";
    sail.position.set(sailManifest.position[0], sailManifest.position[1]);
    ship.addChild(sail);
  }

  const deck = new pixi.Container();
  deck.label = "deck";
  deck.sortableChildren = true;
  ship.addChild(deck);
  for (const prop of DECK_PROPS) {
    const sprite = new pixi.Sprite(textures.props.get(prop.name)!);
    sprite.label = `prop:${prop.name}`;
    stand(sprite, manifest.props[prop.name]);
    sprite.position.set(prop.x, prop.y);
    sprite.zIndex = depthOf(prop.y, 0);
    deck.addChild(sprite);
  }
  for (const [name, piece] of Object.entries(manifest.pieces)) {
    // Under sail, the mast's piece is the occluder: the mast with the rows behind the cloth cleared.
    const occluder = sailManifest !== null && sailTextures !== null && sailManifest.occluder.replaces === name ? sailManifest.occluder : null;
    const texture = occluder !== null ? sailTextures!.occluder : textures.pieces.get(name);
    if (texture === undefined) continue;
    const sprite = new pixi.Sprite(texture);
    sprite.label = occluder !== null ? `piece:${name}:occluder` : `piece:${name}`;
    sprite.position.set(occluder?.position[0] ?? piece.x, occluder?.position[1] ?? piece.y);
    sprite.zIndex = depthOf(occluder !== null ? occluder.baseline : piece.baseline, 1);
    deck.addChild(sprite);
  }
  const lanterns = LANTERNS.map(function (lantern) {
    const root = new pixi.Container();
    root.label = "lantern";
    root.zIndex = depthOf(lantern.row, 1) + 0.5;
    const glow = new pixi.Graphics().circle(0, 4, 9).fill({ color: 0xffb050, alpha: 0.12 }).circle(0, 4, 5).fill({ color: 0xffc070, alpha: 0.2 });
    const body = new pixi.Graphics()
      .rect(0, 0, 1, 1)
      .fill(0x2a1a10)
      .rect(-1, 1, 3, 1)
      .fill(0x2a1a10)
      .rect(-2, 2, 1, 3)
      .fill(0x2a1a10)
      .rect(2, 2, 1, 3)
      .fill(0x2a1a10)
      .rect(-2, 5, 5, 1)
      .fill(0x2a1a10);
    const glass = new pixi.Graphics().rect(-1, 2, 3, 3).fill(0xffd27a);
    root.addChild(glow, body, glass);
    root.position.set(lantern.x, lantern.y);
    deck.addChild(root);
    return { lantern, glow, glass };
  });

  const sailors = new Map<string, SailorSprites>();
  // What the last frame drew, for finding the sailor under the pointer between frames.
  let drawnFigures: Figure[] = [];
  let drawnBob = { x: 0, y: 0 };
  let drawnFit: DeckFit = { scale: 0, x: 0, y: 0 };
  let drawnLayout = "";
  let pointer: { x: number; y: number } | null = null;
  let hoveredKey: string | null = null;
  let reported: DeckHover | null = null;
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
  world.addChild(scenery.back, ship, scenery.front, veil, spot);

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
      root.addChild(mark, sprite, upper, badge, doze);
      deck.addChild(root);
      sprites = { root, mark, sprite, upper, badge, doze, marked: "", spotlit: false };
      sailors.set(figure.key, sprites);
    }
    return sprites;
  }

  function drawSailors(figures: readonly Figure[], nowMs: number, still: boolean): void {
    const present = new Set<string>();
    for (const figure of figures) {
      present.add(figure.key);
      const sprites = sailorSprites(figure);
      const standing = manifest.crew[figure.outfit][figure.pose];
      const height = standing.frame[3];
      const rows = Math.round(height * figure.reveal);
      sprites.root.visible = rows > 0;
      if (rows <= 0) continue;
      const [, , width] = standing.frame;
      const [feetX, feetY] = standing.feet;
      const breathing = rows >= height && figure.sink > 0 && height > BREATH_ROWS;
      if (rows < height) {
        // Climbing the hatch's ladder: only the top of the sailor is out, its cut edge on the hatch.
        sprites.sprite.texture = textures.rows(figure.look, figure.pose, 0, rows);
        sprites.sprite.anchor.set(feetX / width, 1);
      } else if (breathing) {
        // An out-breath: the body below the shoulders where it stands, the head and shoulders settled over it.
        // Both are placed by their top edge, in whole pixels: a fractional anchor could round the body a
        // device pixel away from where the whole sailor stands.
        const top = figure.y - figure.row - feetY;
        sprites.sprite.texture = textures.rows(figure.look, figure.pose, BREATH_ROWS, height - BREATH_ROWS);
        sprites.sprite.anchor.set(feetX / width, 0);
        sprites.sprite.position.set(0, top + BREATH_ROWS);
        sprites.upper.texture = textures.rows(figure.look, figure.pose, 0, BREATH_ROWS);
        sprites.upper.anchor.set(feetX / width, 0);
        sprites.upper.position.set(0, top + figure.sink);
      } else {
        sprites.sprite.texture = textures.pose(figure.look, figure.pose);
        stand(sprites.sprite, standing);
      }
      sprites.upper.visible = breathing;
      for (const part of [sprites.sprite, sprites.upper]) {
        part.scale.set(figure.flip ? -1 : 1, 1);
        part.tint = figure.stale ? 0x8a9096 : 0xffffff;
        part.alpha = figure.stale ? 0.6 : 1;
      }
      const hovered = figure.key === hoveredKey || figure.key === focusKey;
      // The focused sailor stands over the veil; it goes back among the pieces once the camera is out.
      const spotlit = figure.key === spotKey;
      if (sprites.spotlit !== spotlit) {
        (spotlit ? deck : spot).removeChild(sprites.root);
        (spotlit ? spot : deck).addChild(sprites.root);
        sprites.spotlit = spotlit;
      }
      const marked = `${figure.state}:${figure.stale ? "stale" : "live"}:${rows < height ? "hatch" : "deck"}:${hovered ? "hover" : ""}`;
      const stateColour = current.palette.states[figure.state];
      if (sprites.marked !== marked) {
        sprites.mark.clear();
        const colour = hexColour(stateColour);
        if (rows < height) {
          // Nothing under the feet while still on the ladder.
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
      sprites.root.zIndex = depthOf(figure.row, 0) + figure.x / 10000;
      // The badge rides over the head, with it: greyed with a stale sailor, not shown on the ladder.
      const badgeY = badgeTop(figure, manifest) - figure.row;
      sprites.badge.visible = showsBadge(figure);
      sprites.badge.alpha = figure.stale ? 0.5 : 1;
      sprites.badge.position.set(-Math.floor(BADGE_SIZE.width / 2), badgeY);
      // A settled idle sailor dozes: a small z drifts up off its badge now and then. Never under reduced motion.
      const doze = figure.state === "idle" && !figure.stale && !figure.moving && !still && showsBadge(figure) ? dozeAt(figure.seed, nowMs) : null;
      sprites.doze.visible = doze !== null;
      if (doze !== null) {
        sprites.doze.position.set(Math.ceil(BADGE_SIZE.width / 2) + doze.dx, badgeY - 3 + doze.dy);
        sprites.doze.alpha = doze.alpha;
      }
    }
    for (const [key, sprites] of [...sailors.entries()]) {
      if (present.has(key)) continue;
      (sprites.spotlit ? spot : deck).removeChild(sprites.root);
      sprites.root.destroy({ children: true });
      sailors.delete(key);
    }
  }

  /** Draws the deck as it is at `elapsedMs` on the scene clock. */
  function draw(elapsedMs: number, stepMs: number, plan: MotionPlan): void {
    const seconds = elapsedMs / 1000;
    const moving = plan.level !== "still";
    if (stepMs > 0) stepCrew(crew, stepMs);
    // Reduced motion turned on mid-walk: everyone to their anchor, nobody frozen on the way or on the ladder.
    if (!moving) applyCrew(crew, current.sailors, { snap: true });
    const bob = moving ? shipBob(seconds) : { x: 0, y: 0 };
    ship.position.set(bob.x, bob.y);
    masthead.position.set(MASTHEAD.x + (moving ? mastSway(seconds) : 0), MASTHEAD.y);
    if (sail !== null && sailTextures !== null && sailManifest !== null) sail.texture = sailTextures.states[sailFrame(seconds, sailManifest, moving)]!;
    const sky = scenery.draw(seconds, plan, currentMinute());
    for (const { lantern, glow, glass } of lanterns) {
      const level = moving ? lanternFlicker(seconds, lantern.seed) : 0.85;
      glow.alpha = 0.45 + 0.55 * level;
      glass.tint = level > 0.88 ? 0xffffff : level > 0.74 ? 0xf2dcb8 : 0xd8b890;
    }
    drawnFigures = crewFigures(crew, elapsedMs, { still: !moving });
    drawnBob = bob;
    spot.position.set(bob.x, bob.y);
    aim(elapsedMs, moving);
    findHover();
    drawSailors(drawnFigures, elapsedMs, !moving);
    canvas.setAttribute(DECK_MOTION_ATTRIBUTE, plan.level);
    canvas.setAttribute(DECK_SKY_ATTRIBUTE, sky === null ? "none" : (skyPhases[dominantPhase(sky)]?.id ?? "none"));
    app.render();
  }

  /**
   * Finds the sailor under the pointer in what was last drawn, and tells `onHover` when that sailor, or
   * its place on the canvas, changes. Says whether the sailor changed, so its ring is redrawn.
   */
  function findHover(): boolean {
    // While a sailor is focused its panel says who it is: no label, no ring, for anyone else.
    const figure =
      pointer === null || drawnFit.scale <= 0 || focusKey !== null ? null : sailorAt(drawnFigures, manifest, toDeck(pointer, drawnFit, drawnBob));
    canvas.style.cursor = figure === null ? "default" : "pointer";
    const key = figure?.key ?? null;
    const changed = key !== hoveredKey;
    hoveredKey = key;
    const next = figure === null ? null : hoverOf(figure, manifest, drawnFit, drawnBob, app.screen);
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
      const box = figure === undefined ? null : figureBox(figure, manifest);
      if (box !== null) focusPoint = boxMiddle(box);
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
    const base = fitDeck(app.screen, current, app.renderer.resolution);
    const { scale, x, y } = cameraFit(base, shot, focusLayout(app.screen), app.renderer.resolution);
    veil.visible = shot.amount > 0;
    veil.alpha = FOCUS_VEIL_ALPHA * Math.max(0, Math.min(1, shot.amount));
    // The scenery and the veil are laid out again only when what shows has changed: the shot, or the canvas.
    const laid = `${scale}:${x}:${y}:${app.screen.width}:${app.screen.height}`;
    if (laid === drawnLayout) return;
    drawnLayout = laid;
    world.scale.set(scale);
    world.position.set(x, y);
    drawnFit = { scale, x, y };
    if (scale <= 0) return;
    const visible = visibleWorld(drawnFit, app.screen);
    scenery.layout(visible);
    veil.clear().rect(visible.left - 1, visible.top - 1, visible.right - visible.left + 2, visible.bottom - visible.top + 2).fill(VEIL_COLOUR);
  }

  applyCrew(crew, scene.sailors, { snap: true });
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
    const figure = drawnFit.scale <= 0 ? null : sailorAt(drawnFigures, manifest, toDeck({ x: event.offsetX, y: event.offsetY }, drawnFit, drawnBob));
    onSelect(figure?.key ?? null);
  }
  canvas.addEventListener?.("pointermove", onPointer);
  canvas.addEventListener?.("pointerdown", onPointer);
  canvas.addEventListener?.("pointerleave", onLeave);
  canvas.addEventListener?.("click", onClick);

  return {
    renderer: app.renderer.name,
    update(next) {
      if (next.palette.sea !== current.palette.sea) app.renderer.background.color = next.palette.sea;
      if (next.palette !== current.palette) {
        for (const sprites of sailors.values()) sprites.marked = "";
      }
      current = next;
      applyCrew(crew, next.sailors, { snap: animator.plan().level === "still" });
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
      reported = null;
      stopSky();
      animator.destroy();
      app.destroy({ removeView: true }, { children: true });
      textures.destroy();
      scenery.destroy();
    },
  };
}
