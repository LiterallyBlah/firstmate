/**
 * The crew on deck as it moves: where each sailor is, where it is going and how it looks getting
 * there. Pure — no Pixi, no clock of its own; `client/deck-pixi.ts` calls `stepCrew` with the time
 * since the last frame and draws `crewFigures`.
 *
 * **Application state is not movement state.** `applyCrew` sets a sailor's `state` the moment a poll
 * lands, so its mark under the feet and the legend change at once; only its position waits for the
 * walk. A sailor whose state changes mid-walk turns round from wherever it is.
 *
 * - **Anchors are reserved.** A state sends its sailor to a place (`PLACES`), and the sailor takes the
 *   free anchor there nearest to it. When every anchor at a place is taken, it shares the least crowded
 *   one, standing beside whoever is there (`sharedSpot`), never on them.
 * - **Idle crew rest off the working deck.** An idle sailor walks to the rest areas (`REST_AREAS`) —
 *   the foredeck by the hatch, the foot of the quarterdeck stairs — and dozes there, so the stations,
 *   the helm and the bow show only the crew at work, waiting or stuck. Given work, it walks back. The
 *   rest spots fill in their own order, not the nearest first, so a crowd of sleepers stays tidy.
 * - **The hatch.** A crewmate that joins after the deck opened climbs up through the hatch and walks to
 *   its anchor. The crew already aboard when the deck opens is simply there.
 * - **The plank.** One whose card leaves the deck (done, failed, closed, archived) walks to the plank,
 *   waits its turn there, and goes over the side to the shark (`client/deck-plank.ts`). From the plank's
 *   foot it is a `Departure`, off the crew and on its own clock, so its card coming back brings a new
 *   sailor up the hatch rather than fishing it out. Which departures take the plank is `PLANK_DEPARTURES`;
 *   any other walks back to the hatch and climbs down, as every departure once did.
 * - **Still.** With `snap` (reduced motion), every change is a jump: no walk, no hatch, no sway, and a
 *   departing sailor fades where it stands (`FADE_MS`) instead of taking the plank.
 * - **Stale.** A sailor whose feed is lost keeps its last state and place, greyed by the renderer, and
 *   stops its idle motion: it never turns idle on its own.
 * - **Looks.** A sailor wears the look its agent id hashes to (`lookFor` in `client/deck-extras.ts`),
 *   whoever else is aboard.
 * - **At ease.** An idle sailor stands in profile, arms at its sides, looking fore or aft,
 *   and breathes: its head and shoulders settle a pixel and rise again every four seconds or so
 *   (`breathSink`), while its feet stay planted. The drawn badge and the drifting z say the rest.
 */
import type { SailorOutfit, SailorPose } from "../shared/ship-deck";
import { ATLAS_LOOKS, lookFor, lookLane } from "./deck-extras";
import { anchorsAt, findPath, HATCH, restSpot, sharedSpot, type Anchor, type AnchorPlace, type Facing, type Point } from "./deck-geometry";
import { exitFor, IMPACT_AT, PLANK, PLANK_EXIT_MS, plankExit, type DeckDeparture, type PlankLayer, type SharkFrame, type SplashFrame } from "./deck-plank";
import type { DeckSailor, DeckState } from "./deck-scene";

/** Where each state sends its sailor. */
export const PLACES: Record<DeckState, AnchorPlace> = {
  working: "station",
  waiting: "helm",
  blocked: "bow",
  idle: "rest",
};

/** Walking pace, in deck pixels a second: the length of the main deck in about nine seconds. */
export const WALK_SPEED = 32;
/** How long one step of the walk cycle shows. */
export const STEP_MS = 150;
/** Climbing up out of the hatch, and back down it. */
export const HATCH_MS = 700;
/** A departing sailor's fade under reduced motion. */
export const FADE_MS = 600;
/** The rows of the front poses (`deck.json`), which the plank's sequence crops at the water. */
export const FRONT_ROWS = 32;
/** The shark's mouth from its water anchor, facing right (`docs/ship-deck-art/shark/manifest.json`'s `bite`), until the extras say otherwise. */
export const SHARK_MOUTH: readonly [number, number] = [13, -22];

type Phase = "arriving" | "walking" | "settled" | "leaving" | "sinking";

