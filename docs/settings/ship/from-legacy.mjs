/**
 * Writes `art/settings/ship/setting.json`, the ship as a setting pack, from what the deck drew it with before packs:
 * the three manifests it was served in (kept in `docs/ship-deck-art/legacy/`) and the constants in the deck's code.
 *
 * Ran once, at step 2 of the deck-settings migration, against the tree it was written in, so every number in the
 * pack came from where the deck had it rather than being typed again. From then on the pack is the source: later
 * steps delete the constants this reads, and this script stays as the record of where each number came from.
 * `client/ship-pack.test.ts` held the pack equal to those constants while they lasted.
 *
 * `node docs/settings/ship/from-legacy.mjs` (needs `docs/board-list`'s `npm install`, for esbuild).
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const pack = join(root, "art/settings/ship");
const legacy = (name) => JSON.parse(readFileSync(join(root, "docs/ship-deck-art/legacy", name), "utf8").replace(/^﻿/, ""));
const harness = createRequire(join(root, "docs/board-list/package.json"));
const { build } = harness("esbuild");

// The deck's constants, from its own modules.
const outfile = join(root, "docs/ship-deck-canvas/.generated/ship-constants.mjs");
await build({
  stdin: {
    contents: `
      export * from "./client/deck-geometry";
      export { PLACES, WALK_SPEED, STEP_MS, HATCH_MS, FADE_MS, STATE_POSES, BREATH_ROWS, BREATH_MS, SHARK_MOUTH } from "./client/deck-crew";
      export * from "./client/deck-plank";
      export { MASTHEAD, LANTERNS, HEAVE, GULL_SLOT_SECONDS, GULL_LOWEST, SEA_FALLBACK, HORIZON, WATERLINE } from "./client/deck-ambient";
      export { SKY_FADE_MINUTES, skyHorizonRow } from "./client/deck-sky";
      export { FOAM_SPAN, FOAM_TOP } from "./client/deck-environment";
      export { CLOUD_LANES, CLOUD_MARGIN, CLOUD_TOP_MIN } from "./client/deck-clouds";
      export { ATMOSPHERE, STORM_SHADE } from "./client/deck-atmosphere";
      export { FOCUS_FIGURE_HEIGHT } from "./client/deck-camera";
      export { DECK_WIDTH, DECK_HEIGHT, DECK_PROPS } from "./client/deck-scene";
      export { REST_LABEL_ROW } from "./client/deck-hover";
      export { mastLayout } from "./client/deck-extras";
    `,
    resolveDir: root,
    loader: "ts",
    sourcefile: "ship-constants.ts",
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  nodePaths: [join(root, "node_modules")],
  logLevel: "warning",
});
const c = await import(pathToFileURL(outfile).href);
const deck = legacy("deck.json");
const environment = legacy("environment.json");
const extras = legacy("extras.json");

// Every image the deck served, by an id made from its path: `water/sea/frame-0.png` is `water-sea-frame-0`.
const id = (path) => path.replace(/\.png$/, "").replaceAll("/", "-");
const images = {};
function image(path) {
  const file = readFileSync(join(pack, path));
  images[id(path)] = { path, size: [file.readUInt32BE(16), file.readUInt32BE(20)], sha256: createHash("sha256").update(file).digest("hex") };
  return id(path);
}
const hex = (value) => `#${value.toString(16).toUpperCase().padStart(6, "0")}`;
const xy = (point) => [point.x, point.y];
const atlas = image("deck.png");

// The tall mast, cut as the deck cuts it, with the sail hanging on it.
const mast = extras.mast;
const layout = c.mastLayout(mast, deck.pieces[mast.replaces], { position: extras.sail.position, frameSize: extras.sail.frameSize });
const mastImage = image(mast.texture);
const sway = (limit) => ({ kind: "sway", amplitude: { channel: "heave", scale: 1.3 / c.HEAVE }, periodS: 6.2, phase: -1, limit, clock: "swell" });
const sailImage = image(extras.sail.texture);
const [sailWidth, sailHeight] = extras.sail.frameSize;

const lights = { lantern: {
  glyph: ["..a..", ".aaa.", "abbba", "abbba", "abbba", "aaaaa"],
  origin: [2, 0],
  inks: { a: "#2A1A10", b: "#FFD27A" },
  glass: "b",
  tints: [[0.88, "#FFFFFF"], [0.74, "#F2DCB8"], [0, "#D8B890"]],
  glow: [{ at: [0, 4], radius: 9, colour: "#FFB050", alpha: 0.12 }, { at: [0, 4], radius: 5, colour: "#FFC070", alpha: 0.2 }],
  glowAlpha: { base: 0.45, gain: 0.55 },
  flicker: { base: 0.8, waves: [[0.1, 7.1, 1], [0.06, 13.7, 2], [0.04, 29, 5]], still: 0.85 },
} };
const lanternIds = ["stern", "quarterdeck", "mast"];

const propNames = new Set(c.DECK_PROPS.map((prop) => prop.name));
const zoneOrder = [...new Set(c.ANCHORS.map((anchor) => anchor.place))];
const overflow = (place) =>
  place === "rest"
    ? { kind: "pack", areas: c.REST_AREAS.map((area) => [...area]), spacing: [c.REST_SPACING.x, c.REST_SPACING.y], fallback: [6, 3] }
    : { kind: "beside", spacing: [6, 3] };
const lane = (poses) => Object.fromEntries(Object.entries(poses).map(([pose, standing]) => [pose, { rect: standing.frame, feet: standing.feet }]));

// The plank's timeline, from its foot.
const P = c.PLANK;
const IMPACT_AT = c.IMPACT_AT;
const SWIM_MS = c.CHOMP_AT - IMPACT_AT - c.PLUNGE_MS - c.BOB_UP_MS;
const water = { mark: "water", drift: true };
const shark = extras.exit.shark;
const splash = extras.exit.splash;
const sharkFrames = Object.fromEntries(Object.entries(shark.frames).map(([frame, path]) => [frame, { image: image(path) }]));
const splashFrames = Object.fromEntries(Object.entries(splash.frames).map(([frame, path]) => [frame, { image: image(path) }]));

const variant = (entry) => ({
  id: entry.id,
  frames: entry.frames.map((path) => ({ image: image(path) })),
  blend: entry.blend,
  opacity: entry.opacity,
  ...(entry.palette === undefined ? {} : { palette: entry.palette }),
  ...(entry.stages === undefined ? {} : { byPhase: entry.stages }),
});
const variantsOf = (of) => extras.variants.filter((entry) => entry.variantOf === of).map(variant);
const withVariants = (list) => (list.length === 0 ? {} : { variants: list });
const sprites = (paths) => paths.map((path) => ({ image: image(path) }));

const manifest = {
  format: "firstmate.deck-setting",
  formatVersion: 1,
  id: "ship",
  name: "Ship's deck",
  version: "1.0.0",
  requires: [],
  copy: {
    pane: "Deck",
    tooltip: "Show the crew as sailors on a ship deck.",
    title: "Ship deck",
    noun: "the ship deck",
    starting: "Raising the deck…",
    aboard: "on deck",
    actor: { one: "sailor", many: "sailors" },
    zones: { station: "hauling amidships", helm: "by the helm", bow: "in the bow", rest: "resting off watch" },
  },
  images,
  stage: {
    size: [c.DECK_WIDTH, c.DECK_HEIGHT],
    fit: { top: layout.top, bottom: c.PLANK_SEA_BOTTOM, margin: 0.96 },
    actorHeight: c.FOCUS_FIGURE_HEIGHT,
    motion: { bob: { periodS: 6.2, amplitude: { channel: "heave" }, clock: "swell" } },
    backdrop: { sprite: { image: atlas, rect: deck.ship.frame } },
    parts: [
      {
        id: "tall-mast",
        lite: "run",
        still: "first-frame",
        sprite: { image: mastImage, rect: layout.shaft.frame },
        at: [layout.shaft.x, layout.shaft.y],
        cutout: mast.clears,
        replacesPiece: { piece: mast.replaces, sprite: { image: mastImage, rect: layout.depth.frame }, at: [layout.depth.x, layout.depth.y] },
      },
      {
        id: "topmast",
        needs: ["tall-mast"],
        fallback: "masthead",
        lite: "run",
        still: "first-frame",
        sprite: { image: mastImage, rect: layout.head.frame },
        at: [layout.head.x, layout.head.y],
        behaviour: sway(1),
      },
      {
        id: "masthead",
        optional: false,
        lite: "run",
        still: "first-frame",
        sprite: { image: atlas, rect: [c.MASTHEAD.x, c.MASTHEAD.y, c.MASTHEAD.width, c.MASTHEAD.height] },
        at: [c.MASTHEAD.x, c.MASTHEAD.y],
        cutout: [c.MASTHEAD.x, c.MASTHEAD.y, c.MASTHEAD.width, c.MASTHEAD.height],
        behaviour: sway(1),
      },
      {
        id: "sail",
        needs: ["tall-mast"],
        lite: "run",
        still: "first-frame",
        sprite: { image: sailImage, rect: [0, 0, sailWidth, sailHeight] },
        at: extras.sail.position,
        behaviour: {
          kind: "cycle",
          frames: { sprites: Array.from({ length: extras.sail.frames }, (_, index) => ({ image: sailImage, rect: [index * sailWidth, 0, sailWidth, sailHeight] })), frameMs: extras.sail.frameMs, clock: "sail" },
          duty: { channel: "billow" },
        },
      },
    ],
    pieces: [
      ...Object.entries(deck.pieces).map(([name, piece]) => ({ id: name, sprite: { image: atlas, rect: piece.frame }, at: [piece.x, piece.y], baseline: piece.baseline })),
      { id: "plank", optional: true, sprite: { image: image(extras.plank.texture) }, at: extras.plank.position, baseline: { over: "near" } },
    ],
    props: c.DECK_PROPS.map((prop) => ({
      id: prop.name,
      sprite: { image: atlas, rect: deck.props[prop.name].frame },
      feet: deck.props[prop.name].feet,
      at: [prop.x, prop.y],
      obstacle: c.OBSTACLES.find((obstacle) => obstacle.name === prop.name).rect,
    })),
    lightStyles: lights,
    lights: c.LANTERNS.map((lantern, index) => ({ id: lanternIds[index], style: "lantern", at: [lantern.x, lantern.y], row: lantern.row, seed: lantern.seed, lite: "run", still: "first-frame" })),
  },
  floor: {
    areas: c.WALKABLE.map((area) => ({ id: area.name.replaceAll(" ", "-"), polygon: area.polygon.map((point) => [...point]), ...(area.name === "stairs" ? { spill: false } : {}) })),
    obstacles: c.OBSTACLES.filter((obstacle) => !propNames.has(obstacle.name)).map((obstacle) => ({ id: obstacle.name, rect: obstacle.rect })),
    grid: { cell: 2, bounds: [40, 80, 424 - 40, 126 - 80] },
    walkSpeed: c.WALK_SPEED,
  },
  zones: {
    byState: { ...c.PLACES },
    zones: zoneOrder.map((place) => ({
      id: place,
      posts: c.ANCHORS.filter((anchor) => anchor.place === place).map((anchor) => ({ id: anchor.id, at: [anchor.x, anchor.y], facing: anchor.facing })),
      assign: place === "rest" ? "ordered" : "nearest",
      overflow: overflow(place),
      ...(place === "rest" ? { labelFloor: c.REST_LABEL_ROW } : {}),
    })),
  },
  cast: {
    lanes: { base: lane(deck.crew.base), outfit: lane(deck.crew.outfit) },
    looks: [
      { id: "base", image: atlas, lane: "base", optional: false },
      { id: "outfit", image: atlas, lane: "outfit", optional: false },
      ...extras.crew.map((look) => ({ id: look.id, image: image(look.texture), lane: "base" })),
    ],
    roles: {
      stand: "front-idle",
      walkFront: ["front-walk-a", "front-idle", "front-walk-b", "front-idle"],
      walkSide: ["side-walk-a", "side-idle", "side-walk-b", "side-idle"],
      rise: 1,
      stepMs: c.STEP_MS,
      settled: {
        working: { pose: c.STATE_POSES.working, mirror: "facing" },
        waiting: { pose: c.STATE_POSES.waiting, mirror: "none" },
        blocked: { pose: c.STATE_POSES.blocked, mirror: "none" },
        idle: { pose: c.STATE_POSES.idle, mirror: "seed" },
      },
    },
    fidgets: {
      working: { periodMs: 900, seedMs: 37, keys: [{ fromMs: 0, dx: 1, dy: 0, towardFacing: true }, { fromMs: 450, dx: 0, dy: -1 }] },
      waiting: { periodMs: 2600, seedMs: 37, keys: [{ fromMs: 0, dx: 0, dy: -1 }, { fromMs: 900, dx: 0, dy: 0 }] },
      blocked: { periodMs: 4000, seedMs: 37, keys: [{ fromMs: 0, dx: -1, dy: 0 }, { fromMs: 300, dx: 0, dy: 0 }, { fromMs: 600, dx: 1, dy: 0 }, { fromMs: 900, dx: 0, dy: 0 }] },
      idle: null,
    },
    breath: { state: "idle", rows: c.BREATH_ROWS, periodMs: c.BREATH_MS, inMs: 2200, seedMs: 53 },
  },
  portals: {
    entry: { kind: "rise", at: xy(c.HATCH), ms: c.HATCH_MS },
    exits: {
      hatch: { kind: "sink", at: xy(c.HATCH), ms: c.HATCH_MS },
      plank: {
        kind: "choreography",
        marks: { foot: xy(P.foot), rail: xy(P.rail), tip: xy(P.tip), water: [P.tip.x, P.water] },
        queue: { at: "foot", release: "impact" },
        alternate: { side: [1, -1], drift: [0, -3, 3] },
        actor: [
          { ms: c.HOP_MS, to: { mark: "rail" }, path: { arc: 2 }, pose: "front-walk-a", layer: { front: "plank" }, layerAt: 0.5, moving: true },
          { ms: "walk", to: { mark: "tip" }, path: "line", pose: { cycle: "walkFront" }, layer: { front: "plank" }, moving: true },
          { ms: c.TEETER_MS, pose: "front-idle", jiggle: { dx: [0, -1, 0, 1], stepMs: 75 }, layer: { front: "plank" }, moving: false },
          { ms: c.JUMP_MS, event: "impact", to: water, path: { ballistic: 16 }, pose: "front-walk-b", layer: "effects", moving: true },
          { ms: c.PLUNGE_MS, pose: "front-idle", reveal: [1, 0], layer: "effects", moving: false },
          { ms: c.BOB_UP_MS, pose: "front-idle", reveal: [0, { rows: c.SWIM_ROWS }], layer: "effects", moving: false },
          { ms: SWIM_MS, event: "chomp", pose: "front-idle", reveal: [{ rows: c.SWIM_ROWS }, { rows: c.SWIM_ROWS }], bob: { dy: 1, everyMs: 300, since: "impact" }, layer: "effects", moving: false },
          { ms: c.CHOMP_MS + c.SUBMERGE_MS, pose: "front-idle", layer: "effects", moving: false, gone: true },
        ],
        effects: [
          {
            effect: "splash",
            keys: [
              { frame: c.SPLASH_FRAMES[0].id, at: { event: "impact", plusMs: 0 }, ms: c.SPLASH_FRAMES[0].ms, place: water },
              { frame: c.SPLASH_FRAMES[1].id, at: { event: "impact", plusMs: c.SPLASH_FRAMES[0].ms }, ms: c.SPLASH_FRAMES[1].ms, place: water },
              { frame: "burst", at: { event: "chomp", plusMs: c.CHOMP_MS }, ms: c.SPLASH_FRAMES[1].ms, place: water },
            ],
          },
          {
            effect: "shark",
            mirror: "side",
            keys: [
              { frame: "fin", at: { event: "impact", plusMs: c.FIN_AT - IMPACT_AT }, ms: c.FIN_MS, place: { ...water, alignX: "mouth" }, approach: { px: c.FIN_RUN } },
              { frame: "surface", at: { event: "impact", plusMs: c.FIN_AT - IMPACT_AT + c.FIN_MS }, ms: c.SURFACE_MS, place: { ...water, alignX: "mouth" } },
              { frame: "chomp", at: { event: "chomp", plusMs: 0 }, ms: c.CHOMP_MS, place: { ...water, alignX: "mouth" } },
              { frame: "submerge", at: { event: "chomp", plusMs: c.CHOMP_MS }, ms: c.SUBMERGE_MS, place: { ...water, alignX: "mouth" } },
            ],
          },
        ],
      },
    },
    byDeparture: Object.fromEntries(["done", "failed", "closed", "removed"].map((why) => [why, c.PLANK_DEPARTURES.has(why) ? "plank" : "hatch"])),
    still: { fadeMs: c.FADE_MS },
  },
  effects: {
    shark: { size: shark.size, points: { anchor: shark.anchor, mouth: [shark.anchor[0] + c.SHARK_MOUTH[0], shark.anchor[1] + c.SHARK_MOUTH[1]] }, frames: sharkFrames },
    splash: { size: splash.size, points: { anchor: splash.anchor }, frames: splashFrames },
  },
  ambience: [
    {
      id: "sky",
      slot: "back",
      order: 0,
      lite: "run",
      still: "first-frame",
      behaviour: {
        kind: "backdrop-cycle",
        size: environment.sky.size,
        phases: Object.fromEntries(environment.sky.phases.map((phase) => [phase.id, image(phase.path)])),
        placement: { horizonRow: c.skyHorizonRow(environment.sky.size), stageRow: c.HORIZON },
        tint: { to: hex(c.STORM_SHADE), amount: { channel: "mood" } },
      },
    },
    ...extras.mood.overlays.map((overlay) => ({
      id: overlay.id,
      slot: "back",
      order: 1,
      lite: "run",
      still: "hide",
      behaviour: { kind: "overlay", image: image(overlay.texture), space: "sky", alpha: { curve: overlay.opacity }, dayOnly: true, tint: "space" },
    })),
    {
      id: "stars",
      slot: "back",
      order: 2,
      lite: "run",
      still: "first-frame",
      behaviour: { kind: "overlay", image: image(environment.sky.overlays[0].path), space: "sky", alpha: "night", hiddenBy: extras.mood.overlays.map((overlay) => overlay.id) },
    },
    ...extras.flashes.map((flash) => ({
      id: flash.id,
      slot: "back",
      order: 3,
      lite: "hide",
      still: "hide",
      behaviour: {
        kind: "flash",
        frames: flash.frames.map((path, index) => ({ sprite: { image: image(path) }, ms: flash.frameMs[index], alpha: flash.frameAlpha[index] })),
        size: flash.frameSize,
        anchor: flash.anchor,
        under: "clouds",
        opacity: flash.opacity,
        perMinute: flash.perMinute,
      },
    })),
    {
      id: "clouds",
      slot: "back",
      order: 4,
      lite: "freeze",
      still: "first-frame",
      behaviour: {
        kind: "drifters",
        space: "sky",
        clock: "wind",
        slots: 3,
        margin: c.CLOUD_MARGIN,
        topMin: c.CLOUD_TOP_MIN,
        lanes: c.CLOUD_LANES.map((lane) => [...lane]),
        palette: extras.clouds.palette,
        byPhase: extras.clouds.stages,
        sprites: extras.clouds.sprites.map((sprite) => ({
          id: sprite.id,
          image: image(sprite.texture),
          size: sprite.size,
          pxPerSecond: sprite.pixelsPerSecond,
          ...withVariants(variantsOf(`cloud:${sprite.id}`)),
        })),
      },
    },
    {
      id: "gull",
      slot: "back",
      order: 5,
      lite: "hide",
      still: "hide",
      behaviour: {
        kind: "flyby",
        poses: Object.fromEntries(environment.gull.frames.map((frame) => [frame.id, { image: image(environment.gull.sheet), rect: frame.rect }])),
        sequence: environment.gull.sequence,
        frameMs: environment.gull.frameMs,
        glide: "mid",
        size: environment.gull.frameSize,
        anchor: environment.gull.anchor,
        slotS: c.GULL_SLOT_SECONDS,
        chance: 0.68,
        start: [2, 8],
        speed: 26,
        margin: 60,
        rows: [c.GULL_LOWEST - 18, c.GULL_LOWEST],
        wobble: { px: 3, rate: 0.7 },
        flap: { everyS: 3, forS: 1 },
        nightBelow: 0.5,
        most: 2,
      },
    },
    {
      id: "sea",
      slot: "back",
      order: 6,
      fallback: "sea-still",
      lite: "freeze",
      still: "first-frame",
      behaviour: {
        kind: "tile",
        frames: { sprites: sprites(extras.water.sea.frames), frameMs: extras.water.sea.frameMs, clock: "water-frames" },
        drift: { pxPerSecond: extras.water.sea.xPixelsPerSecond, clock: "water-drift" },
        origin: c.HORIZON,
        bands: [{ slot: "back", fromRow: c.HORIZON }, { slot: "front", fromRow: c.WATERLINE }],
        ...withVariants(variantsOf("sea")),
      },
    },
    {
      id: "sea-still",
      slot: "back",
      order: 6,
      lite: "freeze",
      still: "first-frame",
      behaviour: {
        kind: "tile",
        frames: { sprites: sprites([environment.sea.texture]), frameMs: extras.water.sea.frameMs, clock: "water-frames" },
        drift: { pxPerSecond: environment.sea.animation.xPixelsPerSecond, clock: "water-drift" },
        origin: c.HORIZON,
        bands: [{ slot: "back", fromRow: c.HORIZON }, { slot: "front", fromRow: c.WATERLINE }],
      },
    },
    {
      id: "wake",
      slot: "front",
      order: 7,
      lite: "freeze",
      still: "first-frame",
      behaviour: {
        kind: "cycle",
        frames: { sprites: sprites(extras.water.wake.frames), frameMs: extras.water.wake.frameMs, clock: "water-frames" },
        opacity: { channel: "wake" },
        at: extras.water.wake.position,
        anchor: extras.water.wake.anchor,
        ...withVariants(variantsOf("wake")),
      },
    },
    {
      id: "foam",
      slot: "front",
      order: 8,
      fallback: "foam-still",
      lite: "freeze",
      still: "first-frame",
      behaviour: {
        kind: "strip",
        frames: { sprites: sprites(extras.water.foam.frames), frameMs: extras.water.foam.frameMs, clock: "water-frames" },
        top: extras.water.foam.top,
        span: extras.water.foam.span,
        drift: { pxPerSecond: extras.water.foam.xPixelsPerSecond, clock: "water-drift" },
        ...withVariants(variantsOf("foam")),
      },
    },
    {
      id: "foam-still",
      slot: "front",
      order: 8,
      lite: "freeze",
      still: "first-frame",
      behaviour: {
        kind: "strip",
        frames: { sprites: sprites([environment.foam.texture]), frameMs: extras.water.foam.frameMs, clock: "water-frames" },
        top: c.FOAM_TOP,
        span: [c.FOAM_SPAN.left, c.FOAM_SPAN.right],
        drift: { pxPerSecond: environment.foam.xPixelsPerSecond, clock: "water-drift" },
      },
    },
    ...extras.cycles.map((cycle) => ({
      id: cycle.id,
      slot: "front",
      order: 9,
      lite: "freeze",
      still: "hide",
      behaviour: {
        kind: "cycle",
        frames: { sprites: sprites(cycle.frames), frameMs: cycle.frameMs, clock: "water-frames" },
        opacity: { curve: cycle.opacity },
        at: cycle.position,
        anchor: cycle.anchor,
        ...withVariants(variantsOf(`cycle:${cycle.id}`)),
      },
    })),
  ],
  dayCycle: {
    phases: environment.sky.phases.map((phase) => ({ id: phase.id, localMinute: phase.localMinute })),
    fadeMinutes: c.SKY_FADE_MINUTES,
    night: "night",
    fallback: "midday",
  },
  atmosphere: {
    table: c.ATMOSPHERE.map((row) => ({
      at: row.at,
      pace: row.water.pace,
      drift: row.water.drift,
      wind: row.wind,
      sail: row.sail,
      billow: row.billow,
      swell: row.swell,
      heave: row.heave,
      wake: row.wake,
      mood: row.mood,
    })),
    delivered: { pace: 1, drift: 1, wind: 1, sail: 1, billow: 0.5, swell: 1, heave: c.HEAVE, wake: 1, mood: 0 },
    clocks: { "water-frames": "pace", "water-drift": "drift", wind: "wind", sail: "sail", swell: "swell" },
  },
  palette: { fallbackFill: hex(c.SEA_FALLBACK), veil: "#050B14", staleTint: "#8A9096", staleAlpha: 0.6 },
};

// What it uses, by the engine's own reckoning, is what it says it needs.
const shared = join(root, "docs/ship-deck-canvas/.generated/deck-setting.mjs");
await build({ entryPoints: [join(root, "shared/deck-setting.ts")], outfile: shared, bundle: true, platform: "node", format: "esm", nodePaths: [join(root, "node_modules")], logLevel: "warning", external: ["@getpaseo/plugin"] });
const { capabilitiesUsed, SettingManifestSchema } = await import(pathToFileURL(shared).href);
manifest.requires = capabilitiesUsed(manifest);
SettingManifestSchema.parse(manifest);

// Images in the order the pack names them, so the file reads top down.
manifest.images = Object.fromEntries(Object.entries(images).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
writeFileSync(join(pack, "setting.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`art/settings/ship/setting.json: ${Object.keys(images).length} images, requires ${manifest.requires.join(", ")}`);
