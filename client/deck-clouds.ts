/**
 * The sky's drifting clouds (`art/ship-deck/clouds/README.md`), as pure functions: which clouds there are and
 * where, how far each has drifted, and what colours the showing sky gives them. No Pixi and no browser
 * globals (`client/deck-clouds.test.ts`); `client/deck-environment.ts` draws them, and `client/deck-mount.ts`
 * cuts each sprite into the masks below.
 *
 * - **In the sky's own pixels.** A cloud's row and its drift are in the sky backdrop's pixels, and it is drawn
 *   with the backdrop's placement and scale (`skyPlacement`), so it moves and grows with the sky through a
 *   resize and the camera's zoom, and never against it. It sits behind the gull and the far sea, and the ship
 *   is in front of all of it, so a cloud can pass behind the masthead but never over the ship, crew or sea.
 * - **Lanes from the horizon up.** One cloud a lane, its bottom a seeded height above the sky's horizon row.
 *   A pane that fits the deck's height shows only the sky's lowest hundred rows or so, so the lowest lanes are
 *   the ones always in view; a taller pane shows the higher ones too. Smaller sprites go lower and the banks
 *   higher, with a little chance either way, and a higher cloud drifts a little faster: a gentle parallax.
 * - **Wrapped whole, off screen.** A cloud drifts right in whole sky pixels, from wholly left of the sky to
 *   wholly right of it and a margin more, then starts again on the left (the manifest's period). The sky is
 *   always at least as wide as what shows (`skyPlacement`), so a cloud never pops in or out in view. Its
 *   sprite and height stay the same on a wrap.
 * - **Seeded per opening.** The deck seeds the field from the clock when it starts, so the sky differs from one
 *   opening to the next; the same seed always gives the same sky.
 * - **Tinted per slot.** Each sprite is three exact colours — shadow, body, highlight — and each is recoloured to
 *   the same slot of the sky phase's palette, crossfaded with the sky's own blend (`skyBlend`), so dawn warms
 *   them, night dims them blue. A white mask per slot, tinted, draws that with no shader.
 * - **Still when the deck is.** They drift only while the sea scrolls (`MotionPlan.ambient`): not under reduced
 *   motion, not on a software renderer. Their colours still follow the clock.
 * - **Variants over them** (`extras.json`'s `variants`, `variantOf: "cloud:<id>"`): a second sprite of the same size in
 *   the same container — the same lane, drift and wrap — in its own three colours by sky phase, cross-faded in by the
 *   weather (`client/deck-variants.ts`). The heavy weather's thunderheads are these.
 * - **Faster in a fresher wind.** The deck hands `cloudX` the wind's own clock, not the scene's
 *   (`client/deck-atmosphere.ts`): it runs faster the more of the crew is working, without a jump when it changes.
 */
import type { DeckExtrasManifest, SkyPhaseId } from "../shared/ship-deck";
import { hashUnit } from "./deck-ambient";
import type { DeckExtrasImages } from "./deck-extras";
import type { Variant } from "./deck-variants";
import { scrollOffset, type SkyBlend } from "./deck-sky";

export type CloudManifest = NonNullable<DeckExtrasManifest["clouds"]>;
export type CloudSprite = CloudManifest["sprites"][number];

/** The clouds as the deck draws them: the manifest, and each drawable sprite's three slot masks, by texture. */
export interface CloudImages {
  manifest: CloudManifest;
  masks: ReadonlyMap<string, readonly [unknown, unknown, unknown]>;
  /**
   * The variants laid over each cloud (`client/deck-variants.ts`), by the cloud's id: each with its own palette and
   * stages, and its frame's three slot masks. Only a variant of the cloud's size whose masks were cut.
   */
  variants?: ReadonlyMap<string, ReadonlyArray<{ variant: Variant; masks: readonly [unknown, unknown, unknown] }>>;
}

/** The sprites that can be drawn: those whose masks were cut, and the variants over each that can be. Null when none can. */
export function drawnClouds(extras: DeckExtrasImages | null): CloudImages | null {
  const manifest = extras?.manifest.clouds;
  if (manifest === undefined || extras === null) return null;
  const masks = new Map<string, readonly [unknown, unknown, unknown]>();
  for (const sprite of manifest.sprites) {
    const cut = extras.cloudMasks?.get(sprite.texture);
    if (cut !== undefined) masks.set(sprite.texture, cut);
  }
  if (masks.size === 0) return null;
  const sprites = manifest.sprites.filter((sprite) => masks.has(sprite.texture));
  const variants = new Map<string, Array<{ variant: Variant; masks: readonly [unknown, unknown, unknown] }>>();
  for (const variant of extras.manifest.variants ?? []) {
    const cloud = sprites.find((sprite) => `cloud:${sprite.id}` === variant.variantOf);
    const cut = extras.cloudMasks?.get(variant.frames[0]!);
    if (cloud === undefined || cut === undefined || variant.frames.length !== 1 || cloud.size[0] !== variant.frameSize[0] || cloud.size[1] !== variant.frameSize[1]) continue;
    variants.set(cloud.id, [...(variants.get(cloud.id) ?? []), { variant, masks: cut }]);
  }
  return { manifest: { ...manifest, sprites }, masks, variants };
}

