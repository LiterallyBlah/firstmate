import type { ActivationSnapshot } from "../shared/supervision-activation";
import type { ProjectRuntimeSnapshot } from "../shared/project-runtime";
import type { MaintenanceRuntimeSnapshot } from "../shared/maintenance-runtime";

type Project = ProjectRuntimeSnapshot["projects"][number];

/** Registry membership is an opportunity, never an owner or a captain decision. */
export function projectSetupAvailable(project: Project): boolean {
  return project.state === "unadmitted" && project.version === 0 &&
    !project.agentId && !project.provisionRequestId && !project.sessions && !project.turns && !project.uncertain &&
    (!project.reason || project.reason === "Awaiting reviewed admission and allocation.");
}

export function activationHasHistory(data: ActivationSnapshot): boolean {
  return !!(data.plans.some(p => p.binding || p.opening || p.resumeRequestId) || data.audits.length ||
    data.migrations.length || data.dispositions.length || data.resumeMigrations?.length);
}

export function projectHasHistory(data: ProjectRuntimeSnapshot): boolean {
  return data.projects.some(p => !projectSetupAvailable(p));
}

export function maintenanceHasHistory(data: MaintenanceRuntimeSnapshot): boolean {
  return !!(data.owners.length || data.jobs.length || data.occurrences.length || data.hosts.length ||
    data.incidents.length || data.reservations.length || data.deliveries.length || data.captainDecisions.length ||
    data.decisions.length || data.outbox.length);
}

export function projectHasProblem(project: Project): boolean {
  return !projectSetupAvailable(project) && (!!project.reason || !!project.uncertain || project.state === "held" || project.state === "stopped");
}
