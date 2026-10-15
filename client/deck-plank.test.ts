/**
 * The plank and the way off the deck by it, without Pixi: the timeline of one departure, the plank read
 * against the hull's own pixels, the queue at its foot, a card that comes back, reduced motion's fade, and
 * the shark and splash art as served.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { WATERLINE } from "./deck-ambient";
import {
  FADE_MS,
  SHARK_MOUTH,
  applyCrew,
  createCrew,
  crewFigures,
  fading,
  plankEffects,
  plankFree,
  stepCrew,
  stepDepartures,
  type Crew,
  type Figure,
} from "./deck-crew";
import { findPath, walkable } from "./deck-geometry";
import { sailorAt, showsBadge } from "./deck-hover";
import { fitDeck } from "./deck-pixi";
import {
  CHOMP_AT,
  exitFor,
  FIN_AT,
  IMPACT_AT,
  PLANK_COLOURS,
  PLANK_DEPARTURES,
  PLANK_EXIT_MS,
  plankExit,
  plankPixels,
  type DeckDeparture,
  type PlankMoment,
} from "./deck-plank";
import type { DeckSailor, DeckState } from "./deck-scene";
import { shipCast, shipFile, shipPlankMarks, shipStage, shipViews } from "../test/ship-pack";

// The ship's cast, under the names its constants had in the deck's code.
const FRONT_ROWS = shipCast().standRows;


// The ship's stage, under the names its constants had in the deck's code.
const stage = shipStage();
const ANCHORS = [...stage.zones.values()].flatMap((zone) => zone.posts);
const PLANK = { ...shipPlankMarks(), water: shipPlankMarks().water.y };

const art = (path: string) => shipFile(path);
/** The art's generation records, kept out of the package (`docs/ship-deck-art/`). */
const sources = (path: string) => new URL(`../docs/ship-deck-art/${path}`, import.meta.url);
const manifest = shipViews().art;
const extras = shipViews().extras;

