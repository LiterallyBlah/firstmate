/** Read-only contextual handover review. The only mutation remains the existing S07 RPC. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { PlanId } from "./workflow-plans";
import { MigrationCommandSchema } from "./supervision-activation";
export const PlanHelpReviewInputSchema = z.object({ homeId: z.string(), plan: PlanId }).strict();
export const PlanHelpReviewSchema = z.object({ homeId: z.string(), plan: PlanId, title: z.string(), planHash: z.string(), reviewHash: z.string(),
  currentOwner: z.string(), projectId: z.uuid().nullable(), scopeId: z.uuid(), migrationId: z.uuid(), supervisorId: z.uuid(),
  budget: z.object({ agents: z.number(), turns: z.number() }).strict(), spent: z.object({ agents: z.number(), turns: z.number() }).strict(),
  problems: z.array(z.string()), sourcePaths: z.array(z.string()), backupRevision: z.number().int().nonnegative(),
  preparation: MigrationCommandSchema.nullable(),
}).strict();
export type PlanHelpReview = z.infer<typeof PlanHelpReviewSchema>;
export const readPlanHelp = defineRpc({ name: "firstmate.supervision.plan-help.read", input: PlanHelpReviewInputSchema, output: PlanHelpReviewSchema });
