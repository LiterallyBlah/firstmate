/** Pure S09 row checks, used at append AND replay by the S01 journal (beside the S02 inbox and S08 source checks). */
import type { SupervisionCode, SupervisionScope } from "../shared/supervision";
import {
  DependencyResolutionSchema, IntentSchema, MemoryProposalSchema, normalizedName, PlanSponsorSchema, PortfolioConflictSchema,
  ProjectMemorySchema, ProjectRecordSchema, type DependencyResolution, type Intent, type MemoryProposal, type PlanSponsor,
  type PortfolioConflict, type ProjectMemory, type ProjectRecord,
} from "../shared/supervision-projects";
import { digest } from "./submissions";

type Frame = { kind: string; id: string; version: number; value: unknown };
type Fail = (code: SupervisionCode, message: string) => never;
const PROJECT_KINDS = new Set(["project", "plan-sponsor", "intent", "dependency-resolution", "memory-proposal", "project-memory", "portfolio-conflict"]);
const frameKey = (kind: string, id: string) => JSON.stringify([kind, id]);
/** Deterministic v4-shaped identity, so the same logical record is one row however often it is proposed. */
export function projectRowId(...parts: unknown[]): string {
  const h = digest(["firstmate.supervision-projects/1", ...parts]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const intentId = (homeId: string, intakeId: string) => projectRowId("intent", homeId, intakeId);
export const memoryId = (projectId: string, key: string) => projectRowId("memory", projectId, key);
export const dependencyResolutionId = (planId: string, nodeId: string, edgeNode: string) => projectRowId("dependency", planId, nodeId, edgeNode);
export const conflictId = (kind: string, subjects: readonly { kind: string; id: string }[]) =>
  projectRowId("conflict", kind, [...subjects].map(s => `${s.kind}:${s.id}`).sort());
export const taskKey = (t: { hostId: string; projectId: string; nodeId: string }) => JSON.stringify([t.hostId.trim().toLowerCase(), t.projectId, t.nodeId]);
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const without = <T extends object>(value: T, ...keys: string[]) => Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k)));

export function validateProjectChange(kind: string, value: unknown, prior: unknown, fail: Fail): void {
  if (kind === "project") {
    const row = value as ProjectRecord, old = prior as ProjectRecord | undefined;
    if (old && (old.scopeId !== row.scopeId || normalizedName(old.name) !== normalizedName(row.name))) fail("CONFLICT", "A project keeps its scope and name; a different project is a new admission.");
  }
  if (kind === "plan-sponsor") {
    const row = value as PlanSponsor, old = prior as PlanSponsor | undefined;
    if (!old || old.state === "released") {
      if (row.state === "released") fail("CONFLICT", "A sponsor claim starts queued or granted.");
    } else {
      if (digest(without(old, "version", "state")) !== digest(without(row, "version", "state"))) fail("CONFLICT", "A sponsor, its project set and budget claim are fixed while the claim stands; release it first.");
      if (!({ queued: ["queued", "granted", "released"], granted: ["granted", "released"] } as Record<string, string[]>)[old.state]?.includes(row.state))
        fail("HELD", "A granted claim is released, never returned to the queue.");
    }
  }
  if (kind === "intent") {
    const row = value as Intent, old = prior as Intent | undefined;
    if (!old && row.state !== "claimed") fail("CONFLICT", "An intent is claimed before it can be released.");
    if (old && (digest(without(old, "version", "state")) !== digest(without(row, "version", "state")) || (old.state === "released" && row.state !== "released")))
      fail("CONFLICT", "One captain intake has one owner; it is not re-forwarded or reassigned.");
  }
  if (kind === "dependency-resolution") {
    const row = value as DependencyResolution, old = prior as DependencyResolution | undefined;
    if (old && digest([old.scopeId, old.planId, old.nodeId, old.edge]) !== digest([row.scopeId, row.planId, row.nodeId, row.edge]))
      fail("CONFLICT", "A resolution stays attached to its original bare edge.");
  }
  if (kind === "memory-proposal") {
    const row = value as MemoryProposal, old = prior as MemoryProposal | undefined;
    if (!old && row.state !== "proposed") fail("CONFLICT", "Memory is proposed before it can be decided.");
    if (old && (old.state !== "proposed" || digest(without(old, "version", "state", "decision")) !== digest(without(row, "version", "state", "decision"))))
      fail("HELD", "A memory proposal's text, evidence and provenance are fixed, and a decision is final.");
  }
  if (kind === "project-memory") {
    const row = value as ProjectMemory, old = prior as ProjectMemory | undefined;
    if (old && (old.projectId !== row.projectId || old.key !== row.key || old.scopeId !== row.scopeId)) fail("CONFLICT", "A memory entry keeps its project and key.");
  }
  if (kind === "portfolio-conflict") {
    const row = value as PortfolioConflict, old = prior as PortfolioConflict | undefined;
    if (!old && row.state !== "open") fail("CONFLICT", "A conflict opens before it is resolved.");
    if (old && (old.state === "resolved" || old.ownerScopeId !== row.ownerScopeId || old.kind !== row.kind || digest(old.subjects) !== digest(row.subjects)))
      fail("HELD", "A conflict keeps its owner and subjects, and a recorded choice is final.");
  }
}

