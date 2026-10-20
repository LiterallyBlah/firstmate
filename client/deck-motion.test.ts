/**
 * The ship deck in motion: the walkable deck and its anchors held to the atlas's own pixels, pathing,
 * anchor reservation, the state shown before the sailor arrives, the hatch, stale greying, depth
 * while walking, the ambient clock, and the frame loop's cap, pause and reduced motion.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { DECK_FPS, flybysAt, LITE_FPS, motionPlan } from "./deck-ambient";
import { bobAt, flickerAt, swayAt } from "./deck-parts";
import { HATCH_MS } from "../test/ship-choreography";
import { applyCrew, createCrew, crewFigures, stepCrew, type Crew, type Figure } from "./deck-crew";
import { deckAnimator, MAX_STEP_MS, type FrameScheduler, type MotionSignals } from "./deck-loop";
import { browserMotion } from "./deck-mount";
import { isSoftwareRenderer } from "./deck-pixi";
import { deckLayers, depthOf, type DeckSailor, type DeckState } from "./deck-scene";
import { shipCast, shipElement, shipFile, shipManifest, shipPlankMarks, shipStage, shipViews, shipWater } from "../test/ship-pack";
import {
  areaAt,
  clearLine,
  findPath,
  inRects,
  pathLength,
  sharedSpot,
  walkable,
  type Facing,
  type Point,
} from "./deck-geometry";
import { fidgetAt } from "./deck-cast";
import { postTransitAt } from "./deck-post-transit";

// The ship's cast, under the names its constants had in the deck's code.
const STATE_POSES = Object.fromEntries((["working", "waiting", "blocked", "idle"] as const).map((state) => [state, shipCast().settled[state].pose])) as Record<DeckState, string>;
const idleMotion = (state: DeckState, facing: Facing, seed: number, nowMs: number) => fidgetAt(shipCast(), state, facing, seed, nowMs);


// The ship's stage, under the names its constants had in the deck's code.
const stage = shipStage();
const ANCHORS = [...stage.zones.values()].flatMap((zone) => zone.posts);
const HATCH = stage.entry;
const WALKABLE = stage.floor.areas;
const PLACES = Object.fromEntries((Object.keys(shipManifest().zones.byState) as DeckState[]).map((state) => [state, stage.zoneOf(state).id])) as Record<DeckState, string>;
const anchorsAt = (place: string) => stage.zones.get(place)!.posts;
const restOverflow = stage.zones.get("rest")!.overflow as { areas: ReadonlyArray<readonly [number, number, number, number]>; spacing: readonly [number, number] };
const inRestArea = (point: { x: number; y: number }) => inRects(restOverflow.areas, point);
const PLANK = shipPlankMarks();

/** The served atlas, decoded: enough of PNG for the one the build writes (8-bit RGBA, not interlaced). */
function decodePng(file: Buffer): { width: number; height: number; alpha: (x: number, y: number) => number } {
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
  return { width, height, alpha: (x, y) => pixels[y * stride + x * 4 + 3] ?? 0 };
}

const atlas = decodePng(readFileSync(shipFile("deck.png")));
function opaque(frame: readonly number[], x: number, y: number): boolean {
  const [fx = 0, fy = 0, fw = 0, fh = 0] = frame;
  const px = Math.floor(x);
  const py = Math.floor(y);
  return px >= 0 && py >= 0 && px < fw && py < fh && atlas.alpha(fx + px, fy + py) === 255;
}
const nearPiece = shipManifest().stage.pieces.find((piece) => piece.id === "near")!;
const near = { frame: nearPiece.sprite.rect!, x: nearPiece.at[0], y: nearPiece.at[1] };
const onHull = (p: Point) => opaque(shipManifest().stage.backdrop.sprite.rect!, p.x, p.y);
const underNear = (p: Point) => opaque(near.frame, p.x - near.x, p.y - near.y);

/** Every point a walk from `from` along `path` passes, a half pixel apart. */
function walkPoints(from: Point, path: readonly Point[]): Point[] {
  const points: Point[] = [from];
  let at = from;
  for (const next of path) {
    const steps = Math.max(1, Math.ceil(Math.hypot(next.x - at.x, next.y - at.y) * 2));
    for (let step = 1; step <= steps; step += 1) points.push({ x: at.x + ((next.x - at.x) * step) / steps, y: at.y + ((next.y - at.y) * step) / steps });
    at = next;
  }
  return points;
}