export interface Walker {
  key: string;
  label: string;
  state: DeckState;
  /** What it wears: an atlas outfit or an extra look, by its agent id. */
  look: string;
  stale: boolean;
  /** Replies wait for the captain over it (`DeckSailor.asks`). */
  asks: boolean;
  x: number;
  y: number;
  /** The anchor reserved, by id; null while leaving. */
  anchor: string | null;
  /** Where the walk ends: the anchor, or a spot beside it when shared. */
  target: Point;
  path: Point[];
  facing: Facing;
  /** The way to face once there: the anchor's. */
  endFacing: Facing;
  phase: Phase;
  /** How it leaves once its card is gone: back down the hatch, or over the side by the plank. */
  exit: "hatch" | "plank";
  /** Time spent in `arriving` or `sinking`. */
  phaseMs: number;
  /** Time spent walking, for the walk cycle. */
  walkedMs: number;
  /** A per-sailor offset for its idle motion, so the crew does not sway in step. */
  seed: number;
}

/**
 * A sailor gone from the crew and on its way out on its own clock: over the side by the plank, or fading
 * where it stood (reduced motion). Keyed apart from the crew, so its card can come back meanwhile.
 */
export interface Departure {
  key: string;
  kind: "plank" | "fade";
  walker: Walker;
  /** Time since it started. */
  ms: number;
  /** The plank: where the shark comes from, and how far across the sailor lands. */
  side: -1 | 1;
  drift: number;
  /** A fade: what shows of the sailor as it goes. */
  pose: SailorPose;
  reveal: number;
  layer: PlankLayer;
  flip: boolean;
}

export interface Crew {
  walkers: Map<string, Walker>;
  /** Sailors gone from the crew, still on their way out. */
  departures: Departure[];
  /** Who is waiting for the plank, in the order they left. */
  queue: string[];
  /** How many departures there have been, for each one's key and the shark's side. */
  serial: number;
  /** The shark's mouth from its water anchor (`SHARK_MOUTH`). */
  mouth: readonly [number, number];
  /** Whether a scene has been applied: the first one places the crew already aboard. */
  started: boolean;
  /** The looks there are to hand out (`crewLooks`): the atlas's two, and each extra look that loaded. */
  looks: readonly string[];
}

export function createCrew(looks: readonly string[] = ATLAS_LOOKS, mouth: readonly [number, number] = SHARK_MOUTH): Crew {
  return { walkers: new Map(), departures: [], queue: [], serial: 0, mouth, started: false, looks: looks.length > 0 ? looks : ATLAS_LOOKS };
}

function seedOf(key: string): number {
  let hash = 7;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return hash % 10000;
}

/**
 * Reserves an anchor for `walker` at its state's place, and says where it will stand. A sleeper always
 * takes the first free rest spot, wherever it comes from, so the rest areas fill in their tidy order;
 * once they are all held it packs in beside them (`restSpot`), never in front of another's badge.
 */
function reserve(crew: Crew, walker: Walker, byPreference: boolean): void {
  const place = PLACES[walker.state];
  const anchors = anchorsAt(place);
  const others = [...crew.walkers.values()].filter((other) => other !== walker && other.phase !== "leaving" && other.phase !== "sinking");
  const holders = (anchor: Anchor) => others.filter((other) => other.anchor === anchor.id).length;
  const free = anchors.filter((anchor) => holders(anchor) === 0);
  let chosen: Anchor;
  if (free.length > 0) {
    chosen =
      byPreference || place === "rest"
        ? free[0]!
        : free.reduce((best, anchor) =>
            Math.hypot(anchor.x - walker.x, anchor.y - walker.y) < Math.hypot(best.x - walker.x, best.y - walker.y) ? anchor : best,
          );
  } else {
    chosen = anchors.reduce((best, anchor) => (holders(anchor) < holders(best) ? anchor : best));
  }
  walker.anchor = chosen.id;
  walker.endFacing = chosen.facing;
  const taken = others.map((other) => other.target);
  walker.target = place === "rest" ? restSpot(chosen, taken) : sharedSpot(chosen, taken);
}

function walkTo(walker: Walker, target: Point): void {
  walker.path = findPath(walker, target);
}

/** Whether the plank is free: nobody on it or in the air off it. */
export function plankFree(crew: Crew): boolean {
  return !crew.departures.some((departure) => departure.kind === "plank" && departure.ms < IMPACT_AT);
}

const FOOT: Point = PLANK.foot;

function atFoot(point: Point): boolean {
  return Math.abs(point.x - FOOT.x) < 0.5 && Math.abs(point.y - FOOT.y) < 0.5;
}

