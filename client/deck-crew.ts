/** Crew movement on a pack-defined floor: reservations, arrival/sink portals, queued choreographies, and calm fades. */
import { breathSink, fidgetAt, laneOf, lookFor, settledPose, standing, walkPose, type DeckCast } from "./deck-cast";
import { findPath, restSpot, sharedSpot, type Anchor, type Facing, type Point } from "./deck-geometry";
import { choreographyAt, type ActorLayer, type Choreography, type DeckDeparture } from "./deck-choreography";
import type { DeckStage, ZoneAppearance } from "./deck-stage";
import type { DeckSailor, DeckState } from "./deck-scene";
import { postTransitAt, type PostTransit } from "./deck-post-transit";

type Phase = "arriving" | "walking" | "settled" | "leaving" | "sinking";

export interface Walker {
  key: string;
  /** Agent identity, independent of its card key, for stable post assignment. */
  identity: string;
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
  /** How it leaves once its card is gone: the pack's chosen portal, or null while reversing an arrival. */
  exit: string | null;
  /** Duration of the current entry/sink, retained when it reverses mid-way. */
  phaseDuration: number;
  /** Time spent in `arriving` or `sinking`. */
  phaseMs: number;
  /** Time spent walking, for the walk cycle. */
  walkedMs: number;
  /** Floor coordinates stay at the route's base until the worker has descended again. */
  transit: { route: PostTransit; ms: number } | null;
  /** A per-sailor offset for its idle motion, so the crew does not sway in step. */
  seed: number;
}

/**
 * A sailor gone from the crew and on its way out on its own clock: running its choreography, or fading
 * where it stood (reduced motion). Keyed apart from the crew, so its card can come back meanwhile.
 */
export interface Departure {
  key: string;
  kind: "choreography" | "fade";
  choreography: Choreography | null;
  walker: Walker;
  /** Time since it started. */
  ms: number;
  /** The pack's alternation: side of approach and horizontal drift. */
  side: -1 | 1;
  drift: number;
  /** A fade: what shows of the sailor as it goes. */
  pose: string;
  reveal: number;
  layer: ActorLayer;
  flip: boolean;
  appearance?: ZoneAppearance;
}

export interface Crew {
  /** Where it all happens: the setting's floor, zones and portals. */
  stage: DeckStage;
  /** Who it is: the setting's poses, looks, fidgets and breath. */
  cast: DeckCast;
  walkers: Map<string, Walker>;
  /** Sailors gone from the crew, still on their way out. */
  departures: Departure[];
  /** Who is waiting for an exit, in the order they left. */
  queue: string[];
  /** How many departures there have been, for each one's key and the effect's side. */
  serial: number;
  /** Whether a scene has been applied: the first one places the crew already aboard. */
  started: boolean;
  /** The looks there are to hand out (`availableLooks`): those that must draw, and each other one that loaded. */
  looks: readonly string[];
}

