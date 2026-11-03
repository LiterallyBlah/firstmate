/** Pure projection over immutable command receipts in the existing owned journal. */
import type { SupervisionStatus } from "../shared/supervision";
import { digest } from "./submissions";
import { refuse } from "./supervision-effects";
import type { SupervisorConfiguration } from "../shared/supervisor-profile";
import type { GatewayLimits } from "../shared/supervision-effects";
import type { SupervisorListRow } from "../shared/supervisor-controls";
/** The reviewed subject is pinned through reservation and each not-yet-admitted opening effect. */
export function checkSupervisorTarget(status: SupervisionStatus, config: SupervisorConfiguration) {
  const scope = status.scopes.find(s => s.id === config.scopeId), plan = status.plans.find(p => p.scopeId === config.scopeId)?.plan;
  const t = config.target;
  if (t.homeId !== status.homeId || t.hostId !== "local" || t.scopeId !== scope?.id || t.kind !== scope.kind ||
    t.planId !== (plan?.definition.id ?? null) || t.planHash !== (plan?.hash ?? null))
    refuse("STALE", "The reviewed Supervisor target changed; retain this request and review its pending proposal.");
}
export function supervisorControl(status: SupervisionStatus, scopeId: string) {
  return status.commands.flatMap(c => c.result.supervisorControl?.scopeId === scopeId ? [c.result.supervisorControl] : []).at(-1);
}
export function supervisorConfigurations(status: SupervisionStatus, scopeId: string) {
  return status.commands.flatMap(c => c.result.supervisorConfiguration?.scopeId === scopeId ? [c.result.supervisorConfiguration] : []);
}
export function supervisorAdmissionHold(status: SupervisionStatus, scopeId: string) {
  const control = supervisorControl(status, scopeId);
  return control?.action === "stage" ? "Change pending after current work. Stop the exact native session before reviewed replacement."
    : control?.action === "pause" ? "Supervisor paused. Existing obligations and spending are retained." : null;
}
export function supervisorView(status: SupervisionStatus, scopeId: string) {
  const binding = status.bindings.find(b => b.scopeId === scopeId), control = supervisorControl(status, scopeId);
  const configurations = supervisorConfigurations(status, scopeId), pending = control?.action === "stage" ? control.configuration : undefined;
  const effects = status.effects.filter(e => e.scopeId === scopeId);
  const replacement = status.commands.flatMap(c => c.result.supervisorReplacement?.scopeId === scopeId ? [c.result.supervisorReplacement] : []).at(-1);
  const withdrawn = replacement && status.commands.some(c => c.result.supervisorControl?.action === "withdraw" && c.result.supervisorControl.predecessor === replacement.expectedControlId);
  const reserved = replacement && effects.filter(e => e.requestId === replacement.requestId);
  const replacementResume = replacement && !withdrawn && binding && binding.epoch <= replacement.expectedEpoch + 1 &&
    (!reserved?.length || reserved.some(e => e.operation === "agent.send" && e.state === "reserved")) ? replacement : null;
  const opening = effects.find(e => e.attemptId === null && e.epoch === binding?.epoch && e.operation === "agent.send");
  const lifecycle = binding?.state === "active" ? effects.some(e => ["uncertain", "accepted"].includes(e.state)) ? "uncertain"
    : opening?.state === "reserved" ? "waiting" : opening?.state === "failed" ? "unavailable" : "active" : binding?.state ?? "unavailable";
  return { scopeId, binding: binding ?? null, bindingDigest: binding ? digest(binding) : null, controlId: control?.id ?? null,
    state: pending ? "change-pending" : control?.action === "pause" ? "paused" : lifecycle,
    replacementResume, configurations, pendingDigest: pending ? digest(pending) : null,
    reservedOwnerInputs: effects.filter(e => e.epoch === binding?.epoch && e.attemptId === null && e.operation === "agent.send" && e.state === "reserved")
      .map(e => ({ id: e.id, version: e.version, payloadDigest: e.payloadDigest! })),
    pending: pending ?? null,
    sessions: effects.filter(e => e.attemptId === null && e.operation === "agent.create").length,
    turns: effects.filter(e => e.attemptId === null && e.operation === "agent.send").length,
    obligations: { uncertain: effects.filter(e => ["dispatching", "accepted", "uncertain"].includes(e.state)).map(e => e.id),
      reserved: effects.filter(e => e.state === "reserved").map(e => e.id),
      workers: status.attempts.filter(a => status.tasks.some(t => t.id === a.taskId && t.ownerScopeId === scopeId) && !["done", "landed", "failed", "cancelled", "released-uncreated", "abandoned"].includes(a.state)).map(a => a.id),
      decisions: status.decisions.filter(d => d.ownerScopeId === scopeId && d.state === "pending").map(d => d.id),
      sources: status.sources.bindings.filter(s => s.scopeId === scopeId).map(s => s.id),
      unlanded: status.plans.filter(p => p.scopeId === scopeId).flatMap(p => Object.entries(p.plan.nodes).filter(([, n]) => n.state === "done").map(([id]) => id)) },
    retirement: "Retirement requires disposition of retained effects, workers, decisions, sources and unlanded artifacts. No workspace or history is deleted." };
}
/** Every plan, project and routine-check Supervisor with a binding or a saved configuration, from stored truth only. */
export function supervisorList(status: SupervisionStatus, limits: (scopeId: string) => GatewayLimits | null): SupervisorListRow[] {
  return status.scopes.flatMap(scope => {
    if (scope.kind !== "plan" && scope.kind !== "project" && scope.kind !== "maintenance") return [];
    const view = supervisorView(status, scope.id);
    if (!view.binding && !view.configurations.length) return [];
    const plan = status.plans.find(p => p.scopeId === scope.id)?.plan, project = status.projects?.projects.find(p => p.scopeId === scope.id);
    const admission = status.commands.find(c => c.result.maintenanceAdmission?.scopeId === scope.id)?.result.maintenanceAdmission;
    // The profile and caps the exact session runs under; a staged proposal is not current until a reviewed replacement.
    const configured = view.configurations.find(c => c.id === view.binding?.configurationId), ceiling = limits(scope.id);
    const bound = configured?.resolved ?? view.binding?.profileReadback;
    const profile = bound ?? (view.binding ? undefined : view.configurations.at(-1)?.resolved) ?? project?.owner?.profile ?? admission?.profile;
    // As reservation does: a bound configuration's limits apply within the allocation, never above it.
    const effective = configured && ceiling ? { supervisorSessions: Math.min(ceiling.supervisorSessions, configured.limits.supervisorSessions),
      supervisorTurns: Math.min(ceiling.supervisorTurns, configured.limits.supervisorTurns) } : configured?.limits ?? ceiling;
    const failure = status.effects.filter(e => e.scopeId === scope.id && e.state === "failed").at(-1);
    return [{ scopeId: scope.id, kind: scope.kind, title: plan?.definition.title ?? project?.name ?? admission?.name ?? `${scope.kind} ${scope.id.slice(0, 8)}`,
      planId: plan?.definition.id ?? null, state: scope.state === "retired" ? "retired" : view.state, agentId: view.binding?.agentId ?? null, epoch: view.binding?.epoch ?? null,
      profile: profile ? { provider: profile.provider, modeId: profile.modeId || null, thinkingOptionId: profile.thinkingOptionId || null } : null,
      sessions: view.sessions, turns: view.turns, limits: effective,
      lastFailure: failure ? `${failure.operation} failed${failure.receiptRef ? ` (${failure.receiptRef})` : ""}` : null }];
  });
}
