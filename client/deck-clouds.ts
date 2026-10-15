/**
 * Drifting sprites over a backdrop (`drifters@1`; the ship's clouds, `docs/ship-deck-art/clouds/README.md`), as pure
 * functions: which there are and where, how far each has drifted, and what colours the showing day gives them. No
 * Pixi and no browser globals (`client/deck-clouds.test.ts`); `client/deck-environment.ts` draws them, and
 * `client/deck-mount.ts` cuts each sprite into the masks below.
 *
 * - **In the backdrop's own pixels.** A drifter's row and its drift are in the pixels of the backdrop it drifts over
 *   (its `space`), and it is drawn with that backdrop's placement and scale (`backdropPlacement`), so it moves and
 *   grows with it through a resize and the camera's zoom, and never against it. The stage is in front of it, so a
 *   cloud can pass behind the masthead but never over the ship, crew or sea.
 * - **Lanes from the horizon up** (the pack's `lanes`). One drifter a lane, its bottom a seeded height within the
 *   lane above the backdrop's horizon row, its top never above `topMin`. A pane that fits the stage's height shows
 *   only the backdrop's lowest rows, so the lowest lanes are the ones always in view; a taller pane shows the higher
 *   ones too. Smaller sprites go lower and the larger higher, with a little chance either way, and a higher one
 *   drifts a little faster: a gentle parallax.
 * - **Wrapped whole, off screen.** A drifter moves right in whole pixels, from wholly left of the backdrop to wholly
 *   right of it and `margin` more, then starts again on the left. The backdrop is always at least as wide as what
 *   shows, so one never pops in or out in view. Its sprite and height stay the same on a wrap.
 * - **Seeded per opening.** The deck seeds the field from the clock when it starts, so the sky differs from one
 *   opening to the next; the same seed always gives the same sky.
 * - **Tinted per slot.** Each sprite is three exact colours — shadow, body, highlight — and each is recoloured to the
 *   same slot of the day phase's palette (`byPhase`, else `palette`), crossfaded with the day's own blend
 *   (`dayBlend`), so the ship's dawn warms its clouds and its night dims them blue. A white mask per slot, tinted,
 *   draws that with no shader.
 * - **Still when the deck is.** They drift only while their element runs (`elementMotion`), and their colours
 *   still follow the clock.
 * - **Variants over them** (a sprite's `variants`): a second sprite of the same size in the same container — the same
 *   lane, drift and wrap — in its own three colours by phase, cross-faded in by the weather (`client/deck-variants.ts`).
 *   The ship's heavy weather's thunderheads are these.
 * - **On their own clock.** The deck hands `cloudX` the drifters' `clock` (`client/deck-atmosphere.ts`), the ship's
 *   wind: it runs faster the more of the crew is working, without a jump when it changes.
 */
import type { Behaviour } from "./deck-ambience";
import { hashUnit } from "./deck-ambient";
import { scrollOffset, type DayBlend } from "./deck-sky";

export type Drifters = Behaviour<"drifters">;
export type DrifterSprite = Drifters["sprites"][number];
export type DrifterVariant = NonNullable<DrifterSprite["variants"]>[number];
/** A drifter's three white slot masks, as the mount cuts them: shadow, body, highlight. */
export type DrifterMasks = readonly [unknown, unknown, unknown];
/** Three colours, shadow to highlight, neutral and by day phase. */
export type DrifterPalette = Pick<Drifters, "palette" | "byPhase">;

/** A variant's colours, for `cloudColours`: its own, or its drifters' where it names none. */
export function variantPalette(variant: Pick<DrifterVariant, "palette" | "byPhase">, drifters: DrifterPalette): DrifterPalette {
  return { palette: variant.palette ?? drifters.palette, byPhase: variant.byPhase ?? drifters.byPhase };
}

/** One drifter: which sprite, the backdrop row of its top, where it starts in its lap, and how fast it drifts. */
export interface Cloud {
  /** Index into the drawn sprites. */
  sprite: number;
  row: number;
  /** Where in its lap it is at the scene's start: 0 to its period - 1. */
  offset: number;
  pixelsPerSecond: number;
}

/** A drifter's lap in backdrop pixels: across the backdrop, its own width and `margin` each side. */
export function cloudPeriod(skyWidth: number, spriteWidth: number, margin: number): number {
  return skyWidth + spriteWidth + margin * 2;
}

/**
 * The drifters for `seed` across a backdrop of `skyWidth` whose horizon is row `horizonRow`, in `field`'s lanes: one
 * a lane, lowest first. Sprites by width, smallest lowest, a lane's pick nudged at random and never the lane below's
 * twin; start points spread round the lap so they never march in a row.
 */
