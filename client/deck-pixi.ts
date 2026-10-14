/**
 * The ship deck drawn with PixiJS 8 on WebGL: a plain deck, and one sailor per live crewmate where its
 * state puts it. Placeholder art — shapes, no textures — because what this proves is the canvas in the
 * plugin, not the look.
 *
 * **Pixi is handed in, never imported.** The plugin's client bundle is one script that a phone's Hermes
 * must parse whole before any of it runs, and Pixi is written with `class` syntax that React Native
 * 0.81's `hermesc` refuses with its default flags (`docs/ship-deck-canvas/compile.mjs` checks).
 * So Pixi stays out of the bundle: the daemon serves its browser build (`vendor/pixi.min.js`) through
 * `firstmate.deck.engine`, and `client/deck-mount.ts` evaluates it in a web renderer and passes the
 * namespace here. `PixiModule` is the narrow shape of it this file uses; `client/ship-deck.test.ts` holds
 * it to Pixi's own types.
 *
 * Nothing animates, so the ticker never starts (`autoStart: false`): a frame is drawn when the scene or
 * the size changes, and the deck costs nothing between polls.
 */
import type { DeckScene } from "./deck-scene";
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
  addChildAt(child: PixiContainer, index: number): unknown;
  removeChild(...children: PixiContainer[]): unknown;
  destroy(options?: { children?: boolean }): void;
}

export interface PixiGraphics extends PixiContainer {
  poly(points: number[]): this;
  rect(x: number, y: number, width: number, height: number): this;
  circle(x: number, y: number, radius: number): this;
  moveTo(x: number, y: number): this;
  lineTo(x: number, y: number): this;
  fill(style?: Style): this;
  stroke(style?: Style): this;
}

export interface PixiApplication {
  init(options: {
    preference: "webgl";
    width: number;
    height: number;
    background: string;
    antialias: boolean;
    autoDensity: boolean;
    resolution: number;
    autoStart: boolean;
    sharedTicker: boolean;
  }): Promise<void>;
  readonly canvas: unknown;
  readonly renderer: {
    readonly name: string;
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
}

function drawDeck(pixi: PixiModule, scene: DeckScene): PixiGraphics {
  const { palette } = scene;
  const g = new pixi.Graphics();
  // The hull, stern on the left and bow to the right, with the deck inset on it.
  g.poly([60, 70, 640, 60, 800, 92, 910, 210, 800, 328, 640, 360, 60, 350, 36, 210]).fill(palette.hull);
  g.poly([80, 92, 636, 84, 786, 112, 876, 210, 786, 308, 636, 336, 80, 328, 62, 210])
    .fill(palette.deck)
    .stroke({ width: 6, color: palette.rail });
  for (let y = 112; y <= 312; y += 25) g.moveTo(84, y).lineTo(760, y);
  g.stroke({ width: 1, color: palette.plank });
  // The quarterdeck at the stern, with the wheel.
  g.rect(80, 104, 180, 212).fill({ color: palette.rail, alpha: 0.18 }).stroke({ width: 2, color: palette.rail });
  g.circle(112, 210, 24).stroke({ width: 4, color: palette.rail });
  for (let spoke = 0; spoke < 8; spoke += 1) {
    const angle = (spoke * Math.PI) / 4;
    g.moveTo(112, 210).lineTo(112 + Math.cos(angle) * 32, 210 + Math.sin(angle) * 32);
  }
  g.stroke({ width: 3, color: palette.rail });
  // The mast, its rigging run out to the bow, and the bowsprit.
  g.moveTo(460, 195).lineTo(876, 210).moveTo(460, 195).lineTo(786, 112).moveTo(460, 195).lineTo(786, 308);
  g.moveTo(910, 210).lineTo(950, 206);
  g.stroke({ width: 2, color: palette.rail });
  g.circle(460, 195, 15).fill(palette.rail);
  return g;
}

function drawSailors(pixi: PixiModule, scene: DeckScene): PixiContainer {
  const crew = new pixi.Container();
  for (const sailor of scene.sailors) {
    const color = scene.palette.states[sailor.state];
    const figure = new pixi.Graphics();
    figure.label = sailor.key;
    figure.circle(0, 4, 13).fill(color).stroke({ width: 2, color: scene.palette.rail });
    figure.circle(0, -12, 7).fill(scene.palette.mark).stroke({ width: 2, color: scene.palette.rail });
    figure.position.set(sailor.x, sailor.y);
    crew.addChild(figure);
  }
  return crew;
}

/** Starts Pixi on `host`, draws `scene` at `size`, and hands back what updates and tears it down. */
export async function startDeck(
  pixi: PixiModule,
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
    antialias: true,
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
  canvas.setAttribute(DECK_CANVAS_ATTRIBUTE, app.renderer.name);
  host.appendChild(app.canvas);

  const world = new pixi.Container();
  app.stage.addChild(world);
  let current = scene;
  let deck = drawDeck(pixi, scene);
  let crew = drawSailors(pixi, scene);
  world.addChild(deck, crew);

  function fit(): void {
    const scale = Math.min(app.screen.width / current.width, app.screen.height / current.height);
    world.scale.set(scale);
    world.position.set((app.screen.width - current.width * scale) / 2, (app.screen.height - current.height * scale) / 2);
    app.render();
  }
  fit();

  return {
    renderer: app.renderer.name,
    update(next) {
      // A theme change redraws the deck; a poll redraws only the crew.
      if (JSON.stringify(next.palette) !== JSON.stringify(current.palette)) {
        app.renderer.background.color = next.palette.sea;
        world.removeChild(deck);
        deck.destroy();
        deck = drawDeck(pixi, next);
        world.addChildAt(deck, 0);
      }
      world.removeChild(crew);
      crew.destroy({ children: true });
      crew = drawSailors(pixi, next);
      world.addChild(crew);
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
    },
  };
}
