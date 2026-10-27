/** S07 history import and single-writer cutover records. Disabled by default: nothing in the
 * plugin arms the delivery gate or prepares a cutover without an explicit, separately approved call.
 * These are new migration records; they never fabricate an old acknowledgement or handled result.
 */
import { z } from "zod";
import { SupervisionHash, SupervisionUtc, SupervisionUuid } from "./supervision";
import { PlanId } from "./workflow-plans";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const version = count.min(1);
const text = (max = 1024) => z.string().min(1).max(max);
export const MIGRATION_COMPATIBILITY = 1;

/** Every plugin-owned legacy delivery path the cutover inventories. */
/** `send-claim` is a crashed send with no other disposition; `worker-callback` a legacy worker or launch whose
 * native finish notification still goes to its original creator. Both are holds until accounted. */
export const LegacyDeliverySource = z.enum(["plan-action", "config.mateNotes", "burst", "decision-submission", "watch-queue", "send-claim", "worker-callback"]);
/** Transport history only. `accepted` is never a handling acknowledgement. */
export const LegacyDeliveryState = z.enum(["queued", "offered", "accepted", "uncertain", "handled"]);
export const LegacyDeliveryRoute = z.enum(["transfer-fact", "drain-legacy", "hold", "already-handled"]);

export const LegacyDeliveryDispositionSchema = z.object({
  format: z.literal("firstmate.legacy-delivery-disposition/1"),
  id: SupervisionUuid, version, migrationId: SupervisionUuid, scopeId: SupervisionUuid, planId: PlanId,
  source: LegacyDeliverySource,
  /** Original identities exactly as the legacy records hold them; nothing invented for watch rows. */
  original: z.object({
    actionId: text(200).optional(), noteId: text(300).optional(), requestId: text(300).optional(),
    submissionId: text(300).optional(), messageId: text(400).optional(), revision: count.optional(),
    watch: z.object({ name: text(300), ran: text(64), kind: z.enum(["output", "failed"]) }).strict().optional(),
    claimItem: text(400).optional(), attemptId: text(64).optional(), agentId: text(300).optional(), launchFile: text(300).optional(),
  }).strict(),
  payloadHash: SupervisionHash,
  sourceTip: z.object({ sequence: count, hash: SupervisionHash }).strict(),
  /** How the target was found: an authoritative identity, or only a mention in opaque text. */
  resolution: z.object({ by: z.enum(["identity", "mention"]), plans: z.array(PlanId).max(64), unresolved: z.array(text(300)).max(64) }).strict(),
  originalOwner: text(300).nullable(), recipient: text(300).nullable(),
  observed: z.object({ notified: z.boolean().nullable(), handledKeys: z.array(text(400)).max(16), pendingKeys: z.array(text(400)).max(16),
    outcome: z.enum(["uncertain", "accepted", "failed"]).nullable() }).strict(),
  delivery: LegacyDeliveryState, claimId: SupervisionUuid.nullable(),
  /** Imperative content is never automatically replayed; only informational facts transfer. */
  imperative: z.boolean(),
  route: LegacyDeliveryRoute,
  reason: text(2000),
  destination: z.object({ scopeId: SupervisionUuid, consequenceId: SupervisionUuid, outboxId: SupervisionUuid.nullable() }).strict().nullable(),
  receipts: z.object({ send: text().nullable(), transfer: text().nullable(), ack: text().nullable() }).strict(),
  /** Compare-by-ID/payload removal of the old queue entry, after this disposition is durable. */
  removal: z.object({ state: z.enum(["pending", "removed", "absent", "mismatch", "drained", "not-queued"]), receipt: text().nullable() }).strict(),
  /** Explicit, separate resolution of a hold. Never a resend. */
  resolvedBy: z.object({ actor: text(300), evidenceRef: text(), evidenceDigest: SupervisionHash, previousRoute: LegacyDeliveryRoute }).strict().nullable(),
}).strict();
export type LegacyDeliveryDisposition = z.infer<typeof LegacyDeliveryDispositionSchema>;

