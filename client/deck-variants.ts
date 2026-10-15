/**
 * The deck's weather layers (`extras.json`'s `variants`, `cycles` and `mood`, served by `firstmate.deck.extras`), as
 * pure functions: a curve's value at an intensity, and which layers can be drawn over what. The sprites are
 * `client/deck-environment.ts`'s; the moments of weather — lightning — are `client/deck-flash.ts`'s.
 *
 * Nothing here is about a storm. A setting's weather is data: each layer names what it lays over and an `opacity`
 * curve over the weather's intensity (`client/deck-atmosphere.ts`), and this draws whatever the data says. The heavy
 * weather (`art/ship-deck/storm/`) is the first such set: a rough sea over the sea, a heavy wake over the wake,
 * thunderheads over the clouds, an overcast in the sky's mood, and spindrift at the bow.
 *
 * - **A variant rides its element's clock.** It is a second set of frames over a scene element — the animated water's
 *   sea tile, foam strip or wake, a cycle, or a cloud — drawn on that element's own frame index, drift and place, so a
 *   cross-fade never shimmers out of step and there is no new clock. So it must have as many frames as the element and
 *   the element's frame size; one that does not line up is left out, and the element stands as it was (`drawnVariants`).
 * - **`over` or `crossfade`.** Opaque art (the sea) is drawn over the whole element, which is not drawn at all once the
 *   variant is; transparent art (a wake, a cloud) cross-fades, the element fading out as the variant comes in.
 * - **Each layer stands alone.** A variant, a cycle or an overlay whose image did not decode is left out by itself.
 * - **Never under reduced motion.** The scenery is handed no intensity on a still deck (`Weather.intensity`), and draws
 *   none of these. On a software renderer they show, each on its element's first frame, at their opacity.
 */
import type { DeckExtrasManifest } from "../shared/ship-deck";
import type { DeckExtrasImages } from "./deck-extras";
import type { DrawnWater } from "./deck-water";

export type Variant = NonNullable<DeckExtrasManifest["variants"]>[number];
export type Cycle = NonNullable<DeckExtrasManifest["cycles"]>[number];
export type MoodOverlay = NonNullable<DeckExtrasManifest["mood"]>["overlays"][number];

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

/** The weather layers that can be drawn, each with every image it needs decoded; variants only where they line up. */
export interface DrawnVariants {
  /** By what they lay over: `sea`, `foam`, `wake`, `cycle:<id>`, `cloud:<id>`, in the manifest's order. */
  variants: ReadonlyMap<string, readonly Variant[]>;
  cycles: readonly Cycle[];
  overlays: readonly MoodOverlay[];
  images: ReadonlyMap<string, unknown>;
}

/** What a variant can lay over: as many frames as it, of its size. */
interface Element {
  frames: number;
  frameSize: readonly [number, number];
}

const sameSize = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The extras' weather layers that can be drawn over `water`, the animated water drawn: each whose images decoded, and
 * each variant only over an element that is drawn, with as many frames of the same size. A cloud's variant needs its
 * masks cut too, which is `drawnClouds`'s to say; here it needs only its element. Null when there are none.
 */
export function drawnVariants(extras: DeckExtrasImages | null, water: DrawnWater | null): DrawnVariants | null {
  if (extras === null) return null;
  const { manifest, images } = extras;
  const has = (paths: readonly string[]) => paths.every((path) => images.has(path));
  const cycles = (manifest.cycles ?? []).filter((cycle) => has(cycle.frames));
  const overlays = (manifest.mood?.overlays ?? []).filter((overlay) => has([overlay.texture]));
  const elements = new Map<string, Element>();
  if (water?.sea) elements.set("sea", { frames: water.sea.frames.length, frameSize: water.sea.frameSize });
  if (water?.foam) elements.set("foam", { frames: water.foam.frames.length, frameSize: water.foam.frameSize });
  if (water?.wake) elements.set("wake", { frames: water.wake.frames.length, frameSize: water.wake.frameSize });
  for (const cycle of cycles) elements.set(`cycle:${cycle.id}`, { frames: cycle.frames.length, frameSize: cycle.frameSize });
  for (const cloud of manifest.clouds?.sprites ?? []) elements.set(`cloud:${cloud.id}`, { frames: 1, frameSize: cloud.size });
  const variants = new Map<string, Variant[]>();
  for (const variant of manifest.variants ?? []) {
    const element = elements.get(variant.variantOf);
    if (element === undefined || !has(variant.frames) || variant.frames.length !== element.frames || !sameSize(variant.frameSize, element.frameSize)) continue;
    variants.set(variant.variantOf, [...(variants.get(variant.variantOf) ?? []), variant]);
  }
  return variants.size === 0 && cycles.length === 0 && overlays.length === 0 ? null : { variants, cycles, overlays, images };
}

/** The variants laid over `element`, none if it has none. */
export function variantsOf(drawn: DrawnVariants | null, element: string): readonly Variant[] {
  return drawn?.variants.get(element) ?? [];
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

/** Which of a cycle's frames shows on the water's clock: in order every `frameMs`, looping, the first while the sea is still. */
export function cycleFrame(seconds: number, cycle: Pick<Cycle, "frames" | "frameMs">, moving: boolean): number {
  const count = cycle.frames.length;
  if (!moving || count <= 1 || !Number.isFinite(seconds)) return 0;
  const step = Math.floor((seconds * 1000) / cycle.frameMs) % count;
  return step < 0 ? step + count : step;
}