/** Where a sailor waits for the plank: the foot for the first in line, else beside it, clear of the others waiting. */
function queueSpot(crew: Crew, walker: Walker): Point {
  if (crew.queue[0] === walker.key) return FOOT;
  const taken = [FOOT, ...crew.queue.filter((key) => key !== walker.key).map((key) => crew.walkers.get(key)?.target ?? FOOT)];
  return sharedSpot(FOOT, taken);
}

/** Takes the first in line for the plank off the crew and over the side. */
function board(crew: Crew, walker: Walker): void {
  crew.walkers.delete(walker.key);
  crew.queue.shift();
  crew.serial += 1;
  crew.departures.push({
    key: `${walker.key}~${crew.serial}`,
    kind: "plank",
    walker,
    ms: 0,
    // The sharks come from either side by turns, and the sailors land a little apart.
    side: crew.serial % 2 === 1 ? -1 : 1,
    drift: [0, -3, 3][crew.serial % 3] ?? 0,
    pose: "front-idle",
    reveal: 1,
    layer: "rail",
    flip: false,
  });
}

/** Fades a sailor out where it is shown, off the crew: a departure under reduced motion. */
function fadeOut(crew: Crew, walker: Walker, shown: { pose: SailorPose; reveal: number; layer: PlankLayer; flip: boolean }): void {
  crew.serial += 1;
  crew.departures.push({ key: `${walker.key}~${crew.serial}`, kind: "fade", walker, ms: 0, side: -1, drift: 0, ...shown });
}

/**
 * Sends `walker` off the deck for `departure`: to the plank, or back to the hatch (`exitFor`). Under
 * `snap`, it fades where it stands instead.
 */
function depart(crew: Crew, walker: Walker, departure: DeckDeparture, snap: boolean): void {
  if (snap) {
    crew.walkers.delete(walker.key);
    crew.queue = crew.queue.filter((key) => key !== walker.key);
    const settled = walker.phase === "settled";
    const pose = settled ? STATE_POSES[walker.state] : "front-idle";
    const flip = settled && (pose === "hauling" ? walker.facing === "left" : pose === "side-idle" && looksFore(walker.seed));
    const onLadder = walker.phase === "arriving" || walker.phase === "sinking";
    if (!onLadder) fadeOut(crew, walker, { pose, reveal: 1, layer: "deck", flip });
    return;
  }
  if (walker.phase === "leaving" || walker.phase === "sinking") return;
  walker.anchor = null;
  walker.endFacing = "front";
  if (walker.phase === "arriving") {
    // Not yet out of the hatch: straight back down.
    walker.exit = "hatch";
    walker.target = HATCH;
    walker.phase = "sinking";
    walker.phaseMs = HATCH_MS - walker.phaseMs;
    walker.path = [];
    return;
  }
  walker.phase = "leaving";
  walker.exit = exitFor(departure);
  if (walker.exit === "plank") {
    crew.queue.push(walker.key);
    walker.target = queueSpot(crew, walker);
  } else {
    walker.target = HATCH;
  }
  walkTo(walker, walker.target);
}

function place(walker: Walker): void {
  walker.x = walker.target.x;
  walker.y = walker.target.y;
  walker.path = [];
  walker.facing = walker.endFacing;
  walker.phase = "settled";
}

/**
 * Brings the crew up to date with a scene's sailors. `snap` places everyone at once — reduced motion,
 * and the deck's first scene, whose crew is already aboard.
 */
