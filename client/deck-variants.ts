/**
 * The deck's weather layers (the setting pack's `variants` and `cycle`s, served by `firstmate.deck.setting`), as pure
 * functions: a curve's value at an intensity, how an element shares its place with its variants, and which frame of a
 * looping set shows. Which layers can be drawn over what is compiled with the rest of the ambience
 * (`client/deck-ambience.ts`); the sprites are `client/deck-environment.ts`'s, and the moments of weather —
 * lightning — `client/deck-flash.ts`'s.
 *
 * Nothing here is about a storm. A setting's weather is data: each layer names what it lays over and an `opacity`
 * curve over the weather's intensity (`client/deck-atmosphere.ts`), and this draws whatever the data says. The heavy
 * weather (`art/settings/ship/storm/`) is the first such set: a rough sea over the sea, a heavy wake over the wake,
 * thunderheads over the clouds, an overcast in the sky's mood, and spindrift at the bow.
 *
 * - **A variant rides its element's clock.** It is a second set of frames over a scene element — a tile (the sea), a
 *   strip (the foam), a cycle (the wake), or a drifter — drawn on that element's own frame index, drift and place, so a
 *   cross-fade never shimmers out of step and there is no new clock. So it must have as many frames as the element and
 *   the element's frame size; one that does not line up is left out, and the element stands as it was (`compileAmbience`).
 * - **`over` or `crossfade`.** Opaque art (the sea) is drawn over the whole element, which is not drawn at all once the
 *   variant is; transparent art (a wake, a cloud) cross-fades, the element fading out as the variant comes in.
 * - **Each layer stands alone.** A variant or a cycle whose image did not decode is left out by itself.
 * - **Never under reduced motion.** The scenery is handed no intensity on a still deck (`Weather.intensity`), and draws
 *   none of these. On a software renderer they show, each on its element's first frame, at their opacity.
 */
import type { Behaviour } from "./deck-ambience";

/** A variant over a tile, strip or cycle, as the pack writes it. */
export type Variant = NonNullable<Behaviour<"tile">["variants"]>[number];

/** A curve over the weather's intensity: [intensity, value] points, intensity rising. */
export type Curve = ReadonlyArray<readonly [number, number]>;

/** The curve's value at `intensity`: held past either end, eased between points (slowest at each, as the sky's fades). */
export function curveAt(curve: Curve, intensity: number): number {
  if (curve.length === 0) return 0;
  const at = Number.isFinite(intensity) ? intensity : 0;
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (at <= first[0]) return first[1];
  if (at >= last[0]) return last[1];
  let index = 1;
  while (index < curve.length - 1 && curve[index]![0] < at) index += 1;
  const [x0, y0] = curve[index - 1]!;
  const [x1, y1] = curve[index]!;
  const t = (at - x0) / (x1 - x0);
  return y0 + (y1 - y0) * t * t * (3 - 2 * t);
}

/** An opacity at `intensity` (null: a still deck, which draws no weather layer): the curve's, within 0 to 1. */
export function opacityAt(curve: Curve, intensity: number | null): number {
  return intensity === null ? 0 : Math.max(0, Math.min(1, curveAt(curve, intensity)));
}

/** A curve's highest value. */
export function curvePeak(curve: Curve): number {
  return curve.reduce((peak, [, value]) => Math.max(peak, value), 0);
}

/**
 * How much of an element shows under its variants at `intensity`, each variant's own opacity: the element fades as
 * a cross-faded variant comes in, and is not drawn at all once an `over` variant is wholly there.
 */
export function variantBlend(variants: readonly Pick<Variant, "blend" | "opacity">[], intensity: number | null): { base: number; layers: number[] } {
  const layers = variants.map((variant) => opacityAt(variant.opacity, intensity));
  let base = 1;
  variants.forEach(function (variant, index) {
    const alpha = layers[index]!;
    base = variant.blend === "crossfade" ? Math.min(base, 1 - alpha) : alpha >= 1 ? 0 : base;
  });
  return { base, layers };
}

/** Which of a looping set's frames shows `seconds` into its clock: in order every `frameMs`, the first while it is still. */
export function cycleFrame(seconds: number, cycle: { frames: readonly unknown[]; frameMs: number }, moving: boolean): number {
  const count = cycle.frames.length;
  if (!moving || count <= 1 || !Number.isFinite(seconds)) return 0;
  const step = Math.floor((seconds * 1000) / cycle.frameMs) % count;
  return step < 0 ? step + count : step;
}
