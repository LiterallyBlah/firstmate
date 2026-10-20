/** Ownership survives a quarantined projection. None of these records grant dispatch authority. */
import { resolve } from "node:path";
import { z } from "zod";
import { PlanId, type PlanNode, type WorkflowPlan } from "../shared/workflow-plans";
import { digest } from "./submissions";

export const workflowHomeIdentity = (home: string) => process.platform === "win32" ? resolve(home).toLowerCase() : resolve(home);
export const ownershipScope = (node: PlanNode) => ({ node: node.id, host: node.kind === "run" ? node.launch.host.trim().toLowerCase() : "local" });
export const OwnershipSchema = z.object({
  scopes: z.array(z.object({ node: PlanId, host: z.string().min(1).nullable() }).strict()),
  attempts: z.array(z.object({ node: PlanId, attempt: z.uuid(), spent: z.number().int().nonnegative(), agentId: z.string().nullable(), workspaceId: z.string().nullable() }).strict()),
  budget: z.object({ agents: z.number().int().nonnegative(), turns: z.number().int().nonnegative() }).strict(),
}).strict();
export type WorkflowOwnership = z.infer<typeof OwnershipSchema>;
export function planOwnership(plan: WorkflowPlan): WorkflowOwnership {
  const nodes = [...plan.definition.nodes.map(node => ({ node, state: plan.nodes[node.id]! })), ...(plan.removed ?? [])];
  return { scopes: nodes.map(({ node }) => ownershipScope(node)), budget: plan.approvedBudget,
    attempts: nodes.flatMap(({ node, state }) => [...(state.priorAttempts ?? []), state].flatMap(s => s.attempt ? [{ node: node.id, attempt: s.attempt, spent: s.spent ?? 1, agentId: s.agentId ?? null, workspaceId: s.workspaceId ?? null }] : [])) };
}
export function mergeOwnership(records: WorkflowOwnership[]): WorkflowOwnership {
  const scopes = new Map<string, WorkflowOwnership["scopes"][number]>(), attempts = new Map<string, WorkflowOwnership["attempts"][number]>();
  const budget = { agents: 0, turns: 0 };
  for (const record of records) {
    for (const scope of record.scopes) scopes.set(JSON.stringify(scope), scope);
    for (const attempt of record.attempts) {
      const prior = attempts.get(attempt.attempt);
      attempts.set(attempt.attempt, { ...attempt, spent: Math.max(attempt.spent, prior?.spent ?? 0), agentId: attempt.agentId ?? prior?.agentId ?? null, workspaceId: attempt.workspaceId ?? prior?.workspaceId ?? null });
    }
    budget.agents = Math.max(budget.agents, record.budget.agents); budget.turns = Math.max(budget.turns, record.budget.turns);
  }
  return { scopes: [...scopes.values()], attempts: [...attempts.values()], budget };
}
const CapsuleSchema = z.object({ version: z.literal(1), home: z.string(), plan: PlanId, eventHash: z.string().length(64), inventory: OwnershipSchema, hash: z.string().length(64) }).strict();
export function ownershipCapsule(home: string, plan: WorkflowPlan) {
  const body = { version: 1 as const, home: workflowHomeIdentity(home), plan: plan.definition.id, eventHash: plan.hash, inventory: planOwnership(plan) };
  return { ...body, hash: digest(body) };
}
export function readOwnershipCapsule(input: unknown, home: string, plan: string, eventHash: string) {
  const { hash, ...body } = CapsuleSchema.parse(input);
  if (digest(body) !== hash || body.home !== workflowHomeIdentity(home) || body.plan !== plan || body.eventHash !== eventHash) throw new Error("Workflow ownership capsule failed its home identity or integrity.");
  return body.inventory;
}
export const RetirementSchema = z.object({ version: z.literal(1), home: z.string(), plan: PlanId, requestId: z.uuid(), requestHash: z.string().length(64),
  at: z.iso.datetime(), by: z.string().min(1), expected: z.string().length(64), evidence: z.string().min(1).max(10000), inventory: OwnershipSchema, hash: z.string().length(64) }).strict();
export type WorkflowRetirement = z.infer<typeof RetirementSchema>;
export interface QuarantinedWorkflow { plan: string; problem: string; fingerprint: string; inventory: WorkflowOwnership; retirement?: WorkflowRetirement }
/** Dependency references are bare node ids, so a quarantined name cannot borrow another host's evidence. */
export const quarantinedDependencyIds = (plans: readonly QuarantinedWorkflow[]) => new Set(plans.flatMap(p => p.inventory.scopes.map(s => s.node)));
