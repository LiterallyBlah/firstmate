/** Discrete wall-clock frames (`phase-frames@1`), independent of simulation time and fleet intensity. */
import type { Behaviour } from "./deck-ambience";

/** Hour 0–23 or minute 0–59, modulo the authored frame count. Invalid clocks and held motion use frame zero. */
export function phaseFrameAt(definition: Behaviour<"phase-frames">, minute: number | null, run = true): number {
  if (!run || minute === null || !Number.isFinite(minute)) return 0;
  const local = ((minute % 1440) + 1440) % 1440;
  const unit = definition.by === "local-hour" ? Math.floor(local / 60) : Math.floor(local % 60);
  return unit % definition.frames.length;
}
