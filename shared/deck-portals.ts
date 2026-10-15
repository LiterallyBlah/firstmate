/** Fixed walk-in vocabulary lowered to the same finite effect timeline as an exit. No schema runtime here. */
import type { SettingManifest } from "./deck-setting";

type WalkIn = Extract<SettingManifest["portals"]["entry"], { kind: "walk-in" }>;
type Choreography = Extract<SettingManifest["portals"]["exits"][string], { kind: "choreography" }>;

/** Only two marks and two events. Effects have no alternation: side -1, drift 0. */
export function walkInChoreography(entry: WalkIn): Choreography {
  const [dx, dy] = [entry.at[0] - entry.from[0], entry.at[1] - entry.from[1]];
  return {
    kind: "choreography", marks: { from: entry.from, at: entry.at },
    queue: { at: "from", release: "entered", spacing: [1, 1] },
    alternate: { side: [-1], drift: [0] },
    actor: [{ ms: "walk", to: { mark: "at" }, event: "entered", pose: { cycle: Math.abs(dx) >= Math.abs(dy) * 0.5 ? "walkSide" : "walkFront" }, layer: "floor", moving: true }],
    effects: entry.effects ?? [],
  };
}
