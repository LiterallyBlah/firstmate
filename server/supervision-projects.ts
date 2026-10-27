/** Disabled S09 project context and cross-project coordination seam. No RPC registration, executor, send or wake.
 * Every write is a checked journal transaction; reads are pure projections of the stored status.
 */
import { z } from "zod";
import { SupervisionActorSchema, SupervisionUuid, SupervisionVersionRefSchema, type SupervisionActor, type SupervisionExpected, type SupervisionStatus } from "../shared/supervision";
import { PlanId, type WorkflowPlan } from "../shared/workflow-plans";
import {
  emptyProjectRows, normalizedName, portfolioSummary, type DependencyResolution, type PlanSponsor, type PortfolioConflict,
  type PortfolioSummary, type ProjectRecord,
} from "../shared/supervision-projects";
import { digest } from "./submissions";
import { SupervisionError, SUPERVISION_INDEX_LIMITS, type SupervisionMutation, type SupervisionStore } from "./supervision-store";
import { conflictId, dependencyResolutionId, intentId, taskKey } from "./supervision-project-state";
import { policyRef, projectGrantConflicts, sameVector, type PolicyTarget } from "./supervision-policy";

type Code = "STALE" | "HELD" | "UNKNOWN_OWNER" | "UNSUPPORTED" | "CONFLICT";
function refuse(code: Code, message: string): never { throw new SupervisionError(code, message); }
const emptyResult = () => ({ planId: null, planHash: null, decisionId: null, outboxId: null });
const rowsOf = (status: SupervisionStatus) => status.projects ?? emptyProjectRows();
const versionOf = (status: SupervisionStatus, kind: SupervisionExpected["kind"], id: string) => status.versions.find(v => v.kind === kind && v.id === id)?.version ?? 0;
export const expected = (status: SupervisionStatus, mutations: SupervisionMutation[]): SupervisionExpected[] => mutations.map(m => {
  const id = m.kind === "workflow" ? m.event.plan : m.kind === "retirement" ? m.receipt.plan : m.kind === "binding" ? m.value.scopeId : m.kind === "backend" ? m.value.planId : m.value.id;
  return { kind: m.kind, id, version: versionOf(status, m.kind, id) };
});
const reviewedActor = (actor: SupervisionActor) => actor.kind === "captain-ui" || actor.kind === "mate-chat";
/** Cooperative: an agent counts only through an active work binding of one of these scopes. Never authenticated. */
export function boundTo(status: SupervisionStatus, actor: SupervisionActor, scopeIds: readonly string[]): boolean {
  return actor.kind === "agent" && status.bindings.some(b => scopeIds.includes(b.scopeId) && b.agentId === actor.id && b.state === "active" && b.purpose !== "discussion");
}
/** S09 records are coordination admissions: they stop where new effects stop, leaving the tail for reconciliation. */
function admissionRoom(status: SupervisionStatus): void {
  if (status.freshness !== "current") refuse("HELD", "The supervision journal is not current; coordination records wait for reconciliation.");
  if (status.sequence >= SUPERVISION_INDEX_LIMITS.admissions) refuse("HELD", `Coordination admissions stop at journal sequence ${SUPERVISION_INDEX_LIMITS.admissions}; the rest is reserved for reconciliation.`);
}
export function generalScope(status: SupervisionStatus): string {
  const general = status.scopes.filter(s => s.kind === "general" && s.state !== "retired");
  return general.length === 1 ? general[0]!.id : refuse("UNKNOWN_OWNER", "Exactly one registered General scope is required for a cross-project choice.");
}
/** Cross-project choices reach General; a one-project choice stays with that project's scope. */
export function conflictOwner(status: SupervisionStatus, projectIds: readonly string[]): string {
  if (projectIds.length > 1) return generalScope(status);
  return rowsOf(status).projects.find(p => p.id === projectIds[0])?.scopeId ?? refuse("UNKNOWN_OWNER", "The project is not admitted.");
}
export interface ConflictInput { kind: PortfolioConflict["kind"]; projectIds: string[]; subjects: PortfolioConflict["subjects"]; detail: string }
/** One open conflict per kind and subjects; repeated detection with unchanged facts writes nothing. A recorded
 * choice is final, so a later recurrence opens a new conflict beside it.
 */
