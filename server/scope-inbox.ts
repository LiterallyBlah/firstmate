import type { NeedsYouSnapshot } from "../shared/needs-you";
import type { SupervisionStatus } from "../shared/supervision";
import type { WorkflowPlan } from "../shared/workflow-plans";
/** Read-only membership from admitted identities; missing/ambiguous legacy membership stays visible in All. */
export function withScopeInboxContext(snapshot: NeedsYouSnapshot, status: SupervisionStatus, legacy: WorkflowPlan[] = [], localHostId = "local"): NeedsYouSnapshot {
  const projects = status.projects?.projects ?? [];
  const directory = status.scopes.map(s => ({ id: s.id, kind: s.kind, title: status.plans.find(p => p.scopeId === s.id)?.plan.definition.title ??
    projects.find(p => p.scopeId === s.id)?.name ?? s.kind,
    projectIds: s.projectIds, projectNames: projects.filter(p => s.projectIds.includes(p.id)).flatMap(p => [p.name, ...p.aliases]),
    hostId: (() => { const bound = status.bindings.find(b => b.scopeId === s.id)?.hostId ?? projects.find(p => p.scopeId === s.id)?.owner?.hostId;
      const hosts = [...new Set(bound ? [bound] : status.tasks.filter(t => t.ownerScopeId === s.id).map(t => t.hostId.trim().toLowerCase()))];
      const host = s.kind === "general" ? "local" : hosts.length === 1 ? hosts[0] : null;
      return host?.trim().toLowerCase() === "local" ? localHostId : host ?? null; })(),
    planId: status.plans.find(p => p.scopeId === s.id)?.plan.definition.id ?? null }));
  if (!directory.some(s => s.kind === "general")) directory.unshift({ id: "general", kind: "general", title: "FirstMate", projectIds: [], projectNames: [], hostId: localHostId, planId: null });
  for (const plan of legacy.filter(p => !directory.some(s => s.planId === p.definition.id))) {
    const names = plan.definition.nodes.flatMap(n => n.kind === "run" && n.launch.host.trim().toLowerCase() === "local" ? [n.launch.project] : []);
    const matched = projects.filter(p => names.some(n => [p.name, ...p.aliases].some(a => a.toLowerCase() === n.toLowerCase())));
    directory.push({ id: `legacy-plan:${plan.definition.id}`, kind: "plan", title: plan.definition.title, projectIds: matched.map(p => p.id),
      projectNames: matched.flatMap(p => [p.name, ...p.aliases]), hostId: localHostId, planId: plan.definition.id });
  }
  return { ...snapshot, scopeFiltersEnabled: true, scopeDirectory: directory };
}