/** A cloud variant's palette and stages, for `cloudColours`: its own, or the clouds' where it names none. */
export function variantPalette(variant: Variant, clouds: Pick<CloudManifest, "palette" | "stages">): Pick<CloudManifest, "palette" | "stages"> {
  return { palette: variant.palette ?? clouds.palette, stages: variant.stages ?? clouds.stages };
}

/** Where each lane's cloud has its bottom: from and to, in sky pixels above the horizon row, lowest first. */
export const CLOUD_LANES: ReadonlyArray<readonly [number, number]> = [
  [30, 42],
  [46, 60],
  [64, 80],
  [88, 108],
  [116, 136],
  [144, 164],
  [170, 188],
];
/** How far past the sky's edges a cloud goes before it wraps, in sky pixels. */
export const CLOUD_MARGIN = 32;
/** The highest a cloud's top may be: this many rows below the sky's top edge. */
export const CLOUD_TOP_MIN = 6;

/** One cloud: which sprite, the sky row of its top, where it starts in its lap, and how fast it drifts. */
export interface Cloud {
  /** Index into the drawn sprites. */
  sprite: number;
  row: number;
  /** Where in its lap it is at the scene's start: 0 to its period - 1. */
  offset: number;
  pixelsPerSecond: number;
}

/** A cloud's lap in sky pixels: across the sky, its own width and a margin each side. */
export function cloudPeriod(skyWidth: number, spriteWidth: number): number {
  return skyWidth + spriteWidth + CLOUD_MARGIN * 2;
}

/**
 * The clouds for `seed` across a sky of `skyWidth` whose horizon is row `horizonRow`: one a lane, lowest first.
 * Sprites by width, smallest lowest, a lane's pick nudged at random and never the lane below's twin; start
 * points spread round the lap so the clouds never march in a row.
 */
export function cloudField(seed: number, sprites: readonly CloudSprite[], skyWidth: number, horizonRow: number): Cloud[] {
  if (sprites.length === 0) return [];
  const base = Number.isFinite(seed) ? Math.floor(Math.abs(seed)) % 1_000_003 : 0;
  const random = (lane: number, salt: number) => hashUnit(base * 131 + lane * 17 + salt);
  const bySize = sprites.map((_, index) => index).sort((a, b) => sprites[a]!.size[0] - sprites[b]!.size[0] || a - b);
  const lanes = CLOUD_LANES.length;
  // A shuffled slot round the lap for each lane.
  const slots = Array.from({ length: lanes }, (_, index) => index);
  for (let index = lanes - 1; index > 0; index -= 1) {
    const other = Math.floor(random(index, 1) * (index + 1));
    [slots[index], slots[other]] = [slots[other]!, slots[index]!];
  }
  const clouds: Cloud[] = [];
  let below = -1;
  CLOUD_LANES.forEach(function ([low, high], lane) {
    const share = lanes === 1 ? 0 : lane / (lanes - 1);
    let pick = Math.round(share * (bySize.length - 1) + (random(lane, 2) - 0.5) * 1.6);
    pick = Math.max(0, Math.min(bySize.length - 1, pick));
    if (bySize[pick] === below && bySize.length > 1) pick = pick === 0 ? 1 : pick - 1;
    const index = bySize[pick]!;
    below = index;
    const sprite = sprites[index]!;
    const [width, height] = sprite.size;
    const lift = low + random(lane, 3) * (high - low);
    const row = Math.max(CLOUD_TOP_MIN, Math.round(horizonRow - lift - height));
    const period = cloudPeriod(skyWidth, width);
    const offset = Math.floor(((slots[lane]! + 0.15 + random(lane, 4) * 0.7) / lanes) * period) % period;
    const pixelsPerSecond = sprite.pixelsPerSecond * (0.85 + random(lane, 5) * 0.3) * (0.8 + share * 0.4);
    clouds.push({ sprite: index, row, offset, pixelsPerSecond });
  });
  return clouds;
}

/**
 * The sky column of a cloud's left edge `seconds` into the scene, in whole pixels: wholly left of the sky at
 * the start of its lap, wholly right of it and the margin at the end. Still (at its start) when not drifting.
 */
export function cloudX(cloud: Cloud, spriteWidth: number, skyWidth: number, seconds: number, drifting: boolean): number {
  const period = cloudPeriod(skyWidth, spriteWidth);
  const drift = drifting ? scrollOffset(seconds, cloud.pixelsPerSecond, period) : 0;
  return -spriteWidth - CLOUD_MARGIN + ((cloud.offset + drift) % period);
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
 * The clouds' three colours, shadow to highlight, under the sky `blend`: each slot of the earlier phase's
 * palette crossfaded to the later one's by the blend's own `t`. A phase the manifest gives no palette keeps
 * the neutral one.
 */
export function cloudColours(
  clouds: Pick<CloudManifest, "palette" | "stages">,
  phases: ReadonlyArray<{ id: SkyPhaseId }>,
  blend: SkyBlend,
): [number, number, number] {
  const of = (index: number) => (clouds.stages[phases[index]?.id as SkyPhaseId] ?? clouds.palette).map(hexColour);
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
