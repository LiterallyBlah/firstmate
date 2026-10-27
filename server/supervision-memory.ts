/** Disabled S09 project memory: provenance-bound proposals and compare-and-set acceptance.
 * Memory is the project's context. It is never a policy source, grant, approval or evidence input (`checkPolicy`
 * refuses any memory reference), so accepting or changing it cannot authorize an effect. Nothing here wakes a scope.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SupervisionActorSchema, SupervisionHash, SupervisionUuid, type SupervisionActor, type SupervisionStatus } from "../shared/supervision";
import { emptyProjectRows, MemoryKey, type MemoryProposal, type ProjectMemory } from "../shared/supervision-projects";
import { digest } from "./submissions";
import { SupervisionError, SUPERVISION_INDEX_LIMITS, type SupervisionMutation, type SupervisionStore } from "./supervision-store";
import { memoryId } from "./supervision-project-state";
import { boundTo, expected } from "./supervision-projects";

function refuse(code: "STALE" | "HELD" | "UNKNOWN_OWNER" | "UNSUPPORTED" | "CONFLICT", message: string): never { throw new SupervisionError(code, message); }
const rowsOf = (status: SupervisionStatus) => status.projects ?? emptyProjectRows();
const versionOf = (status: SupervisionStatus, kind: string, id: string) => status.versions.find(v => v.kind === kind && v.id === id)?.version ?? 0;
export const MEMORY_TEXT_LIMIT = 16384;
export const MemoryProposeSchema = z.object({ projectId: SupervisionUuid, key: MemoryKey, expectedVersion: z.number().int().min(0),
  text: z.string().min(1).max(MEMORY_TEXT_LIMIT), evidence: z.array(z.object({ ref: z.string().min(1).max(1024), digest: SupervisionHash }).strict()).max(32) }).strict();
export const MemoryDecideSchema = z.object({ proposalId: SupervisionUuid, proposalVersion: z.number().int().positive(),
  decision: z.enum(["accept", "reject"]), memoryVersion: z.number().int().min(0) }).strict();

export class SupervisionMemory {
  constructor(readonly store: SupervisionStore, private readonly options: { enabled?: boolean; now?: () => string } = {}) {}
  private enabled() { if (!this.options.enabled) refuse("UNSUPPORTED", "S09 project memory is disabled."); }

  /** Anyone with provenance may propose (a worker's report included). The words are stored as committed, quoted
   * evidence, bound to the entry version they were written against. A proposal changes nothing on its own.
   */
  async propose(actorInput: SupervisionActor, raw: z.input<typeof MemoryProposeSchema>, requestId: string = randomUUID()): Promise<{ proposalId: string }> {
    this.enabled();
    const input = MemoryProposeSchema.parse(raw), actor = structuredClone(SupervisionActorSchema.parse(actorInput));
    const bytes = Buffer.from(input.text, "utf8");
    if (bytes.length > MEMORY_TEXT_LIMIT) refuse("HELD", "Memory text is over its 16 KiB bound.");
    const blob = await this.store.putBlob(bytes);
    await this.store.transactCommand(requestId, digest({ op: "memory.propose", input }), actor, async status => {
      if (status.freshness !== "current" || status.sequence >= SUPERVISION_INDEX_LIMITS.admissions) refuse("HELD", "Memory proposals wait while the journal is held or past its admission bound.");
      const project = rowsOf(status).projects.find(p => p.id === input.projectId);
      if (!project) refuse("UNKNOWN_OWNER", "Memory belongs to an admitted project.");
      if (project.state !== "admitted") refuse("HELD", `Admissions for ${project.name} are stopped; existing memory and proposals are retained.`);
      if (input.expectedVersion > versionOf(status, "project-memory", memoryId(project.id, input.key))) refuse("STALE", "That memory version does not exist; reread the entry.");
      if (actor.kind === "system") refuse("UNSUPPORTED", "A proposal needs a named proposer.");
      const proposal: MemoryProposal = { id: requestId, version: 1, scopeId: project.scopeId, projectId: project.id, key: input.key,
        expectedVersion: input.expectedVersion, textDigest: blob.id, bytes: blob.bytes, evidence: input.evidence, provenance: actor, state: "proposed", decision: null };
      const mutations: SupervisionMutation[] = [...(status.versions.some(v => v.kind === "blob" && v.id === blob.id) ? [] : [{ kind: "blob" as const, value: blob }]),
        { kind: "memory-proposal", value: proposal }];
      return { expectedVersions: expected(status, mutations), mutations,
        result: { planId: null, planHash: null, decisionId: null, outboxId: null } };
    });
    return { proposalId: requestId };
  }

  /** Accept (compare-and-set) or reject one proposal. Only the project's bound owner or the captain decides.
   * Accepting requires the entry to still be at the version the proposal was written against; otherwise STALE,
   * and the proposal stays pending for a fresh proposal against the current text. No outbox, offer or wake.
   */
  async decide(requestId: string, actorInput: SupervisionActor, raw: z.input<typeof MemoryDecideSchema>) {
    this.enabled();
    const input = MemoryDecideSchema.parse(raw), actor = structuredClone(SupervisionActorSchema.parse(actorInput));
    return this.store.transactCommand(requestId, digest({ op: "memory.decide", input }), actor, async status => {
      const proposal = rowsOf(status).memoryProposals.find(p => p.id === input.proposalId);
      if (!proposal) refuse("UNKNOWN_OWNER", "No such memory proposal.");
      if (proposal.version !== input.proposalVersion || proposal.state !== "proposed") refuse("STALE", "This proposal was already decided or changed.");
      const project = rowsOf(status).projects.find(p => p.id === proposal.projectId);
      if (!project) refuse("UNKNOWN_OWNER", "The project is not admitted.");
      if (!(actor.kind === "captain-ui" || actor.kind === "mate-chat" || boundTo(status, actor, [project.scopeId])))
        refuse("UNKNOWN_OWNER", "Only the project's bound owner or the captain decides its memory.");
      const decided: MemoryProposal = { ...proposal, version: proposal.version + 1, state: input.decision === "accept" ? "accepted" : "rejected",
        decision: { actor, at: this.options.now?.() ?? new Date().toISOString() } };
      const mutations: SupervisionMutation[] = [{ kind: "memory-proposal", value: decided }];
      if (input.decision === "accept") {
        if (project.state !== "admitted" || status.sequence >= SUPERVISION_INDEX_LIMITS.admissions) refuse("HELD", "Memory acceptance waits while project admissions are stopped or the journal is past its admission bound.");
        const id = memoryId(project.id, proposal.key), current = versionOf(status, "project-memory", id);
        if (current !== input.memoryVersion || current !== proposal.expectedVersion) refuse("STALE", "The memory entry changed since this proposal was written; propose again against the current text.");
        const entry: ProjectMemory = { id, version: current + 1, scopeId: project.scopeId, projectId: project.id, key: proposal.key,
          proposalId: proposal.id, textDigest: proposal.textDigest, authority: "none" };
        mutations.push({ kind: "project-memory", value: entry });
      }
      return { expectedVersions: expected(status, mutations),
        mutations, result: { planId: null, planHash: null, decisionId: null, outboxId: null } };
    });
  }
}

/** Read-only: one project's accepted entries (by content digest) and pending proposals. */
export function projectMemory(status: SupervisionStatus, projectId: string) {
  const rows = rowsOf(status);
  return { entries: rows.memory.filter(m => m.projectId === projectId).sort((a, b) => a.key.localeCompare(b.key)),
    pending: rows.memoryProposals.filter(p => p.projectId === projectId && p.state === "proposed") };
}