// Every post, mark and walkable point on the hull, reachable from every other, is the pack linter's
// (`test/deck-settings.test.ts`), for every setting. What is the ship's own is here.
describe("the ship's walkable deck", () => {
  it("keeps ordinary overflow on the main deck and quarterdeck, with non-spill stairs and below-deck rooms", () => {
    expect(WALKABLE.map((area) => [area.id, area.spill])).toEqual([
      ["main-deck", true],
      ["stairs", false],
      ["quarterdeck", true],
      ["rest-corridor", false],
      ["below-deck", false],
    ]);
    let behind = 0;
    for (let y = 80; y < 126; y += 1) for (let x = 40; x < 424; x += 1) if (walkable(shipStage().floor, x, y) && underNear({ x, y })) behind += 1;
    expect(behind).toBeGreaterThan(0);
  });

  it("puts the helm on the quarterdeck, rest below deck and work on the main deck", () => {
    for (const place of ["station", "rest", "helm", "bow"] as const) expect(anchorsAt(place).length).toBeGreaterThanOrEqual(4);
    for (const anchor of ANCHORS) expect(areaAt(shipStage().floor, anchor.x, anchor.y)?.id).toBe(anchor.place === "helm" ? "quarterdeck" : anchor.place === "rest" ? "below-deck" : "main-deck");
    expect(onHull(HATCH)).toBe(true);
  });
});

describe("pathing", () => {
  it("keeps the working deck's routes within their original detour bound", () => {
    const places = [...ANCHORS.filter((anchor) => anchor.place !== "rest"), HATCH, ...[...stage.exits.values()].map((exit) => exit.kind === "choreography" ? exit.queue.at : exit.at)];
    for (const from of places) for (const to of places) {
      if (from.x === to.x && from.y === to.y) continue;
      expect(pathLength(from, findPath(stage.floor, from, to))).toBeLessThan(Math.hypot(to.x - from.x, to.y - from.y) * 1.6 + 30);
    }
  });

  it("climbs the stairs between the main deck and the quarterdeck", () => {
    const helm = ANCHORS.find((anchor) => anchor.id === "helm-1")!;
    const path = findPath(shipStage().floor, HATCH, helm);
    const areas = new Set(walkPoints(HATCH, path).map((point) => areaAt(shipStage().floor, point.x, point.y)?.id));
    expect(areas).toEqual(new Set(["main-deck", "stairs", "quarterdeck"]));
    expect(clearLine(shipStage().floor, HATCH, helm)).toBe(false);
  });

  it("goes round the mast rather than through it", () => {
    const path = findPath(shipStage().floor, { x: 190, y: 107 }, { x: 234, y: 107 });
    expect(path.length).toBeGreaterThan(1);
    for (const point of walkPoints({ x: 190, y: 107 }, path)) expect(walkable(shipStage().floor, point.x, point.y)).toBe(true);
  });

  it("is empty when already there, and starts from the nearest deck when caught off it", () => {
    expect(findPath(shipStage().floor, HATCH, HATCH)).toEqual([]);
    const path = findPath(shipStage().floor, { x: 211, y: 107 }, HATCH);
    expect(path.at(-1)).toEqual(HATCH);
  });

  it("stands a sailor beside a taken anchor, never on another, always on the deck", () => {
    const anchor = ANCHORS[0]!;
    const taken: Point[] = [{ x: anchor.x, y: anchor.y }];
    for (let share = 0; share < 6; share += 1) {
      const spot = sharedSpot(shipStage().floor, anchor, taken, [6, 3]);
      expect(walkable(shipStage().floor, spot.x, spot.y)).toBe(true);
      expect(taken.some((other) => other.x === spot.x && other.y === spot.y)).toBe(false);
      taken.push(spot);
    }
    expect(sharedSpot(shipStage().floor, anchor, [], [6, 3])).toEqual({ x: anchor.x, y: anchor.y });
  });
});

function sailor(key: string, state: DeckState, stale = false): DeckSailor {
  return {
    key,
    label: `Task ${key}`,
    state,
    identity: `agent-${key}`,
    stale,
    caption: { title: `Task ${key}`, status: state, project: null, host: "This machine", line: null, stale: null },
  };
}

/** Steps the crew `ms` on, a 30 fps frame at a time. */
function run(crew: Crew, ms: number): void {
  for (let at = 0; at < ms; at += 33) stepCrew(crew, 33);
}

function anchorAt(point: Point) {
  return ANCHORS.find((anchor) => anchor.x === point.x && anchor.y === point.y) ?? null;
}

