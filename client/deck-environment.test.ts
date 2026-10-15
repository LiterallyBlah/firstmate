/**
 * The generated environment on the deck, through `startDeck` itself with a stand-in for Pixi that keeps
 * the scene graph: the depth order (sky behind, sea behind and at the hull, ship and crew in front), the
 * sky following an injected clock — once a minute on a still deck — reduced motion's still sea and empty
 * sky, and the plain sea the deck falls back to without its environment. Then the extras: the tall mast and
 * its sail, the crew's looks, the at-ease sailor's breath, and the wake. Then the camera closing in on a
 * focused sailor: the zoom over the deck's clock, the veil and the spotlight, a click read through the camera,
 * the snap under reduced motion, and a resize while focused. And the weather, livelier as more of the crew works. Whether WebGL paints it is the browser
 * harnesses' (`docs/ship-deck-environment/`, `docs/ship-deck-tweaks/`, `docs/ship-deck-focus/`).
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import type { PluginTheme } from "@getpaseo/plugin";
import { describe, expect, it } from "vitest";

import { DeckArtManifestSchema, DeckEnvironmentManifestSchema, DeckExtrasManifestSchema, environmentImagePaths, extrasImagePaths } from "../shared/ship-deck";
import { HORIZON, WATERLINE } from "./deck-ambient";
import { BUSY_CREW, shade, STORM_SHADE } from "./deck-atmosphere";
import { cloudPeriod } from "./deck-clouds";
import { createScenery, FOAM_SPAN, FOAM_TOP, type DeckEnvironmentImages } from "./deck-environment";
import { drawnWater } from "./deck-water";
import { ASK_PAPER, askPixels } from "./deck-badges";
import { FOCUS_MS, FOCUS_VEIL_ALPHA, focusLayout } from "./deck-camera";
import { BREATH_ROWS } from "./deck-crew";
import { toCanvas } from "./deck-hover";
import type { DeckExtrasImages } from "./deck-extras";
import type { DeckHover } from "./deck-hover";
import type { FrameScheduler, MotionSignals } from "./deck-loop";
import { DECK_MOTION_ATTRIBUTE, DECK_SKY_ATTRIBUTE, DECK_WEATHER_ATTRIBUTE, deckBox, fitDeck, startDeck, type DeckMotionEnvironment, type PixiModule } from "./deck-pixi";
import { SKY_REFRESH_MS } from "./deck-sky";
import { deckScene, depthOf, type DeckScene, type DeckSailor, type DeckState } from "./deck-scene";

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
  listeners = new Map<string, (event: { offsetX: number; offsetY: number; pointerType?: string }) => void>();
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  addEventListener(type: string, listener: (event: { offsetX: number; offsetY: number }) => void): void {
    this.listeners.set(type, listener);
  }
  removeEventListener(type: string): void {
    this.listeners.delete(type);
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

async function start(
  art: DeckEnvironmentImages | null,
  options: {
    reducedMotion?: boolean;
    hidden?: boolean;
    now: Date;
    extras?: DeckExtrasImages | null;
    scene?: DeckScene;
    onHover?: (hover: DeckHover | null) => void;
    onSelect?: (key: string | null) => void;
  },
) {
  const w = world(options);
  const host = { appendChild() {}, clientWidth: 800, clientHeight: 400 };
  const drawing = await startDeck(
    pixi,
    { image: { atlas: true }, manifest: deckManifest, environment: art, extras: options.extras ?? null },
    host,
    options.scene ?? deckScene([], theme),
    { width: 800, height: 400 },
    w.motion,
    options.onHover,
    options.onSelect,
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
    expect(worldLayer.children.map((child) => child.label)).toEqual(["scenery:back", "ship", "scenery:front", "overboard", "veil", "spot"]);
    // Nobody focused: no veil, an empty spotlight.
    expect(one(worldLayer, "veil").visible).toBe(false);
    expect(one(worldLayer, "spot").children).toHaveLength(0);
    const back = one(deck.app.stage, "scenery:back");
    expect(back.children.map((child) => child.label)).toEqual(["sky:under", "sky:over", "sky:stars", "gull", "gull", "sea:far"]);
    expect(one(deck.app.stage, "scenery:front").children.map((child) => child.label)).toEqual(["sea:near", "wake", "foam"]);
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
    expect(one(deck.app.stage, "world").children.map((child) => child.label)).toEqual(["scenery:back", "ship", "scenery:front", "overboard", "veil", "spot"]);
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

const extrasManifest = DeckExtrasManifestSchema.parse(JSON.parse(readFileSync(new URL("../art/ship-deck/extras.json", import.meta.url), "utf8")));
/** The extras as the mount decodes them: each image a token naming its path. */
const extras: DeckExtrasImages = {
  manifest: extrasManifest,
  images: new Map(extrasImagePaths(extrasManifest).map((path) => [path, { image: path }])),
};
/** The extras without the tall mast's image: the hull's own short rig, as before it. */
const shortRig: DeckExtrasImages = { manifest: extrasManifest, images: new Map([...extras.images].filter(([path]) => path !== "mast/tall-mast.png")) };

/** Two crewmates working: the weather the art's own timing was made for (`client/deck-atmosphere.ts`). */
function twoWorking(): DeckScene {
  return crewScene([
    ["one", "working"],
    ["two", "working"],
  ]);
}

function crewScene(sailors: Array<[string, DeckState]>): DeckScene {
  const scene = deckScene([], theme);
  return {
    ...scene,
    sailors: sailors.map(
      ([key, state]): DeckSailor => ({
        key,
        label: key,
        state,
        identity: `agent-${key}`,
        stale: false,
        caption: { title: key, status: state, project: null, host: "This machine", line: null, stale: null },
      }),
    ),
  };
}

const sailorSprites = (stage: FakeContainer, key: string) => {
  const root = one(stage, key);
  return { root, sprite: root.children[1] as FakeSprite, upper: one(root, "breath") as FakeSprite };
};

