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
export const ContinuationWaitSchema = z.object({
  kind: z.enum(["attempt", "effect", "decision", "dependency", "capacity", "hold", "prerequisite"]),
  id: z.string().min(1).max(256), detail: z.string().min(1).max(1024),
}).strict();
export type ContinuationWait = z.infer<typeof ContinuationWaitSchema>;
/** The owner's assessment at one semantic input generation, plus explicit outcome acceptance.
 * Its own writes are excluded from that generation, so recording it cannot retrigger itself.
 */
export const ContinuationSchema = z.object({
  id: SupervisionUuid, version: z.number().int().positive(), scopeId: SupervisionUuid, planId: PlanId,
  objectiveHash: SupervisionHash, inputVersion: SupervisionHash, epoch: z.number().int().positive(),
  disposition: ContinuationDisposition, reason: z.string().min(1).max(1024),
  responsible: z.enum(["scope-owner", "captain"]), nextNodes: z.array(PlanId).max(100),
  waits: z.array(ContinuationWaitSchema).max(64),
  completion: z.object({ evidence: z.string().min(1).max(4096), planHash: SupervisionHash }).strict().nullable(),
  provenance: SupervisionActorSchema, at: SupervisionUtc,
}).strict().refine(c => (c.disposition === "completed") === !!c.completion, "Completion needs evidence, and only completion carries it.");
export type Continuation = z.infer<typeof ContinuationSchema>;