export function applyCrew(
  crew: Crew,
  sailors: readonly DeckSailor[],
  options: { snap: boolean; departures?: Readonly<Record<string, DeckDeparture>> },
): void {
  const snap = options.snap || !crew.started;
  const seen = new Set<string>();
  const ordered = [...sailors].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const sailor of ordered) {
    seen.add(sailor.key);
    const existing = crew.walkers.get(sailor.key);
    if (existing === undefined) {
      const walker: Walker = {
        key: sailor.key,
        label: sailor.label,
        state: sailor.state,
        look: lookFor(sailor.identity, crew.looks),
        stale: sailor.stale,
        asks: sailor.asks === true,
        x: HATCH.x,
        y: HATCH.y,
        anchor: null,
        target: HATCH,
        path: [],
        facing: "front",
        endFacing: "front",
        phase: "arriving",
        exit: "hatch",
        phaseMs: 0,
        walkedMs: 0,
        seed: seedOf(sailor.key),
      };
      crew.walkers.set(sailor.key, walker);
      reserve(crew, walker, snap);
      if (snap) place(walker);
      else walkTo(walker, walker.target);
      continue;
    }
    existing.label = sailor.label;
    // A relaunched crewmate keeps its card but is a new agent, and dresses as one.
    existing.look = lookFor(sailor.identity, crew.looks);
    existing.stale = sailor.stale;
    existing.asks = sailor.asks === true;
    const returning = existing.phase === "leaving" || existing.phase === "sinking";
    if (existing.state === sailor.state && !returning) {
      if (snap && existing.phase !== "settled") place(existing);
      continue;
    }
    // The state shows now; the walk catches up. One that was waiting for the plank steps out of line.
    existing.state = sailor.state;
    crew.queue = crew.queue.filter((key) => key !== existing.key);
    if (existing.phase === "sinking") {
      existing.phase = "arriving";
      existing.phaseMs = HATCH_MS - existing.phaseMs;
    } else if (existing.phase !== "arriving") {
      existing.phase = "walking";
    }
    reserve(crew, existing, false);
    if (snap) place(existing);
    else walkTo(existing, existing.target);
  }
  for (const walker of [...crew.walkers.values()]) {
    if (seen.has(walker.key)) continue;
    depart(crew, walker, options.departures?.[walker.key] ?? "removed", snap);
  }
  // Reduced motion turned on with sailors already over the side: whoever is still in sight fades where it is.
  if (snap) {
    crew.departures = crew.departures.flatMap((departure): Departure[] => {
      if (departure.kind !== "plank") return [departure];
      const shown = plankExit(departure.ms, plankOptions(crew, departure)).sailor;
      if (shown === null || shown.reveal <= 0) return [];
      const walker = { ...departure.walker, x: shown.x, y: shown.y };
      return [{ ...departure, kind: "fade", walker, ms: 0, pose: shown.pose, reveal: shown.reveal, layer: shown.layer, flip: false }];
    });
  }
  crew.started = true;
}

function facingFor(dx: number, dy: number, current: Facing): Facing {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return current;
  if (Math.abs(dx) >= Math.abs(dy) * 0.5) return dx > 0 ? "right" : "left";
  return "front";
}

function plankOptions(crew: Crew, departure: Departure) {
  return { side: departure.side, drift: departure.drift, sailorHeight: FRONT_ROWS, mouth: crew.mouth };
}

/** Moves the departures on by `dtMs`, and lets go of those that have finished. */
export function stepDepartures(crew: Crew, dtMs: number): void {
  if (crew.departures.length === 0) return;
  for (const departure of crew.departures) departure.ms += dtMs;
  crew.departures = crew.departures.filter((departure) => departure.ms < (departure.kind === "plank" ? PLANK_EXIT_MS : FADE_MS));
}

/** Whether anyone is fading out: a still deck draws again until they have gone. */
export function fading(crew: Crew): boolean {
  return crew.departures.some((departure) => departure.kind === "fade");
}

/** Moves the crew on by `dtMs`: climbs, walks, arrivals at anchors, and departures by the plank and the hatch. */
export function stepCrew(crew: Crew, dtMs: number): void {
  stepDepartures(crew, dtMs);
  // Nobody holds up the line who is no longer waiting in it.
  while (crew.queue.length > 0 && crew.walkers.get(crew.queue[0]!)?.phase !== "leaving") crew.queue.shift();
  for (const walker of [...crew.walkers.values()]) {
    if (walker.phase === "arriving") {
      walker.phaseMs += dtMs;
      if (walker.phaseMs < HATCH_MS) continue;
      walker.phase = "walking";
      walker.phaseMs = 0;
    }
    if (walker.phase === "sinking") {
      walker.phaseMs += dtMs;
      if (walker.phaseMs >= HATCH_MS) crew.walkers.delete(walker.key);
      continue;
    }
    if (walker.phase === "settled") continue;
    // The first in line for the plank makes for its foot once the one before is in the water.
    if (walker.phase === "leaving" && walker.exit === "plank" && crew.queue[0] === walker.key && plankFree(crew) && !atFoot(walker.target)) {
      walker.target = FOOT;
      walkTo(walker, FOOT);
    }
    let budget = (WALK_SPEED * dtMs) / 1000;
    if (walker.path.length > 0) walker.walkedMs += dtMs;
    while (budget > 0 && walker.path.length > 0) {
      const next = walker.path[0]!;
      const dx = next.x - walker.x;
      const dy = next.y - walker.y;
      const distance = Math.hypot(dx, dy);
      walker.facing = facingFor(dx, dy, walker.facing);
      if (distance <= budget) {
        walker.x = next.x;
        walker.y = next.y;
        walker.path.shift();
        budget -= distance;
      } else {
        walker.x += (dx / distance) * budget;
        walker.y += (dy / distance) * budget;
        budget = 0;
      }
    }
    if (walker.path.length > 0) continue;
    if (walker.phase === "leaving") {
      if (walker.exit === "hatch") {
        walker.phase = "sinking";
        walker.phaseMs = 0;
      } else if (crew.queue[0] === walker.key && plankFree(crew) && atFoot(walker)) {
        board(crew, walker);
      }
      // Otherwise it waits its turn for the plank where it stands.
    } else {
      walker.phase = "settled";
      walker.facing = walker.endFacing;
      walker.walkedMs = 0;
    }
  }
}

