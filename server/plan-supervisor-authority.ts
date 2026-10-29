/** Effective continuing-turn authority, shared by B initiative and C discussion admission. */
import type { SupervisionStatus } from "../shared/supervision";
import { digest } from "./submissions";
import { checkPolicySource, policyRef, sameVector } from "./supervision-policy";
import { SupervisionError } from "./supervision-store";
export function planSupervisorAuthority(status: SupervisionStatus, scopeId: string) {
  const plan = status.plans.find(p => p.scopeId === scopeId)?.plan;
  const record = status.planRules?.find(r => r.homeId === status.homeId && r.scopeId === scopeId && r.planId === plan?.definition.id && r.revision === plan.revision);
  if (!record || status.freshness !== "current") throw new SupervisionError("HELD", "Effective supervisor rule authority is unavailable.");
  return { id: record.id, version: record.version, digest: digest(record) };
}
export async function checkPlanSupervisorAuthority(home: string, status: SupervisionStatus, scopeId: string) {
  const authority = planSupervisorAuthority(status, scopeId), record = status.planRules!.find(r => r.id === authority.id)!;
  for (const ref of record.sources) {
    const source = status.policySources.find(s => s.id === ref.id);
    if (!source || !sameVector([ref], [policyRef("policy-source", source)]) || status.policySources.some(s => s.supersedes.includes(ref.id)))
      throw new SupervisionError("STALE", "Supervisor rule authority source changed or was superseded.");
    await checkPolicySource(home, source);
  }
  return authority;
}
