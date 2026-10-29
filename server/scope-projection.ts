/** Stored truth only. In particular, no receiver lookup, activation, repair, or owner turn. */
import type { SupervisionStatus } from "../shared/supervision";
import { ScopeSnapshotSchema, type ScopeSnapshot } from "../shared/supervision-rpc";
import { goalStatus } from "./supervision-continuation";

export function scopeSnapshot(status: SupervisionStatus, generalId: string | null, options: { uiEnabled?: boolean; executionEnabled?: boolean; admittedProjectsOnly?: boolean | undefined } = {}, now = Date.now()): ScopeSnapshot {
  const goals = goalStatus(status, now).goals;
  const coverage = (ids: string[]) => {
    const sources = status.inbox.sources.filter(s => s.agentId && ids.includes(s.agentId));
    return sources.some(s => s.coverage === "gap") ? "gaps" as const : !sources.length || sources.some(s => s.coverage === "unknown") ? "unknown" as const : "complete" as const;
  };
  const names = new Map<string, Set<string>>();
  for (const scope of status.scopes) for (const id of scope.projectIds) if (!names.has(id)) names.set(id, new Set());
  for (const rule of status.policyRules) for (const [id, name] of Object.entries(rule.selector.projectNames)) {
    if (names.has(id)) names.get(id)!.add(name);
  }
  for (const project of status.projects?.projects ?? []) {
    names.set(project.id, new Set([project.name]));
  }
  // Ambiguous human names are retained as separate candidates; no arbitrary winner.
  const projects = (options.admittedProjectsOnly ? [] : [...names].flatMap(([id, labels]) => [...(labels.size ? labels : [id])].map(name => ({ id, name }))));
  if (options.admittedProjectsOnly) for (const p of status.projects?.projects.filter(p => p.state === "admitted") ?? []) projects.push({ id: p.id, name: p.name });
  for (const project of status.projects?.projects ?? []) for (const name of project.aliases)
    if ((!options.admittedProjectsOnly || project.state === "admitted") && !projects.some(p => p.id === project.id && p.name === name)) projects.push({ id: project.id, name });
  const scoped = status.scopes.filter(s => s.kind !== "general").map(scope => {
    const binding = status.bindings.find(b => b.scopeId === scope.id), ownGoals = goals.filter(g => g.scopeId === scope.id || scope.kind === "project" && g.projectIds.some(p => scope.projectIds.includes(p)));
    const plan = status.plans.find(p => p.scopeId === scope.id)?.plan;
    const label = scope.kind === "project" && scope.projectIds.length === 1 ? [...(names.get(scope.projectIds[0]!) ?? [])] : [];
    const title = plan?.definition.title ?? (label.length === 1 ? label[0]! : `${scope.kind} ${scope.id.slice(0, 8)}`);
    const observation = binding?.observation;
    const pending = status.effects.some(e => e.scopeId === scope.id && e.attemptId === null && e.operation === "agent.send" && ["reserved", "dispatching", "uncertain", "accepted"].includes(e.state));
    const session = scope.state === "held" || scope.state === "transferring" || scope.state === "retired" ? "held" as const : !binding ? "not-created" as const :
      pending || !observation || now - Date.parse(observation.at) > 60000 ? "unknown" as const : observation.state;
    const ownedScopeIds = new Set([scope.id, ...ownGoals.map(g => g.scopeId)]), effects = status.effects.filter(e => ownedScopeIds.has(e.scopeId));
    const failure = effects.filter(e => e.state === "failed").at(-1);
    const taskIds = new Set(status.tasks.filter(t => ownedScopeIds.has(t.ownerScopeId)).map(t => t.id));
    const workerIds = status.attempts.filter(a => taskIds.has(a.taskId) && a.worker).map(a => a.worker!.agentId);
    const admitted = status.projects?.projects.find(p => p.scopeId === scope.id);
    return { id: scope.id, title, aliases: [...new Set([...(plan ? [plan.definition.id] : []), ...(label.length === 1 ? label : []), ...(admitted?.aliases ?? [])])], kind: scope.kind, planId: plan?.definition.id ?? null, discussionOnly: binding?.purpose === "discussion",
      target: { homeId: status.homeId, scopeId: scope.id, scopeVersion: scope.version, epoch: binding?.epoch ?? 0, agentId: binding?.agentId ?? null },
      hostId: binding?.hostId ?? null, workspaceId: binding?.workspaceId ?? null, state: scope.state, session, observedAt: observation?.at ?? null, goals: ownGoals, coverage: coverage(workerIds),
      lastEffectFailure: failure ? { id: failure.id, operation: failure.operation, reason: failure.receiptRef } : null,
      activeWorkers: ownGoals.reduce((n, g) => n + g.activeWorkers, 0), activeEffects: effects.filter(e => ["reserved", "dispatching", "uncertain", "accepted"].includes(e.state)).length,
      uncertainEffects: effects.filter(e => ["dispatching", "uncertain", "accepted"].includes(e.state)).length };
  });
  return ScopeSnapshotSchema.parse({ homeId: status.homeId, sequence: status.sequence, freshness: status.freshness,
    uiEnabled: options.uiEnabled ?? false, executionEnabled: options.executionEnabled ?? false, projects, problems: status.problems, asOf: new Date(now).toISOString(),
    scopes: [{ id: "general", title: "FirstMate", aliases: ["mate", "firstmate", "general"], kind: "general", planId: null, discussionOnly: false,
      target: { homeId: status.homeId, scopeId: "general", scopeVersion: 0, epoch: 0, agentId: generalId }, workspaceId: null,
      hostId: "local", state: generalId ? "active" : "dormant", session: generalId ? "unknown" : "not-created", observedAt: null, goals, lastEffectFailure: null, coverage: coverage(status.attempts.flatMap(a => a.worker ? [a.worker.agentId] : [])),
      activeWorkers: goals.reduce((n, g) => n + g.activeWorkers, 0), activeEffects: status.effects.filter(e => ["reserved", "dispatching", "uncertain", "accepted"].includes(e.state)).length,
      uncertainEffects: status.effects.filter(e => ["dispatching", "uncertain", "accepted"].includes(e.state)).length }, ...scoped] });
}