export function conflictMutation(status: SupervisionStatus, input: ConflictInput): SupervisionMutation | null {
  const projectIds = [...new Set(input.projectIds)].sort(), subjects = [...input.subjects].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  const same = rowsOf(status).conflicts.filter(c => c.kind === input.kind && digest(c.subjects) === digest(subjects));
  const open = same.find(c => c.state === "open"), detailDigest = digest([input.kind, projectIds, subjects, input.detail]);
  if (open?.detailDigest === detailDigest) return null;
  const id = open?.id ?? conflictId(input.kind, [...subjects, { kind: "ordinal", id: String(same.length) }]);
  return { kind: "portfolio-conflict", value: { id, version: (open?.version ?? 0) + 1, ownerScopeId: conflictOwner(status, projectIds), kind: input.kind,
    projectIds, subjects, detail: input.detail.slice(0, 2000), detailDigest, state: "open", resolution: null } };
}

const Budget = z.object({ agents: z.number().int().min(0).max(1_000_000), turns: z.number().int().min(0).max(1_000_000) }).strict();
export const ProjectInputSchema = z.object({ projectId: SupervisionUuid, expectedVersion: z.number().int().min(0), scopeId: SupervisionUuid,
  name: z.string().min(1).max(200), aliases: z.array(z.string().min(1).max(200)).max(16), state: z.enum(["admitted", "stopped"]),
  budget: Budget.nullable(), sourceVector: z.array(SupervisionVersionRefSchema).min(1).max(64) }).strict();
export const SponsorInputSchema = z.object({ planScopeId: SupervisionUuid, expectedVersion: z.number().int().min(0), sponsorScopeId: SupervisionUuid.nullable(),
  claims: z.array(z.object({ projectId: SupervisionUuid, agents: z.number().int().min(0).max(1_000_000), turns: z.number().int().min(0).max(1_000_000),
    priority: z.number().int().min(1).max(9) }).strict()).min(1).max(64) }).strict();
export const IntentInputSchema = z.object({ intakeId: z.string().min(1).max(300), textDigest: z.string().regex(/^[0-9a-f]{64}$/), ownerScopeId: SupervisionUuid,
  projectIds: z.array(SupervisionUuid).min(1).max(64), tasks: z.array(z.object({ hostId: z.string().min(1).max(256), projectId: SupervisionUuid, nodeId: PlanId }).strict()).max(100) }).strict();
export type IntentOutcome = { outcome: "claimed" | "duplicate"; intentId: string } | { outcome: "conflict"; intentId: string; conflictId: string | null };

export class SupervisionProjects {
  constructor(readonly store: SupervisionStore, private readonly options: { enabled?: boolean; now?: () => string } = {}) {}
  private now() { return this.options.now?.() ?? new Date().toISOString(); }
  private enabled() { if (!this.options.enabled) refuse("UNSUPPORTED", "S09 project coordination is disabled."); }
  private async command(requestId: string, input: unknown, actorInput: SupervisionActor,
    prepare: (status: SupervisionStatus, actor: SupervisionActor) => SupervisionMutation[] | Promise<SupervisionMutation[]>) {
    this.enabled();
    const actor = structuredClone(SupervisionActorSchema.parse(actorInput));
    return this.store.transactCommand(requestId, digest(input), actor, async status => {
      const mutations = await prepare(status, actor);
      return { expectedVersions: expected(status, mutations), mutations, result: emptyResult() };
    });
  }