describe("the sail, the crew's looks and the wake on the deck", () => {
  it("stands the tall mast in the short rig's place, the sail higher on it and its own lower rows the mast's depth piece", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras });
    deck.advance(16);
    const ship = one(deck.app.stage, "ship");
    expect(ship.children.map((child) => child.label)).toEqual(["hull:0", "hull:1", "hull:2", "mast", "masthead", "sail", "deck"]);
    // The hull's short rig — its crow's nest, upper mast and stays — is not drawn: the slices go round it.
    const [cutX, , cutWidth, cutHeight] = extrasManifest.mast!.clears;
    const slices = ["hull:0", "hull:1", "hull:2"].map((label) => one(ship, label) as FakeSprite);
    expect(slices.map((slice) => [slice.position.x, slice.position.y, slice.texture.frame.width, slice.texture.frame.height])).toEqual([
      [0, 0, cutX, 161],
      [cutX, cutHeight, cutWidth, 161 - cutHeight],
      [cutX + cutWidth, 0, 426 - cutX - cutWidth, 161],
    ]);
    // The tall mast in two: its crow's nest and topmast, which sway, and the rest down to its foot.
    const head = one(ship, "masthead") as FakeSprite;
    const shaft = one(ship, "mast") as FakeSprite;
    expect([texturePath(head), texturePath(shaft)]).toEqual(["mast/tall-mast.png", "mast/tall-mast.png"]);
    expect([head.position.y, head.texture.frame.y, head.texture.frame.height]).toEqual([-80, 0, 52]);
    expect(Math.abs(head.position.x - 187)).toBeLessThanOrEqual(1);
    expect([shaft.position.x, shaft.position.y, shaft.texture.frame.y, shaft.texture.frame.height]).toEqual([187, -28, 52, 140]);
    // The taller sail on it, at its yard's lashing point, one 114 × 84 state of its strip.
    const sail = one(ship, "sail") as FakeSprite;
    expect([sail.position.x, sail.position.y]).toEqual([154, -15]);
    expect(texturePath(sail)).toBe("sails/main-sail.png");
    expect([sail.texture.frame.width, sail.texture.frame.height]).toEqual([114, 84]);
    // Its rows below the sail's hem, on the mast's row, stand in for the mast piece: never over the cloth.
    expect(byLabel(deck.app.stage, "piece:mast")).toEqual([]);
    const depth = one(deck.app.stage, "piece:mast:tall") as FakeSprite;
    expect(texturePath(depth)).toBe("mast/tall-mast.png");
    expect([depth.position.x, depth.position.y, depth.zIndex]).toEqual([187, 69, depthOf(110, 1)]);
    expect([depth.texture.frame.y, depth.texture.frame.height]).toEqual([149, 43]);
    expect(sail.position.y + sail.texture.frame.height).toBe(depth.position.y);
    expect(byLabel(deck.app.stage, "piece:near")).toHaveLength(1);
    deck.drawing.destroy();
  });

  it("sways the tall mast's crow's nest a pixel each way and holds its shaft and foot still", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras });
    deck.advance(0);
    const head = one(deck.app.stage, "masthead") as FakeSprite;
    const shaft = one(deck.app.stage, "mast") as FakeSprite;
    const sways = new Set<number>();
    for (let frame = 0; frame < 300; frame += 1) {
      deck.advance(34);
      sways.add(head.position.x - 187);
      expect([shaft.position.x, shaft.position.y, head.position.y]).toEqual([187, -28, -80]);
    }
    expect(sways).toEqual(new Set([-1, 0, 1]));
    deck.drawing.destroy();
  });

  it("without the tall mast, draws the hull's short rig bare: no sail fitted to a mast that is not there", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: shortRig });
    deck.advance(16);
    const ship = one(deck.app.stage, "ship");
    expect(ship.children.map((child) => child.label)).toEqual(["hull:0", "hull:1", "hull:2", "masthead", "deck"]);
    const masthead = one(ship, "masthead") as FakeSprite;
    expect(Math.abs(masthead.position.x - 188)).toBeLessThanOrEqual(1);
    expect(masthead.position.y).toBe(0);
    const piece = one(deck.app.stage, "piece:mast") as FakeSprite;
    expect([piece.position.x, piece.position.y, piece.zIndex]).toEqual([202, 48, depthOf(110, 1)]);
    expect(byLabel(deck.app.stage, "piece:near")).toHaveLength(1);
    deck.drawing.destroy();
  });

  it("billows the sail every 850 ms while the deck moves, rides the bob and not the masthead's sway, and rests under reduced motion", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras });
    deck.advance(0);
    const sail = one(deck.app.stage, "sail") as FakeSprite;
    const frames = new Set<number>();
    for (let frame = 0; frame < 120; frame += 1) {
      deck.advance(34);
      frames.add(sail.texture.frame.x);
      expect([sail.position.x, sail.position.y]).toEqual(extrasManifest.sail.position);
    }
    expect(frames).toEqual(new Set([0, 114]));
    deck.drawing.destroy();
    const still = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, reducedMotion: true });
    expect((one(still.app.stage, "sail") as FakeSprite).texture.frame.x).toBe(0);
    still.drawing.destroy();
  });

  it("without the extras keeps the bare mast and its own piece; without the sail, the tall mast stands bare", async () => {
    const bare = await start(environment, { now: new Date(2026, 9, 14, 12, 0) });
    expect(byLabel(bare.app.stage, "sail")).toEqual([]);
    expect(byLabel(bare.app.stage, "mast")).toEqual([]);
    expect(byLabel(bare.app.stage, "piece:mast")).toHaveLength(1);
    bare.drawing.destroy();
    // The tall mast without its sail still stands, its own rows the depth piece from the mast piece's top.
    const bareTall = { manifest: extrasManifest, images: new Map([...extras.images].filter(([path]) => path !== "sails/main-sail.png")) };
    const tall = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: bareTall });
    expect(byLabel(tall.app.stage, "sail")).toEqual([]);
    expect(byLabel(tall.app.stage, "mast")).toHaveLength(1);
    expect((one(tall.app.stage, "piece:mast:tall") as FakeSprite).position.y).toBe(48);
    tall.drawing.destroy();
  });

  it("dresses each sailor in its look, at the atlas's frames, and never in a look that did not load", async () => {
    const scene = crewScene(Array.from({ length: 24 }, (_, index): [string, DeckState] => [`s${index}`, "working"]));
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene, reducedMotion: true });
    const lookOf = (stage: FakeContainer, key: string) => {
      const { sprite } = sailorSprites(stage, key);
      return `${texturePath(sprite) ?? "atlas"}@${sprite.texture.frame.x}`;
    };
    const worn = scene.sailors.map((sailor) => lookOf(deck.app.stage, sailor.key));
    // Twenty-four sailors wear all eight looks between them: the atlas's two outfits and the six extra ones.
    expect(new Set(worn).size).toBe(8);
    for (const sailor of scene.sailors) {
      const { sprite } = sailorSprites(deck.app.stage, sailor.key);
      const [x, y, width, height] = deckManifest.crew.base.hauling.frame;
      const outfit = deckManifest.crew.outfit.hauling.frame;
      expect([[x, y, width, height], outfit]).toContainEqual([sprite.texture.frame.x, sprite.texture.frame.y, sprite.texture.frame.width, sprite.texture.frame.height]);
    }
    deck.drawing.destroy();
    const partial = { manifest: extrasManifest, images: new Map([...extras.images].filter(([path]) => !path.includes("bosun"))) };
    const fewer = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: partial, scene, reducedMotion: true });
    const wornFewer = scene.sailors.map((sailor) => lookOf(fewer.app.stage, sailor.key));
    expect(wornFewer.some((path) => path.includes("bosun"))).toBe(false);
    fewer.drawing.destroy();
  });

  it("breathes an at-ease sailor: its head and shoulders a pixel lower over its planted body, then whole again", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: crewScene([["rest", "idle"]]) });
    deck.advance(0);
    const { sprite, upper } = sailorSprites(deck.app.stage, "rest");
    const lane = sprite.texture.frame.x === deckManifest.crew.outfit["side-idle"].frame[0] ? "outfit" : "base";
    const standing = deckManifest.crew[lane]["side-idle"];
    const seen = { whole: 0, out: 0 };
    for (let frame = 0; frame < 200; frame += 1) {
      deck.advance(34);
      if (upper.visible) {
        seen.out += 1;
        expect(upper.texture.frame.height).toBe(BREATH_ROWS);
        expect(sprite.texture.frame.y).toBe(upper.texture.frame.y + BREATH_ROWS);
        expect(sprite.texture.frame.height).toBe(standing.frame[3] - BREATH_ROWS);
        // The body where the whole sailor's rows would be; the head and shoulders a pixel lower; mirrored alike.
        expect(sprite.anchor.y).toBe(0);
        expect(upper.position.y).toBe(sprite.position.y - BREATH_ROWS + 1);
        expect(sprite.position.y + standing.frame[3] - BREATH_ROWS).toBe(standing.frame[3] - standing.feet[1]);
        expect(upper.scale.x).toBe(sprite.scale.x);
      } else {
        seen.whole += 1;
        expect(sprite.texture.frame.height).toBe(standing.frame[3]);
      }
    }
    expect(seen.whole).toBeGreaterThan(20);
    expect(seen.out).toBeGreaterThan(20);
    deck.drawing.destroy();
  });

  it("without the generated wake, draws the code wake over the near sea, scrolling with the water, and still under reduced motion and on a plain sea", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0) });
    deck.advance(0);
    const wake = one(deck.app.stage, "wake") as FakeGraphics;
    const drawn = new Set<string>();
    for (let frame = 0; frame < 60; frame += 1) {
      deck.advance(34);
      expect(wake.shapes.length).toBeGreaterThan(20);
      drawn.add(JSON.stringify(wake.shapes));
    }
    // Two seconds at ten pixels a second: about twenty different wakes, not sixty.
    expect(drawn.size).toBeGreaterThan(10);
    expect(drawn.size).toBeLessThan(30);
    deck.drawing.destroy();

    const still = await start(environment, { now: new Date(2026, 9, 14, 12, 0), reducedMotion: true });
    const first = JSON.stringify((one(still.app.stage, "wake") as FakeGraphics).shapes);
    still.state.now = new Date(2026, 9, 14, 12, 5);
    still.timers[0]!.run();
    expect(JSON.stringify((one(still.app.stage, "wake") as FakeGraphics).shapes)).toBe(first);
    still.drawing.destroy();

    const plain = await start(null, { now: new Date(2026, 9, 14, 12, 0) });
    plain.advance(16);
    expect(one(plain.app.stage, "scenery:front").children.map((child) => child.label)).toEqual(["sea:near", "wake"]);
    expect((one(plain.app.stage, "wake") as FakeGraphics).shapes.length).toBeGreaterThan(20);
    plain.drawing.destroy();
  });

  it("lets go of the sail's and the looks' textures and sources when torn down", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: crewScene([["a", "working"], ["b", "idle"]]) });
    deck.advance(16);
    const sprites = [
      one(deck.app.stage, "sail"),
      one(deck.app.stage, "mast"),
      one(deck.app.stage, "masthead"),
      one(deck.app.stage, "piece:mast:tall"),
      one(deck.app.stage, "plank"),
      sailorSprites(deck.app.stage, "a").sprite,
    ] as FakeSprite[];
    deck.drawing.destroy();
    expect(sprites.every((sprite) => sprite.texture.destroyed && sprite.texture.source.destroyed)).toBe(true);
  });
});