export const MigrationReceiptSchema = z.object({
  format: z.literal("firstmate.migration-receipt/1"),
  id: SupervisionUuid, version, compatibility: z.literal(MIGRATION_COMPATIBILITY), homeId: text(),
  planId: PlanId, scopeId: SupervisionUuid, state: z.enum(["prepared", "barrier", "committed", "aborted"]),
  frozenAt: SupervisionUtc,
  /** The slice's separate gates, named by the evidence the operator supplied; none is checked here. */
  prerequisites: z.object({ inventory: text(), rollbackBuild: text(), policy: text() }).strict(),
  /** Exact legacy bytes: every event, tip and publication file of the plan, by name and SHA-256. */
  source: z.object({ tip: z.object({ sequence: count, hash: SupervisionHash }).strict(), sourceHash: SupervisionHash,
    files: z.array(z.object({ name: text(64), sha256: SupervisionHash }).strict()).max(3 * 100000) }).strict(),
  /** Immutable imported request/attempt index. Replay of an original request returns this receipt. */
  imported: z.object({ indexHash: SupervisionHash,
    requests: z.array(z.object({ requestId: text(64), requestHash: SupervisionHash, eventHash: SupervisionHash }).strict()),
    attempts: z.array(z.object({ node: PlanId, attempt: text(64), spent: count, agentId: text(300).nullable(), workspaceId: text(300).nullable() }).strict()),
    budget: z.object({ agents: count, turns: count }).strict(), handled: z.array(text(400)), told: z.array(text(400)),
    holds: z.array(z.object({ node: PlanId, held: text(4000) }).strict()) }).strict(),
  /** Read-only legacy facts the cutover depends on; recorded, not rewritten. */
  dependents: z.array(z.object({ plan: PlanId, node: PlanId, on: PlanId }).strict()).max(1000),
  launches: z.array(z.object({ node: PlanId, file: text(300), state: text(64), attempt: text(64).nullable() }).strict()).max(1000),
  inventory: z.object({ hash: SupervisionHash, dispositionIds: z.array(SupervisionUuid).max(200) }).strict(),
  /** Backlog/tag projection preimage; exports bind to it and never replace non-owned bytes. */
  projectionPreimage: z.object({ backlog: SupervisionHash.nullable(), itemTags: SupervisionHash.nullable() }).strict(),
  sidecars: z.object({ freeze: SupervisionHash, prepared: SupervisionHash.nullable(), committed: SupervisionHash.nullable() }).strict(),
  /** Checked before the freeze: journal sequence then, the whole migration's worst-case transactions, the ceiling. */
  capacity: z.object({ sequenceAtFreeze: count, transactionsNeeded: count, ceiling: count, preparedMutations: count, commitMutations: count }).strict(),
  /** A recorded release back to the legacy backend. Nothing is re-sent; removed entries are restored as they were. */
  aborted: z.object({ actor: text(300), reason: text(2000), restored: z.array(text(400)).max(200) }).strict().nullable(),
}).strict();
export type MigrationReceipt = z.infer<typeof MigrationReceiptSchema>;

/** Versioned compatibility sidecar under the legacy workflow store's `.scoped/<plan>/`. Each stage is
 * an exclusive, immutable file; none is an event in the original workflow chain.
 */
export const CutoverTokensSchema = z.object({
  plan: PlanId, nodes: z.array(PlanId).max(1000), actions: z.array(z.uuid()).max(10000), agents: z.array(text(300)).max(1000),
  tasks: z.array(z.object({ task: PlanId, host: text(300) }).strict()).max(1000),
}).strict();
export type CutoverTokens = z.infer<typeof CutoverTokensSchema>;
export const CutoverSidecarSchema = z.object({
  format: z.literal("firstmate.cutover-sidecar/1"), compatibility: z.literal(MIGRATION_COMPATIBILITY),
  stage: z.enum(["freeze", "prepared", "committed", "aborted"]), homeId: text(), planId: PlanId, migrationId: SupervisionUuid, scopeId: SupervisionUuid,
  at: SupervisionUtc, sourceHash: SupervisionHash, inventoryHash: SupervisionHash, tokens: CutoverTokensSchema,
  /** Scoped transaction this stage follows (prepared: the prepared commit; committed: the barrier). */
  transaction: SupervisionHash.nullable(), hash: SupervisionHash,
}).strict();
export type CutoverSidecar = z.infer<typeof CutoverSidecarSchema>;
