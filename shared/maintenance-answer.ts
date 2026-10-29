/** Checked maintenance transport context, independent of the shared presentation. */
import { z } from "zod";
import { SupervisionHash, SupervisionUuid } from "./supervision";
import { PlanId } from "./workflow-plans";

export const MaintenanceAnswerContextSchema = z.object({ homeId: z.string(), decisionId: SupervisionUuid,
  revision: z.number().int().min(1).max(1_000_000), subjectHash: SupervisionHash,
  evidence: z.array(z.object({ ref: z.string().min(1).max(1024), digest: SupervisionHash }).strict()).min(1).max(32) }).strict();
export const MaintenanceAnswerSchema = MaintenanceAnswerContextSchema.extend({ submissionId: SupervisionUuid, option: PlanId, text: z.string().max(10000) }).strict();
export type MaintenanceAnswer = z.infer<typeof MaintenanceAnswerSchema>;
