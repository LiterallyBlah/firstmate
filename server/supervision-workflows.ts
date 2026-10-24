/** Replay seam, not a command gateway. S03 must validate NEW commands before making events.
 * Historical approvals/early answers are never reauthorized against today's projections.
 */
import type { WorkflowPlan } from "../shared/workflow-plans";
import { digest } from "./submissions";
import { replayWorkflowEvent, WorkflowEventSchema, type WorkflowEvent } from "./workflow-plans";
import { workflowHomeIdentity } from "./workflow-ownership";

export function replaySupervisionWorkflow(previous: WorkflowPlan | null, input: WorkflowEvent, homeId: string): WorkflowPlan {
  // Match WorkflowPlanStore.events: check original committed data BEFORE defaults/transforms.
  const { hash: rawHash, ...rawBody } = input;
  if (digest(rawBody) !== rawHash || input.requestHash !== digest(input.command)) throw new Error("Workflow replay content mismatch.");
  const event = WorkflowEventSchema.parse(input);
  const c = event.command;
  const plan = c.op === "draft" || c.op === "revise" ? c.definition.id : c.op === "implicit" ? c.launch.id : "plan" in c ? c.plan : null;
  if (["retire", "show", "plans", "agenda", "lint"].includes(c.op) || plan !== event.plan ||
    workflowHomeIdentity(event.home) !== homeId ||
    event.sequence !== (previous ? previous.sequence + 1 : 0) || event.previous !== (previous?.hash ?? null) ||
    (previous && previous.definition.id !== event.plan)) throw new Error("Workflow replay identity, chain or command mismatch.");
  return replayWorkflowEvent(previous, event);
}