  /** Admit, re-admit, stop or re-budget one project. Projects are added individually; stopping is always allowed
   * and retains memory, grants, evidence and owner identities. Admission rests on current reviewed policy sources.
   */
  recordProject(requestId: string, actor: SupervisionActor, raw: z.input<typeof ProjectInputSchema>) {
    const input = ProjectInputSchema.parse(raw);
    return this.command(requestId, { op: "project", input }, actor, (status, a) => {
      if (!reviewedActor(a)) refuse("UNSUPPORTED", "Project admission and allocation are the captain's, recorded through the UI or chat.");
      const old = rowsOf(status).projects.find(p => p.id === input.projectId);
      if (versionOf(status, "project", input.projectId) !== input.expectedVersion) refuse("STALE", "The project record changed; reread it.");
      if (input.state === "admitted") {
        admissionRoom(status);
        for (const ref of input.sourceVector) {
          const source = status.policySources.find(s => s.id === ref.id);
          if (ref.kind !== "policy-source" || !source || !sameVector([ref], [policyRef("policy-source", source)]) || status.policySources.some(s => s.supersedes.includes(ref.id)))
            refuse("STALE", "Project admission must rest on current, unsuperseded reviewed policy sources.");
        }
      }
      const value: ProjectRecord = { id: input.projectId, version: input.expectedVersion + 1, scopeId: input.scopeId, name: input.name.trim(),
        aliases: [...new Set(input.aliases.map(x => x.trim()))].filter(x => normalizedName(x) !== normalizedName(input.name)), state: input.state,
        budget: input.budget, sourceVector: input.state === "stopped" && old ? old.sourceVector : input.sourceVector, provenance: a };
      return [{ kind: "project", value }];
    });
  }

  /** One sponsor per plan scope (General by default for a cross-project plan, the project otherwise), with an
   * all-or-none budget claim. A claim is granted only within every named project's remaining allocation and
   * behind every earlier claim of equal or higher priority there (FIFO); otherwise it queues. Nothing is borrowed.
   */
  claimSponsor(requestId: string, actor: SupervisionActor, raw: z.input<typeof SponsorInputSchema>) {
    const input = SponsorInputSchema.parse(raw);
    return this.command(requestId, { op: "sponsor", input }, actor, (status, a) => {
      admissionRoom(status);
      const rows = rowsOf(status), plan = status.scopes.find(s => s.id === input.planScopeId);
      if (!plan || plan.kind !== "plan" || plan.mode !== "scoped" || ["retired", "transferring"].includes(plan.state)) refuse("UNKNOWN_OWNER", "Sponsor an active scoped plan scope.");
      const old = rows.sponsors.find(s => s.id === plan.id);
      if (versionOf(status, "plan-sponsor", plan.id) !== input.expectedVersion) refuse("STALE", "Another sponsor claim was recorded first; reread it.");
      if (old && old.state !== "released") refuse("CONFLICT", `This plan already has its sponsor (${old.sponsorScopeId}).`);
      const sponsorScopeId = input.sponsorScopeId ?? (plan.projectIds.length > 1 ? generalScope(status) : rows.projects.find(p => p.id === plan.projectIds[0])?.scopeId ?? refuse("UNKNOWN_OWNER", "The project is not admitted."));
      if (!reviewedActor(a) && !boundTo(status, a, [sponsorScopeId])) refuse("UNKNOWN_OWNER", "Only the sponsoring scope's bound owner or the captain can claim sponsorship.");
      const claims = [...input.claims].sort((x, y) => x.projectId.localeCompare(y.projectId));
      if (claims.length !== plan.projectIds.length || claims.some(c => !plan.projectIds.includes(c.projectId))) refuse("CONFLICT", "Claim each of the plan's projects exactly once.");
      for (const c of claims) {
        const project = rows.projects.find(p => p.id === c.projectId);
        if (!project) refuse("UNKNOWN_OWNER", "Every project of the plan must be admitted.");
        if (project.state !== "admitted") refuse("HELD", `Admissions for ${project.name} are stopped.`);
      }
      const queuedAt = status.sequence + 1;
      const row: PlanSponsor = { id: plan.id, version: input.expectedVersion + 1, sponsorScopeId, projectIds: claims.map(c => c.projectId), claims, queuedAt, state: "queued", provenance: a };
      row.state = grantable(status, row) ? "granted" : "queued";
      const mutations: SupervisionMutation[] = [{ kind: "scope", value: { ...plan, sponsorId: sponsorScopeId, version: plan.version + 1 } }, { kind: "plan-sponsor", value: row }];
      if (row.state === "queued") for (const conflict of claimConflicts(status, row)) { const m = conflictMutation(status, conflict); if (m) mutations.push(m); }
      return mutations;
    });
  }
  /** Release a claim. Always allowed: it frees allocation, retains the sponsor's identity in history and wakes nobody. */
  releaseSponsor(requestId: string, actor: SupervisionActor, raw: { planScopeId: string; expectedVersion: number }) {
    return this.command(requestId, { op: "release-sponsor", raw }, actor, (status, a) => {
      const row = rowsOf(status).sponsors.find(s => s.id === raw.planScopeId);
      if (!row || row.version !== raw.expectedVersion) refuse("STALE", "The sponsor claim changed; reread it.");
      if (row.state === "released") refuse("CONFLICT", "Already released.");
      if (!reviewedActor(a) && !boundTo(status, a, [row.sponsorScopeId, row.id])) refuse("UNKNOWN_OWNER", "Only the sponsor, the plan owner or the captain can release a claim.");
      return [{ kind: "plan-sponsor", value: { ...row, version: row.version + 1, state: "released" } }];
    });
  }
  /** Grant the head of one project's queue, if it now fits everywhere it claims. Strict FIFO within priority:
   * a head that does not fit blocks the queue (shown as queued, never silently skipped).
   */
  promote(requestId: string, actor: SupervisionActor, raw: { projectId: string }) {
    return this.command(requestId, { op: "promote", raw }, actor, (status, a) => {
      admissionRoom(status);
      const project = rowsOf(status).projects.find(p => p.id === raw.projectId) ?? refuse("UNKNOWN_OWNER", "The project is not admitted.");
      if (!reviewedActor(a) && !boundTo(status, a, [project.scopeId])) refuse("UNKNOWN_OWNER", "Only the project owner or the captain promotes its queue.");
      const head = queue(status, project.id)[0] ?? refuse("CONFLICT", "Nothing is queued for this project.");
      if (!grantable(status, head)) refuse("HELD", "The oldest highest-priority claim does not fit yet; it keeps its place.");
      return [{ kind: "plan-sponsor", value: { ...head, version: head.version + 1, state: "granted" } }];
    });
  }

