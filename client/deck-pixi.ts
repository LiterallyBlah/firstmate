/**
 * The ship deck drawn with PixiJS 8 on WebGL: hull C's deck from the generated art, one sailor sprite per
 * live crewmate where its state puts it, a few props, and the hull's depth pieces drawn back over any
 * sailor standing behind them (`deckLayers` in `client/deck-scene.ts` decides the order).
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
 * It is pixel art, so it is sampled `nearest`, positions are rounded, and the deck is scaled by whole
 * device pixels once it is at least twice its size, so every art pixel is the same size on screen.
 *
 * Nothing animates, so the ticker never starts (`autoStart: false`): a frame is drawn when the scene or
 * the size changes, and the deck costs nothing between polls.
 */
import type { DeckArtManifest } from "../shared/ship-deck";
import { deckLayers, type DeckLayer, type DeckScene } from "./deck-scene";
import type { DeckDrawing, DeckHost } from "./deck-mount";

/** Marks the canvas with its renderer, so the live check can read it in the app's DevTools. */
export const DECK_CANVAS_ATTRIBUTE = "data-firstmate-deck";

type Style = string | { color?: string; width?: number; alpha?: number };

export interface PixiPoint {
  set(x: number, y?: number): void;
}

export interface PixiContainer {
  label: string;
  position: PixiPoint;
  scale: PixiPoint;
  addChild(...children: PixiContainer[]): unknown;
  removeChild(...children: PixiContainer[]): unknown;
  destroy(options?: { children?: boolean }): void;
}

export interface PixiGraphics extends PixiContainer {
  ellipse(x: number, y: number, halfWidth: number, halfHeight: number): this;
  fill(style?: Style): this;
}

export interface PixiSprite extends PixiContainer {
  anchor: PixiPoint;
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

/** One texture per frame of the atlas, all on one `nearest`-sampled source. */
function atlasTextures(pixi: PixiModule, art: DeckArtImage) {
  const source = new pixi.ImageSource({ resource: art.image });
  source.scaleMode = "nearest";
  const made: PixiTexture[] = [];
  const frame = ([x, y, width, height]: readonly [number, number, number, number]) => {
    const texture = new pixi.Texture({ source, frame: new pixi.Rectangle(x, y, width, height) });
    made.push(texture);
    return texture;
  };
  const { manifest } = art;
  const ship = frame(manifest.ship.frame);
  const pieces = new Map(Object.entries(manifest.pieces).map(([name, piece]) => [name, frame(piece.frame)]));
  const crew = {
    base: new Map(Object.entries(manifest.crew.base).map(([pose, entry]) => [pose, frame(entry.frame)])),
    outfit: new Map(Object.entries(manifest.crew.outfit).map(([pose, entry]) => [pose, frame(entry.frame)])),
  };
  const props = new Map(Object.entries(manifest.props).map(([name, entry]) => [name, frame(entry.frame)]));
  return {
    ship,
    pieces,
    crew,
    props,
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

function drawLayer(pixi: PixiModule, art: DeckArtImage, textures: Textures, scene: DeckScene, layer: DeckLayer): PixiContainer | null {
  const { manifest } = art;
  switch (layer.kind) {
    case "ship": {
      const sprite = new pixi.Sprite(textures.ship);
      sprite.label = "ship";
      return sprite;
    }
    case "piece": {
      const texture = textures.pieces.get(layer.name);
      const piece = manifest.pieces[layer.name];
      if (texture === undefined || piece === undefined) return null;
      const sprite = new pixi.Sprite(texture);
      sprite.label = `piece:${layer.name}`;
      sprite.position.set(piece.x, piece.y);
      return sprite;
    }
    case "prop": {
      const texture = textures.props.get(layer.name);
      if (texture === undefined) return null;
      const sprite = new pixi.Sprite(texture);
      sprite.label = `prop:${layer.name}`;
      stand(sprite, manifest.props[layer.name]);
      sprite.position.set(layer.x, layer.y);
      return sprite;
    }
    case "sailor": {
      const { sailor } = layer;
      const texture = textures.crew[sailor.outfit].get(sailor.pose);
      if (texture === undefined) return null;
      const figure = new pixi.Container();
      figure.label = sailor.key;
      figure.position.set(sailor.x, sailor.y);
      // The state's colour under the feet: the legend below the canvas says which is which.
      const mark = new pixi.Graphics().ellipse(0, 0, 6, 2).fill({ color: scene.palette.states[sailor.state], alpha: 0.9 });
      const sprite = new pixi.Sprite(texture);
      stand(sprite, manifest.crew[sailor.outfit][sailor.pose]);
      if (sailor.flip) sprite.scale.set(-1, 1);
      figure.addChild(mark, sprite);
      return figure;
    }
  }
}

function drawDeck(pixi: PixiModule, art: DeckArtImage, textures: Textures, scene: DeckScene): PixiContainer {
  const deck = new pixi.Container();
  deck.label = "deck";
  for (const layer of deckLayers(scene, art.manifest.pieces)) {
    const drawn = drawLayer(pixi, art, textures, scene, layer);
    if (drawn !== null) deck.addChild(drawn);
  }
  return deck;
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

/** Starts Pixi on `host`, draws `scene` at `size`, and hands back what updates and tears it down. */
export async function startDeck(
  pixi: PixiModule,
  art: DeckArtImage,
  host: DeckHost,
  scene: DeckScene,
  size: { width: number; height: number },
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

  const textures = atlasTextures(pixi, art);
  const world = new pixi.Container();
  app.stage.addChild(world);
  let current = scene;
  let deck = drawDeck(pixi, art, textures, scene);
  world.addChild(deck);

  function fit(): void {
    const { scale, x, y } = fitDeck(app.screen, current, app.renderer.resolution);
    world.scale.set(scale);
    world.position.set(x, y);
    app.render();
  }
  fit();

  return {
    renderer: app.renderer.name,
    update(next) {
      if (next.palette.sea !== current.palette.sea) app.renderer.background.color = next.palette.sea;
      // A poll rebuilds the deck's sprites from the same textures: a few dozen at most.
      world.removeChild(deck);
      deck.destroy({ children: true });
      deck = drawDeck(pixi, art, textures, next);
      world.addChild(deck);
      current = next;
      fit();
    },
    resize(width, height) {
      if (width < 1 || height < 1) return;
      app.renderer.resize(width, height);
      fit();
    },
    destroy() {
      app.destroy({ removeView: true }, { children: true });
      textures.destroy();
    },
  };
}