describe("the crew on deck", () => {
  it("sends each state to its place, one anchor each, facing the way the anchor says", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a", "working"), sailor("b", "waiting"), sailor("c", "blocked"), sailor("d", "idle")], { snap: false });
    for (const walker of crew.walkers.values()) {
      const anchor = anchorAt(walker);
      expect(anchor?.place, walker.key).toBe(PLACES[walker.state]);
      expect(walker.anchor).toBe(anchor?.id);
      expect(walker.facing).toBe(anchor?.facing);
    }
    expect(PLACES).toEqual({ working: "station", waiting: "helm", blocked: "bow", idle: "rest" });
    const poses = Object.fromEntries(crewFigures(crew, 0, { still: true }).map((figure) => [figure.state, figure.pose]));
    expect(poses).toEqual({ ...STATE_POSES, working: "lookout" });
  });

  it("never stacks two sailors: distinct anchors while they last, then a spot beside a shared one, all on open deck", () => {
    for (const state of ["working", "waiting", "blocked", "idle"] as const) {
      for (const count of [1, 3, anchorsAt(PLACES[state]).length, 12, 30]) {
        const crew = createCrew(shipStage(), shipCast());
        applyCrew(crew, Array.from({ length: count }, (_, index) => sailor(`${state}-${String(index).padStart(2, "0")}`, state)), { snap: true });
        const walkers = [...crew.walkers.values()];
        expect(new Set(walkers.map((walker) => `${walker.x},${walker.y}`)).size, `${count} ${state}`).toBe(count);
        const free = anchorsAt(PLACES[state]).length;
        expect(new Set(walkers.map((walker) => walker.anchor)).size).toBe(Math.min(count, free));
        for (const walker of walkers) {
          expect(walkable(shipStage().floor, walker.x, walker.y), `${walker.key} at ${walker.x},${walker.y}`).toBe(true);
          expect(underNear(walker), `${walker.key} behind the near rail`).toBe(state === "idle");
          expect(onHull(walker)).toBe(true);
        }
      }
    }
  });

  it("keeps a sailor's anchor from poll to poll, and frees it for the next when it moves on", () => {
    const stations = anchorsAt("station").length;
    const working = Array.from({ length: stations }, (_, index) => sailor(`w${index}`, "working"));
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, working, { snap: false });
    const held = crew.walkers.get("w0")!.anchor;
    applyCrew(crew, [...working].reverse(), { snap: false });
    expect(crew.walkers.get("w0")!.anchor).toBe(held);
    // Every station taken; w0 goes idle and a newcomer takes the one it freed, not a shared spot.
    applyCrew(crew, [sailor("w0", "idle"), ...working.slice(1), sailor("new", "working")], { snap: false });
    expect(crew.walkers.get("new")!.anchor).toBe(held);
    run(crew, 20_000);
    const spots = [...crew.walkers.values()].map((walker) => `${walker.x},${walker.y}`);
    expect(new Set(spots).size).toBe(spots.length);
  });

  it("shows a new state at once, and only then walks the sailor there", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a", "working")], { snap: false });
    const first = crewFigures(crew, 0, { still: true })[0]!;
    const start = { x: first.x, y: first.row };
    applyCrew(crew, [sailor("a", "waiting")], { snap: false });
    // The state (the mark and the legend) is the new one before the sprite has moved a pixel.
    let figure = crewFigures(crew, 0, { still: false })[0]!;
    expect(figure.state).toBe("waiting");
    expect({ x: figure.x, y: figure.row }).toEqual(start);
    run(crew, 1000);
    figure = crewFigures(crew, 1000, { still: false })[0]!;
    expect(figure.state).toBe("waiting");
    expect(figure.moving).toBe(true);
    expect(figure.pose).toMatch(/walk|idle|pass|climb/);
    expect({ x: figure.x, y: figure.row }).not.toEqual(start);
    run(crew, 20_000);
    expect(anchorAt(crew.walkers.get("a")!)?.place).toBe("helm");
    expect(crewFigures(crew, 0, { still: true })[0]).toMatchObject({ moving: false, pose: "waiting" });
  });

  it("turns round mid-walk from wherever the sailor is", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a", "idle")], { snap: false });
    applyCrew(crew, [sailor("a", "waiting")], { snap: false });
    run(crew, 1500);
    const midway = { x: crew.walkers.get("a")!.x, y: crew.walkers.get("a")!.y };
    applyCrew(crew, [sailor("a", "blocked")], { snap: false });
    expect(crew.walkers.get("a")!.path.length).toBeGreaterThan(0);
    for (const point of walkPoints(midway, crew.walkers.get("a")!.path)) expect(walkable(shipStage().floor, point.x, point.y)).toBe(true);
    run(crew, 30_000);
    expect(anchorAt(crew.walkers.get("a")!)?.place).toBe("bow");
  });

  it("walks with the side frames across the deck, mirrored going forward, and rises a pixel as a leg passes", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a", "idle")], { snap: false });
    // Start on the working deck: below-deck travel also includes the vertical access corridor.
    Object.assign(crew.walkers.get("a")!, { x: 132, y: 117 });
    applyCrew(crew, [sailor("a", "blocked")], { snap: false });
    const poses = new Set<string>();
    const rises = new Set<number>();
    for (let at = 0; at < 3000; at += 33) {
      stepCrew(crew, 33);
      const figure = crewFigures(crew, at, { still: false })[0]!;
      if (!figure.moving) continue;
      poses.add(`${figure.pose}${figure.flip ? ":flip" : ""}`);
      rises.add(figure.row - figure.y);
    }
    expect(poses).toEqual(new Set(shipCast().walkSide.map(pose => `${pose}:flip`)));
    expect(rises).toEqual(new Set([0])); // Passing motion is drawn into the registered frames.
  });

  it("brings a new crewmate up through the hatch and sends an archived one off by the plank", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a", "working")], { snap: false });
    // The crew aboard when the deck opens is simply there.
    expect(crew.walkers.get("a")!.phase).toBe("settled");
    applyCrew(crew, [sailor("a", "working"), sailor("b", "idle")], { snap: false });
    let b = crewFigures(crew, 0, { still: false }).find((figure) => figure.key === "b")!;
    expect({ x: b.x, y: b.row, reveal: b.reveal, state: b.state }).toEqual({ ...HATCH, reveal: 0, state: "idle" });
    stepCrew(crew, HATCH_MS / 2);
    b = crewFigures(crew, 0, { still: false }).find((figure) => figure.key === "b")!;
    expect(b.reveal).toBeCloseTo(0.5);
    run(crew, 20_000);
    expect(anchorAt(crew.walkers.get("b")!)?.place).toBe("rest");

    applyCrew(crew, [sailor("b", "idle")], { snap: false });
    const a = crew.walkers.get("a")!;
    expect(a.phase).toBe("leaving");
    expect(a.anchor).toBeNull();
    expect(a.path.at(-1)).toEqual(PLANK.foot);
    run(crew, 20_000);
    expect(crew.walkers.has("a")).toBe(false);
    expect(crew.departures).toEqual([]);
    expect(crew.walkers.has("b")).toBe(true);
  });

  it("turns a leaving sailor back if its card returns, and sends one still on the ladder straight back down", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a", "working")], { snap: false });
    applyCrew(crew, [], { snap: false });
    run(crew, 500);
    applyCrew(crew, [sailor("a", "blocked")], { snap: false });
    expect(crew.walkers.get("a")!.phase).toBe("walking");
    run(crew, 30_000);
    expect(anchorAt(crew.walkers.get("a")!)?.place).toBe("bow");

    applyCrew(crew, [sailor("a", "blocked"), sailor("b", "working")], { snap: false });
    stepCrew(crew, 200);
    applyCrew(crew, [sailor("a", "blocked")], { snap: false });
    expect(crew.walkers.get("b")!.phase).toBe("sinking");
    run(crew, HATCH_MS);
    expect(crew.walkers.has("b")).toBe(false);
  });

  it("greys a stale sailor where it stands, keeps its last state, and stills its idle motion", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a", "working"), sailor("b", "blocked")], { snap: false });
    const where = () => [...crew.walkers.values()].map((walker) => ({ key: walker.key, x: walker.x, y: walker.y, state: walker.state }));
    const before = where();
    applyCrew(crew, [sailor("a", "working", true), sailor("b", "blocked", true)], { snap: false });
    run(crew, 5000);
    expect(where()).toEqual(before);
    for (let at = 0; at < 8000; at += 100) {
      for (const figure of crewFigures(crew, at, { still: false })) {
        expect(figure.stale).toBe(true);
        expect(figure.state).not.toBe("idle");
        expect(figure.y).toBe(figure.row);
      }
    }
  });

  it("idles with motion: hauling, breathing and fretting in whole pixels", () => {
    for (const state of ["working", "waiting", "blocked"] as const) {
      const seen = new Set<string>();
      for (let at = 0; at < 8000; at += 50) {
        const { dx, dy, pose } = idleMotion(state, "right", 3, at);
        expect(Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && Number.isInteger(dx) && Number.isInteger(dy)).toBe(true);
        seen.add(`${dx},${dy},${pose}`);
      }
      expect(seen.size, state).toBeGreaterThan(1);
    }
    // At ease, the feet never move: the sailor breathes in place instead.
    for (let at = 0; at < 8000; at += 50) expect(idleMotion("idle", "front", 3, at)).toEqual({ dx: 0, dy: 0 });
    // A sailor facing left hauls to the left.
    expect(new Set(Array.from({ length: 40 }, (_, i) => idleMotion("working", "left", 0, i * 100).pose))).toEqual(new Set(["hauling", "hauling-pull"]));
  });

  it.each([false, true])("hides disconnected workers immediately without departures (snap %s), freeing their posts", (snap) => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("local", "working"), sailor("offline", "working")], { snap: true });
    applyCrew(crew, [sailor("local", "working")], { snap, hidden: new Set(["offline"]) });
    expect([...crew.walkers.keys()]).toEqual(["local"]);
    expect(crew.departures).toEqual([]);
    expect(crew.queue).toEqual([]);
    expect(crewFigures(crew, 0, { still: true }).map(figure => figure.key)).toEqual(["local"]);
    applyCrew(crew, [sailor("local", "working"), sailor("offline", "working")], { snap });
    expect(crew.walkers.has("offline")).toBe(true);
    // Also cancel an already-started departure if its host becomes hidden.
    applyCrew(crew, [sailor("local", "working"), sailor("offline", "working")], { snap: true });
    applyCrew(crew, [sailor("local", "working")], { snap: true });
    expect(crew.departures).toHaveLength(1);
    applyCrew(crew, [sailor("local", "working")], { snap, hidden: new Set(["offline"]) });
    expect(crew.departures).toEqual([]);
  });

  it("under reduced motion jumps every change, with no hatch, no walk and no sway, and still shows the state", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a", "working")], { snap: true });
    applyCrew(crew, [sailor("a", "waiting"), sailor("b", "idle")], { snap: true });
    for (const walker of crew.walkers.values()) {
      expect(walker.phase).toBe("settled");
      expect(anchorAt(walker)?.place).toBe(PLACES[walker.state]);
    }
    const first = crewFigures(crew, 0, { still: true });
    for (let at = 0; at < 8000; at += 250) expect(crewFigures(crew, at, { still: true })).toEqual(first);
    expect(first.map((figure) => [figure.key, figure.state, figure.reveal])).toEqual([
      ["a", "waiting", 1],
      ["b", "idle", 1],
    ]);
    applyCrew(crew, [sailor("b", "idle")], { snap: true });
    expect([...crew.walkers.keys()]).toEqual(["b"]);

    // Turned on mid-walk, with one on the ladder and one leaving: everyone settles at once.
    const moving = createCrew(shipStage(), shipCast());
    applyCrew(moving, [sailor("a", "working"), sailor("c", "idle")], { snap: false });
    applyCrew(moving, [sailor("a", "waiting"), sailor("d", "blocked")], { snap: false });
    run(moving, 300);
    applyCrew(moving, [sailor("a", "waiting"), sailor("d", "blocked")], { snap: true });
    expect([...moving.walkers.values()].map((walker) => [walker.key, walker.phase, anchorAt(walker)?.place])).toEqual([
      ["a", "settled", "helm"],
      ["d", "settled", "bow"],
    ]);
    expect(motionPlan({ reducedMotion: true, software: false, hidden: false })).toEqual({ level: "still", animate: false, fps: 0, ambient: false });
  });
});

