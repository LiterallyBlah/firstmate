/** Dedicated app controls only; no MCP, CLI or home-tool attachment transport. RPC origin is unverified. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { SupervisionHash, SupervisionUuid } from "./supervision";
import { AgentProfileSchema } from "./supervision-effects";
import { ScopedCommandResultSchema } from "./supervision-policy";
import { MigrationReceiptSchema, LegacyDeliveryDispositionSchema } from "./supervision-migration";
import { PlanId } from "./workflow-plans";
export const ActivationSnapshotSchema = z.object({ pause: z.string().nullable().optional(), enabled: z.boolean(), operatorEnabled: z.boolean().optional(), homeId: z.string(), problems: z.array(z.string()),
  resumeMigrations: z.array(z.object({ migrationId: SupervisionUuid, plan: PlanId, scopeId: SupervisionUuid, projectId: SupervisionUuid,
    prerequisites: MigrationReceiptSchema.shape.prerequisites }).strict()).optional(),
  audits: z.array(ScopedCommandResultSchema.shape.attachmentAudit.unwrap()),
  plans: z.array(z.object({ plan: PlanId, title: z.string(), hash: SupervisionHash, scopeId: SupervisionUuid,
    scopeVersion: z.number().int().positive(), supervisorId: SupervisionUuid, canAttach: z.boolean(),
    binding: z.enum(["prepared", "active", "suspect", "retired"]).nullable(), opening: z.string().nullable(),
    /** Existing audited attachment only; no new identity or opening can be supplied on resume. */
    resumeRequestId: SupervisionUuid.nullable().optional(),
    readiness: z.object({ ready: z.boolean(), reasons: z.array(z.string()) }).strict().optional(),
  }).strict()), migrations: z.array(MigrationReceiptSchema), dispositions: z.array(LegacyDeliveryDispositionSchema),
}).strict();
export type ActivationSnapshot = z.infer<typeof ActivationSnapshotSchema>;
export const readSupervisionActivation = defineRpc({ name: "firstmate.supervision.activation", input: z.object({}).strict(), output: ActivationSnapshotSchema });
export const AttachSupervisorInputSchema = z.object({ homeId: z.string(), requestId: SupervisionUuid, plan: PlanId,
  planHash: SupervisionHash, scopeId: SupervisionUuid, scopeVersion: z.number().int().positive(),
  supervisorId: SupervisionUuid, profile: AgentProfileSchema, opening: z.string().trim().min(1).max(16000),
}).strict();
export type AttachSupervisorInput = z.infer<typeof AttachSupervisorInputSchema>;
export const ResumeSupervisorInputSchema = z.object({ homeId: z.string(), requestId: SupervisionUuid, resume: z.literal(true) }).strict();
export type ResumeSupervisorInput = z.infer<typeof ResumeSupervisorInputSchema>;
export const attachSupervisorFromUi = defineRpc({ name: "firstmate.supervision.attach-ui",
  input: z.union([AttachSupervisorInputSchema, ResumeSupervisorInputSchema]), output: ActivationSnapshotSchema });
const base = { homeId: z.string(), migrationId: SupervisionUuid };
export const HandoverEvidenceSchema = z.object({ inventory: SupervisionHash, policy: SupervisionHash,
  rollback: z.object({ path: z.string().min(1).max(900), hash: SupervisionHash }).strict() }).strict();
export const MigrationCommandSchema = z.discriminatedUnion("op", [
  z.object({ ...base, op: z.enum(["prepare", "resume"]), plan: PlanId, scopeId: SupervisionUuid, projectId: SupervisionUuid,
    prerequisites: MigrationReceiptSchema.shape.prerequisites,
    reviewHash: SupervisionHash.optional(),
    /** Explicitly supersede an unstarted guided review; frozen/accepted handovers cannot use it. */
    replacesReview: SupervisionHash.optional(), evidence: HandoverEvidenceSchema.optional() }).strict(),
  z.object({ ...base, op: z.enum(["reconcile", "barrier", "commit"]) }).strict(),
  z.object({ ...base, op: z.literal("abort"), reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ ...base, op: z.literal("resolve-hold"), dispositionId: SupervisionUuid, route: z.enum(["drain-legacy", "already-handled"]),
    evidence: z.object({ ref: z.string().min(1).max(1024), digest: SupervisionHash }).strict() }).strict(),
]);
export type MigrationCommand = z.infer<typeof MigrationCommandSchema>;
export const migrateSupervisionPlan = defineRpc({ name: "firstmate.supervision.migrate", input: MigrationCommandSchema, output: ActivationSnapshotSchema });