export function createCrew(stage: DeckStage, cast: DeckCast, looks?: readonly string[]): Crew {
  const mustDraw = cast.looks.filter((look) => !look.optional).map((look) => look.id);
  return {
    stage,
    cast,
    walkers: new Map(),
    departures: [],
    queue: [],
    serial: 0,
    started: false,
    looks: looks !== undefined && looks.length > 0 ? looks : mustDraw.length > 0 ? mustDraw : [cast.looks[0]!.id],
  };
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
  const zone = crew.stage.zoneOf(walker.state);
  const anchors = zone.posts;
  const others = [...crew.walkers.values()].filter((other) => other !== walker && other.phase !== "leaving" && other.phase !== "sinking");
  const holders = (anchor: Anchor) => others.filter((other) => other.anchor === anchor.id).length;
  const free = anchors.filter((anchor) => holders(anchor) === 0);
  let chosen: Anchor;
  if (free.length > 0) {
    // Stable collisions are measured from the identity's preferred post, never its current position.
    // Equal distances retain manifest order; existing holders keep their posts until their next reservation.
    const preferred = zone.assign === "stable" ? anchors[seedOf(walker.identity) % anchors.length]! : null;
    if (preferred !== null) {
      chosen = free.reduce((best, anchor) => Math.hypot(anchor.x - preferred.x, anchor.y - preferred.y) < Math.hypot(best.x - preferred.x, best.y - preferred.y) ? anchor : best);
    } else {
      chosen = byPreference || zone.assign === "ordered"
        ? free[0]!
        : free.reduce((best, anchor) =>
            Math.hypot(anchor.x - walker.x, anchor.y - walker.y) < Math.hypot(best.x - walker.x, best.y - walker.y) ? anchor : best,
          );
    }
  } else {
    chosen = anchors.reduce((best, anchor) => (holders(anchor) < holders(best) ? anchor : best));
  }
  walker.anchor = chosen.id;
  walker.endFacing = chosen.facing;
  const taken = others.map((other) => other.target);
  walker.target =
    zone.overflow.kind === "pack" ? restSpot(crew.stage.floor, zone.overflow, chosen, taken, zone.appearance !== null) : sharedSpot(crew.stage.floor, chosen, taken, zone.overflow.spacing);
}

function walkTo(crew: Crew, walker: Walker, target: Point): void {
  // The authored corridor may start off-floor; only its endpoint belongs in floor navigation.
  walker.path = findPath(crew.stage.floor, walkingEntry(crew, walker) ? crew.stage.entry : walker, target);
}

function transitFor(crew: Crew, walker: Walker): PostTransit | null {
  if (walker.anchor === null || walker.phase === "leaving" || walker.phase === "sinking") return null;
  const route = crew.stage.transits.get(walker.anchor);
  // Overflow beside a held post stays on the floor; it never shares an off-floor station.
  return route !== undefined && atPoint(walker.target, route.points[0]!) ? route : null;
}

/** A sink exit remains a sink even in a pack with walking arrivals. Null exit means reversing the entry. */
function walkingEntry(crew: Crew, walker: Walker): boolean {
  return crew.stage.walkIn !== null && walker.exit === null && (walker.phase === "arriving" || walker.phase === "sinking");
}

const entryTime = (walker: Walker) => walker.phase === "sinking" ? walker.phaseDuration - walker.phaseMs : walker.phaseMs;

function entryPosition(crew: Crew, walker: Walker): void {
  const entry = crew.stage.walkIn!;
  const u = Math.min(1, Math.max(0, entryTime(walker) / entry.walkMs));
  const dx = crew.stage.entry.x - entry.from.x;
  const dy = crew.stage.entry.y - entry.from.y;
  walker.x = entry.from.x + dx * u;
  walker.y = entry.from.y + dy * u;
  const direction = walker.phase === "sinking" ? -1 : 1;
  walker.facing = facingFor(direction * dx, direction * dy, walker.facing);
}

/** Each exit owns its queue and release event; independent exits never block one another. */
export function exitFree(crew: Crew, id: string): boolean {
  return !crew.departures.some((departure) => departure.kind === "choreography" && departure.walker.exit === id
    && departure.ms < departure.choreography!.timelines.get(departure.drift)!.releaseMs);
}

const atPoint = (point: Point, target: Point) => Math.abs(point.x - target.x) < 0.5 && Math.abs(point.y - target.y) < 0.5;
const queueOf = (crew: Crew, walker: Walker) => crew.queue.filter((key) => crew.walkers.get(key)?.exit === walker.exit);

function queueSpot(crew: Crew, walker: Walker, exit: Choreography): Point {
  const { at, spacing } = exit.queue;
  const queue = queueOf(crew, walker);
  if (queue[0] === walker.key) return at;
  const taken = [at, ...queue.filter((key) => key !== walker.key).map((key) => crew.walkers.get(key)?.target ?? at)];
  return sharedSpot(crew.stage.floor, at, taken, spacing);
}