describe("idle crew at rest", () => {
  /** Every anchor of the other places held, and `idle` sleepers: the most crowded deck there is. */
  function fullDeck(idle: number): Figure[] {
    const crew = createCrew(shipStage(), shipCast());
    const others = (["working", "waiting", "blocked"] as const).flatMap((state) =>
      anchorsAt(PLACES[state]).map((_, index) => sailor(`${state}-${index}`, state)),
    );
    const sleepers = Array.from({ length: idle }, (_, index) => sailor(`idle-${String(index).padStart(2, "0")}`, "idle"));
    applyCrew(crew, [...others, ...sleepers], { snap: true });
    return crewFigures(crew, 0, { still: true });
  }
  // Two dozen sleepers in the rest areas, clear of the crew at work and in the pointer's reach, and the rest posts
  // apart and only there: the pack linter's, for every setting (`test/deck-settings.test.ts`).

  it("past a score of sleepers packs them closer, still in the rest areas, never two on one spot", () => {
    const sleepers = fullDeck(32).filter((figure) => figure.state === "idle");
    expect(new Set(sleepers.map((figure) => `${figure.x},${figure.row}`)).size).toBe(32);
    for (const sleeper of sleepers) expect(inRestArea({ x: sleeper.x, y: sleeper.row }), sleeper.key).toBe(true);
  });

  it.each([true, false])("releases absent workers' posts before replacing a full rest room (snap=%s)", (snap) => {
    const crew = createCrew(shipStage(), shipCast());
    const batch = (prefix: string) => Array.from({ length: 24 }, (_, i) => sailor(`${prefix}-${String(i).padStart(2, "0")}`, "idle"));
    applyCrew(crew, batch("old"), { snap: true });
    const before = [...crew.walkers.values()].map((walker) => walker.target);
    applyCrew(crew, batch("new"), { snap });
    const targets = [...crew.walkers.values()].filter((walker) => walker.key.startsWith("new-")).map((walker) => walker.target);
    expect(targets).toEqual(before);
    expect(new Set(targets.map(({ x, y }) => `${x},${y}`)).size).toBe(24);
  });

  it("takes the rest spots in their order wherever a sleeper comes from, and leaves them when given work", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a", "working"), sailor("b", "waiting"), sailor("c", "blocked")], { snap: false });
    applyCrew(crew, [sailor("a", "idle"), sailor("b", "idle"), sailor("c", "idle")], { snap: false });
    const rest = anchorsAt("rest");
    expect([..."abc"].map((key) => crew.walkers.get(key)!.anchor).sort()).toEqual(rest.slice(0, 3).map((anchor) => anchor.id).sort());
    run(crew, 30_000);
    for (const key of "abc") expect(anchorAt(crew.walkers.get(key)!)?.place).toBe("rest");
    // Back to work: the rest spot is given up, and the walk back is on the deck all the way.
    const resting = { x: crew.walkers.get("a")!.x, y: crew.walkers.get("a")!.y };
    applyCrew(crew, [sailor("a", "working"), sailor("b", "idle"), sailor("c", "idle")], { snap: false });
    const back = crew.walkers.get("a")!;
    expect(anchorAt(back.target)?.place).toBe("station");
    for (const point of walkPoints(resting, back.path)) expect(walkable(shipStage().floor, point.x, point.y)).toBe(true);
    applyCrew(crew, [sailor("a", "working"), sailor("b", "idle"), sailor("c", "idle"), sailor("d", "idle")], { snap: false });
    // A newcomer to rest takes the first spot free in the order, the one given up included.
    const firstFree = rest.find((anchor) => ![..."bc"].some((key) => crew.walkers.get(key)!.anchor === anchor.id))!;
    expect(crew.walkers.get("d")!.anchor).toBe(firstFree.id);
  });

  it("walks a sailor that goes idle to its rest spot, and back to a station when work comes, never in a jump", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a", "working")], { snap: false });
    const first = crewFigures(crew, 0, { still: true })[0]!;
    const station = { x: first.x, y: first.row };
    applyCrew(crew, [sailor("a", "idle")], { snap: false });
    // Idle at once, in the mark and the legend; the sprite walks.
    let figure = crewFigures(crew, 0, { still: false })[0]!;
    expect(figure.state).toBe("idle");
    expect({ x: figure.x, y: figure.row }).toEqual(station);
    const seen: Point[] = [];
    for (let at = 0; at < 20_000; at += 33) {
      stepCrew(crew, 33);
      const current = crew.walkers.get("a")!;
      const walker = current.transit === null ? current : postTransitAt(current.transit.route, current.transit.ms, false);
      const last = seen.at(-1) ?? station;
      // A walk: never more than a frame's stride at a time.
      expect(Math.hypot(walker.x - last.x, walker.y - last.y)).toBeLessThanOrEqual(1.1);
      seen.push({ x: walker.x, y: walker.y });
    }
    figure = crewFigures(crew, 0, { still: true })[0]!;
    expect(anchorAt({ x: figure.x, y: figure.row })?.place).toBe("rest");
    expect(figure.pose).toBe("side-idle");
    applyCrew(crew, [sailor("a", "working")], { snap: false });
    run(crew, 20_000);
    expect(anchorAt(crew.walkers.get("a")!)?.place).toBe("station");
  });
});

