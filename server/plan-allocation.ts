/** S09 allocation is an additional constraint, never authority or borrowed capacity. */
import type { SupervisionStatus } from "../shared/supervision";
import { refuse } from "./supervision-effects";
export function checkPlanAllocation(status: SupervisionStatus, scopeId: string, adding: boolean, projectId?: string) {
  const scope = status.scopes.find(s => s.id === scopeId);
  if (scope?.kind !== "plan") return;
  const sponsor = status.projects?.sponsors.find(s => s.id === scopeId && s.state === "granted");
  if (!sponsor || sponsor.sponsorScopeId !== scope.sponsorId || sponsor.projectIds.length !== scope.projectIds.length ||
    scope.projectIds.some(id => !sponsor.projectIds.includes(id))) refuse("HELD", "This plan requires its exact granted all-project sponsor allocation.");
  const attempts = status.attempts.filter(a => status.tasks.some(t => t.id === a.taskId && t.ownerScopeId === scopeId));
  const selected = projectId ?? (scope.projectIds.length === 1 ? scope.projectIds[0] : undefined);
  if (adding && (!selected || !scope.projectIds.includes(selected))) refuse("UNKNOWN_OWNER", "Allocation needs the exact owned task's project; it cannot borrow a cross-project claim.");
  for (const id of scope.projectIds) {
    const own = attempts.filter(a => status.tasks.some(t => t.id === a.taskId && t.projectId === id));
    const spent = { agents: own.reduce((n, a) => n + a.spentAgents, 0), turns: own.reduce((n, a) => n + a.spentTurns, 0) }, extra = Number(adding && selected === id);
    const p = status.projects?.projects.find(p => p.id === id), claim = sponsor.claims.find(c => c.projectId === id);
    const total = status.projects?.sponsors.filter(s => s.state === "granted").flatMap(s => s.claims.filter(c => c.projectId === id)) ?? [];
    if (p?.state !== "admitted" || !p.budget || !claim || claim.agents < spent.agents + extra || claim.turns < spent.turns + extra ||
      total.reduce((n, c) => n + c.agents, 0) > p.budget.agents || total.reduce((n, c) => n + c.turns, 0) > p.budget.turns)
      refuse("HELD", "This project's granted allocation is unavailable or exhausted; retain cumulative attempt spend.");
  }
}
