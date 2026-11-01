/** Stage 1 contract only. Stage 2 owns reservation/delivery integration with WatchInspections.
 * This does not enable an observer or replace the inspection journal's spending authority. */
import { z } from "zod";
import { SupervisorProfileSchema, profileProblem, type SupervisorCatalog } from "./supervisor-profile";
export const SupervisorInspectionProfileSchema = z.object({ format: z.literal("firstmate.supervisor-inspection-profile/1"),
  homeId: z.string().min(1), hostId: z.literal("local"), watch: z.string().min(1).max(80), definitionDigest: z.string().regex(/^[0-9a-f]{64}$/),
  generation: z.number().int().positive(), profile: SupervisorProfileSchema.extend({ modeId: z.literal("read-only") }),
  catalogDigest: z.string().regex(/^[0-9a-f]{64}$/), limits: z.object({ sessions: z.number().int().min(1).max(1000), turns: z.number().int().min(1).max(100000) }).strict(),
  isolation: z.literal("independent-parentless-restricted-tools"), provenance: z.literal("client UI (unverified)") }).strict();
export function inspectionProfileAvailability(profile: z.infer<typeof SupervisorProfileSchema> | null, catalog: SupervisorCatalog) {
  const reason = profileProblem(profile, catalog, true);
  return { available: reason === null, reason, qualification: "catalog contract only; installed adapter qualification remains required" as const };
}
