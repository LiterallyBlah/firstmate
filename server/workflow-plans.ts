/** Append-only planning ledger. Reads have no effects; no method creates or prompts an agent. */
import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile, stat, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { PlanId, PlanLaunchSchema, PlanDefinitionSchema, PlanPostureSourceSchema, WorkflowCommandSchema, captainReviewRequired, decisionOwner, planOwner, planAwaitingReview, planFinished, planPosture, planProblems, planSpent, planWorstCase, type AgendaItem, type PlanDefinition, type WorkflowCommand, type WorkflowPlan, type PlanNode } from "../shared/workflow-plans";
import { readPlanPosture } from "./workflow-posture";
import { digest, publish } from "./submissions";
import { serialized } from "./serialize";
import { resolveInHome } from "./files";
import { parseBacklog } from "./backlog";
import { observeNeedsYou } from "./needs-you-detect";
import { RemoteSnapshot } from "../shared/remotes";
import { fill, readTemplate, TEMPLATES } from "./templates";
import { dependenciesMet, planDecisionReady } from "../shared/plan-readiness";
export { dependenciesMet } from "../shared/plan-readiness";
import { mergeOwnership, ownershipCapsule, ownershipScope, planOwnership, quarantinedDependencyIds, readOwnershipCapsule, RetirementSchema, workflowHomeIdentity, type QuarantinedWorkflow, type WorkflowOwnership, type WorkflowRetirement } from "./workflow-ownership";

export const WorkflowEventSchema = z.object({ version: z.literal(1), home: z.string().min(1), plan: PlanId, sequence: z.number().int().nonnegative(), previous: z.string().length(64).nullable(),
  requestId: z.uuid(), requestHash: z.string().length(64), at: z.iso.datetime(), by: z.string().min(1),
  command: WorkflowCommandSchema, attempt: z.uuid().optional(), briefHash: z.string().length(64).optional(), launch: PlanLaunchSchema.optional(), postureSource: PlanPostureSourceSchema.optional(), hash: z.string().length(64) }).strict();
const EventSchema = WorkflowEventSchema;
export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>;
type Event = WorkflowEvent;
const RecoverySchema = z.object({ version: z.literal(1), home: z.string(), plan: PlanId, sequence: z.number().int().nonnegative(),
  orphanHash: z.string().length(64), previous: z.string().length(64).nullable(), revision: z.number().int().positive(), at: z.iso.datetime(), hash: z.string().length(64) }).strict();
const checksum = ({ hash: _hash, ...event }: Event) => digest(event);
const terminal = (state: string) => ["done", "landed", "failed", "cancelled"].includes(state);
export const planSubjectHash = (plan: WorkflowPlan) => digest({ definition: plan.definition, revision: plan.revision, status: plan.status, nodes: plan.nodes, owner: planOwner(plan), ownerEvents: plan.ownerEvents, captainActions: plan.captainEvents?.map(e => e.id) ?? [] });
export const backlogSection = (node: PlanNode, state: string, closedWithoutLanding = false) => terminal(state) && !(node.kind === "run" && node.launch.kind === "ship" && state === "done" && !closedWithoutLanding) ? "done" : state === "planned" ? "queued" : "in-flight";
export const samePlanItem = (item: ReturnType<typeof parseBacklog>[number], plan: WorkflowPlan, node: PlanNode) =>
  item.id === node.id && (node.kind === "decision" ? true : item.project === node.launch.project && (item.host ?? "local").toLowerCase() === node.launch.host.toLowerCase()) &&
  (plan.definition.implicit || item.plan === plan.definition.id);
