/**
 * The setting's scenery on the deck, through `startDeck` itself with a stand-in for Pixi that keeps
 * the scene graph: the depth order (sky behind, sea behind and at the hull, ship and crew in front), the
 * sky following an injected clock — once a minute on a still deck — reduced motion's still sea and empty
 * sky, and the plain sea the deck falls back to without its still sea, each ambience element left out on its own
 * when its image did not arrive. Then the extras: the tall mast and
 * its sail, the crew's looks, the at-ease sailor's breath, and the wake. Then the camera closing in on a
 * focused sailor: the zoom over the deck's clock, the veil and the spotlight, a click read through the camera,
 * the snap under reduced motion, and a resize while focused. And the weather, livelier as more of the crew works. Whether WebGL paints it is the browser
 * harnesses' (`docs/ship-deck-environment/`, `docs/ship-deck-tweaks/`, `docs/ship-deck-focus/`).
 */
import { deckPresentation } from "./deck-setting";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import type { PluginTheme } from "@getpaseo/plugin";
import { describe, expect, it } from "vitest";

import { extrasImagePaths, type DeckExtrasImages } from "../test/deck-legacy";
import { compileParts } from "./deck-parts";
import { BUSY_CREW, compileAtmosphere, deliveredWeather, shade } from "./deck-atmosphere";
import { compileAmbience, type DeckAmbience } from "./deck-ambience";
import type { SettingManifest } from "../shared/deck-setting";
import { cloudPeriod, hexColour, type DrifterMasks } from "./deck-clouds";
import { createScenery, type SceneryArt } from "./deck-environment";
import { ASK_PAPER, ASK_SIZE, askPixels } from "./deck-badges";
import { FOCUS_MS, FOCUS_VEIL_ALPHA, focusLayout } from "./deck-camera";
import { toCanvas } from "./deck-hover";
import type { DeckHover } from "./deck-hover";
import type { FrameScheduler, MotionSignals } from "./deck-loop";
import { DECK_FLASH_ATTRIBUTE, DECK_MOTION_ATTRIBUTE, DECK_SKY_ATTRIBUTE, DECK_WEATHER_ATTRIBUTE, deckBox, fitDeck, startDeck, type DeckMotionEnvironment, type PixiModule } from "./deck-pixi";
import { SKY_REFRESH_MS } from "./deck-sky";
import { deckScene, depthOf, type DeckScene, type DeckSailor, type DeckState } from "./deck-scene";
import { shipCast, shipElement, shipManifest, shipStage, shipViews, shipWater } from "../test/ship-pack";
import { standing } from "./deck-cast";
import { compileStage, type DeckStage } from "./deck-stage";
import { phaseStripFixture } from "../test/phase-strip-fixture";
import { precipManifest } from "../test/precip-fixture";

// The ship's cast, under the names its constants had in the deck's code.
const BREATH_ROWS = shipCast().breath!.rows;
/** The ship's sky at its moodiest: the tint its backdrop goes to with a busy crew. */
const SKY_SHADE = hexColour(shipElement("sky", "backdrop-cycle").tint!.to);
const clouds = shipElement("clouds", "drifters");

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

// The ship's water, under the names its constants had in the deck's code.
const { horizon: HORIZON, waterline: WATERLINE } = shipWater();
const FOAM_TOP = shipElement("foam-still", "strip").top;
const FOAM_SPAN = { left: shipElement("foam-still", "strip").span[0], right: shipElement("foam-still", "strip").span[1] };

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
  cacheChanges: unknown[] = [];
  cacheUpdates = 0;
  cacheAsTexture(options: unknown): void { this.cacheChanges.push(options); }
  updateCacheTexture(): void { this.cacheUpdates++; }
  label = "";
  position = new FakePoint();
  scale = new FakePoint(1, 1);
  rotation = 0;
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

/** Every image an element draws with, by id. */
const elementImages = (id: string) =>
  shipManifest()
    .ambience.filter((element) => element.id === id)
    .flatMap(function ({ behaviour }) {
      switch (behaviour.kind) {
        case "backdrop-cycle":
          return Object.values(behaviour.phases);
        case "overlay":
          return [behaviour.image];
        case "flash":
          return behaviour.frames.map((frame) => frame.sprite.image);
        case "precip":
          return [...behaviour.drops.map((drop) => drop.sprite.image), ...(behaviour.splashes?.frames.map((frame) => frame.image) ?? [])];
        case "phase-frames":
          return behaviour.frames.map((frame) => frame.image);
        case "phase-strip":
          return [...behaviour.frames.sprites, ...Object.values(behaviour.byPhase).flat()].map((frame) => frame.image);
        case "drifters":
          return behaviour.sprites.flatMap((sprite) => [sprite.image, ...(sprite.variants ?? []).map((variant) => variant.frames[0]!.image)]);
        case "flyby":
          return Object.values(behaviour.poses).map((sprite) => sprite.image);
        default:
          return [...behaviour.frames.sprites, ...(behaviour.variants ?? []).flatMap((variant) => variant.frames)].map((sprite) => sprite.image);
      }
    });
const pathOf = (id: string) => shipViews().paths.get(id)!;
/** The still sea and foam's images, and the animated water's and its weather's: the two halves of what the water draws with. */
const stillWater = ["sea-still", "foam-still"].flatMap(elementImages);
const animatedWater = ["sea", "wake", "foam", "spindrift"].flatMap(elementImages);

/** The still sea and foam as the mount decodes them: each image a token naming its path. Null without them. */
type StillWater = { images: ReadonlyMap<string, unknown> } | null;
const environment: NonNullable<StillWater> = { images: new Map(stillWater.map((id) => [pathOf(id), { image: pathOf(id) }])) };

/** The extras as a test hands them over — the animated water and its weather among them — and which drifters were cut into their masks. */
type Extras = DeckExtrasImages & { masks?: "clouds" | "all" };

/** The images the sky's elements draw with, by id: always there unless `without`. */
const ambienceImages = new Set(
  shipManifest().ambience.flatMap(function ({ behaviour }) {
    switch (behaviour.kind) {
      case "backdrop-cycle":
        return Object.values(behaviour.phases);
      case "overlay":
        return [behaviour.image];
      case "flash":
        return behaviour.frames.map((frame) => frame.sprite.image);
      case "drifters":
        return behaviour.sprites.flatMap((sprite) => [sprite.image, ...(sprite.variants ?? []).map((variant) => variant.frames[0]!.image)]);
      case "flyby":
        return Object.values(behaviour.poses).map((sprite) => sprite.image);
      default:
        return [];
    }
  }),
);

/**
 * The pack's images by id, as the mount hands them over, each a token naming its path: the atlas; the sky's elements',
 * but those `without`; the still sea and foam's where `art` has them; and whatever of the extras arrived, the animated
 * water among them. With `masks`, each drifter's three slot masks, tokens too.
 */
function packImages(options: { extras?: Extras | null; without?: readonly string[] }, art: StillWater, atlas: unknown = { atlas: true }) {
  const handles = new Set(shipManifest().zones.zones.flatMap((zone) => zone.appearance === undefined ? [] : [zone.appearance.sprite.image]));
  for (const look of shipCast().looks) if (!look.optional) handles.add(look.image);
  for (const sprite of shipManifest().attentionCarrier?.frames ?? []) handles.add(sprite.image);
  const images = new Map(
    [...shipViews().paths].flatMap(([id, path]): Array<[string, unknown]> => {
      if (options.without?.includes(id)) return [];
      const image =
        path === "deck.png" ? atlas : ambienceImages.has(id) || handles.has(id) ? { image: path } : stillWater.includes(id) ? art?.images.get(path) : options.extras?.images.get(path);
      return image === undefined ? [] : [[id, image]];
    }),
  );
  const masks = new Map<string, DrifterMasks>(
    options.extras?.masks !== undefined
      ? [...ambienceImages]
          .filter((id) => images.has(id) && (shipViews().paths.get(id)!.startsWith("clouds/") || (options.extras?.masks === "all" && shipViews().paths.get(id)!.startsWith("storm/clouds/"))))
          .map((id) => [id, [0, 1, 2].map((slot) => ({ image: `${shipViews().paths.get(id)}#${slot}` })) as unknown as DrifterMasks])
      : [],
  );
  const ambience = compileAmbience(
    shipManifest(),
    (id) => images.has(id),
    (id) => masks.has(id),
  );
  return { images, masks, ambience, parts: compileParts(shipManifest(), (id) => images.has(id)) };
}

