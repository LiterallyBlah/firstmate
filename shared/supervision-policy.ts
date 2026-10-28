/** S03's closed pilot vocabulary. No release operations or transport authority. */
import { z } from "zod";
import { PlanId } from "./workflow-plans";
import { SupervisionActorSchema, SupervisionHash, SupervisionUtc, SupervisionUuid, SupervisionVersionRefSchema } from "./supervision";

const version = z.number().int().positive();
const label = z.string().min(1).max(1024);
const ids = z.array(SupervisionUuid).min(1).max(64).refine(v => new Set(v).size === v.length);
export const PilotOperation = z.enum(["plan.start", "plan.review", "plan.stop", "plan.record", "decision.answer", "model.use"]);
export const PolicySourceSchema = z.object({
  id: SupervisionUuid, version, path: label, lineStart: version, lineEnd: version,
  fileHash: SupervisionHash, excerptHash: SupervisionHash,
  provenance: SupervisionActorSchema.refine(a => a.kind === "captain-ui" || a.kind === "mate-chat", "Explicit reviewed source required"),
  supersedes: z.array(SupervisionUuid).max(64),
}).strict().refine(s => s.lineEnd >= s.lineStart);
export const PolicyRuleSchema = z.object({
  id: SupervisionUuid, version, sources: z.array(SupervisionVersionRefSchema).min(1).max(64),
  selector: z.object({ scopeIds: ids, projectIds: ids, projectNames: z.record(SupervisionUuid, label), hostIds: z.array(label).min(1).max(64), planIds: z.array(PlanId).min(1).max(64) }).strict(),
  operations: z.array(PilotOperation).min(1).max(6), effect: z.enum(["allow", "deny"]),
  constraints: z.object({ models: z.array(label).max(32), profileDigests: z.array(SupervisionHash).max(32), requireApproval: z.boolean(),
    requireHead: z.boolean(), requireChecks: z.boolean(), independentReviews: z.number().int().min(0).max(16), requiredReviewIds: z.array(label).max(32),
    availability: z.enum(["always", "opus-unresponsive", "opus-quota"]),
  }).strict(), expiresAt: SupervisionUtc.nullable(), supersedes: z.array(SupervisionUuid).max(64),
}).strict();
export const PolicyEvidenceSchema = z.object({
  id: SupervisionUuid, version, scopeId: SupervisionUuid, subjectHash: SupervisionHash,
  head: z.string().regex(/^[0-9a-f]{40,64}$/).nullable(), artifactHash: SupervisionHash.nullable(),
  checks: z.enum(["passed", "failed", "unknown"]),
  reviews: z.array(z.object({ id: label, reviewerId: label, authorId: label,
    head: z.string().regex(/^[0-9a-f]{40,64}$/), outcome: z.enum(["accepted", "changes"]), sourceDigest: SupervisionHash }).strict()).max(32),
  availability: z.enum(["unknown", "opus-unresponsive", "opus-quota"]), sourceDigest: SupervisionHash,
}).strict();
export const PolicyOperationTargetSchema = z.object({
  nodeId: PlanId.nullable(), commandHash: SupervisionHash, briefHash: SupervisionHash.nullable(), dependencyHash: SupervisionHash,
}).strict();
export const PolicyApprovalSchema = z.object({
  id: SupervisionUuid, version: z.literal(1), scopeId: SupervisionUuid, planId: PlanId,
  operation: PilotOperation, revision: version, subjectHash: SupervisionHash,
  /** Absent only on retained pre-R03 approvals; never sufficient for a new admission. */
  operationTarget: PolicyOperationTargetSchema.optional(),
  head: z.string().regex(/^[0-9a-f]{40,64}$/).nullable(), artifactHash: SupervisionHash.nullable(),
  policyVector: z.array(SupervisionVersionRefSchema).min(1).max(256), evidenceVector: z.array(SupervisionVersionRefSchema).max(256),
  modelPolicyVector: z.array(SupervisionVersionRefSchema).max(256), profileDigest: SupervisionHash.nullable(),
  provenance: SupervisionActorSchema.refine(a => a.kind === "captain-ui" || a.kind === "mate-chat"), expiresAt: SupervisionUtc.nullable(),
}).strict();
export const ScopedDecisionSchema = z.object({
  id: SupervisionUuid, version, ownerScopeId: SupervisionUuid, planId: PlanId, nodeId: PlanId,
  revision: version, subjectHash: SupervisionHash, state: z.enum(["pending", "answered", "superseded"]),
  title: label, question: z.string().min(1).max(5000),
  options: z.array(z.object({ id: PlanId, label: z.string().min(1).max(1000) }).strict()).min(2).max(12),
  sourceVector: z.array(SupervisionVersionRefSchema).min(1).max(256),
  answer: z.object({ submissionId: SupervisionUuid, option: PlanId, text: z.string().max(10000), at: SupervisionUtc,
    provenance: SupervisionActorSchema, outboxId: SupervisionUuid }).strict().nullable(),
}).strict();
export const ScopedOutboxSchema = z.object({
  id: SupervisionUuid, version, ownerScopeId: SupervisionUuid, planId: PlanId,
  kind: z.enum(["plan.command", "decision.answer", "policy.hold", "legacy.fact"]), causationId: SupervisionUuid,
  subjectHash: SupervisionHash, decisionId: SupervisionUuid.nullable(), at: SupervisionUtc,
  state: z.enum(["pending", "handled"]), handledEpoch: version.nullable(), resultRef: label.nullable(),
}).strict();
export const OperationHoldSchema = z.object({
  id: SupervisionUuid, version, scopeId: SupervisionUuid, planId: PlanId,
  operations: z.array(PilotOperation).min(1).max(6), reason: label,
  sourceVector: z.array(SupervisionVersionRefSchema).min(1).max(256), state: z.enum(["held", "released"]),
}).strict();
/** Durable app request, retained before any provisioning effects are reserved. Context, never a grant. */
export const ProjectProvisionInputSchema = z.object({ homeId: z.string(), requestId: SupervisionUuid,
  projectId: SupervisionUuid, projectVersion: version }).strict();
