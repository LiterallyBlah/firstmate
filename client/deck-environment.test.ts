/**
 * The generated environment on the deck, through `startDeck` itself with a stand-in for Pixi that keeps
 * the scene graph: the depth order (sky behind, sea behind and at the hull, ship and crew in front), the
 * sky following an injected clock — once a minute on a still deck — reduced motion's still sea and empty
 * sky, and the plain sea the deck falls back to without its environment. Whether WebGL paints it is the
 * browser harness's (`docs/ship-deck-environment/`).
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import type { PluginTheme } from "@getpaseo/plugin";
import { describe, expect, it } from "vitest";

import { DeckArtManifestSchema, DeckEnvironmentManifestSchema, environmentImagePaths } from "../shared/ship-deck";
import { HORIZON, WATERLINE } from "./deck-ambient";
import { FOAM_SPAN, FOAM_TOP, type DeckEnvironmentImages } from "./deck-environment";
import type { FrameScheduler, MotionSignals } from "./deck-loop";
import { DECK_MOTION_ATTRIBUTE, DECK_SKY_ATTRIBUTE, startDeck, type DeckMotionEnvironment, type PixiModule } from "./deck-pixi";
import { SKY_REFRESH_MS } from "./deck-sky";
import { deckScene } from "./deck-scene";

const theme = {
  colors: {
    surface0: "#181B1A",
    surface1: "#1E2120",
    surface2: "#272A29",
    border: "#252B2A",
    foreground: "#fafafa",
    foregroundMuted: "#A1A5A4",
    accent: "#20744A",
    accentForeground: "#ffffff",
    statusSuccess: "#6cb17b",
    statusWarning: "#c09664",
    statusDanger: "#d8847b",
  },
} as unknown as PluginTheme;

const deckManifest = DeckArtManifestSchema.parse(JSON.parse(readFileSync(new URL("../art/ship-deck/deck.json", import.meta.url), "utf8")));
const environmentManifest = DeckEnvironmentManifestSchema.parse(
  JSON.parse(readFileSync(new URL("../art/ship-deck/environment.json", import.meta.url), "utf8")),
);

// A stand-in for the part of Pixi the deck uses, keeping the scene graph so the tests can read it.
class FakePoint {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
  set(x: number, y: number = x): void {
    this.x = x;
    this.y = y;
  }
}
class FakeContainer {
  label = "";
  position = new FakePoint();
  scale = new FakePoint(1, 1);
  zIndex = 0;
  sortableChildren = false;
  visible = true;
  alpha = 1;
  tint = 0xffffff;
  children: FakeContainer[] = [];
  destroyed = false;
  addChild(...children: FakeContainer[]): void {
    this.children.push(...children);
  }
  removeChild(...children: FakeContainer[]): void {
    this.children = this.children.filter((child) => !children.includes(child));
  }
  destroy(): void {
    this.destroyed = true;
  }
}
class FakeGraphics extends FakeContainer {
  shapes: unknown[][] = [];
  clear(): this {
    this.shapes = [];
    return this;
  }
  rect(...args: number[]): this {
    this.shapes.push(["rect", ...args]);
    return this;
  }
  circle(): this {
    return this;
  }
  ellipse(): this {
    return this;
  }
  fill(style?: unknown): this {
    this.shapes.at(-1)?.push(style);
    return this;
  }
  stroke(): this {
    return this;
  }
}
class FakeSource {
  scaleMode = "linear";
  destroyed = false;
  resource: unknown;
  constructor(options: { resource: unknown }) {
    this.resource = options.resource;
  }
  destroy(): void {
    this.destroyed = true;
  }
}
class FakeRectangle {
  constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number,
  ) {}
}
class FakeTexture {
  source: FakeSource;
  frame: FakeRectangle;
  destroyed = false;
  constructor(options: { source: FakeSource; frame: FakeRectangle }) {
    this.source = options.source;
    this.frame = options.frame;
  }
  destroy(): void {
    this.destroyed = true;
  }
}
class FakeSprite extends FakeContainer {
  anchor = new FakePoint();
  constructor(public texture: FakeTexture) {
    super();
  }
}
class FakeCanvas {
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}
let renders = 0;
/** The application the deck made last. */
let lastApp: FakeApplication | null = null;
class FakeApplication {
  stage = new FakeContainer();
  canvas = new FakeCanvas();
  screen = { width: 0, height: 0 };
  renderer = {
    name: "webgl",
    resolution: 1,
    background: { color: "" as string | number | object },
    resize: (width: number, height: number) => {
      this.screen = { width, height };
    },
  };
  async init(options: { width: number; height: number }): Promise<void> {
    this.screen = { width: options.width, height: options.height };
    lastApp = this;
  }
  render(): void {
    renders += 1;
  }
  destroy(): void {}
}
const pixi = {
  VERSION: "8.22.0",
  Application: FakeApplication,
  Container: FakeContainer,
  Graphics: FakeGraphics,
  Sprite: FakeSprite,
  ImageSource: FakeSource,
  Texture: FakeTexture,
  Rectangle: FakeRectangle,
} as unknown as PixiModule;

