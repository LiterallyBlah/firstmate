/**
 * The plank, and the way a crewmate leaves the deck by it: out along the plank, a jump, a splash, and a
 * shark. Pure — no Pixi, no clock of its own; `client/deck-crew.ts` runs each departure's clock and
 * `client/deck-pixi.ts` draws what `plankExit` says is showing at that moment.
 *
 * - **Which departures take the plank** is `PLANK_DEPARTURES`, and nothing else decides it: a card that
 *   leaves the deck says why (`DeckDeparture`, from `departureOf` in `client/deck-scene.ts`), and a
 *   departure not in the set goes down the hatch as before.
 * - **The plank** sticks out over the near rail amidships, between the mast and the gunwale's bollards,
 *   towards the viewer: its top face runs down the screen from the gunwale (row 121) to its tip, its end
 *   is two rows thick. It is the generated board (`art/ship-deck/plank/`, served with the extras), placed on
 *   these same anchors, in the deck's layer just in front of the near rail, so it rides the bob. Where that
 *   image did not load, the board is drawn in code from the hull's own colours instead (`plankPixels`).
 * - **The walk.** A departing sailor walks the deck to the plank's foot (`PLANK.foot`, open deck behind the
 *   rail) by the deck's own paths. One at a time: the rest wait beside the foot, in the order they left,
 *   and the next steps up only once the one before has hit the water (`plankFree`), so two sharks are
 *   never in the water at once. From the foot the sequence is this file's timeline, `plankExit`.
 * - **The timeline**, in milliseconds from the foot: a step up over the gunwale, the walk out to the tip at
 *   the deck's walking pace, a teeter at the end, a jump — a little up, then down — into the near sea, a
 *   splash (`impact`, then `burst`), the sailor's head bobbing up, a fin closing in, the shark surfacing,
 *   its jaws over the sailor (`chomp`: the sailor is gone from here on), and the shark going under with a
 *   second burst. About two and a half seconds from the foot to empty sea.
 * - **Where the water is.** The sailor drops into the sea straight below the plank's tip: as far in front
 *   of the hull's waterline as the tip is in front of the rail, so the splash and the shark are in the near
 *   sea (row 168), outside the ship's bob. The shark's art is anchored at its water contact
 *   (`art/ship-deck/shark/README.md`); its mouth is placed over the sailor, and it comes from the left or
 *   the right by turns (`side`), mirrored about its anchor.
 */
import type { SailorPose } from "../shared/ship-deck";

/**
 * Why a sailor left the deck: its card's work is done, it failed, its worker was closed (cancelled,
 * archived, or otherwise gone with the card still on the board), or its card is gone from the board.
 */
export type DeckDeparture = "done" | "failed" | "closed" | "removed";

/**
 * The departures that walk the plank; any other goes down the hatch. Every one, for now — one exit for
 * the whole crew. To keep the plank for finished work alone, make it `new Set(["done"])`.
 */
export const PLANK_DEPARTURES: ReadonlySet<DeckDeparture> = new Set<DeckDeparture>(["done", "failed", "closed", "removed"]);

/** How a departing sailor leaves the deck. */
export function exitFor(departure: DeckDeparture): "plank" | "hatch" {
  return PLANK_DEPARTURES.has(departure) ? "plank" : "hatch";
}

/**
 * The plank, in deck pixels (`client/deck-geometry.ts`): `foot` is where a sailor stands on the open deck
 * behind the rail before stepping up, `rail` its feet on the plank over the rail's top, `tip` its feet at
 * the end. `water` is the near sea's row straight below the tip. `left`/`width` are the board's top face at
 * the rail; it widens by a pixel each side at each third of its length, towards the viewer.
 */
export const PLANK = {
  foot: { x: 250, y: 118 },
  rail: { x: 250, y: 121 },
  tip: { x: 250, y: 138 },
  water: 168,
  left: 244,
  width: 12,
} as const;

/**
 * The plank's pixels, top to bottom, in the hull's own colours: [x, y, width, height, colour, alpha]. Two
 * boards side by side with a seam between them, widening towards the viewer, their end two rows thick, and
 * the shadow they cast on the hull's side below and to the right, which is what says they stick out.
 */