describe("the camera closing in on a focused sailor", () => {
  const scene = () => crewScene([["a", "working"], ["b", "idle"], ["c", "blocked"]]);
  const worldFit = (deck: Awaited<ReturnType<typeof start>>) => {
    const layer = one(deck.app.stage, "world");
    return { scale: layer.scale.x, x: layer.position.x, y: layer.position.y };
  };
  /** Where a sailor stands on the canvas: its feet's column, a little above its feet. */
  const onCanvas = (deck: Awaited<ReturnType<typeof start>>, key: string) => {
    const root = one(deck.app.stage, key);
    const ship = one(deck.app.stage, "ship");
    return toCanvas({ x: root.position.x, y: root.position.y - 8 }, worldFit(deck), { x: ship.position.x, y: ship.position.y });
  };

  it("zooms in over the deck's clock, dims the rest behind a veil, and stands the sailor in the spotlight at the panel's side", async () => {
    const hovers: Array<DeckHover | null> = [];
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: scene(), onHover: (hover) => hovers.push(hover) });
    deck.advance(16);
    const base = fitDeck({ width: 800, height: 400 }, deckBox({ width: 426, height: 161 }, -80), 1);
    expect(worldFit(deck)).toEqual(base);
    deck.drawing.focus("b");
    const veil = one(deck.app.stage, "veil");
    const scales: number[] = [];
    for (let elapsed = 0; elapsed <= FOCUS_MS + 100; elapsed += 34) {
      deck.advance(34);
      scales.push(worldFit(deck).scale);
    }
    // One move: the scale only grows, from the exact fit to the shot's, and stops there.
    expect(scales.every((scale, index) => index === 0 || scale >= scales[index - 1]!)).toBe(true);
    expect(scales[0]).toBeLessThan(scales.at(-1)!);
    expect(scales.at(-1)!).toBeGreaterThan(base.scale * 1.5);
    expect([veil.visible, veil.alpha]).toEqual([true, FOCUS_VEIL_ALPHA]);
    // The focused sailor stands over the veil; the others stay among the deck's pieces, behind it.
    expect(one(deck.app.stage, "spot").children.map((child) => child.label)).toEqual(["b"]);
    expect(one(deck.app.stage, "deck").children.some((child) => child.label === "a")).toBe(true);
    // Resting off the working deck, and still brought to the room beside the panel.
    const layout = focusLayout({ width: 800, height: 400 });
    expect(Math.abs(onCanvas(deck, "b").x - layout.anchor.x)).toBeLessThan(worldFit(deck).scale * 8);
    // While focused, the pointer labels no one: the panel says who it is.
    const hoversBefore = hovers.length;
    const at = onCanvas(deck, "b");
    deck.app.canvas.listeners.get("pointermove")?.({ offsetX: at.x, offsetY: at.y });
    deck.advance(34);
    expect(hovers.slice(hoversBefore).every((hover) => hover === null)).toBe(true);
    deck.drawing.destroy();
  });

  it("reads a click through the camera: the sailor under it, at the whole deck or zoomed in, or nobody", async () => {
    const selected: Array<string | null> = [];
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: scene(), onSelect: (key) => selected.push(key) });
    deck.advance(16);
    const click = (point: { x: number; y: number }) => deck.app.canvas.listeners.get("click")?.({ offsetX: point.x, offsetY: point.y });
    click(onCanvas(deck, "a"));
    click({ x: 4, y: 4 });
    deck.drawing.focus("a");
    for (let elapsed = 0; elapsed <= FOCUS_MS + 100; elapsed += 34) deck.advance(34);
    click(onCanvas(deck, "a"));
    click({ x: 4, y: 4 });
    expect(selected).toEqual(["a", null, "a", null]);
    deck.drawing.destroy();
    expect(deck.app.canvas.listeners.size).toBe(0);
  });

  it("pulls back out to the exact fit, the veil gone and the sailor back among the pieces", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: scene() });
    deck.advance(16);
    const base = worldFit(deck);
    deck.drawing.focus("c");
    for (let elapsed = 0; elapsed <= FOCUS_MS + 100; elapsed += 34) deck.advance(34);
    deck.drawing.focus(null);
    deck.advance(34);
    deck.advance(34);
    // Mid-way out the sailor stays in the spotlight, so the veil never dims it.
    expect(one(deck.app.stage, "spot").children.map((child) => child.label)).toEqual(["c"]);
    for (let elapsed = 0; elapsed <= FOCUS_MS + 100; elapsed += 34) deck.advance(34);
    expect(worldFit(deck)).toEqual(base);
    expect(one(deck.app.stage, "veil").visible).toBe(false);
    expect(one(deck.app.stage, "spot").children).toHaveLength(0);
    expect(one(deck.app.stage, "deck").children.some((child) => child.label === "c")).toBe(true);
    deck.drawing.destroy();
  });

  it("snaps under reduced motion, with no loop, and holds the focus through a resize", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: scene(), reducedMotion: true });
    expect(deck.pending()).toBe(0);
    const base = worldFit(deck);
    deck.drawing.focus("a");
    // Drawn at once, closed in all the way: no frames requested, no zoom to watch.
    expect(deck.pending()).toBe(0);
    expect(worldFit(deck).scale).toBeGreaterThan(base.scale * 1.5);
    expect(one(deck.app.stage, "veil").alpha).toBe(FOCUS_VEIL_ALPHA);
    const wide = focusLayout({ width: 800, height: 400 });
    const box = onCanvas(deck, "a");
    expect(Math.abs(box.x - wide.anchor.x)).toBeLessThan(worldFit(deck).scale * 8);
    // A narrow, tall pane: the panel docks under the sailor, and the sailor follows to the room above it.
    deck.drawing.resize(480, 600);
    const narrow = focusLayout({ width: 480, height: 600 });
    expect(narrow.side).toBe("bottom");
    const at = onCanvas(deck, "a");
    expect(Math.abs(at.x - narrow.anchor.x)).toBeLessThan(worldFit(deck).scale * 8);
    expect(Math.abs(at.y - narrow.anchor.y)).toBeLessThan(worldFit(deck).scale * 16);
    deck.drawing.focus(null);
    expect(worldFit(deck)).toEqual(fitDeck({ width: 480, height: 600 }, deckBox({ width: 426, height: 161 }, -80), 1));
    deck.drawing.destroy();
  });
});

