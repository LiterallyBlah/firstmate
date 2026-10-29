/** Checked project exception context, kept separately from the presentation contract. */
import type { SupervisionStatus } from "./supervision";
import type { ScopedDecision } from "./supervision-policy";
export function projectCaptainException(status: SupervisionStatus, decision: ScopedDecision) {
  const command = status.commands.find(c => c.actor.kind === "agent" && c.result.projectException?.decisionId === decision.id);
  const exception = command?.result.projectException;
  const source = status.commands.find(c => c.id === exception?.sourceCommandId)?.result.projectInput;
  const project = status.projects?.projects.find(p => p.id === exception?.projectId);
  const outbox = status.outbox.find(o => o.id === exception?.inputOutboxId);
  if (!exception || !source || !project || project.scopeId !== decision.ownerScopeId || exception.scopeId !== project.scopeId ||
      decision.planId !== `project-${project.id}` || exception.subjectHash !== decision.subjectHash ||
      source.scopeId !== project.scopeId || source.projectId !== project.id || outbox?.state !== "handled" ||
      outbox.causationId !== exception.sourceCommandId || outbox.subjectHash !== source.subjectHash ||
      command.result.projectJudgment?.outboxId !== outbox.id || command.result.projectJudgment.disposition !== "judged" ||
      !command.result.captainDecisions?.some(c => c.decisionId === decision.id && c.subjectHash === decision.subjectHash && c.origin.kind === "project" && c.origin.id === project.id)) return undefined;
  const record = source.kind === "conflict" ? status.projects?.conflicts.find(c => c.id === source.recordId && c.state === "open") :
    source.kind === "memory-proposal" ? status.projects?.memoryProposals.find(m => m.id === source.recordId && m.state === "proposed") :
    status.projects?.memory.find(m => m.id === source.recordId);
  return { exception, source, project, record, current: status.freshness === "current" && project.state === "admitted" &&
    project.version === exception.projectVersion && record?.version === source.recordVersion };
}
