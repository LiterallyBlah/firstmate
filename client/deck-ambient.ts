/**
 * The deck's motion plan, and its odd flyby as a pure function of the scene clock. Nothing here reads crew state,
 * and nothing keeps state of its own, so a frozen or stepped clock reproduces any frame
 * (`docs/ship-deck-motion/render.mjs`).
 *
 * The ideas are the throwaway prototype's pass 3, redrawn for hull C's side-on view and kept cheap:
 * no shaders, so a software renderer pays only for sprites. Motion is whole art pixels, slow, and
 * small — the crew is what should catch the eye.
 *
 * The sea, the sky and the flyby's sprite are the setting's (`client/deck-ambience.ts`, drawn by
 * `client/deck-environment.ts`), and the stage's bob, its parts' sway and its lights' flicker are the setting's
 * parts' (`client/deck-parts.ts`); this file keeps only the plan and where and when a flyby flies.
 *
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