function board(crew: Crew, walker: Walker, exit: Choreography): void {
  crew.walkers.delete(walker.key);
  crew.queue = crew.queue.filter((key) => key !== walker.key);
  crew.serial += 1;
  crew.departures.push({
    key: `${walker.key}~${crew.serial}`, kind: "choreography", choreography: exit, walker, ms: 0,
    side: exit.alternate.side[crew.serial % exit.alternate.side.length]!,
    drift: exit.alternate.drift[crew.serial % exit.alternate.drift.length]!,
    pose: crew.cast.stand, reveal: 1, layer: "floor", flip: false,
  });
}

/** Fades a sailor out where it is shown, off the crew: a departure under reduced motion. */
function fadeOut(crew: Crew, walker: Walker, shown: { pose: string; reveal: number; layer: ActorLayer; flip: boolean; appearance?: ZoneAppearance }): void {
  crew.serial += 1;
  crew.departures.push({ key: `${walker.key}~${crew.serial}`, kind: "fade", choreography: null, walker, ms: 0, side: -1, drift: 0, ...shown });
}

/**
 * Sends `walker` off the deck for `departure`: to the choreography, or back to the portal (the pack's routing). Under
 * `snap`, it fades where it stands instead.
 */
function depart(crew: Crew, walker: Walker, departure: DeckDeparture, snap: boolean): void {
  if (snap) {
    const transit = walker.transit;
    const shown = transit === null ? null : postTransitAt(transit.route, transit.ms,
      transit.ms === transit.route.durationMs && transitFor(crew, walker) === transit.route && walker.path.length === 0);
    crew.walkers.delete(walker.key);
    crew.queue = crew.queue.filter((key) => key !== walker.key);
    const settled = walker.phase === "settled" ? settledPose(crew.cast, walker.state, walker.facing, walker.seed) : null;
    const pose = settled?.pose ?? crew.cast.stand;
    const flip = settled?.flip ?? false;
    const onLadder = !walkingEntry(crew, walker) && (walker.phase === "arriving" || walker.phase === "sinking");
    const appearance = walker.phase === "settled" ? crew.stage.zoneOf(walker.state).appearance : null;
    if (!onLadder) fadeOut(crew, shown === null ? walker : { ...walker, x: shown.x, y: shown.y }, {
      pose: shown?.pose ?? pose, reveal: 1,
      layer: transit !== null ? { front: transit.route.front } : appearance === null ? "floor" : { front: appearance.front },
      flip: shown === null && appearance === null ? flip : false, ...(appearance === null ? {} : { appearance }),
    });
    return;
  }
  if (walker.phase === "leaving" || walker.phase === "sinking") return;
  walker.anchor = null;
  walker.endFacing = "front";
  if (walker.phase === "arriving") {
    // Not yet out of the entry: reverse its progress without a position/crop jump.
    // Retain a sink's id if this is already the reversal of that exit; it is still a crop, not a walk-in.
    walker.target = crew.stage.entry;
    walker.phase = "sinking";
    walker.phaseMs = walker.phaseDuration - walker.phaseMs;
    walker.path = [];
    if (walkingEntry(crew, walker)) entryPosition(crew, walker);
    return;
  }
  walker.phase = "leaving";
  walker.exit = crew.stage.byDeparture[departure];
  const exit = crew.stage.exits.get(walker.exit)!;
  if (exit.kind === "choreography") {
    crew.queue.push(walker.key);
    walker.target = queueSpot(crew, walker, exit);
  } else {
    walker.target = exit.at;
  }
  walkTo(crew, walker, walker.target);
}

