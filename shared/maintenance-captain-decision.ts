/** Local structurally identical copy of Build C's scoped-captain-decision.ts (PR 165).
 * Presentation only. Reconcile the import after C lands; checked context/outbox stay in D. */
import { z } from "zod";
import { SupervisionHash } from "./supervision";
export const MaintenanceCaptainDecisionSchema = z.object({
  format: z.literal("firstmate.scoped-captain-decision/1"), homeId: z.string().min(1).max(1024),
  scope: z.object({ kind: z.enum(["general", "project", "plan", "maintenance"]), id: z.string().min(1).max(256) }).strict(),
  decisionId: z.string().min(1).max(256), revision: z.number().int().positive(), subjectHash: SupervisionHash,
  origin: z.object({ kind: z.enum(["plan", "project", "maintenance"]), id: z.string().min(1).max(256) }).strict(),
  title: z.string().min(1).max(1000), question: z.string().min(1).max(16000),
  options: z.array(z.object({ number: z.number().int().positive(), id: z.string().min(1).max(200), label: z.string().min(1).max(2000) }).strict()).min(1).max(32),
  recommendation: z.string().min(1).max(200).nullable(),
  evidence: z.array(z.object({ ref: z.string().min(1).max(1024), digest: SupervisionHash.nullable() }).strict()).min(1).max(256),
  projectIds: z.array(z.string().min(1).max(256)).max(64), permittedActions: z.array(z.literal("answer")).max(1),
}).strict().superRefine((d, ctx) => {
  if (d.options.some((o, i) => o.number !== i + 1) || new Set(d.options.map(o => o.id)).size !== d.options.length)
    ctx.addIssue({ code: "custom", message: "Options need unique identities and consecutive numbers starting at 1." });
  if (d.recommendation !== null && !d.options.some(o => o.id === d.recommendation))
    ctx.addIssue({ code: "custom", message: "Recommendation must name one displayed option." });
});
export type MaintenanceCaptainDecision = z.infer<typeof MaintenanceCaptainDecisionSchema>;
