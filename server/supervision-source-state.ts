/** Pure S08 row checks, used at append AND replay by the S01 journal (beside the S02 inbox checks). */
import type { SupervisionCode, SupervisionStatus } from "../shared/supervision";
import { BoardSubmissionSchema, SourceBindingSchema, pullRequestBindingKey, type BoardSubmission, type SourceBinding } from "../shared/supervision-sources";
type InboxFrame = { kind: string; id: string; version: number; value: unknown };
const inboxKey = (kind: string, id: string) => JSON.stringify([kind, id]);
import { digest } from "./submissions";

type Fail = (code: SupervisionCode, message: string) => never;
export const sourceBindingId = (repository: string, pr: number) => digest(pullRequestBindingKey(repository, pr));

/** The exact registered owner of a pull request subject. A retired binding keeps history, not routing. */
export function pullRequestOwners(subject: { repositoryId?: string | undefined; pr?: number | undefined; attemptId?: string | undefined },
  tasks: SupervisionStatus["tasks"], attempts: SupervisionStatus["attempts"], bindings: readonly SourceBinding[]) {
  if (!subject.repositoryId || subject.pr === undefined) return [];
  const id = sourceBindingId(subject.repositoryId, subject.pr);
  return bindings.filter(b => b.id === id && b.state === "active" && (!subject.attemptId || subject.attemptId === b.attemptId)).flatMap(b => {
    const attempt = attempts.find(a => a.id === b.attemptId), task = tasks.find(t => t.id === b.taskId);
    return attempt && task && attempt.taskId === task.id && task.ownerScopeId === b.scopeId ? [{ attempt, task, scopeId: b.scopeId }] : [];
  });
}

export function validateSourceChange(kind: string, value: unknown, prior: unknown, frames: Map<string, InboxFrame>, fail: Fail) {
  const get = (k: string, id: string) => frames.get(inboxKey(k, id))?.value as Record<string, unknown> | undefined;
  if (kind === "source-binding") {
    const row = value as SourceBinding, old = prior as SourceBinding | undefined;
    if (row.id !== sourceBindingId(row.repository, row.pr)) fail("CONFLICT", "Pull request binding identity is derived from its repository and number.");
    if (old) {
      if (["repository", "pr", "scopeId", "taskId", "kind"].some(k => old[k as keyof SourceBinding] !== row[k as keyof SourceBinding]))
        fail("CONFLICT", "A pull request keeps its owning scope and task; transfer requires a checked migration.");
      if (old.state === "retired" && row.state !== "retired") fail("HELD", "A retired pull request binding cannot route again.");
      if (old.attemptId !== row.attemptId) {
        const before = get("attempt", old.attemptId), after = get("attempt", row.attemptId);
        if (!before || !after || after.taskId !== row.taskId || Number(after.ordinal) <= Number(before.ordinal))
          fail("STALE", "A pull request moves only to a later attempt of the same task.");
      }
    }
  }
  if (kind === "board-submission") {
    const row = value as BoardSubmission, old = prior as BoardSubmission | undefined;
    if (!old) {
      const binding = get("binding", row.scopeId);
      if (row.state !== "reserved" || row.correlation) fail("HELD", "A board submission is reserved before its send and correlated only afterwards.");
      if (!binding || binding.epoch !== row.epoch || binding.state === "retired") fail("STALE", "A board submission targets the owning scope's current binding epoch.");
    } else {
      const { state: _s, correlation: _c, version: _v, ...identity } = row, { state: _os, correlation: _oc, version: _ov, ...oldIdentity } = old;
      const transitions: Record<string, string[]> = { reserved: ["reserved", "accepted", "uncertain", "failed"], accepted: ["accepted"],
        uncertain: ["uncertain", "accepted"], failed: ["failed"] };
      if (digest(identity) !== digest(oldIdentity) || !transitions[old.state]?.includes(row.state) ||
        (old.correlation && digest(old.correlation) !== digest(row.correlation))) fail("HELD", "Board submission identity, send outcome and correlation are retained.");
      // An uncertain send becomes accepted only on typed evidence that the worker read this exact message.
      if (old.state === "uncertain" && row.state === "accepted" && row.correlation?.certainty !== "verified")
        fail("HELD", "Only a typed clientMessageId read settles an uncertain board send.");
    }
    if (row.correlation && !["accepted", "uncertain"].includes(row.state)) fail("HELD", "Only a sent board message can be correlated to a turn.");
  }
}

export function validateSourceRows(frames: Map<string, InboxFrame>, fail: Fail) {
  const get = (k: string, id: string) => frames.get(inboxKey(k, id))?.value as Record<string, unknown> | undefined;
  const messages = new Set<string>();
  for (const frame of frames.values()) {
    if (frame.kind === "source-binding") {
      const row = SourceBindingSchema.parse(frame.value), attempt = get("attempt", row.attemptId), task = get("task", row.taskId), scope = get("scope", row.scopeId);
      if (!attempt || !task || attempt.taskId !== row.taskId || task.ownerScopeId !== row.scopeId) fail("UNKNOWN_OWNER", "A pull request binding needs its exact registered attempt and task owner.");
      if (row.state === "active" && scope?.mode !== "scoped") fail("UNKNOWN_OWNER", "Only a scoped owner can receive pull request evidence.");
    }
    if (frame.kind === "board-submission") {
      const row = BoardSubmissionSchema.parse(frame.value), attempt = get("attempt", row.attemptId), task = get("task", row.taskId);
      const worker = attempt?.worker as { hostId: string; agentId: string } | null | undefined;
      if (!attempt || !task || attempt.taskId !== row.taskId || task.ownerScopeId !== row.scopeId || worker?.hostId.trim().toLowerCase() !== "local" || worker.agentId !== row.agentId)
        fail("UNKNOWN_OWNER", "A board submission targets an exact registered local attempt.");
      if (row.payloadRef !== `blob:${row.textDigest}` || !get("blob", row.textDigest)) fail("HELD", "Board submission words must be committed evidence.");
      if (messages.has(row.messageId)) fail("CONFLICT", "A captain message ID names one submission."); messages.add(row.messageId);
      if (row.correlation) {
        const event = get("inbox-event", row.correlation.eventId) as { envelope?: { subject?: { agentId?: string } } } | undefined;
        if (event?.envelope?.subject?.agentId !== row.agentId) fail("CONFLICT", "Board correlation must name its committed exchange event.");
      }
    }
  }
}