export const ScopedCommandResultSchema = z.object({
  planId: PlanId.nullable(), planHash: SupervisionHash.nullable(), decisionId: SupervisionUuid.nullable(), outboxId: SupervisionUuid.nullable(),
  projectProvision: ProjectProvisionInputSchema.optional(),
  /** UI convention only. Kept in the immutable accepted command, never authentication evidence. */
  attachmentAudit: z.object({ at: SupervisionUtc, plan: PlanId, supervisor: SupervisionUuid,
    source: z.literal("client UI (unverified)"), authorization: z.literal("by convention, not verified"),
  }).strict().optional(),
  /** Only an explicit handled command can introduce these checked causal links. No replay defaults. */
  handling: z.object({ scopeId: SupervisionUuid, epoch: version,
    outboxes: z.array(z.object({ outboxId: SupervisionUuid, decisionId: SupervisionUuid.nullable(), causationId: SupervisionUuid }).strict()).min(1).max(100),
  }).strict().optional(),
}).strict();
export const AcceptedScopedCommandSchema = z.object({
  id: SupervisionUuid, version: z.literal(1), inputHash: SupervisionHash, actor: SupervisionActorSchema,
  result: ScopedCommandResultSchema,
}).strict();
export type PolicySource = z.infer<typeof PolicySourceSchema>;
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type PolicyEvidence = z.infer<typeof PolicyEvidenceSchema>;
export type PolicyApproval = z.infer<typeof PolicyApprovalSchema>;
export type PolicyOperationTarget = z.infer<typeof PolicyOperationTargetSchema>;
export type ScopedDecision = z.infer<typeof ScopedDecisionSchema>;
export type ScopedOutbox = z.infer<typeof ScopedOutboxSchema>;
export type OperationHold = z.infer<typeof OperationHoldSchema>;
export type ScopedCommandResult = z.infer<typeof ScopedCommandResultSchema>;
export type AcceptedScopedCommand = z.infer<typeof AcceptedScopedCommandSchema>;
export type VersionRef = z.infer<typeof SupervisionVersionRefSchema>;
export type PilotOperation = z.infer<typeof PilotOperation>;