  /** Route one captain intake once. Forwarding the same intake again (through General or a project) is a duplicate
   * and writes nothing. A second owner for one of its tasks is a scope choice: it records one conflict, claims nothing.
   */
  async claimIntent(requestId: string, actor: SupervisionActor, raw: z.input<typeof IntentInputSchema>): Promise<IntentOutcome> {
    this.enabled();
    const input = IntentInputSchema.parse(raw), status = await this.store.read(), id = intentId(status.homeId, input.intakeId);
    const tasks = input.tasks.map(t => ({ ...t, hostId: t.hostId.trim().toLowerCase() })).sort((x, y) => taskKey(x).localeCompare(taskKey(y)));
    const projectIds = [...new Set(input.projectIds)].sort();
    const old = rowsOf(status).intents.find(i => i.id === id);
    if (old && old.ownerScopeId === input.ownerScopeId && old.textDigest === input.textDigest && digest(old.tasks) === digest(tasks)) return { outcome: "duplicate", intentId: id };
    let outcome: IntentOutcome = { outcome: "claimed", intentId: id };
    await this.command(requestId, { op: "intent", input }, actor, (s, a) => {
      admissionRoom(s);
      const owner = s.scopes.find(x => x.id === input.ownerScopeId);
      if (!owner || owner.kind !== "plan" || owner.state === "retired") refuse("UNKNOWN_OWNER", "An intake is owned by one registered plan scope.");
      if (!reviewedActor(a) && !boundTo(s, a, [owner.id, ...s.scopes.filter(x => x.kind === "general" || (x.kind === "project" && x.projectIds.some(p => projectIds.includes(p)))).map(x => x.id)]))
        refuse("UNKNOWN_OWNER", "Only General, a project owner, the plan owner or the captain routes an intake.");
      const current = rowsOf(s).intents.find(i => i.id === id);
      if (current && current.ownerScopeId === owner.id && current.textDigest === input.textDigest && digest(current.tasks) === digest(tasks)) refuse("CONFLICT", "duplicate-intake");
      if (current?.ownerScopeId === owner.id) refuse("CONFLICT", "This intake was already routed here with different content; an intake keeps its original words and tasks.");
      const rivals = current ? [current.ownerScopeId] : [...new Set([
        ...rowsOf(s).intents.filter(i => i.state === "claimed" && i.ownerScopeId !== owner.id && i.tasks.some(t => tasks.some(x => taskKey(x) === taskKey(t)))).map(i => i.ownerScopeId),
        ...s.tasks.filter(t => t.ownerScopeId !== owner.id && tasks.some(x => taskKey(x) === taskKey(t))).map(t => t.ownerScopeId)])];
      if (!rivals.length) return [{ kind: "intent", value: { id, version: 1, intakeId: input.intakeId, textDigest: input.textDigest, ownerScopeId: owner.id, projectIds, tasks, state: "claimed", provenance: a } }];
      const subjects = [{ kind: "intent" as const, id }, ...tasks.map(t => ({ kind: "task" as const, id: taskKey(t) }))];
      const involved = [...new Set([...projectIds, ...s.scopes.filter(x => rivals.includes(x.id)).flatMap(x => x.projectIds)])];
      const m = conflictMutation(s, { kind: "scope", projectIds: involved, subjects,
        detail: `Intake ${input.intakeId} would give ${tasks.length ? "its tasks" : "it"} a second owner (${[owner.id, ...rivals].join(", ")}). Choose one owner.` });
      const open = rowsOf(s).conflicts.find(c => c.kind === "scope" && c.state === "open" && c.subjects.some(x => x.kind === "intent" && x.id === id));
      outcome = { outcome: "conflict", intentId: id, conflictId: m?.kind === "portfolio-conflict" ? m.value.id : open?.id ?? null };
      return m ? [m] : refuse("CONFLICT", "unchanged-open-conflict");
    }).catch((error: unknown) => {
      if (error instanceof SupervisionError && error.message === "duplicate-intake") { outcome = { outcome: "duplicate", intentId: id }; return; }
      if (outcome.outcome === "conflict" && error instanceof SupervisionError && error.message === "unchanged-open-conflict") return;
      throw error;
    });
    return outcome;
  }

