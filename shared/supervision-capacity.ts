/** Stored pressure replaces pilot sequence bands only in an explicitly upgraded home. */
import type { SupervisionStatus } from "./supervision";
export type CapacityBand = "sources" | "maintenance" | "admissions";
export function capacityHeld(status: SupervisionStatus, band: CapacityBand, pilotCeiling: number): boolean {
  return status.storage.capacity ? status.storage.capacity.held.includes(band) : status.sequence >= pilotCeiling;
}
