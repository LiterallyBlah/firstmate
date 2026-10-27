/** Scoped storage/status contracts. No transport or session activation is installed. */
import { z } from "zod";
import { PlanId, type WorkflowPlan } from "./workflow-plans";
import type { InboxProjection } from "./supervision-inbox";
import type { Continuation } from "./supervision-continuation";
import type { LegacyDeliveryDisposition, MigrationReceipt } from "./supervision-migration";
import type { AcceptedScopedCommand, OperationHold, PolicyApproval, PolicyEvidence, PolicyRule, PolicySource, ScopedDecision, ScopedOutbox } from "./supervision-policy";

export const SupervisionHash = z.string().length(64).regex(/^[0-9a-f]{64}$/);
export const SupervisionUuid = z.string().length(36).regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positive = count.min(1);
const text = (max = 256) => z.string().min(1).max(max);
const unique = <T extends z.ZodType>(schema: T, max: number) => z.array(schema).max(max)
  .refine(values => new Set(values).size === values.length, "Repeated identity");
/** Corrected S00 profile: ASCII UTC, years 0001–9999, real Gregorian dates, no leap seconds. */
export const SupervisionUtc = z.string().refine(value => {
  const match = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?Z(?![\s\S])/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year > 0 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}, "Expected a valid UTC calendar timestamp with seconds");
export const SupervisionVersionRefSchema = z.object({ kind: text(), id: text(1024), version: count, digest: SupervisionHash }).strict();
export const SupervisionScopeSchema = z.object({
  id: SupervisionUuid, homeId: text(1024), kind: z.enum(["general", "project", "plan", "maintenance"]),
  projectIds: unique(SupervisionUuid, 64), sponsorId: SupervisionUuid.nullable(), version: positive,
  mode: z.enum(["legacy", "scoped"]), state: z.enum(["dormant", "active", "held", "transferring", "retired"]),
}).strict();
/** S04 v1 extension (explicit, additive): `workspaceIntent` names a reserved workspace request;
 * `workspaceId` is only ever the verified Paseo workspace ID. It is null solely while a reserved
 * binding is unverified, and becomes non-null once, with prepared -> active, in the same epoch.
 */
export const SupervisionBindingSchema = z.object({
  scopeId: SupervisionUuid, epoch: positive, hostId: text(), agentId: text(), workspaceId: text().nullable(),
  workspaceIntent: text().optional(),
  profileDigest: SupervisionHash, state: z.enum(["prepared", "active", "suspect", "retired"]),
  checkpointHash: SupervisionHash, acknowledgedSeq: count, heartbeatDue: SupervisionUtc.nullable(),
  /** Exact owner observation, never inferred from send acceptance. Optional for old ledgers. */
  observation: z.object({ state: z.enum(["awake", "dormant", "unknown"]), at: SupervisionUtc }).strict().optional(),
  /** S05 discussion activation grants no work authority. Absent on historical S04 bindings. */
  purpose: z.enum(["discussion", "work"]).optional(),
}).strict().refine(b => b.workspaceId !== null || (b.workspaceIntent !== undefined && b.state !== "active"),
  "An unverified binding needs a workspace intent and cannot be active.");
