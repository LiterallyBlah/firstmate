/** Geometry-only portion of the pack linter, also usable before commissioned art arrives. */
import type { SettingManifest } from "../shared/deck-setting";
import { inRects, walkable } from "../client/deck-geometry";
import { compileStage } from "../client/deck-stage";

export function walkingEntryProblems(manifest: SettingManifest): string[] {
  const entry = manifest.portals.entry;
  if (entry.kind !== "walk-in") return [];
  const stage = compileStage(manifest);
  const problems: string[] = [];
  if (!walkable(stage.floor, ...entry.at)) problems.push("entry.at must be on open floor");
  const steps = Math.max(1, Math.ceil(Math.hypot(entry.at[0] - entry.from[0], entry.at[1] - entry.from[1]) * 2));
  const obstacles = stage.floor.obstacles.map(({ rect }) => rect);
  for (let step = 0; step <= steps; step++) {
    const x = entry.from[0] + (entry.at[0] - entry.from[0]) * step / steps;
    const y = entry.from[1] + (entry.at[1] - entry.from[1]) * step / steps;
    if (inRects(obstacles, { x, y })) {
      problems.push("entry corridor crosses an obstacle");
      break;
    }
  }
  const { roles } = manifest.cast;
  const poses = new Set([roles.stand, ...roles.walkFront, ...roles.walkSide]);
  for (const lane of Object.values(manifest.cast.lanes)) for (const pose of poses) {
    const { rect, feet } = lane[pose]!;
    const rise = roles.walkFront.includes(pose) || roles.walkSide.includes(pose) ? roles.rise : 0;
    for (const [x, y] of [entry.from, entry.at]) for (const flip of roles.walkSide.includes(pose) ? [false, true] : [false]) {
      const left = flip ? rect[2] - feet[0] : feet[0];
      if (x - left < 0 || x + rect[2] - left > stage.width || y - feet[1] - Math.max(0, rise) < stage.fit.top || y + rect[3] - feet[1] - Math.min(0, rise) > stage.fit.bottom)
        problems.push(`entry corridor clips pose ${pose}`);
    }
  }
  return [...new Set(problems)];
}