/** Append admission only. Replayers deliberately do not call this helper. */
export function checkNewCaptainAction(command: WorkflowCommand, previous: WorkflowPlan | null, plans: WorkflowPlan[], unavailableDependencies = new Set<string>(), unavailable = false): void {
  if (command.op !== "captain" && command.op !== "progress") return;
  if (!previous || command.revision !== previous.revision || command.subjectHash !== planSubjectHash(previous)) throw new Error("This plan changed since you opened it. Refresh and review it again.");
  if (command.op === "progress") {
    if (planOwner(previous) !== "firstmate") throw new Error("The captain owns this plan. Transfer it explicitly before delegated progression.");
    if (command.action === "stage" && (previous.status !== "active" && !planAwaitingReview(previous) || captainReviewRequired(previous) || planFinished(previous))) throw new Error("This stage is held, finished or requires captain review.");
    if (command.action === "answer") {
      const node = previous.definition.nodes.find(n => n.id === command.node);
      if (!node || decisionOwner(previous, node) !== "firstmate") throw new Error("This decision belongs to the captain.");
      if (previous.nodes[command.node ?? ""]?.answer || unavailable || !planDecisionReady(previous, node, plans, unavailableDependencies)) throw new Error("Decision is already answered or not ready.");
    }
    return;
  }
  if (command.action === "transfer") {
    if (!command.owner || command.owner === planOwner(previous) || !command.text.trim()) throw new Error("A different owner and the captain's explicit delegation or revocation are required.");
    return;
  }
  if (command.action === "resume" && previous.status !== "held") throw new Error("Only a held plan can be resumed by the captain.");
  if (["approve", "edit"].includes(command.action) && planOwner(previous) !== "captain" && !captainReviewRequired(previous)) throw new Error("Routine plan review belongs to FirstMate. Transfer ownership before captain approval.");
  if (["approve", "edit", "changes"].includes(command.action) && !planAwaitingReview(previous)) throw new Error("This plan is not awaiting review. The first mate must submit a revised plan before another review.");
  if (command.action === "answer") {
    const node = previous.definition.nodes.find(n => n.id === command.node);
    if (node && decisionOwner(previous, node) !== "captain") throw new Error("This routine decision belongs to FirstMate.");
    if (previous.nodes[command.node ?? ""]?.answer) throw new Error("Decision is already answered.");
    if (unavailable || !node || !planDecisionReady(previous, node, plans, unavailableDependencies)) throw new Error("Decision is not ready. Approve the plan and complete its required evidence before answering.");
  }
}
const delegatedRunScope = (node: Extract<PlanNode, { kind: "run" }>) => digest({
  project: node.launch.project, host: node.launch.host, baseBranch: node.launch.baseBranch,
  mode: node.launch.mode, backlog: node.launch.backlog.existing, workflow: node.workflow, kind: node.launch.kind,
});
function assertDelegatedRevision(previous: WorkflowPlan, definition: PlanDefinition, plans: WorkflowPlan[]): void {
  if (digest(definition.request) !== digest(previous.definition.request) || digest(definition.ownership ?? null) !== digest(previous.definition.ownership ?? null)) throw new Error("Delegated revision cannot rewrite the request or ownership evidence.");
  const protectedNodes = new Set(plans.flatMap(plan => plan.definition.nodes.filter(node =>
    node.kind === "decision" && decisionOwner(plan, node) === "captain" || node.kind === "run" && !!node.launch.captainAuthority).map(node => node.id)));
  // Keep every old route to a Captain gate, including an indirect route through a routine decision.
  for (let added = true; added;) {
    added = false;
    for (const node of previous.definition.nodes) if (!protectedNodes.has(node.id) && node.after.some(edge => protectedNodes.has(edge.node))) {
      protectedNodes.add(node.id); added = true;
    }
  }
  for (const old of previous.definition.nodes) {
    if (old.kind === "decision" && decisionOwner(previous, old) === "captain" || old.kind === "run" && !!old.launch.captainAuthority) {
      if (digest(definition.nodes.find(node => node.id === old.id) ?? null) !== digest(old)) throw new Error("A captain-owned decision or authority gate cannot be changed through delegated revision.");
    }
    const current = definition.nodes.find(node => node.id === old.id);
    if (current) for (const edge of old.after.filter(edge => protectedNodes.has(edge.node))) {
      if (!current.after.some(next => digest(next) === digest(edge))) throw new Error("A captain gate dependency cannot be removed through delegated revision.");
    }
    if (old.kind === "run" && current?.kind === "run" && (old.workflow !== current.workflow || old.launch.kind !== current.launch.kind))
      throw new Error("Delegated revision changes scout or ship scope; ask the captain.");
  }
  const scopes = new Set(previous.definition.nodes.filter((n): n is Extract<PlanNode, { kind: "run" }> => n.kind === "run" && !n.launch.captainAuthority)
    .map(delegatedRunScope));
  for (const node of definition.nodes) {
    if (node.kind !== "run") continue;
    const old = previous.definition.nodes.find(n => n.id === node.id);
    if (old?.kind === "run" && digest(node.launch.captainAuthority ?? null) !== digest(old.launch.captainAuthority ?? null)) throw new Error("A captain authority gate cannot be changed through delegated revision.");
    if (node.launch.captainAuthority && digest(node) !== digest(old ?? null)) throw new Error("A captain authority gate cannot be changed through delegated revision.");
    if (!old || old.kind !== "run" || digest(node.launch) !== digest(old.launch)) {
      const scope = delegatedRunScope(node);
      if (!scopes.has(scope)) throw new Error("Delegated revision changes project, host, branch, delivery mode, scout/ship kind or authority scope; ask the captain.");
      if (old?.kind !== "run") for (const source of previous.definition.nodes.filter((n): n is Extract<PlanNode, { kind: "run" }> => n.kind === "run" && delegatedRunScope(n) === scope)) {
        for (const edge of source.after.filter(edge => protectedNodes.has(edge.node))) {
          if (!node.after.some(next => digest(next) === digest(edge))) throw new Error("A new run in a protected scope must retain its captain gate dependency.");
        }
      }
    }
  }
}
/** Append admission shared by the legacy request handler and the disabled S03 command seam. */
export function checkNewWorkflowAction(command: WorkflowCommand, previous: WorkflowPlan | null, plans: WorkflowPlan[], unavailableDependencies = new Set<string>(), unavailable = false): void {
  checkNewCaptainAction(command, previous, plans, unavailableDependencies, unavailable);
  if (!previous) return;
  if (command.op === "revise" && planOwner(previous) === "firstmate") assertDelegatedRevision(previous, command.definition, plans);
  if (command.op === "start" && planOwner(previous) === "firstmate") {
    const node = previous.definition.nodes.find(n => n.id === command.node);
    if (node?.kind === "run" && node.launch.captainAuthority && !node.after.some(edge => edge.on === "answered" &&
      plans.some(plan => plan.definition.nodes.some(gate => gate.id === edge.node && gate.kind === "decision" && decisionOwner(plan, gate) === "captain" && !!plan.nodes[gate.id]?.answer))))
      throw new Error("This run has a captain authority gate; record an answered captain-only prerequisite before starting.");
  }
}
function answerDecision(plan: WorkflowPlan, nodeId: string | undefined, option: string | undefined, evidence: string, at: string): void {
  const node = plan.definition.nodes.find(n => n.id === nodeId), state = nodeId ? plan.nodes[nodeId] : undefined;
  if (node?.kind !== "decision" || !state || state.answer || !node.options.some(o => o.id === option)) throw new Error("Decision is already answered or the option changed.");
  if (state.held) throw new Error("Review this held decision's dependencies before answering.");
  state.answer = option!; state.state = "done"; state.evidence = evidence || node.options.find(o => o.id === option)!.label;
  state.readyAt = { done: at, answered: at };
}
function reduce(previous: WorkflowPlan | null, event: Event): WorkflowPlan {
  const c = event.command;
  let next = previous ? structuredClone(previous) : null;
  if (c.op === "draft" || c.op === "implicit") {
    if (previous) throw new Error("Duplicate plan creation.");
    const definition: PlanDefinition = c.op === "draft" ? c.definition : {
      format: "firstmate.plan/1", id: c.launch.id, title: c.launch.title, request: { text: c.launch.title, at: event.at }, implicit: true,
      budget: { agents: 1, turns: 1 }, nodes: [{ id: c.launch.id, kind: "run", title: c.launch.title, summary: c.launch.title,
        workflow: c.launch.kind === "scout" ? "scout@1" : "task@1", launch: c.launch, after: [] }],
    };
    const posture = event.postureSource?.posture ?? planPosture(definition);
    next = { definition, revision: 1, sequence: 0, hash: "", posture, owner: definition.ownership?.owner ?? "captain", status: definition.ownership?.owner === "firstmate" && !event.postureSource?.warning && definition.request.posture !== "review" ? "active" : posture === "review" ? "review" : "active",
      approvedBudget: planWorstCase(definition), nodes: Object.fromEntries(definition.nodes.map(n => [n.id, { state: "planned" as const, ...(n.kind === "decision" ? { introducedAt: event.at } : {}) }])), told: [], handled: [],
      history: [{ revision: 1, at: event.at, by: event.by, reason: "draft" }], ...(event.postureSource ? { postureSource: event.postureSource } : {}) };
  }
  if (!next) throw new Error("Plan log does not start with a draft.");
  if (c.op === "captain") {
    // Revision/subject are checked once at append. Historical actions trust their committed chain.
    if (next.status === "abandoned") throw new Error("This plan was declined.");
    if (c.action === "changes" && !c.text.trim()) throw new Error("Describe the requested changes.");
    if (c.action === "answer") answerDecision(next, c.node, c.option, c.text, event.at);
    if (c.action === "transfer") {
      const from = planOwner(next), to = c.owner!;
      next.owner = to;
      next.ownerEvents ??= []; next.ownerEvents.push({ at: event.at, by: event.by, from, to, evidence: c.text });
      if (next.status === "review" && to === "firstmate" && !captainReviewRequired(next)) next.status = "active";
      else if (next.status === "active" && to === "captain" && !planFinished(next)) next.status = "review";
    }
    if (c.action === "edit") {
      if (!c.edits?.length) throw new Error("Choose an edit before approving.");
      for (const edit of c.edits) {
        if (edit.kind === "posture") { next.posture = edit.posture; continue; }
        const node = next.definition.nodes.find(n => n.id === edit.node);
        if (!node || next.nodes[node.id]?.state !== "planned") throw new Error("Only unstarted, unanswered nodes can be edited.");
        if (edit.kind === "remove") {
          next.removed ??= []; next.removed.push({ node: structuredClone(node), state: structuredClone(next.nodes[node.id]!) });
          // Removing a prerequisite holds its dependents; it never silently releases them.
          for (const dependent of next.definition.nodes.filter(n => n.after.some(d => d.node === node.id))) {
            dependent.after = dependent.after.filter(d => d.node !== node.id); next.nodes[dependent.id]!.held = true;
          }
          next.definition.nodes = next.definition.nodes.filter(n => n.id !== node.id); delete next.nodes[node.id];
        } else if (edit.kind === "dependencies") { node.after = edit.after; next.nodes[node.id]!.held = false; if (node.kind === "decision") next.nodes[node.id]!.introducedAt = event.at; }
        else { if (node.kind !== "run") throw new Error("A decision has no worker model or host."); if (edit.kind === "model") node.launch.agent = edit.agent; else node.launch.host = edit.host; }
      }
      next.definition = PlanDefinitionSchema.parse({ ...next.definition, implicit: false }); next.revision++;
      next.history.push({ revision: next.revision, at: event.at, by: event.by, reason: c.text || "Approved with structured edits" });
    }
    if (c.action === "approve" || c.action === "edit") { next.status = "active"; next.approvedBudget = planWorstCase(next.definition, next.nodes, next.removed); }
    if (c.action === "hold" || c.action === "changes") next.status = "held";
    if (c.action === "resume") next.status = planOwner(next) === "firstmate" && !captainReviewRequired(next) ? "active" : "review";
    if (c.action === "decline") {
      if (next.definition.nodes.some(n => n.kind === "run" && next!.nodes[n.id]?.state !== "planned")) throw new Error("A started plan cannot be declined. Hold it and preserve its work.");
      next.status = "abandoned";
    }
    next.captainEvents ??= []; next.captainEvents.push({ id: event.requestId, action: c.action, text: c.text, ...(c.node ? { node: c.node } : {}), at: event.at, by: event.by });
  }
  if (c.op === "progress") {
    if (c.action === "stage") next.status = "active";
    else answerDecision(next, c.node, c.option, c.evidence, event.at);
    next.history.push({ revision: next.revision, at: event.at, by: event.by, reason: `Delegated ${c.action}: ${c.evidence}` });
  }
  if (c.op === "revise") {
    if (c.expected !== previous?.hash || c.definition.id !== next.definition.id) throw new Error("Stale plan revision.");
    if (digest(c.definition.ownership ?? null) !== digest(next.definition.ownership ?? null)) throw new Error("Transfer ownership through a recorded captain action, not a revision.");
    for (const old of next.definition.nodes) {
      if (next.nodes[old.id]?.state !== "planned" && digest(c.definition.nodes.find(n => n.id === old.id)) !== digest(old)) throw new Error(`Started node ${old.id} is pinned; preserve it and replan separately.`);
      if (old.kind === "decision" && next.nodes[old.id]?.answer && digest(c.definition.nodes.find(n => n.id === old.id)) !== digest(old)) throw new Error("Answered decisions are immutable; add a replacement decision and hold affected work.");
    }
    const removed = next.definition.nodes.filter(n => !c.definition.nodes.some(newNode => newNode.id === n.id));
    next.removed = [...(next.removed ?? []), ...removed.map(node => ({ node, state: next!.nodes[node.id]! }))].filter(r => !c.definition.nodes.some(n => n.id === r.node.id));
    const oldDefinition = next.definition;
    next.definition = c.definition; next.revision++;
    next.nodes = Object.fromEntries(c.definition.nodes.map(n => [n.id, { ...(next!.nodes[n.id] ?? { state: "planned" as const }),
      ...(n.kind === "decision" && (!next!.nodes[n.id] || digest(oldDefinition.nodes.find(old => old.id === n.id)?.after) !== digest(n.after)) ? { introducedAt: event.at } : {}) }]));
    for (const node of next.definition.nodes) {
      if (node.after.some(e => next!.removed?.some(r => r.node.id === e.node))) next.nodes[node.id]!.held = "Prerequisite removed; replan before starting.";
      else if (next.nodes[node.id]!.held === "Prerequisite removed; replan before starting.") delete next.nodes[node.id]!.held;
    }
    const worst = planWorstCase(c.definition, next.nodes, next.removed);
    if (worst.agents > c.definition.budget.agents || worst.turns > c.definition.budget.turns) throw new Error("Revision exceeds cumulative spent and remaining budget.");
    // Scope and changed choices require review; counts never reset by revision.
    next.posture = event.postureSource?.posture ?? planPosture(c.definition);
    if (event.postureSource) next.postureSource = event.postureSource;
    next.status = next.status === "held" || next.status === "abandoned" ? next.status : planOwner(next) === "firstmate" ? captainReviewRequired(next) ? "review" : "active" : next.posture === "review" || worst.agents > next.approvedBudget.agents * 1.5 || worst.turns > next.approvedBudget.turns * 1.5 ? "review" : "active";
    next.history.push({ revision: next.revision, at: event.at, by: event.by, reason: c.reason });
  }
  if (c.op === "approve") {
    if (c.expected !== previous?.hash || next.status === "abandoned") throw new Error("Stale plan approval.");
    next.status = "active"; next.approvedBudget = planWorstCase(next.definition, next.nodes, next.removed);
    next.history.push({ revision: next.revision, at: event.at, by: event.by, reason: `Recorded from chat: ${c.quote}` });
    next.captainEvents ??= []; next.captainEvents.push({ id: event.requestId, action: "approve", text: c.quote, at: event.at, by: event.by });
  }
  if (c.op === "start" || (c.op === "implicit" && next.status === "active")) {
    const id = c.op === "start" ? c.node : c.launch.id;
    if (next.status !== "active" || next.nodes[id]?.state !== "planned" || !event.attempt || !event.briefHash) throw new Error("Run is held, already started or has no pinned brief.");
    const state = next.nodes[id]!;
    const launch = next.definition.nodes.find(n => n.id === id);
    const spent = planSpent(next.nodes, next.removed) + (state.attempt ? 0 : 1);
    if (state.held || spent > next.definition.budget.agents || spent > next.definition.budget.turns) throw new Error("Run is held or cumulative budget is exhausted.");
    next.nodes[id] = { ...state, state: "starting", attempt: event.attempt, briefHash: event.briefHash, claimed: c.op === "implicit",
      spent: (state.spent ?? 0) + (state.attempt ? 0 : 1), ...(launch?.kind === "run" ? { launch: event.launch ?? launch.launch } : {}) };
  }
  if (c.op === "claim") {
    const node = next.definition.nodes.find(n => n.id === c.node), state = next.nodes[c.node];
    if (next.status !== "active" || node?.kind !== "run" || state?.state !== "starting" || state.claimed || state.attempt !== c.attempt || state.briefHash !== c.briefHash || digest(state.launch ?? node.launch) !== digest(c.launch)) throw new Error("Launch does not match an unclaimed start intent; reconcile it without another create.");
    state.claimed = true;
  }
  if (c.op === "release" || c.op === "invalidate" || c.op === "validate" || c.op === "replace") {
    const node = next.definition.nodes.find(n => n.id === c.node), state = next.nodes[c.node];
    if (node?.kind !== "run" || !state?.attempt || state.attempt !== c.attempt) throw new Error("Transition does not match a committed start intent.");
    if (c.op === "release") {
      if (state.state !== "starting" || state.agentId) throw new Error("Only an uncreated start can be released.");
      next.nodes[c.node] = { ...state, state: "planned", claimed: false, evidence: c.evidence };
    } else if (c.op === "invalidate") {
      next.nodes[c.node] = { ...state, invalidated: c.evidence, evidence: c.evidence };
    } else if (c.op === "validate") {
      if (!state.invalidated || !terminal(state.state) || c.expected !== previous?.hash) throw new Error("Renewal requires current invalidated completed evidence.");
      const { invalidated: _invalidated, ...valid } = state;
      next.nodes[c.node] = { ...valid, evidence: c.evidence, availableAt: event.at };
    } else {
      if (c.expected !== previous?.hash || !state.agentId || !state.workspaceId || state.invalidated || (c.kind === "promote" && (node.launch.kind !== "scout" || state.state !== "done"))) throw new Error("Replacement requires the current accounted worker and verified promotion/relaunch evidence.");
      const spent = planSpent(next.nodes, next.removed);
      if (c.budget.agents < spent + 1 || c.budget.turns < spent + 1) throw new Error("Replacement needs additional cumulative budget.");
      next.definition.budget = c.budget;
      if (c.kind === "promote") { node.launch.kind = "ship"; node.workflow = "task@1"; }
      const { priorAttempts, ...prior } = state;
      next.nodes[c.node] = { state: "planned", spent: state.spent ?? 1, priorAttempts: [...(priorAttempts ?? []), prior], evidence: c.evidence };
      next.revision++; next.status = planOwner(next) === "firstmate" ? next.status : spent + 1 > next.approvedBudget.agents * 1.5 || spent + 1 > next.approvedBudget.turns * 1.5 ? "review" : next.status;
      next.history.push({ revision: next.revision, at: event.at, by: event.by, reason: `${c.kind}: ${c.evidence}` });
    }
  }
  if (c.op === "record") {
    const node = next.definition.nodes.find(n => n.id === c.node), state = next.nodes[c.node];
    if (node?.kind !== "run" || !state?.attempt || state.attempt !== c.attempt) throw new Error("Record does not match a committed start intent.");
    if (terminal(state.state) && !(state.state === "done" && c.state === "landed" && !state.closedWithoutLanding)) throw new Error("Completed run history is immutable.");
    if (c.state === "running" && (!c.agentId || !c.workspaceId)) throw new Error("A running record needs agent and workspace identities.");
    if (state.agentId && c.agentId && state.agentId !== c.agentId) throw new Error("Cannot replace an accounted worker.");
    const priorWorkspace = state.priorAttempts?.at(-1)?.workspaceId;
    if (priorWorkspace && c.workspaceId && c.workspaceId !== priorWorkspace) throw new Error("Manual replacement must preserve the workspace identity.");
    // Landing satisfies done too, but must not move an earlier done condition's readiness.
    const readiness = c.state === "done" || c.state === "landed"
      ? { readyAt: { ...state.readyAt, done: state.readyAt?.done ?? event.at, ...(c.state === "landed" ? { landed: event.at } : {}) } } : {};
    next.nodes[c.node] = { ...state, state: c.state, evidence: c.evidence, ...readiness, ...(terminal(c.state) ? { completedAt: event.at } : {}), ...(c.agentId ? { agentId: c.agentId } : {}), ...(c.workspaceId ? { workspaceId: c.workspaceId } : {}) };
  }
  if (c.op === "close") {
    const node = next.definition.nodes.find(n => n.id === c.node), state = next.nodes[c.node];
    if (node?.kind !== "run" || node.launch.kind !== "ship" || !state?.attempt || state.attempt !== c.attempt || c.expected !== previous?.hash ||
      state.state !== "done" || state.invalidated || state.held || state.closedWithoutLanding) throw new Error("Closing without landing requires the current verified done ship attempt and fresh plan hash.");
    state.closedWithoutLanding = { at: event.at, by: event.by, evidence: c.evidence };
    next.history.push({ revision: next.revision, at: event.at, by: event.by, reason: `Closed ${node.title} without landing: ${c.evidence}` });
  }
  if (c.op === "ack") next[c.kind] = [...new Set([...next[c.kind], ...c.ids])];
  if (c.op === "notified") { const action = next.captainEvents?.find(a => a.id === c.eventId); if (!action) throw new Error("Unknown captain event."); action.notified = true; }
  return { ...next, hash: event.hash, sequence: event.sequence };
}
export { reduce as replayWorkflowEvent };