function place(crew: Crew, walker: Walker): void {
  walker.x = walker.target.x;
  walker.y = walker.target.y;
  walker.path = [];
  walker.facing = walker.endFacing;
  walker.phase = "settled";
  const route = transitFor(crew, walker);
  walker.transit = route === null ? null : { route, ms: route.durationMs };
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
  const seen = new Set(sailors.map((sailor) => sailor.key));
  // Release absent workers' reservations before newcomers choose posts in this same poll.
  for (const walker of [...crew.walkers.values()]) {
    if (!seen.has(walker.key)) depart(crew, walker, options.departures?.[walker.key] ?? "removed", snap);
  }
  const ordered = [...sailors].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const sailor of ordered) {
    const existing = crew.walkers.get(sailor.key);
    if (existing === undefined) {
      const walker: Walker = {
        key: sailor.key,
        identity: sailor.identity,
        label: sailor.label,
        state: sailor.state,
        look: lookFor(sailor.identity, crew.looks),
        stale: sailor.stale,
        asks: sailor.asks === true,
        x: crew.stage.entry.x,
        y: crew.stage.entry.y,
        anchor: null,
        target: crew.stage.entry,
        path: [],
        facing: "front",
        endFacing: "front",
        phase: "arriving",
        exit: null,
        phaseDuration: crew.stage.entryMs,
        phaseMs: 0,
        walkedMs: 0,
        transit: null,
        seed: seedOf(sailor.key),
      };
      crew.walkers.set(sailor.key, walker);
      if (walkingEntry(crew, walker)) entryPosition(crew, walker);
      reserve(crew, walker, snap);
      if (snap) place(crew, walker);
      else walkTo(crew, walker, walker.target);
      continue;
    }
    existing.label = sailor.label;
    const reassigned = existing.identity !== sailor.identity && crew.stage.zoneOf(sailor.state).assign === "stable";
    existing.identity = sailor.identity;
    // A relaunched crewmate keeps its card but is a new agent, and dresses as one.
    existing.look = lookFor(sailor.identity, crew.looks);
    existing.stale = sailor.stale;
    existing.asks = sailor.asks === true;
    const returning = existing.phase === "leaving" || existing.phase === "sinking";
    if (existing.state === sailor.state && !returning && !reassigned) {
      if (snap) place(crew, existing);
      continue;
    }
    // The state shows now; the walk catches up. One that was waiting for an exit steps out of line.
    existing.state = sailor.state;
    crew.queue = crew.queue.filter((key) => key !== existing.key);
    if (existing.phase === "sinking") {
      existing.phase = "arriving";
      existing.phaseMs = existing.phaseDuration - existing.phaseMs;
    } else if (existing.phase !== "arriving") {
      existing.phase = "walking";
    }
    reserve(crew, existing, false);
    if (walkingEntry(crew, existing)) entryPosition(crew, existing);
    if (snap) place(crew, existing);
    else walkTo(crew, existing, existing.target);
  }
  // Reduced motion turned on with sailors already over the side: whoever is still in sight fades where it is.
  if (snap) {
    crew.departures = crew.departures.flatMap((departure): Departure[] => {
      if (departure.kind !== "choreography") return [departure];
      const shown = departureMoment(crew, departure).actor;
      if (shown === null || shown.reveal <= 0) return [];
      const walker = { ...departure.walker, x: shown.x, y: shown.y };
      return [{ ...departure, kind: "fade", walker, ms: 0, pose: shown.pose, reveal: shown.reveal, layer: shown.layer, flip: shown.flip }];
    });
  }
  crew.started = true;
}

function facingFor(dx: number, dy: number, current: Facing): Facing {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return current;
  if (Math.abs(dx) >= Math.abs(dy) * 0.5) return dx > 0 ? "right" : "left";
  return "front";
}

function departureMoment(crew: Crew, departure: Departure) {
  return choreographyAt(departure.choreography!, departure.ms, { side: departure.side, drift: departure.drift,
    cast: crew.cast, lane: laneOf(crew.cast, departure.walker.look) });
}