/** What the scenery is drawn from, for a test that draws it alone: the still sea and foam where `art` has them. */
function sceneryArt(options: { extras?: Extras | null; without?: readonly string[]; art?: StillWater }): SceneryArt {
  const { images, masks, ambience } = packImages(options, options.art ?? null);
  return { ambience, atmosphere: compileAtmosphere(shipManifest()), images, masks };
}

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
  const listeners = new Set<() => void>();
  const signals: MotionSignals = {
    reducedMotion: () => state.reducedMotion,
    documentHidden: () => state.hidden,
    subscribe(callback) {
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    },
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
    signal: () => { for (const listener of listeners) listener(); },
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
  art: StillWater,
  options: {
    reducedMotion?: boolean;
    hidden?: boolean;
    now: Date;
    extras?: Extras | null;
    /** Pack images that did not arrive, by id. */
    without?: readonly string[];
    scene?: DeckScene;
    stage?: DeckStage;
    ambience?: DeckAmbience;
    onHover?: (hover: DeckHover | null) => void;
    onSelect?: (key: string | null, action?: "attention") => void;
    attentionCarrier?: SettingManifest["attentionCarrier"];
    stageMotion?: SettingManifest["stage"]["motion"];
  },
) {
  const w = world(options);
  const host = { appendChild() {}, clientWidth: 800, clientHeight: 400 };
  // The pack's images by id, as the mount hands them over: the atlas, the ambience's, and whatever of the extras arrived.
  const atlas = { atlas: true };
  const { images, masks, ambience, parts } = packImages(options, art, atlas);
  if (options.stageMotion !== undefined) parts.motion = options.stageMotion;
  // These renderer tests isolate floor motion and explicit tint fixtures. The shipped raised station/night
  // palette are covered by post-transit tests and the real compiled-browser polish checks and visual gate.
  const floorStage = compileStage(shipManifest(), (id) => images.has(id));
  floorStage.transits = new Map();
  floorStage.phaseTint = null;
  const drawing = await startDeck(
    pixi,
    { stage: options.stage ?? floorStage, cast: shipCast(), parts, ambience: options.ambience ?? ambience, atmosphere: compileAtmosphere(shipManifest()), images, masks, image: atlas, effects: shipManifest().effects, attentionCarrier: options.attentionCarrier, presentation: deckPresentation(shipManifest()) },
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

const overcastEdges = [-1, 0, 1].flatMap((y) => [-1, 0, 1].filter((x) => x !== 0 || y !== 0).map((x) => `sky:overcast:edge:${x}:${y}`));

describe("viewport weather coverage, independent of setting names", () => {
  const full = { level: "full", animate: true, fps: 30, ambient: true } as const;
  const weather = { clocks: {}, channels: {}, intensity: 1 };
  function make(origin = 0, missing = false) {
    const frames = { sprites: [{ image: "a" }, { image: "b" }], frameMs: 100 };
    const tile = { kind: "tile", frames, origin, bands: [{ slot: "front", fromRow: 0 }], drift: { pxPerSecond: 3 },
      variants: [{ id: "heavy", frames: [{ image: "b" }, { image: "a" }], blend: "over", opacity: [[0, 0], [1, 0.5]] }] } as const;
    // A synthetic pack: tiny non-square textures expose grid alignment and edge crops.
    const manifest = { ...shipManifest(),
      images: Object.fromEntries(["a", "b", "sky", "veil"].map((image) => [image, { path: image, size: [32, 24], sha256: "" }])),
      ambience: [
        { id: "weather", slot: "front", order: 5, lite: "freeze", still: "hide", behaviour: tile },
        { id: "water", slot: "back", order: 2, lite: "freeze", still: "first-frame", behaviour: { ...tile, bands: [{ slot: "back", fromRow: 12 }, { slot: "front", fromRow: 20 }] } },
        { id: "low-band", slot: "back", order: 2, lite: "freeze", still: "first-frame", behaviour: { ...tile, bands: [{ slot: "back", fromRow: 12 }] } },
        { id: "background", slot: "back", order: 0, lite: "run", still: "first-frame", behaviour: { kind: "backdrop-cycle", size: [32, 24], placement: { horizonRow: 16, stageRow: 16 },
          phases: Object.fromEntries(shipManifest().dayCycle!.phases.map((phase) => [phase.id, "sky"])) } },
        { id: "darkening", slot: "back", order: 1, lite: "freeze", still: "hide", behaviour: { kind: "overlay", space: "background", image: "veil", alpha: { curve: [[0, 0], [1, 0.7]] } } },
        { id: "night-art", slot: "back", order: 1, lite: "freeze", still: "first-frame", behaviour: { kind: "overlay", space: "background", image: "veil", alpha: "night" } },
        { id: "positioned", slot: "front", order: 3, lite: "freeze", still: "first-frame", behaviour: { kind: "cycle", frames, at: [10, 20], anchor: [3, 4] } },
      ],
    } as unknown as SettingManifest;
    const ambience = compileAmbience(manifest, () => !missing);
    const scenery = createScenery(pixi, { width: 32, height: 24 }, {
      ambience, atmosphere: compileAtmosphere(manifest), masks: new Map(),
      images: new Map(["a", "b", "sky", "veil"].map((image) => [image, { image }])),
    });
    return { scenery, front: scenery.front as unknown as FakeContainer, back: scenery.back as unknown as FakeContainer };
  }
  const bounds = (sprite: FakeSprite) => ({ left: sprite.position.x, top: sprite.position.y,
    right: sprite.position.x + sprite.texture.frame.width * sprite.scale.x,
    bottom: sprite.position.y + sprite.texture.frame.height * sprite.scale.y });

  it.each([0, 5])("fills every aspect on the original grid, with origin %s, including top-only growth and resizing back", (origin) => {
    const { scenery, front, back } = make(origin);
    const cycle = one(front, "positioned");
    for (const visible of [
      { left: 0, right: 32, top: 0, bottom: 24 },
      { left: 0, right: 32, top: -170.5, bottom: 24 },
      { left: -100.2, right: 132.3, top: -4, bottom: 28 },
      { left: -20, right: 52, top: -20, bottom: 52 },
      { left: 0, right: 32, top: 0, bottom: 24 },
    ]) {
      scenery.layout(visible);
      scenery.draw(1.15, full, 720, weather);
      const base = one(front, "weather:front"), heavy = one(front, "weather:front:heavy");
      const tiles = base.children as FakeSprite[];
      expect(heavy.alpha).toBe(0.5);
      expect(base.position.x).toBe(heavy.position.x);
      expect(base.position.x).toBe(3);
      expect(heavy.children.map((s) => s.position)).toEqual(tiles.map((s) => s.position));
      expect(tiles.every((s) => texturePath(s) === "b")).toBe(true);
      expect(heavy.children.every((s) => texturePath(s) === "a")).toBe(true);
      // Every sample is in exactly one repeat, with the same texel phase on either side of y=0.
      for (const x of [visible.left, (visible.left + visible.right) / 2, visible.right - 0.01]) {
        for (const y of [visible.top, 0, visible.bottom - 0.01]) {
          const hits = tiles.filter((s) => { const b = bounds(s); return x >= b.left + base.position.x && x < b.right + base.position.x && y >= b.top && y < b.bottom; });
          expect(hits).toHaveLength(1);
          const s = hits[0]!;
          expect(((s.position.y - s.texture.frame.y - origin) % 24 + 24) % 24).toBe(0);
        }
      }
      expect(Math.min(...one(back, "water:back").children.map((s) => s.position.y))).toBe(12);
      expect(Math.min(...one(front, "water:front").children.map((s) => s.position.y))).toBe(20);
      expect(Math.min(...one(back, "low-band:back").children.map((s) => s.position.y))).toBe(12);
      expect(cycle.position).toMatchObject({ x: 7, y: 16 });
      expect(cycle.scale).toMatchObject({ x: 1, y: 1 });
      expect(byLabel(front, "positioned")).toHaveLength(1);
    }
    scenery.destroy();
  });

  it("extends weather overlay edge pixels without moving its image or extending night art", () => {
    const { scenery, back } = make();
    for (const visible of [{ left: 0, right: 32, top: 0, bottom: 24 }, { left: -80, right: 112, top: -100, bottom: 300 }]) {
      scenery.layout(visible);
      scenery.draw(0, full, 720, weather);
      const base = one(back, "background:darkening") as FakeSprite;
      const sky = one(back, "background:under");
      expect(base.position).toEqual(sky.position);
      expect(base.scale).toEqual(sky.scale);
      const overlays = back.children.filter((s) => s instanceof FakeSprite && texturePath(s) === "veil" && s !== one(back, "background:night-art")) as FakeSprite[];
      expect(overlays).toHaveLength(9);
      for (const x of [visible.left, (visible.left + visible.right) / 2, visible.right - 0.01]) {
        for (const y of [visible.top, (visible.top + visible.bottom) / 2, visible.bottom - 0.01]) {
          expect(overlays.filter((s) => { const b = bounds(s); return x >= b.left && x < b.right && y >= b.top && y < b.bottom; })).toHaveLength(1);
        }
      }
      expect(overlays.every((s) => s.alpha === 0.7)).toBe(true);
      expect(byLabel(back, "background:night-art")).toHaveLength(1);
    }
    scenery.destroy();
  });

  it("keeps lite frames and drift frozen, hides weather in still, and extends a missing tile's flat fallback", () => {
    const { scenery, front, back } = make();
    scenery.layout({ left: -20, right: 50, top: -100, bottom: 100 });
    scenery.draw(0.15, full, 720, weather);
    scenery.draw(9, { ...full, level: "lite" }, 720, weather);
    expect(one(front, "weather:front").position.x).toBe(0);
    expect(one(front, "weather:front").children.every((s) => texturePath(s) === "a")).toBe(true);
    scenery.draw(9, { ...full, level: "still" }, 720, { ...weather, intensity: null });
    expect(one(front, "weather:front").visible).toBe(false);
    expect(one(front, "weather:front:heavy").visible).toBe(false);
    expect(one(back, "background:darkening").visible).toBe(false);
    scenery.destroy();
    const missing = make(0, true);
    missing.scenery.layout({ left: -20, right: 50, top: -100, bottom: 100 });
    expect((one(missing.front, "weather:front") as FakeGraphics).shapes[0]!.slice(0, 5)).toEqual(["rect", -28, -100, 86, 208]);
    missing.scenery.destroy();
  });
});

describe("precipitation in the scenery renderer", () => {
  it("pools three depths, freezes and caches lite, resizes and releases its atlas textures", () => {
    const manifest = precipManifest();
    manifest.ambience = [manifest.ambience.at(-1)!];
    const scenery = createScenery(pixi, shipStage(), {
      ambience: compileAmbience(manifest, () => true), atmosphere: compileAtmosphere(manifest), masks: new Map(), images: new Map([["rain-test", { image: "test-rain" }]]),
    }, 42);
    const front = scenery.front as unknown as FakeContainer;
    const rain = one(front, "test-rain");
    const full = { level: "full", animate: true, fps: 30, ambient: true } as const;
    const weather = { clocks: {}, channels: {}, intensity: 1 };
    const visible = { left: -200, right: 800, top: -300, bottom: 300 };
    scenery.layout(visible, { width: 3840, height: 2160 });
    scenery.draw(0, full, 720, weather);
    expect(rain.children.map((layer) => layer.children.length)).toEqual([300, 200, 100]);
    const drop = one(rain, "test-rain:drop:0") as FakeSprite;
    const texture = drop.texture;
    const first = { ...drop.position };
    scenery.draw(0.033, full, 720, weather);
    expect(drop.position.y).toBeGreaterThan(first.y);
    const lite = { ...full, level: "lite" } as const;
    scenery.draw(2, lite, 720, weather);
    const held = { ...drop.position };
    for (let i = 0; i < 30; i++) scenery.draw(3 + i, lite, 720, weather);
    expect({ ...drop.position }).toEqual(held);
    expect(rain.cacheChanges).toEqual([{ resolution: 1, antialias: false, scaleMode: "nearest" }]);
    expect(rain.cacheUpdates).toBe(0);
    scenery.draw(34, lite, 720, { ...weather, intensity: .75 });
    expect(rain.alpha).toBeLessThan(1);
    expect({ ...drop.position }).toEqual(held);
    expect(rain.cacheUpdates).toBe(0);
    scenery.layout(visible, { width: 640, height: 480 });
    scenery.draw(40, lite, 720, weather);
    expect(rain.children.reduce((sum, layer) => sum + layer.children.length, 0)).toBe(52);
    expect(rain.cacheUpdates).toBe(1);
    scenery.draw(41, { ...full, level: "still" }, 720, { ...weather, intensity: null });
    expect(rain.visible).toBe(false);
    expect(rain.cacheChanges.at(-1)).toBe(false);
    scenery.destroy();
    expect(texture.destroyed).toBe(true);
    expect(texture.source.destroyed).toBe(true);
  });
});

describe("phase strips in the shared strip renderer", () => {
  const full = { level: "full", animate: true, fps: 30, ambient: true } as const;
  const lite = { ...full, level: "lite", fps: 12, ambient: false } as const;
  const still = { level: "still", animate: false, fps: 0, ambient: false } as const;
  function make() {
    const manifest = phaseStripFixture();
    const ambience = compileAmbience(manifest, () => true);
    const filters: Array<{ destroyed: boolean; destroy(): void }> = [];
    const module = { ...pixi, AlphaFilter: function () {
      const filter = { destroyed: false, destroy() { this.destroyed = true; } }; filters.push(filter); return filter;
    } } as unknown as PixiModule;
    const atmosphere = compileAtmosphere(manifest);
    const scenery = createScenery(module, shipStage(), { ...sceneryArt({}), ambience, atmosphere });
    const back = scenery.back as unknown as FakeContainer;
    const phase = (element: string, index: number) => one(back, `${element}:phase-${index}`);
    const pixels = (layer: FakeContainer) => layer.children.filter((child) => child.visible).map((child) => ({
      x: child.position.x, y: child.position.y, crop: (child as FakeSprite).texture.frame,
    }));
    return { scenery, atmosphere, phase, pixels, filters, ambience, module };
  }

  it("shares crops, wrap and frame clocks across both phases and a separate beam; holds only motion in still", () => {
    const { scenery, atmosphere, phase, pixels, filters } = make();
    scenery.layout({ left: -20, right: 440, top: -80, bottom: 220 });
    const weather = { ...deliveredWeather(atmosphere, 0), clocks: { voyage: 1.1 } };
    scenery.draw(999, full, 19.5 * 60, weather);
    expect(phase("test-coast", 2).alpha).toBe(0.84375);
    expect(phase("test-coast", 3).alpha).toBe(0.15625);
    const dusk = pixels(phase("test-coast", 2)), night = pixels(phase("test-coast", 3));
    expect(dusk.map((p) => [p.x, p.crop.x, p.crop.width])).toEqual(night.map((p) => [p.x, p.crop.x, p.crop.width]));
    expect(dusk[0]!.crop.x).toBe(248); // floor(1.1 * 8), independent of scene seconds
    const beam = pixels(phase("test-beam", 3));
    expect(beam.map((p) => [p.x, p.crop.x, p.crop.width])).toEqual(dusk.map((p) => [p.x, p.crop.x, p.crop.width]));
    expect(beam[0]!.crop.y).toBe(208); // beam frame 3 modulo 3
    scenery.draw(999, lite, 19.5 * 60, { ...weather, clocks: { voyage: 32.45 } });
    expect(pixels(phase("test-coast", 3))[0]!.crop.x).toBe(253); // whole lap + 3 pixels
    expect(pixels(phase("test-beam", 3))[0]!.crop.y).toBe(208);
    scenery.draw(999, full, 19.5 * 60, { ...weather, clocks: { voyage: 0.45 } });
    expect(pixels(phase("test-beam", 3))[0]!.crop.y).toBe(224);
    scenery.draw(999, still, 21 * 60, weather);
    expect(pixels(phase("test-beam", 3))[0]!.crop.y).toBe(208);
    expect(pixels(phase("test-coast", 3))[0]!.crop.x).toBe(0);
    expect(phase("test-coast", 3).alpha).toBe(1);
    scenery.draw(999, still, 12 * 60, weather);
    expect(phase("test-coast", 3).visible).toBe(false);
    expect(phase("test-coast", 1).alpha).toBe(1);
    scenery.destroy();
    expect(filters).toHaveLength(2);
    expect(filters.every((filter) => filter.destroyed)).toBe(true);
  });

  it("honors lite freeze/hide and still hide without changing the day blend", () => {
    const { scenery: initial, ambience, module, atmosphere } = make();
    initial.destroy();
    ambience.elements[0]!.lite = "freeze";
    ambience.elements[1]!.lite = "hide";
    ambience.elements[0]!.still = "hide";
    const scenery = createScenery(module, shipStage(), { ...sceneryArt({}), ambience, atmosphere });
    const back = scenery.back as unknown as FakeContainer;
    scenery.draw(12, lite, 21 * 60);
    expect((one(back, "test-coast:phase-3").children[0] as FakeSprite).texture.frame.x).toBe(0);
    expect(one(back, "test-beam:phase-3").visible).toBe(false);
    scenery.draw(12, still, 21 * 60);
    expect(one(back, "test-coast:phase-3").visible).toBe(false);
    scenery.destroy();
  });
});

describe("world-depth tile colour", () => {
  it("shares one gradient across front/back bands, follows day in still mode, and covers resized panes", () => {
    const manifest = structuredClone(shipManifest());
    const tile = manifest.ambience.find((element) => element.id === "sea")!;
    if (tile.behaviour.kind !== "tile") throw new Error("sea must be tiled");
    tile.behaviour.depthWash = { rows: [500, 1200], byPhase: Object.fromEntries(manifest.dayCycle!.phases.map(({ id }) =>
      [id, { colour: id === "night" ? "#173B44" : "#36696B", alpha: [.34, .14] }])), opacity: { channel: "wind" } };
    manifest.ambience = [tile];
    const ambience = compileAmbience(manifest, () => true), atmosphere = compileAtmosphere(manifest);
    const scenery = createScenery(pixi, shipStage(), { ...sceneryArt({}), ambience, atmosphere });
    const still = { level: "still", animate: false, fps: 0, ambient: false } as const;
    scenery.layout({ left: -50, right: 900, top: -300, bottom: 1700 });
    scenery.draw(0, still, 720);
    const back = one(scenery.back as unknown as FakeContainer, "sea:back:depth-wash") as FakeGraphics;
    const front = one(scenery.front as unknown as FakeContainer, "sea:front:depth-wash") as FakeGraphics;
    expect(front.visible).toBe(true);
    expect(front.alpha).toBeGreaterThan(0);
    const row = (g: FakeGraphics) => g.shapes.find((shape) => shape[2] === 700)!;
    expect(row(back)).toEqual(row(front));
    expect(row(front).at(-1)).toMatchObject({ color: 0x36696b });
    const shapes = front.shapes;
    scenery.draw(20, still, 720);
    expect(front.shapes).toBe(shapes);
    scenery.draw(20, still, 1260);
    expect(row(front).at(-1)).toMatchObject({ color: 0x173b44 });
    scenery.layout({ left: -200, right: 1100, top: -600, bottom: 2200 });
    scenery.draw(20, still, 1260);
    expect(row(front)[1]).toBeLessThanOrEqual(-200);
    const last = front.shapes.at(-1)!;
    expect(Number(last[2]) + Number(last[4])).toBeGreaterThanOrEqual(2200);
    scenery.destroy();
  });
});

describe("wall-clock frame layers", () => {
  const definition = (): SettingManifest => ({
    ...shipManifest(), dayCycle: undefined,
    ambience: [
      { id: "hour", slot: "front", order: 2, lite: "run", still: "first-frame", behaviour: {
        kind: "phase-frames", by: "local-hour", at: [100, 60], anchor: [5, 5],
        frames: Array.from({ length: 12 }, (_, i) => ({ image: "deck", rect: [i * 10, 0, 10, 10] })),
      } },
      { id: "minute", slot: "back", order: 0, lite: "freeze", still: "hide", behaviour: {
        kind: "phase-frames", by: "local-minute", at: [40, 30], anchor: [0, 0],
        frames: Array.from({ length: 6 }, (_, i) => ({ image: "deck", rect: [i * 10, 10, 10, 10] })),
      } },
      { id: "hidden-in-lite", slot: "front", order: 1, lite: "hide", still: "hide", behaviour: {
        kind: "phase-frames", by: "local-hour", at: [80, 30], anchor: [0, 0], frames: [{ image: "deck" }],
      } },
    ],
  });
  const compiled = () => compileAmbience(definition(), () => true);
  const frame = (root: FakeContainer, id: string) => (one(root, id) as FakeSprite).texture.frame.x;

  it("anchors each sprite in slot order, follows local time in full/lite, and keeps reduced motion calm", () => {
    const art = { ...sceneryArt({}), ambience: compiled() };
    const scenery = createScenery(pixi, shipStage(), art);
    const other = createScenery(pixi, shipStage(), art);
    const front = scenery.front as unknown as FakeContainer, back = scenery.back as unknown as FakeContainer;
    const full = { level: "full", animate: true, fps: 30, ambient: true } as const;
    scenery.layout({ left: -10, right: 440, top: -80, bottom: 240 });
    expect(front.children.map((child) => child.label)).toEqual(["hidden-in-lite", "hour"]);
    expect(back.children.map((child) => child.label)).toEqual(["minute"]);
    expect(one(front, "hour").position).toMatchObject({ x: 95, y: 55 });
    scenery.draw(9999, full, 13 * 60 + 5, { ...deliveredWeather(art.atmosphere, 9999), intensity: 1 });
    expect(frame(front, "hour")).toBe(10);
    expect(frame(back, "minute")).toBe(50);
    expect(one(front, "hour").tint).toBe(0xffffff);
    other.draw(0, full, 4 * 60);
    expect(frame(other.front as unknown as FakeContainer, "hour")).toBe(40);
    expect(frame(front, "hour")).toBe(10);
    scenery.draw(0, { ...full, level: "lite", fps: 12, ambient: false }, 23 * 60 + 59);
    expect(frame(front, "hour")).toBe(110);
    expect(frame(back, "minute")).toBe(0);
    expect(one(front, "hidden-in-lite").visible).toBe(false);
    scenery.draw(0, { level: "still", animate: false, fps: 0, ambient: false }, 23 * 60 + 59);
    expect(frame(front, "hour")).toBe(0);
    expect(one(back, "minute").visible).toBe(false);
    scenery.draw(0, full, 0);
    expect(frame(front, "hour")).toBe(0);
    scenery.draw(0, full, NaN);
    expect(frame(back, "minute")).toBe(0);
    const textures = [one(front, "hour"), one(back, "minute")] as FakeSprite[];
    scenery.destroy(); other.destroy();
    expect(textures.every((sprite) => sprite.texture.destroyed && sprite.texture.source.destroyed)).toBe(true);
  });

  it("shares the renderer's wall clock and pause path, with no new timer or animation in still mode", async () => {
    const deck = await start(null, { now: new Date(2026, 9, 15, 10, 5), ambience: compiled() });
    deck.advance(34);
    expect(frame(deck.app.stage, "hour")).toBe(100);
    deck.state.hidden = true;
    deck.signal();
    deck.state.now = new Date(2026, 9, 15, 11, 6);
    const before = renders;
    deck.advance(60_000);
    expect(renders).toBe(before);
    expect(frame(deck.app.stage, "hour")).toBe(100);
    deck.state.hidden = false;
    deck.signal();
    deck.advance(34);
    expect(frame(deck.app.stage, "hour")).toBe(110);
    deck.state.reducedMotion = true;
    deck.signal();
    deck.advance(34);
    expect(frame(deck.app.stage, "hour")).toBe(0);
    expect(one(deck.app.stage, "minute").visible).toBe(false);
    expect(deck.pending()).toBe(0);
    expect(deck.timers.map((timer) => timer.ms)).toEqual([SKY_REFRESH_MS]);
    deck.state.now = new Date(2026, 9, 15, 15, 20);
    deck.timers[0]!.run();
    expect(frame(deck.app.stage, "hour")).toBe(0);
    deck.drawing.destroy();
    expect(deck.timers.every((timer) => timer.stopped)).toBe(true);
  });
});

describe("the generated environment on the deck", () => {
  it("draws back to front: sky, overcast, stars, gull, far sea; then the ship and its crew; then the near sea and the foam", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0) });
    deck.advance(16);
    const worldLayer = one(deck.app.stage, "world");
    expect(worldLayer.children.map((child) => child.label)).toEqual(["scenery:back", "ship", "scenery:front", "overboard", "veil", "spot", "attention-carrier"]);
    // Nobody focused: no veil, an empty spotlight.
    expect(one(worldLayer, "veil").visible).toBe(false);
    expect(one(worldLayer, "spot").children).toHaveLength(0);
    const back = one(deck.app.stage, "scenery:back");
    // No clouds without their masks, and no lightning without clouds to stand under.
    expect(back.children.map((child) => child.label)).toEqual(["sky:under", "sky:over", "sky:overcast", ...overcastEdges, "sky:stars", "gull", "gull", "sea:back"]);
    // No wake without its frames: the one drawn in code is retired.
    expect(one(deck.app.stage, "scenery:front").children.map((child) => child.label)).toEqual(["sea:front", "foam"]);
    // The crew's deck is inside the ship, so every sailor is in front of the sky and the far sea.
    expect(one(one(deck.app.stage, "ship"), "deck")).toBeDefined();

    // The far sea from the horizon down; the near sea from the waterline, cut to line up with it.
    const far = one(back, "sea:back").children as FakeSprite[];
    const near = one(deck.app.stage, "sea:front").children as FakeSprite[];
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
    const far = one(deck.app.stage, "sea:back");
    const positions = new Set<number>();
    let gullSeen = false;
    // A minute of frames: the water drifts whole pixels, and in a minute a gull has crossed.
    for (let frame = 0; frame < 1800; frame += 1) {
      deck.advance(34);
      positions.add(far.position.x);
      if (byLabel(deck.app.stage, "gull").some((gull) => gull.visible)) gullSeen = true;
    }
    expect(positions.size).toBeGreaterThan(100);
    expect([...positions].every((x) => Number.isInteger(x) && x >= 0 && x < 512)).toBe(true);
    expect(one(deck.app.stage, "sea:front").position.x).toBe(far.position.x);
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
    expect(one(deck.app.stage, "sea:back").position.x).toBe(0);
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
    expect(one(deck.app.stage, "sea:back").position.x).toBe(0);
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

  it("without its still sea, draws a plain sea at the horizon and the waterline, under the sky as ever", async () => {
    const deck = await start(null, { now: new Date(2026, 9, 14, 12, 0) });
    deck.advance(16);
    expect(one(deck.app.stage, "world").children.map((child) => child.label)).toEqual(["scenery:back", "ship", "scenery:front", "overboard", "veil", "spot", "attention-carrier"]);
    expect(one(deck.app.stage, "scenery:back").children.map((child) => child.label)).toEqual(["sky:under", "sky:over", "sky:overcast", ...overcastEdges, "sky:stars", "gull", "gull", "sea:back"]);
    expect(deck.app.canvas.attributes.get(DECK_SKY_ATTRIBUTE)).toBe("midday");
    const far = one(deck.app.stage, "sea:back") as FakeGraphics;
    const near = one(deck.app.stage, "sea:front") as FakeGraphics;
    expect(far.shapes[0]?.[2]).toBe(HORIZON);
    expect(near.shapes[0]?.[2]).toBe(WATERLINE);
    expect(far.shapes[0]?.[5]).toBe(Number.parseInt(shipManifest().palette.fallbackFill.slice(1), 16));
    deck.drawing.destroy();
  });

  it("falls back the same way when the still sea is missing an image it names", async () => {
    const partial: StillWater = { images: new Map([...environment.images].filter(([path]) => path !== "sea/water-tile.png")) };
    const deck = await start(partial, { now: new Date(2026, 9, 14, 12, 0) });
    deck.advance(16);
    expect(one(deck.app.stage, "sea:back")).toBeInstanceOf(FakeGraphics);
    expect(deck.app.canvas.attributes.get(DECK_SKY_ATTRIBUTE)).toBe("midday");
    deck.drawing.destroy();
  });

  it("leaves out each element of the ambience on its own: no sky without a phase of it, nor what is drawn in it; the gull flies on", async () => {
    const skyless = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: { ...extras, masks: "all" }, without: ["sky-dawn"] });
    skyless.advance(16);
    expect(one(skyless.app.stage, "scenery:back").children.map((child) => child.label)).toEqual(["gull", "gull", "sea:back", "sea:back:rough-sea"]);
    expect(skyless.app.canvas.attributes.get(DECK_SKY_ATTRIBUTE)).toBe("none");
    skyless.drawing.destroy();
    const starless = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: { ...extras, masks: "all" }, without: ["sky-stars", "gull-flap-strip"] });
    starless.advance(16);
    expect(one(starless.app.stage, "scenery:back").children.map((child) => child.label)).toEqual(["sky:under", "sky:over", "sky:overcast", ...overcastEdges, "flash:lightning", "clouds", "sea:back", "sea:back:rough-sea"]);
    starless.drawing.destroy();
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

