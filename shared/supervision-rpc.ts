/** S02 read-only pages and separately gated S05 discussion/answer seams. Views never wake a model. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { SupervisionHash, SupervisionUtc, SupervisionUuid } from "./supervision";
import { InboxAssignmentSchema, InboxEventSchema, InboxOfferSchema, InboxSourceSchema } from "./supervision-inbox";
import { DiscussionRouteSchema, DiscussionTargetSchema } from "./scope-discussion";
import { ItemThreadSchema } from "./item-threads";
import { NeedsYouSnapshotSchema } from "./needs-you";
import { ScopedAnswerSchema } from "./scoped-commands";
const count = z.number().int().nonnegative();
export const SupervisionInboxStatusSchema = z.object({ format: z.literal("firstmate.supervision-inbox/1"), homeId: z.string(),
  scopeId: SupervisionUuid.nullable(), sequence: count, hash: SupervisionHash.nullable(), freshness: z.enum(["uninitialized", "current", "held"]),
  pageKind: z.enum(["events", "sources", "offers"]),
  observedAt: SupervisionUtc, offersEnabled: z.literal(false), deliverySupported: z.literal(false),
  problems: z.array(z.string()), counts: z.object({ pending: count, triage: count, quarantined: count, acknowledgedUnhandled: count, uncertainOffers: count, sourcesWithGaps: count, lowerBound: z.boolean(),
    /** S08: captain board messages whose send outcome is not known (reserved and unsettled, or uncertain). */
    unknownBoardSends: count.optional() }).strict(),
  oldestPendingAt: SupervisionUtc.nullable(), oldestPendingAgeMs: count.nullable(), admissionsHeld: z.boolean(),
  watermark: count.nullable(), nextAfter: count.nullable(), hasMore: z.boolean(),
  sources: z.array(InboxSourceSchema), offers: z.array(InboxOfferSchema),
  entries: z.array(z.object({ event: InboxEventSchema, disposition: InboxAssignmentSchema }).strict()).max(32),
}).strict();
export type SupervisionInboxStatus = z.infer<typeof SupervisionInboxStatusSchema>;
export const readSupervisionInbox = defineRpc({ name: "firstmate.supervision.inbox", input: z.object({
  pageKind: z.enum(["events", "sources", "offers"]).default("events"),
  scopeId: SupervisionUuid.optional(), after: count.default(0), limit: count.min(1).max(32).default(32),
}).strict(), output: SupervisionInboxStatusSchema });

export const ScopeGoalSchema = z.object({ scopeId: z.string(), planId: z.string(), title: z.string(), state: z.string(), owner: z.string().nullable(),
  ownerEpoch: count.nullable(), responsible: z.string(), next: z.string(), due: z.boolean(), activeWorkers: count, activeEffects: count,
  uncertainEffects: count, offers: z.object({ pending: count, uncertain: count }).strict(), evidenceAt: z.string().nullable(), evidenceAgeMs: count.nullable(), projectIds: z.array(z.string()),
  lastSupervisorFailure: z.object({ effectId: z.string(), epoch: count, reason: z.string().nullable() }).nullable() }).strict();
export const ScopeSummarySchema = z.object({ id: z.string(), title: z.string(), aliases: z.array(z.string()), kind: z.enum(["general", "project", "plan", "maintenance"]),
  planId: z.string().nullable(), discussionOnly: z.boolean(),
  target: DiscussionTargetSchema, hostId: z.string().nullable(), workspaceId: z.string().nullable(), state: z.string(), coverage: z.enum(["complete", "gaps", "unknown"]),
  session: z.enum(["not-created", "dormant", "awake", "unknown", "held"]), observedAt: z.string().nullable(),
  lastEffectFailure: z.object({ id: z.string(), operation: z.string(), reason: z.string().nullable() }).nullable(),
  goals: z.array(ScopeGoalSchema), activeWorkers: count, activeEffects: count, uncertainEffects: count }).strict();
export const ScopeSnapshotSchema = z.object({ homeId: z.string(), sequence: count, freshness: z.enum(["uninitialized", "current", "held"]), asOf: SupervisionUtc,
  uiEnabled: z.boolean(), executionEnabled: z.boolean(), problems: z.array(z.string()), scopes: z.array(ScopeSummarySchema),
  projects: z.array(z.object({ id: z.string(), name: z.string() }).strict()) }).strict();
export type ScopeSnapshot = z.infer<typeof ScopeSnapshotSchema>;
export type ScopeSummary = z.infer<typeof ScopeSummarySchema>;
export const readScopes = defineRpc({ name: "firstmate.scope.read", input: z.object({}).strict(), output: ScopeSnapshotSchema });
export const readScopeConversation = defineRpc({ name: "firstmate.scope.conversation", input: z.object({ homeId: z.string(), scopeId: z.string(), conversationId: z.string().min(1).max(200) }).strict(), output: ItemThreadSchema });
export const DiscussionResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("recorded"), thread: ItemThreadSchema }).strict(),
  z.object({ outcome: z.literal("refused"), code: z.string(), message: z.string() }).strict(),
  z.object({ outcome: z.literal("uncertain"), message: z.string() }).strict(),
]);
export type DiscussionResult = z.infer<typeof DiscussionResultSchema>;
export const discussScope = defineRpc({ name: "firstmate.scope.discuss", input: z.object({ id: SupervisionUuid, route: DiscussionRouteSchema, text: z.string().trim().min(1).max(16000),
  /** The unmodified composer input is re-resolved against current addresses before delivery. */
  addressedText: z.string().max(17000), defaultScope: z.string(), }).strict(), output: DiscussionResultSchema });
export const activateScope = defineRpc({ name: "firstmate.scope.activate", input: z.object({ requestId: SupervisionUuid, target: DiscussionTargetSchema,
  purpose: z.literal("discussion") }).strict(), output: z.object({ state: z.literal("unsupported"), reason: z.string() }).strict() });
/** Same shared Needs-you projection, including the existing scoped decision identities; never a new ledger. */
export const readScopeNeeds = defineRpc({ name: "firstmate.scope.needs", input: z.object({}).strict(), output: NeedsYouSnapshotSchema });
/** A thrown/uncertain response is never evidence of non-acceptance. Only a checked refusal releases retry. */
export const ScopedAnswerResultSchema = z.union([NeedsYouSnapshotSchema,
  z.object({ outcome: z.literal("refused"), code: z.string(), message: z.string() }).strict(),
  z.object({ outcome: z.literal("uncertain"), message: z.string() }).strict(),
]);
export const answerScopeDecision = defineRpc({ name: "firstmate.scope.answer", input: ScopedAnswerSchema, output: ScopedAnswerResultSchema });
