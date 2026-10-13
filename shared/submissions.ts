/** Internal phase-0 contracts. No RPC or topics UI exposes these yet. */
import { z } from "zod";

export const SubmissionNamespaceSchema = z.object({ homeId: z.string().min(1), fleetId: z.string().min(1) }).strict();
export const SubmissionActorSchema = z.object({ agentId: z.string().min(1), generation: z.string().min(1) }).strict();
export const SubmissionPayloadSchema = z.object({
  ...SubmissionNamespaceSchema.shape,
  topicId: z.string().min(1).max(128),
  adviser: SubmissionActorSchema.nullable(),
  kind: z.enum(["outcome", "decision-answer", "answer"]),
  text: z.string().min(1).max(32000),
  links: z.array(z.string().min(1).max(1024)).max(100),
  replyTo: z.uuid().optional(),
  /** A correction, never cancellation of an instruction already sent. */
  corrects: z.uuid().optional(),
}).strict();
export type SubmissionPayload = z.infer<typeof SubmissionPayloadSchema>;
export type SubmissionNamespace = z.infer<typeof SubmissionNamespaceSchema>;
export type SubmissionActor = z.infer<typeof SubmissionActorSchema>;

export const SubmissionReceiptSchema = z.object({
  requestId: z.uuid(),
  actor: SubmissionActorSchema,
  disposition: z.enum(["accepted-intake", "needs-captain", "declined", "completed"]),
  note: z.string().max(8000),
  /** Evidence for individual effects; accepted intake alone never means effects completed. */
  actions: z.array(z.object({ id: z.string().min(1), state: z.enum(["pending", "completed"]), evidence: z.string() }).strict()).max(100),
}).strict();
export type SubmissionReceipt = z.infer<typeof SubmissionReceiptSchema>;

export const SubmissionRecordSchema = z.object({
  version: z.literal(1), id: z.uuid(), revision: z.number().int().nonnegative(),
  previous: z.string().nullable(),
  payload: SubmissionPayloadSchema, payloadHash: z.string(), createdAt: z.string(),
  transport: z.enum(["queued", "uncertain", "recorded"]),
  owner: SubmissionActorSchema.nullable(),
  attempts: z.array(z.object({ id: z.uuid(), actor: SubmissionActorSchema, messageId: z.string(), at: z.string() }).strict()),
  recorded: z.array(z.object({ attemptId: z.uuid(), evidence: z.string(), at: z.string() }).strict()),
  receipts: z.array(SubmissionReceiptSchema),
}).strict();
export type SubmissionRecord = z.infer<typeof SubmissionRecordSchema>;
