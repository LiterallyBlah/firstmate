/** Disabled cooperative pilot command seam. No RPC registration, executor or external effects. */
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { SupervisionActorSchema, SupervisionHash, SupervisionUuid, SupervisionVersionRefSchema, type SupervisionActor, type SupervisionExpected, type SupervisionStatus } from "../shared/supervision";
import { PolicyApprovalSchema, ScopedDecisionSchema, type ScopedCommandResult, type PilotOperation, type PolicyOperationTarget } from "../shared/supervision-policy";
import { PlanDefinitionSchema, PlanId, WorkflowCommandSchema, planProblems, type WorkflowCommand, type WorkflowPlan, type PlanLaunch } from "../shared/workflow-plans";
import { checkNewWorkflowAction, dependenciesMet, planSubjectHash, WorkflowEventSchema, type WorkflowEvent } from "./workflow-plans";
import { SupervisionError, type SupervisionMutation, type SupervisionStore } from "./supervision-store";
import { applicableRules, checkPolicy } from "./supervision-policy";
import { digest } from "./submissions";
import { resolveInHome } from "./files";
import { readPlanPosture } from "./workflow-posture";
import { replaySupervisionWorkflow } from "./supervision-workflows";
import { workflowHomeIdentity } from "./workflow-ownership";

