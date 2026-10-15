/** Engine-owned attention and the pack's one independently placed Converse target. No timers or scripts. */
import type { FleetCard } from "../shared/fleet";
import type { SettingManifest } from "../shared/deck-setting";
import type { DeckScene } from "./deck-scene";
import type { DeckFit, DeckHover } from "./deck-hover";

export type AttentionCarrier = NonNullable<SettingManifest["attentionCarrier"]>;

/** Blocked is the board's request for the captain; Ready and a failed job alone are not. */
export function needsResponse(card: FleetCard): boolean {
  return card.column === "blocked" || (card.agent?.pendingPermissions ?? card.remote?.worker?.pendingPermissions ?? 0) > 0;
}

/** Preserve the selected identity across polls and reordering; choose a deterministic successor if it leaves. */
export function attentionWorker(scene: DeckScene, selected?: string | null): string | null {
  const keys = scene.sailors.filter(sailor => sailor.asks && !sailor.stale).map(sailor => sailor.key).sort();
  return selected != null && keys.includes(selected) ? selected : keys[0] ?? null;
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
  return { key, action: "converse", x: fit.x + (at.x + carrier.size[0] / 2) * fit.scale, top: fit.y + at.y * fit.scale,
    bottom: fit.y + (at.y + carrier.size[1]) * fit.scale, ...size, floor: null };
}
