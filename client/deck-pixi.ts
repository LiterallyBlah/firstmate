/**
 * The ship deck drawn with PixiJS 8 on WebGL, alive: hull C on a moving sea, one sailor sprite per live
 * crewmate walking to where its state sends it, the hull's depth pieces drawn back over any sailor behind
 * them, and the deck's ambient life — the bob, the masthead's sway, the lanterns, a gull now and then.
 *
 * Who moves where is `client/deck-crew.ts`; the ambient motion is `client/deck-ambient.ts`; when a frame
 * is drawn at all is `client/deck-loop.ts`. This file only turns those into sprites.
 *
 * **Pixi is handed in, never imported.** The plugin's client bundle is one script that a phone's Hermes
 * must parse whole before any of it runs, and Pixi is written with `class` syntax that React Native
 * 0.81's `hermesc` refuses with its default flags (`docs/ship-deck-canvas/compile.mjs` checks).
 * So Pixi stays out of the bundle: the daemon serves its browser build (`vendor/pixi.min.js`) through
 * `firstmate.deck.engine`, and `client/deck-mount.ts` evaluates it in a web renderer and passes the
 * namespace here. `PixiModule` is the narrow shape of it this file uses; `client/ship-deck.test.ts` holds
 * it to Pixi's own build. **So is the art**: one atlas from `firstmate.deck.art`, decoded once a session
 * by the mount and handed in as an image with its manifest.
 *
 * It is pixel art, so it is sampled `nearest`, every position is a whole art pixel, and the deck is
 * scaled by whole device pixels once it is at least twice its size, so every art pixel is the same size
 * on screen. The ticker never starts (`autoStart: false`): `deckAnimator` calls `render` itself, at most
 * 30 times a second, and not at all while the deck is hidden or under reduced motion.
 *
 * **Depth while moving.** The deck's layer sorts its children by `zIndex`, set from `depthOf` for every
 * prop, piece and lantern once and for every sailor on every frame, so a sailor walking aft passes
 * behind the mast, the bollards and the stairs' balustrade, and in front of them on its way back.
 */
import type { DeckArtManifest, SailorOutfit, SailorPose } from "../shared/ship-deck";
import {
  foamFrame,
  gullsAt,
  HORIZON,
  LANTERNS,
  lanternFlicker,
  MASTHEAD,
  mastSway,
  SEA,
  shipBob,
  WATERLINE,
  WAVE_PERIOD,
  waveDrift,
  waveRows,
  hashUnit,
  type MotionPlan,
  type WaveRow,
} from "./deck-ambient";
import { applyCrew, createCrew, crewFigures, stepCrew, type Figure } from "./deck-crew";
import { deckAnimator, type FrameScheduler, type MotionSignals } from "./deck-loop";
import type { DeckDrawing, DeckHost } from "./deck-mount";
import { DECK_PROPS, depthOf, type DeckScene } from "./deck-scene";

/** Marks the canvas with its renderer, so the live check can read it in the app's DevTools. */
export const DECK_CANVAS_ATTRIBUTE = "data-firstmate-deck";
/** Marks the canvas with the motion in force: `full`, `lite` or `still`. */
export const DECK_MOTION_ATTRIBUTE = "data-firstmate-deck-motion";

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

/** The deck's art as the mount hands it over: the decoded atlas image, and where everything is in it. */
export interface DeckArtImage {
  image: unknown;
  manifest: DeckArtManifest;
}