/** The environment as the mount decodes it: each image a token naming its path. */
const environment: DeckEnvironmentImages = {
  manifest: environmentManifest,
  images: new Map(environmentImagePaths(environmentManifest).map((path) => [path, { image: path }])),
};

/** A hand-wound world: the clock, the frames, the minute timer, the motion signals. */
function world(options: { reducedMotion?: boolean; hidden?: boolean; now: Date }) {
  const state = { now: options.now, reducedMotion: options.reducedMotion ?? false, hidden: options.hidden ?? false };
  const frames = new Map<number, (now: number) => void>();
  let handle = 0;
  const scheduler: FrameScheduler = {
    request(callback) {
      handle += 1;
      frames.set(handle, callback);
      return handle;
    },
    cancel(id) {
      frames.delete(id);
    },
  };
  const timers: Array<{ ms: number; run: () => void; stopped: boolean }> = [];
  const signals: MotionSignals = {
    reducedMotion: () => state.reducedMotion,
    documentHidden: () => state.hidden,
    subscribe: () => () => {},
  };
  const motion: DeckMotionEnvironment = {
    scheduler,
    signals,
    clock: () => state.now,
    every(ms, run) {
      const timer = { ms, run, stopped: false };
      timers.push(timer);
      return () => {
        timer.stopped = true;
      };
    },
  };
  let clock = 0;
  return {
    state,
    motion,
    timers,
    /** Runs the frames due, `ms` on. */
    advance(ms: number) {
      clock += ms;
      const due = [...frames.entries()];
      frames.clear();
      for (const [, callback] of due) callback(clock);
    },
    pending: () => frames.size,
  };
}

async function start(art: DeckEnvironmentImages | null, options: { reducedMotion?: boolean; hidden?: boolean; now: Date }) {
  const w = world(options);
  const host = { appendChild() {}, clientWidth: 800, clientHeight: 400 };
  const drawing = await startDeck(
    pixi,
    { image: { atlas: true }, manifest: deckManifest, environment: art },
    host,
    deckScene([], theme),
    { width: 800, height: 400 },
    w.motion,
  );
  if (lastApp === null) throw new Error("no application");
  return { ...w, drawing, app: lastApp };
}