describe("depth while walking", () => {
  it("passes behind the mast while its feet are behind the mast's row, and in front once they are not", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, [sailor("a", "idle")], { snap: false });
    const walker = crew.walkers.get("a")!;
    expect(walker.y).toBeGreaterThan(110);
    // From the rest area to the station behind the mast.
    walker.state = "working";
    walker.path = findPath(shipStage().floor, walker, { x: 212, y: 94 });
    walker.phase = "walking";
    const sides = new Set<string>();
    for (let at = 0; at < 4000; at += 33) {
      stepCrew(crew, 33);
      const figures = crewFigures(crew, at, { still: false });
      const order = deckLayers(figures, shipStage().pieces, shipStage().props).map((layer) => (layer.kind === "piece" ? layer.name : layer.kind === "sailor" ? "sailor" : layer.kind));
      const behind = order.indexOf("sailor") < order.indexOf("mast");
      // Feet on the mast's own row are behind it, as for every piece.
      expect(behind, `row ${figures[0]!.row}`).toBe(figures[0]!.row <= 110);
      sides.add(behind ? "behind" : "in front");
      expect(order.at(-1)).toBe("near");
    }
    expect(sides).toEqual(new Set(["in front", "behind"]));
    expect(depthOf(110, 0)).toBeLessThan(depthOf(110, 1));
    expect(depthOf(null, 1)).toBeGreaterThan(depthOf(161, 1));
  });
});