/** Enough of PNG for the art here (8-bit RGBA, not interlaced): each pixel as 0xRRGGBB and its alpha. */
function decodePng(file: Buffer): { width: number; height: number; at: (x: number, y: number) => { rgb: number; alpha: number } } {
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  const chunks: Buffer[] = [];
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at);
    if (file.toString("latin1", at + 4, at + 8) === "IDAT") chunks.push(file.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= 4 ? (pixels[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const corner = x >= 4 && y > 0 ? (pixels[(y - 1) * stride + x - 4] ?? 0) : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return {
    width,
    height,
    at: (x, y) => {
      const o = y * stride + x * 4;
      return { rgb: ((pixels[o] ?? 0) << 16) | ((pixels[o + 1] ?? 0) << 8) | (pixels[o + 2] ?? 0), alpha: pixels[o + 3] ?? 0 };
    },
  };
}

const atlas = decodePng(readFileSync(art("deck.png")));
const near = manifest.pieces.near!;
/** Whether the near rail's piece is drawn at deck point (x, y). */
const underNear = (x: number, y: number) => {
  const [fx, fy, fw, fh] = near.frame;
  const px = x - near.x;
  const py = y - near.y;
  return px >= 0 && py >= 0 && px < fw && py < fh && atlas.at(fx + px, fy + py).alpha === 255;
};

function sailor(key: string, state: DeckState = "working"): DeckSailor {
  return {
    key,
    label: `Task ${key}`,
    state,
    identity: `agent-${key}`,
    stale: false,
    caption: { title: `Task ${key}`, status: state, project: null, host: "This machine", line: null, stale: null },
  };
}

/** Steps the crew `ms` on, a 30 fps frame at a time, calling `each` after every frame. */
function run(crew: Crew, ms: number, each: (at: number) => void = () => {}): void {
  for (let at = 0; at < ms; at += 33) {
    stepCrew(crew, 33);
    each(at);
  }
}

const options = { side: -1 as const, drift: 0, sailorHeight: FRONT_ROWS, mouth: SHARK_MOUTH, marks: shipPlankMarks() };

describe("which departures take the plank", () => {
  it("is every one, from one set: done, failed, closed and removed alike", () => {
    const all: DeckDeparture[] = ["done", "failed", "closed", "removed"];
    for (const departure of all) expect(exitFor(departure)).toBe("plank");
    expect([...PLANK_DEPARTURES].sort()).toEqual([...all].sort());
  });
});

describe("the plank, read against the hull", () => {
  it("lies on the gunwale amidships, its foot on open deck that every anchor can walk to", () => {
    expect(walkable(shipStage().floor, PLANK.foot.x, PLANK.foot.y)).toBe(true);
    expect(underNear(PLANK.foot.x, PLANK.foot.y)).toBe(false);
    // The gunwale's top is the first row of the near rail, and the plank's feet start on it.
    expect(underNear(PLANK.rail.x, PLANK.rail.y)).toBe(true);
    expect(underNear(PLANK.rail.x, PLANK.rail.y - 1)).toBe(false);
    for (const anchor of ANCHORS) {
      const path = findPath(shipStage().floor, anchor, PLANK.foot);
      expect(path.at(-1), anchor.id).toEqual(PLANK.foot);
    }
    // The board drawn in code is clear of the mast and the gunwale's bollards.
    const columns = plankPixels(shipPlankMarks())
      .filter(([, y]) => y === PLANK.rail.y)
      .flatMap(([x, , width]) => [x, x + width - 1]);
    expect(Math.min(...columns)).toBeGreaterThan(224);
    expect(Math.max(...columns)).toBeLessThan(269);
  });

  it("is drawn over the hull in the hull's own colours, from the gunwale to its tip, and its shadow", () => {
    const hull = new Set<number>();
    const [sx, sy, sw, sh] = manifest.ship.frame;
    for (let y = sy; y < sy + sh; y += 1) for (let x = sx; x < sx + sw; x += 1) if (atlas.at(x, y).alpha === 255) hull.add(atlas.at(x, y).rgb);
    for (const colour of Object.values(PLANK_COLOURS)) expect(hull.has(colour), colour.toString(16)).toBe(true);
    const pixels = plankPixels(shipPlankMarks());
    const rows = pixels.map(([, y, , height]) => [y, y + height - 1]).flat();
    expect(Math.min(...rows)).toBe(PLANK.rail.y);
    // Above the waterline, on the hull's near side: never out over open sea.
    expect(Math.max(...rows)).toBeLessThan(WATERLINE);
    for (const [x, y, width, height] of pixels) {
      for (let dy = 0; dy < height; dy += 1) for (let dx = 0; dx < width; dx += 1) expect(underNear(x + dx, y + dy), `${x + dx},${y + dy}`).toBe(true);
    }
  });

  it("draws the generated board on the same anchors: its walking face from the rail to the tip, centred on the walk", () => {
    const plank = extras.plank!;
    expect(plank.texture).toBe("plank/plank.png");
    const board = decodePng(readFileSync(art(plank.texture)));
    expect([board.width, board.height]).toEqual(plank.size);
    const [left, top] = plank.position;
    const opaque = (x: number, y: number) => {
      const [bx, by] = [x - left, y - top];
      return bx >= 0 && by >= 0 && bx < board.width && by < board.height && board.at(bx, by).alpha === 255;
    };
    // Something to stand on under the walk's every foot, from the rail to the tip, and nothing above the gunwale.
    for (let y = PLANK.rail.y; y <= PLANK.tip.y; y += 1) {
      for (let dx = -3; dx <= 3; dx += 1) expect(opaque(PLANK.rail.x + dx, y), `${PLANK.rail.x + dx},${y}`).toBe(true);
    }
    for (let x = left; x < left + board.width; x += 1) expect(opaque(x, top - 1)).toBe(false);
    expect(top).toBe(PLANK.rail.y - 1);
    // Clear of the mast and the gunwale's bollards, and above the waterline.
    expect(left).toBeGreaterThan(224);
    expect(left + board.width).toBeLessThan(269);
    expect(top + board.height).toBeLessThan(WATERLINE);
    // Binary alpha, in the hull's own colours.
    const hull = new Set<number>();
    const [sx, sy, sw, sh] = manifest.ship.frame;
    for (let y = sy; y < sy + sh; y += 1) for (let x = sx; x < sx + sw; x += 1) if (atlas.at(x, y).alpha === 255) hull.add(atlas.at(x, y).rgb);
    for (let y = 0; y < board.height; y += 1) {
      for (let x = 0; x < board.width; x += 1) {
        const { rgb, alpha } = board.at(x, y);
        expect([0, 255]).toContain(alpha);
        if (alpha === 255) expect(hull.has(rgb), `${x},${y}`).toBe(true);
      }
    }
  });

  it("puts the water below the tip as far before the waterline as the tip is before the rail", () => {
    expect(PLANK.water - WATERLINE).toBe(PLANK.tip.y - PLANK.rail.y);
  });
});

describe("one departure's sequence", () => {
  const moments = (side: -1 | 1, drift = 0) => {
    const seen: Array<{ t: number; moment: PlankMoment }> = [];
    for (let t = 0; t <= PLANK_EXIT_MS; t += 10) seen.push({ t, moment: plankExit(t, { ...options, side, drift }) });
    return seen;
  };

  it("walks out, jumps, splashes, swims, and is taken: in that order, and over in under three seconds", () => {
    expect(PLANK_EXIT_MS).toBeLessThan(3000);
    const seen = moments(-1);
    const layers: string[] = [];
    const sharks: string[] = [];
    const splashes: string[] = [];
    for (const { moment } of seen) {
      if (moment.sailor !== null && layers.at(-1) !== moment.sailor.layer) layers.push(moment.sailor.layer);
      if (moment.shark !== null && sharks.at(-1) !== moment.shark.frame) sharks.push(moment.shark.frame);
      const splash = moment.splash?.frame ?? "-";
      if (splashes.at(-1) !== splash) splashes.push(splash);
    }
    expect(layers).toEqual(["deck", "rail", "sea"]);
    expect(sharks).toEqual(["fin", "surface", "chomp", "submerge"]);
    // A splash as it lands, and another as the shark goes under.
    expect(splashes).toEqual(["-", "impact", "burst", "-", "burst", "-"]);
    expect(plankExit(PLANK_EXIT_MS, options)).toEqual({ sailor: null, shark: null, splash: null, done: true });
    // Every position a whole pixel.
    for (const { moment } of seen) {
      for (const point of [moment.sailor, moment.shark, moment.splash]) if (point !== null) expect(Number.isInteger(point.x) && Number.isInteger(point.y)).toBe(true);
    }
  });

  it("steps along the plank from foot to tip, and lands in the water below it", () => {
    const at = (t: number) => plankExit(t, options).sailor!;
    expect(at(0)).toMatchObject({ x: PLANK.foot.x, y: PLANK.foot.y, layer: "deck" });
    const walking = moments(-1)
      .map(({ moment }) => moment.sailor)
      .filter((each): each is NonNullable<PlankMoment["sailor"]> => each?.layer === "rail");
    for (const each of walking) {
      expect(each.y).toBeGreaterThanOrEqual(PLANK.foot.y - 2);
      expect(each.y).toBeLessThanOrEqual(PLANK.tip.y);
      expect(Math.abs(each.x - PLANK.tip.x)).toBeLessThanOrEqual(1);
    }
    expect(walking.some((each) => each.y === PLANK.tip.y)).toBe(true);
    // Just before the water it is still falling, whole; at the impact its feet are in the water.
    expect(at(IMPACT_AT - 1)).toMatchObject({ layer: "sea", reveal: 1 });
    expect(at(IMPACT_AT - 1).y).toBeLessThanOrEqual(PLANK.water);
    expect(at(IMPACT_AT)).toMatchObject({ x: PLANK.tip.x, y: PLANK.water });
    // Its head and shoulders bob up out of the splash.
    expect(at(CHOMP_AT - 50).reveal * FRONT_ROWS).toBe(11);
    expect(plankExit(CHOMP_AT - 1, options).sailor).not.toBeNull();
    expect(plankExit(CHOMP_AT, options).sailor).toBeNull();
  });

  it("brings the shark's open mouth over the swimmer from either side, mirrored when it comes from the right", () => {
    for (const side of [-1, 1] as const) {
      for (const drift of [-3, 0, 3]) {
        const chomp = plankExit(CHOMP_AT, { ...options, side, drift }).shark!;
        const swimmer = plankExit(CHOMP_AT - 1, { ...options, side, drift }).sailor!;
        expect(chomp.frame).toBe("chomp");
        expect(chomp.flip).toBe(side === 1);
        expect(chomp.y).toBe(PLANK.water);
        expect(chomp.x + (chomp.flip ? -SHARK_MOUTH[0] : SHARK_MOUTH[0])).toBe(swimmer.x);
        // The fin closes in from its own side.
        const fin = plankExit(FIN_AT, { ...options, side, drift }).shark!;
        expect(Math.sign(fin.x - chomp.x)).toBe(side);
      }
    }
  });
});

describe("the crew leaving by the plank", () => {
  const sea = (figures: Figure[]) => figures.filter((figure) => figure.layer === "sea");

  it("walks a departing sailor to the plank by the deck's paths, sends it over, and leaves nothing behind", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a"), sailor("b", "idle")], { snap: false });
    applyCrew(crew, [sailor("b", "idle")], { snap: false, departures: { a: "done" } });
    const a = crew.walkers.get("a")!;
    expect(a).toMatchObject({ phase: "leaving", exit: "plank", anchor: null });
    expect(a.path.at(-1)).toEqual(PLANK.foot);
    for (const point of a.path) expect(walkable(shipStage().floor, point.x, point.y)).toBe(true);
    // On its way it is no longer one of the crew: no badge, not under the pointer.
    const leaving = crewFigures(crew, 0, { still: false }).find((figure) => figure.key === "a")!;
    expect(leaving.departing).toBe(true);
    expect(showsBadge(leaving)).toBe(false);
    expect(sailorAt([leaving], shipCast(), { x: leaving.x, y: leaving.y - 10 })).toBeNull();

    const layers = new Set<string>();
    let sharks = 0;
    run(crew, 20_000, () => {
      for (const figure of crewFigures(crew, 0, { still: false })) if (figure.key.startsWith("a")) layers.add(figure.layer);
      sharks = Math.max(sharks, plankEffects(crew).filter((effect) => effect.shark !== null).length);
    });
    expect([...layers]).toEqual(["deck", "rail", "sea"]);
    expect(sharks).toBe(1);
    expect(crew.walkers.has("a")).toBe(false);
    expect(crew.departures).toEqual([]);
    expect(crewFigures(crew, 0, { still: false }).map((figure) => figure.key)).toEqual(["b"]);
    expect(plankEffects(crew)).toEqual([]);
  });

  it("takes several one at a time: one on the plank, one shark in the water, each with one shark of its own", () => {
    const crew = createCrew(shipStage(), shipCast());
    const keys = ["a", "b", "c", "d", "e"];
    applyCrew(crew, keys.map((key) => sailor(key, key === "c" ? "waiting" : "working")), { snap: false });
    applyCrew(crew, [], { snap: false });
    expect(crew.queue).toEqual(keys);
    const waiting = keys.map((key) => crew.walkers.get(key)!.target);
    for (const spot of waiting) expect(walkable(shipStage().floor, spot.x, spot.y)).toBe(true);
    expect(new Set(waiting.map((spot) => `${spot.x},${spot.y}`)).size).toBe(keys.length);

    const sharkKeys = new Set<string>();
    const sides = new Map<string, number>();
    run(crew, 40_000, () => {
      const onPlank = crewFigures(crew, 0, { still: false }).filter((figure) => figure.layer === "rail");
      expect(onPlank.length).toBeLessThanOrEqual(1);
      const sharks = plankEffects(crew).filter((effect) => effect.shark !== null);
      expect(sharks.length).toBeLessThanOrEqual(1);
      for (const effect of sharks) {
        sharkKeys.add(effect.key);
        sides.set(effect.key, effect.shark!.flip ? 1 : -1);
      }
    });
    expect([...sharkKeys].map((key) => key.split("~")[0]).sort()).toEqual(keys);
    // The sharks take turns coming from the left and the right.
    expect(new Set(sides.values())).toEqual(new Set([-1, 1]));
    expect(crew.walkers.size).toBe(0);
    expect(crew.departures).toEqual([]);
    expect(crew.queue).toEqual([]);
  });

  it("lets the next one up only once the one before is in the water", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a"), sailor("b")], { snap: false });
    applyCrew(crew, [], { snap: false });
    let firstBoard = -1;
    let secondBoard = -1;
    let elapsed = 0;
    run(crew, 30_000, () => {
      elapsed += 33;
      const keys = crew.departures.map((departure) => departure.key.split("~")[0]);
      if (firstBoard < 0 && keys.includes("a")) firstBoard = elapsed;
      if (secondBoard < 0 && keys.includes("b")) secondBoard = elapsed;
      if (!plankFree(crew)) expect(crew.departures.filter((departure) => departure.ms < IMPACT_AT)).toHaveLength(1);
    });
    expect(firstBoard).toBeGreaterThan(0);
    expect(secondBoard - firstBoard).toBeGreaterThanOrEqual(IMPACT_AT);
  });

  it("turns one still waiting back if its card returns, and brings up a new sailor for one already over the side", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a"), sailor("b")], { snap: false });
    applyCrew(crew, [], { snap: false });
    run(crew, 300);
    applyCrew(crew, [sailor("b", "blocked")], { snap: false });
    expect(crew.queue).toEqual(["a"]);
    expect(crew.walkers.get("b")).toMatchObject({ phase: "walking", state: "blocked" });

    // `a` over the side: its card back brings a new `a` up the hatch, and the old one's sequence plays out.
    run(crew, 20_000, () => {
      if (crew.departures.some((departure) => departure.key.startsWith("a~")) && !crew.walkers.has("a")) {
        applyCrew(crew, [sailor("a"), sailor("b", "blocked")], { snap: false });
      }
    });
    expect(crew.walkers.get("a")).toMatchObject({ phase: "settled" });
    expect(crew.departures).toEqual([]);
    const keys = crewFigures(crew, 0, { still: false }).map((figure) => figure.key);
    expect(keys.sort()).toEqual(["a", "b"]);
  });

  it("ends cleanly however fast the cards come and go", () => {
    const crew = createCrew(shipStage(), shipCast());
    for (let round = 0; round < 12; round += 1) {
      applyCrew(crew, round % 2 === 0 ? [sailor("a"), sailor("b", "idle")] : [], { snap: false });
      run(crew, 250);
    }
    applyCrew(crew, [], { snap: false });
    run(crew, 60_000);
    expect(crew.walkers.size).toBe(0);
    expect(crew.departures).toEqual([]);
    expect(crew.queue).toEqual([]);
    expect(crewFigures(crew, 0, { still: false })).toEqual([]);
    expect(plankEffects(crew)).toEqual([]);
  });
});

