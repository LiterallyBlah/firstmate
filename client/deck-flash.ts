/**
 * Moments of weather (the setting pack's `flash@1` elements): a sprite shown now and then for a fraction of a second —
 * the ship's heavy weather's distant lightning is the first — as pure functions: whether one is showing, which frame,
 * and where it stands. Seeded from the scene's clock as a flyby is (`flybysAt` in `client/deck-ambient.ts`), so the
 * same moment always looks the same, and drawn by `client/deck-environment.ts`.
 *
 * - **How often is data.** A flash's `perMinute` curve says how many a minute at the weather's intensity; time is cut
 *   into slots of a minute over `FLASH_CAP_PER_MINUTE`, and a slot has its flash when its seed falls under the rate's
 *   share of the cap, at a seeded point in the slot's first half. So however the data is tuned there are never more
 *   than the cap a minute, and two never come closer than half a slot.
 * - **Engine caps**: two frames, 3500 ms total (leaving at least four seconds dark between slots), opacity at most
 *   0.6, and never in lite or still. The renderer caps the opacity after multiplying the frame's share.
 *   The format permits one flash element so independent emitters cannot defeat the interval cap.
 * - **Under drifters** (`under`): it stands behind one in view, its anchor tucked under the drifter's underside, the
 *   wider the likelier, its lower edge at or above their backdrop's horizon, so the ship's fork comes out of a cloud and
 *   never meets the sea. None in view with room under it, no flash.
 */
import type { Behaviour } from "./deck-ambience";
import { hashUnit } from "./deck-ambient";
import { curveAt, type Curve } from "./deck-variants";

export type Flash = Behaviour<"flash">;

/** The most flashes of one kind a minute, whatever the data asks: one in each quarter of a minute. */
export const FLASH_CAP_PER_MINUTE = 4;

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
 * at the intensity, capped at `FLASH_CAP_PER_MINUTE`; each frame shows for its own `ms` at its `alpha`, then it is gone.
 */
export function flashAt(
  seconds: number,
  flash: { frames: ReadonlyArray<{ ms: number; alpha: number }>; perMinute: Curve },
  intensity: number,
  salt: number,
): FlashMoment | null {
  const ms = seconds * 1000;
  if (!Number.isFinite(ms) || ms < 0) return null;
  const rate = Math.max(0, Math.min(FLASH_CAP_PER_MINUTE, curveAt(flash.perMinute, intensity)));
  if (rate <= 0) return null;
  const slotMs = 60_000 / FLASH_CAP_PER_MINUTE;
  const frames = flash.frames.length > 2 ? flash.frames.slice(0, 2) : flash.frames;
  const duration = Math.min(3500, frames.reduce((sum, frame) => sum + frame.ms, 0));
  const slot = Math.floor(ms / slotMs);
  for (let k = slot; k >= Math.max(0, slot - 1); k -= 1) {
    if (hashUnit(k * 7 + salt) >= rate / FLASH_CAP_PER_MINUTE) continue;
    const age = ms - (k * slotMs + hashUnit(k * 11 + salt + 1) * (slotMs / 2));
    if (age < 0 || age >= duration) continue;
    let frame = 0;
    for (let ends = frames[0]!.ms; frame < frames.length - 1 && age >= ends; ) {
      frame += 1;
      ends += frames[frame]!.ms;
    }
    return { slot: k, frame, share: frames[frame]?.alpha ?? 1 };
  }
  return null;
}

/** A drifter where it is drawn, in its backdrop's pixels: its left column and top row, and its sprite's size. */
export interface CloudPlace {
  x: number;
  row: number;
  width: number;
  height: number;
}

/** How far into a drifter's underside a flash's anchor is tucked, in backdrop pixels: past the sprite's clear border. */
export const CLOUD_TUCK = 4;

/**
 * Where a flash of `slot` stands under a drifter, as its sprite's upper left in the backdrop's pixels: its anchor tucked
 * under the underside of one of `clouds` wholly within the backdrop's columns `view`, along the middle of it, the
 * wider likelier, and its lower edge at or above `horizonRow`. Null when none in view has room under it.
 */
export function underCloud(
  clouds: readonly CloudPlace[],
  slot: number,
  flash: Pick<Flash, "size" | "anchor">,
  horizonRow: number,
  view: { left: number; right: number },
  salt = 0,
): { x: number; y: number } | null {
  const height = flash.size[1];
  const [anchorX, anchorY] = flash.anchor;
  const top = (cloud: CloudPlace) => cloud.row + cloud.height - CLOUD_TUCK - anchorY;
  const candidates = clouds.filter((cloud) => cloud.x >= view.left && cloud.x + cloud.width <= view.right && top(cloud) + height <= horizonRow);
  if (candidates.length === 0) return null;
  let pick = hashUnit(slot * 5 + salt + 2) * candidates.reduce((sum, cloud) => sum + cloud.width, 0);
  const cloud = candidates.find((candidate) => (pick -= candidate.width) < 0) ?? candidates[candidates.length - 1]!;
  const along = Math.round(cloud.width * (0.3 + hashUnit(slot * 5 + salt + 3) * 0.4));
  return { x: cloud.x + along - anchorX, y: top(cloud) };
}
