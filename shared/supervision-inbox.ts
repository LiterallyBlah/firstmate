/** S02 durable data only. No delivery, activation or authenticated caller contract. */
import { z } from "zod";
import { SupervisionEventSchema, SupervisionHash, SupervisionUtc, SupervisionUuid } from "./supervision";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), positive = count.min(1);
const text = (max = 256) => z.string().min(1).max(max);
const ids = z.array(SupervisionUuid).max(32).refine(a => new Set(a).size === a.length, "Repeated event");
export const InboxEventSchema = z.object({ id: SupervisionUuid, envelope: SupervisionEventSchema,
  consequenceKey: SupervisionHash, observationHash: SupervisionHash, critical: z.boolean(), version: z.literal(1) }).strict();
export const InboxResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no-action"), reason: text(1024), evidenceIds: z.array(SupervisionHash).min(1).max(32) }).strict(),
  z.object({ kind: z.literal("result"), effectIds: z.array(SupervisionUuid).min(1).max(32), evidenceIds: z.array(SupervisionHash).max(32) }).strict(),
]);
export const InboxAssignmentSchema = z.object({ id: SupervisionUuid, scopeId: SupervisionUuid.nullable(),
  attemptId: SupervisionUuid.nullable(),
  primaryEventId: SupervisionUuid, consequenceKey: SupervisionHash, resolverVersion: z.literal(1),
  reason: z.enum(["attempt-owner", "unknown-owner", "ambiguous-owner", "malformed", "duplicate"]),
  candidates: z.array(SupervisionUuid).max(64), ordinal: positive.nullable(),
  state: z.enum(["received", "assigned", "offered", "acknowledged", "handled", "superseded", "quarantined", "observed"]),
  offerId: SupervisionUuid.nullable(), epoch: positive.nullable(), result: InboxResultSchema.nullable(), version: positive }).strict();
/** S08 adds `pr`, `remote`, `board` and `watch` sources. Only `remote` names a non-local host and `pr`
 * names `github.com`; none of them has a cursor, so their coverage is never `bounded`. */
export const SOURCE_KINDS = ["hook", "catalog", "timeline", "pr", "remote", "board", "watch"] as const;
export const LOCAL_SOURCE_KINDS: readonly string[] = ["hook", "catalog", "timeline", "board", "watch"];
export const InboxSourceSchema = z.object({ id: SupervisionHash, kind: z.enum(SOURCE_KINDS),
  hostId: text(), agentId: text().nullable(), epoch: text().nullable(),
  cursor: z.object({ epoch: text(), seq: count }).strict().nullable(), maxSeq: count.nullable(),
  coverage: z.enum(["unknown", "gap", "bounded"]),
  gaps: z.array(z.enum(["boot", "hook-not-durable", "missing-turn", "empty-timeline", "fetch-failed", "page-gap", "epoch-changed", "reordered", "malformed", "queue-pressure",
    "no-cursor", "fingerprint-only", "content-collision", "outage", "clock-skew", "stale"])).max(16),
  observedAt: SupervisionUtc, version: positive,
  /** S08: the owning scope of a source with no agent (a bound pull request), for scoped status pages. */
  scopeId: SupervisionUuid.nullable().optional() }).strict();
export const InboxMailboxSchema = z.object({ id: SupervisionUuid, nextOrdinal: positive, watermark: count, version: positive }).strict();
export const InboxOfferSchema = z.object({ id: SupervisionUuid, scopeId: SupervisionUuid, epoch: positive,
  eventIds: ids.min(1), state: z.enum(["prepared", "accepted", "uncertain", "acknowledged", "retired"]),
  sends: count.max(3), createdAt: SupervisionUtc, lastAttemptAt: SupervisionUtc.nullable(),
  nextAttemptAt: SupervisionUtc.nullable(), reconciliationIds: z.array(SupervisionHash).max(32), version: positive }).strict();
export const InboxRequestSchema = z.object({ id: SupervisionUuid, inputHash: SupervisionHash, resultIds: z.array(text(1024)).max(64), version: z.literal(1) }).strict();
export type InboxEvent = z.infer<typeof InboxEventSchema>;
export type InboxAssignment = z.infer<typeof InboxAssignmentSchema>;
export type InboxSource = z.infer<typeof InboxSourceSchema>;
export type InboxMailbox = z.infer<typeof InboxMailboxSchema>;
export type InboxOffer = z.infer<typeof InboxOfferSchema>;
export type InboxResult = z.infer<typeof InboxResultSchema>;
export interface InboxProjection {
  events: InboxEvent[]; assignments: InboxAssignment[]; sources: InboxSource[];
  mailboxes: InboxMailbox[]; offers: InboxOffer[]; requests: z.infer<typeof InboxRequestSchema>[];
}
export const INBOX_LIMITS = { pending: 10_000, pageItems: 32, pageBytes: 24 * 1024, payloadBytes: 16 * 1024, sends: 3 } as const;
