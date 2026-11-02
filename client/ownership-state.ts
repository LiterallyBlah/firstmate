import type { ActivationSnapshot } from "../shared/supervision-activation";
import type { MaintenanceRuntimeSnapshot } from "../shared/maintenance-runtime";

export function activationHasHistory(data: ActivationSnapshot): boolean {
  return !!(data.plans.some(p => p.binding || p.opening || p.resumeRequestId) || data.audits.length ||
    data.migrations.length || data.dispositions.length || data.resumeMigrations?.length);
}

export function maintenanceHasHistory(data: MaintenanceRuntimeSnapshot): boolean {
  return !!(data.owners.length || data.jobs.length || data.occurrences.length || data.hosts.length ||
    data.incidents.length || data.reservations.length || data.deliveries.length || data.captainDecisions.length ||
    data.decisions.length || data.outbox.length);
}

