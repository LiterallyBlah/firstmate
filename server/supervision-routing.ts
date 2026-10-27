/** New scoped work has one backend. This is a cooperative local guard, not a raw-file fence.
 * Uninitialized supervision leaves legacy behavior available; retained ownership still refuses
 * a conflicting target when authority is damaged. No writer or session is initialized by a read.
 */
import type { WorkflowCommand } from "../shared/workflow-plans";
import type { SupervisionStore } from "./supervision-store";
import type { WorkflowPlanStore } from "./workflow-plans";

export function commandPlan(command: WorkflowCommand): string | null {
  return command.op === "draft" || command.op === "revise" ? command.definition.id : command.op === "implicit" ? command.launch.id : "plan" in command ? command.plan : null;
}
function taskTargets(c: WorkflowCommand) {
  return c.op === "draft" || c.op === "revise" ? c.definition.nodes.flatMap(n => n.kind === "run" ? [{ node: n.id, host: n.launch.host.trim().toLowerCase() }] : []) :
    c.op === "implicit" || c.op === "claim" ? [{ node: c.launch.id, host: c.launch.host.trim().toLowerCase() }] :
    "node" in c && c.node ? [{ node: c.node, host: null }] : [];
}
export async function legacyRoute(supervision: SupervisionStore, command: WorkflowCommand): Promise<void> {
  if (["plans", "show", "agenda", "lint"].includes(command.op)) return;
  const plan = commandPlan(command);
  if (!plan) return;
  const status = await supervision.read();
  if (status.freshness === "uninitialized") return;
  const candidates = taskTargets(command), tasks = [...status.tasks, ...status.retainedOwnership.flatMap(o => o.tasks)];
  if (status.backends.some(b => b.planId === plan) || status.retainedOwnership.some(o => o.workflows.some(w => w.plan === plan)) ||
    candidates.some(c => tasks.some(t => t.nodeId === c.node && (!c.host || t.hostId.trim().toLowerCase() === c.host))))
    throw new Error(`Plan ${plan} or its task is owned by a scoped supervisor; the legacy first-mate helper cannot change it.`);
}
export async function scopeRoute(legacy: WorkflowPlanStore, plan: string, command?: WorkflowCommand): Promise<void> {
  const read = await legacy.read();
  if (read.unavailable) throw new Error("The legacy plan store is unavailable; a scoped command cannot prove its target is not legacy.");
  const candidates = command ? taskTargets(command) : [];
  const held = read.quarantined.flatMap(q => q.inventory.scopes);
  // S07: a committed cutover moved authority to the scoped backend; its retained legacy bytes are history only.
  const migrated = new Set<string>();
  for (const p of read.plans) if (await legacy.cutover(p.definition.id) === "committed") migrated.add(p.definition.id);
  const plans = read.plans.filter(p => !migrated.has(p.definition.id));
  const live = plans.flatMap(p => [...p.definition.nodes, ...(p.removed ?? []).map(r => r.node)]).flatMap(n => n.kind === "run" ? [{ node: n.id, host: n.launch.host.trim().toLowerCase() }] : []);
  if (plans.some(p => p.definition.id === plan) || read.quarantined.some(q => q.plan === plan) ||
    candidates.some(c => [...held, ...live].some(t => t.node === c.node && (!c.host || !t.host || t.host === c.host))))
    throw new Error(`Plan ${plan} or its task belongs to the legacy first mate; the scope helper cannot change it.`);
}