describe("leaving under reduced motion", () => {
  it("fades out where it stood, with no walk, no plank and no shark", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a"), sailor("b", "idle")], { snap: true });
    const before = crewFigures(crew, 0, { still: true }).find((figure) => figure.key === "a")!;
    applyCrew(crew, [sailor("b", "idle")], { snap: true, departures: { a: "done" } });
    expect(crew.walkers.has("a")).toBe(false);
    expect(fading(crew)).toBe(true);
    const alphas: number[] = [];
    while (fading(crew)) {
      const ghost = crewFigures(crew, 0, { still: true }).find((figure) => figure.key.startsWith("a~"));
      if (ghost !== undefined) {
        expect({ x: ghost.x, y: ghost.y, pose: ghost.pose, layer: ghost.layer, departing: ghost.departing }).toEqual({
          x: before.x,
          y: before.y,
          pose: before.pose,
          layer: "deck",
          departing: true,
        });
        alphas.push(ghost.alpha);
      }
      expect(plankEffects(crew)).toEqual([]);
      stepDepartures(crew, 50);
    }
    expect(alphas.length).toBe(FADE_MS / 50);
    expect(alphas).toEqual([...alphas].sort((x, y) => y - x));
    expect(alphas[0]).toBe(1);
    expect(crewFigures(crew, 0, { still: true }).map((figure) => figure.key)).toEqual(["b"]);
  });

  it("turned on mid-sequence, fades whoever is still in sight where they are and drops every shark", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a"), sailor("b"), sailor("c")], { snap: false });
    applyCrew(crew, [sailor("c")], { snap: false });
    // Until the first is swimming and the fin is out.
    let caught = false;
    for (let at = 0; at < 30_000 && !caught; at += 33) {
      stepCrew(crew, 33);
      caught = plankEffects(crew).some((effect) => effect.shark?.frame === "fin") && crewFigures(crew, 0, { still: false }).some((figure) => figure.layer === "sea");
    }
    expect(caught).toBe(true);
    const swimmer = crewFigures(crew, 0, { still: false }).find((figure) => figure.layer === "sea")!;
    applyCrew(crew, [sailor("c")], { snap: true });
    expect(plankEffects(crew)).toEqual([]);
    expect(crew.departures.every((departure) => departure.kind === "fade")).toBe(true);
    expect(crew.walkers.has("a") || crew.walkers.has("b")).toBe(false);
    const ghost = crewFigures(crew, 0, { still: true }).find((figure) => figure.key === swimmer.key)!;
    expect({ x: ghost.x, y: ghost.y, reveal: ghost.reveal, layer: ghost.layer }).toEqual({ x: swimmer.x, y: swimmer.y, reveal: swimmer.reveal, layer: "sea" });
    stepDepartures(crew, FADE_MS);
    expect(crew.departures).toEqual([]);
    expect(crewFigures(crew, 0, { still: true }).map((figure) => figure.key)).toEqual(["c"]);
  });
});