describe("the plank and the shark on the deck", () => {
  const now = new Date(2026, 9, 14, 12, 0);

  it("lays the plank in front of the near rail, and the sea's layer for whoever goes off it between the near sea and the veil", async () => {
    const deck = await start(environment, { now, extras, scene: crewScene([["a", "working"]]) });
    deck.advance(0);
    // The generated board, at its placement, just in front of the near rail.
    const plank = one(one(deck.app.stage, "deck"), "plank") as FakeSprite;
    expect(texturePath(plank)).toBe("plank/plank.png");
    expect([plank.position.x, plank.position.y]).toEqual(extrasManifest.plank!.position);
    expect([plank.texture.frame.width, plank.texture.frame.height]).toEqual(extrasManifest.plank!.size);
    expect(plank.zIndex).toBeGreaterThan(one(deck.app.stage, "piece:near").zIndex);
    expect(one(deck.app.stage, "world").children.map((child) => child.label)).toEqual(["scenery:back", "ship", "scenery:front", "overboard", "veil", "spot"]);
    deck.drawing.destroy();
    // Without the board's image, the board drawn in code, in the same place in the depth order.
    const images = new Map([...extras.images].filter(([path]) => path !== "plank/plank.png"));
    const coded = await start(environment, { now, extras: { manifest: extrasManifest, images }, scene: crewScene([["a", "working"]]) });
    coded.advance(0);
    const board = one(one(coded.app.stage, "deck"), "plank") as FakeGraphics;
    expect(board.shapes.length).toBeGreaterThan(0);
    expect(board.zIndex).toBe(plank.zIndex);
    coded.drawing.destroy();
  });

  it("walks a departing sailor off the plank into the sea, where the shark takes it, and clears the sea after", async () => {
    const deck = await start(environment, { now, extras, scene: crewScene([["a", "working"], ["b", "idle"]]) });
    deck.advance(0);
    deck.drawing.update(crewScene([["b", "idle"]]));
    const overboard = one(deck.app.stage, "overboard");
    const sharks = new Set<string>();
    const splashes = new Set<string>();
    let swam = false;
    let walkedPlank = false;
    for (let frame = 0; frame < 900; frame += 1) {
      deck.advance(34);
      const onPlank = one(deck.app.stage, "deck").children.find((child) => child.label.startsWith("a~"));
      if (onPlank !== undefined && onPlank.zIndex > one(deck.app.stage, "plank").zIndex) walkedPlank = true;
      if (overboard.children.some((child) => child.label.startsWith("a~"))) swam = true;
      for (const child of overboard.children) {
        if (!child.visible) continue;
        if (child.label === "shark") sharks.add(texturePath(child));
        if (child.label === "splash") splashes.add(texturePath(child));
      }
    }
    expect(walkedPlank).toBe(true);
    expect(swam).toBe(true);
    expect(sharks).toEqual(new Set(["shark/fin.png", "shark/surface.png", "shark/chomp.png", "shark/submerge.png"]));
    expect(splashes).toEqual(new Set(["splash/impact.png", "splash/burst.png"]));
    // Gone: no sailor, shark or splash left in the sea, and only `b` on deck.
    expect(overboard.children).toEqual([]);
    expect(byLabel(deck.app.stage, "a")).toEqual([]);
    expect(byLabel(deck.app.stage, "b")).toHaveLength(1);
    deck.drawing.destroy();
  });

  it("without the shark's art still sends the sailor over, and draws no shark", async () => {
    const plain = { manifest: extrasManifest, images: new Map([...extras.images].filter(([path]) => !path.startsWith("shark/"))) };
    const deck = await start(environment, { now, extras: plain, scene: crewScene([["a", "working"]]) });
    deck.advance(0);
    deck.drawing.update(crewScene([]));
    const overboard = one(deck.app.stage, "overboard");
    let swam = false;
    for (let frame = 0; frame < 900; frame += 1) {
      deck.advance(34);
      if (overboard.children.some((child) => child.label.startsWith("a~"))) swam = true;
      expect(overboard.children.filter((child) => child.label === "shark" && child.visible)).toEqual([]);
    }
    expect(swam).toBe(true);
    expect(overboard.children).toEqual([]);
    deck.drawing.destroy();
  });

  it("under reduced motion fades a departing sailor out where it stood, drawn again only until it has gone", async () => {
    const deck = await start(environment, { now, extras, scene: crewScene([["a", "working"]]), reducedMotion: true });
    expect(deck.pending()).toBe(0);
    deck.drawing.update(crewScene([]));
    const fades = deck.timers.filter((timer) => timer.ms < 1000);
    expect(fades).toHaveLength(1);
    const fade = fades[0]!;
    const alphas: number[] = [];
    for (let tick = 0; tick < 40 && !fade.stopped; tick += 1) {
      const ghost = byLabel(deck.app.stage, "deck")[0]!.children.find((child) => child.label.startsWith("a~"));
      if (ghost !== undefined) alphas.push((ghost.children[1] as FakeSprite).alpha);
      fade.run();
    }
    expect(fade.stopped).toBe(true);
    expect(alphas.length).toBeGreaterThan(5);
    expect(alphas).toEqual([...alphas].sort((x, y) => y - x));
    expect(byLabel(deck.app.stage, "overboard")[0]!.children).toEqual([]);
    expect(byLabel(deck.app.stage, "deck")[0]!.children.some((child) => child.label.startsWith("a"))).toBe(false);
    // No frame loop at any point.
    expect(deck.pending()).toBe(0);
    deck.drawing.destroy();
  });
});