/** Moves the departures on by `dtMs`, and lets go of those that have finished. */
export function stepDepartures(crew: Crew, dtMs: number): void {
  if (crew.departures.length === 0) return;
  for (const departure of crew.departures) departure.ms += dtMs;
  crew.departures = crew.departures.filter((departure) => departure.ms < (departure.kind === "choreography" ? departure.choreography!.timelines.get(departure.drift)!.durationMs : crew.stage.fadeMs));
}

/** Whether anyone is fading out: a still deck draws again until they have gone. */
export function fading(crew: Crew): boolean {
  return crew.departures.some((departure) => departure.kind === "fade");
}

/** Moves the crew on by `dtMs`: climbs, walks, arrivals at anchors, and departures by the choreography and the portal. */
export function stepCrew(crew: Crew, dtMs: number): void {
  stepDepartures(crew, dtMs);
  // Nobody holds up the line who is no longer waiting in it.
  crew.queue = crew.queue.filter((key) => crew.walkers.get(key)?.phase === "leaving");
  for (const walker of [...crew.walkers.values()]) {
    let walkDt = dtMs;
    if (walkingEntry(crew, walker)) {
      const before = Math.min(crew.stage.walkIn!.walkMs, entryTime(walker));
      const remaining = walker.phaseDuration - walker.phaseMs;
      walker.phaseMs = Math.min(walker.phaseDuration, walker.phaseMs + dtMs);
      walker.walkedMs += Math.abs(Math.min(crew.stage.walkIn!.walkMs, entryTime(walker)) - before);
      entryPosition(crew, walker);
      if (walker.phaseMs < walker.phaseDuration) continue;
      if (walker.phase === "sinking") {
        crew.walkers.delete(walker.key);
        continue;
      }
      walkDt = Math.max(0, dtMs - remaining);
      walker.phase = "walking";
      walker.phaseMs = 0;
    } else if (walker.phase === "arriving") {
      walker.phaseMs += dtMs;
      if (walker.phaseMs < walker.phaseDuration) continue;
      walker.phase = "walking";
      walker.phaseMs = 0;
    }
    if (walker.phase === "sinking") {
      walker.phaseMs += dtMs;
      if (walker.phaseMs >= walker.phaseDuration) crew.walkers.delete(walker.key);
      continue;
    }
    const route = transitFor(crew, walker);
    // Finish (or reverse) access before touching the floor path. State and destination may change on any poll.
    if (walker.transit !== null && (route !== walker.transit.route || walker.path.length > 0)) {
      const remaining = walker.transit.ms;
      walker.transit.ms = Math.max(0, remaining - walkDt);
      if (walker.transit.ms > 0) continue;
      walker.transit = null;
      walkDt = Math.max(0, walkDt - remaining);
    }
    if (walker.phase === "settled") {
      if (route !== null) {
        walker.transit ??= { route, ms: 0 };
        walker.transit.ms = Math.min(route.durationMs, walker.transit.ms + walkDt);
      }
      continue;
    }
    const exit = walker.exit === null ? null : crew.stage.exits.get(walker.exit)!;
    const first = queueOf(crew, walker)[0] === walker.key;
    if (walker.phase === "leaving" && exit?.kind === "choreography" && first && exitFree(crew, walker.exit!) && !atPoint(walker.target, exit.queue.at)) {
      walker.target = exit.queue.at;
      walkTo(crew, walker, walker.target);
    }
    let budget = (crew.stage.floor.walkSpeed * walkDt) / 1000;
    if (walker.path.length > 0) walker.walkedMs += walkDt;
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
      if (exit?.kind === "sink") {
        walker.phase = "sinking";
        walker.phaseMs = 0;
        walker.phaseDuration = exit.ms;
      } else if (exit?.kind === "choreography" && first && exitFree(crew, walker.exit!) && atPoint(walker, exit.queue.at)) {
        board(crew, walker, exit);
      }
      // Otherwise it waits its turn for the exit where it stands.
    } else {
      walker.phase = "settled";
      walker.facing = walker.endFacing;
      walker.walkedMs = 0;
      if (route !== null) {
        walker.transit ??= { route, ms: 0 };
        walker.transit.ms = Math.min(route.durationMs, walker.transit.ms + budget / crew.stage.floor.walkSpeed * 1000);
      }
    }
  }
}