const extrasManifest = shipViews().extras;
/** The ship's parts and pieces, as the pack has them. */
const stagePart = (id: string) => shipManifest().stage.parts.find((part) => part.id === id)!;
const plankPiece = shipManifest().stage.pieces.find((piece) => piece.id === "plank")!;
/** The extra looks' images: the cast's, decoded with the rest of the pack, and handed to the deck beside the extras'. */
const lookPaths = shipCast()
  .looks.filter((look) => look.optional)
  .map((look) => shipViews().paths.get(look.image)!);
/** The tall mast's, the sail's and the plank's images: what the extras once had of the stage. */
const stagePaths = ["mast-tall-mast", "sails-main-sail", "plank-plank", "polish-ladder"].map(pathOf);
/** The extras as a test hands them over — the shark and splash, the looks, the stage's own and the water — each a token naming its path. */
const extras: DeckExtrasImages = {
  manifest: extrasManifest,
  images: new Map([...extrasImagePaths(extrasManifest), ...stagePaths, ...lookPaths, ...animatedWater.map(pathOf)].map((path) => [path, { image: path }])),
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

describe("phase tint on stage art", () => {
  function tintedStage() {
    const manifest = structuredClone(shipManifest());
    manifest.stage.tintByPhase = { night: "#8080FF" };
    manifest.palette.staleTint = "#808080";
    return compileStage(manifest);
  }

  it("tints every stage artwork slot and actor body, preserving badges, depth and focused tint", async () => {
    const scene = crewScene([["a", "working"], ["b", "idle"]]);
    scene.sailors[0]!.asks = true;
    scene.sailors[1]!.stale = true;
    const stage = tintedStage();
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12), extras, scene, stage });
    deck.advance(16);
    const artLabels = ["hull:0", "hull:1", "hull:2", "tall-mast", "topmast", "sail",
      ...stage.props.map(({ id }) => `prop:${id}`), "piece:mast:tall-mast", "piece:near", "piece:plank",
      ...shipManifest().stage.lights.map(({ id }) => `light:${id}`)];
    const depths = artLabels.map((label) => one(deck.app.stage, label).zIndex);
    const controls = sailorSprites(deck.app.stage, "a").root.children.filter((child) => child instanceof FakeGraphics);
    const marks = controls.map((child) => structuredClone((child as FakeGraphics).shapes));
    deck.state.now = new Date(2026, 9, 14, 23);
    deck.advance(40);
    expect(artLabels.map((label) => one(deck.app.stage, label).tint)).toEqual(artLabels.map(() => 0x8080ff));
    expect(artLabels.map((label) => one(deck.app.stage, label).zIndex)).toEqual(depths);
    expect(sailorSprites(deck.app.stage, "a").sprite.tint).toBe(0x8080ff);
    const stale = sailorSprites(deck.app.stage, "b");
    expect([stale.sprite.tint, stale.upper.tint]).toEqual([0x404080, 0x404080]);
    expect(stale.sprite.alpha).toBe(stage.palette.staleAlpha);
    expect(controls.map((child) => child.tint)).toEqual(controls.map(() => 0xffffff));
    expect(controls.map((child) => (child as FakeGraphics).shapes)).toEqual(marks);
    for (const label of ["world", "ship", "deck", "scenery:back", "scenery:front", "overboard", "veil", "spot"])
      expect(one(deck.app.stage, label).tint).toBe(0xffffff);
    deck.drawing.focus("a");
    deck.advance(FOCUS_MS);
    expect(one(deck.app.stage, "spot").children.map(({ label }) => label)).toContain("a");
    expect(sailorSprites(deck.app.stage, "a").sprite.tint).toBe(0x8080ff);
    deck.state.now = new Date(2026, 9, 15, 12);
    deck.advance(40);
    expect(artLabels.map((label) => one(deck.app.stage, label).tint)).toEqual(artLabels.map(() => 0xffffff));
    expect(sailorSprites(deck.app.stage, "a").sprite.tint).toBe(0xffffff);
    expect(sailorSprites(deck.app.stage, "b").sprite.tint).toBe(0x808080);
    deck.drawing.destroy();
  });

  it("follows the minute refresh in still mode without motion, and draws nothing while hidden", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12), reducedMotion: true, stage: tintedStage(), scene: twoWorking() });
    expect(one(deck.app.stage, "hull:0").tint).toBe(0xffffff);
    const skyTimer = deck.timers.find(({ ms }) => ms === SKY_REFRESH_MS)!;
    deck.state.now = new Date(2026, 9, 14, 23);
    deck.state.hidden = true;
    const before = renders;
    skyTimer.run();
    expect(renders).toBe(before);
    expect(one(deck.app.stage, "hull:0").tint).toBe(0xffffff);
    deck.state.hidden = false;
    skyTimer.run();
    expect(one(deck.app.stage, "hull:0").tint).toBe(0x8080ff);
    expect(deck.pending()).toBe(0);
    expect(one(deck.app.stage, "ship").position.y).toBe(0);
    expect(deck.app.canvas.attributes.get(DECK_WEATHER_ATTRIBUTE)).toBe("still");
    deck.state.now = new Date(Number.NaN);
    skyTimer.run();
    expect(one(deck.app.stage, "hull:0").tint).toBe(0xffffff); // fallback is midday
    deck.drawing.destroy();
    expect(skyTimer.stopped).toBe(true);
  });

  it("works without a backdrop image and keeps separately mounted packs independent", async () => {
    const options = { now: new Date(2026, 9, 14, 23), reducedMotion: true, without: Object.values(shipElement("sky", "backdrop-cycle").phases) };
    const tinted = await start(environment, { ...options, stage: tintedStage() });
    const plain = await start(environment, options);
    expect(tinted.app.canvas.attributes.get(DECK_SKY_ATTRIBUTE)).toBe("none");
    expect(one(tinted.app.stage, "hull:0").tint).toBe(0x8080ff);
    expect(one(plain.app.stage, "hull:0").tint).toBe(0xffffff);
    tinted.drawing.destroy();
    plain.drawing.destroy();
  });

  it("leaves effects-slot actors and portal effects in their own colours after crossing out of the stage", async () => {
    const scene = crewScene([["a", "working"], ["b", "idle"]]);
    const deck = await start(environment, { now: new Date(2026, 9, 14, 23), extras, scene, stage: tintedStage() });
    deck.advance(16);
    deck.drawing.update({ ...scene, sailors: scene.sailors.slice(1), departures: { a: "done" } });
    let actorSeen = false, effectSeen = false;
    for (let frame = 0; frame < 600; frame++) {
      deck.advance(40);
      expect(sailorSprites(deck.app.stage, "b").sprite.tint).toBe(0x8080ff);
      for (const child of one(deck.app.stage, "overboard").children) {
        if (child.label.startsWith("a~")) {
          actorSeen = true;
          expect(child.children[1]!.tint).toBe(0xffffff);
        } else if (child instanceof FakeSprite) {
          effectSeen = true;
          expect(child.tint).toBe(0xffffff);
        }
      }
    }
    expect([actorSeen, effectSeen]).toEqual([true, true]);
    deck.drawing.destroy();
  });
});