describe("the clouds in the sky", () => {
  /** The extras with every cloud cut into its masks: each a token naming its sprite and slot. */
  const cloudy: DeckExtrasImages = {
    ...extras,
    cloudMasks: new Map(
      extrasManifest.clouds!.sprites.map((sprite) => [sprite.texture, [0, 1, 2].map((slot) => ({ image: `${sprite.texture}#${slot}` })) as [unknown, unknown, unknown]]),
    ),
  };
  const cloudsOf = (deck: Awaited<ReturnType<typeof start>>) => one(deck.app.stage, "clouds").children;
  /** Each cloud's place in the sky's own pixels, read back through the sky's sprite: whole pixels, at the sky's scale. */
  const inSky = (deck: Awaited<ReturnType<typeof start>>) => {
    const sky = one(deck.app.stage, "sky:under");
    return cloudsOf(deck).map(function (cloud) {
      expect(cloud.scale.x).toBe(sky.scale.x);
      // To a millionth of a pixel: a fractional scale leaves a float's last digits.
      const pixels = (value: number) => Math.round(value * 1e6) / 1e6;
      return { x: pixels((cloud.position.x - sky.position.x) / sky.scale.x), y: pixels((cloud.position.y - sky.position.y) / sky.scale.x) };
    });
  };

  it("draws them over the stars and behind the gull, the far sea and the ship, each of three nearest-sampled masks", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: cloudy });
    deck.advance(16);
    expect(one(deck.app.stage, "scenery:back").children.map((child) => child.label)).toEqual([
      "sky:under",
      "sky:over",
      "sky:stars",
      "clouds",
      "gull",
      "gull",
      "sea:far",
    ]);
    const clouds = cloudsOf(deck);
    expect(clouds).toHaveLength(7);
    for (const cloud of clouds) {
      expect(cloud.children.map((child) => child.label)).toEqual(["cloud:shadow", "cloud:body", "cloud:highlight"]);
      const id = cloud.label.replace("cloud:", "");
      expect(cloud.children.map(texturePath)).toEqual([0, 1, 2].map((slot) => `clouds/${id}.png#${slot}`));
      expect(cloud.children.every((mask) => (mask as FakeSprite).texture.source.scaleMode === "nearest")).toBe(true);
    }
    // Midday: the neutral palette, slot by slot.
    expect(clouds[0]!.children.map((mask) => mask.tint)).toEqual([0xa8b9bd, 0xbecac6, 0xd9d4be]);
    // In the sky's pixels, above its horizon row.
    for (const place of inSky(deck)) {
      expect(Number.isInteger(place.x) && Number.isInteger(place.y)).toBe(true);
      expect(place.y).toBeGreaterThan(0);
      expect(place.y).toBeLessThan(213);
    }
    deck.drawing.destroy();
  });

  it("drifts them right, slowly, on the scene clock, and the same opening gives the same sky", async () => {
    // Two crewmates working: the clouds at their own speed (`client/deck-atmosphere.ts`).
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: cloudy, scene: twoWorking() });
    deck.advance(0);
    const before = inSky(deck);
    // A minute of frames: each cloud a few dozen sky pixels on at most, never back — counted round its lap, for one that wraps.
    for (let frame = 0; frame < 1800; frame += 1) deck.advance(34);
    const after = inSky(deck);
    const moved = after.map(function (place, index) {
      const id = cloudsOf(deck)[index]!.label.replace("cloud:", "");
      const period = cloudPeriod(environmentManifest.sky.size[0], extrasManifest.clouds!.sprites.find((sprite) => sprite.id === id)!.size[0]);
      return (((place.x - before[index]!.x) % period) + period) % period;
    });
    expect(moved.every((step) => step >= 0 && step <= 50)).toBe(true);
    expect(moved.filter((step) => step >= 10)).toHaveLength(7);
    expect(after.map((place) => place.y)).toEqual(before.map((place) => place.y));
    const again = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: cloudy, scene: twoWorking() });
    again.advance(0);
    expect(inSky(again)).toEqual(before);
    const later = await start(environment, { now: new Date(2026, 9, 14, 12, 7), extras: cloudy, scene: twoWorking() });
    later.advance(0);
    expect(inSky(later)).not.toEqual(before);
    for (const opened of [deck, again, later]) opened.drawing.destroy();
  });

  it("holds them still under reduced motion and on a software renderer's lite plan, but recolours them with the clock", async () => {
    const deck = await start(environment, { reducedMotion: true, now: new Date(2026, 9, 14, 12, 0), extras: cloudy });
    const before = inSky(deck);
    deck.state.now = new Date(2026, 9, 15, 2, 0);
    deck.timers[0]!.run();
    expect(inSky(deck)).toEqual(before);
    // Night: dim blue.
    expect(cloudsOf(deck)[0]!.children.map((mask) => mask.tint)).toEqual([0x1d314e, 0x2c4869, 0x45617a]);
    deck.drawing.destroy();
  });

  it("warms them at dawn and blends them through a fade with the sky", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 5, 30), extras: cloudy });
    deck.advance(16);
    expect(cloudsOf(deck)[3]!.children.map((mask) => mask.tint)).toEqual([0x927f8b, 0xc7987d, 0xdfbb96]);
    const dusk = await start(environment, { now: new Date(2026, 9, 14, 20, 15), extras: cloudy });
    dusk.advance(16);
    const [shadow] = cloudsOf(dusk)[0]!.children.map((mask) => mask.tint);
    expect(shadow).not.toBe(0x536e87);
    expect(shadow).not.toBe(0x1d314e);
    for (const opened of [deck, dusk]) opened.drawing.destroy();
  });

  it("keeps them in the sky's place through a resize and the camera's zoom: same sky pixels, the sky's scale", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: cloudy, scene: crewScene([["a", "working"]]), reducedMotion: true });
    const before = inSky(deck);
    for (const [width, height] of [
      [1203.5, 911.25],
      [480, 600],
      [1900, 300],
    ] as const) {
      deck.drawing.resize(width, height);
      expect(inSky(deck)).toEqual(before);
    }
    deck.drawing.focus("a");
    expect(inSky(deck)).toEqual(before);
    deck.drawing.focus(null);
    expect(inSky(deck)).toEqual(before);
    deck.drawing.destroy();
  });

  it("draws none without a sky, or with no cloud cut into masks; lets go of their textures when torn down", async () => {
    const flat = await start(null, { now: new Date(2026, 9, 14, 12, 0), extras: cloudy });
    flat.advance(16);
    expect(byLabel(flat.app.stage, "clouds")).toEqual([]);
    flat.drawing.destroy();
    const uncut = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras });
    uncut.advance(16);
    expect(byLabel(uncut.app.stage, "clouds")).toEqual([]);
    uncut.drawing.destroy();
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: cloudy });
    deck.advance(16);
    const masks = cloudsOf(deck).flatMap((cloud) => cloud.children) as FakeSprite[];
    deck.drawing.destroy();
    expect(masks.every((mask) => mask.texture.destroyed && mask.texture.source.destroyed)).toBe(true);
  });
});