export function plankPixels(): ReadonlyArray<readonly [number, number, number, number, number, number]> {
  const top = PLANK.rail.y;
  const bottom = PLANK.tip.y + 1;
  const span = bottom - top;
  const runs: Array<readonly [number, number, number, number, number, number]> = [];
  const run = (x: number, y: number, width: number, height: number, colour: number, alpha = 1) => runs.push([x, y, width, height, colour, alpha]);
  let left = PLANK.left;
  let width = PLANK.width;
  for (let y = top; y <= bottom; y += 1) {
    // A pixel wider each side at each third, nearer the viewer.
    const grow = Math.floor(((y - top) * 3) / (span + 1));
    left = PLANK.left - grow;
    width = PLANK.width + grow * 2;
    const seam = left + Math.floor(width / 2);
    run(left, y, 1, 1, PLANK_COLOURS.edge);
    run(left + width - 1, y, 1, 1, PLANK_COLOURS.edge);
    // Each board lit along its left edge, with a run of grain now and then.
    const face = (y - top) % 6 === 4 ? PLANK_COLOURS.grain : PLANK_COLOURS.face;
    run(left + 1, y, 1, 1, PLANK_COLOURS.light);
    run(left + 2, y, seam - left - 2, 1, face);
    run(seam, y, 1, 1, PLANK_COLOURS.seam);
    run(seam + 1, y, 1, 1, PLANK_COLOURS.light);
    run(seam + 2, y, left + width - 1 - seam - 2, 1, face);
    // Its shadow on the hull, beside it.
    if (y >= top + 2) run(left + width, y, 2, 1, PLANK_COLOURS.shadow, PLANK_SHADOW_ALPHA);
  }
  // The end of the boards, and the shadow under it.
  run(left, bottom + 1, width, 2, PLANK_COLOURS.end);
  run(left + Math.floor(width / 2), bottom + 1, 1, 2, PLANK_COLOURS.edge);
  run(left, bottom + 3, width, 1, PLANK_COLOURS.edge);
  run(left + width, bottom + 1, 2, 3, PLANK_COLOURS.shadow, PLANK_SHADOW_ALPHA);
  run(left + 2, bottom + 4, width, 2, PLANK_COLOURS.shadow, PLANK_SHADOW_ALPHA);
  return runs;
}

/** The hull's own colours (`art/ship-deck/deck.png`), for the plank; its shadow is the hull's darkest navy, half seen through. */
export const PLANK_COLOURS = {
  light: 0xdca35b,
  face: 0xce9659,
  grain: 0xc17f46,
  seam: 0xa56235,
  end: 0x72412a,
  edge: 0x3e2921,
  shadow: 0x0e121e,
} as const;
export const PLANK_SHADOW_ALPHA = 0.45;

/** The step up over the gunwale from the foot. */
export const HOP_MS = 160;
/** Out along the plank, at the deck's walking pace (`WALK_SPEED`, 32 px a second). */
export const PLANK_WALK_MS = Math.round(((PLANK.tip.y - PLANK.rail.y) / 32) * 1000);
/** A teeter at the end. */
export const TEETER_MS = 300;
/** The jump, from the tip into the water. */
export const JUMP_MS = 420;
/** When the sailor hits the water: the plank is free for the next one from here. */
export const IMPACT_AT = HOP_MS + PLANK_WALK_MS + TEETER_MS + JUMP_MS;
/** The splash at the impact: `impact`, then `burst`. */
export const SPLASH_FRAMES = [
  { id: "impact", ms: 100 },
  { id: "burst", ms: 140 },
] as const;
/** Under the splash and back up: down for `PLUNGE_MS`, up for `BOB_UP_MS`. */
export const PLUNGE_MS = 140;
export const BOB_UP_MS = 200;
/** The rows of a swimming sailor above the water: its head and shoulders. */
export const SWIM_ROWS = 11;
/** The fin closes in on the swimmer, from `FIN_RUN` pixels off. */
export const FIN_AT = IMPACT_AT + 120;
export const FIN_MS = 560;
export const FIN_RUN = 40;
/** The shark's keys after the fin, each for its time (`art/ship-deck/shark/manifest.json`'s sequence). */
export const SURFACE_MS = 160;
export const CHOMP_MS = 180;
export const SUBMERGE_MS = 200;
/** The jaws close over the sailor: it is not drawn from here on. */
export const CHOMP_AT = FIN_AT + FIN_MS + SURFACE_MS;
/** The whole sequence, foot to empty sea. */
export const PLANK_EXIT_MS = CHOMP_AT + CHOMP_MS + SUBMERGE_MS;

export type SharkFrame = "fin" | "surface" | "chomp" | "submerge";
export type SplashFrame = "impact" | "burst";

/** Where a departure's sailor is drawn: on the deck behind the rail, on the plank over the rail, or in the sea. */
export type PlankLayer = "deck" | "rail" | "sea";

/** What shows of one departure at a moment of its sequence. */
export interface PlankMoment {
  /** The sailor, or null once the shark has it. `reveal` is the share of its rows drawn, cut at its feet. */
  sailor: { x: number; y: number; pose: SailorPose; reveal: number; layer: PlankLayer; moving: boolean } | null;
  /** The shark, its water anchor and which key; `flip` when it comes from the right, facing left. */
  shark: { frame: SharkFrame; x: number; y: number; flip: boolean } | null;
  /** The splash, its water anchor and which key. */
  splash: { frame: SplashFrame; x: number; y: number } | null;
  done: boolean;
}

const WALK_FRONT: readonly SailorPose[] = ["front-walk-a", "front-idle", "front-walk-b", "front-idle"];
const STEP_MS = 150;

function between(from: number, to: number, t: number): number {
  return from + (to - from) * Math.max(0, Math.min(1, t));
}