export const SupervisionEffectSchema = z.object({
  id: SupervisionUuid, logicalKey: text(1024), requestId: SupervisionUuid, requestHash: SupervisionHash,
  scopeId: SupervisionUuid, epoch: positive, attemptId: SupervisionUuid.nullable(), operation: text(),
  planRevision: positive.nullable(), subjectHash: SupervisionHash,
  policyVector: z.array(SupervisionVersionRefSchema).max(256), evidenceVector: z.array(SupervisionVersionRefSchema).max(256),
  approvalId: SupervisionUuid.nullable(), resourceIds: unique(text(), 256),
  state: z.enum(["reserved", "dispatching", "accepted", "uncertain", "succeeded", "failed", "cancelled"]),
  receiverKey: text(1024).nullable(), receiptRef: text(1024).nullable(), version: positive,
  /** S04 v1 extension: immutable content-addressed bytes a send delivers. Never authority evidence. */
  payloadDigest: SupervisionHash.optional(),
  /** S04 v1 extension: the exact prerequisite outcomes admitted at reservation (S03 dependency
   * bindings, without the plan hash/revision snapshot), re-resolved at final dispatch admission. */
  dependencyBindings: z.array(z.object({ planId: PlanId, nodeId: PlanId, outcome: z.enum(["done", "landed", "answered"]),
    attemptId: SupervisionUuid.nullable() }).strict()).max(100).optional(),
}).strict();
export const SupervisionEventSchema = z.object({
  version: z.literal(1), eventId: SupervisionUuid,
  source: z.object({ kind: text(), hostId: text(), key: text(1024), epoch: text().nullable(), cursor: text(1024).nullable() }).strict(),
  observedAt: SupervisionUtc, occurredAt: SupervisionUtc.optional(),
  subject: z.object({ planId: text().optional(), taskId: SupervisionUuid.optional(), attemptId: SupervisionUuid.optional(),
    agentId: text().optional(), turnId: text().optional(), permissionId: text().optional(), repositoryId: text().optional(),
    pr: positive.optional(), head: z.string().min(40).max(64).regex(/^[0-9a-f]{40,64}$/).optional(), resourceId: text().optional() }).strict(),
  evidence: z.array(z.object({ ref: text(1024), digest: SupervisionHash, freshness: SupervisionUtc }).strict()).max(256),
  certainty: z.enum(["verified", "reported", "inferred", "unknown"]), causationId: text(1024).optional(), payloadRef: text(1024),
}).strict();
export const SupervisionCapabilitySchema = z.object({
  id: text(), publicSignature: text(1024), feature: text().nullable(),
  floor011: z.enum(["source-supported", "unsupported", "unqualified"]),
  proposal012: z.enum(["source-supported", "unsupported", "unqualified"]),
  disk013: z.enum(["source-supported", "unsupported", "unqualified"]), liveQualified: z.literal(false),
  condition: text(1024), missingResult: z.enum(["UNSUPPORTED", "HELD", "UNCERTAIN"]), sourceRefs: unique(text(1024), 32),
}).strict();
export const SupervisionContractSchema = z.discriminatedUnion("kind", [
  z.object({ format: z.literal("firstmate.supervision-contract/1"), kind: z.literal("Scope"), value: SupervisionScopeSchema }).strict(),
  z.object({ format: z.literal("firstmate.supervision-contract/1"), kind: z.literal("Binding"), value: SupervisionBindingSchema }).strict(),
  z.object({ format: z.literal("firstmate.supervision-contract/1"), kind: z.literal("Effect"), value: SupervisionEffectSchema }).strict(),
  z.object({ format: z.literal("firstmate.supervision-contract/1"), kind: z.literal("Event"), value: SupervisionEventSchema }).strict(),
  z.object({ format: z.literal("firstmate.supervision-contract/1"), kind: z.literal("CapabilityTable"),
    value: z.object({ version: z.literal(1), receiverIdentity: z.literal("not-inspected"), rows: z.array(SupervisionCapabilitySchema).max(64) }).strict() }).strict(),
  z.object({ format: z.literal("firstmate.supervision-contract/1"), kind: z.literal("Reply"), value: z.object({
    requestId: SupervisionUuid, status: z.enum(["committed", "refused", "uncertain"]),
    code: z.enum(["STALE", "HELD", "UNKNOWN_OWNER", "UNSUPPORTED", "UNCERTAIN", "CONFLICT"]).nullable(),
    receiptRef: text(1024).nullable(), version: count.nullable(), message: text(1024),
  }).strict() }).strict(),
]);
export const SupervisionTaskSchema = z.object({
  id: SupervisionUuid, ownerScopeId: SupervisionUuid, planId: PlanId, nodeId: PlanId, projectId: SupervisionUuid,
  hostId: text(), version: positive, currentAttempt: SupervisionUuid.nullable(),
}).strict();
export const SupervisionAttemptSchema = z.object({
  id: SupervisionUuid, taskId: SupervisionUuid, ordinal: positive, briefHash: SupervisionHash, launchEffectId: SupervisionUuid,
  worker: z.object({ hostId: text(), agentId: text(), workspaceId: text() }).strict().nullable(),
  originalNotificationOwner: text().nullable(), notificationStatus: z.enum(["known", "reported", "unknown"]),
  spentAgents: count, spentTurns: count, state: text(), evidenceIds: unique(SupervisionUuid, 256), version: positive,
}).strict();
/** Prepared/held always denies both writers. The only prepared -> active move is S07's committed migration. */
export const SupervisionBackendSchema = z.object({
  planId: PlanId, ownerScopeId: SupervisionUuid, backend: z.enum(["legacy", "scoped"]),
  state: z.enum(["active", "prepared", "held", "retired"]), sourceHash: SupervisionHash.nullable(), version: positive,
}).strict();
export const SupervisionRowKind = z.enum(["scope", "binding", "task", "attempt", "effect", "backend", "workflow", "retirement", "blob",
  "inbox-event", "inbox-assignment", "inbox-source", "inbox-mailbox", "inbox-offer", "inbox-request",
  "policy-source", "policy-rule", "policy-evidence", "approval", "decision", "outbox", "operation-hold", "command", "continuation",
  "migration", "delivery-disposition"]);