/** What the deck needs to decide when to move: a frame scheduler and the motion signals. */
export interface DeckMotionEnvironment {
  scheduler: FrameScheduler;
  signals: MotionSignals;
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

/** One texture per frame of the atlas, all on one `nearest`-sampled source, and crops made on demand. */
function atlasTextures(pixi: PixiModule, art: DeckArtImage) {
  const source = new pixi.ImageSource({ resource: art.image });
  source.scaleMode = "nearest";
  const made: PixiTexture[] = [];
  const frame = ([x, y, width, height]: Frame) => {
    const texture = new pixi.Texture({ source, frame: new pixi.Rectangle(x, y, width, height) });
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
  const crew = {
    base: new Map(Object.entries(manifest.crew.base).map(([pose, entry]) => [pose, frame(entry.frame)])),
    outfit: new Map(Object.entries(manifest.crew.outfit).map(([pose, entry]) => [pose, frame(entry.frame)])),
  };
  const props = new Map(Object.entries(manifest.props).map(([name, entry]) => [name, frame(entry.frame)]));
  const crops = new Map<string, PixiTexture>();
  return {
    hull,
    masthead,
    pieces,
    crew,
    props,
    /** A sailor's top `rows` rows: what shows of it on the hatch's ladder. */
    crop(outfit: SailorOutfit, pose: SailorPose, rows: number): PixiTexture {
      const key = `${outfit}:${pose}:${rows}`;
      let texture = crops.get(key);
      if (texture === undefined) {
        const [x, y, width] = manifest.crew[outfit][pose].frame;
        texture = frame([x, y, width, rows]);
        crops.set(key, texture);
      }
      return texture;
    },
    destroy() {
      for (const texture of made) texture.destroy();
      source.destroy();
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
 * The scale and offset that fit the deck in the screen with a small margin: whole device pixels per art
 * pixel once there is room for two or more, so the pixel art stays even; below that, the exact fit.
 */
export function fitDeck(screen: { width: number; height: number }, deck: { width: number; height: number }, resolution: number) {
  let scale = Math.min(screen.width / deck.width, screen.height / deck.height) * 0.96;
  if (scale * resolution >= 2) scale = Math.floor(scale * resolution) / resolution;
  const snap = (value: number) => Math.round(value * resolution) / resolution;
  return { scale, x: snap((screen.width - deck.width * scale) / 2), y: snap((screen.height - deck.height * scale) / 2) };
}

/** The gull, three frames, drawn flying right: `#` is the wing and body, `o` the darker wingtip. */
const GULL_FRAMES: readonly (readonly string[])[] = [
  ["o.....o", ".#...#.", "..###.."],
  [".......", "o#####o", "..###.."],
  [".......", "..###..", ".#...#.", "o.....o"],
];

function hexColour(colour: string): number {
  const match = /^#?([0-9a-f]{6})/i.exec(colour);
  return match === null ? 0xa1a5a4 : parseInt(match[1]!, 16);
}

/** One sailor's sprites: the state's mark under its feet and the figure itself. */
interface SailorSprites {
  root: PixiContainer;
  mark: PixiGraphics;
  sprite: PixiSprite;
  /** What the mark was last drawn as, so it is redrawn only when the state or the feed changes. */
  marked: string;
}

/** Starts Pixi on `host`, draws `scene` at `size`, and hands back what updates and tears it down. */
export async function startDeck(
  pixi: PixiModule,
  art: DeckArtImage,
  host: DeckHost,
  scene: DeckScene,
  size: { width: number; height: number },
  environment: DeckMotionEnvironment,
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
  const canvas = app.canvas as {
    style: Record<string, string>;
    setAttribute(name: string, value: string): void;
  };
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.imageRendering = "pixelated";
  canvas.setAttribute(DECK_CANVAS_ATTRIBUTE, app.renderer.name);
  host.appendChild(app.canvas);

  const { manifest } = art;
  const textures: Textures = atlasTextures(pixi, art);
  let current = scene;
  const crew = createCrew();

  const world = new pixi.Container();
  world.label = "world";
  app.stage.addChild(world);

  // The sea: the far water behind the hull from the horizon down, the near water in front of its waterline.
  const farSea = new pixi.Container();
  farSea.label = "sea:far";
  const nearSea = new pixi.Container();
  nearSea.label = "sea:near";
  let seaGraphics: Array<[PixiContainer, PixiGraphics]> = [];
  let seaRows: Array<{ row: WaveRow; graphics: PixiGraphics }> = [];
  let foam: PixiGraphics[] = [];
  let seaBounds = { left: 0, right: 0, bottom: 0 };

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
    const texture = textures.pieces.get(name);
    if (texture === undefined) continue;
    const sprite = new pixi.Sprite(texture);
    sprite.label = `piece:${name}`;
    sprite.position.set(piece.x, piece.y);
    sprite.zIndex = depthOf(piece.baseline, 1);
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
  const gulls = new pixi.Graphics();
  gulls.label = "gulls";
  world.addChild(farSea, ship, nearSea, gulls);

  /** The sea for the part of the world the screen shows, rebuilt only when that grows. */
  function buildSea(left: number, right: number, bottom: number): void {
    if (left >= seaBounds.left && right <= seaBounds.right && bottom <= seaBounds.bottom && seaRows.length > 0) return;
    seaBounds = { left: Math.floor(left) - 8, right: Math.ceil(right) + 8, bottom: Math.ceil(bottom) + 8 };
    for (const [parent, graphics] of seaGraphics) {
      parent.removeChild(graphics);
      graphics.destroy();
    }
    seaGraphics = [];
    const add = (parent: PixiContainer, graphics: PixiGraphics) => {
      parent.addChild(graphics);
      seaGraphics.push([parent, graphics]);
      return graphics;
    };
    const { left: l, right: r, bottom: b } = seaBounds;
    const width = r - l;
    add(farSea, new pixi.Graphics().rect(l, HORIZON, width, b - HORIZON).fill(SEA.deep).rect(l, HORIZON, width, 1).fill(SEA.crest));
    // The same water in front of the hull, so the waterline is the hull's edge and not a seam across the sea.
    add(nearSea, new pixi.Graphics().rect(l, WATERLINE, width, b - WATERLINE).fill(SEA.deep));
    seaRows = [];
    for (const row of [...waveRows(HORIZON, WATERLINE), ...waveRows(WATERLINE, b)]) {
      const graphics = new pixi.Graphics();
      for (let base = Math.floor(l / WAVE_PERIOD) * WAVE_PERIOD - WAVE_PERIOD * 2; base < r + WAVE_PERIOD; base += WAVE_PERIOD) {
        for (const dash of row.dashes) graphics.rect(base + dash.x, row.y, dash.length, 1).fill(dash.glint ? SEA.glint : SEA.crest);
      }
      add(row.y < WATERLINE ? farSea : nearSea, graphics);
      seaRows.push({ row, graphics });
    }
    // Foam where the near water meets the hull: two shapes, lapping.
    foam = [0, 1].map(function (shape) {
      const graphics = new pixi.Graphics();
      for (let x = 72; x <= 388; x += 1) {
        const lap = hashUnit(x * 7 + shape * 1013);
        if (lap > 0.3) graphics.rect(x, WATERLINE, 1, 1).fill(lap > 0.75 ? SEA.foamShade : SEA.foam);
        if (lap > 0.82) graphics.rect(x, WATERLINE + 1, 1, 1).fill(SEA.foamShade);
      }
      // A little spray off the bow and the stern.
      const spray = shape === 0 ? [[70, WATERLINE - 1], [67, WATERLINE], [391, WATERLINE]] : [[69, WATERLINE], [392, WATERLINE - 1], [394, WATERLINE]];
      for (const [x = 0, y = 0] of spray) graphics.rect(x, y, 1, 1).fill(SEA.foam);
      return add(nearSea, graphics);
    });
  }

  function sailorSprites(figure: Figure): SailorSprites {
    let sprites = sailors.get(figure.key);
    if (sprites === undefined) {
      const root = new pixi.Container();
      root.label = figure.key;
      const mark = new pixi.Graphics();
      const sprite = new pixi.Sprite(textures.crew[figure.outfit].get(figure.pose)!);
      root.addChild(mark, sprite);
      deck.addChild(root);
      sprites = { root, mark, sprite, marked: "" };
      sailors.set(figure.key, sprites);
    }
    return sprites;
  }

  function drawSailors(figures: readonly Figure[]): void {
    const present = new Set<string>();
    for (const figure of figures) {
      present.add(figure.key);
      const sprites = sailorSprites(figure);
      const standing = manifest.crew[figure.outfit][figure.pose];
      const height = standing.frame[3];
      const rows = Math.round(height * figure.reveal);
      sprites.root.visible = rows > 0;
      if (rows <= 0) continue;
      if (rows < height) {
        // Climbing the hatch's ladder: only the top of the sailor is out, its cut edge on the hatch.
        sprites.sprite.texture = textures.crop(figure.outfit, figure.pose, rows);
        sprites.sprite.anchor.set(standing.feet[0] / standing.frame[2], 1);
      } else {
        sprites.sprite.texture = textures.crew[figure.outfit].get(figure.pose)!;
        stand(sprites.sprite, standing);
      }
      sprites.sprite.scale.set(figure.flip ? -1 : 1, 1);
      sprites.sprite.tint = figure.stale ? 0x8a9096 : 0xffffff;
      sprites.sprite.alpha = figure.stale ? 0.6 : 1;
      const marked = `${figure.state}:${figure.stale ? "stale" : "live"}:${rows < height ? "hatch" : "deck"}`;
      if (sprites.marked !== marked) {
        sprites.mark.clear();
        const colour = hexColour(current.palette.states[figure.state]);
        if (rows < height) {
          // Nothing under the feet while still on the ladder.
        } else if (figure.stale) {
          // A lost feed: the last state's colour, hollow — greyed, never idle.
          sprites.mark.ellipse(0, 0, 6, 2).stroke({ color: colour, width: 1, alpha: 0.7 });
        } else {
          sprites.mark.ellipse(0, 0, 6, 2).fill({ color: colour, alpha: 0.9 });
        }
        sprites.marked = marked;
      }
      // The mark stays on the deck row; the figure above it rises and leans with its motion.
      sprites.root.position.set(figure.x, figure.row);
      sprites.sprite.position.set(0, figure.y - figure.row);
      sprites.root.zIndex = depthOf(figure.row, 0) + figure.x / 10000;
    }
    for (const [key, sprites] of [...sailors.entries()]) {
      if (present.has(key)) continue;
      deck.removeChild(sprites.root);
      sprites.root.destroy({ children: true });
      sailors.delete(key);
    }
  }

  function drawGulls(seconds: number): void {
    gulls.clear();
    for (const gull of gullsAt(seconds)) {
      const rows = GULL_FRAMES[gull.frame]!;
      rows.forEach(function (line, dy) {
        for (let dx = 0; dx < line.length; dx += 1) {
          const cell = line[gull.flip ? line.length - 1 - dx : dx];
          if (cell === "#") gulls.rect(gull.x + dx - 3, gull.y + dy, 1, 1).fill(0xf2f5f4);
          else if (cell === "o") gulls.rect(gull.x + dx - 3, gull.y + dy, 1, 1).fill(0x6c767c);
        }
      });
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
    for (const { row, graphics } of seaRows) graphics.position.set(plan.ambient ? waveDrift(row, seconds) - WAVE_PERIOD : -WAVE_PERIOD, 0);
    const lap = plan.ambient ? foamFrame(seconds) : 0;
    foam.forEach(function (graphics, shape) {
      graphics.visible = shape === lap;
    });
    for (const { lantern, glow, glass } of lanterns) {
      const level = moving ? lanternFlicker(seconds, lantern.seed) : 0.85;
      glow.alpha = 0.45 + 0.55 * level;
      glass.tint = level > 0.88 ? 0xffffff : level > 0.74 ? 0xf2dcb8 : 0xd8b890;
    }
    if (plan.ambient) drawGulls(seconds);
    else gulls.clear();
    drawSailors(crewFigures(crew, elapsedMs, { still: !moving }));
    canvas.setAttribute(DECK_MOTION_ATTRIBUTE, plan.level);
    app.render();
  }

  function fit(): void {
    const { scale, x, y } = fitDeck(app.screen, current, app.renderer.resolution);
    world.scale.set(scale);
    world.position.set(x, y);
    buildSea(-x / scale, (app.screen.width - x) / scale, (app.screen.height - y) / scale);
  }

  applyCrew(crew, scene.sailors, { snap: true });
  fit();
  const animator = deckAnimator({ scheduler: environment.scheduler, signals: environment.signals, software, size, frame: draw });

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
    resize(width, height) {
      if (width >= 1 && height >= 1) {
        app.renderer.resize(width, height);
        fit();
      }
      animator.resize(width, height);
      animator.invalidate();
    },
    destroy() {
      animator.destroy();
      app.destroy({ removeView: true }, { children: true });
      textures.destroy();
    },
  };
}
