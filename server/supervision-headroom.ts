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
const isLocal = (hostId: string) => hostId.trim().toLowerCase() === "local";
/** Conservative plugin admission, not reserved provider quota or a fence against native/raw callers.
 * Headroom choice: this counts occupancy of the LOCAL daemon only. A remote worker attempt runs on
 * its saved host, so it never consumes a local General slot; the local Supervisor's own session and
 * turns (its binding identity) still count. Per-host remote capacity is the host's own, unmodelled here. */
export async function pluginOccupancy(status: SupervisionStatus, receiver: GatewayReceiver, admittingEffectId?: string, sufficientBelow?: number) {
  const identities = new Map<string, string>();
  for (const b of status.bindings.filter(b => b.state !== "retired")) identities.set(b.agentId, b.scopeId);
  const workerIdentity = (attemptId: string) => {
    const attempt = status.attempts.find(a => a.id === attemptId);
    return attempt?.worker?.agentId ?? status.effects.find(e => e.id === attempt?.launchEffectId && e.operation === "agent.create")?.receiverKey ?? null;
  };
  const attemptHost = (attemptId: string | null) => {
    const attempt = status.attempts.find(a => a.id === attemptId);
    return attempt?.worker?.hostId ?? status.tasks.find(t => t.id === attempt?.taskId)?.hostId ?? "local";
  };
  // Checked release proves non-admission; its retained identity/spend is not physical occupancy.
  for (const attempt of status.attempts.filter(a => !["done", "landed", "failed", "cancelled", "released-uncreated"].includes(a.state))) {
    if (!isLocal(attemptHost(attempt.id))) continue;
    const id = workerIdentity(attempt.id);
    if (id) identities.set(id, status.tasks.find(t => t.id === attempt.taskId)?.ownerScopeId ?? "");
  }
  const pending = status.effects.filter(e => ["reserved", "dispatching", "uncertain", "accepted"].includes(e.state));
  for (const e of pending.filter(e => e.operation === "agent.create" && e.receiverKey && (e.attemptId === null || isLocal(attemptHost(e.attemptId))))) identities.set(e.receiverKey!, e.scopeId);
  const admitting = admittingEffectId ? status.effects.find(e => e.id === admittingEffectId && e.state === "reserved") : undefined;
  if (admittingEffectId && !admitting) refuse("STALE", "Capacity admission requires the exact reserved effect.");
  // A remote worker effect owns no local slot: it is admitted against others' occupancy, not its own.
  const admittingRemote = !!admitting?.attemptId && !isLocal(attemptHost(admitting.attemptId));
  const ownIdentity = admitting && !admittingRemote ? admitting.attemptId ? workerIdentity(admitting.attemptId) : status.bindings.find(b => b.scopeId === admitting.scopeId)?.agentId : null;
  if (admitting && !admittingRemote && (!ownIdentity || !identities.has(ownIdentity))) refuse("HELD", "The selected capacity reservation is unavailable.");
  // Counting every retained identity as occupied is a conservative upper bound. When even that
  // bound leaves General's reservation, an unrelated liveness read cannot improve admission.
  const upperBound = identities.size - (ownIdentity ? 1 : 0);
  if (sufficientBelow !== undefined && upperBound < sufficientBelow) return upperBound;
  let occupied = 0;
  const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
  for (const [agentId, scopeId] of identities) {
    // The admitting effect already owns this slot; all other reservations still count.
    if (agentId === ownIdentity) continue;
    const remaining = deadline - Date.now();
    if (remaining <= 0) refuse("HELD", "Capacity lookup timed out; General headroom remains reserved. Retry after inspecting the receiver.");
    let timer!: ReturnType<typeof setTimeout>;
    // These are reads only. A timeout admits nothing, and a late reply cannot continue provisioning.
    const reserved = pending.some(e => e.operation === "agent.create" && e.receiverKey === agentId || e.operation === "agent.send" &&
      (e.attemptId === null ? status.bindings.some(b => b.scopeId === e.scopeId && b.agentId === agentId) : workerIdentity(e.attemptId) === agentId));
    if (reserved) { occupied++; continue; }
    const observed = await Promise.race([
      receiver.findAgent(agentId),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SupervisionError("HELD",
        "Capacity lookup timed out; General headroom remains reserved. Retry after inspecting the receiver.")), remaining); }),
    ]).finally(() => clearTimeout(timer));
    if (!observed || !["idle", "closed"].includes(observed.status)) occupied++;
  }
  return occupied;
}
export async function checkGeneralHeadroom(status: SupervisionStatus, receiver: GatewayReceiver, slots: number, reserved: number, admittingEffectId?: string, continuingTurn = false) {
  if (await pluginOccupancy(status, receiver, admittingEffectId, continuingTurn ? slots - reserved : undefined) >= slots - reserved)
    refuse("HELD", "Plugin work capacity is occupied; configured General headroom is reserved. Actual provider capacity is unknown.");
}