describe("the sail, the crew's looks and the wake on the deck", () => {
  it("stands the tall mast in the short rig's place, the sail higher on it and its own lower rows the mast's depth piece", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras });
    deck.advance(16);
    const ship = one(deck.app.stage, "ship");
    expect(ship.children.map((child) => child.label)).toEqual(["hull:0", "hull:1", "hull:2", "tall-mast", "topmast", "access-ladder", "sail", "deck"]);
    // The hull's short rig — its crow's nest, upper mast and stays — is not drawn: the slices go round it.
    const [cutX, , cutWidth, cutHeight] = stagePart("tall-mast").cutout!;
    const slices = ["hull:0", "hull:1", "hull:2"].map((label) => one(ship, label) as FakeSprite);
    expect(slices.map((slice) => [slice.position.x, slice.position.y, slice.texture.frame.width, slice.texture.frame.height])).toEqual([
      [0, 0, cutX, 161],
      [cutX, cutHeight, cutWidth, 161 - cutHeight],
      [cutX + cutWidth, 0, 426 - cutX - cutWidth, 161],
    ]);
    // The tall mast in two: its crow's nest and topmast, which sway, and the rest down to its foot.
    const head = one(ship, "topmast") as FakeSprite;
    const shaft = one(ship, "tall-mast") as FakeSprite;
    expect([texturePath(head), texturePath(shaft)]).toEqual(["mast/tall-mast.png", "mast/tall-mast.png"]);
    expect([head.position.y, head.texture.frame.y, head.texture.frame.height]).toEqual([-80, 0, 20]);
    expect(Math.abs(head.position.x - 187)).toBeLessThanOrEqual(1);
    expect([shaft.position.x, shaft.position.y, shaft.texture.frame.y, shaft.texture.frame.height]).toEqual([187, -60, 20, 172]);
    // The taller sail on it, at its yard's lashing point, one 114 × 84 state of its strip.
    const sail = one(ship, "sail") as FakeSprite;
    expect([sail.position.x, sail.position.y]).toEqual([154, -15]);
    expect(texturePath(sail)).toBe("sails/main-sail.png");
    expect([sail.texture.frame.width, sail.texture.frame.height]).toEqual([114, 84]);
    // Its rows below the sail's hem, on the mast's row, stand in for the mast piece: never over the cloth.
    expect(byLabel(deck.app.stage, "piece:mast")).toEqual([]);
    const depth = one(deck.app.stage, "piece:mast:tall-mast") as FakeSprite;
    expect(texturePath(depth)).toBe("mast/tall-mast.png");
    expect([depth.position.x, depth.position.y, depth.zIndex]).toEqual([187, 69, depthOf(110, 1)]);
    expect([depth.texture.frame.y, depth.texture.frame.height]).toEqual([149, 43]);
    expect(sail.position.y + sail.texture.frame.height).toBe(depth.position.y);
    expect(byLabel(deck.app.stage, "piece:near")).toHaveLength(1);
    deck.drawing.destroy();
  });

  it("sways the mast tip a pixel each way and holds the occupied basket, shaft and foot still", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras });
    deck.advance(0);
    const head = one(deck.app.stage, "topmast") as FakeSprite;
    const shaft = one(deck.app.stage, "tall-mast") as FakeSprite;
    const sways = new Set<number>();
    for (let frame = 0; frame < 300; frame += 1) {
      deck.advance(34);
      sways.add(head.position.x - 187);
      expect([shaft.position.x, shaft.position.y, head.position.y]).toEqual([187, -60, -80]);
    }
    expect(sways).toEqual(new Set([-1, 0, 1]));
    deck.drawing.destroy();
  });

  it("without the tall mast, draws the hull's short rig bare: no sail fitted to a mast that is not there", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: shortRig });
    deck.advance(16);
    const ship = one(deck.app.stage, "ship");
    // The hull's own masthead, in the topmast's place.
    expect(ship.children.map((child) => child.label)).toEqual(["hull:0", "hull:1", "hull:2", "topmast", "deck"]);
    const masthead = one(ship, "topmast") as FakeSprite;
    const { frame } = (masthead as FakeSprite).texture;
    expect([frame.x, frame.y, frame.width, frame.height]).toEqual([188, 0, 54, 48]);
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
      expect([sail.position.x, sail.position.y]).toEqual(stagePart("sail").at);
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
    expect(byLabel(bare.app.stage, "tall-mast")).toEqual([]);
    expect(byLabel(bare.app.stage, "piece:mast")).toHaveLength(1);
    bare.drawing.destroy();
    // The tall mast without its sail still stands, its rows from below where the sail hangs the mast piece's, as the pack cuts them.
    const bareTall = { manifest: extrasManifest, images: new Map([...extras.images].filter(([path]) => path !== "sails/main-sail.png")) };
    const tall = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: bareTall });
    expect(byLabel(tall.app.stage, "sail")).toEqual([]);
    expect(byLabel(tall.app.stage, "tall-mast")).toHaveLength(1);
    expect((one(tall.app.stage, "piece:mast:tall-mast") as FakeSprite).position.y).toBe(69);
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
      const look = shipCast().looks.find(look => pathOf(look.image) === texturePath(sprite))!;
      expect([sprite.texture.frame.x, sprite.texture.frame.y, sprite.texture.frame.width, sprite.texture.frame.height]).toEqual(standing(shipCast(), look.lane, "hauling").frame);
    }
    deck.drawing.destroy();
    const partial = { manifest: extrasManifest, images: new Map([...extras.images].filter(([path]) => !path.includes("bosun"))) };
    const fewer = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: partial, scene, reducedMotion: true });
    const wornFewer = scene.sailors.map((sailor) => lookOf(fewer.app.stage, sailor.key));
    expect(wornFewer.some((path) => path.includes("bosun"))).toBe(false);
    fewer.drawing.destroy();
  });

  it("breathes an at-ease sailor: its head and shoulders a pixel lower over its planted body, then whole again", async () => {
    const stage = compileStage(shipManifest());
    stage.zoneOf("idle").appearance = null;
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, stage, scene: crewScene([["rest", "idle"]]) });
    deck.advance(0);
    const { sprite, upper } = sailorSprites(deck.app.stage, "rest");
    const lane = shipCast().looks.find(look => pathOf(look.image) === texturePath(sprite))!.lane;
    const posed = standing(shipCast(), lane, "side-idle");
    const seen = { whole: 0, out: 0 };
    for (let frame = 0; frame < 200; frame += 1) {
      deck.advance(34);
      if (upper.visible) {
        seen.out += 1;
        expect(upper.texture.frame.height).toBe(BREATH_ROWS);
        expect(sprite.texture.frame.y).toBe(upper.texture.frame.y + BREATH_ROWS);
        expect(sprite.texture.frame.height).toBe(posed.frame[3] - BREATH_ROWS);
        // The body where the whole sailor's rows would be; the head and shoulders a pixel lower; mirrored alike.
        expect(sprite.anchor.y).toBe(0);
        expect(upper.position.y).toBe(sprite.position.y - BREATH_ROWS + 1);
        expect(sprite.position.y + posed.frame[3] - BREATH_ROWS).toBe(posed.frame[3] - posed.feet[1]);
        expect(upper.scale.x).toBe(sprite.scale.x);
      } else {
        seen.whole += 1;
        expect(sprite.texture.frame.height).toBe(posed.frame[3]);
      }
    }
    expect(seen.whole).toBeGreaterThan(20);
    expect(seen.out).toBeGreaterThan(20);
    deck.drawing.destroy();
  });

  it("lets go of the sail's and the looks' textures and sources when torn down", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras, scene: crewScene([["a", "working"], ["b", "idle"]]) });
    deck.advance(16);
    const sprites = [
      one(deck.app.stage, "sail"),
      one(deck.app.stage, "tall-mast"),
      one(deck.app.stage, "topmast"),
      one(deck.app.stage, "piece:mast:tall-mast"),
      one(deck.app.stage, "piece:plank"),
      sailorSprites(deck.app.stage, "a").sprite,
    ] as FakeSprite[];
    deck.drawing.destroy();
    expect(sprites.every((sprite) => sprite.texture.destroyed && sprite.texture.source.destroyed)).toBe(true);
  });
});

