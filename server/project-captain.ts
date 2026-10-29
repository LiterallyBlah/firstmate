import type { SupervisionActor, SupervisionStatus } from "../shared/supervision";
import type { ScopedAnswer } from "../shared/scoped-commands";
import type { ScopedDecision } from "../shared/supervision-policy";
import { projectCaptainException } from "../shared/project-captain";
import { digest } from "./submissions";
import { checkPolicy, currentPolicyVector } from "./supervision-policy";
import { expectedFor, refuse } from "./supervision-effects";
import type { SupervisionMutation } from "./supervision-store";
export function projectAnswerContext(s: SupervisionStatus, d: ScopedDecision) {
  const e = projectCaptainException(s, d), scope = s.scopes.find(v => v.id === d.ownerScopeId), binding = s.bindings.find(b => b.scopeId === scope?.id);
  if (!e?.current || digest(e.record) !== e.source.subjectHash || !scope || scope.kind !== "project" || !["active", "held"].includes(scope.state) || !binding) return undefined;
  const target = { scopeId: scope.id, planId: d.planId, projectIds: scope.projectIds, hostId: binding.hostId };
  return { homeId: s.homeId, scopeId: scope.id, scopeVersion: scope.version, epoch: binding.epoch, decisionId: d.id,
    expectedPlanHash: digest({ project: e.project, source: e.record }), revision: d.revision, subjectHash: d.subjectHash, dependencyBindings: [],
    policyVector: currentPolicyVector(s, { ...target, operation: "decision.answer" }), modelPolicyVector: [], evidenceVector: [],
    approvalId: null, head: null, artifactHash: null, briefHash: null };
}
export async function prepareProjectAnswer(home: string, s: SupervisionStatus, d: ScopedDecision, a: ScopedAnswer, actor: SupervisionActor, ui: boolean, at: string) {
  const c = projectAnswerContext(s, d), binding = s.bindings.find(b => b.scopeId === d.ownerScopeId);
  if (!c || !binding || a.expectedPlanHash !== c.expectedPlanHash || a.dependencyBindings.length || a.homeId !== s.homeId || !d.options.some(o => o.id === a.option))
    refuse("STALE", "Project captain exception source or answer context changed; retain the draft and reread.");
  if (actor.kind !== "captain-ui" && !(ui && actor.kind === "plugin-ui-unverified") && !(actor.kind === "mate-chat" && a.text.trim()))
    refuse("UNSUPPORTED", "Project captain exceptions require an explicit captain action.");
  const scope = s.scopes.find(v => v.id === d.ownerScopeId)!;
  await checkPolicy(home, s, { scopeId: scope.id, planId: d.planId, projectIds: scope.projectIds, hostId: binding.hostId,
    operation: "decision.answer", policyVector: a.policyVector, evidenceVector: a.evidenceVector, subjectHash: d.subjectHash,
    revision: d.revision, approvalId: a.approvalId, model: null, head: a.head, artifactHash: a.artifactHash,
    operationTarget: { nodeId: d.nodeId, commandHash: digest({ projectAnswer: a }), briefHash: null, dependencyHash: digest([]) } }, at);
  const mutations: SupervisionMutation[] = [{ kind: "decision", value: { ...d, version: d.version + 1, state: "answered", answer: {
    submissionId: a.submissionId, option: a.option, text: a.text, at, provenance: actor, outboxId: a.submissionId } } },
    { kind: "outbox", value: { id: a.submissionId, version: 1, ownerScopeId: scope.id, planId: d.planId, kind: "decision.answer",
      causationId: a.submissionId, subjectHash: d.subjectHash, decisionId: d.id, at, state: "pending", handledEpoch: null, resultRef: null } }];
  return { expectedVersions: expectedFor(s, mutations), mutations, result: { planId: null, planHash: null, decisionId: d.id, outboxId: a.submissionId } };
}
