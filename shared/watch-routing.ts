import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const WatchNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/).refine((name) => !name.endsWith(".md"));
export const RoutingFields = {
  executionSession: z.enum(["current", "new"]),
  // Provider option IDs come from the current model's catalog, not a fixed cross-provider list.
  newSessionReasoning: z.string().min(1).max(80),
  notificationPolicy: z.enum(["actionable", "always", "never"]),
} as const;
function currentRules(value: { executionSession: string; newSessionReasoning: string; notificationPolicy: string }) {
  return value.executionSession !== "current" || (value.newSessionReasoning === "inherit" && value.notificationPolicy === "never");
}
export const WatchRoutingSchema = z.object(RoutingFields).strict().refine(currentRules, {
  message: "Current-session watches use inherited reasoning and no separate result notification.",
});
export type WatchRouting = z.infer<typeof WatchRoutingSchema>;
/** Definitions also carry name/brief/schedule; the public routing object contains only its fields. */
export function watchRouting(value: WatchRouting): WatchRouting {
  return { executionSession: value.executionSession, newSessionReasoning: value.newSessionReasoning, notificationPolicy: value.notificationPolicy };
}
export const CURRENT_ROUTING: WatchRouting = { executionSession: "current", newSessionReasoning: "inherit", notificationPolicy: "never" };
export const BOARD_REVIEW_ROUTING: WatchRouting = { executionSession: "new", newSessionReasoning: "medium", notificationPolicy: "actionable" };
export const ManagedWatchSchema = z.object({
  name: WatchNameSchema,
  schedule: z.string().min(1).max(120),
  prompt: z.string().trim().min(1).max(8000),
  enabled: z.boolean(),
  ...RoutingFields,
}).strict().refine(currentRules);
export type ManagedWatch = z.infer<typeof ManagedWatchSchema>;

export const InspectionResultSchema = z.object({
  version: z.literal(1),
  runId: z.string().uuid(),
  outcome: z.enum(["no-change", "actionable"]),
  summary: z.string().trim().min(1).max(1000),
  findings: z.array(z.object({
    kind: z.enum(["discrepancy", "stall", "decision"]),
    subject: z.string().min(1).max(200),
    evidence: z.string().min(1).max(2000),
    recommendation: z.string().min(1).max(1000),
  }).strict()).max(20),
}).strict().refine((result) => (result.outcome === "actionable") === (result.findings.length > 0), {
  message: "Actionable results require findings; no-change results must have none.",
});
export type InspectionResult = z.infer<typeof InspectionResultSchema>;

export const createWatch = defineRpc({
  name: "firstmate.watch.create", input: ManagedWatchSchema, output: z.object({}),
});
export const configureWatch = defineRpc({
  name: "firstmate.watch.configure",
  input: z.object({ name: WatchNameSchema, ...RoutingFields, schedule: z.string().min(1).max(120).optional(),
    prompt: z.string().trim().min(1).max(8000).optional(), enabled: z.boolean().optional() }).strict().refine(currentRules),
  output: z.object({}),
});
export const watchOptions = defineRpc({
  name: "firstmate.watch.options", input: z.object({}), output: z.object({
    available: z.boolean(), reason: z.string().nullable(),
    thinking: z.array(z.object({ id: z.string(), label: z.string() })),
    boardReview: ManagedWatchSchema,
  }),
});
export const watchHistory = defineRpc({
  name: "firstmate.watch.history", input: z.object({ name: WatchNameSchema }),
  output: z.object({ runs: z.array(z.object({ runId: z.string(), at: z.string(), status: z.string(),
    delivery: z.string(), cleanup: z.string(), report: z.string(), agentId: z.string().nullable() })) }),
});