/** A sailor as the renderer draws it this frame. */
export interface Figure {
  key: string;
  label: string;
  state: DeckState;
  stale: boolean;
  /** Replies wait for the captain over it: it wears the reply marker (`client/deck-badges.ts`). Absent is none. */
  asks?: boolean;
  /** What it wears (`client/deck-extras.ts`). */
  look: string;
  /** Whose frames it is drawn, hit-tested and badged with: the look's lane of the atlas (`lookLane`). */
  outfit: SailorOutfit;
  /** Feet, in whole deck pixels, idle motion and the walk's rise included. */
  x: number;
  y: number;
  /** The row the feet stand on, without that motion: the sailor's depth. */
  row: number;
  pose: SailorPose;
  /** Mirrored: the side poses are drawn facing right. */
  flip: boolean;
  /** How much of the sailor is out of the hatch, 0 to 1. */
  reveal: number;
  moving: boolean;
  /** Its idle motion's offset, so the crew does not breathe in step. */
  seed: number;
  /** How far its head and shoulders (the top `BREATH_ROWS` rows) have settled: 1 on an at-ease sailor's out-breath, else 0. */
  sink: number;
  /** Its card gone, on its way off the deck: no mark, no badge, never under the pointer. */
  departing: boolean;
  /** Where it is drawn: among the deck's pieces by its row, on the plank over the near rail, or in the sea. */
  layer: PlankLayer;
  /** 1, or less while it fades out under reduced motion. */
  alpha: number;
}

/** A departure's shark and splash this frame, each at its water anchor. */
export interface PlankEffect {
  key: string;
  shark: { frame: SharkFrame; x: number; y: number; flip: boolean } | null;
  splash: { frame: SplashFrame; x: number; y: number } | null;
}

const WALK_SIDE: readonly SailorPose[] = ["side-walk-a", "side-idle", "side-walk-b", "side-idle"];
const WALK_FRONT: readonly SailorPose[] = ["front-walk-a", "front-idle", "front-walk-b", "front-idle"];

/**
 * Each state's pose once its sailor has arrived. Idle is the side view standing at rest — not `leaning`,
 * whose arm reaching forward read as someone about to do something.
 */
export const STATE_POSES: Record<DeckState, SailorPose> = {
  working: "hauling",
  waiting: "waiting",
  blocked: "front-idle",
  idle: "side-idle",
};

/** The rows from the top of a sailor that settle on an at-ease out-breath: its head and shoulders. */
export const BREATH_ROWS = 12;
/** One breath at ease: in for 2.2 s, out — settled a pixel — for 2 s. */
export const BREATH_MS = 4200;
const BREATH_IN_MS = 2200;

/** Whether an at-ease sailor is on its out-breath, its head and shoulders a pixel lower: 1 or 0. */
export function breathSink(seed: number, nowMs: number): number {
  const t = (((nowMs + seed * 53) % BREATH_MS) + BREATH_MS) % BREATH_MS;
  return t >= BREATH_IN_MS ? 1 : 0;
}

/** Which way an at-ease sailor looks: half the crew fore (left), half aft, by its seed. */
export function looksFore(seed: number): boolean {
  return seed % 2 === 1;
}

/**
 * Idle motion at an anchor, in whole pixels: hauling leans into the line and back, the waiting
 * breathe, the blocked fret from foot to foot now and then. A sailor at ease does not move its feet at
 * all; it breathes in place (`breathSink`). A pure function of the clock.
 */
