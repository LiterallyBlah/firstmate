/** Slice 1: bounded, one-step runs. No dispatch or authority acts live in this contract. */
import { z } from "zod";

export const PlanId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const line = z.string().min(1).max(1000).regex(/^[^\x00-\x1f()]+$/);
// Match launch.mjs's text contract, including opaque delivery modes and agent titles.
const launchText = (max: number, delimiters = true) => z.string().min(1).max(max)
  .refine(s => !!s.trim() && !/[\x00-\x1f\x7f]/.test(s) && (!delimiters || !/[()]/.test(s)));
export const PlanDependencySchema = z.object({
  node: PlanId, reason: z.enum(["builds-on", "needs-evidence", "decision", "shared-state"]),
  on: z.enum(["done", "landed", "answered"]).default("done"),
}).strict();
export const PlanLaunchSchema = z.object({
  id: PlanId, title: launchText(120), agentTitle: launchText(60, false), project: launchText(200), host: launchText(200),
  baseBranch: launchText(200), kind: z.enum(["ship", "scout"]), mode: launchText(200),
  brief: z.object({ file: z.string().regex(/^data\/[a-z0-9][a-z0-9-]{0,63}\/brief\.md$/) }).strict(),
  agent: z.object({ provider: z.string().regex(/^[\w-]+\/[^\s\x00-\x1f]+$/), modeId: launchText(100, false), thinkingOptionId: launchText(100, false).optional() }).strict(),
  backlog: z.object({ existing: z.enum(["none", "adopt"]), note: launchText(10000).optional(), tags: z.array(launchText(40).refine(s => !s.includes(","))).max(12).optional() }).strict(),
  dependency: z.object({ satisfiedBy: launchText(10000) }).strict().optional(),
  captainAuthority: z.object({ hold: launchText(10000), authority: launchText(10000) }).strict().optional(),
}).strict();
export type PlanLaunch = z.infer<typeof PlanLaunchSchema>;
const common = { id: PlanId, title: line.max(120), summary: z.string().min(1).max(5000), after: z.array(PlanDependencySchema).max(100).default([]) };
export const PlanNodeSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("run"), workflow: z.enum(["task@1", "scout@1"]), launch: PlanLaunchSchema }).strict(),
  z.object({ ...common, kind: z.literal("decision"), options: z.array(z.object({ id: PlanId, label: line, consequence: z.string().min(1).max(5000) }).strict()).min(2).max(12),
    recommendation: PlanId.nullable(), rationale: z.string().min(1).max(5000) }).strict(),
]);
export type PlanNode = z.infer<typeof PlanNodeSchema>;
export const PlanDefinitionSchema = z.object({
  format: z.literal("firstmate.plan/1"), id: PlanId, title: line.max(120),
  request: z.object({ text: z.string().min(1).max(20000), at: z.iso.datetime(),
    posture: z.enum(["review", "sail"]).optional(), quote: z.string().min(1).max(5000).optional() }).strict(),
  implicit: z.boolean().default(false), budget: z.object({ agents: z.number().int().min(1).max(100), turns: z.number().int().min(1).max(100) }).strict(),
  nodes: z.array(PlanNodeSchema).min(1).max(100),
}).strict();
export type PlanDefinition = z.infer<typeof PlanDefinitionSchema>;
export type NodeState = "planned" | "starting" | "running" | "done" | "landed" | "failed" | "cancelled" | "unresolved";
export interface PlanNodeState { state: NodeState; attempt?: string | undefined; claimed?: boolean | undefined; agentId?: string | undefined; workspaceId?: string | undefined; evidence?: string | undefined; briefHash?: string | undefined; answer?: string | undefined;
  launch?: PlanLaunch | undefined; held?: string | boolean | undefined; invalidated?: string | undefined;
  priorAttempts?: PlanNodeState[] | undefined; spent?: number | undefined; completedAt?: string | undefined }