/** A sailor as the renderer draws it this frame. */
export interface Figure {
  /** An authored access route's draw order, shared by pointer hit testing. */
  depth?: number;
  /** An access route has no floor under its feet; retain the badge without a floating ground mark. */
  offFloor?: boolean;
  /** A zone's stationary handle, once settled; omitted while walking or using a portal. */
  appearance?: ZoneAppearance;
  key: string;
  label: string;
  state: DeckState;
  stale: boolean;
  /** Replies wait for the captain over it: it wears the reply marker (`client/deck-badges.ts`). Absent is none. */
  asks?: boolean;
  /** What it wears: a look of the cast's (`lookFor` in `client/deck-cast.ts`). */
  look: string;
  /** Whose frames it is drawn, hit-tested and badged with: the look's lane (`laneOf`). */
  lane: string;
  /** Feet, in whole deck pixels, idle motion and the walk's rise included. */
  x: number;
  y: number;
  /** The row the feet stand on, without that motion: the sailor's depth. */
  row: number;
  pose: string;
  /** Mirrored: the side poses are drawn facing right. */
  flip: boolean;
  /** How much of the sailor is out of the portal, 0 to 1. */
  reveal: number;
  moving: boolean;
  /** Its idle motion's offset, so the crew does not breathe in step. */
  seed: number;
  /** How far its top rows (the cast's breath rows) have settled: 1 on an at-ease sailor's out-breath, else 0. */
  sink: number;
  /** Its card gone, on its way off the deck: no mark, no badge, never under the pointer. */
  departing: boolean;
  /** Where it is drawn: by its floor row, in front of a named piece, or in the effects slot. */
  layer: ActorLayer;
  /** 1, or less while it fades out under reduced motion. */
  alpha: number;
}

/** Geometry follows the sprite actually drawn, so labels, hit targets and the focus camera agree. */
export function figureStanding(cast: DeckCast, figure: Figure) {
  return figure.appearance ?? standing(cast, figure.lane, figure.pose);
}

