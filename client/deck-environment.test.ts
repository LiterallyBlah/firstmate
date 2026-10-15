/**
 * The generated environment on the deck, through `startDeck` itself with a stand-in for Pixi that keeps
 * the scene graph: the depth order (sky behind, sea behind and at the hull, ship and crew in front), the
 * sky following an injected clock — once a minute on a still deck — reduced motion's still sea and empty
 * sky, and the plain sea the deck falls back to without its environment. Then the extras: the sail and its
 * occluder, the crew's looks, the at-ease sailor's breath, and the wake. Then the camera closing in on a
 * focused sailor: the zoom over the deck's clock, the veil and the spotlight, a click read through the camera,
 * the snap under reduced motion, and a resize while focused. Whether WebGL paints it is the browser
 * harnesses' (`docs/ship-deck-environment/`, `docs/ship-deck-tweaks/`, `docs/ship-deck-focus/`).
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import type { PluginTheme } from "@getpaseo/plugin";
import { describe, expect, it } from "vitest";

import { DeckArtManifestSchema, DeckEnvironmentManifestSchema, DeckExtrasManifestSchema, environmentImagePaths, extrasImagePaths } from "../shared/ship-deck";
import { HORIZON, WATERLINE } from "./deck-ambient";
import { FOAM_SPAN, FOAM_TOP, type DeckEnvironmentImages } from "./deck-environment";
import { FOCUS_MS, FOCUS_VEIL_ALPHA, focusLayout } from "./deck-camera";
import { BREATH_ROWS } from "./deck-crew";
import { toCanvas } from "./deck-hover";
import type { DeckExtrasImages } from "./deck-extras";
import type { DeckHover } from "./deck-hover";
import type { FrameScheduler, MotionSignals } from "./deck-loop";
import { DECK_MOTION_ATTRIBUTE, DECK_SKY_ATTRIBUTE, fitDeck, startDeck, type DeckMotionEnvironment, type PixiModule } from "./deck-pixi";
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
    expect(worldLayer.children.map((child) => child.label)).toEqual(["scenery:back", "ship", "scenery:front", "veil", "spot"]);
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
    expect(one(deck.app.stage, "world").children.map((child) => child.label)).toEqual(["scenery:back", "ship", "scenery:front", "veil", "spot"]);
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
  it("hangs the sail between the masthead and the crew, and stands the occluder in the mast's place on its row", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras });
    deck.advance(16);
    const ship = one(deck.app.stage, "ship");
    expect(ship.children.map((child) => child.label)).toEqual(["hull:0", "hull:1", "hull:2", "masthead", "sail", "deck"]);
    const sail = one(ship, "sail") as FakeSprite;
    expect([sail.position.x, sail.position.y]).toEqual(extrasManifest.sail.position);
    expect(texturePath(sail)).toBe("sails/main-sail.png");
    expect(byLabel(deck.app.stage, "piece:mast")).toEqual([]);
    const occluder = one(deck.app.stage, "piece:mast:occluder") as FakeSprite;
    expect(texturePath(occluder)).toBe("sails/mast-occluder.png");
    expect([occluder.position.x, occluder.position.y, occluder.zIndex]).toEqual([202, 48, depthOf(110, 1)]);
    // Every other piece is the atlas's, as before.
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

  it("without the extras, or missing the occluder, keeps the bare mast and its own piece", async () => {
    const bare = await start(environment, { now: new Date(2026, 9, 14, 12, 0) });
    expect(byLabel(bare.app.stage, "sail")).toEqual([]);
    expect(byLabel(bare.app.stage, "piece:mast")).toHaveLength(1);
    bare.drawing.destroy();
    const partial = { manifest: extrasManifest, images: new Map([...extras.images].filter(([path]) => path !== "sails/mast-occluder.png")) };
    const half = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: partial });
    expect(byLabel(half.app.stage, "sail")).toEqual([]);
    expect(byLabel(half.app.stage, "piece:mast")).toHaveLength(1);
    half.drawing.destroy();
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

  it("draws the wake over the near sea, scrolling with the water, and still under reduced motion and on a plain sea", async () => {
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
    const sprites = [one(deck.app.stage, "sail"), one(deck.app.stage, "piece:mast:occluder"), sailorSprites(deck.app.stage, "a").sprite] as FakeSprite[];
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
    const base = fitDeck({ width: 800, height: 400 }, { width: 426, height: 161 }, 1);
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
    expect(worldFit(deck)).toEqual(fitDeck({ width: 480, height: 600 }, { width: 426, height: 161 }, 1));
    deck.drawing.destroy();
  });
});
