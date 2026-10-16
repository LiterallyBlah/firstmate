/** Engine-owned attention and the pack's one independently placed suggestion target. No timers or scripts. */
import type { FleetCard } from "../shared/fleet";
import type { SettingManifest } from "../shared/deck-setting";
import type { DeckFit, DeckHover } from "./deck-hover";

export type AttentionCarrier = NonNullable<SettingManifest["attentionCarrier"]>;

/** Blocked is the board's request for the captain; Ready and a failed job alone are not. */
export function needsResponse(card: FleetCard): boolean {
  return card.column === "blocked" || (card.agent?.pendingPermissions ?? card.remote?.worker?.pendingPermissions ?? 0) > 0;
}

export function carrierAt(carrier: AttentionCarrier, ms: number, moving: boolean) {
  const phase = moving ? ms / carrier.loiter.periodMs * Math.PI * 2 : 0;
  return {
    x: carrier.at[0] + (moving ? Math.round(Math.sin(phase) * carrier.loiter.amplitude[0]) : 0),
    y: carrier.at[1] + (moving ? Math.round(Math.sin(phase * 2) * carrier.loiter.amplitude[1]) : 0),
    frame: moving ? Math.floor(ms / carrier.frameMs) % carrier.frames.length : 0,
  };
}

export function carrierHit(carrier: AttentionCarrier, at: { x: number; y: number }, point: { x: number; y: number }): boolean {
  return point.x >= at.x && point.x < at.x + carrier.size[0] && point.y >= at.y && point.y < at.y + carrier.size[1];
}

export function carrierHover(key: string, carrier: AttentionCarrier, at: { x: number; y: number }, fit: DeckFit, size: { width: number; height: number }): DeckHover {
  return { key, action: "attention", x: fit.x + (at.x + carrier.size[0] / 2) * fit.scale, top: fit.y + at.y * fit.scale,
    bottom: fit.y + (at.y + carrier.size[1]) * fit.scale, ...size, floor: null };
}