describe("the reply marker on deck", () => {
  /** `asking` sailors have replies waiting for the captain. */
  const askingScene = (asking: string[]) => {
    const scene = crewScene([["a", "blocked"], ["b", "working"], ["c", "idle"]]);
    return { ...scene, sailors: scene.sailors.map((sailor) => (asking.includes(sailor.key) ? { ...sailor, asks: true } : sailor)) };
  };
  const ask = (deck: Awaited<ReturnType<typeof start>>, key: string) => one(one(deck.app.stage, key), "ask") as unknown as FakeGraphics;

  it("hangs a light bubble with the accent's dots over a sailor with replies, and nothing over the rest", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: askingScene(["a"]), reducedMotion: true });
    const marker = ask(deck, "a");
    expect(marker.visible).toBe(true);
    expect(marker.shapes).toHaveLength(askPixels().length);
    const fills = new Set(marker.shapes.map((shape) => shape.at(-1)));
    expect(fills).toEqual(new Set([ASK_PAPER, parseInt(theme.colors.accent.slice(1), 16)]));
    // Over the badge, in the sailor's own layer.
    const badge = one(one(deck.app.stage, "a"), "badge");
    expect(marker.position.y).toBeLessThan(badge.position.y);
    expect(ask(deck, "b").visible).toBe(false);
    expect(ask(deck, "c").visible).toBe(false);
    // Answered: the next scene has no replies for it, and the marker goes.
    deck.drawing.update(askingScene([]));
    expect(ask(deck, "a").visible).toBe(false);
    deck.drawing.destroy();
  });

  it("bobs a pixel under motion, and holds still under reduced motion", async () => {
    const moving = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: askingScene(["a"]) });
    const heights = new Set<number>();
    for (let elapsed = 0; elapsed < 3200; elapsed += 100) {
      moving.advance(100);
      heights.add(ask(moving, "a").position.y);
    }
    expect(heights.size).toBe(2);
    moving.drawing.destroy();
    const still = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: askingScene(["a"]), reducedMotion: true });
    const before = ask(still, "a").position.y;
    still.drawing.update(askingScene(["a", "b"]));
    expect(ask(still, "a").position.y).toBe(before);
    expect(still.pending()).toBe(0);
    still.drawing.destroy();
  });

  it("while a sailor with replies is focused, reports where it stands for its bubble; one without, nothing", async () => {
    const hovers: Array<DeckHover | null> = [];
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: askingScene(["a"]), reducedMotion: true, onHover: (hover) => hovers.push(hover) });
    deck.drawing.focus("a");
    expect(hovers.at(-1)?.key).toBe("a");
    const layout = focusLayout({ width: 800, height: 400 });
    expect(Math.abs(hovers.at(-1)!.x - layout.anchor.x)).toBeLessThan(24);
    deck.drawing.focus("b");
    expect(hovers.at(-1)).toBeNull();
    deck.drawing.focus(null);
    deck.drawing.destroy();
  });
});

