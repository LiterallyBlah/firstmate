/** Captain decisions, separate from native attention and the timing observer. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const instant = z.number().int().nonnegative();
const revision = z.number().int().positive();
export const NeedsYouStateSchema = z.enum([
  "new",
  "seen",
  "snoozed",
  "answer-sent",
  "delivery-uncertain",
  "resolved",
]);
export type NeedsYouState = z.infer<typeof NeedsYouStateSchema>;

export const DecisionSourceSchema = z.object({
  key: z.string(),
  taskId: z.string(),
  hostId: z.string(),
  project: z.string().nullable(),
  title: z.string(),
  ask: z.string(),
  url: z.string().nullable(),
  reportPath: z.string().nullable(),
  /** Authored home-relative context; optional for ledgers written before these links existed. */
  specPath: z.string().nullable().optional(),
  notesPath: z.string().nullable().optional(),
  gateToken: z.string().nullable(),
  section: z.enum(["in-flight", "queued", "done"]),
  disposition: z.enum(["open", "parked", "in-hand", "done"]),
  blockedBy: z.string().nullable(),
});
export type DecisionSource = z.infer<typeof DecisionSourceSchema>;

export const QuarantinedTaskSchema = z.object({
  line: z.number().int().nonnegative(),
  taskId: z.string().nullable(),
  /** Only supplied when the complete scoped identity was safely read. */
  key: z.string().nullable(),
  hasHold: z.boolean(),
  problem: z.string(),
});
export type QuarantinedTask = z.infer<typeof QuarantinedTaskSchema>;
export function quarantinesSource(rows: readonly QuarantinedTask[], source: DecisionSource) {
  return rows.some((row) => row.key !== null ? row.key === source.key :
    row.taskId === null || row.taskId === source.taskId);
}

export const AnswerSubmissionSchema = z.object({
  submissionId: z.string().min(1).max(200),
  revision,
  outcome: z.enum(["uncertain", "accepted", "failed"]),
  recordedAt: instant,
  settledAt: instant.nullable(),
  previousState: z.enum(["new", "seen", "snoozed"]),
  previousSnoozedUntil: instant.nullable(),
  messageHash: z.string().optional(),
});
export const NeedsYouRequestSchema = z.object({
  id: z.string(),
  source: DecisionSourceSchema,
  generation: revision,
  revision,
  state: NeedsYouStateSchema,
  detectedAt: instant,
  updatedAt: instant,
  originalAsk: z.string(),
  /** Quiet baseline uses seen state without claiming a human acknowledgement. */
  baseline: z.boolean(),
  seenAt: instant.nullable(),
  seenRevision: revision.nullable(),
  snoozedUntil: instant.nullable(),
  submissions: z.array(AnswerSubmissionSchema),
  resolution: z
    .object({
      reason: z.enum(["answered", "completed", "deferred", "superseded"]),
      at: instant,
    })
    .nullable(),
});
export type NeedsYouRequest = z.infer<typeof NeedsYouRequestSchema>;

/** Server-bound options; a task-id prefix chooses display, never authorizes a send. */
export const DecisionAnswerOptionSchema = z.object({
  label: z.string(),
  prompt: z.string(),
  decision: z.object({
    homeId: z.string().min(1),
    requestId: z.string().min(1),
    recordRevision: revision,
    actionId: z.string().min(1).max(200),
  }),
});
export type DecisionAnswerOption = z.infer<typeof DecisionAnswerOptionSchema>;