describe("the ambient clock", () => {
  it("bobs the ship and sways the masthead a whole pixel at most, at the art's own heave", () => {
    const { bob } = shipManifest().stage.motion!;
    if (bob === undefined) throw new Error("the ship declares its stage bob");
    const sway = shipManifest().stage.parts.find((part) => part.id === "topmast")!.behaviour!;
    if (sway.kind !== "sway" || typeof sway.amplitude !== "object" || !("channel" in sway.amplitude)) throw new Error("the topmast sways with the heave");
    const heave = 1.2;
    const bobs = new Set<number>();
    const sways = new Set<number>();
    for (let t = 0; t < 30; t += 0.05) {
      bobs.add(bobAt(t, bob.periodS, heave));
      sways.add(swayAt(t, sway, heave * (sway.amplitude.scale ?? 1)));
    }
    expect(bobs).toEqual(new Set([-1, 0, 1]));
    expect(sways).toEqual(new Set([-1, 0, 1]));
  });

  it("flickers the lanterns within a narrow band, never in step", () => {
    const { lights, lightStyles } = shipManifest().stage;
    const flicker = lightStyles.lantern!.flicker;
    for (let t = 0; t < 20; t += 0.03) {
      for (const light of lights) {
        const level = flickerAt(t, light.seed, flicker);
        expect(level).toBeGreaterThanOrEqual(0.55);
        expect(level).toBeLessThanOrEqual(1);
      }
    }
    expect(flickerAt(1, lights[0]!.seed, flicker)).not.toBe(flickerAt(1, lights[1]!.seed, flicker));
  });

  it("flies the odd gull, the same gulls for the same clock, at the masthead's height and never more than two", () => {
    const gull = shipElement("gull", "flyby");
    const gullsAt = (t: number) => flybysAt(t, shipStage().width, gull);
    let seconds = 0;
    for (let t = 0; t < 600; t += 0.25) {
      const gulls = gullsAt(t);
      expect(gulls).toEqual(gullsAt(t));
      expect(gulls.length).toBeLessThanOrEqual(gull.most);
      for (const flyer of gulls) {
        // The generated sprite's raised wing reaches 17 rows over the beak, its lowered one 9 under it:
        // the whole gull stays inside the deck's frame, and well above the horizon.
        expect(flyer.y - 17).toBeGreaterThanOrEqual(0);
        expect(flyer.y + 9).toBeLessThan(shipWater().horizon);
        expect(flyer.y).toBeLessThanOrEqual(gull.rows[1] + gull.wobble.px);
      }
      if (gulls.length > 0) seconds += 0.25;
    }
    // Now and then: some of the time, never most of it.
    expect(seconds).toBeGreaterThan(60);
    expect(seconds).toBeLessThan(400);
    expect(gullsAt(0)).toEqual([]);
    expect(gull.slotS).toBeGreaterThan(15);
  });

  it("looks far enough back for a crossing that outlasts its slot", () => {
    const gull = shipElement("gull", "flyby");
    // Slow enough that a crossing takes four and a half slots, and one sets off every slot: five in the air at once,
    // each from wholly off one edge to wholly off the other.
    const slow = { ...gull, speed: 5, chance: 1 };
    const flyers = flybysAt(200, shipStage().width, slow);
    expect(flyers).toHaveLength(5);
    for (const flyer of flyers) expect(Math.abs(flyer.x - shipStage().width / 2)).toBeLessThanOrEqual(shipStage().width / 2 + gull.margin);
  });

  it("knows a software renderer from a GPU", () => {
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)")).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (AMD, AMD Radeon(TM) 880M Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
    expect(isSoftwareRenderer(null)).toBe(false);
  });

  it("plans full motion on a GPU, lite on a software renderer, still under reduced motion, nothing while hidden", () => {
    expect(motionPlan({ reducedMotion: false, software: false, hidden: false })).toEqual({ level: "full", animate: true, fps: DECK_FPS, ambient: true });
    expect(motionPlan({ reducedMotion: false, software: true, hidden: false })).toEqual({ level: "lite", animate: true, fps: LITE_FPS, ambient: false });
    expect(motionPlan({ reducedMotion: false, software: false, hidden: true }).animate).toBe(false);
    expect(motionPlan({ reducedMotion: true, software: true, hidden: false }).level).toBe("still");
    expect(DECK_FPS).toBe(30);
  });
});

