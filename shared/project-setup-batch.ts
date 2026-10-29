/** App-only batch review. Each child retains the individual setup transport and guards. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { SupervisionHash, SupervisionUuid } from "./supervision";
import { ProjectSetupInputSchema } from "./supervision-policy";
import { ProjectSetupChoicesSchema, ProjectSetupPreviewSchema } from "./project-setup";

const identity = { homeId: z.string(), batchId: SupervisionUuid };
const capacity = z.object({ slots: z.number().int().positive(), generalHeadroom: z.number().int().positive(),
  occupied: z.number().int().nonnegative(), available: z.number().int().nonnegative() }).strict();
export const ProjectBatchManifestSchema = z.object({
  version: z.literal(1), ...identity, registryDigest: SupervisionHash, policyHash: SupervisionHash,
  children: z.array(ProjectSetupInputSchema).min(1).max(64),
  capacity,
}).strict().refine(m => new Set(m.children.map(c => c.review.projectId)).size === m.children.length &&
  new Set(m.children.map(c => c.requestId)).size === m.children.length && m.children.every(c =>
    c.homeId === m.homeId && c.review.homeId === m.homeId && c.review.registryDigest === m.registryDigest && c.review.policyHash === m.policyHash),
{ message: "Batch children must have distinct identities and the same reviewed home, registry and policy." });
export type ProjectBatchManifest = z.infer<typeof ProjectBatchManifestSchema>;
export const ProjectBatchCommitSchema = z.object({ manifest: ProjectBatchManifestSchema, reviewDigest: SupervisionHash }).strict();
export type ProjectBatchCommit = z.infer<typeof ProjectBatchCommitSchema>;
export const ProjectBatchPreviewSchema = z.object({ reviews: z.array(ProjectSetupPreviewSchema).max(64),
  commit: ProjectBatchCommitSchema.nullable(), reasons: z.array(z.string()),
  capacity: capacity.nullable(),
}).strict();
export type ProjectBatchPreview = z.infer<typeof ProjectBatchPreviewSchema>;
export const ProjectBatchStatusSchema = z.object({ commit: ProjectBatchCommitSchema,
  children: z.array(z.object({ requestId: SupervisionUuid, projectId: SupervisionUuid, name: z.string(),
    state: z.enum(["ready", "waiting", "needs-change", "checking", "cancelled"]), reason: z.string(),
    agentId: z.string().nullable(), sessions: z.number().int().nonnegative(), turns: z.number().int().nonnegative(),
    canContinue: z.boolean(), canCancel: z.boolean(),
  }).strict()).max(64), problems: z.array(z.string()),
}).strict();
export type ProjectBatchStatus = z.infer<typeof ProjectBatchStatusSchema>;
export const previewProjectBatch = defineRpc({ name: "firstmate.projects.batch.preview", input: z.object({ ...identity,
  choices: z.array(ProjectSetupChoicesSchema).min(1).max(64) }).strict(), output: ProjectBatchPreviewSchema });
export const commitProjectBatch = defineRpc({ name: "firstmate.projects.batch.commit", input: ProjectBatchCommitSchema, output: ProjectBatchStatusSchema });
export const readProjectBatches = defineRpc({ name: "firstmate.projects.batch.status", input: z.object({ homeId: z.string() }).strict(), output: z.array(ProjectBatchStatusSchema) });
export const continueProjectBatch = defineRpc({ name: "firstmate.projects.batch.continue", input: z.object(identity).strict(), output: ProjectBatchStatusSchema });
export const cancelProjectBatch = defineRpc({ name: "firstmate.projects.batch.cancel", input: z.object(identity).strict(), output: ProjectBatchStatusSchema });