describe("attention carriers in the renderer", () => {
  const now = new Date(2026, 9, 14, 12, 0), attentionCarrier = shipManifest().attentionCarrier!;
  const scene = () => {
    const value = crewScene([["a", "working"], ["remote:b", "idle"]]);
    value.sailors.forEach(sailor => { sailor.asks = true; });
    value.hasSuggestions = true;
    return value;
  };
  const at = (deck: Awaited<ReturnType<typeof start>>, x = 32, y = 34) => {
    const carrier = one(deck.app.stage, "attention-carrier"), world = one(deck.app.stage, "world");
    return { offsetX: world.position.x + (carrier.position.x + x) * world.scale.x, offsetY: world.position.y + (carrier.position.y + y) * world.scale.y };
  };
  it("draws one independently loitering target, keeps per-worker markers, and routes body and bubble to suggestions without the stage bob", async () => {
    const selected: unknown[] = [], hovers: Array<DeckHover | null> = [];
    const deck = await start(environment, { now, extras, scene: scene(), attentionCarrier, onSelect: (key, action) => selected.push([key, action]), onHover: hover => hovers.push(hover) });
    const carrier = one(deck.app.stage, "attention-carrier");
    const frames = new Set<string>();
    for (let i = 0; i < 120; i++) { deck.advance(34); frames.add(texturePath(one(carrier, "carrier-above-surface"))); }
    expect(frames.size).toBe(4);
    expect(one(deck.app.stage, "ship").children).not.toContain(carrier);
    for (const key of ["a", "remote:b"]) expect(one(one(deck.app.stage, key), "ask").visible).toBe(true);
    deck.app.canvas.listeners.get("pointermove")?.(at(deck));
    expect(hovers.at(-1)).toMatchObject({ key: "suggestions", action: "attention" });
    deck.app.canvas.listeners.get("click")?.(at(deck));
    deck.drawing.resize(1200, 600);
    deck.advance(34);
    deck.app.canvas.listeners.get("click")?.(at(deck, 32, 10));
    expect(selected).toEqual([["suggestions", "attention"], ["suggestions", "attention"]]);
    deck.drawing.focus("a"); deck.advance(34);
    expect(carrier.visible).toBe(false);
    const sprite = one(carrier, "carrier-above-surface") as FakeSprite;
    deck.drawing.destroy();
    expect(sprite.texture.destroyed && sprite.texture.source.destroyed).toBe(true);
    expect(deck.app.canvas.listeners.size).toBe(0);
  });

  it("holds the first frame without a loop, keeps the shark for stale/removed crew, and keeps a bubble if all carrier art is missing", async () => {
    for (const missing of [false, true]) {
      const selected: unknown[] = [];
      const deck = await start(environment, { now, extras, scene: scene(), attentionCarrier, reducedMotion: true,
        without: missing ? attentionCarrier.frames.map(sprite => sprite.image) : [], onSelect: (key, action) => selected.push([key, action]) });
      const carrier = one(deck.app.stage, "attention-carrier");
      expect(deck.pending()).toBe(0);
      expect(carrier.position).toMatchObject({ x: 4, y: 122 });
      expect(one(carrier, "carrier-above-surface").visible).toBe(!missing);
      expect(one(carrier, "carrier-fallback").visible).toBe(missing);
      deck.app.canvas.listeners.get("click")?.(at(deck, 30, 6));
      expect(selected).toEqual([["suggestions", "attention"]]);
      const stale = scene(); stale.sailors.forEach(sailor => { sailor.stale = true; });
      deck.drawing.update(stale);
      expect(carrier.visible).toBe(true);
      deck.app.canvas.listeners.get("click")?.(at(deck));
      expect(selected.at(-1)).toEqual(["suggestions", "attention"]);
      deck.drawing.update(scene()); expect(carrier.visible).toBe(true);
      deck.drawing.update(crewScene([])); expect(carrier.visible).toBe(true);
      if (!missing) {
        const sprite = one(carrier, "carrier-above-surface") as FakeSprite;
        expect(sprite.position.y).toBe(attentionCarrier.bubbleHeight);
        expect(sprite.texture.frame.height).toBe(attentionCarrier.size[1] - attentionCarrier.bubbleHeight!);
      }
      deck.drawing.destroy();
      expect(deck.timers.every(timer => timer.stopped)).toBe(true);
    }
  });
  it("fits its missing-art bubble to an arbitrary carrier size and position", async () => {
    const carrier = { ...attentionCarrier, at: [110, 40] as [number, number], size: [8, 6] as [number, number],
      frames: attentionCarrier.frames.map(sprite => ({ ...sprite, rect: [0, 0, 8, 6] as [number, number, number, number] })) };
    const deck = await start(environment, { now, scene: scene(), attentionCarrier: carrier, reducedMotion: true,
      without: carrier.frames.map(sprite => sprite.image) });
    const root = one(deck.app.stage, "attention-carrier"), fallback = one(root, "carrier-fallback");
    expect(root.position).toMatchObject({ x: 110, y: 40 });
    expect(fallback.visible).toBe(true);
    expect(fallback.position.x).toBeGreaterThanOrEqual(0);
    expect(fallback.position.y).toBeGreaterThanOrEqual(0);
    expect(fallback.scale.x).toBeLessThan(1);
    expect(fallback.position.x + ASK_SIZE.width * fallback.scale.x).toBeLessThanOrEqual(8);
    expect(fallback.position.y + ASK_SIZE.height * fallback.scale.y).toBeLessThanOrEqual(6);
    deck.drawing.destroy();
  });
});