/**
 * One departure's sequence at `t` milliseconds from the plank's foot. `side` is where the shark comes
 * from (-1 the left, facing right; 1 the right, facing left), `drift` how far across the sailor lands
 * from the tip, `sailorHeight` its pose's rows, and `mouth` the shark's mouth from its water anchor, as
 * drawn facing right. Whole pixels throughout.
 */
export function plankExit(t: number, options: { side: -1 | 1; drift: number; sailorHeight: number; mouth: readonly [number, number] }): PlankMoment {
  const { side, drift, sailorHeight, mouth } = options;
  const wx = PLANK.tip.x + drift;
  const wy = PLANK.water;
  if (t >= PLANK_EXIT_MS) return { sailor: null, shark: null, splash: null, done: true };

  let sailor: PlankMoment["sailor"] = null;
  if (t < HOP_MS) {
    // A step up over the gunwale onto the plank, a little arc; in front of the rail once more than halfway over.
    const u = t / HOP_MS;
    const y = between(PLANK.foot.y, PLANK.rail.y, u) - Math.sin(Math.PI * u) * 2;
    sailor = { x: PLANK.foot.x, y: Math.round(y), pose: "front-walk-a", reveal: 1, layer: u >= 0.5 ? "rail" : "deck", moving: true };
  } else if (t < HOP_MS + PLANK_WALK_MS) {
    const walked = t - HOP_MS;
    const step = Math.floor(walked / STEP_MS) % 4;
    const y = between(PLANK.rail.y, PLANK.tip.y, walked / PLANK_WALK_MS);
    sailor = { x: PLANK.rail.x, y: Math.round(y) - (step % 2 === 1 ? 1 : 0), pose: WALK_FRONT[step]!, reveal: 1, layer: "rail", moving: true };
  } else if (t < HOP_MS + PLANK_WALK_MS + TEETER_MS) {
    // At the end, rocking from foot to foot.
    const at = t - HOP_MS - PLANK_WALK_MS;
    const dx = [0, -1, 0, 1][Math.floor(at / 75) % 4] ?? 0;
    sailor = { x: PLANK.tip.x + dx, y: PLANK.tip.y, pose: "front-idle", reveal: 1, layer: "rail", moving: false };
  } else if (t < IMPACT_AT) {
    // Off the end: a little up, then down into the sea, drifting across.
    const u = (t - (IMPACT_AT - JUMP_MS)) / JUMP_MS;
    const y = PLANK.tip.y + (wy - PLANK.tip.y) * u * u - 16 * u * (1 - u);
    sailor = { x: Math.round(between(PLANK.tip.x, wx, u)), y: Math.round(y), pose: "front-walk-b", reveal: 1, layer: "sea", moving: true };
  } else if (t < CHOMP_AT) {
    // Under the splash, then back up, head and shoulders out, bobbing.
    const since = t - IMPACT_AT;
    const swim = SWIM_ROWS / sailorHeight;
    const reveal =
      since < PLUNGE_MS ? between(1, 0, since / PLUNGE_MS) : since < PLUNGE_MS + BOB_UP_MS ? between(0, swim, (since - PLUNGE_MS) / BOB_UP_MS) : swim;
    const bob = since >= PLUNGE_MS + BOB_UP_MS && Math.floor(since / 300) % 2 === 1 ? 1 : 0;
    sailor = { x: wx, y: wy + bob, pose: "front-idle", reveal: Math.round(reveal * sailorHeight) / sailorHeight, layer: "sea", moving: false };
  }

  // The shark's anchor puts its mouth over the swimmer; coming from the right it is mirrored, its mouth to the left.
  const flip = side === 1;
  const restX = wx - (flip ? -mouth[0] : mouth[0]);
  let shark: PlankMoment["shark"] = null;
  if (t >= FIN_AT && t < FIN_AT + FIN_MS) {
    const u = (t - FIN_AT) / FIN_MS;
    shark = { frame: "fin", x: Math.round(restX + side * FIN_RUN * (1 - u)), y: wy, flip };
  } else if (t >= FIN_AT + FIN_MS && t < CHOMP_AT) {
    shark = { frame: "surface", x: restX, y: wy, flip };
  } else if (t >= CHOMP_AT && t < CHOMP_AT + CHOMP_MS) {
    shark = { frame: "chomp", x: restX, y: wy, flip };
  } else if (t >= CHOMP_AT + CHOMP_MS) {
    shark = { frame: "submerge", x: restX, y: wy, flip };
  }

  let splash: PlankMoment["splash"] = null;
  const splashAt = (start: number) => {
    let at = t - start;
    for (const frame of SPLASH_FRAMES) {
      if (at >= 0 && at < frame.ms) return frame.id;
      at -= frame.ms;
    }
    return null;
  };
  const landing = splashAt(IMPACT_AT);
  if (landing !== null) splash = { frame: landing, x: wx, y: wy };
  // The burst again as the shark goes under: over the swimmer, where the bite was.
  else if (t >= CHOMP_AT + CHOMP_MS && t < CHOMP_AT + CHOMP_MS + SPLASH_FRAMES[1].ms) splash = { frame: "burst", x: wx, y: wy };

  return { sailor, shark, splash, done: false };
}

