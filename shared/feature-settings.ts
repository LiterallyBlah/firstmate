/** Server-owned feature policy. Display preferences are never execution authority.
 * Slice 3 defines the contract; runtime enforcement is deliberately not installed. */
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
    code: z.enum(["POLICY_HELD", "RUNTIME_ENFORCEMENT_UNAVAILABLE"]), reason: z.string() }).strict()),
  /** Effective values are policy resolution only, never a claim of live runtime enforcement. */
  runtimeEnforced: z.literal(false), writesAvailable: z.literal(false),
}).strict();
export type FeaturePolicySnapshot = z.infer<typeof FeaturePolicySnapshotSchema>;
/** Counts describe only the listed coverage; incomplete/failed sources never imply an empty fleet. */
export const FeatureInventorySchema = z.object({ complete: z.literal(false),
  coverage: z.array(z.enum(["scoped-bindings", "scoped-effects"])), sequence: count.nullable(),
  active: count.nullable(), pending: count.nullable(), uncertain: count.nullable(), problems: z.array(z.string()),
}).strict();
export type FeatureInventory = z.infer<typeof FeatureInventorySchema>;
export const FeatureReadResultSchema = FeaturePolicySnapshotSchema.extend({ inventory: FeatureInventorySchema });
export const readFeatureSettings = defineRpc({ name: "firstmate.features.read",
  input: z.object({ home }).strict(), output: FeatureReadResultSchema });
export const setFeatureSettings = defineRpc({ name: "firstmate.features.set",
  input: FeatureSetInputSchema, output: FeatureSetResultSchema });
