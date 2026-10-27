/** S09 project context and cross-project coordination records. Disabled: nothing here routes, sends or wakes.
 * Project memory is context only: no record in this file is ever an authority input (see supervision-policy).
 */
import { z } from "zod";
import { PlanId } from "./workflow-plans";
import { SupervisionActorSchema, SupervisionHash, SupervisionUtc, SupervisionUuid, SupervisionVersionRefSchema, type SupervisionStatus } from "./supervision";

const version = z.number().int().positive();
const count = z.number().int().min(0).max(1_000_000);
const text = (max = 256) => z.string().min(1).max(max).refine(s => !!s.trim() && !/[\x00-\x1f\x7f]/.test(s), "Plain one-line text");
const uniqueIds = (min: number) => z.array(SupervisionUuid).min(min).max(64).refine(v => new Set(v).size === v.length, "Repeated identity");
/** Explicit captain/mate adapters only; cooperative provenance, not an authenticated human. */
const reviewed = SupervisionActorSchema.refine(a => a.kind === "captain-ui" || a.kind === "mate-chat", "Explicit captain or mate-recorded provenance required");
export const MemoryKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const normalizedName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** One admitted project. Added individually after D4; `stopped` refuses new admissions and keeps everything. */
export const ProjectRecordSchema = z.object({
  id: SupervisionUuid, version, scopeId: SupervisionUuid, name: text(200), aliases: z.array(text(200)).max(16),
  state: z.enum(["admitted", "stopped"]),
  /** Captain-set allocation. Null is unknown: nothing can be granted against it, and it never reads as zero. */
  budget: z.object({ agents: count, turns: count }).strict().nullable(),
  /** The reviewed policy sources this admission rests on (D4 import). Admission grants no operation by itself. */
  sourceVector: z.array(SupervisionVersionRefSchema).min(1).max(64), provenance: reviewed,
}).strict();
/** One sponsor per plan scope, with an all-or-none per-project budget claim. No automatic borrowing. */
export const PlanSponsorSchema = z.object({
  id: SupervisionUuid, version, sponsorScopeId: SupervisionUuid, projectIds: uniqueIds(1),
  claims: z.array(z.object({ projectId: SupervisionUuid, agents: count, turns: count, priority: z.number().int().min(1).max(9) }).strict()).min(1).max(64),
  /** Journal sequence at claim: FIFO order within a priority. Immutable. */
  queuedAt: version, state: z.enum(["queued", "granted", "released"]), provenance: SupervisionActorSchema,
}).strict();
/** A captain intake routed once. Its ID derives from home and intake message, so forwarding twice is one row. */
export const IntentSchema = z.object({
  id: SupervisionUuid, version, intakeId: text(300), textDigest: SupervisionHash, ownerScopeId: SupervisionUuid, projectIds: uniqueIds(1),
  tasks: z.array(z.object({ hostId: text(), projectId: SupervisionUuid, nodeId: PlanId }).strict()).max(100),
  state: z.enum(["claimed", "released"]), provenance: SupervisionActorSchema,
}).strict();
/** A resolution attached to an unchanged v1 bare edge. Historical definitions are never rewritten. */
export const DependencyResolutionSchema = z.object({
  id: SupervisionUuid, version, scopeId: SupervisionUuid, planId: PlanId, nodeId: PlanId,
  edge: z.object({ node: PlanId, on: z.enum(["done", "landed", "answered"]) }).strict(),
  target: z.object({ homeId: text(1024), planId: PlanId, nodeId: PlanId, projectId: SupervisionUuid.nullable(),
    planHash: SupervisionHash, revision: version, attemptId: SupervisionUuid.nullable() }).strict().nullable(),
  state: z.enum(["resolved", "held"]), reason: z.enum(["exact", "missing", "ambiguous", "removed", "cross-backend"]),
}).strict().refine(r => (r.state === "resolved") === (r.target !== null && r.reason === "exact"), "Only an exact target resolves.");
export const MemoryProposalSchema = z.object({
  id: SupervisionUuid, version, scopeId: SupervisionUuid, projectId: SupervisionUuid, key: MemoryKey,
  /** CAS: the memory entry's version this proposal was written against (0 = new key). */
  expectedVersion: z.number().int().min(0), textDigest: SupervisionHash, bytes: z.number().int().min(1).max(16384),
  evidence: z.array(z.object({ ref: text(1024), digest: SupervisionHash }).strict()).max(32), provenance: SupervisionActorSchema,
  state: z.enum(["proposed", "accepted", "rejected"]), decision: z.object({ actor: SupervisionActorSchema, at: SupervisionUtc }).strict().nullable(),
}).strict().refine(p => (p.state === "proposed") === (p.decision === null), "A decided proposal records who decided it.");
export const ProjectMemorySchema = z.object({
  id: SupervisionUuid, version, scopeId: SupervisionUuid, projectId: SupervisionUuid, key: MemoryKey,
  proposalId: SupervisionUuid, textDigest: SupervisionHash,
  /** Accepted memory is context for the project's judgment. It is never a policy, approval or evidence input. */
  authority: z.literal("none"),
}).strict();
/** An unresolved scope/priority/budget/grant choice. Cross-project choices belong to General; one-project ones to that project. */
export const PortfolioConflictSchema = z.object({
  id: SupervisionUuid, version, ownerScopeId: SupervisionUuid, kind: z.enum(["sponsor", "scope", "priority", "budget", "grant"]),
  projectIds: uniqueIds(1), subjects: z.array(z.object({ kind: z.enum(["plan-scope", "intent", "task", "project"]), id: text(1024) }).strict()).min(1).max(32),
  detail: text(2000), detailDigest: SupervisionHash, state: z.enum(["open", "resolved"]),
  resolution: z.object({ actor: reviewed, choice: z.string().min(1).max(2000), at: SupervisionUtc }).strict().nullable(),
}).strict().refine(c => (c.state === "resolved") === (c.resolution !== null), "A resolved conflict records its choice.");
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;
export type PlanSponsor = z.infer<typeof PlanSponsorSchema>;
export type Intent = z.infer<typeof IntentSchema>;
export type DependencyResolution = z.infer<typeof DependencyResolutionSchema>;
export type MemoryProposal = z.infer<typeof MemoryProposalSchema>;
export type ProjectMemory = z.infer<typeof ProjectMemorySchema>;
export type PortfolioConflict = z.infer<typeof PortfolioConflictSchema>;
export interface ProjectRows {
  projects: ProjectRecord[]; sponsors: PlanSponsor[]; intents: Intent[]; dependencies: DependencyResolution[];
  memoryProposals: MemoryProposal[]; memory: ProjectMemory[]; conflicts: PortfolioConflict[];
}
/** Row kinds that are context only and must never appear in a policy, approval or evidence vector. */
export const CONTEXT_ONLY_KINDS: readonly string[] = ["project", "plan-sponsor", "intent", "dependency-resolution", "memory-proposal", "project-memory", "portfolio-conflict"];
export const emptyProjectRows = (): ProjectRows => ({ projects: [], sponsors: [], intents: [], dependencies: [], memoryProposals: [], memory: [], conflicts: [] });

