/** Explicit reviewed policy records for isolated S03 callers. Never extracts authority from prose. */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { SupervisionActor, SupervisionStatus } from "../shared/supervision";
import { PolicyRuleSchema, PolicySourceSchema, type PolicyRule, type PolicySource, type PilotOperation, type VersionRef, type PolicyOperationTarget } from "../shared/supervision-policy";
import { resolveInHome } from "./files";
import { digest } from "./submissions";
import { SupervisionError, type SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { workflowHomeIdentity } from "./workflow-ownership";
import { CONTEXT_ONLY_KINDS } from "../shared/supervision-projects";
import { MAINTENANCE_KINDS } from "../shared/supervision-maintenance";

export const policyRef = (kind: string, value: { id: string; version: number }): VersionRef => ({ kind, id: value.id, version: value.version, digest: digest(value) });
const refuse = (code: "STALE" | "HELD" | "CONFLICT", message: string): never => { throw new SupervisionError(code, message); };
const normalize = (v: readonly VersionRef[]) => [...v].sort((a, b) => `${a.kind}/${a.id}`.localeCompare(`${b.kind}/${b.id}`));
export function sameVector(actual: readonly VersionRef[], expected: readonly VersionRef[]): boolean {
  return new Set(actual.map(v => `${v.kind}/${v.id}`)).size === actual.length && digest(normalize(actual)) === digest(normalize(expected));
}
export async function checkPolicySource(home: string, source: PolicySource): Promise<void> {
  try {
    const { absolute } = await resolveInHome(home, source.path);
    const before = await stat(absolute);
    if (!before.isFile() || before.size > 2 * 1024 * 1024) refuse("HELD", "Policy source is outside the bounded text contract.");
    const bytes = await readFile(absolute), after = await stat(absolute);
    if (["size", "mtimeMs", "ctimeMs", "ino"].some(k => before[k as keyof typeof before] !== after[k as keyof typeof after])) refuse("STALE", "Policy source changed during inspection.");
    const lines = bytes.toString("utf8").replace(/\r\n/g, "\n").split("\n");
    const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
    if (hash(bytes) !== source.fileHash || source.lineEnd > lines.length || hash(lines.slice(source.lineStart - 1, source.lineEnd).join("\n")) !== source.excerptHash)
      refuse("STALE", `Policy source changed: ${source.id}. Review its exact source again.`);
  } catch (error) {
    if (error instanceof SupervisionError) throw error;
    refuse("HELD", `Policy source ${source.id} is unreadable or outside its home.`);
  }
}
export interface PolicyTarget { scopeId: string; planId: string; projectIds: readonly string[]; hostId: string; operation: PilotOperation }
export function applicableRules(status: SupervisionStatus, target: PolicyTarget): PolicyRule[] {
  const superseded = new Set(status.policyRules.flatMap(r => r.supersedes));
  return status.policyRules.filter(r => !superseded.has(r.id) && r.selector.scopeIds.includes(target.scopeId) &&
    r.selector.planIds.includes(target.planId) && r.selector.hostIds.some(h => h.trim().toLowerCase() === target.hostId.trim().toLowerCase()) &&
    r.selector.projectIds.some(p => target.projectIds.includes(p)) && r.operations.includes(target.operation));
}
export function currentPolicyVector(status: SupervisionStatus, target: PolicyTarget): VersionRef[] {
  const rules = applicableRules(status, target), sourceIds = new Set(rules.flatMap(r => r.sources.map(s => s.id)));
  return normalize([...rules.map(r => policyRef("policy-rule", r)), ...status.policySources.filter(s => sourceIds.has(s.id)).map(s => policyRef("policy-source", s))]);
}
export interface PolicyAdmission extends PolicyTarget {
  policyVector: VersionRef[]; evidenceVector: VersionRef[]; subjectHash: string; revision: number;
  approvalId: string | null; model: string | null; profileDigest?: string; head: string | null; artifactHash: string | null;
  approvalOperation?: PilotOperation; approvalPolicyVector?: VersionRef[]; modelPolicyVector?: VersionRef[];
  operationTarget: PolicyOperationTarget;
}
export async function checkPolicy(home: string, status: SupervisionStatus, input: PolicyAdmission, now: string, issuingApproval = false): Promise<void> {
  // S09: project memory, sponsors, intents and conflicts are context. Citing one never stands in for a grant or evidence.
  if ([input.policyVector, input.evidenceVector, input.approvalPolicyVector ?? [], input.modelPolicyVector ?? []].some(v => v.some(r => CONTEXT_ONLY_KINDS.includes(r.kind))))
    refuse("HELD", "Project memory and coordination records are context, never authority; cite reviewed policy and evidence.");
  // S10: a reservation, job, occurrence or incident is accounting. Holding a fence or a maintenance record grants nothing.
  if ([input.policyVector, input.approvalPolicyVector ?? [], input.modelPolicyVector ?? []].some(v => v.some(r => MAINTENANCE_KINDS.includes(r.kind))))
    refuse("HELD", "Resource reservations and maintenance records are accounting, never authority; cite reviewed policy.");
  // S09 rollback boundary: a project whose admissions the captain stopped admits no new work. Records of work
  // already admitted (and stops) continue. Absent project records leave the pre-S09 behaviour unchanged.
  const stopped = status.projects?.projects.filter(p => p.state === "stopped" && input.projectIds.includes(p.id)) ?? [];
  if (input.operation === "plan.start" && stopped.length) refuse("HELD", `Admissions are stopped for ${stopped.map(p => p.name).join(", ")}.`);
  if (status.operationHolds.some(h => h.scopeId === input.scopeId && h.planId === input.planId && h.state === "held" && h.operations.includes(input.operation)))
    refuse("HELD", "This operation has a committed admission hold.");
  const rules = applicableRules(status, input), expected = currentPolicyVector(status, input);
  if (!sameVector(input.policyVector, expected)) refuse("STALE", "Policy vector changed; reread the scoped rules.");
  if (!rules.length || input.projectIds.some(p => !rules.some(r => r.effect === "allow" && r.selector.projectIds.includes(p)))) refuse("HELD", "No exact grant for every project constraint.");
  const supersededSources = new Set(status.policySources.flatMap(s => s.supersedes));
  for (const rule of rules) {
    if (rule.effect === "deny") refuse("HELD", "Conflicting or denying policy holds this operation.");
    if (rule.expiresAt && Date.parse(rule.expiresAt) <= Date.parse(now)) refuse("STALE", "Policy grant expired.");
    if (rule.selector.projectIds.some(id => !rule.selector.projectNames[id])) refuse("HELD", "Policy project aliases are incomplete.");
    for (const ref of rule.sources) {
      const source = status.policySources.find(s => s.id === ref.id);
      if (!source || ref.kind !== "policy-source" || supersededSources.has(source.id) || !sameVector([ref], [policyRef("policy-source", source)])) refuse("STALE", "A rule's source version is stale or superseded.");
      await checkPolicySource(home, source!);
    }
    if (input.model && rule.constraints.models.length && !rule.constraints.models.includes(input.model)) refuse("HELD", "Model does not satisfy the intersected policy constraints.");
    if (input.model && rule.constraints.profileDigests.length && (!input.profileDigest || !rule.constraints.profileDigests.includes(input.profileDigest))) refuse("HELD", "Model mode/thinking profile does not satisfy policy.");
  }
  const evidence = input.evidenceVector.map(ref => {
    const row = status.policyEvidence.find(e => e.id === ref.id);
    if (!row || ref.kind !== "policy-evidence" || !sameVector([ref], [policyRef("policy-evidence", row)]) || row.scopeId !== input.scopeId ||
      row.subjectHash !== input.subjectHash || row.head !== input.head || row.artifactHash !== input.artifactHash) refuse("STALE", "Evidence subject, head, artifact or version changed.");
    return row!;
  });
  if (new Set(input.evidenceVector.map(v => v.id)).size !== input.evidenceVector.length) refuse("CONFLICT", "Repeated evidence identity.");
  for (const rule of rules) {
    const c = rule.constraints;
    if (c.requireHead && (!input.head || !evidence.length)) refuse("HELD", "Exact head evidence is required.");
    if (c.requireChecks && (!evidence.length || evidence.some(e => e.checks !== "passed"))) refuse("HELD", "Required checks are failing or unknown.");
    const reviews = evidence.flatMap(e => e.reviews).filter(r => r.outcome === "accepted" && r.head === input.head && r.reviewerId !== r.authorId);
    if (new Set(reviews.map(r => r.reviewerId)).size < c.independentReviews || c.requiredReviewIds.some(id => !reviews.some(r => r.id === id)) ||
      evidence.some(e => e.reviews.some(r => r.outcome === "changes"))) refuse("HELD", "Independent review evidence is incomplete or has blockers.");
    if (c.availability !== "always" && !evidence.some(e => e.availability === c.availability)) refuse("HELD", "Conditional Opus fallback requires observed unavailability evidence.");
    if (c.requireApproval && !issuingApproval) {
      const approval = status.approvals.find(a => a.id === input.approvalId);
      if (!approval || approval.scopeId !== input.scopeId || approval.planId !== input.planId || approval.operation !== (input.approvalOperation ?? input.operation) ||
        !approval.operationTarget || digest(approval.operationTarget) !== digest(input.operationTarget) ||
        approval.revision !== input.revision || approval.subjectHash !== input.subjectHash || approval.head !== input.head || approval.artifactHash !== input.artifactHash ||
        !sameVector(approval.policyVector, input.approvalPolicyVector ?? input.policyVector) || !sameVector(approval.evidenceVector, input.evidenceVector) ||
        (input.model !== null && (approval.profileDigest !== input.profileDigest || !sameVector(approval.modelPolicyVector, input.modelPolicyVector ?? input.policyVector))) ||
        (approval.expiresAt && Date.parse(approval.expiresAt) <= Date.parse(now))) refuse("STALE", "Approval does not bind this operation's current vectors.");
    }
  }
}

/** Selection is explicit data, accepted through a known UI/chat adapter. This is cooperative provenance,
 * not proof of an authenticated human. Raw worker/quoted/memory proposals cannot use this adapter.
 */
export async function acceptPolicyInventory(store: SupervisionStore, home: string, requestId: string, actor: SupervisionActor,
  input: { sources: PolicySource[]; rules: PolicyRule[]; reviewedHolds?: { id: string; version: number }[] }, enabled = false) {
  const data = structuredClone({ sources: input.sources.map(s => PolicySourceSchema.parse(s)), rules: input.rules.map(r => PolicyRuleSchema.parse(r)), reviewedHolds: input.reviewedHolds ?? [] });
  if (!enabled) throw new SupervisionError("UNSUPPORTED", "Pilot policy import is disabled.");
  if (!["captain-ui", "mate-chat"].includes(actor.kind)) throw new SupervisionError("UNSUPPORTED", "Reviewed source acceptance requires explicit UI/chat provenance.");
  return store.transactCommand(requestId, digest(data), actor, async status => {
    if (workflowHomeIdentity(home) !== status.homeId) refuse("CONFLICT", "Policy source and store homes differ.");
    for (const source of data.sources) {
      if (digest(source.provenance) !== digest(actor)) refuse("CONFLICT", "Source acceptance provenance differs from its adapter.");
      await checkPolicySource(home, source);
    }
    const sources = [...status.policySources.filter(s => !data.sources.some(n => n.id === s.id)), ...data.sources];
    for (const rule of data.rules) for (const scopeId of rule.selector.scopeIds) {
      const scope = status.scopes.find(s => s.id === scopeId);
      if (!scope || scope.mode !== "scoped" || rule.selector.projectIds.some(id => !scope.projectIds.includes(id) || !rule.selector.projectNames[id]) ||
        rule.selector.planIds.some(id => !status.backends.some(b => b.planId === id && b.ownerScopeId === scopeId && b.backend === "scoped"))) refuse("CONFLICT", "Policy selector must name registered scoped ownership and exact project aliases.");
    }
    for (const rule of data.rules) for (const ref of rule.sources) {
      const source = sources.find(s => s.id === ref.id);
      if (!source || !sameVector([ref], [policyRef("policy-source", source)])) refuse("STALE", "Rule must bind the selected source exactly.");
    }
    const mutations: SupervisionMutation[] = [...data.sources.map(value => ({ kind: "policy-source" as const, value })), ...data.rules.map(value => ({ kind: "policy-rule" as const, value }))];
    // Instruction changes publish narrow admission holds in the same commit. No notification
    // can observe a new source version while its previously queued operation remains admissible.
    const changedSources = new Set(data.sources.filter(s => status.policySources.some(old => old.id === s.id)).map(s => s.id));
    const affected = status.policyRules.filter(r => r.sources.some(s => changedSources.has(s.id)) || data.rules.some(n => n.id === r.id || n.supersedes.includes(r.id)));
    for (const rule of affected) for (const scopeId of rule.selector.scopeIds) for (const planId of rule.selector.planIds) {
      const h = digest(["policy-hold", rule.id, scopeId, planId]), id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
      const old = status.operationHolds.find(h => h.id === id);
      const updatedRule = data.rules.find(r => r.id === rule.id) ?? rule;
      mutations.push({ kind: "operation-hold", value: { id, version: (old?.version ?? 0) + 1, scopeId, planId, operations: rule.operations,
        sourceVector: [policyRef("policy-rule", updatedRule), ...sources.filter(s => updatedRule.sources.some(ref => ref.id === s.id)).map(s => policyRef("policy-source", s))],
        reason: "Policy source or rule changed; review affected admissions before releasing this hold.", state: "held" } });
    }
    for (const reviewed of data.reviewedHolds) {
      const old = status.operationHolds.find(h => h.id === reviewed.id);
      if (!old || old.version !== reviewed.version || mutations.some(m => m.kind === "operation-hold" && m.value.id === old.id)) refuse("STALE", "Review the current hold after its source update, in a separate explicit receipt.");
      for (const ref of old!.sourceVector) if (ref.kind === "policy-source") {
        const source = sources.find(s => s.id === ref.id);
        if (!source || !sameVector([ref], [policyRef("policy-source", source)])) refuse("STALE", "Hold source changed again.");
        await checkPolicySource(home, source!);
      }
      mutations.push({ kind: "operation-hold", value: { ...old!, version: old!.version + 1, state: "released" } });
    }
    return { mutations, expectedVersions: mutations.map(m => { if (!("value" in m) || !("id" in m.value)) refuse("CONFLICT", "Unexpected policy mutation."); const id = (m as { value: { id: string } }).value.id;
      return { kind: m.kind, id, version: status.versions.find(v => v.kind === m.kind && v.id === id)?.version ?? 0 }; }),
      result: { planId: null, planHash: null, decisionId: null, outboxId: null } };
  });
}

/** S09: the per-project grant picture for one cross-project operation. Constraints intersect; nothing is borrowed
 * from a neighbouring project. Each entry is a real conflict that holds only this operation (`checkPolicy` refuses it
 * independently); the caller records it once for General, while plans of the unaffected projects continue.
 */
export function projectGrantConflicts(status: SupervisionStatus, target: PolicyTarget): { projectId: string; problem: "no-grant" | "denied" | "models-disjoint" }[] {
  const rules = applicableRules(status, target), conflicts: { projectId: string; problem: "no-grant" | "denied" | "models-disjoint" }[] = [];
  for (const projectId of target.projectIds) {
    const own = rules.filter(r => r.selector.projectIds.includes(projectId));
    if (own.some(r => r.effect === "deny")) conflicts.push({ projectId, problem: "denied" });
    else if (!own.some(r => r.effect === "allow")) conflicts.push({ projectId, problem: "no-grant" });
  }
  const lists = rules.filter(r => r.effect === "allow" && r.constraints.models.length).map(r => r.constraints.models);
  if (lists.length > 1 && !lists[0]!.some(m => lists.every(l => l.includes(m))))
    for (const projectId of target.projectIds) if (!conflicts.some(c => c.projectId === projectId)) conflicts.push({ projectId, problem: "models-disjoint" });
  return conflicts;
}
