/** Day sets resolved once per strip, after unavailable sets have been removed. */
import type { Behaviour, DayCycle } from "./deck-ambience";
import type { DayBlend } from "./deck-sky";
import { MINUTES_PER_DAY } from "./deck-sky";

export function phaseStripSets(strip: Behaviour<"phase-strip">, phases: DayCycle["phases"]) {
  return phases.map((phase) => {
    if (strip.byPhase[phase.id] !== undefined) return strip.byPhase[phase.id]!;
    let nearest = strip.frames.sprites, distance = Infinity;
    for (const candidate of phases) {
      const frames = strip.byPhase[candidate.id];
      if (frames === undefined) continue;
      const gap = Math.abs(phase.localMinute - candidate.localMinute);
      const circular = Math.min(gap, MINUTES_PER_DAY - gap);
      // Equal distances retain the first phase in dayCycle order.
      if (circular < distance) { nearest = frames; distance = circular; }
    }
    return nearest;
  });
}

/** Coalesce identical fallback sets so they never dim or draw twice during a fade. */
export function phaseStripWeights<T>(sets: readonly T[], blend: DayBlend): Map<T, number> {
  const weights = new Map<T, number>();
  for (const [index, weight] of [[blend.from, 1 - blend.t], [blend.to, blend.t]] as const) {
    const set = sets[index];
    if (set !== undefined) weights.set(set, (weights.get(set) ?? 0) + weight);
  }
  return weights;
}
