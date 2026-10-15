/**
 * The deck's ambient life, as pure functions of the scene clock: the sea, the ship's bob, the masthead's
 * sway, the lanterns' flicker and the odd flyby. Nothing here reads crew state, and nothing keeps state
 * of its own, so a frozen or stepped clock reproduces any frame (`docs/ship-deck-motion/render.mjs`).
 *
 * The ideas are the throwaway prototype's pass 3, redrawn for hull C's side-on view and kept cheap:
 * no shaders, so a software renderer pays only for sprites. Motion is whole art pixels, slow, and
 * small — the crew is what should catch the eye.
 *
 * The sea, the sky and the flyby's sprite are the generated environment's (`client/deck-environment.ts`,
 * `client/deck-sky.ts`); this file keeps only where the water is and where a flyby flies.
 *
 * - **Ship** — bobs a pixel up and down over about six seconds, crew and all; the sea does not.
 * - **Masthead** — the crow's nest and topmast, cut from the hull (or the tall mast's top rows), sway a pixel
 *   each way behind the bob.
 * - **Lanterns** — three, on the stern post, the quarterdeck's front post and the mast, flickering on
 *   three out-of-step sines.
 * - **A flyby** (`flyby@1`, the ship's gull) — now and then one crosses the stage in its rows, flapping in bursts
 *   and gliding; when, where and how fast are the pack's.
 */
import type { Behaviour } from "./deck-ambience";

/** How the deck moves: fully, lightly on a software renderer, or not at all (reduced motion, or hidden). */
export type MotionLevel = "full" | "lite" | "still";

export interface MotionPlan {
  level: MotionLevel;
  /** Whether a frame loop runs at all. */
  animate: boolean;
  /** The frame-rate cap while it runs. */
  fps: number;
  /** Whether the sea and foam scroll and gulls fly; off on a software renderer, where every frame is CPU-drawn. */
  ambient: boolean;
}

/** The frame-rate cap: the deck's motion is slow, and 30 fps is plenty for whole-pixel steps. */
export const DECK_FPS = 30;
/** On a software renderer: the crew still walks, at a frame rate a CPU can draw without strain. */
export const LITE_FPS = 12;

/**
 * What the deck may do now. Reduced motion is a still deck that still shows every state; a hidden deck
 * (the window in the background, or a pane with no size) runs nothing at all.
 */
export function motionPlan(options: { reducedMotion: boolean; software: boolean; hidden: boolean }): MotionPlan {
  if (options.reducedMotion) return { level: "still", animate: false, fps: 0, ambient: false };
  const level: MotionLevel = options.software ? "lite" : "full";
  return {
    level,
    animate: !options.hidden,
    fps: options.software ? LITE_FPS : DECK_FPS,
    ambient: !options.software,
  };
}

const TAU = Math.PI * 2;

/** How far the ship bobs, in art pixels each way before rounding: a pixel, most of the time. */
export const HEAVE = 1.2;

/**
 * The ship's bob, in whole pixels: up and down a pixel over about six seconds. A livelier sea (`heave`, from the
 * deck's weather in `client/deck-atmosphere.ts`) lifts it a pixel more at the top of each swell.
 */
export function shipBob(seconds: number, heave = HEAVE): { x: number; y: number } {
  return { x: 0, y: Math.round(Math.sin((seconds * TAU) / 6.2) * heave) };
}

/** The masthead's sway, in whole pixels, a beat behind the bob: -1, 0 or 1, held longer at the ends in a livelier sea. */
export function mastSway(seconds: number, heave = HEAVE): number {
  return Math.max(-1, Math.min(1, Math.round(Math.sin((seconds * TAU) / 6.2 - 1.0) * 1.3 * (heave / HEAVE))));
}

/** The masthead cut from the hull to sway: the short rig's crow's nest and topmast, above the mast piece. */
export const MASTHEAD = { x: 188, y: 0, width: 54, height: 48 } as const;

/** A lantern: where its lamp hangs (the top of its bail), and the depth row it is drawn at. */
export interface Lantern {
  x: number;
  y: number;
  /** The row it is drawn at: the mast's lantern in front of the mast, the others just over the hull. */
  row: number;
  seed: number;
}

export const LANTERNS: readonly Lantern[] = [
  { x: 410, y: 50, row: 80, seed: 0.0 },
  { x: 344, y: 48, row: 80, seed: 2.3 },
  { x: 211, y: 70, row: 110, seed: 4.9 },
];

