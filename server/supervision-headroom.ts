import type { SupervisionStatus } from "../shared/supervision";
import type { GatewayReceiver } from "../shared/supervision-effects";
import { refuse } from "./supervision-effects";
import { serialized } from "./serialize";
/** Shared only for checking and reserving plugin capacity. Release before any native effect. */
export function withScopeAdmission<T>(homeId: string, run: () => Promise<T>) {
  return serialized(`firstmate.scope-admission:${homeId}`, run);
}
/** Conservative plugin admission, not reserved provider quota or a fence against native/raw callers. */
export async function checkGeneralHeadroom(status: SupervisionStatus, receiver: GatewayReceiver, slots: number, reserved: number) {
  const identities = new Map<string, string>();
  for (const b of status.bindings.filter(b => b.state !== "retired")) identities.set(b.agentId, b.scopeId);
  for (const attempt of status.attempts.filter(a => a.worker && !["done", "landed", "failed", "cancelled"].includes(a.state)))
    identities.set(attempt.worker!.agentId, status.tasks.find(t => t.id === attempt.taskId)?.ownerScopeId ?? "");
  let occupied = 0;
  for (const [agentId, scopeId] of identities) {
    const observed = await receiver.findAgent(agentId);
    if (!observed || !["idle", "closed"].includes(observed.status) || status.effects.some(e => e.scopeId === scopeId &&
      ["reserved", "dispatching", "uncertain", "accepted"].includes(e.state))) occupied++;
  }
  if (occupied >= slots - reserved) refuse("HELD", "Plugin work capacity is occupied; configured General headroom is reserved. Actual provider capacity is unknown.");
}
