import { z } from "zod";

export const DECISION_ANSWER_KIND = "firstmate-decision-answer";
export const decisionAnswerSummarySchema = z.object({
  homeId: z.string().min(1),
  requestId: z.string().min(1),
  recordRevision: z.number().int().positive(),
  title: z.string(),
  ask: z.string(),
  answer: z.string(),
  original: z.string(),
});
export type DecisionAnswerSummary = z.infer<typeof decisionAnswerSummarySchema>;

/** Only the plugin's complete, identified answer envelope is folded. Quoted/partial text stays visible. */
export function decisionAnswerSummary(
  text: string,
  messageId?: string,
): DecisionAnswerSummary | null {
  if (!messageId?.startsWith("firstmate-answer-")) return null;
  const match =
    /^<firstmate-decision-answer>\nThe captain explicitly submitted an answer to this recorded question\.\nDecision context \(JSON\): ([^\n]+)\n\nCaptain's answer:\n([\s\S]+)\n<\/firstmate-decision-answer>\n\nThis binds the answer to the recorded question, not to a verified PR head or report digest\. Review current material and keep the usual review checks\. Reconcile the backlog explicitly after acting; sending an answer alone does not prove the task is complete\.\n?$/.exec(
      text.replace(/\r\n/g, "\n"),
    );
  if (!match) return null;
  try {
    const context = z
      .object({
        homeId: z.string().min(1),
        id: z.string().min(1),
        revision: z.number().int().positive(),
        submissionId: z.string().min(1),
        task: z.string(),
        title: z.string().optional(),
        ask: z.string(),
      })
      .parse(JSON.parse(match[1]!));
    if (messageId !== `firstmate-answer-${context.submissionId}`) return null;
    return {
      homeId: context.homeId,
      requestId: context.id,
      recordRevision: context.revision,
      title: context.title ?? context.task,
      ask: context.ask,
      answer: match[2]!,
      original: text,
    };
  } catch {
    return null;
  }
}