  /** Attach qualified resolutions to a plan's cross-plan bare edges, without rewriting the v1 definition.
   * Exactly one owning plan resolves; missing, removed, ambiguous or cross-backend prerequisites hold. Unchanged rows write nothing.
   */
  async resolveDependencies(requestId: string, actor: SupervisionActor, raw: { planScopeId: string; planId: string }): Promise<{ changed: number; rows: DependencyResolution[] }> {
    this.enabled();
    const status = await this.store.read(), next = qualifiedDependencies(status, raw.planScopeId, raw.planId);
    const changed = next.filter(r => { const old = rowsOf(status).dependencies.find(d => d.id === r.id); return !old || digest({ ...old, version: 0 }) !== digest({ ...r, version: 0 }); });
    if (!changed.length) return { changed: 0, rows: next };
    await this.command(requestId, { op: "dependencies", raw }, actor, (s, a) => {
      admissionRoom(s);
      if (!reviewedActor(a) && !boundTo(s, a, [raw.planScopeId])) refuse("UNKNOWN_OWNER", "Only the dependent plan's owner or the captain records its dependencies.");
      return qualifiedDependencies(s, raw.planScopeId, raw.planId).filter(r => {
        const old = rowsOf(s).dependencies.find(d => d.id === r.id); return !old || digest({ ...old, version: 0 }) !== digest({ ...r, version: 0 });
      }).map(value => ({ kind: "dependency-resolution" as const, value }));
    });
    return { changed: changed.length, rows: next };
  }