export const SupervisionExpectedSchema = z.object({ kind: SupervisionRowKind, id: text(1024), version: count }).strict();
export const SupervisionActorSchema = z.object({
  kind: z.enum(["captain-ui", "mate-chat", "agent", "system"]), id: text(), source: text(1024),
}).strict();
export type SupervisionScope = z.infer<typeof SupervisionScopeSchema>;
export type SupervisionBinding = z.infer<typeof SupervisionBindingSchema>;
export type SupervisionTask = z.infer<typeof SupervisionTaskSchema>;
export type SupervisionAttempt = z.infer<typeof SupervisionAttemptSchema>;
export type SupervisionEffect = z.infer<typeof SupervisionEffectSchema>;
export type SupervisionBackend = z.infer<typeof SupervisionBackendSchema>;
export type SupervisionExpected = z.infer<typeof SupervisionExpectedSchema>;
export type SupervisionActor = z.infer<typeof SupervisionActorSchema>;
export type SupervisionCode = "STALE" | "HELD" | "UNKNOWN_OWNER" | "UNSUPPORTED" | "UNCERTAIN" | "CONFLICT";
export interface SupervisionReceipt {
  requestId: string; requestHash: string; sequence: number; hash: string; generation: number;
  versions: SupervisionExpected[];
}
export interface SupervisionOwnership {
  scopes: string[]; tasks: SupervisionTask[]; attempts: SupervisionAttempt[]; effects: SupervisionEffect[];
  backends: SupervisionBackend[];
  workflows: { plan: string; inventory: { scopes: { node: string; host: string | null }[];
    attempts: { node: string; attempt: string; spent: number; agentId: string | null; workspaceId: string | null }[];
    budget: { agents: number; turns: number } } }[];
}
export interface SupervisionStatus {
  format: "firstmate.supervision-status/1"; homeId: string;
  freshness: "uninitialized" | "current" | "held"; sequence: number; hash: string | null;
  /** S01 has no admissions/effect adapter, even in a writable fixture store. */
  executable: false; guarantee: "cooperative-storage-only";
  limits: readonly string[]; problems: string[];
  storage: { bytes: number; limitBytes: number; admissionsHeld: boolean };
  versions: SupervisionExpected[]; scopes: SupervisionScope[]; bindings: SupervisionBinding[];
  tasks: SupervisionTask[]; attempts: SupervisionAttempt[]; effects: SupervisionEffect[]; backends: SupervisionBackend[];
  uncertainEffectIds: string[];
  policySources: PolicySource[]; policyRules: PolicyRule[]; policyEvidence: PolicyEvidence[]; approvals: PolicyApproval[];
  decisions: ScopedDecision[]; outbox: ScopedOutbox[]; operationHolds: OperationHold[]; commands: AcceptedScopedCommand[];
  plans: { scopeId: string; plan: WorkflowPlan }[];
  /** S04 unfinished-goal assessments; absent rows are derived as due, never as finished. */
  continuations: Continuation[];
  /** S07 cutover receipts and their legacy delivery inventory. Absent on fixtures that predate S07. */
  migrations?: MigrationReceipt[]; dispositions?: LegacyDeliveryDisposition[];
  retirements: { scopeId: string; plan: string; evidence: string; hash: string }[];
  retainedOwnership: SupervisionOwnership[];
  inbox: InboxProjection;
  index: { schema: 1; sequence: number; hash: string | null; taskOwners: Record<string, string>; effectKeys: Record<string, string> };
}