export interface PortfolioSummary {
  format: "firstmate.portfolio/1"; homeId: string; sequence: number; freshness: SupervisionStatus["freshness"];
  /** True when the stored projection is held/uninitialized: counts are a lower bound, never fresh-looking. */
  lowerBound: boolean; problems: string[];
  projects: { id: string; name: string; state: ProjectRecord["state"]; scopeId: string;
    budget: { agents: number; turns: number } | null; granted: { agents: number; turns: number }; queued: number;
    plans: number; memory: { entries: number; pending: number }; conflicts: number }[];
  crossProject: { scopeId: string; planId: string | null; projectIds: string[]; sponsorScopeId: string | null; sponsor: "general" | "project" | "none"; claim: PlanSponsor["state"] | "none" }[];
  /** Only unresolved cross-project scope/priority/budget/grant choices. Never plan progress or routine facts. */
  general: { conflicts: { id: string; kind: PortfolioConflict["kind"]; detail: string; projectIds: string[] }[]; unsponsored: string[] };
  dependencies: { held: number; resolved: number };
}

const sum = (claims: { agents: number; turns: number }[]) => claims.reduce((t, c) => ({ agents: t.agents + c.agents, turns: t.turns + c.turns }), { agents: 0, turns: 0 });
/** Pure read of the stored projection. No timeline, model, session or resource is read or created. */
export function portfolioSummary(status: SupervisionStatus): PortfolioSummary {
  const rows = status.projects ?? emptyProjectRows();
  const general = status.scopes.filter(s => s.kind === "general" && s.state !== "retired").map(s => s.id);
  const plans = status.scopes.filter(s => s.kind === "plan");
  const planOf = (scopeId: string) => status.backends.find(b => b.ownerScopeId === scopeId)?.planId ?? null;
  const open = rows.conflicts.filter(c => c.state === "open");
  const crossProject = plans.filter(s => s.projectIds.length > 1 && s.state !== "retired").map(s => {
    const sponsor = rows.sponsors.find(r => r.id === s.id && r.state !== "released");
    const kind = !sponsor ? "none" as const : general.includes(sponsor.sponsorScopeId) ? "general" as const : "project" as const;
    return { scopeId: s.id, planId: planOf(s.id), projectIds: [...s.projectIds], sponsorScopeId: sponsor?.sponsorScopeId ?? null, sponsor: kind, claim: sponsor?.state ?? "none" as const };
  });
  return {
    format: "firstmate.portfolio/1", homeId: status.homeId, sequence: status.sequence, freshness: status.freshness,
    lowerBound: status.freshness !== "current", problems: [...status.problems],
    projects: rows.projects.map(p => ({ id: p.id, name: p.name, state: p.state, scopeId: p.scopeId, budget: p.budget,
      granted: sum(rows.sponsors.filter(s => s.state === "granted").flatMap(s => s.claims.filter(c => c.projectId === p.id))),
      queued: rows.sponsors.filter(s => s.state === "queued" && s.projectIds.includes(p.id)).length,
      plans: plans.filter(s => s.projectIds.includes(p.id) && s.state !== "retired").length,
      memory: { entries: rows.memory.filter(m => m.projectId === p.id).length, pending: rows.memoryProposals.filter(m => m.projectId === p.id && m.state === "proposed").length },
      conflicts: open.filter(c => c.projectIds.includes(p.id)).length })),
    crossProject,
    general: { conflicts: open.filter(c => general.includes(c.ownerScopeId)).map(c => ({ id: c.id, kind: c.kind, detail: c.detail, projectIds: [...c.projectIds] })),
      unsponsored: crossProject.filter(p => p.sponsor === "none").map(p => p.planId ?? p.scopeId) },
    dependencies: { held: rows.dependencies.filter(d => d.state === "held").length, resolved: rows.dependencies.filter(d => d.state === "resolved").length },
  };
}