export const PlanPostureSourceSchema = z.object({ posture: z.enum(["review", "sail"]), source: z.enum(["request", "standing-orders", "default"]), detail: z.string(), warning: z.string().optional() });
export type PlanPostureSource = z.infer<typeof PlanPostureSourceSchema>;
export interface WorkflowPlan {
  definition: PlanDefinition; revision: number; sequence: number; hash: string; posture: "review" | "sail";
  status: "review" | "active" | "held" | "abandoned"; approvedBudget: { agents: number; turns: number };
  nodes: Record<string, PlanNodeState>; told: string[]; handled: string[];
  history: { revision: number; at: string; by: string; reason: string }[];
  removed?: { node: PlanNode; state: PlanNodeState }[] | undefined;
  postureSource?: PlanPostureSource | undefined;
  captainEvents?: { id: string; action: string; text: string; node?: string | undefined; at: string; by?: string | undefined; notified?: boolean | undefined }[] | undefined;
}
/** Completion is a fold over durable node outcomes, never inferred from a worker's status line. */
export function planFinished(plan: WorkflowPlan): boolean {
  return plan.definition.nodes.every(node => !plan.nodes[node.id]?.invalidated &&
    (node.kind === "run" && node.launch.kind === "ship" ? ["landed", "failed", "cancelled"] : ["done", "landed", "failed", "cancelled"]).includes(plan.nodes[node.id]?.state ?? ""));
}
export const PlanEditSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("model"), node: PlanId, agent: PlanLaunchSchema.shape.agent }).strict(),
  z.object({ kind: z.literal("host"), node: PlanId, host: line }).strict(),
  z.object({ kind: z.literal("dependencies"), node: PlanId, after: z.array(PlanDependencySchema).max(100) }).strict(),
  z.object({ kind: z.literal("remove"), node: PlanId }).strict(),
  z.object({ kind: z.literal("posture"), posture: z.enum(["review", "sail"]) }).strict(),
]);
export const PlanCaptainCommandSchema = z.object({ op: z.literal("captain"), plan: PlanId, revision: z.number().int().positive(), subjectHash: z.string().length(64),
  action: z.enum(["approve", "edit", "changes", "hold", "decline", "answer"]), text: z.string().max(10000).default(""),
  edits: z.array(PlanEditSchema).max(100).optional(), node: PlanId.optional(), option: PlanId.optional(),
}).strict();
export type PlanCaptainCommand = z.infer<typeof PlanCaptainCommandSchema>;
export const WorkflowCommandSchema = z.discriminatedUnion("op", [
  PlanCaptainCommandSchema,
  z.object({ op: z.literal("notified"), plan: PlanId, eventId: z.uuid() }).strict(),
  z.object({ op: z.literal("plans"), all: z.boolean().optional() }).strict(),
  z.object({ op: z.literal("agenda") }).strict(),
  z.object({ op: z.literal("lint") }).strict(),
  z.object({ op: z.literal("show"), plan: PlanId }).strict(),
  z.object({ op: z.literal("retire"), plan: PlanId, expected: z.string().length(64), evidence: z.string().min(1).max(10000) }).strict(),
  z.object({ op: z.literal("draft"), definition: PlanDefinitionSchema }).strict(),
  z.object({ op: z.literal("revise"), definition: PlanDefinitionSchema, expected: z.string().length(64), reason: z.string().min(1).max(5000) }).strict(),
  z.object({ op: z.literal("start"), plan: PlanId, node: PlanId }).strict(),
  z.object({ op: z.literal("implicit"), launch: PlanLaunchSchema }).strict(),
  z.object({ op: z.literal("approve"), plan: PlanId, expected: z.string().length(64), quote: z.string().min(1).max(5000) }).strict(),
  z.object({ op: z.literal("release"), plan: PlanId, node: PlanId, attempt: z.uuid(), evidence: z.string().min(1).max(10000) }).strict(),
  z.object({ op: z.literal("invalidate"), plan: PlanId, node: PlanId, attempt: z.uuid(), evidence: z.string().min(1).max(10000) }).strict(),
  z.object({ op: z.literal("validate"), plan: PlanId, node: PlanId, attempt: z.uuid(), expected: z.string().length(64), evidence: z.string().min(1).max(10000) }).strict(),
  z.object({ op: z.literal("replace"), plan: PlanId, node: PlanId, attempt: z.uuid(), expected: z.string().length(64),
    kind: z.enum(["relaunch", "promote"]), evidence: z.string().min(1).max(10000), budget: z.object({ agents: z.number().int().min(1).max(100), turns: z.number().int().min(1).max(100) }).strict() }).strict(),
  z.object({ op: z.literal("claim"), plan: PlanId, node: PlanId, attempt: z.uuid(), briefHash: z.string().length(64), launch: PlanLaunchSchema }).strict(),
  z.object({ op: z.literal("record"), plan: PlanId, node: PlanId, state: z.enum(["running", "done", "landed", "failed", "cancelled", "unresolved"]),
    attempt: z.string().uuid(), evidence: z.string().min(1).max(10000), agentId: line.optional(), workspaceId: line.optional() }).strict(),
  z.object({ op: z.literal("ack"), plan: PlanId, ids: z.array(z.string().min(1).max(300)).min(1).max(100), kind: z.enum(["told", "handled"]) }).strict(),
]);
export type WorkflowCommand = z.infer<typeof WorkflowCommandSchema>;
export interface AgendaItem { id: string; priority: number; kind: "escalation" | "captain" | "replan" | "start" | "tell" | "books"; plan: string; node?: string; text: string; line?: string; section?: string }