export { ScopedDependencySchema, ScopedPlanCommandSchema, ScopedAnswerSchema } from "../shared/scoped-commands";
export type { ScopedPlanCommand, ScopedAnswer } from "../shared/scoped-commands";
import { ScopedPlanCommandSchema, ScopedAnswerSchema, type ScopedPlanCommand, type ScopedAnswer } from "../shared/scoped-commands";
const emptyResult = (): ScopedCommandResult => ({ planId: null, planHash: null, decisionId: null, outboxId: null });
function fail(code: "STALE" | "HELD" | "UNKNOWN_OWNER" | "UNSUPPORTED" | "CONFLICT", message: string): never { throw new SupervisionError(code, message); }
export function scopedDecisionId(scope: string, plan: string, node: string): string {
  const h = digest([scope, plan, node]); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const version = (status: SupervisionStatus, kind: SupervisionExpected["kind"], id: string) => status.versions.find(v => v.kind === kind && v.id === id)?.version ?? 0;
function refs(status: SupervisionStatus, mutations: SupervisionMutation[]): SupervisionExpected[] {
  return mutations.map(m => { const id = m.kind === "workflow" ? m.event.plan : m.kind === "retirement" ? m.receipt.plan :
    m.kind === "binding" ? m.value.scopeId : m.kind === "backend" ? m.value.planId : m.value.id;
    return { kind: m.kind, id, version: version(status, m.kind, id) }; });
}
function operation(command: WorkflowCommand): PilotOperation {
  if (command.op === "captain") return command.action === "answer" ? "decision.answer" : ["hold", "decline"].includes(command.action) ? "plan.stop" : "plan.review";
  if (command.op === "progress" && command.action === "answer") return "decision.answer";
  if (["start", "implicit", "claim"].includes(command.op)) return "plan.start";
  return ["record", "invalidate", "validate", "close", "ack"].includes(command.op) ? "plan.record" : "plan.review";
}
function operationTarget(input: ScopedPlanCommand): PolicyOperationTarget {
  const c = input.command;
  return { nodeId: "node" in c ? c.node ?? null : c.op === "implicit" ? c.launch.id : null,
    commandHash: digest(c), briefHash: input.briefHash, dependencyHash: digest(input.dependencyBindings) };
}
async function pinnedBrief(home: string, input: ScopedPlanCommand, run: PlanLaunch): Promise<string> {
  const path = (await resolveInHome(home, run.brief.file)).absolute, before = await stat(path);
  if (before.size > 100000) fail("HELD", "Brief exceeds 100,000 bytes.");
  const bytes = await readFile(path), after = await stat(path), briefHash = createHash("sha256").update(bytes).digest("hex");
  if (!bytes.toString("utf8").trim() || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size ||
    input.briefHash !== briefHash || (input.command.op === "claim" && input.command.briefHash !== briefHash)) fail("STALE", "Brief changed or is not pinned.");
  return briefHash;
}
/** S03's dependency authority rule, shared with S04 final dispatch admission: the prerequisite plan must be
 * on an active scoped backend whose owner scope is available (a captain answer may proceed in its own held scope).
 */
export function checkDependencyRoute(status: SupervisionStatus, planId: string, scopeId: string, op: PilotOperation): void {
  const route = status.backends.find(b => b.planId === planId), owner = status.scopes.find(s => s.id === route?.ownerScopeId);
  if (route?.backend !== "scoped" || route.state !== "active" || !owner || owner.state === "retired" ||
    (["held", "transferring"].includes(owner.state) && !(op === "decision.answer" && owner.id === scopeId))) fail("HELD", "Dependency backend or scope is unavailable; cross-backend mutation is unsupported.");
}
export class SupervisionCommands {
  constructor(readonly store: SupervisionStore, readonly home: string, private readonly options: { enabled?: boolean; now?: () => string; unverifiedUiAnswers?: boolean;
    answerAdmission?: (status: SupervisionStatus) => Promise<void> } = {}) {}
  private checkOwner(status: SupervisionStatus, input: Pick<ScopedPlanCommand, "homeId" | "scopeId" | "epoch" | "scopeVersion">, actor: SupervisionActor, op: PilotOperation, uiAnswer = false) {
    if (!this.options.enabled) fail("UNSUPPORTED", "Pilot scoped commands are disabled.");
    if (status.homeId !== input.homeId || status.homeId !== this.store.homeId || workflowHomeIdentity(this.home) !== status.homeId) fail("STALE", "Home identity changed.");
    const scope = status.scopes.find(s => s.id === input.scopeId), binding = status.bindings.find(b => b.scopeId === input.scopeId);
    if (op === "plan.start" && binding?.purpose === "discussion") fail("HELD", "This session is discussion only. Work activation requires its own checked authority; discussion grants no dispatch.");
    if (!scope || scope.mode !== "scoped" || scope.kind !== "plan") fail("UNKNOWN_OWNER", "Exact scoped plan owner required.");
    // A captain answer addresses a logical decision, independently of session replacement. Its
    // revision/subject/policy still bind below. Only the current owner can consume its outbox.
    const explicitUiAnswer = uiAnswer && actor.kind === "plugin-ui-unverified" && op === "decision.answer";
    const logicalAnswer = op === "decision.answer" && (actor.kind === "captain-ui" || explicitUiAnswer);
    if (!logicalAnswer && (scope.version !== input.scopeVersion || binding?.epoch !== input.epoch)) fail("STALE", "Scope version or binding epoch changed.");
    if ((!logicalAnswer && binding?.state !== "active") || (logicalAnswer ? ["retired", "dormant"] : ["transferring", "retired", "dormant"]).includes(scope.state) ||
      (scope.state === "held" && !["plan.record", "plan.stop", "decision.answer", "plan.review"].includes(op))) fail("HELD", "Owner is not admitted for this operation.");
    if (actor.kind === "system" || (actor.kind !== "captain-ui" && !explicitUiAnswer && actor.id !== binding?.agentId)) fail("UNKNOWN_OWNER", "Only the bound logical owner or explicit captain action may propose this command.");
    return scope;
  }
  async planCommand(raw: ScopedPlanCommand, actorInput: SupervisionActor) {
    const input = structuredClone(ScopedPlanCommandSchema.parse(raw)), actor = structuredClone(SupervisionActorSchema.parse(actorInput));
    return this.store.transactCommand(input.requestId, digest(input), actor, status => this.prepare(status, input, actor));
  }
  /** S04 composition seam: the same checked preparation, extended inside the same transaction.
   * The distinct input hash keeps a plain command and a gateway command from sharing a request ID.
   */
  async planCommandWith(raw: ScopedPlanCommand, actorInput: SupervisionActor, kind: string,
    extend: (status: SupervisionStatus, prepared: { mutations: SupervisionMutation[]; result: ScopedCommandResult }) => Promise<{ expectedVersions: SupervisionExpected[]; mutations: SupervisionMutation[] }>) {
    const input = structuredClone(ScopedPlanCommandSchema.parse(raw)), actor = structuredClone(SupervisionActorSchema.parse(actorInput));
    return this.store.transactCommand(input.requestId, digest({ composed: kind, input }), actor, async status => {
      const prepared = await this.prepare(status, input, actor), extra = await extend(status, prepared);
      return { expectedVersions: [...prepared.expectedVersions, ...extra.expectedVersions], mutations: [...prepared.mutations, ...extra.mutations], result: prepared.result };
    });
  }
  async answer(raw: ScopedAnswer, actorInput: SupervisionActor) {
    return this.answerWith(raw, actorInput, false);
  }
  /** Explicit app answer, by convention only. No fabricated authenticated captain identity.
   * This seam cannot approve plans, dispatch, clear migration holds or attach. */
  async answerFromUnverifiedUi(raw: ScopedAnswer) {
    if (!this.options.unverifiedUiAnswers) fail("UNSUPPORTED", "Unverified app answers are disabled.");
    return this.answerWith(raw, { kind: "plugin-ui-unverified", id: "unauthenticated-plugin-call", source: "scope answer button (unverified)" }, true);
  }
  private async answerWith(raw: ScopedAnswer, actorInput: SupervisionActor, uiAnswer: boolean) {
    const answer = structuredClone(ScopedAnswerSchema.parse(raw)), actor = structuredClone(SupervisionActorSchema.parse(actorInput));
    return this.store.transactCommand(answer.submissionId, digest(answer), actor, async status => {
      await this.options.answerAdmission?.(status);
      const decision = status.decisions.find(d => d.id === answer.decisionId);
      if (decision?.maintenance) fail("UNSUPPORTED", "Maintenance answers use their checked maintenance app transport, never a plan command.");
      if (!decision || decision.ownerScopeId !== answer.scopeId) fail("UNKNOWN_OWNER", "Decision does not belong to this logical scope.");
      if (decision.state !== "pending" || decision.answer || decision.revision !== answer.revision || decision.subjectHash !== answer.subjectHash)
        fail("STALE", "This decision was answered or its subject changed. Preserve the draft and reread.");
      return this.prepare(status, { ...answer, requestId: answer.submissionId,
        command: { op: "captain", plan: decision.planId, action: "answer", revision: answer.revision, subjectHash: decision.subjectHash,
          node: decision.nodeId, option: answer.option, text: answer.text } }, actor, uiAnswer);
    });
  }
  private async prepare(status: SupervisionStatus, input: ScopedPlanCommand, actor: SupervisionActor, uiAnswer = false) {
    const c = input.command, op = operation(c), scope = this.checkOwner(status, input, actor, op, uiAnswer);
    if (["plans", "show", "agenda", "lint", "retire", "notified", "release", "replace"].includes(c.op)) fail("UNSUPPORTED", "This command needs its existing reader or a later checked lifecycle/migration adapter.");
    const planId = c.op === "draft" || c.op === "revise" ? c.definition.id : c.op === "implicit" ? c.launch.id : "plan" in c ? c.plan : fail("UNSUPPORTED", "No plan target.");
    const backend = status.backends.find(b => b.planId === planId);
    if (status.backends.filter(b => b.ownerScopeId === scope.id).length !== 1) fail("CONFLICT", "A pilot plan scope must own exactly one plan.");
    if (backend?.ownerScopeId !== scope.id || backend.backend !== "scoped") fail("UNKNOWN_OWNER", "Scoped commands cannot use a legacy or neighboring plan backend.");
    if (backend.state !== "active" || status.retirements.some(r => r.plan === planId)) fail("HELD", "Plan backend is held or retired.");
    const previous = status.plans.find(p => p.plan.definition.id === planId)?.plan ?? null;
    if ((previous?.hash ?? null) !== input.expectedPlanHash || (previous?.revision ?? 0) !== input.revision ||
      (previous ? planSubjectHash(previous) : null) !== input.subjectHash) fail("STALE", "Plan revision, hash or subject changed.");
    if (c.op === "captain" || c.op === "approve") {
      if (!["captain-ui", "mate-chat"].includes(actor.kind) && !(uiAnswer && actor.kind === "plugin-ui-unverified" && c.op === "captain" && c.action === "answer")) fail("UNSUPPORTED", "A worker/agent proposal cannot mint a captain action.");
      if (actor.kind === "mate-chat" && !(c.op === "approve" ? c.quote : c.text).trim()) fail("HELD", "Chat-recorded authority needs the captain's source words.");
    } else if (actor.kind === "captain-ui") fail("UNSUPPORTED", "Captain UI uses the distinct captain command class.");
    const at = this.options.now?.() ?? new Date().toISOString();
    const tasks = status.tasks.filter(t => t.ownerScopeId === scope.id && t.planId === planId);
    const selectedNode = "node" in c ? c.node : c.op === "implicit" ? c.launch.id : undefined;
    const selectedTask = selectedNode ? tasks.find(t => t.nodeId === selectedNode) : undefined;
    const hostId = selectedTask?.hostId ?? status.bindings.find(b => b.scopeId === scope.id)?.hostId ?? tasks[0]?.hostId ?? fail("UNKNOWN_OWNER", "Plan host is not registered.");
    const target = { scopeId: scope.id, planId, projectIds: scope.projectIds, hostId, operation: op };
    const admission = { ...target, policyVector: input.policyVector, evidenceVector: input.evidenceVector,
      subjectHash: input.subjectHash ?? digest(c), revision: input.revision || 1, approvalId: input.approvalId,
      model: null, head: input.head, artifactHash: input.artifactHash, operationTarget: operationTarget(input) };
    await checkPolicy(this.home, status, admission, at);
    const dependencies: WorkflowPlan[] = [];
    for (const d of input.dependencyBindings) {
      const p = status.plans.find(p => p.plan.definition.id === d.planId)?.plan;
      if (d.homeId !== status.homeId || !p || p.hash !== d.planHash || p.revision !== d.revision ||
        (p.nodes[d.nodeId]?.attempt ?? null) !== d.attemptId) fail("STALE", "Dependency evidence binding changed.");
      if (!p.definition.nodes.some(n => n.id === d.nodeId)) fail("HELD", "Dependency was removed.");
      checkDependencyRoute(status, d.planId, scope.id, op);
      if (!dependencies.includes(p)) dependencies.push(p);
    }
    const plans = [...(previous ? [previous] : []), ...dependencies.filter(p => p.definition.id !== planId)];
    const node = previous?.definition.nodes.find(n => n.id === selectedNode);
    const checkDependencies = (edges: { node: string; on: string }[]) => {
      if (edges.length !== input.dependencyBindings.length || edges.some(e => input.dependencyBindings.filter(d => d.nodeId === e.node && d.outcome === e.on && (previous?.nodes[e.node] ? d.planId === planId : true)).length !== 1)) fail("HELD", "Every prerequisite needs one exact outcome binding.");
    };
    if (["start", "claim"].includes(c.op) || ((c.op === "captain" || c.op === "progress") && c.action === "answer")) checkDependencies(node?.after ?? []);
    checkNewWorkflowAction(c, previous, c.op === "revise" ? status.plans.map(p => p.plan) : plans);
    if ((c.op === "start" || c.op === "claim") && (!node || !dependenciesMet(node, plans))) fail("HELD", "Run dependencies are not satisfied.");
    if (c.op === "close" && status.plans.some(p => p.plan.definition.nodes.some(n => !["done", "landed", "failed", "cancelled"].includes(p.plan.nodes[n.id]?.state ?? "planned") && n.after.some(e => e.node === c.node && e.on === "landed")))) fail("HELD", "A retained plan still needs this run to land.");
    const definition = c.op === "draft" || c.op === "revise" ? c.definition : c.op === "implicit" ? PlanDefinitionSchema.parse({
      format: "firstmate.plan/1", id: planId, title: c.launch.title, request: { text: c.launch.title, at }, implicit: true,
      budget: { agents: 1, turns: 1 }, nodes: [{ kind: "run", id: planId, title: c.launch.title, summary: c.launch.title,
        workflow: c.launch.kind === "scout" ? "scout@1" : "task@1", launch: c.launch }],
    }) : null;
    if (definition && previous) {
      const removed = previous.definition.nodes.filter(n => !definition.nodes.some(next => next.id === n.id));
      if (status.plans.some(p => p.plan.definition.id !== planId && p.plan.definition.nodes.some(n => n.after.some(e => removed.some(r => r.id === e.node))))) fail("HELD", "A retained plan needs a removed prerequisite.");
    }
    for (const run of (definition?.nodes ?? (node ? [node] : [])).filter(n => n.kind === "run")) {
      if (run.kind !== "run") continue;
      const task = tasks.find(t => t.nodeId === run.id);
      if (!task || task.hostId.trim().toLowerCase() !== run.launch.host.trim().toLowerCase() || !applicableRules(status, target).some(r =>
        r.selector.projectIds.includes(task.projectId) && r.selector.projectNames[task.projectId] === run.launch.project)) fail("UNKNOWN_OWNER", "Register this exact task/host/project ownership before admitting work.");
    }
    const profiles = c.op === "captain" && c.action === "edit" ? c.edits?.flatMap(e => e.kind === "model" ? [e.agent] : []) ?? [] :
      c.op === "implicit" ? [c.launch.agent] : (c.op === "start" || c.op === "claim") && node?.kind === "run" ? [node.launch.agent] : [];
    for (const profile of profiles) await checkPolicy(this.home, status, { ...admission, operation: "model.use", model: profile.provider, profileDigest: digest(profile), policyVector: input.modelPolicyVector,
      approvalOperation: op, approvalPolicyVector: input.policyVector, modelPolicyVector: input.modelPolicyVector }, at);
    let briefHash: string | undefined, launch: WorkflowEvent["launch"];
    if (c.op === "start" || c.op === "implicit" || c.op === "claim") {
      const run = c.op === "implicit" ? c.launch : node?.kind === "run" ? node.launch : fail("HELD", "A decision cannot launch a worker.");
      briefHash = await pinnedBrief(this.home, input, run);
      if (c.op === "start") { launch = structuredClone(run); if (node!.after.length) launch.dependency = { satisfiedBy: node!.after.map(e => {
        const p = plans.find(p => p.nodes[e.node])!; return `${e.node}: ${e.on}; plan ${p.definition.id} at ${p.hash}`;
      }).join("; ") }; }
    }
    const postureSource = definition ? await readPlanPosture(this.home, definition) : undefined;
    const body = { version: 1 as const, home: this.home, plan: planId, sequence: previous ? previous.sequence + 1 : 0, previous: previous?.hash ?? null,
      requestId: input.requestId, requestHash: digest(c), at, by: `${actor.kind}:${actor.id}:${actor.source}`, command: c,
      ...(briefHash && c.op !== "claim" && !(c.op === "implicit" && postureSource?.posture === "review") ? { briefHash, attempt: randomUUID() } : {}),
      ...(launch ? { launch } : {}), ...(postureSource ? { postureSource } : {}) };
    const event = WorkflowEventSchema.parse({ ...body, hash: digest(body) });
    const next = replaySupervisionWorkflow(previous, event, status.homeId);
    // Edits cannot move a task to a host/project the scoped ownership index does not own.
    for (const run of next.definition.nodes) if (run.kind === "run") {
      const task = tasks.find(t => t.nodeId === run.id);
      if (!task || task.hostId.trim().toLowerCase() !== run.launch.host.trim().toLowerCase() || !applicableRules(status, target).some(r =>
        r.selector.projectIds.includes(task.projectId) && r.selector.projectNames[task.projectId] === run.launch.project)) fail("UNKNOWN_OWNER", "The edited task/host/project mapping is not owned by this plan.");
    }
    // Structural validation needs the entire retained inventory, including external ancestors
    // used by other steps. This does not widen the exact per-node readiness bindings above.
    const problems = planProblems(next.definition, status.plans.map(p => p.plan), new Set(next.removed?.map(r => r.node.id)));
    if (problems.length) fail("HELD", problems.join("\n"));
    const mutations: SupervisionMutation[] = [{ kind: "workflow", scopeId: scope.id, event }];
    // Bookkeeping acknowledgements never generate another notification to acknowledge.
    const outboxId = c.op === "ack" ? null : input.requestId;
    const answerNode = (c.op === "captain" || c.op === "progress") && c.action === "answer" ? c.node : null;
    let decisionId: string | null = null;
    for (const n of next.definition.nodes.filter(n => n.kind === "decision")) {
      if (n.kind !== "decision") continue;
      const id = scopedDecisionId(scope.id, planId, n.id), old = status.decisions.find(d => d.id === id);
      if (old?.answer) continue;
      if (n.id === answerNode) decisionId = id;
      const value = ScopedDecisionSchema.parse({ id, version: (old?.version ?? 0) + 1, ownerScopeId: scope.id, planId, nodeId: n.id,
        revision: n.id === answerNode ? input.revision : next.revision, subjectHash: n.id === answerNode ? input.subjectHash : planSubjectHash(next),
        state: n.id === answerNode ? "answered" : "pending", title: n.title, question: n.summary, options: n.options.map(({ id, label }) => ({ id, label })),
        sourceVector: [{ kind: "workflow", id: planId, version: version(status, "workflow", planId) + 1, digest: next.hash }, ...input.policyVector, ...input.evidenceVector],
        answer: n.id === answerNode && (c.op === "captain" || c.op === "progress") ? { submissionId: input.requestId, option: c.option, text: c.op === "captain" ? c.text : c.evidence, at, provenance: actor, outboxId } : null });
      mutations.push({ kind: "decision", value });
    }
    for (const old of status.decisions.filter(d => d.planId === planId && d.ownerScopeId === scope.id && d.state === "pending" && !next.definition.nodes.some(n => n.id === d.nodeId)))
      mutations.push({ kind: "decision", value: { ...old, version: old.version + 1, state: "superseded" } });
    if (outboxId) mutations.push({ kind: "outbox", value: { id: outboxId, version: 1, ownerScopeId: scope.id, planId, kind: decisionId ? "decision.answer" : "plan.command",
      causationId: input.requestId, subjectHash: next.hash, decisionId, at, state: "pending", handledEpoch: null, resultRef: null } });
    if (op === "plan.stop") {
      const id = scopedDecisionId(scope.id, planId, "admission-stop"), old = status.operationHolds.find(h => h.id === id);
      mutations.push({ kind: "operation-hold", value: { id, version: (old?.version ?? 0) + 1, scopeId: scope.id, planId,
        operations: ["plan.start", "model.use"], reason: c.op === "captain" ? c.text || "Captain stopped admissions." : "Admission hold.", sourceVector: input.policyVector, state: "held" } });
      for (const effect of status.effects.filter(e => e.scopeId === scope.id && e.state === "reserved")) mutations.push({ kind: "effect", value: { ...effect, version: effect.version + 1, state: "cancelled" } });
    }
    const handled = c.op === "ack" && c.kind === "handled" ? status.outbox.filter(o => o.ownerScopeId === scope.id && o.planId === planId && o.state === "pending" && c.ids.includes(o.id)) : [];
    return { expectedVersions: refs(status, mutations), mutations,
      result: { planId, planHash: next.hash, decisionId, outboxId, ...(handled.length ? { handling: { scopeId: scope.id, epoch: input.epoch,
        outboxes: handled.map(o => ({ outboxId: o.id, decisionId: o.decisionId, causationId: o.causationId })) } } : {}) } };
  }
  /** Read-only routing: logical identity survives transfer. S02/S06 own offers; no send occurs here. */
  async pending() {
    const status = await this.store.read();
    return status.outbox.filter(o => o.state === "pending").map(entry => {
      const scope = status.scopes.find(s => s.id === entry.ownerScopeId), binding = status.bindings.find(b => b.scopeId === entry.ownerScopeId);
      return { entry, binding: status.freshness === "current" && scope?.state === "active" && binding?.state === "active" ? binding : null };
    });
  }
  /** Explicit source-bound operation approval, separate from plan review and from any release. */
  async approve(raw: ScopedPlanCommand, actorInput: SupervisionActor) {
    const input = structuredClone(ScopedPlanCommandSchema.parse(raw)), actor = structuredClone(SupervisionActorSchema.parse(actorInput));
    return this.store.transactCommand(input.requestId, digest({ approval: input }), actor, async status => {
      const op = operation(input.command), scope = this.checkOwner(status, input, actor, op);
      if (["plans", "show", "agenda", "lint", "retire", "notified", "release", "replace"].includes(input.command.op)) fail("UNSUPPORTED", "This operation is outside pilot approvals.");
      if (!["captain-ui", "mate-chat"].includes(actor.kind)) fail("UNSUPPORTED", "An operation approval needs explicit captain provenance.");
      const plan = status.plans.find(p => p.scopeId === scope.id && p.plan.hash === input.expectedPlanHash)?.plan;
      if (!plan || plan.revision !== input.revision || planSubjectHash(plan) !== input.subjectHash) fail("STALE", "Approval subject changed.");
      const targetPlan = input.command.op === "draft" || input.command.op === "revise" ? input.command.definition.id : input.command.op === "implicit" ? input.command.launch.id : "plan" in input.command ? input.command.plan : null;
      if (targetPlan !== plan.definition.id) fail("UNKNOWN_OWNER", "Approval target is a different plan.");
      const hostId = status.bindings.find(b => b.scopeId === scope.id)!.hostId, at = this.options.now?.() ?? new Date().toISOString();
      const nodeId = "node" in input.command ? input.command.node : undefined;
      const run = plan.definition.nodes.find(n => n.id === nodeId);
      const profile = run?.kind === "run" ? run.launch.agent : null;
      if (["start", "claim", "implicit"].includes(input.command.op)) {
        const launch = input.command.op === "implicit" ? input.command.launch : run?.kind === "run" ? run.launch : fail("HELD", "A decision cannot launch a worker.");
        await pinnedBrief(this.home, input, launch);
      }
      const target = operationTarget(input);
      await checkPolicy(this.home, status, { scopeId: scope.id, planId: plan.definition.id, projectIds: scope.projectIds, hostId, operation: op,
        policyVector: input.policyVector, evidenceVector: input.evidenceVector, revision: plan.revision, subjectHash: input.subjectHash!,
        head: input.head, artifactHash: input.artifactHash, model: null, approvalId: null, operationTarget: target }, at, true);
      if (profile) await checkPolicy(this.home, status, { scopeId: scope.id, planId: plan.definition.id, projectIds: scope.projectIds, hostId, operation: "model.use",
        policyVector: input.modelPolicyVector, evidenceVector: input.evidenceVector, revision: plan.revision, subjectHash: input.subjectHash!,
        head: input.head, artifactHash: input.artifactHash, model: profile.provider, profileDigest: digest(profile), approvalId: null, operationTarget: target }, at, true);
      const value = PolicyApprovalSchema.parse({ id: input.requestId, version: 1, scopeId: scope.id, planId: plan.definition.id, operation: op,
        revision: plan.revision, subjectHash: input.subjectHash, head: input.head, artifactHash: input.artifactHash, operationTarget: target,
        policyVector: input.policyVector, evidenceVector: input.evidenceVector, modelPolicyVector: input.modelPolicyVector, profileDigest: profile ? digest(profile) : null, provenance: actor, expiresAt: null });
      const mutations: SupervisionMutation[] = [{ kind: "approval", value }];
      return { expectedVersions: refs(status, mutations), mutations, result: { ...emptyResult(), planId: plan.definition.id, planHash: plan.hash } };
    });
  }
  async acknowledge(input: { requestId: string; scopeId: string; epoch: number; scopeVersion: number; outboxId: string; resultRef: string }, actor: SupervisionActor) {
    const data = structuredClone(input), provenance = structuredClone(SupervisionActorSchema.parse(actor));
    return this.store.transactCommand(data.requestId, digest(data), provenance, async status => {
      this.checkOwner(status, { ...data, homeId: status.homeId }, provenance, "plan.record");
      if (provenance.kind !== "agent") fail("UNKNOWN_OWNER", "Only the bound owner acknowledges a consequence.");
      const outbox = status.outbox.find(o => o.id === data.outboxId);
      if (!outbox || outbox.ownerScopeId !== data.scopeId) fail("UNKNOWN_OWNER", "Outbox is owned by another scope.");
      if (outbox.state !== "pending") fail("CONFLICT", "This consequence already has a handled result.");
      const resultId = /^command:([0-9a-f-]{36})$/.exec(data.resultRef)?.[1];
      const result = status.commands.find(c => c.id === resultId);
      const introduced = status.commands.findIndex(c => c.id === outbox.causationId);
      if (!result || result.actor.kind !== "agent" || result.actor.id !== provenance.id || result.result.planId !== outbox.planId ||
        status.commands.indexOf(result) <= introduced) fail("HELD", "Handling needs a later committed same-owner plan result, not a transport receipt or arbitrary reference.");
      const handling = result.result.handling;
      if (handling?.scopeId !== data.scopeId || handling.epoch !== data.epoch || !handling.outboxes.some(o =>
        o.outboxId === outbox.id && o.decisionId === outbox.decisionId && o.causationId === outbox.causationId))
        fail("HELD", "The committed result does not handle this exact outbox, decision and causation at the current owner epoch.");
      const mutations: SupervisionMutation[] = [{ kind: "outbox", value: { ...outbox, version: outbox.version + 1, state: "handled", handledEpoch: data.epoch, resultRef: data.resultRef } }];
      return { expectedVersions: refs(status, mutations), mutations, result: { ...emptyResult(), outboxId: outbox.id, planId: outbox.planId } };
    });
  }
}