describe("the animated water on the deck", () => {
  const water = extrasManifest.water!;
  const seaTiles = (stage: FakeContainer) => [...one(stage, "sea:far").children, ...one(stage, "sea:near").children] as FakeSprite[];
  const wakeOf = (stage: FakeContainer) => one(stage, "wake") as FakeSprite;
  const foamOf = (stage: FakeContainer) => (one(stage, "foam").children as FakeSprite[]).filter((piece) => piece.visible);
  /** The extras without one image. */
  const without = (path: string): DeckExtrasImages => ({ manifest: extrasManifest, images: new Map([...extras.images].filter(([key]) => key !== path)) });

  it("draws the generated sea, its wake and foam in the environment's places: far sea behind the ship, the rest in front", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras });
    deck.advance(16);
    expect(one(deck.app.stage, "world").children.map((child) => child.label)).toEqual(["scenery:back", "ship", "scenery:front", "overboard", "veil", "spot"]);
    expect(one(deck.app.stage, "scenery:back").children.at(-1)!.label).toBe("sea:far");
    expect(one(deck.app.stage, "scenery:front").children.map((child) => child.label)).toEqual(["sea:near", "wake", "foam"]);

    // The sea: the first frame on every tile of both bands, from the horizon and from the waterline, one tile origin.
    const far = one(deck.app.stage, "sea:far").children as FakeSprite[];
    const near = one(deck.app.stage, "sea:near").children as FakeSprite[];
    expect(seaTiles(deck.app.stage).every((tile) => texturePath(tile) === "water/sea/frame-0.png")).toBe(true);
    expect(seaTiles(deck.app.stage).every((tile) => tile.texture.source.scaleMode === "nearest")).toBe(true);
    expect(Math.min(...far.map((tile) => tile.position.y))).toBe(HORIZON);
    const cut = near.find((tile) => tile.position.y === WATERLINE)!;
    expect([cut.texture.frame.y, cut.texture.frame.height]).toEqual([55, 128 - 55]);
    expect(near.filter((tile) => tile.position.y !== WATERLINE).every((tile) => (tile.position.y - HORIZON) % 128 === 0)).toBe(true);

    // The wake: one sprite, its anchor on the stern's water contact, in front of the hull's foot.
    const wake = wakeOf(deck.app.stage);
    expect(texturePath(wake)).toBe("water/wake/frame-0.png");
    expect([wake.position.x, wake.position.y, wake.texture.frame.width, wake.texture.frame.height]).toEqual([384, 143, 240, 96]);

    // The foam: the generated strip three rows higher than the old one, across the hull's waterline only.
    const foam = foamOf(deck.app.stage);
    expect(foam.every((piece) => texturePath(piece) === "water/foam/frame-0.png" && piece.position.y === 142 && piece.texture.frame.height === 16)).toBe(true);
    expect(Math.min(...foam.map((piece) => piece.position.x))).toBe(68);
    expect(Math.max(...foam.map((piece) => piece.position.x + piece.texture.frame.width))).toBe(392);
    deck.drawing.destroy();
  });

  it("cycles every part's frames, 240 ms each, the sea's tiles together, the wake held at the stern while the sea drifts", async () => {
    // Two crewmates working: the art's own timing.
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: twoWorking() });
    deck.advance(0);
    const seen = { sea: new Set<string>(), wake: new Set<string>(), foam: new Set<string>(), drift: new Set<number>() };
    const wake = wakeOf(deck.app.stage);
    // Three seconds of frames at 30 a second.
    for (let frame = 0; frame < 90; frame += 1) {
      deck.advance(34);
      const tiles = new Set(seaTiles(deck.app.stage).map(texturePath));
      expect(tiles.size).toBe(1);
      seen.sea.add([...tiles][0]!);
      seen.wake.add(texturePath(wake));
      for (const piece of foamOf(deck.app.stage)) seen.foam.add(texturePath(piece));
      seen.drift.add(one(deck.app.stage, "sea:far").position.x);
      expect(one(deck.app.stage, "sea:near").position.x).toBe(one(deck.app.stage, "sea:far").position.x);
      expect([wake.position.x, wake.position.y]).toEqual([384, 143]);
    }
    expect([...seen.sea].sort()).toEqual(water.sea.frames);
    expect([...seen.wake].sort()).toEqual(water.wake.frames);
    expect([...seen.foam].sort()).toEqual(water.foam.frames);
    // Ten pixels a second, whole pixels: about thirty places in three seconds.
    expect(seen.drift.size).toBeGreaterThan(25);
    expect([...seen.drift].every((x) => Number.isInteger(x))).toBe(true);
    deck.drawing.destroy();
  });

  it("keeps the frame showing through a resize: new tiles on the same frame", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: twoWorking() });
    deck.advance(0);
    for (let frame = 0; frame < 8; frame += 1) deck.advance(34);
    const showing = texturePath(seaTiles(deck.app.stage)[0]!);
    expect(showing).not.toBe("water/sea/frame-0.png");
    deck.drawing.resize(2300, 560);
    expect(seaTiles(deck.app.stage).every((tile) => texturePath(tile) === showing)).toBe(true);
    deck.drawing.destroy();
  });

  it("holds the calm first frame of each under reduced motion, through the minute's redraw", async () => {
    const deck = await start(environment, { reducedMotion: true, now: new Date(2026, 9, 14, 12, 0), extras });
    const calm = () => [new Set(seaTiles(deck.app.stage).map(texturePath)), texturePath(wakeOf(deck.app.stage)), new Set(foamOf(deck.app.stage).map(texturePath))];
    const expected = [new Set(["water/sea/frame-0.png"]), "water/wake/frame-0.png", new Set(["water/foam/frame-0.png"])];
    expect(calm()).toEqual(expected);
    deck.state.now = new Date(2026, 9, 14, 12, 3);
    deck.timers[0]!.run();
    expect(calm()).toEqual(expected);
    expect(one(deck.app.stage, "sea:far").position.x).toBe(0);
    deck.drawing.destroy();
  });

  it("holds them on a software renderer's lite plan too, where the sea does not drift", () => {
    const scenery = createScenery(pixi, environment, null, 0, drawnWater(extras));
    scenery.layout({ left: 0, right: 426, top: -80, bottom: 240 });
    const lite = { level: "lite", animate: true, fps: 12, ambient: false } as const;
    for (const seconds of [0, 0.25, 0.5, 0.75, 1]) {
      scenery.draw(seconds, lite, 720);
      const front = scenery.front as unknown as FakeContainer;
      expect(texturePath(one(front, "wake"))).toBe("water/wake/frame-0.png");
      expect(new Set((one(front, "sea:near").children as FakeSprite[]).map(texturePath))).toEqual(new Set(["water/sea/frame-0.png"]));
      expect(one(front, "sea:near").position.x).toBe(0);
    }
    scenery.destroy();
  });

  it("falls back part by part: a missing wake frame is the code wake, a missing sea frame the environment's tile, a missing foam frame its strip", async () => {
    const noWake = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: without("water/wake/frame-1.png") });
    noWake.advance(16);
    expect((one(noWake.app.stage, "wake") as FakeGraphics).shapes.length).toBeGreaterThan(20);
    expect(texturePath(seaTiles(noWake.app.stage)[0]!)).toBe("water/sea/frame-0.png");
    noWake.drawing.destroy();

    const noSea = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: without("water/sea/frame-3.png") });
    noSea.advance(16);
    expect(seaTiles(noSea.app.stage).every((tile) => texturePath(tile) === "sea/water-tile.png")).toBe(true);
    expect(texturePath(wakeOf(noSea.app.stage))).toBe("water/wake/frame-0.png");
    noSea.drawing.destroy();

    const noFoam = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: without("water/foam/frame-2.png") });
    noFoam.advance(16);
    expect(foamOf(noFoam.app.stage).every((piece) => texturePath(piece) === "sea/foam-strip.png" && piece.position.y === FOAM_TOP)).toBe(true);
    noFoam.drawing.destroy();
  });

  it("on the plain sea without the environment, still draws the generated wake", async () => {
    const plain = await start(null, { now: new Date(2026, 9, 14, 12, 0), extras, scene: twoWorking() });
    plain.advance(16);
    expect(one(plain.app.stage, "scenery:front").children.map((child) => child.label)).toEqual(["sea:near", "wake"]);
    const wake = wakeOf(plain.app.stage);
    expect(texturePath(wake)).toBe("water/wake/frame-0.png");
    for (let frame = 0; frame < 8; frame += 1) plain.advance(34);
    expect(texturePath(wake)).toBe("water/wake/frame-1.png");
    plain.drawing.destroy();
    expect(wake.texture.destroyed && wake.texture.source.destroyed).toBe(true);
  });

  it("lets go of the water's textures and sources when torn down", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras });
    for (let frame = 0; frame < 30; frame += 1) deck.advance(34);
    const sprites = [...seaTiles(deck.app.stage), wakeOf(deck.app.stage), ...foamOf(deck.app.stage)];
    deck.drawing.destroy();
    expect(sprites.every((sprite) => sprite.texture.destroyed && sprite.texture.source.destroyed)).toBe(true);
  });
});