describe("settled zone handles in the renderer", () => {
  const now = new Date(2026, 9, 14, 12, 0);
  const point = (deck: Awaited<ReturnType<typeof start>>, key: string, aboveFeet: number) => {
    const root = one(deck.app.stage, key), world = one(deck.app.stage, "world"), ship = one(deck.app.stage, "ship");
    return toCanvas({ x: root.position.x, y: root.position.y - aboveFeet },
      { scale: world.scale.x, x: world.position.x, y: world.position.y }, { x: ship.position.x, y: ship.position.y });
  };
  const click = (deck: Awaited<ReturnType<typeof start>>, at: { x: number; y: number }) =>
    deck.app.canvas.listeners.get("click")?.({ offsetX: at.x, offsetY: at.y });

  it("draws generated handles in front of the hull and keeps the worker clickable before and after focus", async () => {
    const selected: Array<string | null> = [], hovers: Array<DeckHover | null> = [];
    const deck = await start(environment, { now, extras, reducedMotion: true, scene: crewScene([["rest", "idle"]]),
      onSelect: key => selected.push(key), onHover: hover => hovers.push(hover) });
    const { root, sprite, upper } = sailorSprites(deck.app.stage, "rest");
    expect(texturePath(sprite)).toBe("below-deck/porthole.png");
    expect([sprite.texture.frame.width, sprite.texture.frame.height]).toEqual([16, 16]);
    expect(root.zIndex).toBeGreaterThan(one(deck.app.stage, "piece:near").zIndex);
    expect(upper.visible).toBe(false);
    const at = point(deck, "rest", 8);
    deck.app.canvas.listeners.get("pointermove")?.({ offsetX: at.x, offsetY: at.y });
    expect(hovers.at(-1)?.key).toBe("rest");
    click(deck, at);
    deck.drawing.focus("rest");
    expect(one(deck.app.stage, "spot").children.map(child => child.label)).toContain("rest");
    click(deck, point(deck, "rest", 8));
    expect(selected).toEqual(["rest", "rest"]);
    deck.drawing.focus(null);
    deck.drawing.destroy();
    expect(sprite.texture.destroyed && sprite.texture.source.destroyed).toBe(true);
  });

  it("preserves a clickable engine badge when the optional handle image fails", async () => {
    const selected: Array<string | null> = [];
    const deck = await start(environment, { now, extras, without: ["below-deck-porthole"], reducedMotion: true,
      scene: crewScene([["rest", "idle"]]), onSelect: key => selected.push(key) });
    const { root, sprite } = sailorSprites(deck.app.stage, "rest");
    expect(sprite.visible).toBe(false);
    const badge = one(root, "badge");
    expect(badge.visible).toBe(true);
    click(deck, point(deck, "rest", -badge.position.y - 2));
    expect(selected).toEqual(["rest"]);
    deck.drawing.destroy();
  });

  it("greys a stale handle, restores a full body for work and removes its hit target with its card", async () => {
    const selected: Array<string | null> = [];
    const deck = await start(environment, { now, extras, reducedMotion: true,
      scene: crewScene([["rest", "idle"]]), onSelect: key => selected.push(key) });
    const stale = crewScene([["rest", "idle"]]); stale.sailors[0]!.stale = true;
    deck.drawing.update(stale);
    const { sprite } = sailorSprites(deck.app.stage, "rest");
    expect(sprite.tint).toBe(shipStage().palette.staleTint);
    click(deck, point(deck, "rest", 8));
    deck.drawing.update(crewScene([["rest", "working"]]));
    expect(sprite.visible).toBe(true);
    expect(sprite.texture.frame.height).toBeGreaterThan(16);
    deck.drawing.update(crewScene([["rest", "idle"]]));
    expect(texturePath(sprite)).toBe("below-deck/porthole.png");
    const at = point(deck, "rest", 8);
    deck.drawing.update(crewScene([]));
    click(deck, at);
    expect(selected).toEqual(["rest", null]);
    deck.drawing.destroy();
  });
});

describe("whole-stage rocking", () => {
  it("shares its transform with all aboard, focus, veil and hit targets, leaves the world level, and pauses on existing signals", async () => {
    const selected: Array<string | null> = [], hovers: Array<DeckHover | null> = [];
    const scene = crewScene([["rock-worker", "working"], ["rock-rest", "idle"]]);
    scene.sailors[0]!.asks = true;
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12), extras, scene,
      stageMotion: { rock: { pivot: [200, 100], degrees: 2, drift: 2, periodS: 8 } },
      attentionCarrier: shipManifest().attentionCarrier, onSelect: key => selected.push(key), onHover: h => hovers.push(h) });
    deck.advance(16);
    for (let i = 0; i < 60; i++) deck.advance(34);
    const ship = one(deck.app.stage, "ship"), spot = one(deck.app.stage, "spot"), veil = one(deck.app.stage, "veil");
    expect(ship.rotation).toBeGreaterThan(0.03);
    expect(spot.rotation).toBe(ship.rotation); expect(veil.rotation).toBe(ship.rotation);
    expect(spot.position).toEqual(ship.position); expect(veil.position).toEqual(ship.position);
    // The existing fixture tree checks the actual renderer's grouping, not a second drawing implementation.
    for (const label of ["rock-worker", "rock-rest", "piece:near"]) expect(byLabel(ship, label)).toHaveLength(1);
    expect(one(deck.app.stage, "overboard").rotation).toBe(0);
    expect(one(deck.app.stage, "attention-carrier").rotation).toBe(0);
    const point = () => {
      const worker = one(deck.app.stage, "rock-worker"), world = one(deck.app.stage, "world");
      return toCanvas({ x: worker.position.x, y: worker.position.y - 8 },
        { x: world.position.x, y: world.position.y, scale: world.scale.x }, { x: ship.position.x, y: ship.position.y, rotation: ship.rotation });
    };
    const click = () => { const p = point(); deck.app.canvas.listeners.get("click")?.({ offsetX: p.x, offsetY: p.y }); };
    const p = point(); deck.app.canvas.listeners.get("pointermove")?.({ offsetX: p.x, offsetY: p.y });
    expect(hovers.at(-1)?.key).toBe("rock-worker"); click();
    deck.drawing.focus("rock-worker"); for (let i = 0; i < 20; i++) deck.advance(34);
    expect(byLabel(spot, "rock-worker")).toHaveLength(1);
    click(); deck.drawing.resize(1100, 600); deck.advance(34); click();
    expect(selected).toEqual(["rock-worker", "rock-worker", "rock-worker"]);
    expect(hovers.at(-1)?.key).toBe("rock-worker");
    const angle = ship.rotation;
    deck.state.hidden = true; deck.signal(); deck.advance(2000);
    expect(ship.rotation).toBe(angle); expect(deck.pending()).toBe(0);
    deck.state.hidden = false; deck.state.reducedMotion = true; deck.signal();
    expect(ship.rotation).toBe(0); expect(ship.position).toMatchObject({ x: 0, y: 0 });
    expect(spot.rotation).toBe(0); expect(veil.rotation).toBe(0); expect(deck.pending()).toBe(0);
    deck.drawing.destroy(); expect(deck.timers.every(t => t.stopped)).toBe(true);
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
    const base = fitDeck({ width: 800, height: 400 }, deckBox(shipStage(), -80), 1, shipStage().fit.margin);
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
    expect(worldFit(deck)).toEqual(fitDeck({ width: 480, height: 600 }, deckBox(shipStage(), -80), 1, shipStage().fit.margin));
    deck.drawing.destroy();
  });
});