  /** Record (once) the cross-project grant conflicts that hold this operation. The operation itself is held by
   * `checkPolicy` regardless; unrelated projects and plans are untouched. Unchanged conflicts write nothing.
   */
  async recordGrantConflicts(requestId: string, actor: SupervisionActor, target: PolicyTarget): Promise<{ conflicts: ReturnType<typeof projectGrantConflicts>; recorded: boolean }> {
    this.enabled();
    const status = await this.store.read(), conflicts = projectGrantConflicts(status, target);
    if (target.projectIds.length < 2 || !conflicts.length) return { conflicts, recorded: false };
    const conflict = (s: SupervisionStatus) => conflictMutation(s, { kind: "grant", projectIds: [...target.projectIds], subjects: [{ kind: "plan-scope", id: target.scopeId }],
      detail: `${target.operation} for plan ${target.planId} is held: ${projectGrantConflicts(s, target).map(c => `${c.projectId} ${c.problem}`).join("; ")}.` });
    if (!conflict(status)) return { conflicts, recorded: false };
    await this.command(requestId, { op: "grant-conflict", target }, actor, s => { admissionRoom(s); const m = conflict(s); return m ? [m] : refuse("CONFLICT", "Unchanged."); });
    return { conflicts, recorded: true };
  }
  /** The captain's (or mate-recorded) choice closes a conflict. It is a record, not an effect: the chosen change is its own command. */
  resolveConflict(requestId: string, actor: SupervisionActor, raw: { conflictId: string; expectedVersion: number; choice: string }) {
    return this.command(requestId, { op: "resolve-conflict", raw }, actor, (status, a) => {
      const row = rowsOf(status).conflicts.find(c => c.id === raw.conflictId);
      if (!row || row.version !== raw.expectedVersion || row.state !== "open") refuse("STALE", "The conflict changed or is already resolved; reread it.");
      const owner = status.scopes.find(s => s.id === row.ownerScopeId);
      if (!reviewedActor(a) && !(owner?.kind === "project" && boundTo(status, a, [owner.id]))) refuse("UNSUPPORTED", "Cross-project choices are the captain's, recorded through the UI or chat.");
      if (!raw.choice.trim()) refuse("HELD", "Record the choice.");
      return [{ kind: "portfolio-conflict", value: { ...row, version: row.version + 1, state: "resolved", resolution: { actor: a, choice: raw.choice.trim().slice(0, 2000), at: this.now() } } }];
    });
  }

  /** Read-only. Never transacts, sends, creates a session or wakes a scope; a held journal reads as a lower bound. */
  async portfolio(): Promise<PortfolioSummary> { return portfolioSummary(await this.store.read()); }
}

function remaining(status: SupervisionStatus, projectId: string, except: string): { agents: number; turns: number } | null {
  const project = rowsOf(status).projects.find(p => p.id === projectId);
  if (!project?.budget) return null;
  const used = rowsOf(status).sponsors.filter(s => s.state === "granted" && s.id !== except).flatMap(s => s.claims.filter(c => c.projectId === projectId));
  return { agents: project.budget.agents - used.reduce((t, c) => t + c.agents, 0), turns: project.budget.turns - used.reduce((t, c) => t + c.turns, 0) };
}
/** Queued claims touching a project, in grant order: priority (1 first), then claim sequence. */
export function queue(status: SupervisionStatus, projectId: string): PlanSponsor[] {
  const priority = (s: PlanSponsor) => s.claims.find(c => c.projectId === projectId)!.priority;
  return rowsOf(status).sponsors.filter(s => s.state === "queued" && s.projectIds.includes(projectId)).sort((a, b) => priority(a) - priority(b) || a.queuedAt - b.queuedAt);
}
function grantable(status: SupervisionStatus, row: PlanSponsor): boolean {
  return row.claims.every(c => {
    const room = remaining(status, c.projectId, row.id), project = rowsOf(status).projects.find(p => p.id === c.projectId);
    const ahead = queue(status, c.projectId).filter(q => q.id !== row.id && (q.claims.find(x => x.projectId === c.projectId)!.priority < c.priority ||
      (q.claims.find(x => x.projectId === c.projectId)!.priority === c.priority && q.queuedAt < row.queuedAt)));
    return project?.state === "admitted" && room !== null && room.agents >= c.agents && room.turns >= c.turns && !ahead.length;
  });
}
function claimConflicts(status: SupervisionStatus, row: PlanSponsor): ConflictInput[] {
  const projects = rowsOf(status).projects, out: ConflictInput[] = [], subjects = [{ kind: "plan-scope" as const, id: row.id }];
  const impossible = row.claims.filter(c => { const b = projects.find(p => p.id === c.projectId)?.budget; return !b || c.agents > b.agents || c.turns > b.turns; });
  if (impossible.length) out.push({ kind: "budget", projectIds: row.projectIds, subjects,
    detail: `Plan scope ${row.id} claims more than ${impossible.map(c => projects.find(p => p.id === c.projectId)!.name).join(", ")} can ever allocate (or the allocation is unknown). Raise the allocation or reduce the claim.` });
  if (new Set(row.claims.map(c => c.priority)).size > 1) out.push({ kind: "priority", projectIds: row.projectIds, subjects,
    detail: `Plan scope ${row.id} is queued with different priorities across its projects (${row.claims.map(c => `${projects.find(p => p.id === c.projectId)!.name} ${c.priority}`).join(", ")}). Choose one portfolio priority.` });
  return out;
}

