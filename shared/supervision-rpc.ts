/** Frozen S02 read-only page for S05. Viewing never admits, offers, acknowledges or wakes a model. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { SupervisionHash, SupervisionUtc, SupervisionUuid } from "./supervision";
import { InboxAssignmentSchema, InboxEventSchema, InboxOfferSchema, InboxSourceSchema } from "./supervision-inbox";
const count = z.number().int().nonnegative();
export const SupervisionInboxStatusSchema = z.object({ format: z.literal("firstmate.supervision-inbox/1"), homeId: z.string(),
  scopeId: SupervisionUuid.nullable(), sequence: count, hash: SupervisionHash.nullable(), freshness: z.enum(["uninitialized", "current", "held"]),
  pageKind: z.enum(["events", "sources", "offers"]),
  observedAt: SupervisionUtc, offersEnabled: z.literal(false), deliverySupported: z.literal(false),
  problems: z.array(z.string()), counts: z.object({ pending: count, triage: count, quarantined: count, acknowledgedUnhandled: count, uncertainOffers: count, sourcesWithGaps: count, lowerBound: z.boolean() }).strict(),
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