describe("the plank and the shark on the deck", () => {
  const now = new Date(2026, 9, 14, 12, 0);

  it("lays the plank in front of the near rail, and the sea's layer for whoever goes off it between the near sea and the veil", async () => {
    const deck = await start(environment, { now, extras, scene: crewScene([["a", "working"]]) });
    deck.advance(0);
    // The generated board, at its placement, just in front of the near rail.
    const plank = one(one(deck.app.stage, "deck"), "piece:plank") as FakeSprite;
    expect(texturePath(plank)).toBe("plank/plank.png");
    expect([plank.position.x, plank.position.y]).toEqual(plankPiece.at);
    expect([plank.texture.frame.width, plank.texture.frame.height]).toEqual(shipManifest().images[plankPiece.sprite.image]!.size);
    expect(plank.zIndex).toBeGreaterThan(one(deck.app.stage, "piece:near").zIndex);
    expect(one(deck.app.stage, "world").children.map((child) => child.label)).toEqual(["scenery:back", "ship", "scenery:front", "overboard", "veil", "spot", "attention-carrier"]);
    deck.drawing.destroy();
    // Without the board's image, no board: the one drawn in code is retired.
    const images = new Map([...extras.images].filter(([path]) => path !== "plank/plank.png"));
    const boardless = await start(environment, { now, extras: { manifest: extrasManifest, images }, scene: crewScene([["a", "working"]]) });
    boardless.advance(0);
    expect(byLabel(boardless.app.stage, "piece:plank")).toEqual([]);
    boardless.drawing.destroy();
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
      if (onPlank !== undefined && onPlank.zIndex > one(deck.app.stage, "piece:plank").zIndex) walkedPlank = true;
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

  it("leaves out a failed effect frame alone and preserves its track's later frames and depth", async () => {
    const plain = { manifest: extrasManifest, images: new Map([...extras.images].filter(([path]) => path !== "shark/surface.png")) };
    const deck = await start(environment, { now, extras: plain, scene: crewScene([["a", "working"]]) });
    deck.advance(0);
    deck.drawing.update(crewScene([]));
    const overboard = one(deck.app.stage, "overboard");
    const drawn = new Set<string>();
    for (let frame = 0; frame < 900; frame += 1) {
      deck.advance(34);
      for (const child of overboard.children) {
        if (!child.visible || !["shark", "splash"].includes(child.label)) continue;
        drawn.add(texturePath(child));
        expect(child.zIndex).toBe(child.label === "shark" ? 1 : 2);
      }
    }
    expect(drawn).toEqual(new Set(["shark/fin.png", "shark/chomp.png", "shark/submerge.png", "splash/impact.png", "splash/burst.png"]));
    expect(overboard.children).toEqual([]);
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
  /** The extras, with every cloud cut into its masks: each a token naming its sprite and slot. */
  const cloudy: Extras = { ...extras, masks: "clouds" };
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
      "sky:overcast", ...overcastEdges,
      "sky:stars",
      "flash:lightning",
      "clouds",
      "gull",
      "gull",
      "sea:back",
      "sea:back:rough-sea",
    ]);
    const clouds = cloudsOf(deck);
    expect(clouds).toHaveLength(7);
    for (const cloud of clouds) {
      expect(cloud.children.map((child) => child.label)).toEqual(["clouds:shadow", "clouds:body", "clouds:highlight"]);
      const id = cloud.label.replace("clouds:", "");
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
      const id = cloudsOf(deck)[index]!.label.replace("clouds:", "");
      const period = cloudPeriod(shipElement("sky", "backdrop-cycle").size[0], clouds.sprites.find((sprite) => sprite.id === id)!.size[0], clouds.margin);
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
    const skyless = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: cloudy, without: ["sky-night"] });
    skyless.advance(16);
    expect(byLabel(skyless.app.stage, "clouds")).toEqual([]);
    skyless.drawing.destroy();
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
      // Subtract the changing pose's head height: this test isolates the indicator's own one-pixel bob.
      const sprite = sailorSprites(moving.app.stage, "a").sprite;
      heights.add(ask(moving, "a").position.y + sprite.texture.frame.height);
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
  const water = { sea: elementImages("sea").slice(0, 4).map(pathOf), wake: elementImages("wake").slice(0, 3).map(pathOf), foam: elementImages("foam").map(pathOf) };
  const seaTiles = (stage: FakeContainer) => [...one(stage, "sea:back").children, ...one(stage, "sea:front").children] as FakeSprite[];
  const wakeOf = (stage: FakeContainer) => one(stage, "wake") as FakeSprite;
  const foamOf = (stage: FakeContainer) => (one(stage, "foam").children as FakeSprite[]).filter((piece) => piece.visible);
  /** The extras without one image. */
  const without = (path: string): DeckExtrasImages => ({ manifest: extrasManifest, images: new Map([...extras.images].filter(([key]) => key !== path)) });

  it("draws the generated sea, its wake and foam in the environment's places: far sea behind the ship, the rest in front", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras });
    deck.advance(16);
    expect(one(deck.app.stage, "world").children.map((child) => child.label)).toEqual(["scenery:back", "ship", "scenery:front", "overboard", "veil", "spot", "attention-carrier"]);
    // The far sea last behind the ship, its variant over it; in front, each part with its variants over it, and the cycles over all.
    expect(one(deck.app.stage, "scenery:back").children.slice(-2).map((child) => child.label)).toEqual(["sea:back", "sea:back:rough-sea"]);
    expect(one(deck.app.stage, "scenery:front").children.map((child) => child.label)).toEqual([
      "sea:front",
      "sea:front:rough-sea",
      "wake",
      "wake:heavy-wake",
      "foam",
      "spindrift",
    ]);

    // The sea: the first frame on every tile of both bands, from the horizon and from the waterline, one tile origin.
    const far = one(deck.app.stage, "sea:back").children as FakeSprite[];
    const near = one(deck.app.stage, "sea:front").children as FakeSprite[];
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
      seen.drift.add(one(deck.app.stage, "sea:back").position.x);
      expect(one(deck.app.stage, "sea:front").position.x).toBe(one(deck.app.stage, "sea:back").position.x);
      expect([wake.position.x, wake.position.y]).toEqual([384, 143]);
    }
    expect([...seen.sea].sort()).toEqual(water.sea);
    expect([...seen.wake].sort()).toEqual(water.wake);
    expect([...seen.foam].sort()).toEqual(water.foam);
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
    expect(one(deck.app.stage, "sea:back").position.x).toBe(0);
    deck.drawing.destroy();
  });

  it("holds them on a software renderer's lite plan too, where the sea does not drift", () => {
    const scenery = createScenery(pixi, shipStage(), sceneryArt({ art: environment, extras }), 0);
    scenery.layout({ left: 0, right: 426, top: -80, bottom: 240 });
    const lite = { level: "lite", animate: true, fps: 12, ambient: false } as const;
    for (const seconds of [0, 0.25, 0.5, 0.75, 1]) {
      scenery.draw(seconds, lite, 720);
      const front = scenery.front as unknown as FakeContainer;
      expect(texturePath(one(front, "wake"))).toBe("water/wake/frame-0.png");
      expect(new Set((one(front, "sea:front").children as FakeSprite[]).map(texturePath))).toEqual(new Set(["water/sea/frame-0.png"]));
      expect(one(front, "sea:front").position.x).toBe(0);
    }
    scenery.destroy();
  });

  it("falls back part by part: a missing wake frame is no wake, a missing sea frame the still tile, a missing foam frame its strip", async () => {
    const noWake = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: without("water/wake/frame-1.png") });
    noWake.advance(16);
    expect(byLabel(noWake.app.stage, "wake")).toEqual([]);
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

  it("with neither sea, fills it flat, and still draws the generated wake and the foam; with neither foam, none", async () => {
    // The animated sea without a frame, and no still tile to fall back on: the sea a flat fill in each of its bands.
    const plain = await start(null, { now: new Date(2026, 9, 14, 12, 0), extras: without("water/sea/frame-1.png"), scene: twoWorking() });
    plain.advance(16);
    expect(one(plain.app.stage, "scenery:front").children.map((child) => child.label)).toEqual(["sea:front", "wake", "wake:heavy-wake", "foam", "spindrift"]);
    expect(one(plain.app.stage, "sea:front")).toBeInstanceOf(FakeGraphics);
    expect(one(plain.app.stage, "scenery:back").children.at(-1)!.label).toBe("sea:back");
    const foamless = await start(null, { now: new Date(2026, 9, 14, 12, 0), extras: { ...extras, images: new Map([...without("water/sea/frame-1.png").images].filter(([path]) => path !== "water/foam/frame-0.png")) } });
    foamless.advance(16);
    expect(one(foamless.app.stage, "scenery:front").children.map((child) => child.label)).toEqual(["sea:front", "wake", "wake:heavy-wake", "spindrift"]);
    foamless.drawing.destroy();
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
  const cloudy: Extras = { ...extras, masks: "clouds" };
  const seaFrame = (deck: Awaited<ReturnType<typeof start>>) => texturePath(one(deck.app.stage, "sea:back").children[0]!);
  /** Over `seconds` at 30 frames a second: how often the sea's frame and the sail's state changed, how far the sea and the first cloud went. */
  function watch(deck: Awaited<ReturnType<typeof start>>, seconds: number) {
    deck.advance(0);
    const sail = one(deck.app.stage, "sail") as FakeSprite;
    const cloud = one(deck.app.stage, "clouds").children[0]!;
    const counts = { sea: 0, sail: 0, drift: 0, cloud: 0 };
    let [sea, cloth, drift, x] = [seaFrame(deck), sail.texture.frame.x, one(deck.app.stage, "sea:back").position.x, cloud.position.x];
    for (let frame = 0; frame < seconds * 30; frame += 1) {
      deck.advance(34);
      if (seaFrame(deck) !== sea) counts.sea += 1;
      if (sail.texture.frame.x !== cloth) counts.sail += 1;
      const at = one(deck.app.stage, "sea:back").position.x;
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
    // All of it: the heavy wake, wholly over the calm one at the top of the dial.
    expect(one(lively.app.stage, "wake:heavy-wake").alpha).toBe(1);
    expect(one(lively.app.stage, "wake").visible).toBe(false);
    expect(one(calm.app.stage, "wake:heavy-wake").visible).toBe(false);
    expect([one(calm.app.stage, "sky:under").tint, one(calm.app.stage, "sky:over").tint]).toEqual([0xffffff, 0xffffff]);
    expect([one(lively.app.stage, "sky:under").tint, one(lively.app.stage, "sky:over").tint]).toEqual([SKY_SHADE, SKY_SHADE]);
    // The clouds take the same shade over the sky's own colours.
    const clouds = (deck: Awaited<ReturnType<typeof start>>) => one(deck.app.stage, "clouds").children[0]!.children.map((mask) => mask.tint);
    expect(clouds(calm)).toEqual([0xa8b9bd, 0xbecac6, 0xd9d4be]);
    expect(clouds(lively)).toEqual([0xa8b9bd, 0xbecac6, 0xd9d4be].map((colour) => shade(colour, SKY_SHADE)));
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
    expect(one(deck.app.stage, "sea:back").position.x).toBe(0);
    expect(one(deck.app.stage, "sky:under").tint).toBe(0xffffff);
    expect((one(deck.app.stage, "sail") as FakeSprite).texture.frame.x).toBe(0);
    expect(one(deck.app.stage, "ship").position.y).toBe(0);
    deck.drawing.destroy();
  });
});

describe("intensity-driven creature cycles in the ship pack", () => {
  function creatures() {
    const art = sceneryArt({ extras: { ...extras, masks: "all" }, art: environment });
    const images = new Map(art.images);
    for (const id of ["weather-serpent", "weather-kraken"].flatMap(elementImages)) images.set(id, { image: pathOf(id) });
    const ambience = compileAmbience(shipManifest(), (id) => images.has(id), (id) => art.masks.has(id));
    const scenery = createScenery(pixi, shipStage(), { ...art, images, ambience }, 0);
    scenery.layout({ left: 0, right: 426, top: -80, bottom: 171 });
    return { scenery, art, front: scenery.front as unknown as FakeContainer };
  }
  const full = { level: "full", animate: true, fps: 30, ambient: true } as const;

  it("looms before surfacing, ramps the two creatures separately, then clears them as work quiets", () => {
    const { scenery, art, front } = creatures();
    const draw = (intensity: number | null) => scenery.draw(0, full, 720, { ...deliveredWeather(art.atmosphere, 0), intensity });
    const serpent = one(front, "weather-serpent");
    const surfaced = one(front, "weather-serpent:serpent-surface");
    const kraken = one(front, "weather-kraken:kraken-surface");
    for (const intensity of [null, 0, .5]) {
      draw(intensity);
      expect([serpent, surfaced, kraken].every((sprite) => !sprite.visible)).toBe(true);
    }
    draw(.6);
    expect(serpent.visible).toBe(true);
    expect(surfaced.visible).toBe(false);
    expect(kraken.visible).toBe(false);
    draw(1);
    expect(serpent.visible).toBe(false);
    expect(surfaced.visible && kraken.visible).toBe(true);
    expect(surfaced.alpha).toBe(.85);
    draw(.5);
    expect([serpent, surfaced, kraken].every((sprite) => !sprite.visible)).toBe(true);
    scenery.destroy();
  });

  it("freezes creatures in lite and hides them under reduced motion even with a busy input", () => {
    const { scenery, art, front } = creatures();
    for (const seconds of [0, 1.4, 3.2, 8]) {
      const weather = { ...deliveredWeather(art.atmosphere, seconds), intensity: 1 };
      scenery.draw(seconds, { ...full, level: "lite", fps: 12, ambient: false }, 720, weather);
      expect(texturePath(one(front, "weather-serpent:serpent-surface"))).toBe("enrichment/serpent-0.png");
      expect(one(front, "weather-kraken:kraken-surface").visible).toBe(true);
      scenery.draw(seconds, { level: "still", animate: false, fps: 0, ambient: false }, 720, weather);
      expect(front.children.filter((sprite) => sprite.label.startsWith("weather-")).every((sprite) => !sprite.visible)).toBe(true);
    }
    scenery.destroy();
  });
});

