/** Read-only contextual handover review. The only mutation remains the existing S07 RPC. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { PlanId } from "./workflow-plans";
import { MigrationCommandSchema } from "./supervision-activation";
import type { HandoverEvidenceSchema } from "./supervision-activation";
export const PlanHelpReviewInputSchema = z.object({ homeId: z.string(), plan: PlanId, workflowHomeId: z.string().optional() }).strict();
export const PlanHelpReviewSchema = z.object({ homeId: z.string(), plan: PlanId, title: z.string(), planHash: z.string(), reviewHash: z.string(),
  currentOwner: z.string(), projectId: z.uuid().nullable(), scopeId: z.uuid(), migrationId: z.uuid(), supervisorId: z.uuid(),
  budget: z.object({ agents: z.number(), turns: z.number() }).strict(), spent: z.object({ agents: z.number(), turns: z.number() }).strict(),
  problems: z.array(z.string()), sourcePaths: z.array(z.string()), backupRevision: z.number().int().nonnegative(),
  preparation: MigrationCommandSchema.nullable(), canCorrectPreparation: z.boolean(),
}).strict();
export type PlanHelpReview = z.infer<typeof PlanHelpReviewSchema>;
export const readPlanHelp = defineRpc({ name: "firstmate.supervision.plan-help.read", input: PlanHelpReviewInputSchema, output: PlanHelpReviewSchema });
export const HandoverEvidenceInputSchema = PlanHelpReviewInputSchema.extend({ folder: z.string().max(1024).default("data"), rollbackPath: z.string().min(1).max(900).optional() }).strict();
export const HandoverEvidenceReviewSchema = z.object({ homeId: z.string(), plan: PlanId, reviewHash: z.string(), folder: z.string(),
  entries: z.array(z.object({ name: z.string(), path: z.string(), kind: z.enum(["dir", "file"]) }).strict()).max(200),
  inventory: z.object({ hash: z.string(), summary: z.array(z.string()), problems: z.array(z.string()) }).strict().nullable(),
  policy: z.object({ hash: z.string(), sources: z.array(z.object({ path: z.string(), lines: z.string(), content: z.string() }).strict()) }).strict().nullable(),
  rollback: z.object({ path: z.string(), hash: z.string(), content: z.string() }).strict().nullable(), problems: z.array(z.string()),
}).strict();
export type HandoverEvidenceReview = z.infer<typeof HandoverEvidenceReviewSchema>;
export const readHandoverEvidence = defineRpc({ name: "firstmate.supervision.plan-help.evidence", input: HandoverEvidenceInputSchema, output: HandoverEvidenceReviewSchema });
export function evidenceReferences(evidence: z.infer<typeof HandoverEvidenceSchema>) {
  return { inventory: `delivery-inventory:sha256:${evidence.inventory}`, policy: `accepted-permissions:sha256:${evidence.policy}`,
    rollbackBuild: `home:${evidence.rollback.path}#sha256:${evidence.rollback.hash}` };
}
