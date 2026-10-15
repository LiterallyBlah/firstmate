/** Crew movement on a pack-defined floor: reservations, arrival/sink portals, queued choreographies, and calm fades. */
import { breathSink, fidgetAt, laneOf, lookFor, settledPose, walkPose, type DeckCast } from "./deck-cast";
import { findPath, restSpot, sharedSpot, type Anchor, type Facing, type Point } from "./deck-geometry";
import { choreographyAt, type ActorLayer, type Choreography, type DeckDeparture } from "./deck-choreography";
import type { DeckStage } from "./deck-stage";
import type { DeckSailor, DeckState } from "./deck-scene";

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
  /** Duration of the current rise/sink, retained when it reverses mid-way. */
  phaseDuration: number;
  /** Time spent in `arriving` or `sinking`. */
  phaseMs: number;
  /** Time spent walking, for the walk cycle. */
  walkedMs: number;
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
    zone.overflow.kind === "pack" ? restSpot(crew.stage.floor, zone.overflow, chosen, taken) : sharedSpot(crew.stage.floor, chosen, taken, zone.overflow.spacing);
}

function walkTo(crew: Crew, walker: Walker, target: Point): void {
  walker.path = findPath(crew.stage.floor, walker, target);
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
function fadeOut(crew: Crew, walker: Walker, shown: { pose: string; reveal: number; layer: ActorLayer; flip: boolean }): void {
  crew.serial += 1;
  crew.departures.push({ key: `${walker.key}~${crew.serial}`, kind: "fade", choreography: null, walker, ms: 0, side: -1, drift: 0, ...shown });
}

/**
 * Sends `walker` off the deck for `departure`: to the choreography, or back to the portal (the pack's routing). Under
 * `snap`, it fades where it stands instead.
 */
function depart(crew: Crew, walker: Walker, departure: DeckDeparture, snap: boolean): void {
  if (snap) {
    crew.walkers.delete(walker.key);
    crew.queue = crew.queue.filter((key) => key !== walker.key);
    const settled = walker.phase === "settled" ? settledPose(crew.cast, walker.state, walker.facing, walker.seed) : null;
    const pose = settled?.pose ?? crew.cast.stand;
    const flip = settled?.flip ?? false;
    const onLadder = walker.phase === "arriving" || walker.phase === "sinking";
    if (!onLadder) fadeOut(crew, walker, { pose, reveal: 1, layer: "floor", flip });
    return;
  }
  if (walker.phase === "leaving" || walker.phase === "sinking") return;
  walker.anchor = null;
  walker.endFacing = "front";
  if (walker.phase === "arriving") {
    // Not yet out of the entry: straight back down.
    walker.exit = null;
    walker.target = crew.stage.entry;
    walker.phase = "sinking";
    walker.phaseMs = walker.phaseDuration - walker.phaseMs;
    walker.path = [];
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
        seed: seedOf(sailor.key),
      };
      crew.walkers.set(sailor.key, walker);
      reserve(crew, walker, snap);
      if (snap) place(walker);
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
      if (snap && existing.phase !== "settled") place(existing);
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
    if (snap) place(existing);
    else walkTo(crew, existing, existing.target);
  }
  for (const walker of [...crew.walkers.values()]) {
    if (seen.has(walker.key)) continue;
    depart(crew, walker, options.departures?.[walker.key] ?? "removed", snap);
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
    if (walker.phase === "arriving") {
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
    if (walker.phase === "settled") continue;
    const exit = walker.exit === null ? null : crew.stage.exits.get(walker.exit)!;
    const first = queueOf(crew, walker)[0] === walker.key;
    if (walker.phase === "leaving" && exit?.kind === "choreography" && first && exitFree(crew, walker.exit!) && !atPoint(walker.target, exit.queue.at)) {
      walker.target = exit.queue.at;
      walkTo(crew, walker, walker.target);
    }
    let budget = (crew.stage.floor.walkSpeed * dtMs) / 1000;
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

/** The crew as the renderer draws it now. `still` drops the idle motion (reduced motion). */
export function crewFigures(crew: Crew, nowMs: number, options: { still: boolean }): Figure[] {
  const figures: Figure[] = [];
  for (const walker of crew.walkers.values()) {
    const moving = (walker.phase === "walking" || walker.phase === "leaving") && walker.path.length > 0;
    const { cast } = crew;
    let pose: string;
    let flip = false;
    let dx = 0;
    let dy = 0;
    let reveal = 1;
    let sink = 0;
    if (walker.phase === "arriving") {
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
      if (!options.still && !walker.stale) {
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
      x: Math.round(walker.x) + dx,
      y: Math.round(walker.y) + dy,
      row: Math.round(walker.y),
      pose,
      flip,
      reveal,
      moving,
      seed: walker.seed,
      sink,
      // Its card has gone: on its way to an exit, it is no longer one of the crew.
      departing: walker.phase === "leaving" || walker.phase === "sinking",
      layer: "floor",
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
      alpha: departure.kind === "fade" ? Math.max(0, 1 - departure.ms / crew.stage.fadeMs) : 1,
    });
  }
  return figures;
}

/** Effect tracks keyed independently, so multiple departures and repeated effects cannot share sprites. */
export function departureEffects(crew: Crew) {
  return crew.departures.flatMap((departure) => departure.kind !== "choreography" ? []
    : departureMoment(crew, departure).effects.map((effect) => ({ ...effect, key: `${departure.key}:${effect.track}` })));
}
