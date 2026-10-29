/** Shared wire contracts for the existing S03 command seam. No executor. */
import { z } from "zod";
import { SupervisionHash, SupervisionUuid, SupervisionVersionRefSchema } from "./supervision";
import { PlanId, WorkflowCommandSchema } from "./workflow-plans";
import { PlanRuleRefSchema } from "./plan-rules";
const count = z.number().int().nonnegative();
export const ScopedDependencySchema = z.object({ homeId: z.string().min(1), planId: PlanId, nodeId: PlanId,
  outcome: z.enum(["done", "landed", "answered"]), planHash: SupervisionHash, revision: count.min(1), attemptId: z.string().uuid().nullable() }).strict();
export const ScopedPlanCommandSchema = z.object({
  requestId: SupervisionUuid, homeId: z.string().min(1), scopeId: SupervisionUuid, epoch: count.min(1), scopeVersion: count.min(1),
  expectedPlanHash: SupervisionHash.nullable(), revision: count, subjectHash: SupervisionHash.nullable(),
  command: WorkflowCommandSchema, dependencyBindings: z.array(ScopedDependencySchema).max(100),
  policyVector: z.array(SupervisionVersionRefSchema).max(256), modelPolicyVector: z.array(SupervisionVersionRefSchema).max(256),
  evidenceVector: z.array(SupervisionVersionRefSchema).max(256), approvalId: SupervisionUuid.nullable(),
  head: z.string().regex(/^[0-9a-f]{40,64}$/).nullable(), artifactHash: SupervisionHash.nullable(), briefHash: SupervisionHash.nullable(),
  planRules: PlanRuleRefSchema.optional(),
}).strict();
export type ScopedPlanCommand = z.infer<typeof ScopedPlanCommandSchema>;
export const ScopedAnswerContextSchema = ScopedPlanCommandSchema.omit({ command: true, requestId: true }).extend({ decisionId: SupervisionUuid }).strict();
export const ScopedAnswerSchema = ScopedAnswerContextSchema.extend({ submissionId: SupervisionUuid, option: PlanId, text: z.string().max(10000) }).strict();
export type ScopedAnswer = z.infer<typeof ScopedAnswerSchema>;