describe("the weather on the deck, by how busy the crew is", () => {
  const busy = () => crewScene(Array.from({ length: BUSY_CREW }, (_, index): [string, DeckState] => [`hand-${index}`, "working"]));
  const idle = () => crewScene([["dozing", "idle"]]);
  const cloudy: DeckExtrasImages = {
    ...extras,
    cloudMasks: new Map(
      extrasManifest.clouds!.sprites.map((sprite) => [sprite.texture, [0, 1, 2].map((slot) => ({ image: `${sprite.texture}#${slot}` })) as [unknown, unknown, unknown]]),
    ),
  };
  const seaFrame = (deck: Awaited<ReturnType<typeof start>>) => texturePath(one(deck.app.stage, "sea:far").children[0]!);
  /** Over `seconds` at 30 frames a second: how often the sea's frame and the sail's state changed, how far the sea and the first cloud went. */
  function watch(deck: Awaited<ReturnType<typeof start>>, seconds: number) {
    deck.advance(0);
    const sail = one(deck.app.stage, "sail") as FakeSprite;
    const cloud = one(deck.app.stage, "clouds").children[0]!;
    const counts = { sea: 0, sail: 0, drift: 0, cloud: 0 };
    let [sea, cloth, drift, x] = [seaFrame(deck), sail.texture.frame.x, one(deck.app.stage, "sea:far").position.x, cloud.position.x];
    for (let frame = 0; frame < seconds * 30; frame += 1) {
      deck.advance(34);
      if (seaFrame(deck) !== sea) counts.sea += 1;
      if (sail.texture.frame.x !== cloth) counts.sail += 1;
      const at = one(deck.app.stage, "sea:far").position.x;
      // The drift wraps every tile; count whole pixels moved.
      counts.drift += (((at - drift) % 256) + 256) % 256;
      if (cloud.position.x > x) counts.cloud += cloud.position.x - x;
      [sea, cloth, drift, x] = [seaFrame(deck), sail.texture.frame.x, at, cloud.position.x];
    }
    return counts;
  }

  it("plays the sea, drifts it and the clouds, and flaps the sail faster with a busy crew than an idle one", async () => {
    const calm = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: cloudy, scene: idle() });
    const lively = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: cloudy, scene: busy() });
    const [slow, fast] = [watch(calm, 6), watch(lively, 6)];
    // Idle: half the art's pace, about 12 frames in 6 s; busy: nearly twice it, about 47.
    expect(slow.sea).toBeLessThan(15);
    expect(fast.sea).toBeGreaterThan(40);
    expect(fast.drift).toBeGreaterThan(slow.drift * 3);
    expect(fast.cloud).toBeGreaterThan(slow.cloud * 3);
    expect(fast.sail).toBeGreaterThan(slow.sail * 3);
    for (const deck of [calm, lively]) deck.drawing.destroy();
  });

  it("fills the wake out and shades the sky a touch greyer with a busy crew; idle, a fainter wake and the sky as drawn", async () => {
    const calm = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: cloudy, scene: idle() });
    const lively = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: cloudy, scene: busy() });
    for (const deck of [calm, lively]) deck.advance(34);
    expect(one(calm.app.stage, "wake").alpha).toBeLessThan(0.7);
    expect(one(lively.app.stage, "wake").alpha).toBe(1);
    expect([one(calm.app.stage, "sky:under").tint, one(calm.app.stage, "sky:over").tint]).toEqual([0xffffff, 0xffffff]);
    expect([one(lively.app.stage, "sky:under").tint, one(lively.app.stage, "sky:over").tint]).toEqual([STORM_SHADE, STORM_SHADE]);
    // The clouds take the same shade over the sky's own colours.
    const clouds = (deck: Awaited<ReturnType<typeof start>>) => one(deck.app.stage, "clouds").children[0]!.children.map((mask) => mask.tint);
    expect(clouds(calm)).toEqual([0xa8b9bd, 0xbecac6, 0xd9d4be]);
    expect(clouds(lively)).toEqual([0xa8b9bd, 0xbecac6, 0xd9d4be].map((colour) => shade(colour, STORM_SHADE)));
    for (const deck of [calm, lively]) deck.drawing.destroy();
  });

  it("opens in the crew's weather and eases to a new one as the crew changes, never snapping", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: idle() });
    const weather = () => Number(deck.app.canvas.attributes.get(DECK_WEATHER_ATTRIBUTE));
    deck.advance(0);
    expect(weather()).toBe(0);
    deck.drawing.update(busy());
    deck.advance(34);
    expect(weather()).toBeGreaterThan(0);
    expect(weather()).toBeLessThan(0.05);
    const seen: number[] = [];
    for (let frame = 0; frame < 30 * 15; frame += 1) {
      deck.advance(34);
      seen.push(weather());
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBeGreaterThan(0.98);
    expect(seen.filter((value) => value > 0.2 && value < 0.8).length).toBeGreaterThan(30);
    deck.drawing.destroy();

    const opened = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: busy() });
    opened.advance(0);
    expect(opened.app.canvas.attributes.get(DECK_WEATHER_ATTRIBUTE)).toBe("1.00");
    opened.drawing.destroy();
  });

  it("stays as it always was under reduced motion, however busy: calm frames, no drift, the whole wake, the sky untinted", async () => {
    const deck = await start(environment, { reducedMotion: true, now: new Date(2026, 9, 14, 12, 0), extras: cloudy, scene: busy() });
    expect(deck.app.canvas.attributes.get(DECK_WEATHER_ATTRIBUTE)).toBe("still");
    expect(seaFrame(deck)).toBe("water/sea/frame-0.png");
    expect(texturePath(one(deck.app.stage, "wake"))).toBe("water/wake/frame-0.png");
    expect(one(deck.app.stage, "wake").alpha).toBe(1);
    expect(one(deck.app.stage, "sea:far").position.x).toBe(0);
    expect(one(deck.app.stage, "sky:under").tint).toBe(0xffffff);
    expect((one(deck.app.stage, "sail") as FakeSprite).texture.frame.x).toBe(0);
    expect(one(deck.app.stage, "ship").position.y).toBe(0);
    deck.drawing.destroy();
  });
});