export function cloudField(
  seed: number,
  sprites: ReadonlyArray<Pick<DrifterSprite, "size" | "pxPerSecond">>,
  skyWidth: number,
  horizonRow: number,
  field: Pick<Drifters, "lanes" | "margin" | "topMin">,
): Cloud[] {
  if (sprites.length === 0) return [];
  const base = Number.isFinite(seed) ? Math.floor(Math.abs(seed)) % 1_000_003 : 0;
  const random = (lane: number, salt: number) => hashUnit(base * 131 + lane * 17 + salt);
  const bySize = sprites.map((_, index) => index).sort((a, b) => sprites[a]!.size[0] - sprites[b]!.size[0] || a - b);
  const lanes = field.lanes.length;
  // A shuffled slot round the lap for each lane.
  const slots = Array.from({ length: lanes }, (_, index) => index);
  for (let index = lanes - 1; index > 0; index -= 1) {
    const other = Math.floor(random(index, 1) * (index + 1));
    [slots[index], slots[other]] = [slots[other]!, slots[index]!];
  }
  const clouds: Cloud[] = [];
  let below = -1;
  field.lanes.forEach(function ([low, high], lane) {
    const share = lanes === 1 ? 0 : lane / (lanes - 1);
    let pick = Math.round(share * (bySize.length - 1) + (random(lane, 2) - 0.5) * 1.6);
    pick = Math.max(0, Math.min(bySize.length - 1, pick));
    if (bySize[pick] === below && bySize.length > 1) pick = pick === 0 ? 1 : pick - 1;
    const index = bySize[pick]!;
    below = index;
    const sprite = sprites[index]!;
    const [width, height] = sprite.size;
    const lift = low + random(lane, 3) * (high - low);
    const row = Math.max(field.topMin, Math.round(horizonRow - lift - height));
    const period = cloudPeriod(skyWidth, width, field.margin);
    const offset = Math.floor(((slots[lane]! + 0.15 + random(lane, 4) * 0.7) / lanes) * period) % period;
    const pixelsPerSecond = sprite.pxPerSecond * (0.85 + random(lane, 5) * 0.3) * (0.8 + share * 0.4);
    clouds.push({ sprite: index, row, offset, pixelsPerSecond });
  });
  return clouds;
}

/**
 * The backdrop column of a drifter's left edge `seconds` into its clock, in whole pixels: wholly left of the backdrop
 * at the start of its lap, wholly right of it and the margin at the end. Still (at its start) when not drifting.
 */
export function cloudX(cloud: Cloud, spriteWidth: number, skyWidth: number, margin: number, seconds: number, drifting: boolean): number {
  const period = cloudPeriod(skyWidth, spriteWidth, margin);
  const drift = drifting ? scrollOffset(seconds, cloud.pixelsPerSecond, period) : 0;
  return -spriteWidth - margin + ((cloud.offset + drift) % period);
}

/** `#RRGGBB` as a number. */
export function hexColour(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

function mix(from: number, to: number, t: number): number {
  let colour = 0;
  for (const shift of [16, 8, 0]) {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    colour |= Math.round(a + (b - a) * t) << shift;
  }
  return colour;
}

/**
 * Drifters' three colours, shadow to highlight, under the day `blend` of `phases`: each slot of the earlier phase's
 * palette crossfaded to the later one's by the blend's own `t`. A phase the pack gives no palette keeps the neutral
 * one.
 */
export function cloudColours(palettes: DrifterPalette, phases: ReadonlyArray<{ id: string }>, blend: DayBlend): [number, number, number] {
  const of = (index: number) => (palettes.byPhase[phases[index]?.id ?? ""] ?? palettes.palette).map(hexColour);
  const from = of(blend.from);
  const to = of(blend.to);
  const t = blend.to === blend.from ? 0 : Math.max(0, Math.min(1, blend.t));
  return [mix(from[0]!, to[0]!, t), mix(from[1]!, to[1]!, t), mix(from[2]!, to[2]!, t)];
}

/**
 * A sprite's RGBA pixels cut into three white masks, one a palette slot: every opaque pixel goes to the slot
 * whose colour is nearest its own (the sprites hold exactly the three, but a browser's decode may round),
 * and a transparent one to none. Tinted, the three draw the sprite in any three colours.
 */
export function cloudSlotMasks(pixels: ArrayLike<number>, palette: readonly string[]): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] {
  const colours = palette.slice(0, 3).map(hexColour);
  const masks: [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] = [
    new Uint8ClampedArray(pixels.length),
    new Uint8ClampedArray(pixels.length),
    new Uint8ClampedArray(pixels.length),
  ];
  for (let at = 0; at + 3 < pixels.length; at += 4) {
    if (pixels[at + 3]! < 128) continue;
    let slot = 0;
    let nearest = Infinity;
    colours.forEach(function (colour, index) {
      const distance =
        (pixels[at]! - ((colour >> 16) & 0xff)) ** 2 + (pixels[at + 1]! - ((colour >> 8) & 0xff)) ** 2 + (pixels[at + 2]! - (colour & 0xff)) ** 2;
      if (distance < nearest) {
        nearest = distance;
        slot = index;
      }
    });
    masks[slot]!.fill(255, at, at + 4);
  }
  return masks;
}
