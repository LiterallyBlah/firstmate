import type { SupervisionStatus } from "../shared/supervision";
import type { GatewayReceiver } from "../shared/supervision-effects";
import { refuse } from "./supervision-effects";
import { serialized } from "./serialize";
import { SupervisionError } from "./supervision-store";
const LOOKUP_TIMEOUT_MS = 5000;
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
  const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
  for (const [agentId, scopeId] of identities) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) refuse("HELD", "Capacity lookup timed out; General headroom remains reserved. Retry after inspecting the receiver.");
    let timer!: ReturnType<typeof setTimeout>;
    // These are reads only. A timeout admits nothing, and a late reply cannot continue provisioning.
    const observed = await Promise.race([
      receiver.findAgent(agentId),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SupervisionError("HELD",
        "Capacity lookup timed out; General headroom remains reserved. Retry after inspecting the receiver.")), remaining); }),
    ]).finally(() => clearTimeout(timer));
    if (!observed || !["idle", "closed"].includes(observed.status) || status.effects.some(e => e.scopeId === scopeId &&
      ["reserved", "dispatching", "uncertain", "accepted"].includes(e.state))) occupied++;
  }
  if (occupied >= slots - reserved) refuse("HELD", "Plugin work capacity is occupied; configured General headroom is reserved. Actual provider capacity is unknown.");
}