/** A fake `requestAnimationFrame`: frames fire as the test runs the display, one vsync at a time. */
function fakeFrames(hz: number) {
  let now = 1000;
  let next = 1;
  const pending = new Map<number, (nowMs: number) => void>();
  const scheduler: FrameScheduler = {
    request(callback) {
      pending.set(next, callback);
      return next++;
    },
    cancel(handle) {
      pending.delete(handle);
    },
  };
  return {
    scheduler,
    pending: () => pending.size,
    advance(ms: number) {
      const end = now + ms;
      while (now + 1000 / hz <= end + 1e-9) {
        now += 1000 / hz;
        const due = [...pending.values()];
        pending.clear();
        for (const callback of due) callback(now);
      }
    },
  };
}

function fakeSignals(options: { reduced?: boolean; hidden?: boolean } = {}) {
  const state = { reduced: options.reduced ?? false, hidden: options.hidden ?? false, listeners: new Set<() => void>() };
  const signals: MotionSignals = {
    reducedMotion: () => state.reduced,
    documentHidden: () => state.hidden,
    subscribe(onChange) {
      state.listeners.add(onChange);
      return () => state.listeners.delete(onChange);
    },
  };
  return {
    signals,
    state,
    set(change: { reduced?: boolean; hidden?: boolean }) {
      Object.assign(state, change);
      for (const listener of state.listeners) listener();
    },
  };
}

