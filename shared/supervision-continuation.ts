/** S04 unfinished-goal obligation for a scoped plan. Data only; no wake, watch or delivery.
 * An empty agenda is not success: every active delegated outcome keeps one of these dispositions.
 */
import { z } from "zod";
import { PlanId } from "./workflow-plans";
import { SupervisionActorSchema, SupervisionHash, SupervisionUtc, SupervisionUuid } from "./supervision";

export const ContinuationDisposition = z.enum([
  "ready-action", "needs-planning", "waiting", "blocked", "paused", "captain-decision", "completed",
]);
export type ContinuationDisposition = z.infer<typeof ContinuationDisposition>;
/** Dispositions an owner/captain may record as accounting for the obligation. Planning and ready
 * work are discharged only by committing a plan change or a start, never by a narrative record.
 */
export const RecordedDisposition = z.enum(["waiting", "blocked", "paused", "captain-decision", "completed"]);
export type RecordedDisposition = z.infer<typeof RecordedDisposition>;
export const ContinuationWaitSchema = z.object({
  kind: z.enum(["attempt", "effect", "decision", "dependency", "capacity", "hold", "prerequisite"]),
  id: z.string().min(1).max(256), detail: z.string().min(1).max(1024),
  /** Required for capacity/prerequisite waits: the bounded backoff after which the obligation is due again. */
  until: SupervisionUtc.optional(),
}).strict();
export type ContinuationWait = z.infer<typeof ContinuationWaitSchema>;
/** Evidence binding for accepted completion: the outcome fingerprint at acceptance. A later change
 * (invalidation, new run, revised graph) makes it inapplicable without erasing it.
 */
export const ContinuationCompletionSchema = z.object({
  evidence: z.string().min(1).max(4096), planHash: SupervisionHash, outcomeHash: SupervisionHash,
}).strict();
export const SupersededCompletionSchema = z.object({
  completion: ContinuationCompletionSchema, reason: z.string().min(1).max(1024), at: SupervisionUtc,
}).strict();
/** The owner's assessment at one semantic input generation, plus explicit outcome acceptance.
 * Its own writes and supervisor offer delivery are excluded from that generation.
 */
export const ContinuationSchema = z.object({
  id: SupervisionUuid, version: z.number().int().positive(), scopeId: SupervisionUuid, planId: PlanId,
  objectiveHash: SupervisionHash, inputVersion: SupervisionHash, epoch: z.number().int().positive(),
  disposition: RecordedDisposition, reason: z.string().min(1).max(1024),
  responsible: z.enum(["scope-owner", "captain"]), nextNodes: z.array(PlanId).max(100),
  waits: z.array(ContinuationWaitSchema).max(64),
  completion: ContinuationCompletionSchema.nullable(),
  superseded: z.array(SupersededCompletionSchema).max(64),
  provenance: SupervisionActorSchema, at: SupervisionUtc,
}).strict().refine(c => (c.disposition === "completed") === !!c.completion, "Completion needs evidence, and only completion carries it.");
export type Continuation = z.infer<typeof ContinuationSchema>;