export function validateProjectRows(frames: Map<string, Frame>, fail: Fail): void {
  const get = (k: string, id: string) => frames.get(frameKey(k, id))?.value;
  const scope = (id: string) => get("scope", id) as SupervisionScope | undefined;
  const byKind = new Map<string, unknown[]>();
  for (const f of frames.values()) if (PROJECT_KINDS.has(f.kind)) { const list = byKind.get(f.kind); if (list) list.push(f.value); else byKind.set(f.kind, [f.value]); }
  // Pre-S09 journals pay one pass and nothing else.
  if (!byKind.size) return;
  for (const f of frames.values()) if (f.kind === "task") { const list = byKind.get("task"); if (list) list.push(f.value); else byKind.set("task", [f.value]); }
  const rows = <T>(k: string) => (byKind.get(k) ?? []) as T[];
  const projects = rows<ProjectRecord>("project"), sponsors = rows<PlanSponsor>("plan-sponsor"), names = new Set<string>();
  for (const row of projects) {
    ProjectRecordSchema.parse(row);
    const owner = scope(row.scopeId);
    if (owner?.kind !== "project" || !owner.projectIds.includes(row.id)) fail("UNKNOWN_OWNER", "A project is admitted under its own registered project scope.");
    for (const name of [row.name, ...row.aliases].map(normalizedName)) {
      if (names.has(name)) fail("CONFLICT", `Project name or alias "${name}" names two projects.`); names.add(name);
    }
    const granted = sponsors.filter(s => s.state === "granted").flatMap(s => s.claims.filter(c => c.projectId === row.id));
    const used = granted.reduce((t, c) => ({ agents: t.agents + c.agents, turns: t.turns + c.turns }), { agents: 0, turns: 0 });
    if (granted.length && (!row.budget || used.agents > row.budget.agents || used.turns > row.budget.turns))
      fail("CONFLICT", "Granted plan claims exceed the project's allocation; no claim borrows another project's budget.");
  }
  for (const row of sponsors) {
    PlanSponsorSchema.parse(row);
    const plan = scope(row.id), sponsor = scope(row.sponsorScopeId);
    if (plan?.kind !== "plan") fail("UNKNOWN_OWNER", "A sponsor claim names a registered plan scope.");
    if (!sponsor || !["general", "project"].includes(sponsor.kind) || (sponsor.kind === "project" && !sponsor.projectIds.some(p => plan.projectIds.includes(p))))
      fail("UNKNOWN_OWNER", "A sponsor is General or one of the plan's own project scopes.");
    if (!same(row.claims.map(c => c.projectId), row.projectIds) || row.projectIds.some(id => !get("project", id))) fail("CONFLICT", "A claim names each admitted project of the plan exactly once.");
    if (row.state !== "released" && (plan.sponsorId !== row.sponsorScopeId || !same(plan.projectIds, row.projectIds)))
      fail("CONFLICT", "A plan has exactly one sponsor, recorded on its scope, for its current project set.");
  }
  const tasks = rows<{ id: string; ownerScopeId: string; projectId: string; nodeId: string; hostId: string }>("task");
  const claimed = new Map<string, string>();
  for (const row of rows<Intent>("intent")) {
    IntentSchema.parse(row);
    const owner = scope(row.ownerScopeId);
    if (owner?.kind !== "plan" || row.projectIds.some(p => !owner.projectIds.includes(p)) || row.tasks.some(t => !row.projectIds.includes(t.projectId)))
      fail("UNKNOWN_OWNER", "An intent is owned by one plan scope covering its projects and tasks.");
    if (row.state !== "claimed") continue;
    for (const t of row.tasks) {
      const k = taskKey(t), other = claimed.get(k);
      if (other !== undefined && other !== row.ownerScopeId) fail("CONFLICT", "Two intents claim one task for different owners; this is a scope choice.");
      claimed.set(k, row.ownerScopeId);
      const task = tasks.find(x => taskKey(x) === k);
      if (task && task.ownerScopeId !== row.ownerScopeId) fail("CONFLICT", "An intent cannot claim a task another scope already owns.");
    }
  }
  for (const row of rows<DependencyResolution>("dependency-resolution")) {
    DependencyResolutionSchema.parse(row);
    const backend = get("backend", row.planId) as { ownerScopeId?: string } | undefined, owner = scope(row.scopeId);
    if (owner?.kind !== "plan" || backend?.ownerScopeId !== row.scopeId) fail("UNKNOWN_OWNER", "A dependency resolution belongs to the dependent plan's owner.");
    if (row.target && row.target.homeId !== owner.homeId) fail("CONFLICT", "A qualified dependency names a plan in this home.");
  }
  const proposals = rows<MemoryProposal>("memory-proposal");
  const projectOf = (scopeId: string, projectId: string) => {
    const project = get("project", projectId) as ProjectRecord | undefined;
    if (!project || project.scopeId !== scopeId) fail("UNKNOWN_OWNER", "Project memory belongs to its admitted project's scope.");
  };
  for (const row of proposals) {
    MemoryProposalSchema.parse(row); projectOf(row.scopeId, row.projectId);
    if (!get("blob", row.textDigest)) fail("HELD", "Memory text must be committed evidence before it is proposed.");
  }
  for (const row of rows<ProjectMemory>("project-memory")) {
    ProjectMemorySchema.parse(row); projectOf(row.scopeId, row.projectId);
    const proposal = proposals.find(p => p.id === row.proposalId);
    if (!proposal || proposal.state !== "accepted" || proposal.projectId !== row.projectId || proposal.key !== row.key || proposal.textDigest !== row.textDigest ||
      proposal.expectedVersion !== row.version - 1) fail("CONFLICT", "Memory changes only through an accepted proposal written against its exact previous version.");
  }
  for (const row of rows<PortfolioConflict>("portfolio-conflict")) {
    PortfolioConflictSchema.parse(row);
    const owner = scope(row.ownerScopeId);
    if (!owner) fail("UNKNOWN_OWNER", "A conflict needs a registered owner.");
    if (row.projectIds.length > 1 ? owner.kind !== "general" : owner.kind !== "project" || !owner.projectIds.includes(row.projectIds[0]!))
      fail("CONFLICT", "Cross-project choices belong to General; a one-project choice belongs to that project.");
  }
}