/** A lantern's brightness, about 0.6 to 1: two out-of-step sines and a fast flutter, never a rhythm. */
export function lanternFlicker(seconds: number, seed: number): number {
  const value =
    0.8 + 0.1 * Math.sin(seconds * 7.1 + seed) + 0.06 * Math.sin(seconds * 13.7 + seed * 2) + 0.04 * Math.sin(seconds * 29 + seed * 5);
  return Math.max(0, Math.min(1, value));
}

/** A tiny deterministic random number from an integer, 0 to 1. */
export function hashUnit(n: number): number {
  let s = (n * 0x9e3779b1) >>> 0;
  s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) >>> 0;
  s = Math.imul(s ^ (s >>> 12), 0x297a2d39) >>> 0;
  return ((s ^ (s >>> 15)) >>> 0) / 4294967296;
}

/** A flyer crossing the stage this frame. */
export interface Flyer {
  /** Where its anchor is: the sprite's registration point. */
  x: number;
  y: number;
  /** Flapping (its `sequence`), or gliding on its `glide` pose. */
  flapping: boolean;
  /** Seconds since it set off, for the flap's phase. */
  age: number;
  /** Flying left (the sprite is drawn flying right). */
  flip: boolean;
}

/** What `flybysAt` reads of a flyby: the pack's `flyby@1` behaviour. */
export type FlybyTiming = Pick<Behaviour<"flyby">, "slotS" | "chance" | "start" | "speed" | "margin" | "rows" | "wobble" | "flap">;

/**
 * The flyers of `flyby` crossing a stage `stageWidth` wide at `seconds`: time is cut into slots of `slotS`, and a
 * slot has one, with the flyby's `chance`, setting off at a seeded moment between its `start` bounds from a seeded
 * side, at `speed` from `margin` past one edge to `margin` past the other. Its row is seeded between its `rows`,
 * from the lower up, wobbling `wobble.px` each way; it flaps for `flap.forS` in every `flap.everyS` and glides
 * between. Deterministic: slot k's flyer, if it flies at all, leaves at a time and side drawn from k.
 */
export function flybysAt(seconds: number, stageWidth: number, flyby: FlybyTiming): Flyer[] {
  const flyers: Flyer[] = [];
  const slot = Math.floor(seconds / flyby.slotS);
  const span = stageWidth + flyby.margin * 2;
  const duration = span / flyby.speed;
  // The slots whose flyer can still be in the air: one back, unless a crossing outlasts a slot.
  const back = Math.max(1, Math.ceil((flyby.start[1] + duration) / flyby.slotS) - 1);
  for (let k = slot - back; k <= slot; k += 1) {
    if (k < 0 || hashUnit(k * 3 + 1) > flyby.chance) continue;
    const start = k * flyby.slotS + flyby.start[0] + hashUnit(k * 3 + 2) * (flyby.start[1] - flyby.start[0]);
    const age = seconds - start;
    if (age < 0 || age > duration) continue;
    const leftward = hashUnit(k * 3 + 3) < 0.5;
    const travelled = age * flyby.speed - flyby.margin;
    const x = leftward ? stageWidth - travelled : travelled;
    const height = flyby.rows[1] - hashUnit(k * 7 + 5) * (flyby.rows[1] - flyby.rows[0]);
    const y = height + Math.sin(age * flyby.wobble.rate + k) * flyby.wobble.px;
    flyers.push({ x: Math.round(x), y: Math.round(y), flapping: age % flyby.flap.everyS < flyby.flap.forS, age, flip: leftward });
  }
  return flyers;
}

/** A flyer's pose `ageSeconds` into a flap: the flyby's `sequence` at its `frameMs`, round and round. */
export function flybyPose(ageSeconds: number, flyby: Pick<Behaviour<"flyby">, "sequence" | "frameMs" | "glide">): string {
  const step = Math.floor((Math.max(0, ageSeconds) * 1000) / flyby.frameMs);
  return flyby.sequence[step % flyby.sequence.length] ?? flyby.glide;
}

/** The sea's colour where the generated water could not be loaded: the hull's navy, deepened. */
export const SEA_FALLBACK = 0x15304a;

/** Where the water is, in deck rows: the far sea's edge behind the hull, and the waterline in front of it. */
export const HORIZON = 96;
export const WATERLINE = 151;