describe("the shark and splash, as served", () => {
  it("names the four shark keys and the two splashes, each its size, with the art's own anchors and mouth", () => {
    const exit = extras.exit!;
    // The art's manifest is written with a byte-order mark.
    const source = JSON.parse(readFileSync(sources("shark/manifest.json"), "utf8").replace(/^﻿/, "")) as {
      shark: { anchor: [number, number]; bite: { relativeToWaterAnchor: [number, number] } };
      splash: { anchor: [number, number] };
    };
    expect(exit.shark.anchor).toEqual(source.shark.anchor);
    expect(exit.shark.mouth).toEqual(source.shark.bite.relativeToWaterAnchor);
    expect(exit.shark.mouth).toEqual(SHARK_MOUTH);
    expect(exit.splash.anchor).toEqual(source.splash.anchor);
    for (const [frames, size] of [
      [exit.shark.frames, exit.shark.size],
      [exit.splash.frames, exit.splash.size],
    ] as const) {
      for (const path of Object.values(frames)) {
        const image = decodePng(readFileSync(art(path)));
        expect([image.width, image.height], path).toEqual(size);
      }
    }
  });

  it("stays on the canvas in any pane up to 2.4 times as wide as it is tall, under the deck's exact fit", () => {
    const exit = extras.exit!;
    let lowest = 0;
    for (const [frames, anchor] of [
      [exit.shark.frames, exit.shark.anchor],
      [exit.splash.frames, exit.splash.anchor],
    ] as const) {
      for (const path of Object.values(frames)) {
        const image = decodePng(readFileSync(art(path)));
        for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) if (image.at(x, y).alpha > 0) lowest = Math.max(lowest, y - anchor[1]);
      }
    }
    // The deck's fit does not change for the shark: in a pane wider than this, its lowest rows of ripple are cut.
    for (const width of [400, 800, 1200, 2400]) {
      const height = Math.ceil(width / 2.4);
      const fit = fitDeck({ width, height }, { width: 426, height: 161 }, 2, shipStage().fit.margin);
      const visibleBottom = (height - fit.y) / fit.scale;
      expect(PLANK.water + lowest, `${width}x${height}`).toBeLessThan(visibleBottom);
    }
  });
});
