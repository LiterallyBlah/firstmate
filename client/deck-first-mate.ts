import type { DeckCast } from "./deck-cast";
import type { Figure } from "./deck-crew";
import type { DeckScene } from "./deck-scene";
import type { DeckStage } from "./deck-stage";

export const FIRST_MATE_KEY = "@first-mate";

/** A fixed officer, never a worker, weather input, arrival or departure. Uses only the commissioned atlas. */
export function firstMateFigure(stage: DeckStage, cast: DeckCast, scene?: DeckScene): Figure | null {
  const post = stage.firstMate, look = cast.firstMate;
  if (post == null || look == null) return null;
  const decisions = scene?.decisions;
  return {
    key: FIRST_MATE_KEY, label: "First mate", state: (decisions?.workerlessCount ?? 0) > 0 ? "blocked" : "waiting",
    stale: decisions?.snapshot.freshness.status === "stale", decisionNew: decisions?.workerless.some(r => r.state === "new") ?? false,
    look: look.id, lane: look.lane, pose: look.pose, flip: look.flip,
    x: post.x, y: post.y, row: post.y, reveal: 1, moving: false, seed: 0, sink: 0, departing: false, layer: "floor", alpha: 1,
  };
}