export function idleMotion(state: DeckState, facing: Facing, seed: number, nowMs: number): { dx: number; dy: number } {
  const t = nowMs + seed * 37;
  switch (state) {
    case "working": {
      // Hand over hand: a pull every 0.9 s, a beat leaning in.
      const pull = Math.floor(t / 450) % 2 === 0;
      return { dx: pull ? (facing === "left" ? -1 : 1) : 0, dy: pull ? 0 : -1 };
    }
    case "waiting":
      return { dx: 0, dy: t % 2600 < 900 ? -1 : 0 };
    case "idle":
      return { dx: 0, dy: 0 };
    case "blocked": {
      // A 1.2 s fret every 4 s: left, centre, right, centre.
      const at = t % 4000;
      if (at >= 1200) return { dx: 0, dy: 0 };
      return { dx: [-1, 0, 1, 0][Math.floor(at / 300)] ?? 0, dy: 0 };
    }
  }
}

/** The crew as the renderer draws it now. `still` drops the idle motion (reduced motion). */
export function crewFigures(crew: Crew, nowMs: number, options: { still: boolean }): Figure[] {
  const figures: Figure[] = [];
  for (const walker of crew.walkers.values()) {
    const moving = (walker.phase === "walking" || walker.phase === "leaving") && walker.path.length > 0;
    let pose: SailorPose;
    let flip = false;
    let dx = 0;
    let dy = 0;
    let reveal = 1;
    let sink = 0;
    if (walker.phase === "arriving") {
      pose = "front-idle";
      reveal = Math.min(1, walker.phaseMs / HATCH_MS);
    } else if (walker.phase === "sinking") {
      pose = "front-idle";
      reveal = Math.max(0, 1 - walker.phaseMs / HATCH_MS);
    } else if (walker.phase === "leaving" && !moving) {
      // Waiting its turn for the plank, facing out.
      pose = "front-idle";
    } else if (moving) {
      const step = Math.floor(walker.walkedMs / STEP_MS) % 4;
      const side = walker.facing !== "front";
      pose = (side ? WALK_SIDE : WALK_FRONT)[step]!;
      flip = walker.facing === "left";
      // The body rises a pixel as one leg passes the other.
      dy = step % 2 === 1 ? -1 : 0;
    } else {
      pose = STATE_POSES[walker.state];
      flip = pose === "hauling" ? walker.facing === "left" : pose === "side-idle" && looksFore(walker.seed);
      if (!options.still && !walker.stale) {
        const motion = idleMotion(walker.state, walker.facing, walker.seed, nowMs);
        dx = motion.dx;
        dy = motion.dy;
        if (walker.state === "idle") sink = breathSink(walker.seed, nowMs);
      }
    }
    figures.push({
      key: walker.key,
      label: walker.label,
      state: walker.state,
      stale: walker.stale,
      asks: walker.asks,
      look: walker.look,
      outfit: lookLane(walker.look),
      x: Math.round(walker.x) + dx,
      y: Math.round(walker.y) + dy,
      row: Math.round(walker.y),
      pose,
      flip,
      reveal,
      moving,
      seed: walker.seed,
      sink,
      // Its card has gone: on its way to the plank or the hatch, it is no longer one of the crew.
      departing: walker.phase === "leaving" || walker.phase === "sinking",
      layer: "deck",
      alpha: 1,
    });
  }
  for (const departure of crew.departures) {
    const { walker } = departure;
    const shown =
      departure.kind === "plank"
        ? plankExit(departure.ms, plankOptions(crew, departure)).sailor
        : { x: walker.x, y: walker.y, pose: departure.pose, reveal: departure.reveal, layer: departure.layer, moving: false };
    if (shown === null || shown.reveal <= 0) continue;
    figures.push({
      key: departure.key,
      label: walker.label,
      state: walker.state,
      stale: walker.stale,
      look: walker.look,
      outfit: lookLane(walker.look),
      x: Math.round(shown.x),
      y: Math.round(shown.y),
      row: Math.round(shown.y),
      pose: shown.pose,
      flip: departure.kind === "fade" && departure.flip,
      reveal: shown.reveal,
      moving: shown.moving,
      seed: walker.seed,
      sink: 0,
      departing: true,
      layer: shown.layer,
      alpha: departure.kind === "fade" ? Math.max(0, 1 - departure.ms / FADE_MS) : 1,
    });
  }
  return figures;
}

/** The sharks and splashes of the departures by the plank, as they show now. */
export function plankEffects(crew: Crew): PlankEffect[] {
  const effects: PlankEffect[] = [];
  for (const departure of crew.departures) {
    if (departure.kind !== "plank") continue;
    const { shark, splash } = plankExit(departure.ms, plankOptions(crew, departure));
    if (shark !== null || splash !== null) effects.push({ key: departure.key, shark, splash });
  }
  return effects;
}

