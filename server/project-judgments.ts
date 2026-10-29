/** Relevant project inputs only. Routine plan outcomes never produce these outboxes. */
import { z } from "zod";
import type { SupervisionActor, SupervisionStatus } from "../shared/supervision";
import type { ScopedCommandResult } from "../shared/supervision-policy";
import { digest } from "./submissions";
import { expectedFor, refuse, stableId } from "./supervision-effects";
import type { SupervisionMutation, SupervisionStore } from "./supervision-store";
const actor: SupervisionActor = { kind: "system", id: "project-judgment-input", source: "relevant stored project state" };
const result = { planId: null, planHash: null, decisionId: null, outboxId: null };
type Input = NonNullable<ScopedCommandResult["projectInput"]>;
function pending(s: SupervisionStatus): Input[] {
  return (s.projects?.projects ?? []).filter(p => p.state === "admitted" && s.bindings.some(b => b.scopeId === p.scopeId && b.state === "active")).flatMap(p => [
    ...(s.projects?.conflicts.filter(c => c.ownerScopeId === p.scopeId && c.state === "open").map(c => ({ kind: "conflict" as const, record: c })) ?? []),
    ...(s.projects?.memoryProposals.filter(m => m.projectId === p.id && m.state === "proposed" && !s.bindings.some(b => b.scopeId === p.scopeId && b.agentId === m.provenance.id)).map(m => ({ kind: "memory-proposal" as const, record: m })) ?? []),
    ...(s.projects?.memory.filter(m => m.projectId === p.id).map(m => ({ kind: "memory" as const, record: m })) ?? []),
  ].map(({ kind, record }) => ({ scopeId: p.scopeId, projectId: p.id, kind, recordId: record.id, recordVersion: record.version, subjectHash: digest(record) })));
}
export class ProjectJudgments {
  constructor(readonly store: SupervisionStore) {}
  async observe() {
    const s = await this.store.read(), scopes = new Set<string>();
    for (const input of pending(s).filter(input => !s.commands.some(c => c.id === stableId("project-input", input))).slice(0, 32)) {
      const id = stableId("project-input", input);
      if (s.commands.some(c => c.id === id)) continue;
      await this.store.transactCommand(id, digest(input), actor, async current => {
        if (!pending(current).some(p => digest(p) === digest(input))) refuse("STALE", "Project input changed before its logical-owner outbox.");
        const mutations: SupervisionMutation[] = [{ kind: "outbox", value: { id, version: 1, ownerScopeId: input.scopeId,
          planId: `project-${input.projectId}`, kind: "plan.command", causationId: id, subjectHash: input.subjectHash,
          decisionId: null, at: new Date().toISOString(), state: "pending", handledEpoch: null, resultRef: null } }];
        return { expectedVersions: expectedFor(current, mutations), mutations, result: { ...result, outboxId: id, projectInput: input } };
      });
      scopes.add(input.scopeId);
    }
    return [...scopes];
  }
  async handle(requestId: string, raw: unknown, owner: SupervisionActor) {
    const input = z.object({ scopeId: z.uuid(), scopeVersion: z.number().int().positive(), epoch: z.number().int().positive(), outboxId: z.uuid(),
      subjectHash: z.string().regex(/^[0-9a-f]{64}$/), evidenceDigest: z.string().regex(/^[0-9a-f]{64}$/), summary: z.string().trim().min(1).max(2000),
      disposition: z.enum(["judged", "source-changed"]).default("judged") }).strict().parse(raw);
    return this.store.transactCommand(requestId, digest(input), owner, async s => {
      const scope = s.scopes.find(v => v.id === input.scopeId), binding = s.bindings.find(b => b.scopeId === input.scopeId), outbox = s.outbox.find(o => o.id === input.outboxId);
      const source = s.commands.find(c => c.id === outbox?.causationId)?.result.projectInput;
      if (s.freshness !== "current" || owner.kind !== "agent" || scope?.kind !== "project" || scope.state !== "active" || scope.version !== input.scopeVersion ||
        binding?.state !== "active" || binding.epoch !== input.epoch || binding.agentId !== owner.id) refuse("UNKNOWN_OWNER", "Only this exact bound project owner may record its judgment.");
      if (!source || !outbox || outbox.ownerScopeId !== scope.id || outbox.state !== "pending" || input.subjectHash !== outbox.subjectHash)
        refuse("STALE", "Project input identity changed; retain the input and reread.");
      const current = pending(s).some(p => digest(p) === digest(source));
      if (current !== (input.disposition === "judged")) refuse("STALE", "A changed source requires an evidenced source-changed disposition; it cannot earn a current judgment.");
      await this.store.readBlob(input.evidenceDigest);
      const mutations: SupervisionMutation[] = [{ kind: "outbox", value: { ...outbox, version: outbox.version + 1, state: "handled", handledEpoch: input.epoch, resultRef: `command:${requestId}` } }];
      return { expectedVersions: expectedFor(s, mutations), mutations, result: { ...result, outboxId: outbox.id,
        projectJudgment: { scopeId: scope.id, epoch: input.epoch, outboxId: outbox.id, subjectHash: input.subjectHash, evidenceDigest: input.evidenceDigest, summary: input.summary, disposition: input.disposition } } };
    });
  }
}
