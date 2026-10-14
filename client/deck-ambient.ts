/**
 * The deck's ambient life, as pure functions of the scene clock: the sea, the ship's bob, the masthead's
 * sway, the lanterns' flicker and the odd gull. Nothing here reads crew state, and nothing keeps state
 * of its own, so a frozen or stepped clock reproduces any frame (`docs/ship-deck-motion/render.mjs`).
 *
 * The ideas are the throwaway prototype's pass 3, redrawn for hull C's side-on view and kept cheap:
 * no shaders, so a software renderer pays only for sprites. Motion is whole art pixels, slow, and
 * small — the crew is what should catch the eye.
 *
 * - **Sea** — a band of water from a horizon behind the hull down past the canvas, and a strip in front
 *   of the hull's waterline. Rows of short crest dashes drift at their own pace (nearer rows faster); the
 *   foam where the water meets the hull laps between two shapes.
 * - **Ship** — bobs a pixel up and down over about six seconds, crew and all; the sea does not.
 * - **Masthead** — the crow's nest and topmast, cut from the hull, sway a pixel each way behind the bob.
 * - **Lanterns** — three, on the stern post, the quarterdeck's front post and the mast, flickering on
 *   three out-of-step sines.
 * - **Gulls** — now and then one crosses the sky above the masthead, flapping in bursts and gliding.
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
  /** Whether the sea drifts and gulls fly; off on a software renderer, where every frame is CPU-drawn. */
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

/** The masthead cut from the hull to sway: the crow's nest and topmast, above the mast piece. */
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
  x: number;
  y: number;
  /** 0 wings up, 1 wings level, 2 wings down. */
  frame: 0 | 1 | 2;
  /** Flying left (the sprite is drawn flying right). */
  flip: boolean;
}

/** Gulls come in slots: at most one a slot, about two slots in three. */
export const GULL_SLOT_SECONDS = 24;
const GULL_SPEED = 26;
const GULL_MARGIN = 60;

/**
 * The gulls in the sky at `seconds`: one now and then crosses from one side to the other above the
 * masthead, its height drifting, flapping for a second in every three and gliding between.
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
    const height = -18 + hashUnit(k * 7 + 5) * 28;
    const y = height + Math.sin(age * 0.7 + k) * 4;
    const flapping = age % 3 < 1;
    const frame: 0 | 1 | 2 = flapping ? ([0, 1, 2, 1] as const)[Math.floor(age * 10) % 4]! : 1;
    gulls.push({ x: Math.round(x), y: Math.round(y), frame, flip: leftward });
  }
  return gulls;
}

/** The sea's colours: the hull's navy, deepened, and a pale foam. Fixed, so the sea reads in any theme. */
export const SEA = {
  deep: 0x15304a,
  crest: 0x2f5f86,
  glint: 0x8fb8d0,
  foam: 0xd8ecf2,
  foamShade: 0x9cc3d4,
} as const;

/** Where the water is, in deck rows: the far sea's edge behind the hull, and the waterline in front of it. */
export const HORIZON = 96;
export const WATERLINE = 151;

/** The pattern repeats every this many pixels across, so a strip scrolls by moving, never redrawing. */
export const WAVE_PERIOD = 64;

/** A row of crest dashes: where each starts within one period, how long, and whether it glints. */
export interface WaveRow {
  y: number;
  dashes: Array<{ x: number; length: number; glint: boolean }>;
  /** Drift, in pixels a second: nearer rows drift faster. */
  speed: number;
}

/**
 * The sea's crest rows from `top` to `bottom`, every third row, each with a few dashes spread through
 * one period by a hash of the row. Nearer rows (further down) get longer dashes and drift faster.
 */
export function waveRows(top: number, bottom: number): WaveRow[] {
  const rows: WaveRow[] = [];
  for (let y = top + 2; y < bottom; y += 3) {
    const depth = Math.max(0, Math.min(1, (y - top) / 80));
    const count = 2 + Math.floor(hashUnit(y * 13) * 2);
    const dashes: WaveRow["dashes"] = [];
    for (let index = 0; index < count; index += 1) {
      dashes.push({
        x: Math.floor(((index + hashUnit(y * 31 + index) * 0.6) * WAVE_PERIOD) / count),
        length: 2 + Math.floor(depth * 3 + hashUnit(y * 17 + index) * 3),
        glint: hashUnit(y * 41 + index) > 0.82,
      });
    }
    const direction = Math.floor(y / 3) % 2 === 0 ? 1 : -1;
    rows.push({ y, dashes, speed: direction * (1.5 + depth * 4) });
  }
  return rows;
}

/** How far a wave row has drifted at `seconds`, in whole pixels within one period. */
export function waveDrift(row: WaveRow, seconds: number): number {
  const drift = Math.floor(seconds * row.speed) % WAVE_PERIOD;
  return drift < 0 ? drift + WAVE_PERIOD : drift;
}

/** Which of the foam's two shapes shows at `seconds`: it laps against the hull about once a second. */
export function foamFrame(seconds: number): 0 | 1 {
  return Math.floor(seconds / 0.9) % 2 === 0 ? 0 : 1;
}