export class WorkflowPlanStore {
  private static cache = new Map<string, { identity: string; plan: WorkflowPlan | null }>();
  constructor(readonly root: string, readonly home: string) {}
  private directory(id: string) { return join(this.root, PlanId.parse(id)); }
  private tips(id: string) { return join(this.root, ".tips", PlanId.parse(id)); }
  private published(id: string) { return join(this.root, ".published", PlanId.parse(id)); }
  private retired(id: string) { return join(this.root, ".retired", PlanId.parse(id)); }
  private async names(directory: string): Promise<string[]> {
    try { return (await readdir(directory)).sort(); } catch (e) { if (["ENOENT", "ENOTDIR"].includes((e as NodeJS.ErrnoException).code ?? "")) return []; throw e; }
  }
  private async retirement(id: string): Promise<WorkflowRetirement | undefined> {
    const names = (await this.names(this.retired(id))).filter(f => /^[a-f0-9-]{36}\.json$/.test(f));
    if (!names.length) return;
    if (names.length !== 1) throw new Error("Conflicting quarantine retirements require reconciliation.");
    const record = RetirementSchema.parse(JSON.parse(await readFile(join(this.retired(id), names[0]!), "utf8")));
    const { hash, ...body } = record;
    if (digest(body) !== hash || body.home !== workflowHomeIdentity(this.home) || body.plan !== id || names[0] !== `${body.requestId}.json`) throw new Error("Invalid quarantine retirement receipt.");
    return record;
  }
  private async quarantine(id: string, problem: string): Promise<QuarantinedWorkflow> {
    try { return await this.quarantineEvidence(id, problem); }
    catch (error) { return { plan: id, problem: `${problem} Ownership inspection failed: ${String(error)}`, fingerprint: digest([id, problem, String(error)]), inventory: { scopes: [{ node: id, host: null }], attempts: [], budget: { agents: 0, turns: 0 } } }; }
  }
  private async quarantineEvidence(id: string, problem: string): Promise<QuarantinedWorkflow> {
    const identities: unknown[] = [], inventories: WorkflowOwnership[] = [];
    // Published capsules remain usable when the event itself cannot be projected.
    for (const directory of [this.directory(id), this.tips(id), this.published(id)]) {
      let names: string[];
      try { names = await this.names(directory); } catch (error) { identities.push([directory, String(error)]); continue; }
      for (const name of names) {
        try {
          const path = join(directory, name), info = await stat(path);
          if (!info.isFile() || info.size > 512000) { identities.push([directory, name, info.size, info.mtimeMs]); continue; }
          const bytes = await readFile(path); identities.push([directory, name, digest(bytes.toString("base64"))]);
          if (directory === this.published(id) && /^\d{8}\.json$/.test(name)) {
            try { const marker = JSON.parse(bytes.toString("utf8")); if (marker.ownership) inventories.push(readOwnershipCapsule(marker.ownership, this.home, id, marker.hash)); }
            catch { /* A damaged capsule is never trusted as ownership evidence. */ }
          }
        } catch (error) { identities.push([directory, name, String(error)]); }
      }
    }
    // Pre-capsule logs retain the scopes and attempts from their verified prefix.
    let prefix: WorkflowPlan | null = null;
    let prefixNames: string[] = [];
    try { prefixNames = await this.names(this.directory(id)); } catch (error) { identities.push([this.directory(id), String(error)]); }
    for (const name of prefixNames.filter(f => /^\d{8}\.json$/.test(f))) {
      try {
        if ((await stat(join(this.directory(id), name))).size > 512000) break;
        const raw = JSON.parse(await readFile(join(this.directory(id), name), "utf8")), event = EventSchema.parse(raw);
        const tip = JSON.parse(await readFile(join(this.tips(id), name), "utf8"));
        if (checksum(raw) !== raw.hash || raw.requestHash !== digest(raw.command) || workflowHomeIdentity(event.home) !== workflowHomeIdentity(this.home) || event.plan !== id || event.sequence !== (prefix ? prefix.sequence + 1 : 0) || event.previous !== (prefix?.hash ?? null) || tip.hash !== event.hash || tip.sequence !== event.sequence) break;
        prefix = reduce(prefix, event); inventories.push(planOwnership(prefix));
      } catch { break; }
    }
    let retirement: WorkflowRetirement | undefined;
    try { retirement = await this.retirement(id); }
    catch (error) { problem += ` Retirement evidence is unreadable: ${String(error)}`; }
    if (retirement) inventories.push(retirement.inventory);
    const inventory = mergeOwnership(inventories);
    // If all ownership evidence was lost, reserve the known plan/task id, never the whole home.
    if (!inventory.scopes.length) inventory.scopes.push({ node: id, host: null });
    return { plan: id, problem, fingerprint: digest(identities), inventory, ...(retirement ? { retirement } : {}) };
  }
  private async retire(command: Extract<WorkflowCommand, { op: "retire" }>, requestId: string, by: string) {
    const existing = await this.retirement(command.plan);
    if (existing) {
      if (existing.requestId !== requestId || existing.requestHash !== digest(command)) throw new Error("Quarantine is already retired; its history and reservations remain retained.");
      return existing;
    }
    const read = await this.read(), quarantined = read.quarantined.find(q => q.plan === command.plan);
    if (!quarantined) throw new Error("Only a quarantined plan can be retired.");
    if (quarantined.fingerprint !== command.expected) throw new Error("Quarantined files changed since inspection; inspect again before retirement.");
    const body = { version: 1 as const, home: workflowHomeIdentity(this.home), plan: command.plan, requestId, requestHash: digest(command), at: new Date().toISOString(), by,
      expected: command.expected, evidence: command.evidence, inventory: quarantined.inventory };
    await mkdir(this.retired(command.plan), { recursive: true });
    const receipt = { ...body, hash: digest(body) };
    await publish(join(this.retired(command.plan), `${requestId}.json`), receipt);
    return receipt;
  }
  private async events(id: string, unpublishedTip?: string, allowUnpublished = false): Promise<Event[]> {
    let files: string[];
    try { files = await readdir(this.directory(id)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; files = []; }
    let tips: string[] = [];
    try { tips = (await readdir(this.tips(id))).filter(f => /^\d{8}\.json$/.test(f) && f !== unpublishedTip).sort(); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const names = files.filter(f => /^\d{8}\.json$/.test(f)).sort();
    const published = await this.names(this.published(id));
    if (published.some(f => !names.includes(f))) throw new Error(`Plan log ${id} lost its published tail or anchor.`);
    if (tips.length && (tips.length !== names.length || tips.some((f, n) => f !== names[n]))) throw new Error(`Plan log ${id} lost its published tail; reconcile its expected tip.`);
    if (names.length && !tips.length) throw new Error(`Plan log ${id} has no expected tip; explicit legacy reconciliation is required.`);
    if (files.some(f => !/^\d{8}\.json(?:\.[\w-]+\.tmp)?$/.test(f))) throw new Error(`Unknown file in plan log ${id}.`);
    const events: Event[] = []; let previous: string | null = null;
    for (const name of files.filter(f => /^\d{8}\.json$/.test(f)).sort()) {
      if (name !== `${String(events.length).padStart(8, "0")}.json`) throw new Error(`Plan log ${id} has a gap.`);
      const path = join(this.directory(id), name);
      if ((await stat(path)).size > 512000) throw new Error("Plan event too large.");
      // Hash the committed bytes' object before schema defaults/transforms are applied.
      const raw = JSON.parse(await readFile(path, "utf8"));
      if (checksum(raw) !== raw.hash || raw.requestHash !== digest(raw.command)) throw new Error(`Plan log ${id} failed its home identity or hash chain.`);
      const event = EventSchema.parse(raw);
      const tip = JSON.parse(await readFile(join(this.tips(id), name), "utf8"));
      if (tip.publication === 1 && !published.includes(name) && !allowUnpublished) throw new Error(`Plan log ${id} publication is incomplete; retry its original mutation.`);
      if (published.includes(name)) {
        const marker = JSON.parse(await readFile(join(this.published(id), name), "utf8"));
        if (marker.hash !== event.hash || marker.sequence !== event.sequence) throw new Error(`Plan log ${id} failed its publication marker.`);
        if (marker.ownership) readOwnershipCapsule(marker.ownership, this.home, id, event.hash);
      }
      const identity = (home: string) => process.platform === "win32" ? resolve(home).toLowerCase() : resolve(home);
      if (identity(event.home) !== identity(this.home) || event.plan !== id || event.sequence !== events.length || event.previous !== previous || tip.hash !== event.hash || tip.sequence !== event.sequence) throw new Error(`Plan log ${id} failed its home identity or hash chain.`);
      previous = event.hash; events.push(event);
    }
    return events;
  }
  /** Only mutations repair crash windows, under the same serialization boundary as append. */
  private async recoverUnpublishedTip(id: string): Promise<void> {
    const names = (await this.names(this.directory(id))).filter(f => /^\d{8}\.json$/.test(f));
    const tips = (await this.names(this.tips(id))).filter(f => /^\d{8}\.json$/.test(f));
    const published = await this.names(this.published(id));
    if (tips.length === names.length && tips.every((f, n) => f === names[n])) {
      // A crash after the event but before its exposure marker can complete publication.
      if (published.length === names.length) return;
      const events = await this.events(id, undefined, true);
      for (const event of events) {
        const name = `${String(event.sequence).padStart(8, "0")}.json`;
        const tip = JSON.parse(await readFile(join(this.tips(id), name), "utf8"));
        if (tip.publication === 1 && !published.includes(name)) {
          await mkdir(this.published(id), { recursive: true });
          const plan = events.slice(0, event.sequence + 1).reduce<WorkflowPlan | null>(reduce, null)!;
          await publish(join(this.published(id), name), { sequence: event.sequence, hash: event.hash, ownership: ownershipCapsule(this.home, plan) });
        }
      }
      return;
    }
    const orphan = tips.at(-1);
    if (!orphan || tips.length !== names.length + 1 || names.some((f, n) => f !== tips[n]) || orphan !== `${String(names.length).padStart(8, "0")}.json` || published.includes(orphan)) return;
    const tip = JSON.parse(await readFile(join(this.tips(id), orphan), "utf8"));
    // Older anchors cannot prove whether a missing event was exposed. Never roll those back.
    if (tip.publication !== 1 || tip.sequence !== names.length || !/^[a-f0-9]{64}$/.test(tip.hash)) return;
    const events = await this.events(id, orphan), previous = events.reduce<WorkflowPlan | null>(reduce, null);
    const attempts = new Set(events.map(e => e.attempt).filter(Boolean));
    const data = (await resolveInHome(this.home, "data")).absolute;
    let tasks: Dirent[];
    try { tasks = await readdir(data, { withFileTypes: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; tasks = []; }
    for (const task of tasks) {
      if (!task.isDirectory()) continue;
      const launches = (await resolveInHome(this.home, `data/${task.name}/launches`)).absolute;
      for (const name of (await this.names(launches)).filter(f => /^[1-9]\d*\.json$/.test(f))) {
        const file = join(launches, name);
        if ((await stat(file)).size > 512000) throw new Error("Launch record too large to reconcile.");
        const record = JSON.parse(await readFile(file, "utf8"));
        if (record.workflow?.plan === id && !attempts.has(record.workflow.attempt)) throw new Error(`Plan ${id} has a launch record for an unknown attempt; reconcile without another create.`);
      }
    }
    const body = { version: 1 as const, home: resolve(this.home), plan: id, sequence: tip.sequence as number, orphanHash: tip.hash as string,
      previous: previous?.hash ?? null, revision: previous?.revision ?? 1, at: new Date().toISOString() };
    const receipt = join(this.tips(id), `recovered-${tip.hash}.json`);
    // Durable audit precedes removal, so another crash cannot erase the recovery history.
    if (!(await this.names(this.tips(id))).includes(`recovered-${tip.hash}.json`)) await publish(receipt, { ...body, hash: digest(body) });
    await rm(join(this.tips(id), orphan));
  }
  private async recoveries(id: string) {
    const receipts = [];
    for (const name of (await this.names(this.tips(id))).filter(f => /^recovered-[a-f0-9]{64}\.json$/.test(f))) {
      const { hash, ...receipt } = RecoverySchema.parse(JSON.parse(await readFile(join(this.tips(id), name), "utf8")));
      const identity = (home: string) => process.platform === "win32" ? resolve(home).toLowerCase() : resolve(home);
      if (digest(receipt) !== hash || identity(receipt.home) !== identity(this.home) || receipt.plan !== id || name !== `recovered-${receipt.orphanHash}.json`) throw new Error("Invalid unpublished-anchor recovery receipt.");
      receipts.push(receipt);
    }
    return receipts;
  }
  private async recoveryHistory(plan: WorkflowPlan): Promise<WorkflowPlan> {
    for (const receipt of await this.recoveries(plan.definition.id)) {
      plan.history.push({ revision: receipt.revision, at: receipt.at, by: "daemon:recovery", reason: `Recovered unpublished anchor ${receipt.sequence} (${receipt.orphanHash}); no launch was exposed.` });
    }
    plan.history.sort((a, b) => a.at.localeCompare(b.at));
    return plan;
  }
  async get(id: string): Promise<WorkflowPlan | null> {
    if (await this.retirement(id)) throw new Error(`Plan ${id} is retired; its history, budget and task reservations remain retained.`);
    const key = `${resolve(this.root)}:${resolve(this.home)}:${id}`, identities: unknown[] = [];
    for (const directory of [this.directory(id), this.tips(id), this.published(id)]) {
      let names: string[]; try { names = (await readdir(directory)).sort(); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; names = []; }
      for (const name of names) { const s = await stat(join(directory, name)); identities.push([directory, name, s.ino, s.size, s.mtimeMs, s.ctimeMs]); }
    }
    const identity = digest(identities), cached = WorkflowPlanStore.cache.get(key);
    if (cached?.identity === identity) return structuredClone(cached.plan);
    let plan = (await this.events(id)).reduce<WorkflowPlan | null>(reduce, null);
    if (plan) plan = await this.recoveryHistory(plan);
    if (WorkflowPlanStore.cache.size > 2000) WorkflowPlanStore.cache.clear();
    WorkflowPlanStore.cache.set(key, { identity, plan }); return structuredClone(plan);
  }
  async read(): Promise<{ plans: WorkflowPlan[]; problems: string[]; warnings: string[]; quarantined: QuarantinedWorkflow[]; unavailable?: boolean }> {
    let entries;
    try { entries = await readdir(this.root, { withFileTypes: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { plans: [], problems: [], warnings: [], quarantined: [] }; return { plans: [], problems: [String(e)], warnings: [], quarantined: [], unavailable: true }; }
    const plans: WorkflowPlan[] = [], problems: string[] = [], warnings: string[] = [], quarantined: QuarantinedWorkflow[] = [];
    const ids = new Set<string>(), reserved = [".tips", ".published", ".retired"];
    const consider = (name: string) => { if (PlanId.safeParse(name).success) ids.add(name); else warnings.push(`Ignored non-plan entry: ${name}.`); };
    for (const entry of entries) if (!reserved.includes(entry.name)) consider(entry.name);
    for (const directory of reserved) {
      try { for (const id of await readdir(join(this.root, directory))) consider(id); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") return { plans, problems: [String(e)], warnings, quarantined, unavailable: true }; }
    }
    for (const id of ids) {
      try {
        const plan = await this.get(id);
        if (plan) plans.push(plan);
        else {
          const recovered = await this.recoveries(id);
          if (!recovered.length || recovered.some(r => r.sequence !== 0 || r.previous !== null)) throw new Error("Empty or stray plan entry.");
        }
      }
      catch (error) {
        const problem = `Plan ${id}: ${error instanceof Error ? error.message : String(error)}`;
        const held = await this.quarantine(id, problem);
        quarantined.push(held);
        if (held.retirement) warnings.push(`Retired quarantine ${id}: ${held.retirement.evidence} Task reservations remain held.`);
        else problems.push(problem);
      }
    }
    return { plans: plans.sort((a, b) => a.definition.id.localeCompare(b.definition.id)), problems, warnings, quarantined };
  }
  async list(): Promise<WorkflowPlan[]> { return (await this.read()).plans; }
  async brief(node: PlanNode): Promise<{ hash: string; text: string }> {
    if (node.kind !== "run") throw new Error("Decisions cannot start workers.");
    const path = await resolveInHome(this.home, node.launch.brief.file);
    if ((await stat(path.absolute)).size > 100000) throw new Error("Brief exceeds 100,000 bytes.");
    const text = await readFile(path.absolute, "utf8"); if (!text.trim()) throw new Error("Brief is empty.");
    return { hash: createHash("sha256").update(text).digest("hex"), text };
  }
  async execute(input: WorkflowCommand, requestId: string, by: string): Promise<unknown> {
    const command = WorkflowCommandSchema.parse(input); z.uuid().parse(requestId);
    if (command.op === "plans") return (await this.list()).filter(p => command.all || (!planFinished(p) && p.status !== "abandoned"));
    if (command.op === "show") {
      try { const plan = await this.get(command.plan); return plan ? { ...plan, finished: planFinished(plan), subjectHash: planSubjectHash(plan) } : null; }
      catch (error) { return { quarantined: await this.quarantine(command.plan, error instanceof Error ? error.message : String(error)) }; }
    }
    if (command.op === "agenda") return this.agenda();
    if (command.op === "lint") {
      let catalog: z.infer<typeof RemoteSnapshot> | null = null;
      try { catalog = RemoteSnapshot.parse(JSON.parse(await readFile((await resolveInHome(this.home, "data/remote-hosts.json")).absolute, "utf8"))); }
      catch { /* Unknown host identities stay quarantined if the catalog is missing or unreadable. */ }
      return observeNeedsYou(await readFile((await resolveInHome(this.home, "data/backlog.md")).absolute, "utf8"), catalog);
    }
    return serialized(resolve(this.root), async () => {
      if (command.op === "retire") return this.retire(command, requestId, by);
      const id = command.op === "draft" || command.op === "revise" ? command.definition.id : command.op === "implicit" ? command.launch.id : command.plan;
      if (await this.retirement(id)) throw new Error(`Plan ${id} is retired; its history, budget and task reservations remain retained.`);
      await this.recoverUnpublishedTip(id);
      const events = await this.events(id), previous = events.reduce<WorkflowPlan | null>(reduce, null);
      const replay = events.find(e => e.requestId === requestId);
      if (replay) { if (replay.requestHash !== digest(command)) throw new Error("Request ID has different content."); return this.renderedResult(previous!, replay); }
      if (command.op === "approve" && previous && planOwner(previous) !== "captain" && !captainReviewRequired(previous)) throw new Error("Routine review belongs to FirstMate; use delegated progression.");
      if (command.op === "replace" && previous && planOwner(previous) === "firstmate" && command.kind === "promote") throw new Error("Promotion changes the deliverable scope; ask the captain.");
      const postureDefinition = command.op === "draft" || command.op === "revise" ? command.definition : command.op === "implicit" ? PlanDefinitionSchema.parse({
        format: "firstmate.plan/1", id, title: command.launch.title, request: { text: command.launch.title, at: new Date().toISOString() }, implicit: true,
        budget: { agents: 1, turns: 1 }, nodes: [{ id, title: command.launch.title, summary: command.launch.title, kind: "run", workflow: command.launch.kind === "scout" ? "scout@1" : "task@1", launch: command.launch }],
      }) : null;
      const postureSource = postureDefinition ? await readPlanPosture(this.home, postureDefinition) : undefined;
      const { plans, quarantined, unavailable } = await this.read();
      const unavailableDependencies = quarantinedDependencyIds(quarantined);
      // Apply current admission once, after request-id replay. Historical events
      // retain their committed meaning when the ledger is rebuilt.
      checkNewWorkflowAction(command, previous, plans, unavailableDependencies, unavailable);
      const ownsWork = ["draft", "revise", "implicit", "start", "claim", "replace"].includes(command.op);
      const candidates = command.op === "draft" || command.op === "revise" ? command.definition.nodes.map(ownershipScope) : command.op === "implicit" ? [{ node: command.launch.id, host: command.launch.host.trim().toLowerCase() }] :
        ownsWork ? previous?.definition.nodes.filter(n => "node" in command && n.id === command.node).map(ownershipScope) ?? [] : [];
      const conflicts = quarantined.filter(q => candidates.some(candidate => q.inventory.scopes.some(held => held.node === candidate.node && (held.host === null || held.host === candidate.host))));
      if (ownsWork && (unavailable || conflicts.length)) {
        throw new Error(`Cannot establish task ownership for this task/host scope; inspect or retire its quarantined plan without resetting its attempts.\n${conflicts.map(q => q.problem).join("\n")}`);
      }
      if (command.op === "draft" || command.op === "revise") {
        const removed = new Set([...(previous?.removed ?? []).map(r => r.node.id), ...(previous?.definition.nodes ?? []).filter(n => !command.definition.nodes.some(next => next.id === n.id)).map(n => n.id)]);
        // Cross-plan dependents still prevent removing their referenced node; only this
        // plan's surviving dependents may retain a missing prerequisite under a hold.
        const problems = planProblems(command.definition, plans, removed);
        for (const p of plans.filter(p => p.definition.id !== id)) for (const n of p.definition.nodes) for (const edge of n.after) if (removed.has(edge.node)) problems.push(`${n.id}: unknown dependency ${edge.node}.`);
        if (problems.length) throw new Error(problems.join("\n"));
      }
      if (command.op === "implicit" && previous?.definition.implicit && ["starting", "planned"].includes(previous.nodes[id]?.state ?? "")) {
        const node = previous.definition.nodes[0];
        if (node?.kind !== "run" || digest(previous.nodes[id]?.launch ?? node.launch) !== digest(command.launch)) throw new Error("Existing implicit intent has different content.");
        if (previous.nodes[id]?.attempt) await this.assertUncreated(id, previous.nodes[id]!.attempt!);
        const original = events.find(e => e.command.op === "implicit")!;
        return this.renderedResult(previous, original);
      }
      if (command.op === "implicit" && plans.some(p => p.definition.nodes.some(n => n.id === id))) throw new Error("Task already belongs to a plan; use its recorded start intent.");
      if (command.op === "release") await this.assertUncreated(command.node, command.attempt);
      if (command.op === "close") {
        // Quarantine inventories retain identities, not dependency edges. An unreadable
        // plan could hide a landing consumer that would invalidate later commands on repair.
        if (unavailable || quarantined.some(p => !p.retirement)) throw new Error("Plan dependencies are unavailable; repair or retire quarantined plans before closing without landing.");
        // Match planProblems, including retained declined plans. Declining is not a
        // rewrite of their dependencies; remove that prerequisite explicitly first.
        if (plans.some(p => p.definition.nodes.some(n => !terminal(p.nodes[n.id]?.state ?? "planned") &&
          n.after.some(edge => edge.node === command.node && edge.on === "landed")))) {
          throw new Error("A plan still requires this run to land; replan its dependents before closing without landing.");
        }
      }
      if (command.op === "claim") {
        const node = previous?.definition.nodes.find(n => n.id === command.node);
        if (!node || !dependenciesMet(node, plans, unavailableDependencies)) throw new Error("Run dependencies changed since start; reconcile before dispatch.");
        if ((await this.brief(node)).hash !== command.briefHash) throw new Error("Brief changed since start; replan before dispatch.");
      }
      let briefHash: string | undefined;
      let launch: z.infer<typeof PlanLaunchSchema> | undefined;
      if (command.op === "start") {
        const node = previous?.definition.nodes.find(n => n.id === command.node);
        if (!node || !dependenciesMet(node, plans, unavailableDependencies)) throw new Error("Run dependencies are not satisfied.");
        briefHash = (await this.brief(node)).hash;
        if (node.kind === "run") {
          launch = structuredClone(node.launch);
          if (node.after.length) launch.dependency = { satisfiedBy: node.after.map(edge => {
            const source = plans.find(p => p.nodes[edge.node]);
            return `${edge.node}: ${edge.on}; plan ${source!.definition.id} at ${source!.hash}`;
          }).join("; ") };
        }
      } else if (command.op === "implicit") briefHash = (await this.brief({ kind: "run", id, title: command.launch.title, summary: command.launch.title, after: [], workflow: command.launch.kind === "scout" ? "scout@1" : "task@1", launch: command.launch })).hash;
      const event: Event = { version: 1, home: resolve(this.home), plan: id, sequence: events.length, previous: previous?.hash ?? null, requestId, requestHash: digest(command), at: new Date().toISOString(), by, command,
        ...(briefHash && !(command.op === "implicit" && postureSource?.posture === "review") ? { briefHash, attempt: command.op === "start" ? previous?.nodes[command.node]?.attempt ?? randomUUID() : randomUUID() } : {}), ...(launch ? { launch } : {}), ...(postureSource ? { postureSource } : {}), hash: "" };
      event.hash = checksum(event); const next = reduce(previous, event);
      if (command.op === "captain" && command.action === "edit") {
        const changedHosts = next.definition.nodes.filter(n => n.kind === "run" && previous?.definition.nodes.some(old => old.id === n.id && old.kind === "run" && old.launch.host !== n.launch.host)).map(ownershipScope);
        if (quarantined.some(q => changedHosts.some(candidate => q.inventory.scopes.some(held => held.node === candidate.node && (held.host === null || held.host === candidate.host))))) throw new Error("Cannot establish task ownership for the edited host; its task scope is quarantined.");
      }
      const problems = planProblems(next.definition, plans, new Set(next.removed?.map(r => r.node.id))); if (problems.length) throw new Error(problems.join("\n"));
      if (event.sequence > 99999999) throw new Error("Plan event capacity exceeded.");
      await mkdir(this.directory(id), { recursive: true });
      await mkdir(this.tips(id), { recursive: true });
      // Publish the expected high-water mark first. A crash in this gap holds this plan
      // for reconciliation rather than silently recovering a shorter, executable history.
      await publish(join(this.tips(id), `${String(event.sequence).padStart(8, "0")}.json`), { sequence: event.sequence, hash: event.hash, publication: 1 });
      // Exclusive hard link is the cross-process compare-and-swap. A collision is never retried.
      await publish(join(this.directory(id), `${String(event.sequence).padStart(8, "0")}.json`), event);
      // This separate receipt is committed before returning any intent or result.
      await mkdir(this.published(id), { recursive: true });
      await publish(join(this.published(id), `${String(event.sequence).padStart(8, "0")}.json`), { sequence: event.sequence, hash: event.hash, ownership: ownershipCapsule(this.home, next) });
      return this.renderedResult(next, event);
    });
  }
  private async assertUncreated(id: string, attempt: string): Promise<void> {
    let names: string[];
    const directory = (await resolveInHome(this.home, `data/${id}/launches`)).absolute;
    try { names = await readdir(directory); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
    for (const name of names.filter(n => /^[1-9]\d*\.json$/.test(n))) {
      const record = JSON.parse(await readFile(join(directory, name), "utf8"));
      if (record.workflow?.attempt === attempt && record.state !== "dry-run") throw new Error("Launch record exists; reconcile without another create.");
    }
  }
  private async renderedResult(plan: WorkflowPlan, event: Event) {
    plan = await this.recoveryHistory(plan);
    let projectionProblem: string | undefined;
    try { await this.render(plan); } catch { projectionProblem = "Plan committed; readable plan.md could not be refreshed. Re-read this intent rather than repeating a create."; }
    return this.result(plan, event, projectionProblem);
  }
  private async result(plan: WorkflowPlan, event: Event, projectionProblem?: string) {
    const c = event.command, node = c.op === "start" ? c.node : c.op === "implicit" ? c.launch.id : null;
    const definition = plan.definition.nodes.find(n => n.id === node);
    let items: ReturnType<typeof parseBacklog> = [];
    try { items = parseBacklog(await readFile((await resolveInHome(this.home, "data/backlog.md")).absolute, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") projectionProblem = "Plan committed; backlog is unreadable. Reconcile it before applying any projection."; }
    return { plan, worstCase: planWorstCase(plan.definition, plan.nodes, plan.removed), ...(projectionProblem ? { projectionProblem } : {}), backlog: projectionProblem ? [] : plan.definition.nodes.map(n => ({ node: n.id, section: backlogSection(n, plan.nodes[n.id]!.state, !!plan.nodes[n.id]!.closedWithoutLanding), line: planBacklogLine(plan, n, items.find(i => samePlanItem(i, plan, n))) })),
      comingUp: plan.definition.nodes.filter(n => n.kind === "decision" && !plan.nodes[n.id]?.answer),
      ...(definition?.kind === "run" && node && plan.nodes[node]?.attempt ? { launch: { ...(plan.nodes[node]!.launch ?? definition.launch), workflow: { plan: plan.definition.id, node, attempt: plan.nodes[node]!.attempt, briefHash: plan.nodes[node]!.briefHash } } } : {}) };
  }
  async render(plan: WorkflowPlan): Promise<void> {
    const path = await resolveInHome(this.home, `data/plans/${plan.definition.id}/plan.md`);
    await mkdir(dirname(path.absolute), { recursive: true });
    const nodes = await Promise.all(plan.definition.nodes.map(async n => fill(await readTemplate(n.kind === "run" ? TEMPLATES.workflowRun : TEMPLATES.workflowDecision), {
      title: n.title, state: plan.nodes[n.id]?.closedWithoutLanding ? "closed without landing" : plan.nodes[n.id]?.state ?? "planned", summary: n.summary,
      workflow: n.kind === "run" ? n.workflow : "", model: n.kind === "run" ? n.launch.agent.provider : "",
      thinking: n.kind === "run" ? n.launch.agent.thinkingOptionId ?? "—" : "", host: n.kind === "run" ? n.launch.host : "",
      options: n.kind === "decision" ? n.options.map(o => `- ${o.label}: ${o.consequence}`).join("\n") : "",
      recommendation: n.kind === "decision" ? n.options.find(o => o.id === n.recommendation)?.label ?? "—" : "",
      rationale: n.kind === "decision" ? n.rationale : "",
      after: n.after.map(d => `${d.node} (${d.reason}, ${d.on})`).join(", ") || "—", evidence: [plan.nodes[n.id]?.evidence ?? "—", ...(plan.nodes[n.id]?.closedWithoutLanding ? [`Closed without landing: ${plan.nodes[n.id]!.closedWithoutLanding!.evidence}`] : [])].join("\n"),
    })));
    const content = fill(await readTemplate(TEMPLATES.workflowPlan), {
      title: plan.definition.title, request: plan.definition.request.text, revision: String(plan.revision), posture: plan.posture, state: planFinished(plan) ? "finished" : plan.status,
      budget: JSON.stringify(planWorstCase(plan.definition, plan.nodes, plan.removed)),
      owner: planOwner(plan) === "firstmate" ? "FirstMate (routine plan progression)" : "Captain",
      delegation: plan.ownerEvents?.at(-1)?.evidence ?? plan.definition.ownership?.evidence ?? "No delegation recorded",
      postureSource: plan.postureSource ? `${plan.postureSource.source}: ${plan.postureSource.detail}${plan.postureSource.warning ? ` ${plan.postureSource.warning}` : ""}` : "D2 default",
      nodes: nodes.join("\n\n"),
      history: plan.history.map(h => `- ${h.revision} · ${h.at} · ${h.by} · ${h.reason}`).join("\n"),
      ownerHistory: plan.ownerEvents?.map(event => `- ${event.at} · ${event.by}: ${event.from} → ${event.to} · ${event.evidence}`).join("\n") || "—",
      actions: (plan.captainEvents ?? []).map(a => `- ${a.at} · ${a.by === "board:captain" ? "Captain pressed" : "Recorded by the first mate from chat"}: ${a.action}${a.text ? ` · ${a.text}` : ""}`).join("\n"),
    });
    const temporary = `${path.absolute}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, content, { flag: "wx" }); await rename(temporary, path.absolute); }
    finally { await rm(temporary, { force: true }); }
  }
  async agenda(): Promise<AgendaItem[]> {
    const { plans, problems, warnings, quarantined } = await this.read(), unavailableDependencies = quarantinedDependencyIds(quarantined), result: AgendaItem[] = [
      ...problems.map((text, n): AgendaItem => ({ id: `plan-problem:${n}`, kind: "escalation", priority: 1, plan: "unavailable", text })),
      ...warnings.map((text, n): AgendaItem => ({ id: `plan-warning:${n}`, kind: "books", priority: 6, plan: "unavailable", text })),
    ];
    let backlog = ""; try { backlog = await readFile((await resolveInHome(this.home, "data/backlog.md")).absolute, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const items = parseBacklog(backlog);
    for (const plan of plans) {
      const add = (kind: AgendaItem["kind"], priority: number, key: string, text: string, node?: string, extra = {}) => {
        const id = `${plan.definition.id}:${key}`;
        if (kind === "tell" ? plan.told.includes(id) : plan.handled.includes(id)) return;
        result.push({ id, kind, priority, plan: plan.definition.id, text, ...(node ? { node } : {}), ...extra });
      };
      if (plan.definition.implicit && planFinished(plan)) continue;
      for (const removed of plan.removed ?? []) {
        const current = items.find(i => samePlanItem(i, plan, removed.node));
        if (current) add(current.agentId || removed.state.agentId ? "escalation" : "books", current.agentId ? 1 : 6,
          `removed:${removed.node.id}:${plan.revision}`, `Removed planned work: ${removed.node.title}. ${current.agentId ? "Inspect unexpected worker; do not discard its work." : "Remove only this plan's scoped backlog row."}`, removed.node.id, { section: "remove" });
      }
      for (const action of plan.captainEvents ?? []) {
        add("captain", 2, `captain:${action.id}`, `${action.by === "board:captain" ? "Captain pressed" : "Recorded by the first mate from chat"}: ${action.action}. ${action.text}`, action.node);
        if (action.action === "changes") add("replan", 3, `changes:${action.id}`, action.text);
      }
      if (plan.status === "abandoned") {
        for (const node of plan.definition.nodes) {
          const current = items.find(i => samePlanItem(i, plan, node));
          if (!current) continue;
          if (current.agentId) add("escalation", 1, `declined-worker:${node.id}`, `A declined node still names a worker. Reconcile ${node.title} and preserve its work.`, node.id);
          else if (current.section === "queued") add("books", 6, `declined-books:${node.id}:${plan.revision}`, `Remove the declined Queued line for ${node.title}; retain the plan history.`, node.id, { section: "remove", line: "" });
        }
        continue;
      }
      if (planFinished(plan)) add("tell", 5, `plan-finished:${plan.revision}`, `${plan.definition.title}: all planned nodes have reached an end. Check the recorded outcomes.`, undefined);
      if (plan.status === "review" && !planFinished(plan)) add(planOwner(plan) === "firstmate" && !captainReviewRequired(plan) ? "replan" : "tell", planOwner(plan) === "firstmate" && !captainReviewRequired(plan) ? 3 : 5, `approval:${plan.revision}`, planOwner(plan) === "firstmate" && !captainReviewRequired(plan) ? `Review and record the next stage for ${plan.definition.title}.` : `Present ${plan.definition.title} for approval.`);
      for (const node of plan.definition.nodes) {
        const state = plan.nodes[node.id]!;
        if (state.held) add("replan", 3, `held:${node.id}:${plan.revision}`, `${node.title}: ${state.held}`, node.id);
        if (state.state === "unresolved" || state.invalidated) add("escalation", 1, `uncertain:${node.id}:${state.attempt}:${digest(state.invalidated ?? null)}`, `Reconcile ${node.title}; never create or send again blindly. ${state.invalidated ?? ""}`, node.id);
        if (!terminal(state.state) && node.after.some(d => plans.some(p => ["failed", "cancelled"].includes(p.nodes[d.node]?.state ?? "")))) add("replan", 3, `dependency:${node.id}:${plan.revision}`, `${node.title} has a failed or cancelled dependency.`, node.id);
        if (!terminal(state.state) && node.after.some(d => unavailableDependencies.has(d.node))) add("replan", 3, `quarantined:${node.id}:${digest([...unavailableDependencies])}`, `${node.title}: prerequisite task identity is quarantined; replan with unambiguous evidence.`, node.id);
        const ready = dependenciesMet(node, plans, unavailableDependencies);
        if (node.kind === "run" && state.state === "planned" && !state.held && plan.status === "active" && ready) {
          try { await this.brief(node); add("start", 4, `start:${node.id}:${plan.revision}`, `Start ${node.title}.`, node.id); }
          catch { add("replan", 3, `brief:${node.id}:${plan.revision}`, `Supply the missing or unreadable brief for ${node.title}.`, node.id); }
        }
        if (node.kind === "decision" && !state.answer && ready) add(decisionOwner(plan, node) === "firstmate" ? "replan" : "tell", decisionOwner(plan, node) === "firstmate" ? 3 : 5, `decision:${node.id}:${plan.revision}`, decisionOwner(plan, node) === "firstmate" ? `Delegated decision due: ${node.title}.` : `Decision due: ${node.title}.`, node.id);
        if (terminal(state.state)) add("tell", 5, `finished:${node.id}:${state.state}`, `${node.title}: ${state.state}. ${state.evidence ?? ""}`, node.id);
        // Until slice 4, live facts must be checked by the mate. A worker's status never completes a run.
        if (["running", "starting"].includes(state.state)) add("replan", 3, `observe:${node.id}:${state.attempt}`, `Verify ${node.title} against Paseo and its delivery evidence; outcome is unobserved.`, node.id);
        const section = backlogSection(node, state.state, !!state.closedWithoutLanding), current = items.find(i => samePlanItem(i, plan, node));
        const line = planBacklogLine(plan, node, current);
        if (!current && section === "done") continue;
        const expected = parseBacklog(`## ${section === "in-flight" ? "In flight" : section === "done" ? "Done" : "Queued"}\n${line}`)[0]!;
        if (!current || current.section !== section || (state.agentId && current.agentId !== state.agentId) || current.blockedBy !== expected.blockedBy || digest(current.neededBy ?? []) !== digest(expected.neededBy ?? [])) add("books", 6, `books:${node.id}:${digest({ line, section }).slice(0, 12)}`, `Reconcile ${node.title} in ${section}.`, node.id, { line, section });
      }
    }
    return result.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }
}

export function planBacklogLine(plan: WorkflowPlan, node: PlanNode, current?: ReturnType<typeof parseBacklog>[number]): string {
  const state = plan.nodes[node.id]!;
  const needed = plan.definition.nodes.filter(n => n.after.some(d => d.node === node.id)).map(n => n.id);
  return `- [${backlogSection(node, state.state, !!state.closedWithoutLanding) === "done" ? "x" : " "}] ${node.id} - ${node.title}` +
    (node.kind === "run" ? ` (project: ${node.launch.project}) (kind: ${node.launch.kind}) (mode: ${node.launch.mode})${node.launch.host === "local" ? "" : ` (host: ${node.launch.host})`}` : " (kind: captain)") +
    (plan.definition.implicit ? "" : ` (plan: ${plan.definition.id})`) + (node.after.length ? ` (blocked-by: ${node.after.map(d => d.node).join(", ")})` : "") +
    (needed.length ? ` (needed-by: ${needed.join(", ")})` : "") + (state.agentId ? ` (agent: ${state.agentId})` : "") +
    (current?.hold ? ` (hold: ${current.hold})` : "") + (current?.reviewHead ? ` (review-head: ${current.reviewHead})` : "") + (current?.url ? ` ${current.url}` : "");
}
