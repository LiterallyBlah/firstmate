/** Shared catalog contract. No provider defaults or full-access observer fallback. */
import { z } from "zod";
export const SupervisorProfileSchema = z.object({ provider: z.string().min(1).max(256), modeId: z.string().min(1).max(100),
  thinkingOptionId: z.string().min(1).max(100).optional() }).strict();
export type SupervisorProfile = z.infer<typeof SupervisorProfileSchema>;
export const SupervisorCatalogSchema = z.array(z.object({ provider: z.string(), label: z.string(),
  modes: z.array(z.object({ id: z.string(), label: z.string() }).strict()),
  thinking: z.array(z.object({ id: z.string(), label: z.string() }).strict()) }).strict()).max(1000);
export type SupervisorCatalog = z.infer<typeof SupervisorCatalogSchema>;
export function profileProblem(profile: SupervisorProfile | null, catalog: SupervisorCatalog, observer = false): string | null {
  const models = catalog.filter(m => m.provider === profile?.provider), model = models.length === 1 ? models[0] : null;
  if (!profile || !model) return "Choose one available provider/model on this host and workspace; refresh the catalog.";
  if (observer && (profile.modeId !== "read-only" || !model.modes.some(m => m.id === "read-only")))
    return "This profile has no qualified read-only mode. Independent observation is unavailable; full-access cannot replace it.";
  if (!profile.modeId || !model.modes.some(m => m.id === profile.modeId)) return "Choose an actual permission mode for this provider.";
  const thinking = model.thinking ?? [];
  if (thinking.length && (!profile.thinkingOptionId || !thinking.some(t => t.id === profile.thinkingOptionId)))
    return "Choose explicit reasoning offered by this model; an unresolved provider default is unavailable.";
  if (!thinking.length && profile.thinkingOptionId) return "This model offers no selectable reasoning setting.";
  return null;
}
const uuid = z.string().uuid(), hash = z.string().regex(/^[0-9a-f]{64}$/);
export const SupervisorConfigurationSchema = z.object({ id: uuid, scopeId: uuid, generation: z.number().int().positive(),
  requested: SupervisorProfileSchema, resolved: SupervisorProfileSchema, catalogDigest: hash, policyDigest: hash,
  workspace: z.object({ intentKey: z.string().min(1), directory: z.string().min(1) }).strict().optional(),
  target: z.object({ homeId: z.string(), hostId: z.literal("local"), scopeId: uuid, kind: z.enum(["plan", "project", "maintenance"]),
    planId: z.string().nullable(), planHash: hash.nullable() }).strict(),
  limits: z.object({ supervisorSessions: z.number().int().min(1).max(1000), supervisorTurns: z.number().int().min(1).max(100000) }).strict(),
  effectiveEpoch: z.number().int().positive(), provenance: z.enum(["client UI (unverified)", "first mate tool (unverified)"]) }).strict();
export type SupervisorConfiguration = z.infer<typeof SupervisorConfigurationSchema>;
export const SupervisorControlSchema = z.object({ id: uuid, scopeId: uuid, epoch: z.number().int().positive(),
  action: z.enum(["stage", "pause", "resume", "replace", "withdraw"]), predecessor: uuid.nullable(),
  configuration: SupervisorConfigurationSchema.optional() }).strict();

/** Original replacement review survives a lost app reply and a fresh client, including a hold-before-reserve crash. */
export const SupervisorReplacementInputSchema = z.object({ op: z.literal("replace"), requestId: uuid, homeId: z.string(), scopeId: uuid,
  expectedEpoch: z.number().int().positive(), bindingDigest: hash.nullable(), planHash: hash.nullable().optional(), expectedControlId: uuid,
  opening: z.string().trim().min(1).max(16000) }).strict();
export type SupervisorReplacementInput = z.infer<typeof SupervisorReplacementInputSchema>;