describe("the frame loop", () => {
  const size = { width: 800, height: 400 };

  it("caps a 120 Hz display at 30 frames a second, and the scene clock at the time it ran", () => {
    const frames = fakeFrames(120);
    const drawn: number[] = [];
    const animator = deckAnimator({ scheduler: frames.scheduler, signals: fakeSignals().signals, software: false, size, frame: (elapsed) => drawn.push(elapsed) });
    frames.advance(2000);
    expect(drawn.length).toBeGreaterThanOrEqual(58);
    expect(drawn.length).toBeLessThanOrEqual(62);
    expect(animator.elapsed()).toBeGreaterThan(1900);
    expect(animator.plan().level).toBe("full");
    animator.destroy();
  });

  it("draws 12 frames a second on a software renderer", () => {
    const frames = fakeFrames(60);
    let drawn = 0;
    const animator = deckAnimator({ scheduler: frames.scheduler, signals: fakeSignals().signals, software: true, size, frame: () => (drawn += 1) });
    frames.advance(2000);
    expect(drawn).toBeGreaterThanOrEqual(22);
    expect(drawn).toBeLessThanOrEqual(26);
    expect(animator.plan()).toMatchObject({ level: "lite", fps: 12 });
    animator.destroy();
  });

  it("pauses while the window is hidden or the pane has no size, requesting no frames, and resumes without a jump", () => {
    const frames = fakeFrames(60);
    const motion = fakeSignals();
    const steps: number[] = [];
    const animator = deckAnimator({ scheduler: frames.scheduler, signals: motion.signals, software: false, size, frame: (_elapsed, step) => steps.push(step) });
    frames.advance(500);
    const before = steps.length;
    motion.set({ hidden: true });
    expect(animator.running()).toBe(false);
    expect(frames.pending()).toBe(0);
    const clock = animator.elapsed();
    frames.advance(5000);
    expect(steps.length).toBe(before);
    expect(animator.elapsed()).toBe(clock);
    motion.set({ hidden: false });
    frames.advance(500);
    expect(steps.length).toBeGreaterThan(before);
    expect(Math.max(...steps)).toBeLessThanOrEqual(MAX_STEP_MS);
    animator.resize(0, 0);
    expect(animator.running()).toBe(false);
    expect(frames.pending()).toBe(0);
    animator.resize(800, 400);
    expect(animator.running()).toBe(true);
    animator.destroy();
    expect(frames.pending()).toBe(0);
    expect(motion.state.listeners.size).toBe(0);
  });

  it("under reduced motion runs no loop, drawing once on each change instead", () => {
    const frames = fakeFrames(60);
    const motion = fakeSignals({ reduced: true });
    const plans: string[] = [];
    const animator = deckAnimator({ scheduler: frames.scheduler, signals: motion.signals, software: false, size, frame: (_elapsed, _step, plan) => plans.push(plan.level) });
    expect(plans).toEqual(["still"]);
    frames.advance(2000);
    expect(frames.pending()).toBe(0);
    animator.invalidate();
    expect(plans).toEqual(["still", "still"]);
    // The preference turned off while the deck is open: it starts moving.
    motion.set({ reduced: false });
    frames.advance(200);
    expect(plans.at(-1)).toBe("full");
    animator.destroy();
  });
});

describe("the browser's motion signals", () => {
  it("reads prefers-reduced-motion and document.hidden, and stops listening when asked", () => {
    const listeners = { change: new Set<() => void>(), visibilitychange: new Set<() => void>() };
    const asked: string[] = [];
    const frames: Array<(now: number) => void> = [];
    const motion = browserMotion({
      matchMedia: (query) => {
        asked.push(query);
        return {
          matches: true,
          addEventListener: (_type, listener) => listeners.change.add(listener),
          removeEventListener: (_type, listener) => listeners.change.delete(listener),
        };
      },
      document: {
        hidden: true,
        addEventListener: (_type, listener) => listeners.visibilitychange.add(listener),
        removeEventListener: (_type, listener) => listeners.visibilitychange.delete(listener),
      },
      requestAnimationFrame: (callback) => frames.push(callback),
      cancelAnimationFrame: () => {},
    });
    expect(asked).toEqual(["(prefers-reduced-motion: reduce)"]);
    expect(motion.signals.reducedMotion()).toBe(true);
    expect(motion.signals.documentHidden()).toBe(true);
    const stop = motion.signals.subscribe(() => {});
    expect([listeners.change.size, listeners.visibilitychange.size]).toEqual([1, 1]);
    stop();
    expect([listeners.change.size, listeners.visibilitychange.size]).toEqual([0, 0]);
    motion.scheduler.request(() => {});
    expect(frames).toHaveLength(1);
    const bare = browserMotion({});
    expect([bare.signals.reducedMotion(), bare.signals.documentHidden()]).toEqual([false, false]);
    // No timer, no refresh: the sky is still drawn whenever the deck is.
    expect(() => bare.every(60_000, () => {})()).not.toThrow();
    expect(bare.clock()).toBeInstanceOf(Date);
  });

  it("refreshes on the browser's interval, and stops it when asked", () => {
    const running = new Map<number, { run: () => void; ms: number }>();
    let next = 1;
    const motion = browserMotion({
      setInterval: (run, ms) => {
        running.set(next, { run, ms });
        return next++;
      },
      clearInterval: (handle) => running.delete(handle),
    });
    let ran = 0;
    const stop = motion.every(60_000, () => (ran += 1));
    expect([...running.values()].map((entry) => entry.ms)).toEqual([60_000]);
    running.get(1)!.run();
    expect(ran).toBe(1);
    stop();
    expect(running.size).toBe(0);
  });
});
