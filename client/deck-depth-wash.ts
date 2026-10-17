/** Opt-in colour blending over a tiled surface. No texture pixels are changed. */
import type { AmbientElement, DayCycle } from "./deck-ambience";
import type { DayBlend } from "./deck-sky";

export type DepthWash = NonNullable<AmbientElement<"tile">["behaviour"]["depthWash"]>;

export function depthWashAt(wash: DepthWash, phases: DayCycle["phases"], blend: DayBlend) {
  const clear = { colour: "#000000", alpha: [0, 0] };
  const from = wash.byPhase[phases[blend.from]?.id ?? ""] ?? clear;
  const to = wash.byPhase[phases[blend.to]?.id ?? ""] ?? clear;
  const a = Number.parseInt(from.colour.slice(1), 16), b = Number.parseInt(to.colour.slice(1), 16);
  let colour = 0;
  for (const shift of [16, 8, 0]) colour |= Math.round(((a >> shift) & 255) * (1 - blend.t) + ((b >> shift) & 255) * blend.t) << shift;
  return { colour, top: from.alpha[0]! * (1 - blend.t) + to.alpha[0]! * blend.t,
    bottom: from.alpha[1]! * (1 - blend.t) + to.alpha[1]! * blend.t };
}

export function depthWashAlpha(row: number, rows: readonly [number, number], top: number, bottom: number): number {
  const t = Math.max(0, Math.min(1, (row - rows[0]) / (rows[1] - rows[0])));
  return top + (bottom - top) * t * t * (3 - 2 * t);
}
