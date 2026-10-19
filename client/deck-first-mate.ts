import { walkPose, type DeckCast } from "./deck-cast";
import { findPath, type Point } from "./deck-geometry";
import type { Figure } from "./deck-crew";
import type { DeckScene } from "./deck-scene";
import type { DeckStage } from "./deck-stage";

export const FIRST_MATE_KEY = "@first-mate";

/** An officer, never a worker, weather input, arrival or departure. Uses only the commissioned atlas. */
export function firstMateFigure(stage: DeckStage, cast: DeckCast, scene?: DeckScene): Figure | null {
  const post = stage.firstMate, look = cast.firstMate;
  if (post == null || look == null) return null;
  const decisions = scene?.decisions;
  const asking = (decisions?.workerlessCount ?? 0) > 0;
  const at = asking ? post.asking ?? post : post;
  return {
    key: FIRST_MATE_KEY, label: "First mate", state: asking ? "blocked" : "waiting",
    stale: decisions?.snapshot.freshness.status === "stale", decisionNew: decisions?.workerless.some(r => r.state === "new") ?? false,
    look: look.id, lane: look.lane, pose: look.pose, flip: look.flip,
    x: at.x, y: at.y, row: at.y, reveal: 1, moving: false, seed: 0, sink: 0, departing: false, layer: "floor", alpha: 1,
  };
}

export interface FirstMateMotion { at: Point | null; target: Point | null; path: Point[]; walkedMs: number }
export const createFirstMateMotion = (): FirstMateMotion => ({ at: null, target: null, path: [], walkedMs: 0 });

/** Replan from the current feet on reversal. Reduced motion and first mount use the final post. */
export function moveFirstMate(stage: DeckStage, cast: DeckCast, motion: FirstMateMotion, scene: DeckScene, stepMs: number, snap: boolean): Figure | null {
  const figure = firstMateFigure(stage, cast, scene);
  if (!figure) return null;
  const target = { x: figure.x, y: figure.y };
  if (!motion.at || snap || figure.stale) {
    motion.at = target; motion.target = target; motion.path = [];
    return figure;
  }
  if (motion.target?.x !== target.x || motion.target?.y !== target.y) {
    motion.target = target;
    motion.path = findPath(stage.floor, motion.at, target);
  }
  let left = Math.max(0, stepMs) * stage.floor.walkSpeed / 1000;
  let direction = figure.flip ? "left" as const : "right" as const;
  while (motion.path.length) {
    const next = motion.path[0]!, dx = next.x - motion.at.x, dy = next.y - motion.at.y;
    const distance = Math.hypot(dx, dy);
    direction = dx < 0 ? "left" : "right";
    if (distance <= left) { motion.at = next; motion.path.shift(); left -= distance; }
    else {
      motion.at = { x: motion.at.x + dx * left / distance, y: motion.at.y + dy * left / distance };
      break;
    }
  }
  const moving = motion.path.length > 0;
  if (moving) motion.walkedMs += stepMs;
  const pose = moving ? walkPose(cast, direction, motion.walkedMs) : figure;
  return { ...figure, x: motion.at.x, y: motion.at.y, row: motion.at.y, moving, pose: pose.pose, flip: pose.flip };
}