function byLabel(root: FakeContainer, label: string): FakeContainer[] {
  const found: FakeContainer[] = [];
  const walk = (node: FakeContainer) => {
    if (node.label === label) found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
}
const one = (root: FakeContainer, label: string) => {
  const [node] = byLabel(root, label);
  if (node === undefined) throw new Error(`no ${label}`);
  return node;
};
const texturePath = (sprite: FakeContainer) => ((sprite as FakeSprite).texture.source.resource as { image: string }).image;

describe("the generated environment on the deck", () => {
  it("draws back to front: sky, stars, gull, far sea; then the ship and its crew; then the near sea and the foam", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0) });
    deck.advance(16);
    const worldLayer = one(deck.app.stage, "world");
    expect(worldLayer.children.map((child) => child.label)).toEqual(["scenery:back", "ship", "scenery:front"]);
    const back = one(deck.app.stage, "scenery:back");
    expect(back.children.map((child) => child.label)).toEqual(["sky:under", "sky:over", "sky:stars", "gull", "gull", "sea:far"]);
    expect(one(deck.app.stage, "scenery:front").children.map((child) => child.label)).toEqual(["sea:near", "foam"]);
    // The crew's deck is inside the ship, so every sailor is in front of the sky and the far sea.
    expect(one(one(deck.app.stage, "ship"), "deck")).toBeDefined();

    // The far sea from the horizon down; the near sea from the waterline, cut to line up with it.
    const far = one(back, "sea:far").children as FakeSprite[];
    const near = one(deck.app.stage, "sea:near").children as FakeSprite[];
    expect(Math.min(...far.map((tile) => tile.position.y))).toBe(HORIZON);
    expect(Math.min(...near.map((tile) => tile.position.y))).toBe(WATERLINE);
    const cut = near.find((tile) => tile.position.y === WATERLINE)!;
    expect(cut.texture.frame.y).toBe(WATERLINE - HORIZON);
    expect(far.every((tile) => texturePath(tile) === "sea/water-tile.png")).toBe(true);
    // Every tile sampled nearest, as pixel art.
    expect(far.every((tile) => tile.texture.source.scaleMode === "nearest")).toBe(true);

    // The foam only across the hull's waterline.
    const foam = (one(deck.app.stage, "foam").children as FakeSprite[]).filter((piece) => piece.visible);
    expect(Math.min(...foam.map((piece) => piece.position.x))).toBe(FOAM_SPAN.left);
    expect(Math.max(...foam.map((piece) => piece.position.x + piece.texture.frame.width))).toBe(FOAM_SPAN.right);
    expect(foam.every((piece) => piece.position.y === FOAM_TOP)).toBe(true);
    deck.drawing.destroy();
  });

  it("shows the sky of the local time of day, and moves with the clock while the deck runs", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 18, 30) });
    deck.advance(16);
    expect(deck.app.canvas.attributes.get(DECK_SKY_ATTRIBUTE)).toBe("dusk");
    expect(texturePath(one(deck.app.stage, "sky:under"))).toBe("sky/dusk.png");
    expect(one(deck.app.stage, "sky:stars").visible).toBe(false);
    deck.state.now = new Date(2026, 9, 14, 23, 0);
    deck.advance(40);
    expect(deck.app.canvas.attributes.get(DECK_SKY_ATTRIBUTE)).toBe("night");
    const stars = one(deck.app.stage, "sky:stars");
    expect([stars.visible, stars.alpha]).toEqual([true, 1]);
    deck.state.now = new Date(2026, 9, 14, 5, 0);
    deck.advance(40);
    const over = one(deck.app.stage, "sky:over");
    expect([texturePath(one(deck.app.stage, "sky:under")), texturePath(over)]).toEqual(["sky/night.png", "sky/dawn.png"]);
    expect(over.alpha).toBeGreaterThan(0.5);
    expect(over.alpha).toBeLessThan(1);
    deck.drawing.destroy();
  });

  it("scrolls the sea and flies a gull by day, on the scene clock", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0) });
    deck.advance(0);
    const far = one(deck.app.stage, "sea:far");
    const positions = new Set<number>();
    let gullSeen = false;
    // A minute of frames: the water drifts whole pixels, and in a minute a gull has crossed.
    for (let frame = 0; frame < 1800; frame += 1) {
      deck.advance(34);
      positions.add(far.position.x);
      if (byLabel(deck.app.stage, "gull").some((gull) => gull.visible)) gullSeen = true;
    }
    expect(positions.size).toBeGreaterThan(100);
    expect([...positions].every((x) => Number.isInteger(x) && x >= 0 && x < 256)).toBe(true);
    expect(one(deck.app.stage, "sea:near").position.x).toBe(far.position.x);
    expect(gullSeen).toBe(true);
    deck.drawing.destroy();
  });

  it("flies no gull at night", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 23, 0) });
    for (let frame = 0; frame < 1800; frame += 1) {
      deck.advance(34);
      expect(byLabel(deck.app.stage, "gull").some((gull) => gull.visible)).toBe(false);
    }
    deck.drawing.destroy();
  });

  it("under reduced motion, keeps a still sea and an empty sky, still shows the hour's sky, and redraws it once a minute", async () => {
    renders = 0;
    const deck = await start(environment, { reducedMotion: true, now: new Date(2026, 9, 14, 12, 0) });
    expect(deck.pending()).toBe(0);
    expect(deck.app.canvas.attributes.get(DECK_MOTION_ATTRIBUTE)).toBe("still");
    expect(deck.app.canvas.attributes.get(DECK_SKY_ATTRIBUTE)).toBe("midday");
    expect(one(deck.app.stage, "sea:far").position.x).toBe(0);
    expect(byLabel(deck.app.stage, "gull").some((gull) => gull.visible)).toBe(false);
    const drawn = renders;
    // The minute's refresh: one still frame, with the new hour's sky, and no loop started.
    expect(deck.timers.map((timer) => timer.ms)).toEqual([SKY_REFRESH_MS]);
    deck.state.now = new Date(2026, 9, 14, 21, 30);
    deck.timers[0]!.run();
    expect(renders).toBe(drawn + 1);
    expect(deck.pending()).toBe(0);
    expect(deck.app.canvas.attributes.get(DECK_SKY_ATTRIBUTE)).toBe("night");
    expect(one(deck.app.stage, "sky:stars").visible).toBe(true);
    expect(one(deck.app.stage, "sea:far").position.x).toBe(0);
    // Hidden, the minute passes without a draw.
    deck.state.hidden = true;
    deck.timers[0]!.run();
    expect(renders).toBe(drawn + 1);
    deck.drawing.destroy();
    expect(deck.timers[0]!.stopped).toBe(true);
  });

  it("the minute's refresh draws nothing extra while the loop runs", async () => {
    renders = 0;
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0) });
    const drawn = renders;
    deck.timers[0]!.run();
    expect(renders).toBe(drawn);
    deck.drawing.destroy();
  });

  it("without its environment, draws a plain sea at the horizon and the waterline, and no sky or gull", async () => {
    const deck = await start(null, { now: new Date(2026, 9, 14, 12, 0) });
    deck.advance(16);
    expect(one(deck.app.stage, "world").children.map((child) => child.label)).toEqual(["scenery:back", "ship", "scenery:front"]);
    expect(byLabel(deck.app.stage, "sky:under")).toEqual([]);
    expect(byLabel(deck.app.stage, "gull")).toEqual([]);
    expect(deck.app.canvas.attributes.get(DECK_SKY_ATTRIBUTE)).toBe("none");
    const far = one(deck.app.stage, "sea:far") as FakeGraphics;
    const near = one(deck.app.stage, "sea:near") as FakeGraphics;
    expect(far.shapes[0]?.[2]).toBe(HORIZON);
    expect(near.shapes[0]?.[2]).toBe(WATERLINE);
    deck.drawing.destroy();
  });

  it("falls back the same way when the environment is missing an image it names", async () => {
    const partial: DeckEnvironmentImages = { manifest: environmentManifest, images: new Map([...environment.images].filter(([path]) => path !== "sky/dawn.png")) };
    const deck = await start(partial, { now: new Date(2026, 9, 14, 12, 0) });
    deck.advance(16);
    expect(deck.app.canvas.attributes.get(DECK_SKY_ATTRIBUTE)).toBe("none");
    deck.drawing.destroy();
  });

  it("lets go of the sky's textures and sources when torn down, and stops its minute timer", async () => {
    const made: FakeTexture[] = [];
    const sources: FakeSource[] = [];
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0) });
    for (const sprite of [...byLabel(deck.app.stage, "sky:under"), ...byLabel(deck.app.stage, "sky:stars")]) {
      made.push((sprite as FakeSprite).texture);
      sources.push((sprite as FakeSprite).texture.source);
    }
    deck.drawing.destroy();
    expect(deck.timers[0]!.stopped).toBe(true);
    expect(made.every((texture) => texture.destroyed)).toBe(true);
    expect(sources.every((source) => source.destroyed)).toBe(true);
  });
});
