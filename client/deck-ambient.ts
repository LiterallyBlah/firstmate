/**
 * The deck's ambient life, as pure functions of the scene clock: the sea, the ship's bob, the masthead's
 * sway, the lanterns' flicker and the odd gull. Nothing here reads crew state, and nothing keeps state
 * of its own, so a frozen or stepped clock reproduces any frame (`docs/ship-deck-motion/render.mjs`).
 *
 * The ideas are the throwaway prototype's pass 3, redrawn for hull C's side-on view and kept cheap:
 * no shaders, so a software renderer pays only for sprites. Motion is whole art pixels, slow, and
 * small — the crew is what should catch the eye.
 *
 * The sea, the sky and the gull's sprite are the generated environment's (`client/deck-environment.ts`,
 * `client/deck-sky.ts`); this file keeps only where the water is and where a gull flies.
 *
 * - **Ship** — bobs a pixel up and down over about six seconds, crew and all; the sea does not.
 * - **Masthead** — the crow's nest and topmast, cut from the hull (or the tall mast's top rows), sway a pixel
 *   each way behind the bob.
 * - **Lanterns** — three, on the stern post, the quarterdeck's front post and the mast, flickering on
 *   three out-of-step sines.
 * - **Gulls** — now and then one crosses the sky at the short masthead's height, about halfway up the tall
 *   mast, flapping in bursts and gliding.
 */
import { DECK_WIDTH } from "./deck-scene";

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

/** The ship's bob, in whole pixels: up and down a pixel over about six seconds. */
export function shipBob(seconds: number): { x: number; y: number } {
  return { x: 0, y: Math.round(Math.sin((seconds * TAU) / 6.2) * 1.2) };
}

/** The masthead's sway, in whole pixels, a beat behind the bob: -1, 0 or 1. */
export function mastSway(seconds: number): number {
  return Math.max(-1, Math.min(1, Math.round(Math.sin((seconds * TAU) / 6.2 - 1.0) * 1.3)));
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

/** A gull in the sky this frame. */
export interface Gull {
  /** Where its beak is: the generated sprite's registration point. */
  x: number;
  y: number;
  /** Flapping (the sprite's flap cycle), or gliding on its middle pose. */
  flapping: boolean;
  /** Seconds since it set off, for the flap cycle's phase. */
  age: number;
  /** Flying left (the sprite is drawn flying right). */
  flip: boolean;
}

/** Gulls come in slots: at most one a slot, about two slots in three. */
export const GULL_SLOT_SECONDS = 24;
const GULL_SPEED = 26;
const GULL_MARGIN = 60;
/** The lowest a gull's beak flies: its raised wing reaches 17 rows above that, its lowered one 9 below. */
export const GULL_LOWEST = 40;

/**
 * The gulls in the sky at `seconds`: one now and then crosses from one side to the other at about the
 * short masthead's height (halfway up the tall mast), its height drifting, flapping for a second in every
 * three and gliding between.
 * It flies behind the ship, so one that meets the mast passes behind it, and low enough that its
 * whole sprite is inside the deck's frame: a pane that fits the deck's height still shows it.
 * Deterministic: slot k's gull, if it flies at all, leaves at a time and side drawn from k.
 */
export function gullsAt(seconds: number): Gull[] {
  const gulls: Gull[] = [];
  const slot = Math.floor(seconds / GULL_SLOT_SECONDS);
  const span = DECK_WIDTH + GULL_MARGIN * 2;
  const duration = span / GULL_SPEED;
  for (let k = slot - 1; k <= slot; k += 1) {
    if (k < 0 || hashUnit(k * 3 + 1) > 0.68) continue;
    const start = k * GULL_SLOT_SECONDS + 2 + hashUnit(k * 3 + 2) * 6;
    const age = seconds - start;
    if (age < 0 || age > duration) continue;
    const leftward = hashUnit(k * 3 + 3) < 0.5;
    const travelled = age * GULL_SPEED - GULL_MARGIN;
    const x = leftward ? DECK_WIDTH - travelled : travelled;
    const height = GULL_LOWEST - hashUnit(k * 7 + 5) * 18;
    const y = height + Math.sin(age * 0.7 + k) * 3;
    gulls.push({ x: Math.round(x), y: Math.round(y), flapping: age % 3 < 1, age, flip: leftward });
  }
  return gulls;
}

/** The sea's colour where the generated water could not be loaded: the hull's navy, deepened. */
export const SEA_FALLBACK = 0x15304a;

/** Where the water is, in deck rows: the far sea's edge behind the hull, and the waterline in front of it. */
export const HORIZON = 96;
export const WATERLINE = 151;
