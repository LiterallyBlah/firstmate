/**
 * Moments of weather (the setting pack's `flash` elements): a sprite shown now and then for a fraction of a second — the heavy
 * weather's distant lightning is the first — as pure functions: whether one is showing, which frame, and where it
 * stands. Seeded from the scene's clock as the gulls are (`gullsAt` in `client/deck-ambient.ts`), so the same moment
 * always looks the same, and drawn by `client/deck-environment.ts`.
 *
 * - **How often is data.** A flash's `perMinute` curve says how many a minute at the weather's intensity; time is cut
 *   into slots of a minute over `FLASH_CAP_PER_MINUTE`, and a slot has its flash when its seed falls under the rate's
 *   share of the cap, at a seeded point in the slot's first half. So however the data is tuned there are never more
 *   than the cap a minute, and two never come closer than half a slot.
 * - **Only while the sea moves.** Never under reduced motion, never on a software renderer (`MotionPlan.ambient`).
 * - **`under-cloud`** stands it behind a cloud in view: its anchor tucked under the cloud's underside, the wider the
 *   cloud the likelier, its lower edge at or above the sky's horizon, so the fork comes out of a cloud and never meets
 *   the sea. No cloud in view with room under it, no flash.
 */
import type { DeckExtrasManifest } from "./deck-legacy";
import { hashUnit } from "./deck-ambient";
import type { DeckExtrasImages } from "./deck-extras";
import { curveAt, type Curve } from "./deck-variants";

export type Flash = NonNullable<DeckExtrasManifest["flashes"]>[number];

/** The most flashes of one kind a minute, whatever the data asks: one in each quarter of a minute. */
export const FLASH_CAP_PER_MINUTE = 4;

/** The flashes whose every frame decoded. */
export function drawnFlashes(extras: DeckExtrasImages | null): Flash[] {
  return (extras?.manifest.flashes ?? []).filter((flash) => flash.frames.every((path) => extras!.images.has(path)));
}

/** A seed for a flash's id, so two kinds of flash are not seeded alike. */
export function flashSalt(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193) >>> 0;
  return hash % 1_000_003;
}

/** A flash showing: its slot (which seeds where it stands), its frame, and that frame's share of its opacity. */
export interface FlashMoment {
  slot: number;
  frame: number;
  share: number;
}

/**
 * The flash of `flash` showing `seconds` into the scene at `intensity`, if one is. Its rate is its `perMinute` curve
 * at the intensity, capped at `FLASH_CAP_PER_MINUTE`; each frame shows for its own `frameMs`, then it is gone.
 */
export function flashAt(
  seconds: number,
  flash: Pick<Flash, "frameMs" | "frameAlpha"> & { perMinute: Curve },
  intensity: number,
  salt: number,
): FlashMoment | null {
  const ms = seconds * 1000;
  if (!Number.isFinite(ms) || ms < 0) return null;
  const rate = Math.max(0, Math.min(FLASH_CAP_PER_MINUTE, curveAt(flash.perMinute, intensity)));
  if (rate <= 0) return null;
  const slotMs = 60_000 / FLASH_CAP_PER_MINUTE;
  const duration = flash.frameMs.reduce((sum, frameMs) => sum + frameMs, 0);
  const slot = Math.floor(ms / slotMs);
  for (let k = slot; k >= Math.max(0, slot - 1); k -= 1) {
    if (hashUnit(k * 7 + salt) >= rate / FLASH_CAP_PER_MINUTE) continue;
    const age = ms - (k * slotMs + hashUnit(k * 11 + salt + 1) * (slotMs / 2));
    if (age < 0 || age >= duration) continue;
    let frame = 0;
    for (let ends = flash.frameMs[0]!; frame < flash.frameMs.length - 1 && age >= ends; ends += flash.frameMs[frame + 1]!) frame += 1;
    return { slot: k, frame, share: flash.frameAlpha[frame] ?? 1 };
  }
  return null;
}

/** A cloud where it is drawn, in the sky's pixels: its left column and top row, and its sprite's size. */
export interface CloudPlace {
  x: number;
  row: number;
  width: number;
  height: number;
}

/** How far into a cloud's underside a flash's anchor is tucked, in sky pixels: past the sprite's clear border. */
export const CLOUD_TUCK = 4;

/**
 * Where a flash of `slot` stands under a cloud, as its sprite's upper left in the sky's pixels: its anchor tucked under
 * the underside of one of `clouds` wholly within the sky's columns `view`, along the middle of it, the wider clouds
 * likelier, and its lower edge at or above `horizonRow`. Null when no cloud in view has room under it.
 */
export function underCloud(
  clouds: readonly CloudPlace[],
  slot: number,
  flash: Pick<Flash, "frameSize" | "anchor">,
  horizonRow: number,
  view: { left: number; right: number },
  salt = 0,
): { x: number; y: number } | null {
  const height = flash.frameSize[1];
  const [anchorX, anchorY] = flash.anchor;
  const top = (cloud: CloudPlace) => cloud.row + cloud.height - CLOUD_TUCK - anchorY;
  const candidates = clouds.filter((cloud) => cloud.x >= view.left && cloud.x + cloud.width <= view.right && top(cloud) + height <= horizonRow);
  if (candidates.length === 0) return null;
  let pick = hashUnit(slot * 5 + salt + 2) * candidates.reduce((sum, cloud) => sum + cloud.width, 0);
  const cloud = candidates.find((candidate) => (pick -= candidate.width) < 0) ?? candidates[candidates.length - 1]!;
  const along = Math.round(cloud.width * (0.3 + hashUnit(slot * 5 + salt + 3) * 0.4));
  return { x: cloud.x + along - anchorX, y: top(cloud) };
}
