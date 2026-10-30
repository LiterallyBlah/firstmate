/** Ephemeral display observations only: no writer, receiver, lifecycle or owner turn. */
import type { SupervisionStatus } from "../shared/supervision";
import type { ScopeSnapshot } from "../shared/supervision-rpc";
import type { PaseoApi } from "./host-types";
import { observeWithin } from "./supervision-observation";

interface SessionObservation {
  scopeId: string; owner: string; state: "awake" | "dormant" | "unknown"; at: string;
}

function projectOwner(status: SupervisionStatus, scopeId: string) {
  const scope = status.scopes.find(s => s.id === scopeId), binding = status.bindings.find(b => b.scopeId === scopeId);
  if (status.freshness !== "current" || scope?.kind !== "project" || scope.state !== "active" || binding?.state !== "active" ||
    binding.hostId.trim().toLowerCase() !== "local") return null;
  return { binding, key: JSON.stringify([status.homeId, scope.id, scope.version, binding.epoch, binding.agentId, binding.hostId, binding.workspaceId]) };
}

/** Each status RPC checks again, including Refresh while a stored observation is still recent.
 * Concurrent/timed-out checks reuse the same pending native read with the existing deadline. */
export async function observeProjectSessions(status: SupervisionStatus, paseo: PaseoApi): Promise<SessionObservation[]> {
  return Promise.all(status.bindings.flatMap(binding => {
    const owner = projectOwner(status, binding.scopeId);
    if (!owner) return [];
    return [(async (): Promise<SessionObservation> => {
      let state: SessionObservation["state"] = "unknown";
      try {
        const observed = await observeWithin(paseo.agents, `scope-status:${owner.key}`, () => paseo.agents.ref(binding.agentId).refresh());
        const agent = observed?.agent;
        if (agent?.id === binding.agentId && agent.workspaceId === binding.workspaceId && !agent.archivedAt)
          state = agent.status === "idle" ? "dormant" : agent.status === "running" || agent.status === "initializing" ? "awake" : "unknown";
      } catch { /* Missing/unreachable/timed-out observations never fall back to stored idle. */ }
      return { scopeId: binding.scopeId, owner: owner.key, state, at: new Date().toISOString() };
    })()];
  }));
}

/** Apply only after rereading stored identity. Late results cannot describe a replacement,
 * changed home, paused owner or unavailable journal, and never become durable authority. */
export function withObservedProjectSessions(snapshot: ScopeSnapshot, status: SupervisionStatus, observations: SessionObservation[]): ScopeSnapshot {
  return { ...snapshot, scopes: snapshot.scopes.map(scope => {
    const observed = observations.find(o => o.scopeId === scope.id);
    return observed && projectOwner(status, scope.id)?.key === observed.owner
      ? { ...scope, session: observed.state, observedAt: observed.at } : scope;
  }) };
}
