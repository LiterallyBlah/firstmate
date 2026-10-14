/**
 * When the deck draws: a capped frame loop, paused while nobody can see the deck, never started under
 * reduced motion. No Pixi and no browser globals — the scheduler and the signals are handed in, so the
 * tests drive it with a fake clock.
 *
 * - **Capped.** Frames come from `requestAnimationFrame`, but one is drawn only once a frame's worth of
 *   time has passed since the last (`1000 / fps`, less some slack for a display's frames not landing
 *   exactly on it), so a 60, 120 or 144 Hz display draws about 30 frames a second, not 60 to 144.
 * - **Paused when hidden.** The window in the background (`document.hidden`) or a pane with no size
 *   stops the loop outright — no frames requested at all. Leaving the Deck tears the canvas down.
 * - **Still under reduced motion.** `prefers-reduced-motion: reduce` runs no loop: the deck is drawn
 *   once whenever something changes, with every sailor at its anchor and the state still shown.
 * - **Clock.** The scene's clock is the time the loop has run, so a pause does not jump the motion on,
 *   and no step is longer than `MAX_STEP_MS` (a stalled tab does not teleport the crew).
 */
import { motionPlan, type MotionPlan } from "./deck-ambient";

export interface FrameScheduler {
  request(callback: (nowMs: number) => void): number;
  cancel(handle: number): void;
}

/** What says whether the deck may move: the user's motion preference and the page's visibility. */
export interface MotionSignals {
  reducedMotion(): boolean;
  documentHidden(): boolean;
  /** Calls `onChange` when either changes; returns the way to stop. */
  subscribe(onChange: () => void): () => void;
}

export const MAX_STEP_MS = 100;

export interface DeckAnimator {
  /** The plan in force: still, lite or full, running or paused. */
  plan(): MotionPlan;
  /** Whether frames are being requested. */
  running(): boolean;
  /** The scene clock: milliseconds the loop has run. */
  elapsed(): number;
  /** The canvas's size changed; a zero size pauses. */
  resize(width: number, height: number): void;
  /** Something changed: drawn on the next frame, or now when no loop runs. */
  invalidate(): void;
  destroy(): void;
}

/**
 * Runs `frame(elapsedMs, stepMs, plan)` at the plan's frame rate while the deck may move and is seen,
 * and once on each `invalidate` (and each change of plan) while it may not.
 */
export function deckAnimator(options: {
  scheduler: FrameScheduler;
  signals: MotionSignals;
  software: boolean;
  size: { width: number; height: number };
  frame: (elapsedMs: number, stepMs: number, plan: MotionPlan) => void;
}): DeckAnimator {
  const { scheduler, signals, software, frame } = options;
  let size = { ...options.size };
  let handle: number | null = null;
  let last: number | null = null;
  let clock = 0;
  let gone = false;
  let current = computePlan();

  function computePlan(): MotionPlan {
    return motionPlan({
      reducedMotion: signals.reducedMotion(),
      software,
      hidden: signals.documentHidden() || size.width < 1 || size.height < 1,
    });
  }

  function tick(now: number): void {
    handle = null;
    if (gone || !current.animate) return;
    const interval = 1000 / current.fps;
    const slack = Math.min(4, interval * 0.15);
    if (last === null) {
      last = now;
      frame(clock, 0, current);
    } else if (now - last >= interval - slack) {
      const step = Math.min(now - last, MAX_STEP_MS);
      last = now;
      clock += step;
      frame(clock, step, current);
    }
    handle = scheduler.request(tick);
  }

  function start(): void {
    if (handle !== null) return;
    last = null;
    handle = scheduler.request(tick);
  }

  function stop(): void {
    if (handle !== null) scheduler.cancel(handle);
    handle = null;
    last = null;
  }

  function apply(): void {
    current = computePlan();
    if (current.animate) {
      start();
      return;
    }
    stop();
    // A still deck is drawn once; a hidden one not at all, until it is seen again.
    if (current.level === "still" && size.width >= 1 && size.height >= 1 && !signals.documentHidden()) frame(clock, 0, current);
  }

  const unsubscribe = signals.subscribe(function () {
    if (!gone) apply();
  });
  apply();

  return {
    plan: () => current,
    running: () => handle !== null,
    elapsed: () => clock,
    resize(width, height) {
      size = { width, height };
      if (!gone) apply();
    },
    invalidate() {
      if (gone) return;
      if (current.animate) start();
      else if (current.level === "still") frame(clock, 0, current);
    },
    destroy() {
      gone = true;
      stop();
      unsubscribe();
    },
  };
}
