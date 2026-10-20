import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { PlanCaptainCommandSchema, PlanDefinitionSchema, PlanLaunchSchema, PlanNodeSchema, PlanPostureSourceSchema, type PlanNodeState } from "./workflow-plans";
const NodeStateSchema: z.ZodType<PlanNodeState> = z.lazy(() => z.object({ state: z.enum(["planned", "starting", "running", "done", "landed", "failed", "cancelled", "unresolved"]), held: z.union([z.boolean(), z.string()]).optional(), attempt: z.string().optional(), claimed: z.boolean().optional(),
  agentId: z.string().optional(), workspaceId: z.string().optional(), evidence: z.string().optional(), briefHash: z.string().optional(), answer: z.string().optional(), launch: PlanLaunchSchema.optional(), invalidated: z.string().optional(), spent: z.number().optional(), completedAt: z.string().optional(), priorAttempts: z.array(NodeStateSchema).optional() }));
export const WorkflowPlanSchema = z.object({ definition: PlanDefinitionSchema, revision: z.number(), sequence: z.number(), hash: z.string(), posture: z.enum(["review", "sail"]),
  status: z.enum(["review", "active", "held", "abandoned"]), approvedBudget: z.object({ agents: z.number(), turns: z.number() }), nodes: z.record(z.string(), NodeStateSchema), told: z.array(z.string()), handled: z.array(z.string()),
  history: z.array(z.object({ revision: z.number(), at: z.string(), by: z.string(), reason: z.string() })),
  removed: z.array(z.object({ node: PlanNodeSchema, state: NodeStateSchema })).optional(), postureSource: PlanPostureSourceSchema.optional(),
  captainEvents: z.array(z.object({ id: z.string(), action: z.string(), text: z.string(), node: z.string().optional(), at: z.string(), by: z.string().optional(), notified: z.boolean().optional() })).optional() });
export const PlanNeedSchema = z.object({ plan: z.string(), node: z.string().optional(), title: z.string(), question: z.string(), waits: z.array(z.string()), neededBy: z.array(z.string()), recommendation: z.string() });
export type PlanNeed = z.infer<typeof PlanNeedSchema>;
export const WorkflowSnapshotSchema = z.object({ homeId: z.string(), version: z.string(), plans: z.array(WorkflowPlanSchema), subjects: z.record(z.string(), z.string()), now: z.array(PlanNeedSchema), comingUp: z.array(PlanNeedSchema), problems: z.array(z.string()).optional(), warnings: z.array(z.string()).optional() });
export type WorkflowSnapshot = z.infer<typeof WorkflowSnapshotSchema>;
export const readWorkflowPlans = defineRpc({ name: "firstmate.workflow.read", input: z.object({}), output: WorkflowSnapshotSchema });
export const actOnWorkflowPlan = defineRpc({ name: "firstmate.workflow.act", input: z.object({ homeId: z.string(), requestId: z.uuid(), command: PlanCaptainCommandSchema }).strict(), output: WorkflowSnapshotSchema });
