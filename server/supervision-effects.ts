/** S04 durable effect gateway. Disabled by default: no RPC, timer, executor or live receiver adapter.
 * Every external boundary is preceded by a published `dispatching` claim. That claim is the final
 * admission: inside the store's writer boundary it rechecks the complete current authority read set
 * (owner scope/binding/epoch, backend, plan and node, dependencies, holds, policy rules and their
 * on-disk sources, evidence and approval), so anything committed first wins. Fresh receiver reads
 * (capabilities, the exact send/interrupt target, archive inventory) happen before the lock.
 * A missing or ambiguous reply leaves the effect uncertain with its attempt, spend and resources
 * retained; it is reconciled by exact reserved identity or left for deliberate review, never resent.
 * This is cooperative accounting, not native/CLI/shell fencing, authenticated IPC or a closed U1 race.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CREW_LABELS } from "../shared/fleet";
import type { SupervisionActor, SupervisionAttempt, SupervisionEffect, SupervisionExpected, SupervisionScope, SupervisionStatus, SupervisionTask } from "../shared/supervision";
import type { PlanLaunch, WorkflowPlan } from "../shared/workflow-plans";
import type { VersionRef } from "../shared/supervision-policy";
import {
  AgentProfileSchema, EffectCauseSchema, GatewayOperation, RELEASE_OPERATIONS, ReceiverCapabilitiesSchema, SCOPE_LABELS, SUPERVISOR_ROLE,
  WorkspaceReceiptSchema, type AgentObservation, type AgentProfile, type EffectCause, type GatewayReceiver,
  type ReceiverCapabilities, type WorkspaceIntent, type WorkspaceReceipt,
} from "../shared/supervision-effects";
import { resolveInHome } from "./files";
import { digest } from "./submissions";
import { SupervisionError, type SupervisionMutation, type SupervisionStore } from "./supervision-store";
import { checkDependencyRoute, type ScopedPlanCommand, type SupervisionCommands } from "./supervision-commands";
import { applicableRules, checkPolicySource, currentPolicyVector, policyRef, sameVector, type PolicyTarget } from "./supervision-policy";

/** Thrown by a receiver only when it definitely refused before admitting the request (server-only: no class in shared code). */
export class ReceiverRejected extends Error {
  constructor(message: string, readonly reason: "unsupported" | "invalid" | "capacity" | "refused" = "refused") { super(message); }
}
type Code = "STALE" | "HELD" | "UNKNOWN_OWNER" | "UNSUPPORTED" | "UNCERTAIN" | "CONFLICT";
export function refuse(code: Code, message: string): never { throw new SupervisionError(code, message); }
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const GATEWAY: SupervisionActor = { kind: "system", id: "s04-gateway", source: "dispatch-claim" };
const TERMINAL_NODE = ["done", "landed", "failed", "cancelled"];
/** A stable UUID-shaped identity from durable content, so a replay reuses the same reservation. */
export function stableId(...parts: unknown[]): string {
  const h = digest(parts);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** (attempt or epoch, operation, causation, objective revision); never a request ID (A01-C04). */
export function effectLogicalKey(cause: EffectCause): string {
  const c = EffectCauseSchema.parse(cause);
  return `s04/${c.operation}/${digest(c)}`;
}
export const sendMessageId = (effectId: string) => `firstmate-s04-${effectId}`;
export function requireGatewayOperation(operation: string): GatewayOperation {
  if ((RELEASE_OPERATIONS as readonly string[]).includes(operation)) refuse("UNSUPPORTED", "Release operations have no S04 adapter, even with an approved plan.");
  const parsed = GatewayOperation.safeParse(operation);
  if (!parsed.success) refuse("UNSUPPORTED", `Unknown gateway operation ${operation}.`);
  return parsed.data;
}
const version = (status: SupervisionStatus, kind: SupervisionExpected["kind"], id: string) =>
  status.versions.find(v => v.kind === kind && v.id === id)?.version ?? 0;
export function expectedFor(status: SupervisionStatus, mutations: SupervisionMutation[]): SupervisionExpected[] {
  return mutations.map(m => {
    const id = m.kind === "workflow" ? m.event.plan : m.kind === "retirement" ? m.receipt.plan : m.kind === "binding" ? m.value.scopeId :
      m.kind === "backend" ? m.value.planId : m.value.id;
    return { kind: m.kind, id, version: version(status, m.kind, id) };
  });
}
/** One sorted, de-duplicated policy read set covering both the start and the model-use admission. */
export function unionVectors(...vectors: readonly VersionRef[][]): VersionRef[] {
  const seen = new Map<string, VersionRef>();
  for (const ref of vectors.flat()) if (!seen.has(`${ref.kind}/${ref.id}`)) seen.set(`${ref.kind}/${ref.id}`, ref);
  return [...seen.values()].sort((a, b) => `${a.kind}/${a.id}`.localeCompare(`${b.kind}/${b.id}`));
}
export function workspaceReceipt(effect: SupervisionEffect | undefined): WorkspaceReceipt | null {
  if (effect?.operation !== "workspace.open" || effect.state !== "succeeded" || !effect.receiptRef) return null;
  return WorkspaceReceiptSchema.parse(JSON.parse(effect.receiptRef));
}
export const sameDirectory = (a: string, b: string) => process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
/** Settings, identity and independent ancestry of a just-created, still unprompted session. */
export function verifyObservation(observed: AgentObservation | null, expected: { agentId: string; workspace: WorkspaceReceipt; profile: AgentProfile; labels: Record<string, string> }): string | null {
  if (!observed) return "The reserved session is not visible; it stays uncertain, not missing.";
  if (observed.id !== expected.agentId) return "The receiver returned a different identity.";
  if (observed.archivedAt) return "The reserved session is archived.";
  if (observed.workspaceId !== expected.workspace.workspaceId || !sameDirectory(observed.cwd, expected.workspace.directory)) return "The session is outside its independent workspace.";
  if (observed.labels["paseo.parent-agent-id"]) return "The session has a native parent; independent ancestry is required.";
  if (Object.entries(expected.labels).some(([k, v]) => observed.labels[k] !== v)) return "The session labels do not match the reservation.";
  if (observed.provider !== expected.profile.provider || (observed.modeId ?? "") !== expected.profile.modeId ||
    (observed.thinkingOptionId ?? "") !== (expected.profile.thinkingOptionId ?? "")) return "The session settings differ from the reserved profile.";
  if (observed.status !== "idle" || observed.pendingPermissions > 0) return "The session is not idle and unprompted.";
  return null;
}
/** A send/interrupt/archive target re-observed by its exact identity just before the claim. */
function exactTarget(observed: AgentObservation | null, agentId: string): AgentObservation {
  if (!observed || observed.id !== agentId) refuse("HELD", "The target is not observed under its exact identity; nothing is admitted.");
  if (observed.archivedAt) refuse("HELD", "The target session is archived.");
  return observed;
}

export interface GatewayOptions {
  /** Defaults off. Fixture-only enablement; no env flag, RPC or runtime wiring exists. */
  enabled?: boolean;
  now?: () => number;
}
export interface StartedAttempt { attemptId: string | null; effects: { workspace: string; create: string; send: string } | null }
type Call = { run: () => Promise<string>; after?: (status: SupervisionStatus) => SupervisionMutation[] };
interface Preflight { capabilities: ReceiverCapabilities; observed: AgentObservation | null; text: string | null; inventoryKey: string | null }

export class SupervisionGateway {
  constructor(readonly store: SupervisionStore, readonly commands: SupervisionCommands, readonly home: string,
    readonly receiver: GatewayReceiver, private readonly options: GatewayOptions = {}) {}
  private enabled() { if (!this.options.enabled) refuse("UNSUPPORTED", "The S04 effect gateway is disabled."); }
  private async accepted(requestId: string) { return (await this.store.read()).commands.some(c => c.id === requestId); }
  async capabilities(): Promise<ReceiverCapabilities> {
    const parsed = ReceiverCapabilitiesSchema.safeParse(await this.receiver.capabilities());
    // A newer receiver claiming U1/U3 or anything undeclared is refused, never silently downgraded.
    if (!parsed.success) refuse("UNSUPPORTED", "Receiver capabilities are not in the qualified S04 contract.");
    return parsed.data;
  }

  /** Checked S03 start plus attempt, task pointer and workspace/create/send reservations, atomically.
   * An accepted request replays from its immutable receipt before any mutable preflight (brief, capability).
   */
  async startWorker(input: ScopedPlanCommand, actor: SupervisionActor) {
    this.enabled();
    const command = input.command;
    if (!["start", "implicit", "claim"].includes(command.op)) refuse("UNSUPPORTED", "Only a checked start reserves a worker attempt.");
    if (await this.accepted(input.requestId)) return this.replayStart(input, actor);
    let blob: { id: string; bytes: number } | null, capabilities: ReceiverCapabilities;
    try {
      capabilities = await this.capabilities();
      if (!capabilities.selectedAgentIds) refuse("UNSUPPORTED", "Receiver lacks caller-selected agent IDs; no legacy or fresh-ID fallback.");
      const brief = await this.pinnedBrief(input);
      blob = brief ? await this.store.putBlob(brief) : null;
    } catch (error) {
      if (await this.accepted(input.requestId)) return this.replayStart(input, actor); // Accepted concurrently.
      throw error;
    }
    let started: StartedAttempt = { attemptId: null, effects: null };
    const committed = await this.commands.planCommandWith(input, actor, "s04.start-worker/1", async (status, prepared) => {
      const workflow = prepared.mutations.find(m => m.kind === "workflow");
      if (workflow?.kind !== "workflow") refuse("CONFLICT", "A start needs its workflow event.");
      const event = workflow.event;
      const attemptId = event.attempt ?? (command.op === "claim" ? command.attempt : null);
      const briefHash = event.briefHash ?? (command.op === "claim" ? command.briefHash : null);
      if (!attemptId || !briefHash) return { expectedVersions: [], mutations: [] }; // Review posture: no attempt yet.
      if (!capabilities.selectedAgentIds) refuse("UNSUPPORTED", "Receiver lacks caller-selected agent IDs; no legacy or fresh-ID fallback.");
      if (!blob || blob.id !== briefHash) refuse("STALE", "Brief changed between pinning and reservation.");
      const nodeId = command.op === "implicit" ? command.launch.id : (command as { node: string }).node;
      const scopeId = input.scopeId, planId = event.plan;
      const task = status.tasks.find(t => t.ownerScopeId === scopeId && t.planId === planId && t.nodeId === nodeId);
      const binding = status.bindings.find(b => b.scopeId === scopeId);
      if (!task || !binding) refuse("UNKNOWN_OWNER", "Register the exact task and owner binding before launch.");
      if (task.hostId.trim().toLowerCase() !== "local" || binding.hostId.trim().toLowerCase() !== "local")
        refuse("UNSUPPORTED", "S04 admits local isolated work only; remote lifecycle mutation is unsupported.");
      const launch: PlanLaunch | undefined = command.op === "implicit" || command.op === "claim" ? command.launch :
        event.launch ?? status.plans.find(p => p.plan.definition.id === planId)?.plan.definition.nodes.flatMap(n => n.kind === "run" && n.id === nodeId ? [n.launch] : [])[0];
      if (!launch) refuse("HELD", "A decision cannot launch a worker.");
      const ordinal = status.attempts.filter(a => a.taskId === task.id).length + 1;
      const subject = `task:${task.id}#${ordinal}`, causation = `plan.start:${planId}/${nodeId}`, objectiveRevision = input.revision;
      const key = (operation: GatewayOperation) => effectLogicalKey({ scopeId, subject, operation, causation, objectiveRevision });
      for (const op of ["workspace.open", "agent.create", "agent.send"] as const) {
        const existing = status.index.effectKeys[key(op)];
        if (existing) refuse("CONFLICT", `Logical effect already reserved as ${existing}; reconcile it instead of reserving again.`);
      }
      const ids = { workspace: stableId("effect", key("workspace.open")), create: stableId("effect", key("agent.create")), send: stableId("effect", key("agent.send")) };
      const agentId = stableId("agent", ids.create);
      // The admission read set is pinned: start and model-use policy refs, admission evidence and approval.
      const base = { requestId: input.requestId, requestHash: digest(input), scopeId, epoch: binding.epoch, attemptId,
        planRevision: input.revision || null, subjectHash: input.subjectHash ?? digest(command), policyVector: unionVectors(input.policyVector, input.modelPolicyVector),
        evidenceVector: input.evidenceVector, approvalId: input.approvalId, state: "reserved" as const, receiptRef: null, version: 1,
        dependencyBindings: input.dependencyBindings.map(d => ({ planId: d.planId, nodeId: d.nodeId, outcome: d.outcome, attemptId: d.attemptId })) };
      const intent = workerWorkspaceIntent(task, ordinal, launch, ids.workspace);
      const effects: SupervisionEffect[] = [
        { ...base, id: ids.workspace, logicalKey: key("workspace.open"), operation: "workspace.open", resourceIds: [`workspace-intent:${intent.key}`], receiverKey: intent.key },
        { ...base, id: ids.create, logicalKey: key("agent.create"), operation: "agent.create", resourceIds: [`agent:${agentId}`], receiverKey: agentId },
        { ...base, id: ids.send, logicalKey: key("agent.send"), operation: "agent.send", resourceIds: [`turn:${agentId}`], receiverKey: sendMessageId(ids.send), payloadDigest: blob.id },
      ];
      // Worst-case spend is reserved now and never refunded by a later failure or uncertainty.
      const attempt: SupervisionAttempt = { id: attemptId, taskId: task.id, ordinal, briefHash, launchEffectId: ids.create, worker: null,
        originalNotificationOwner: null, notificationStatus: "known", spentAgents: 1, spentTurns: 1, state: "reserved", evidenceIds: [], version: 1 };
      const mutations: SupervisionMutation[] = [
        { kind: "task", value: { ...task, version: task.version + 1, currentAttempt: attemptId } },
        { kind: "attempt", value: attempt }, ...effects.map(value => ({ kind: "effect" as const, value })),
        ...(status.versions.some(v => v.kind === "blob" && v.id === blob.id) ? [] : [{ kind: "blob" as const, value: blob }]),
      ];
      started = { attemptId, effects: ids };
      return { expectedVersions: expectedFor(status, mutations), mutations };
    });
    if (!started.attemptId) return { ...committed, ...await this.originalStart(input.requestId) };
    return { ...committed, ...started };
  }
  /** Replay through the store's accepted-request index; a mismatched body conflicts and nothing runs. */
  private async replayStart(input: ScopedPlanCommand, actor: SupervisionActor) {
    const committed = await this.commands.planCommandWith(input, actor, "s04.start-worker/1", async () => refuse("CONFLICT", "Expected an accepted replay."));
    return { ...committed, ...await this.originalStart(input.requestId) };
  }
  private async originalStart(requestId: string): Promise<StartedAttempt> {
    const status = await this.store.read();
    const attempt = status.attempts.find(a => status.effects.some(e => e.id === a.launchEffectId && e.requestId === requestId));
    return attempt ? { attemptId: attempt.id, effects: effectsFor(status, attempt.id) } : { attemptId: null, effects: null };
  }
  private async pinnedBrief(input: ScopedPlanCommand): Promise<Uint8Array | null> {
    const c = input.command;
    const launch = c.op === "implicit" || c.op === "claim" ? c.launch :
      (await this.store.read()).plans.find(p => p.plan.definition.id === (c as { plan: string }).plan)?.plan.definition.nodes
        .flatMap(n => n.kind === "run" && n.id === (c as { node: string }).node ? [n.launch] : [])[0];
    if (!launch) return null;
    const bytes = await readFile((await resolveInHome(this.home, launch.brief.file)).absolute);
    return sha256(bytes) === input.briefHash ? bytes : refuse("STALE", "Brief changed or is not pinned.");
  }

  /** One external boundary per call. The claim's checked transaction is the final admission. */
  async dispatch(effectId: string): Promise<SupervisionEffect> {
    this.enabled();
    const pre = await this.store.read(), effect = pre.effects.find(e => e.id === effectId);
    if (!effect) refuse("UNKNOWN_OWNER", "Unknown effect.");
    if (effect.state === "succeeded") return effect;
    if (["dispatching", "uncertain", "accepted"].includes(effect.state)) refuse("UNCERTAIN", "This effect may already have crossed its boundary; reconcile it, never resend.");
    if (effect.state !== "reserved") refuse("HELD", `Effect is ${effect.state}; a new step needs a new logical cause.`);
    const operation = requireGatewayOperation(effect.operation);
    // Receiver and file reads happen before the writer lock; the claim then rechecks against them.
    const capabilities = await this.capabilities(), target = targetOf(pre, effect, operation);
    const observed = target ? await this.receiver.findAgent(target) : null;
    const text = operation === "agent.send" ? await this.payload(effect) : null;
    const inventoryKey = operation === "agent.archive" && target ? await this.checkInventory(capabilities, target, effect.receiverKey) : null;
    let claimed: SupervisionEffect | null = null, call: Call | null = null;
    await this.store.transactCommand(stableId("dispatch-claim", effect.id), digest({ claim: effect.id, version: effect.version }), GATEWAY, async status => {
      const current = status.effects.find(e => e.id === effect.id);
      if (!current || current.version !== effect.version || current.state !== "reserved") refuse("STALE", "The effect changed before its claim; reread.");
      call = await this.admit(status, current, operation, { capabilities, observed, text, inventoryKey });
      claimed = { ...current, state: "dispatching", version: current.version + 1 };
      const mutations: SupervisionMutation[] = [{ kind: "effect", value: claimed }];
      const plan = planOf(status, current);
      return { expectedVersions: expectedFor(status, mutations), mutations, result: { planId: plan?.definition.id ?? null, planHash: plan?.hash ?? null, decisionId: null, outboxId: null } };
    });
    // A replayed claim means an earlier dispatcher already crossed (or may have crossed) the boundary.
    if (!claimed || !call) refuse("UNCERTAIN", "This effect was already claimed for dispatch; reconcile it, never resend.");
    const admitted: Call = call;
    let outcome: { state: "succeeded" | "failed" | "uncertain"; receiptRef: string | null };
    try { outcome = { state: "succeeded", receiptRef: await admitted.run() }; }
    catch (error) {
      outcome = error instanceof ReceiverRejected ? { state: "failed", receiptRef: `rejected:${error.reason}:${error.message}`.slice(0, 1024) } :
        { state: "uncertain", receiptRef: null };
    }
    return this.settle(claimed, outcome, admitted.after);
  }
  /** The complete current authority read set for one effect. Runs inside the claim's writer boundary. */
  private async admit(status: SupervisionStatus, effect: SupervisionEffect, operation: GatewayOperation, fresh: Preflight): Promise<Call> {
    const scope = status.scopes.find(s => s.id === effect.scopeId), binding = status.bindings.find(b => b.scopeId === effect.scopeId);
    if (status.freshness !== "current" || status.storage.admissionsHeld) refuse("HELD", "Store is held; no new external effect.");
    if (!scope || !binding || binding.epoch !== effect.epoch || ["retired", "suspect"].includes(binding.state)) refuse("STALE", "The effect's owner epoch is no longer current.");
    if (binding.hostId.trim().toLowerCase() !== "local") refuse("UNSUPPORTED", "S04 has no remote receiver adapter.");
    const supervisor = effect.attemptId === null, stopping = operation === "agent.interrupt" || operation === "agent.archive";
    if (!supervisor && binding.purpose === "discussion") refuse("HELD", "Discussion-only sessions cannot dispatch worker effects.");
    const activation = supervisor && (operation === "workspace.open" || operation === "agent.create");
    if (activation ? scope.state !== "transferring" || binding.state !== "prepared" : scope.state !== "active" || binding.state !== "active")
      refuse("HELD", "Owner is not admitted for this external effect.");
    // A stop/policy hold freezes new work. Interrupt and archive remain the safe-stop path.
    if (!stopping && status.operationHolds.some(h => h.scopeId === scope.id && h.state === "held" && h.operations.some(o => o === "plan.start" || o === "model.use")))
      refuse("HELD", "Admissions are held for this scope.");
    const owned = status.backends.filter(b => b.ownerScopeId === scope.id);
    if (!stopping && owned.some(b => b.state !== "active" || b.backend !== "scoped" || status.retirements.some(r => r.plan === b.planId)))
      refuse("HELD", "A plan backend owned by this scope is held, retired or not scoped.");
    const attempt = effect.attemptId ? status.attempts.find(a => a.id === effect.attemptId) : undefined;
    const task = attempt ? status.tasks.find(t => t.id === attempt.taskId) : undefined;
    if (task && task.hostId.trim().toLowerCase() !== "local") refuse("UNSUPPORTED", "S04 has no remote worker adapter.");
    let launch: PlanLaunch | null = null, plan: WorkflowPlan | null = null;
    if (!supervisor) {
      if (!attempt || !task || task.currentAttempt !== attempt.id) refuse("STALE", "The attempt is no longer current for its task.");
      plan = status.plans.find(p => p.scopeId === scope.id && p.plan.definition.id === task.planId)?.plan ?? refuse("UNKNOWN_OWNER", "The task's scoped plan is missing.");
      const node = plan.nodes[task.nodeId], definition = plan.definition.nodes.find(n => n.id === task.nodeId);
      if (!node || node.attempt !== attempt.id || !definition) refuse("STALE", "The plan no longer records this attempt for its node.");
      if (operation === "agent.archive") { if (!TERMINAL_NODE.includes(node.state)) refuse("HELD", "Idle is not finished; archive needs a recorded terminal outcome."); }
      else if (!stopping) {
        if (plan.status !== "active" || !["starting", "running"].includes(node.state) || node.held || node.invalidated)
          refuse("HELD", "The node is no longer an admitted, live start.");
        checkDependencies(status, effect, definition.after, scope.id);
        launch = launchFor(status, task);
        // A send's model policy is evaluated on the freshly observed recipient, validated against its verified reservation.
        const profile = operation === "agent.send" ? await this.validatedRecipient(status, effect, fresh.observed) : launch.agent;
        await this.recheckPolicy(status, effect, scope, task, profile);
      }
    }
    const sibling = (op: GatewayOperation) => status.effects.find(e => e.scopeId === effect.scopeId && e.operation === op &&
      (supervisor ? e.attemptId === null && e.epoch === effect.epoch && e.requestId === effect.requestId : e.attemptId === effect.attemptId));
    switch (operation) {
      case "workspace.open": {
        const intent = supervisor ? supervisorWorkspaceIntent(scope.id, effect.epoch, effect.id) : workerIntentFor(status, effect);
        return { run: async () => JSON.stringify(WorkspaceReceiptSchema.parse(await this.receiver.openWorkspace(intent))) };
      }
      case "agent.create": {
        if (!fresh.capabilities.selectedAgentIds) refuse("UNSUPPORTED", "Receiver no longer supports caller-selected IDs; the reservation stays as it is.");
        const workspace = workspaceReceipt(sibling("workspace.open"));
        if (!workspace) refuse("HELD", "The workspace effect has not succeeded; creation waits for it.");
        const create = supervisor ? supervisorCreate(effect, workspace, await this.profile(binding.profileDigest), scope.kind) : workerCreate(status, effect, workspace);
        return { run: async () => {
          const created = await this.receiver.createAgent(create);
          if (created.agentId !== create.agentId) throw new Error("Receiver returned a different identity; treated as uncertain.");
          return `agent:${created.agentId}`;
        } };
      }
      case "agent.send": {
        const target = supervisor ? binding.agentId : attempt?.worker?.agentId;
        const workspaceId = supervisor ? binding.workspaceId : attempt?.worker?.workspaceId;
        if (!target || !workspaceId || (!supervisor && attempt?.state !== "active")) refuse("HELD", "Send waits for verified, active identity.");
        // Final recipient recheck (S02 beginSend leaves idle to S04); workers were validated above with their policy.
        if (supervisor) await this.validatedRecipient(status, effect, fresh.observed);
        return { run: async () => { await this.receiver.send(target, fresh.text!, effect.receiverKey!); return `message:${effect.receiverKey}`; },
          after: s => supervisor ? [] : promoteAttempt(s, effect.attemptId!, "prompted") };
      }
      case "agent.interrupt": {
        const target = attempt?.worker?.agentId ?? refuse("HELD", "Interrupt needs a verified current worker.");
        exactTarget(fresh.observed, target);
        return { run: async () => { await this.receiver.interrupt(target); return `interrupted:${target}`; } };
      }
      case "agent.archive": {
        const target = attempt?.worker?.agentId ?? refuse("HELD", "Archive needs a verified worker.");
        exactTarget(fresh.observed, target);
        if (fresh.inventoryKey === null || fresh.inventoryKey !== effect.receiverKey) refuse("STALE", "Inventory changed since the proposal.");
        return { run: async () => `archived:${(await this.receiver.archive(target)).archivedAt}` };
      }
    }
  }
  /** Same rules S03 applies at start, against the pinned read set, plus on-disk source re-hash. */
  /** The fresh observation must still be the verified reservation: exact identity, profile, workspace and
   * directory, labels, no native parent, idle with no pending permission. Returns that validated profile.
   * This detects divergence already observed before admission; it does not fence later native changes (U1).
   */
  private async validatedRecipient(status: SupervisionStatus, effect: SupervisionEffect, observed: AgentObservation | null): Promise<AgentProfile> {
    let expected: { agentId: string; workspaceId: string | null; workspace: WorkspaceReceipt | null; profile: AgentProfile; labels: Record<string, string> };
    if (effect.attemptId === null) {
      const binding = status.bindings.find(b => b.scopeId === effect.scopeId)!;
      const intent = status.effects.find(e => e.scopeId === binding.scopeId && e.epoch === binding.epoch && e.attemptId === null &&
        e.operation === "workspace.open" && e.receiverKey !== null && e.receiverKey === binding.workspaceIntent);
      expected = { agentId: binding.agentId, workspaceId: binding.workspaceId, workspace: workspaceReceipt(intent),
        profile: await this.profile(binding.profileDigest), labels: supervisorLabels(binding.scopeId, binding.epoch) };
    } else {
      const attempt = status.attempts.find(a => a.id === effect.attemptId)!, task = status.tasks.find(t => t.id === attempt.taskId)!, launch = launchFor(status, task);
      const ids = effectsFor(status, attempt.id);
      expected = { agentId: attempt.worker?.agentId ?? "", workspaceId: attempt.worker?.workspaceId ?? null,
        workspace: workspaceReceipt(status.effects.find(e => e.id === ids?.workspace)), profile: launch.agent, labels: workerLabels(effect.scopeId, task, attempt.id, launch) };
    }
    if (!expected.workspace || expected.workspace.workspaceId !== expected.workspaceId) refuse("HELD", "The recipient's verified workspace cannot be re-established; nothing was sent.");
    const problem = verifyObservation(observed, { agentId: expected.agentId, workspace: expected.workspace, profile: expected.profile, labels: expected.labels });
    if (problem) refuse("HELD", `${problem} Nothing was sent.`);
    return { provider: observed!.provider, modeId: observed!.modeId ?? "", ...(observed!.thinkingOptionId ? { thinkingOptionId: observed!.thinkingOptionId } : {}) };
  }
  private async recheckPolicy(status: SupervisionStatus, effect: SupervisionEffect, scope: SupervisionScope, task: SupervisionTask, profile: AgentProfile) {
    const base = { scopeId: scope.id, planId: task.planId, projectIds: scope.projectIds, hostId: task.hostId };
    const targets: PolicyTarget[] = [{ ...base, operation: "plan.start" }, { ...base, operation: "model.use" }];
    if (!sameVector(effect.policyVector, unionVectors(...targets.map(t => currentPolicyVector(status, t))))) refuse("STALE", "Policy changed since reservation; the queued effect is not admitted.");
    const now = this.options.now?.() ?? Date.now(), superseded = new Set(status.policySources.flatMap(s => s.supersedes));
    for (const target of targets) {
      const rules = applicableRules(status, target);
      if (!rules.length || target.projectIds.some(p => !rules.some(r => r.effect === "allow" && r.selector.projectIds.includes(p)))) refuse("HELD", "No current grant for every project constraint.");
      for (const rule of rules) {
        if (rule.effect === "deny") refuse("HELD", "Conflicting or denying policy holds this effect.");
        if (rule.expiresAt && Date.parse(rule.expiresAt) <= now) refuse("STALE", "Policy grant expired.");
        if (target.operation === "model.use" && ((rule.constraints.models.length && !rule.constraints.models.includes(profile.provider)) ||
          (rule.constraints.profileDigests.length && !rule.constraints.profileDigests.includes(digest(profile))))) refuse("HELD", "The worker profile no longer satisfies model policy.");
      }
    }
    for (const ref of effect.policyVector.filter(r => r.kind === "policy-source")) {
      const source = status.policySources.find(s => s.id === ref.id);
      if (!source || superseded.has(source.id)) refuse("STALE", "A policy source was superseded.");
      await checkPolicySource(this.home, source); // The reviewed captain text must still read exactly as accepted.
    }
    for (const ref of effect.evidenceVector) {
      const row = status.policyEvidence.find(e => e.id === ref.id);
      if (!row || ref.kind !== "policy-evidence" || !sameVector([ref], [policyRef("policy-evidence", row)])) refuse("STALE", "Admission evidence changed.");
    }
    if (effect.approvalId) {
      const approval = status.approvals.find(a => a.id === effect.approvalId);
      if (!approval || (approval.expiresAt && Date.parse(approval.expiresAt) <= now)) refuse("STALE", "The approval is missing or expired.");
    }
  }
  private async settle(effect: SupervisionEffect, outcome: { state: "succeeded" | "failed" | "uncertain"; receiptRef: string | null },
    after?: (status: SupervisionStatus) => SupervisionMutation[]): Promise<SupervisionEffect> {
    const status = await this.store.read(), current = status.effects.find(e => e.id === effect.id)!;
    // A concurrent reconcile may have marked an in-flight call uncertain; a definite result still settles it.
    const rebase = current.version !== effect.version && current.state === "uncertain" && current.receiptRef === null && outcome.state !== "uncertain";
    if (current.version !== effect.version && !rebase) return current;
    const next: SupervisionEffect = { ...current, state: outcome.state, receiptRef: outcome.receiptRef, version: current.version + 1 };
    // A definite launch refusal ends its sequence: never-dispatched siblings are cancelled, spend is kept.
    const ended = outcome.state === "failed" && ["workspace.open", "agent.create"].includes(current.operation) ? status.effects.filter(e => e.id !== current.id &&
      e.state === "reserved" && e.scopeId === current.scopeId && (current.attemptId ? e.attemptId === current.attemptId :
        e.attemptId === null && e.epoch === current.epoch && e.requestId === current.requestId)) : [];
    const mutations: SupervisionMutation[] = [{ kind: "effect", value: next }, ...ended.map(e => ({ kind: "effect" as const, value: { ...e, state: "cancelled" as const, version: e.version + 1 } })),
      ...(outcome.state === "succeeded" ? after?.(status) ?? [] : [])];
    await this.store.transact(expectedFor(status, mutations), randomUUID(), mutations);
    return next;
  }
  /** The binding's profile digest is the canonical blob identity of the reserved profile. */
  async profile(profileDigest: string): Promise<AgentProfile> {
    const bytes = await readFile(join(this.store.root, "blobs", profileDigest)).catch(() => refuse("HELD", "The reserved supervisor profile blob is missing."));
    if (sha256(bytes) !== profileDigest) refuse("HELD", "The reserved supervisor profile blob is corrupt.");
    return AgentProfileSchema.parse(JSON.parse(bytes.toString("utf8")));
  }
  /** Payloads are immutable, typed store blobs (`payloadDigest`), separate from authority evidence. */
  private async payload(effect: SupervisionEffect): Promise<string> {
    const id = effect.payloadDigest ?? refuse("HELD", "Send effect has no durable payload.");
    const bytes = await readFile(join(this.store.root, "blobs", id)).catch(() => refuse("HELD", "Send payload is missing."));
    if (sha256(bytes) !== id) refuse("HELD", "Send payload is corrupt.");
    return bytes.toString("utf8");
  }
  private async checkInventory(capabilities: ReceiverCapabilities, agentId: string, expected: string | null): Promise<string> {
    if (!capabilities.persistedInventory) refuse("UNSUPPORTED", "No complete persisted inventory; archive refused.");
    let children;
    try { children = await this.receiver.inventory(agentId); }
    catch (error) { refuse("HELD", `Archive inventory is incomplete; nothing was archived. ${error instanceof Error ? error.message : String(error)}`); }
    if (children.length) refuse("HELD", "The worker has live descendants; archive could cascade. Refused.");
    const key = `inventory:${digest(children)}`;
    if (expected !== null && expected !== key) refuse("STALE", "Inventory changed since the proposal.");
    return key;
  }

  /** Exact identity lookup only. A negative or misbound answer never proves anything; nothing is resent. */
  async reconcile(effectId: string): Promise<SupervisionEffect> {
    this.enabled();
    const status = await this.store.audit();
    if (status.freshness !== "current") refuse("HELD", "Recovery audit failed; no receiver lookup or effect reconciliation is admitted.");
    const effect = status.effects.find(e => e.id === effectId) ?? refuse("UNKNOWN_OWNER", "Unknown effect.");
    if (!["dispatching", "uncertain", "accepted"].includes(effect.state)) return effect;
    const capabilities = await this.capabilities();
    let found: string | null = null;
    if (effect.operation === "workspace.open" && capabilities.workspaceIntentLookup) {
      const intent = effect.attemptId === null ? supervisorWorkspaceIntent(effect.scopeId, effect.epoch, effect.id) : workerIntentFor(status, effect);
      const receipt = await this.receiver.findWorkspace(intent);
      found = receipt ? JSON.stringify(WorkspaceReceiptSchema.parse(receipt)) : null;
    } else if (effect.operation === "agent.create" && capabilities.createReceiptLookup && effect.receiverKey) {
      const observed = await this.receiver.findAgent(effect.receiverKey);
      found = observed?.id === effect.receiverKey ? `agent:${observed.id}` : null; // Late original creation binds here.
    } else if (effect.operation === "agent.archive") {
      const target = status.attempts.find(a => a.id === effect.attemptId)?.worker?.agentId;
      const observed = target ? await this.receiver.findAgent(target) : null;
      found = observed?.id === target && observed?.archivedAt ? `archived:${observed.archivedAt}` : null;
    } // Sends and interrupts have no receipt lookup (U1): they remain uncertain for deliberate review.
    const current = (await this.store.read()).effects.find(e => e.id === effectId)!;
    if (current.version !== effect.version) return current;
    if (found) return this.settle(current, { state: "succeeded", receiptRef: found });
    if (current.state === "uncertain") return current;
    return this.settle(current, { state: "uncertain", receiptRef: null });
  }

  /** Reserved, unprompted -> verified -> active. Only then may the brief be sent. */
  async verifyWorker(attemptId: string): Promise<SupervisionAttempt> {
    this.enabled();
    const status = await this.store.read(), attempt = status.attempts.find(a => a.id === attemptId) ?? refuse("UNKNOWN_OWNER", "Unknown attempt.");
    if (attempt.state !== "reserved") return attempt.state === "active" || attempt.state === "prompted" ? attempt : refuse("HELD", `Attempt is ${attempt.state}.`);
    const task = status.tasks.find(t => t.id === attempt.taskId)!;
    if (task.hostId.trim().toLowerCase() !== "local") refuse("UNSUPPORTED", "Remote verification is unsupported.");
    if (task.currentAttempt !== attempt.id) refuse("STALE", "The attempt is no longer current.");
    const effects = effectsFor(status, attempt.id), create = status.effects.find(e => e.id === effects?.create);
    const workspace = workspaceReceipt(status.effects.find(e => e.id === effects?.workspace));
    if (create?.state !== "succeeded" || !workspace || !create.receiverKey) refuse("HELD", "Creation is not confirmed; verification waits.");
    const scope = status.scopes.find(s => s.id === task.ownerScopeId)!;
    const launch = launchFor(status, task);
    const problem = verifyObservation(await this.receiver.findAgent(create.receiverKey), { agentId: create.receiverKey, workspace,
      profile: launch.agent, labels: workerLabels(scope.id, task, attempt.id, launch) });
    if (problem) refuse("HELD", `${problem} No brief was sent.`);
    const next: SupervisionAttempt = { ...attempt, worker: { hostId: task.hostId, agentId: create.receiverKey, workspaceId: workspace.workspaceId }, state: "active", version: attempt.version + 1 };
    const mutations: SupervisionMutation[] = [{ kind: "attempt", value: next }];
    await this.store.transact([...expectedFor(status, mutations), { kind: "task", id: task.id, version: task.version }], randomUUID(), mutations);
    return next;
  }

  /** Guarded proposals: only the current bound owner, for its current verified worker, under one logical cause. */
  async propose(input: { scopeId: string; epoch: number; attemptId: string; operation: string; causation: string; requestId: string }, actor: SupervisionActor): Promise<SupervisionEffect> {
    this.enabled();
    const operation = requireGatewayOperation(input.operation);
    if (operation !== "agent.interrupt" && operation !== "agent.archive") refuse("UNSUPPORTED", "Only interrupt and archive are proposed here.");
    const pre = await this.store.read(), replay = pre.commands.some(c => c.id === input.requestId);
    if (!replay) {
      const attempt = pre.attempts.find(a => a.id === input.attemptId), task = pre.tasks.find(t => t.id === attempt?.taskId);
      if (task && task.hostId.trim().toLowerCase() !== "local") refuse("UNSUPPORTED", "Remote interrupt/archive proposals are unsupported.");
    }
    const worker = pre.attempts.find(a => a.id === input.attemptId)?.worker?.agentId;
    // Inventory is a mutable receiver read: an accepted proposal replays without it.
    const inventoryKey = operation === "agent.archive" && worker && !replay ? await this.checkInventory(await this.capabilities(), worker, null) : null;
    const { receipt } = await this.store.transactCommand(input.requestId, digest({ propose: input }), actor, async status => {
      const scope = status.scopes.find(s => s.id === input.scopeId), binding = status.bindings.find(b => b.scopeId === input.scopeId);
      if (!scope || scope.state !== "active" || binding?.state !== "active" || binding.epoch !== input.epoch) refuse("STALE", "Owner epoch is not current.");
      if (actor.kind !== "agent" || actor.id !== binding.agentId) refuse("UNKNOWN_OWNER", "Only the bound plan owner proposes worker interrupt or archive; General is not a bypass.");
      const attempt = status.attempts.find(a => a.id === input.attemptId), task = attempt ? status.tasks.find(t => t.id === attempt.taskId) : undefined;
      if (!attempt?.worker || !task || task.ownerScopeId !== scope.id || task.currentAttempt !== attempt.id) refuse("UNKNOWN_OWNER", "Target is not this owner's verified current worker.");
      if (operation === "agent.archive") {
        const node = status.plans.find(p => p.plan.definition.id === task.planId)?.plan.nodes[task.nodeId];
        if (!node || !TERMINAL_NODE.includes(node.state)) refuse("HELD", "Idle is not finished; archive needs a recorded terminal outcome.");
        if (attempt.worker.agentId !== worker) refuse("STALE", "The worker changed during inventory.");
      }
      const plan = status.plans.find(p => p.plan.definition.id === task.planId)?.plan;
      const key = effectLogicalKey({ scopeId: scope.id, subject: `attempt:${attempt.id}`, operation, causation: input.causation, objectiveRevision: plan?.revision ?? 0 });
      if (status.index.effectKeys[key]) refuse("CONFLICT", `Logical effect already reserved as ${status.index.effectKeys[key]}.`);
      const effect: SupervisionEffect = { id: stableId("effect", key), logicalKey: key, requestId: input.requestId, requestHash: digest(input), scopeId: scope.id,
        epoch: binding.epoch, attemptId: attempt.id, operation, planRevision: plan?.revision || null, subjectHash: digest({ attempt: attempt.id, causation: input.causation }),
        policyVector: [], evidenceVector: [], approvalId: null, resourceIds: [`agent:${attempt.worker.agentId}`], state: "reserved",
        receiverKey: inventoryKey, receiptRef: null, version: 1 };
      const mutations: SupervisionMutation[] = [{ kind: "effect", value: effect }];
      return { expectedVersions: expectedFor(status, mutations), mutations, result: { planId: task.planId, planHash: plan?.hash ?? null, decisionId: null, outboxId: null } };
    });
    const status = await this.store.read();
    const id = receipt.versions.find(v => v.kind === "effect")?.id;
    return status.effects.find(e => e.id === id)!;
  }
}

/** C1: re-resolve each admitted prerequisite outcome under the writer boundary with the S03 route rule. */
function checkDependencies(status: SupervisionStatus, effect: SupervisionEffect, after: readonly { node: string; on: string }[], scopeId: string) {
  const bindings = effect.dependencyBindings;
  if (!bindings) {
    if (after.length) refuse("HELD", "This reservation has no retained dependency binding (superseded synthetic format); replan it.");
    return;
  }
  if (after.length !== bindings.length || after.some(e => bindings.filter(b => b.nodeId === e.node && b.outcome === e.on).length !== 1))
    refuse("STALE", "The node's prerequisites differ from the admitted bindings.");
  const plans = status.plans.map(p => p.plan);
  for (const binding of bindings) {
    const owners = plans.filter(p => p.nodes[binding.nodeId]);
    if (owners.length !== 1 || owners[0]!.definition.id !== binding.planId || !owners[0]!.definition.nodes.some(n => n.id === binding.nodeId))
      refuse("STALE", "A prerequisite's owning plan changed, was removed or is ambiguous.");
    checkDependencyRoute(status, binding.planId, scopeId, "plan.start");
    const state = owners[0]!.nodes[binding.nodeId]!;
    if ((state.attempt ?? null) !== binding.attemptId) refuse("STALE", "The prerequisite's satisfying attempt changed.");
    const met = binding.outcome === "answered" ? !!state.answer : binding.outcome === "landed" ? state.state === "landed" : state.state === "done" || state.state === "landed";
    if (!met || state.held || state.invalidated) refuse("STALE", "A prerequisite no longer satisfies this node.");
  }
}
function targetOf(status: SupervisionStatus, effect: SupervisionEffect, operation: GatewayOperation): string | null {
  if (operation === "workspace.open" || operation === "agent.create") return null;
  if (effect.attemptId === null) return operation === "agent.send" ? status.bindings.find(b => b.scopeId === effect.scopeId)?.agentId ?? null : null;
  return status.attempts.find(a => a.id === effect.attemptId)?.worker?.agentId ?? null;
}
function planOf(status: SupervisionStatus, effect: SupervisionEffect): WorkflowPlan | null {
  const attempt = effect.attemptId ? status.attempts.find(a => a.id === effect.attemptId) : undefined;
  const task = attempt ? status.tasks.find(t => t.id === attempt.taskId) : undefined;
  return task ? status.plans.find(p => p.plan.definition.id === task.planId)?.plan ?? null : null;
}
export function effectsFor(status: SupervisionStatus, attemptId: string): { workspace: string; create: string; send: string } | null {
  const of = (op: string) => status.effects.find(e => e.attemptId === attemptId && e.operation === op)?.id;
  const attempt = status.attempts.find(a => a.id === attemptId);
  const create = attempt?.launchEffectId, workspace = of("workspace.open"), send = of("agent.send");
  return create && workspace && send ? { workspace, create, send } : null;
}
function launchFor(status: SupervisionStatus, task: SupervisionTask): PlanLaunch {
  const plan = status.plans.find(p => p.plan.definition.id === task.planId)?.plan;
  const launch = plan?.nodes[task.nodeId]?.launch ?? plan?.definition.nodes.flatMap(n => n.kind === "run" && n.id === task.nodeId ? [n.launch] : [])[0];
  return launch ?? refuse("HELD", "The task's launch definition is unavailable.");
}
export function workerWorkspaceIntent(task: SupervisionTask, ordinal: number, launch: PlanLaunch, effectId: string): WorkspaceIntent {
  return { key: `ws-${effectId}`, hostId: task.hostId, project: launch.project, baseBranch: launch.baseBranch,
    branch: ordinal === 1 ? `fm/${task.nodeId}` : `fm/${task.nodeId}-a${ordinal}`, purpose: "worker" };
}
function workerIntentFor(status: SupervisionStatus, effect: SupervisionEffect): WorkspaceIntent {
  const attempt = status.attempts.find(a => a.id === effect.attemptId)!, task = status.tasks.find(t => t.id === attempt.taskId)!;
  return workerWorkspaceIntent(task, attempt.ordinal, launchFor(status, task), effect.id);
}
export function supervisorWorkspaceIntent(scopeId: string, epoch: number, effectId: string): WorkspaceIntent {
  return { key: `ws-${effectId}`, hostId: "local", project: `scope-${scopeId}`, baseBranch: "none", branch: `supervisor-${epoch}`, purpose: "supervisor" };
}
export function workerLabels(scopeId: string, task: SupervisionTask, attemptId: string, launch: PlanLaunch): Record<string, string> {
  return { [CREW_LABELS.role]: CREW_LABELS.crewRole, [CREW_LABELS.task]: task.nodeId, [CREW_LABELS.kind]: launch.kind,
    [CREW_LABELS.project]: launch.project, [SCOPE_LABELS.scope]: scopeId, [SCOPE_LABELS.attempt]: attemptId };
}
function workerCreate(status: SupervisionStatus, effect: SupervisionEffect, workspace: WorkspaceReceipt) {
  const attempt = status.attempts.find(a => a.id === effect.attemptId)!, task = status.tasks.find(t => t.id === attempt.taskId)!, launch = launchFor(status, task);
  return { agentId: effect.receiverKey!, workspaceId: workspace.workspaceId, cwd: workspace.directory, profile: launch.agent,
    title: (launch.agentTitle || launch.title).slice(0, 120), labels: workerLabels(effect.scopeId, task, attempt.id, launch) };
}
function supervisorCreate(effect: SupervisionEffect, workspace: WorkspaceReceipt, profile: AgentProfile, kind: string) {
  return { agentId: effect.receiverKey!, workspaceId: workspace.workspaceId, cwd: workspace.directory, profile,
    title: `${kind === "project" ? "Project discussion" : "Plan supervisor"} ${effect.scopeId.slice(0, 8)}`, labels: supervisorLabels(effect.scopeId, effect.epoch) };
}
export function supervisorLabels(scopeId: string, epoch: number): Record<string, string> {
  return { [CREW_LABELS.role]: SUPERVISOR_ROLE, [SCOPE_LABELS.scope]: scopeId, [SCOPE_LABELS.epoch]: String(epoch) };
}
function promoteAttempt(status: SupervisionStatus, attemptId: string, state: string): SupervisionMutation[] {
  const attempt = status.attempts.find(a => a.id === attemptId)!;
  return attempt.state === state ? [] : [{ kind: "attempt", value: { ...attempt, state, version: attempt.version + 1 } }];
}