export const NeedsYouFreshnessSchema = z.object({
  status: z.enum(["disabled", "unknown", "stale", "fresh"]),
  asOf: instant.nullable(),
  checkedAt: instant,
  problems: z.array(z.string()),
});
export const NeedsYouSnapshotSchema = z.object({
  homeId: z.string().nullable(),
  version: z.number().int().nonnegative(),
  /** null means unavailable, never a claim that the queue is empty. */
  actionCount: z.number().int().nonnegative().nullable(),
  newCount: z.number().int().nonnegative().nullable(),
  snoozedCount: z.number().int().nonnegative().nullable(),
  pendingAnswerCount: z.number().int().nonnegative().nullable(),
  freshness: NeedsYouFreshnessSchema,
  requests: z.array(NeedsYouRequestSchema),
  parked: z.array(DecisionSourceSchema),
  quarantined: z.array(QuarantinedTaskSchema).optional(),
  /** Rebuilt from current suggestions, never persisted in the ledger. Submit via needs-you.answer. */
  answerOptions: z.array(DecisionAnswerOptionSchema).optional(),
  delivery: z.literal("off"),
});
export type NeedsYouSnapshot = z.infer<typeof NeedsYouSnapshotSchema>;

export const NeedsYouTargetSchema = z.object({
  homeId: z.string().min(1),
  id: z.string().min(1),
  revision,
});
export type NeedsYouTarget = z.infer<typeof NeedsYouTargetSchema>;
/** Explicit or server-derived binding. Only a captain's revision-bound press authorizes a send. */
export const DecisionBindingSchema = z.object({
  homeId: z.string().min(1),
  requestId: z.string().min(1),
  recordRevision: revision,
  actionId: z.string().min(1).max(200),
});
export type DecisionBinding = z.infer<typeof DecisionBindingSchema>;
export const SubmitDecisionAnswerSchema = z.object({
  homeId: z.string().min(1),
  requestId: z.string().min(1),
  recordRevision: revision,
  submissionId: z.string().min(1).max(200),
  text: z.string().trim().min(1).max(32000),
  suggestion: z.object({ actionId: z.string().min(1), label: z.string() }).optional(),
});
export type SubmitDecisionAnswer = z.infer<typeof SubmitDecisionAnswerSchema>;
export const submitDecisionAnswer = defineRpc({
  name: "firstmate.needs-you.answer",
  input: SubmitDecisionAnswerSchema,
  output: z.object({ outcome: z.enum(["accepted", "uncertain", "failed"]), snapshot: NeedsYouSnapshotSchema }),
});
export const readNeedsYou = defineRpc({
  name: "firstmate.needs-you.read",
  input: z.object({}),
  output: NeedsYouSnapshotSchema,
});
export const markNeedsYouSeen = defineRpc({
  name: "firstmate.needs-you.seen",
  input: NeedsYouTargetSchema,
  output: NeedsYouSnapshotSchema,
});
export const markNeedsYouNew = defineRpc({
  name: "firstmate.needs-you.new",
  input: NeedsYouTargetSchema,
  output: NeedsYouSnapshotSchema,
});
export const snoozeNeedsYou = defineRpc({
  name: "firstmate.needs-you.snooze",
  input: NeedsYouTargetSchema.extend({ until: instant }),
  output: NeedsYouSnapshotSchema,
});
export const unsnoozeNeedsYou = defineRpc({
  name: "firstmate.needs-you.unsnooze",
  input: NeedsYouTargetSchema,
  output: NeedsYouSnapshotSchema,
});
/** Records a send outcome only. Does not send, approve, or modify authored records. */
export const recordNeedsYouAnswer = defineRpc({
  name: "firstmate.needs-you.record-answer",
  input: NeedsYouTargetSchema.extend({
    submissionId: z.string().min(1).max(200),
    outcome: z.enum(["uncertain", "accepted", "failed"]),
  }),
  output: NeedsYouSnapshotSchema,
});

/** Metadata only: no ask, title, project, URL, prompt, credentials or answer body. */
export const NeedsYouTransitionSchema = z.object({
  sequence: revision,
  eventId: z.string(),
  homeId: z.string(),
  requestId: z.string(),
  generation: revision,
  revision,
  kind: z.enum([
    "actionable",
    "updated",
    "seen",
    "marked-new",
    "snoozed",
    "snooze-due",
    "unsnoozed",
    "answer-pending",
    "answer-failed",
    "resolved",
  ]),
  occurredAt: instant,
});
export type NeedsYouTransition = z.infer<typeof NeedsYouTransitionSchema>;
