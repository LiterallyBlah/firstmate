/** `phase-tint@1`: the stage's authored RGB multipliers follow the same eased wall-clock day as its backdrop. */
import type { SettingManifest } from "../shared/deck-setting";
import { dayBlend } from "./deck-sky";

export interface PhaseTint {
  cycle: NonNullable<SettingManifest["dayCycle"]>;
  colours: readonly number[];
}

export function compilePhaseTint(manifest: Pick<SettingManifest, "stage" | "dayCycle">): PhaseTint | null {
  const { tintByPhase } = manifest.stage;
  const cycle = manifest.dayCycle;
  if (tintByPhase === undefined || cycle === undefined) return null;
  return { cycle, colours: cycle.phases.map(({ id }) => Number.parseInt((tintByPhase[id] ?? "#FFFFFF").slice(1), 16)) };
}

/** White is the identity tint. A missing/invalid clock uses the day cycle's fallback, also in still mode. */
export function phaseTintAt(definition: PhaseTint | null, minute: number | null): number {
  if (definition === null) return 0xffffff;
  const blend = dayBlend(minute, definition.cycle);
  const from = definition.colours[blend.from]!;
  const to = definition.colours[blend.to]!;
  let tint = 0;
  for (const shift of [16, 8, 0]) {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    tint |= Math.round(a + (b - a) * blend.t) << shift;
  }
  return tint;
}