describe("the heavy weather on the deck, at the top of the dial", () => {
  const working = (count: number) => crewScene(Array.from({ length: count }, (_, index): [string, DeckState] => [`hand-${index}`, "working"]));
  /** The extras, with every cloud and every cloud variant cut into its masks. */
  const stormy: Extras = { ...extras, masks: "all" };
  const LAYERS = ["sky:overcast", ...overcastEdges, "flash:lightning", "sea:back:rough-sea", "sea:front:rough-sea", "wake:heavy-wake", "spindrift", "clouds:storm-puff:shadow"];
  const shown = (stage: FakeContainer, label: string) => byLabel(stage, label).filter((node) => node.visible);
  const frameOf = (path: string) => path.replace(/^.*frame-(\d)\.png$/, "$1");

  it("draws none of it with two crewmates working, or three: the calm deck, exactly as it was", async () => {
    for (const count of [2, 3]) {
      const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: stormy, scene: working(count) });
      for (let frame = 0; frame < 300; frame += 1) deck.advance(34);
      for (const label of LAYERS) expect(shown(deck.app.stage, label), label).toEqual([]);
      expect(one(deck.app.stage, "sea:back").visible && one(deck.app.stage, "sea:back").alpha === 1).toBe(true);
      expect(one(deck.app.stage, "wake").visible).toBe(true);
      expect(one(deck.app.stage, "clouds").children.every((cloud) => cloud.children.slice(0, 3).every((mask) => mask.visible && mask.alpha === 1))).toBe(true);
      deck.drawing.destroy();
    }
  });

  it("at a busy fleet's peak: the rough sea on the calm sea's own frame and drift, the heavy wake, thunderheads, the overcast, spray at the bow", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: stormy, scene: working(BUSY_CREW) });
    deck.advance(0);
    const spray = one(deck.app.stage, "spindrift") as FakeSprite;
    const sprayFrames = new Set<string>();
    for (let frame = 0; frame < 40; frame += 1) {
      deck.advance(34);
      for (const band of ["back", "front"]) {
        const calm = one(deck.app.stage, `sea:${band}`);
        const rough = one(deck.app.stage, `sea:${band}:rough-sea`);
        // An opaque variant wholly in: the calm sea under it is not drawn.
        expect([rough.visible, rough.alpha, calm.visible]).toEqual([true, 1, false]);
        expect(rough.position.x).toBe(calm.position.x);
        expect(rough.children.map((tile) => [tile.position.x, tile.position.y])).toEqual(calm.children.map((tile) => [tile.position.x, tile.position.y]));
        expect(rough.children.map((tile) => frameOf(texturePath(tile)))).toEqual(calm.children.map((tile) => frameOf(texturePath(tile))));
        expect(rough.children.every((tile) => texturePath(tile).startsWith("storm/sea/"))).toBe(true);
      }
      const [wake, heavy] = [one(deck.app.stage, "wake") as FakeSprite, one(deck.app.stage, "wake:heavy-wake") as FakeSprite];
      expect(frameOf(texturePath(heavy))).toBe(frameOf(texturePath(wake)));
      expect([heavy.position.x, heavy.position.y, heavy.alpha, wake.visible]).toEqual([wake.position.x, wake.position.y, 1, false]);
      expect([spray.visible, spray.alpha, spray.position.x, spray.position.y]).toEqual([true, 0.65, 48, 125]);
      sprayFrames.add(texturePath(spray));
    }
    expect(sprayFrames.size).toBe(4);
    for (const cloud of one(deck.app.stage, "clouds").children) {
      const id = cloud.label.replace("clouds:", "");
      expect(cloud.children.map((mask) => mask.label)).toEqual([
        "clouds:shadow",
        "clouds:body",
        "clouds:highlight",
        `clouds:storm-${id}:shadow`,
        `clouds:storm-${id}:body`,
        `clouds:storm-${id}:highlight`,
      ]);
      expect(cloud.children.slice(0, 3).every((mask) => !mask.visible)).toBe(true);
      expect(cloud.children.slice(3).every((mask) => mask.visible && mask.alpha === 1)).toBe(true);
      expect(cloud.children.slice(3).map(texturePath)).toEqual([0, 1, 2].map((slot) => `storm/clouds/${id}.png#${slot}`));
      expect(cloud.children.slice(3).map((mask) => mask.tint)).toEqual([0x1d314e, 0x45617a, 0x7795a5].map((colour) => shade(colour, SKY_SHADE)));
    }
    const overcast = one(deck.app.stage, "sky:overcast");
    const sky = one(deck.app.stage, "sky:under");
    expect([overcast.visible, overcast.alpha, overcast.tint]).toEqual([true, 0.7, SKY_SHADE]);
    expect([overcast.position.x, overcast.position.y, overcast.scale.x]).toEqual([sky.position.x, sky.position.y, sky.scale.x]);
    deck.drawing.destroy();
  });

  it("at night keeps the night: no overcast brightening it, the stars hidden, the thunderheads in their night colours", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 15, 1, 0), extras: stormy, scene: working(BUSY_CREW) });
    deck.advance(34);
    expect(shown(deck.app.stage, "sky:overcast")).toEqual([]);
    expect(shown(deck.app.stage, "sky:stars")).toEqual([]);
    expect(one(deck.app.stage, "clouds").children[0]!.children.slice(3).map((mask) => mask.tint)).toEqual(
      [0x151e2d, 0x1d314e, 0x2c4869].map((colour) => shade(colour, SKY_SHADE)),
    );
    const calm = await start(environment, { now: new Date(2026, 9, 15, 1, 0), extras: stormy, scene: working(2) });
    calm.advance(34);
    expect(one(calm.app.stage, "sky:stars").alpha).toBe(1);
    for (const opened of [deck, calm]) opened.drawing.destroy();
  });

  it("flashes a faint distant fork now and then, behind the clouds and above the horizon", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: stormy, scene: working(BUSY_CREW) });
    deck.advance(0);
    const flash = one(deck.app.stage, "flash:lightning") as FakeSprite;
    const back = one(deck.app.stage, "scenery:back");
    expect(back.children.indexOf(flash)).toBeLessThan(back.children.indexOf(one(deck.app.stage, "clouds")));
    expect(back.children.indexOf(flash)).toBeGreaterThan(back.children.indexOf(one(deck.app.stage, "sky:stars")));
    let [frames, flashes, showing] = [0, 0, false];
    // Four minutes of frames.
    for (let frame = 0; frame < 7200; frame += 1) {
      deck.advance(34);
      if (flash.visible) {
        frames += 1;
        if (!showing) flashes += 1;
        expect(flash.alpha).toBeLessThanOrEqual(0.54);
        const sky = one(deck.app.stage, "sky:under");
        expect(flash.position.y + 48 * flash.scale.y).toBeLessThanOrEqual(sky.position.y + 213 * sky.scale.y + 1e-6);
      }
      expect(deck.app.canvas.attributes.get(DECK_FLASH_ATTRIBUTE)).toBe(flash.visible ? "lightning" : "");
      showing = flash.visible;
    }
    // About two a minute, a fifth of a second each.
    expect(flashes).toBeGreaterThanOrEqual(3);
    expect(flashes).toBeLessThanOrEqual(16);
    expect(frames).toBeLessThan(flashes * 8);
    deck.drawing.destroy();
  });

  it("rolls in and out with the crew, eased, never popping", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: stormy, scene: working(2) });
    deck.advance(0);
    deck.drawing.update(working(BUSY_CREW));
    const rough = one(deck.app.stage, "sea:back:rough-sea");
    const head = one(deck.app.stage, "clouds").children[0]!.children[3]!;
    const seen: number[] = [];
    for (let frame = 0; frame < 30 * 20; frame += 1) {
      deck.advance(34);
      seen.push(rough.visible ? rough.alpha : 0);
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(Math.max(...seen.slice(1).map((alpha, index) => alpha - seen[index]!))).toBeLessThan(0.05);
    expect(seen.at(-1)).toBe(1);
    expect(head.alpha).toBe(1);
    deck.drawing.update(working(1));
    for (let frame = 0; frame < 30 * 20; frame += 1) deck.advance(34);
    for (const label of LAYERS) expect(shown(deck.app.stage, label), label).toEqual([]);
    expect(one(deck.app.stage, "sea:back").visible).toBe(true);
    deck.drawing.destroy();
  });

  it("stays wholly calm under reduced motion, however busy: no variants, no spray, no flash", async () => {
    const deck = await start(environment, { reducedMotion: true, now: new Date(2026, 9, 14, 12, 0), extras: stormy, scene: working(BUSY_CREW) });
    deck.state.now = new Date(2026, 9, 14, 12, 3);
    deck.timers[0]!.run();
    for (const label of LAYERS) expect(shown(deck.app.stage, label), label).toEqual([]);
    deck.drawing.destroy();
  });

  it("on a software renderer's lite plan shows the variants still, on their elements' first frames, and never flashes", () => {
    const scenery = createScenery(pixi, shipStage(), sceneryArt({ extras: stormy, art: environment }), 0);
    scenery.layout({ left: 0, right: 426, top: -80, bottom: 240 });
    const lite = { level: "lite", animate: true, fps: 12, ambient: false } as const;
    for (let seconds = 0; seconds < 120; seconds += 0.1) {
      scenery.draw(seconds, lite, 720, { ...deliveredWeather(compileAtmosphere(shipManifest()), seconds), intensity: 1 });
      const [front, back] = [scenery.front as unknown as FakeContainer, scenery.back as unknown as FakeContainer];
      expect(one(back, "flash:lightning").visible).toBe(false);
      expect(new Set((one(front, "sea:front:rough-sea").children as FakeSprite[]).map(texturePath))).toEqual(new Set(["storm/sea/frame-0.png"]));
      expect(texturePath(one(front, "wake:heavy-wake"))).toBe("storm/wake/frame-0.png");
      expect(texturePath(one(front, "spindrift"))).toBe("storm/spray/frame-0.png");
      expect(one(front, "sea:front:rough-sea").alpha).toBe(1);
    }
    scenery.destroy();
  });

  it("enforces flash opacity and motion caps even when unchecked data requests otherwise", () => {
    const art = sceneryArt({ extras: stormy, art: environment });
    art.ambience = {
      ...art.ambience,
      elements: art.ambience.elements.map((element) => element.behaviour.kind !== "flash" ? element : {
        ...element, lite: "run", still: "first-frame",
        behaviour: { ...element.behaviour, opacity: [[0, 1]], perMinute: [[0, 600]] },
      }),
    };
    const scenery = createScenery(pixi, shipStage(), art, 0);
    scenery.layout({ left: 0, right: 426, top: -80, bottom: 240 });
    const flash = one(scenery.back as unknown as FakeContainer, "flash:lightning");
    let visible = 0;
    for (let seconds = 0; seconds < 120; seconds += 0.05) {
      const weather = { ...deliveredWeather(art.atmosphere, seconds), intensity: 1 };
      scenery.draw(seconds, { level: "full", animate: true, fps: 30, ambient: true }, 720, weather);
      if (flash.visible) { visible += 1; expect(flash.alpha).toBeLessThanOrEqual(0.6); }
      for (const level of ["lite", "still"] as const) {
        scenery.draw(seconds, { level, animate: level === "lite", fps: 12, ambient: false }, 720, weather);
        expect(flash.visible).toBe(false);
      }
    }
    expect(visible).toBeGreaterThan(0);
    scenery.destroy();
  });

  it("drops only the layer whose image failed: a missing rough-sea frame leaves the calm sea and the rest of the storm", async () => {
    const missing: Extras = { ...stormy, images: new Map([...stormy.images].filter(([path]) => path !== "storm/sea/frame-1.png")) };
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: missing, scene: working(BUSY_CREW) });
    deck.advance(34);
    expect(byLabel(deck.app.stage, "sea:back:rough-sea")).toEqual([]);
    expect(one(deck.app.stage, "sea:back").visible).toBe(true);
    expect(one(deck.app.stage, "wake:heavy-wake").visible).toBe(true);
    expect(one(deck.app.stage, "sky:overcast").visible).toBe(true);
    deck.drawing.destroy();
  });

  it("lets go of the layers' textures and sources when torn down", async () => {
    const deck = await start(environment, { now: new Date(2026, 9, 14, 12, 0), extras: stormy, scene: working(BUSY_CREW) });
    for (let frame = 0; frame < 30; frame += 1) deck.advance(34);
    const sprites = [
      ...one(deck.app.stage, "sea:back:rough-sea").children,
      one(deck.app.stage, "wake:heavy-wake"),
      one(deck.app.stage, "sky:overcast"),
      one(deck.app.stage, "spindrift"),
      one(deck.app.stage, "flash:lightning"),
      ...one(deck.app.stage, "clouds").children.flatMap((cloud) => cloud.children.slice(3)),
    ] as FakeSprite[];
    deck.drawing.destroy();
    expect(sprites.every((sprite) => sprite.texture.destroyed && sprite.texture.source.destroyed)).toBe(true);
  });
});