/** The crew as the renderer draws it now. `still` drops the idle motion (reduced motion). */
export function crewFigures(crew: Crew, nowMs: number, options: { still: boolean }): Figure[] {
  const figures: Figure[] = [];
  for (const walker of crew.walkers.values()) {
    const appearance = walker.phase === "settled" ? crew.stage.zoneOf(walker.state).appearance : null;
    const transit = walker.transit;
    const atStation = transit !== null && transit.ms === transit.route.durationMs && transitFor(crew, walker) === transit.route && walker.path.length === 0;
    const accessed = transit === null ? null : postTransitAt(transit.route, transit.ms, atStation);
    const entering = walkingEntry(crew, walker);
    const moving = accessed !== null ? !atStation : entering ? entryTime(walker) < crew.stage.walkIn!.walkMs
      : (walker.phase === "walking" || walker.phase === "leaving") && walker.path.length > 0;
    const { cast } = crew;
    let pose: string;
    let flip = false;
    let dx = 0;
    let dy = 0;
    let reveal = 1;
    let sink = 0;
    if (accessed !== null) {
      pose = accessed.pose;
    } else if (entering) {
      const step = moving ? walkPose(cast, walker.facing, walker.walkedMs) : null;
      pose = step?.pose ?? cast.stand;
      flip = step?.flip ?? false;
      dy = -(step?.rise ?? 0);
    } else if (walker.phase === "arriving") {
      pose = cast.stand;
      reveal = Math.min(1, walker.phaseMs / walker.phaseDuration);
    } else if (walker.phase === "sinking") {
      pose = cast.stand;
      reveal = Math.max(0, 1 - walker.phaseMs / walker.phaseDuration);
    } else if (walker.phase === "leaving" && !moving) {
      // Waiting its turn for the exit, facing out.
      pose = cast.stand;
    } else if (moving) {
      // The body rises as one leg passes the other.
      const step = walkPose(cast, walker.facing, walker.walkedMs);
      pose = step.pose;
      flip = step.flip;
      dy = step.rise === 0 ? 0 : -step.rise;
    } else {
      ({ pose, flip } = settledPose(cast, walker.state, walker.facing, walker.seed));
      if (!options.still && !walker.stale && appearance === null) {
        const motion = fidgetAt(cast, walker.state, walker.facing, walker.seed, nowMs);
        dx = motion.dx;
        dy = motion.dy;
        pose = motion.pose ?? pose;
        if (walker.state === cast.breath?.state) sink = breathSink(cast, walker.seed, nowMs);
      }
    }
    figures.push({
      key: walker.key,
      label: walker.label,
      state: walker.state,
      stale: walker.stale,
      asks: walker.asks,
      look: walker.look,
      lane: laneOf(cast, walker.look),
      x: Math.round(accessed?.x ?? walker.x) + dx,
      y: Math.round(accessed?.y ?? walker.y) + dy,
      row: Math.round(accessed?.y ?? walker.y),
      pose,
      flip: appearance === null ? flip : false,
      reveal,
      moving,
      seed: walker.seed,
      sink,
      // Its card has gone: on its way to an exit, it is no longer one of the crew.
      departing: walker.phase === "leaving" || walker.phase === "sinking",
      layer: transit !== null ? { front: transit.route.front } : appearance === null ? "floor" : { front: appearance.front },
      ...(transit === null ? {} : { depth: transit.route.depth, offFloor: true }),
      ...(appearance === null ? {} : { appearance }),
      alpha: 1,
    });
  }
  for (const departure of crew.departures) {
    const { walker } = departure;
    const shown =
      departure.kind === "choreography"
        ? departureMoment(crew, departure).actor
        : { x: walker.x, y: walker.y, pose: departure.pose, reveal: departure.reveal, layer: departure.layer, moving: false, flip: departure.flip };
    if (shown === null || shown.reveal <= 0) continue;
    figures.push({
      key: departure.key,
      label: walker.label,
      state: walker.state,
      stale: walker.stale,
      look: walker.look,
      lane: laneOf(crew.cast, walker.look),
      x: Math.round(shown.x),
      y: Math.round(shown.y),
      row: Math.round(shown.y),
      pose: shown.pose,
      flip: shown.flip,
      reveal: shown.reveal,
      moving: shown.moving,
      seed: walker.seed,
      sink: 0,
      departing: true,
      layer: shown.layer,
      ...(departure.kind === "fade" && departure.appearance !== undefined ? { appearance: departure.appearance } : {}),
      alpha: departure.kind === "fade" ? Math.max(0, 1 - departure.ms / crew.stage.fadeMs) : 1,
    });
  }
  return figures;
}

/** Finite portal effects: independent keys for arrivals, departures and repeated tracks. */
export function portalEffects(crew: Crew) {
  const arrivals = crew.stage.walkIn === null ? [] : [...crew.walkers.values()].flatMap((walker) => !walkingEntry(crew, walker) ? []
    : choreographyAt(crew.stage.walkIn!.choreography, entryTime(walker), { side: -1, drift: 0, cast: crew.cast, lane: laneOf(crew.cast, walker.look) })
      .effects.map((effect) => ({ ...effect, key: `entry:${walker.key}:${effect.track}` })));
  return [...arrivals, ...crew.departures.flatMap((departure) => departure.kind !== "choreography" ? []
    : departureMoment(crew, departure).effects.map((effect) => ({ ...effect, key: `exit:${departure.key}:${effect.track}` })))];
}
