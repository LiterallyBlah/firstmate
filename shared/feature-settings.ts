import type { SupervisionStatus } from "./supervision";
/** Server-owned feature policy. Display preferences are never execution authority.
 * Runtime enforcement is resolved by the server, independently of display preferences. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const home = z.string().min(1).max(32768);
export const FeatureCapabilitiesSchema = z.object({
  projectMates: z.boolean(), planSupervisors: z.boolean(), scopedActivation: z.boolean(),
  scopeUi: z.boolean(), scopeExecution: z.boolean(), maintenance: z.boolean(),
}).strict();
export type FeatureCapabilities = z.infer<typeof FeatureCapabilitiesSchema>;
export type FeatureCapability = keyof FeatureCapabilities;
export const FEATURE_CAPABILITIES = Object.keys(FeatureCapabilitiesSchema.shape) as FeatureCapability[];
export const FEATURES_OFF: Readonly<FeatureCapabilities> = Object.freeze({ projectMates: false,
  planSupervisors: false, scopedActivation: false, scopeUi: false, scopeExecution: false, maintenance: false });
export const FeatureCapacitySchema = z.object({ slots: count.min(2), generalHeadroom: count.min(1) }).strict()
  .refine(c => c.generalHeadroom < c.slots, "Keep at least one slot beyond FirstMate's reserved capacity.");
export type FeatureCapacity = z.infer<typeof FeatureCapacitySchema>;
/** Same supported limits as ProjectRuntime; a suggestion until explicitly saved. */
export const DEFAULT_FEATURE_CAPACITY: Readonly<FeatureCapacity> = Object.freeze({ slots: 4, generalHeadroom: 1 });
export const FeatureChangeSchema = z.object({ requested: FeatureCapabilitiesSchema, capacity: FeatureCapacitySchema }).strict();
export const FeatureSetInputSchema = z.object({ home, expectedRevision: count, requestId: z.uuid(), change: FeatureChangeSchema }).strict();
export type FeatureSetInput = z.infer<typeof FeatureSetInputSchema>;
export const FeaturePolicySchema = z.object({ format: z.literal("firstmate.feature-policy/1"), homeId: home,
  revision: count.min(1), requested: FeatureCapabilitiesSchema, capacity: FeatureCapacitySchema,
  updated: z.object({ kind: z.literal("plugin-ui-unverified"), source: z.literal("firstmate.features.set"),
    requestId: z.uuid(), at: z.iso.datetime() }).strict(),
}).strict();
export type FeaturePolicy = z.infer<typeof FeaturePolicySchema>;
export const FeatureSetResultSchema = z.object({ homeId: home, requestId: z.uuid(), policy: FeaturePolicySchema }).strict();
export type FeatureSetResult = z.infer<typeof FeatureSetResultSchema>;
export const FeaturePolicySnapshotSchema = z.object({ homeId: home, revision: count.nullable(),
  source: z.enum(["default", "legacy-environment", "saved"]), state: z.enum(["ready", "held"]),
  requested: FeatureCapabilitiesSchema, effective: FeatureCapabilitiesSchema, capacity: FeatureCapacitySchema.nullable(),
  policy: FeaturePolicySchema.nullable(), problems: z.array(z.string()),
  dependencyRefusals: z.array(z.object({ capability: z.enum(FEATURE_CAPABILITIES),
    code: z.enum(["POLICY_HELD", "RUNTIME_ENFORCEMENT_UNAVAILABLE", "DEPENDENCY_DISABLED"]), reason: z.string() }).strict()),
  /** The running server resolves dependencies and advertises its installed effect fences. */
  runtimeEnforced: z.boolean(), writesAvailable: z.boolean(),
}).strict();
export type FeaturePolicySnapshot = z.infer<typeof FeaturePolicySnapshotSchema>;
/** Counts describe only the listed coverage; incomplete/failed sources never imply an empty fleet. */
export const FeatureInventorySchema = z.object({ complete: z.literal(false),
  coverage: z.array(z.enum(["scoped-bindings", "scoped-effects"])), sequence: count.nullable(),
  active: count.nullable(), pending: count.nullable(), uncertain: count.nullable(), problems: z.array(z.string()),
}).strict();
export type FeatureInventory = z.infer<typeof FeatureInventorySchema>;
export const FeatureReadResultSchema = FeaturePolicySnapshotSchema.extend({ inventory: FeatureInventorySchema,
  pause: z.string().nullable().default(null) });
export type FeatureReadResult = z.infer<typeof FeatureReadResultSchema>;
export const readFeatureSettings = defineRpc({ name: "firstmate.features.read",
  input: z.object({ home }).strict(), output: FeatureReadResultSchema });
export const setFeatureSettings = defineRpc({ name: "firstmate.features.set",
  input: FeatureSetInputSchema, output: FeatureSetResultSchema });

/** A bounded count of retained scoped operations, never a complete fleet inventory. */
export function featurePause(status: SupervisionStatus, effective: FeatureCapabilities, kind?: string): string | null {
  const paused = status.effects.filter(e => ["reserved", "dispatching", "accepted", "uncertain"].includes(e.state)).filter(e => {
    const scope = status.scopes.find(s => s.id === e.scopeId);
    if (!scope || kind && scope.kind !== kind) return false;
    const receipt = status.commands.find(c => c.id === e.requestId);
    const capability = e.featurePolicy?.capability ?? (receipt?.result.attachmentAudit ? "scopedActivation" :
      receipt?.actor.source === "scope Send (unverified)" ? "scopeExecution" :
      scope.kind === "project" ? "projectMates" : scope.kind === "maintenance" ? "maintenance" : scope.kind === "plan" ? "planSupervisors" : null);
    return capability && (!effective[capability] || scope.kind === "project" && !effective.projectMates);
  });
  return paused.length ? `Paused for new work; checking ${paused.length} saved ${paused.length === 1 ? "operation" : "operations"}` : null;
}
