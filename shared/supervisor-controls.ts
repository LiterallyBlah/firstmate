import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { SupervisionBindingSchema, SupervisionHash, SupervisionUuid } from "./supervision";
import { SupervisorCatalogSchema, SupervisorConfigurationSchema, SupervisorProfileSchema, SupervisorReplacementInputSchema } from "./supervisor-profile";
const target = { requestId: SupervisionUuid, homeId: z.string(), scopeId: SupervisionUuid, expectedEpoch: z.number().int().positive(), bindingDigest: SupervisionHash.nullable(), planHash: SupervisionHash.nullable().optional() };
export const SupervisorControlInputSchema = z.discriminatedUnion("op", [
  z.object({ ...target, op: z.literal("stage"), profile: SupervisorProfileSchema, limits: SupervisorConfigurationSchema.shape.limits, policyDigest: SupervisionHash }).strict(),
  z.object({ ...target, op: z.literal("pause") }).strict(),
  z.object({ ...target, op: z.literal("resume"), expectedControlId: SupervisionUuid }).strict(),
  z.object({ ...target, op: z.literal("withdraw-proposal"), expectedControlId: SupervisionUuid, configurationDigest: SupervisionHash }).strict(),
  z.object({ ...target, op: z.literal("withdraw-input"), expectedControlId: SupervisionUuid, effectId: SupervisionUuid, effectVersion: z.number().int().positive() }).strict(),
  z.object({ ...target, op: z.literal("replace"), expectedControlId: SupervisionUuid, opening: z.string().trim().min(1).max(16000) }).strict(),
]);
export type SupervisorControlInput = z.infer<typeof SupervisorControlInputSchema>;
export const SupervisorViewSchema = z.object({ scopeId: SupervisionUuid, binding: SupervisionBindingSchema.nullable(), bindingDigest: SupervisionHash.nullable(), controlId: SupervisionUuid.nullable(),
  replacementResume: SupervisorReplacementInputSchema.nullable(), state: z.string(), configurations: z.array(SupervisorConfigurationSchema), pending: SupervisorConfigurationSchema.nullable(), sessions: z.number(), turns: z.number(),
  pendingDigest: SupervisionHash.nullable().default(null),
  reservedOwnerInputs: z.array(z.object({ id: SupervisionUuid, version: z.number().int().positive(), payloadDigest: SupervisionHash, preview: z.string().max(16000).nullable().optional(), truncated: z.boolean().optional() }).strict()).default([]),
  obligations: z.object({ uncertain: z.array(z.string()), reserved: z.array(z.string()), workers: z.array(z.string()), decisions: z.array(z.string()), sources: z.array(z.string()), unlanded: z.array(z.string()) }).strict(), retirement: z.string() }).strict();
export const SupervisorControlsSnapshotSchema = z.object({ homeId: z.string(), scopeId: SupervisionUuid, planHash: SupervisionHash.nullable(), title: z.string(),
  view: SupervisorViewSchema, catalog: SupervisorCatalogSchema, problems: z.array(z.string()), policyDigest: SupervisionHash,
  limits: SupervisorConfigurationSchema.shape.limits.nullable() }).strict();
export type SupervisorControlsSnapshot = z.infer<typeof SupervisorControlsSnapshotSchema>;
export const readSupervisorControls = defineRpc({ name: "firstmate.supervisor.controls.read", input: z.object({ homeId: z.string(), scopeId: SupervisionUuid }).strict(), output: SupervisorControlsSnapshotSchema });
/** App convention; input cannot assert an actor. No tool/CLI registration. */
export const actSupervisorControls = defineRpc({ name: "firstmate.supervisor.controls.act-ui", input: SupervisorControlInputSchema, output: SupervisorControlsSnapshotSchema });
