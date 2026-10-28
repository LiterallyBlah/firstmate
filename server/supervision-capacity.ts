import { z } from "zod";
import { SupervisionHash } from "../shared/supervision";
/** Immutable upgrade receipt. Pages retain the global chain; no archive, reset or eviction. */
export const CapacitySchema = z.object({ format: z.literal("firstmate.supervision-capacity/1"), homeId: z.string(),
  baseSequence: z.number().int().nonnegative(), baseHash: SupervisionHash.nullable(),
  pageSize: z.literal(256), journalBytes: z.number().int().min(1024 * 1024).max(2 ** 40),
  projectionBytes: z.number().int().min(1024 * 1024).max(2 ** 30),
  reserveBytes: z.number().int().min(65536), hash: SupervisionHash }).strict()
  .refine(p => p.reserveBytes * 4 < p.journalBytes, "Reserve must leave admission capacity");
export type Capacity = z.infer<typeof CapacitySchema>;
export const DEFAULT_CAPACITY = { pageSize: 256 as const, journalBytes: 1024 ** 3, projectionBytes: 64 * 1024 ** 2, reserveBytes: 16 * 1024 ** 2 };
export function pressure(capacity: Capacity, bytes: number, projectionBytes: number, obligations: number) {
  // Each admitted unresolved effect/migration retains 64 KiB for settlement in addition to the fixed tail.
  const reserve = capacity.reserveBytes + obligations * 65536;
  const available = capacity.journalBytes - bytes;
  const projectionReserve = 1024 * 1024 + obligations * 65536;
  const held = ( ["sources", "maintenance", "admissions"] as const).filter((_, i) =>
    available <= reserve * (3 - i) || projectionBytes >= capacity.projectionBytes * (0.7 + i * 0.1) ||
    capacity.projectionBytes - projectionBytes <= projectionReserve * (3 - i));
  return { mode: "paged" as const, pageSize: capacity.pageSize, reserveBytes: reserve, held: [...held] };
}