/** References include other plans; cycles and duplicate task identities fail before publication. */
export function planProblems(plan: PlanDefinition, others: readonly WorkflowPlan[] = [], removed: ReadonlySet<string> = new Set()): string[] {
  const problems: string[] = [], nodes = new Map<string, PlanNode>();
  for (const p of [...others.filter(p => p.definition.id !== plan.id).map(p => p.definition), plan]) {
    for (const node of p.nodes) { if (nodes.has(node.id)) problems.push(`Duplicate node: ${node.id}`); nodes.set(node.id, node); }
  }
  if (plan.request.posture && !plan.request.quote) problems.push("A posture override needs the captain's quoted words.");
  if (plan.implicit && (plan.nodes.length !== 1 || plan.nodes[0]?.kind !== "run" || plan.nodes[0].id !== plan.id)) problems.push("An implicit plan is its one run's task id.");
  const runs = plan.nodes.filter(n => n.kind === "run").length;
  if (runs > plan.budget.agents || runs > plan.budget.turns) problems.push(`Worst case ${runs} agents / ${runs} turns exceeds the plan budget.`);
  for (const node of nodes.values()) {
    if (node.kind === "run") {
      if (node.launch.id !== node.id || node.launch.brief.file !== `data/${node.id}/brief.md`) problems.push(`${node.id}: launch and brief must name the node.`);
      if ((node.workflow === "scout@1") !== (node.launch.kind === "scout")) problems.push(`${node.id}: workflow and kind disagree.`);
    } else {
      if (new Set(node.options.map(o => o.id)).size !== node.options.length) problems.push(`${node.id}: duplicate options.`);
      if (node.recommendation && !node.options.some(o => o.id === node.recommendation)) problems.push(`${node.id}: unknown recommendation.`);
      const answered = others.some(p => !!p.nodes[node.id]?.answer);
      if (!answered && ![...nodes.values()].some(n => n.after.some(d => d.node === node.id))) problems.push(`${node.id}: no run needs this decision.`);
    }
    if (new Set(node.after.map(d => d.node)).size !== node.after.length) problems.push(`${node.id}: repeated dependency.`);
    for (const edge of node.after) {
      const target = nodes.get(edge.node);
      if (!target) { if (!removed.has(edge.node)) problems.push(`${node.id}: unknown dependency ${edge.node}.`); }
      else if ((target.kind === "decision") !== (edge.reason === "decision" && edge.on === "answered")) problems.push(`${node.id}: decision dependencies must say reason decision, on answered.`);
      else if (target.kind === "run" && edge.on === "answered") problems.push(`${node.id}: a run cannot be answered.`);
    }
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string) { if (visiting.has(id)) { problems.push(`Dependency cycle at ${id}.`); return; } if (visited.has(id)) return;
    visiting.add(id); for (const edge of nodes.get(id)?.after ?? []) visit(edge.node); visiting.delete(id); visited.add(id); }
  for (const id of nodes.keys()) visit(id);
  return problems;
}
export const planWorstCase = (p: PlanDefinition, states: Record<string, PlanNodeState> = {}) => {
  const n = p.nodes.filter(n => n.kind === "run").reduce((count, node) => {
    const s = states[node.id]; return count + Math.max(1, s?.spent ?? (s?.attempt ? 1 : 0)) + (s?.state === "planned" && !s.attempt && s.spent ? 1 : 0);
  }, 0); return { agents: n, turns: n };
};
export function planPosture(p: PlanDefinition): "review" | "sail" {
  return p.request.posture ?? (p.nodes.filter(n => n.kind === "run").length >= 2 || p.nodes.some(n => n.kind === "decision") ? "review" : "sail");
}