/** Pure: the qualified resolution of every cross-plan bare edge of one plan. In-plan edges stay with the reducer. */
export function qualifiedDependencies(status: SupervisionStatus, planScopeId: string, planId: string): DependencyResolution[] {
  const backend = status.backends.find(b => b.planId === planId);
  if (backend?.ownerScopeId !== planScopeId) refuse("UNKNOWN_OWNER", "Resolve dependencies through the dependent plan's owner.");
  const plan = status.plans.find(p => p.plan.definition.id === planId)?.plan ?? refuse("UNKNOWN_OWNER", "The plan has no stored definition.");
  const out: DependencyResolution[] = [];
  for (const node of plan.definition.nodes) for (const edge of node.after) {
    if (plan.definition.nodes.some(n => n.id === edge.node)) continue;
    const id = dependencyResolutionId(planId, node.id, edge.node), old = rowsOf(status).dependencies.find(d => d.id === id);
    const owners = status.plans.map(p => p.plan).filter(p => p.definition.id !== planId && p.definition.nodes.some(n => n.id === edge.node));
    const removed = status.plans.some(p => p.plan.definition.id !== planId && (p.plan.removed ?? []).some(r => r.node.id === edge.node));
    const base = { id, version: (old?.version ?? 0) + 1, scopeId: planScopeId, planId, nodeId: node.id, edge: { node: edge.node, on: edge.on } };
    if (owners.length !== 1) { out.push({ ...base, target: null, state: "held", reason: owners.length ? "ambiguous" : removed ? "removed" : "missing" }); continue; }
    const target = owners[0]!, route = status.backends.find(b => b.planId === target.definition.id), routeOwner = status.scopes.find(s => s.id === route?.ownerScopeId);
    if (route?.backend !== "scoped" || route.state !== "active" || !routeOwner || routeOwner.state === "retired") { out.push({ ...base, target: null, state: "held", reason: "cross-backend" }); continue; }
    const task = status.tasks.find(t => t.planId === target.definition.id && t.nodeId === edge.node);
    out.push({ ...base, state: "resolved", reason: "exact", target: { homeId: status.homeId, planId: target.definition.id, nodeId: edge.node,
      projectId: task?.projectId ?? null, planHash: target.hash, revision: target.revision, attemptId: target.nodes[edge.node]?.attempt ?? null } });
  }
  return out;
}
/** Read-time check of a stored resolution against the current projection. A removed or replaced prerequisite holds. */
export function dependencyState(status: SupervisionStatus, row: DependencyResolution): { state: "met" | "waiting" | "held"; reason: string } {
  if (row.state === "held" || !row.target) return { state: "held", reason: row.reason };
  const plan: WorkflowPlan | undefined = status.plans.find(p => p.plan.definition.id === row.target!.planId)?.plan;
  if (!plan || !plan.definition.nodes.some(n => n.id === row.target!.nodeId)) return { state: "held", reason: "removed" };
  const state = plan.nodes[row.target.nodeId];
  if (row.target.attemptId && state?.attempt !== row.target.attemptId) return { state: "held", reason: "attempt-changed" };
  if (!state || state.held || state.invalidated) return { state: "held", reason: "prerequisite-held" };
  const met = row.edge.on === "answered" ? !!state.answer : row.edge.on === "landed" ? state.state === "landed" : ["done", "landed"].includes(state.state);
  return met ? { state: "met", reason: row.edge.on } : { state: "waiting", reason: state.state };
}
