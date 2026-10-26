/** S04 durable effect gateway. Disabled by default: no RPC, timer, executor or live receiver adapter.
 * Every external boundary is preceded by a published `dispatching` record. A missing or ambiguous
 * reply leaves the effect uncertain with its attempt, spend and resources retained; it is reconciled
 * by exact reserved identity or left for deliberate review, never resent or retried under a new ID.
 * This is cooperative accounting, not native/CLI/shell fencing or authenticated IPC.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CREW_LABELS } from "../shared/fleet";
import type { SupervisionActor, SupervisionAttempt, SupervisionEffect, SupervisionExpected, SupervisionStatus, SupervisionTask } from "../shared/supervision";
import type { PlanLaunch } from "../shared/workflow-plans";
import type { VersionRef } from "../shared/supervision-policy";
import {
  AgentProfileSchema, EffectCauseSchema, GatewayOperation, RELEASE_OPERATIONS, ReceiverCapabilitiesSchema, SCOPE_LABELS, SUPERVISOR_ROLE,
  WorkspaceReceiptSchema, type AgentObservation, type AgentProfile, type EffectCause, type GatewayReceiver,
  type ReceiverCapabilities, type WorkspaceIntent, type WorkspaceReceipt,
} from "../shared/supervision-effects";
import { resolveInHome } from "./files";
import { digest } from "./submissions";
import { SupervisionError, type SupervisionMutation, type SupervisionStore } from "./supervision-store";
import type { ScopedPlanCommand, SupervisionCommands } from "./supervision-commands";

/** Thrown by a receiver only when it definitely refused before admitting the request (server-only: no class in shared code). */
export class ReceiverRejected extends Error {
  constructor(message: string, readonly reason: "unsupported" | "invalid" | "capacity" | "refused" = "refused") { super(message); }
}
type Code = "STALE" | "HELD" | "UNKNOWN_OWNER" | "UNSUPPORTED" | "UNCERTAIN" | "CONFLICT";
export function refuse(code: Code, message: string): never { throw new SupervisionError(code, message); }
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
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
export const PAYLOAD_KIND = "payload-blob";
export const payloadRef = (blobId: string): VersionRef => ({ kind: PAYLOAD_KIND, id: blobId, version: 1, digest: blobId });
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

export interface GatewayOptions {
  /** Defaults off. Fixture-only enablement; no env flag, RPC or runtime wiring exists. */
  enabled?: boolean;
}
export interface StartedAttempt { attemptId: string | null; effects: { workspace: string; create: string; send: string } | null }

export class SupervisionGateway {
  constructor(readonly store: SupervisionStore, readonly commands: SupervisionCommands, readonly home: string,
    readonly receiver: GatewayReceiver, private readonly options: GatewayOptions = {}) {}
  private enabled() { if (!this.options.enabled) refuse("UNSUPPORTED", "The S04 effect gateway is disabled."); }
  async capabilities(): Promise<ReceiverCapabilities> {
    const parsed = ReceiverCapabilitiesSchema.safeParse(await this.receiver.capabilities());
    // A newer receiver claiming U1/U3 or anything undeclared is refused, never silently downgraded.
    if (!parsed.success) refuse("UNSUPPORTED", "Receiver capabilities are not in the qualified S04 contract.");
    return parsed.data;
  }

  /** Checked S03 start plus attempt, task pointer and workspace/create/send reservations, atomically. */
  async startWorker(input: ScopedPlanCommand, actor: SupervisionActor) {
    this.enabled();
    const command = input.command;
    if (!["start", "implicit", "claim"].includes(command.op)) refuse("UNSUPPORTED", "Only a checked start reserves a worker attempt.");
    const capabilities = await this.capabilities(); // Read before the writer lock; refusal happens only for new work.
    const replay = (await this.store.read()).commands.some(c => c.id === input.requestId);
    if (!replay && !capabilities.selectedAgentIds) refuse("UNSUPPORTED", "Receiver lacks caller-selected agent IDs; no legacy or fresh-ID fallback.");
    const brief = await this.pinnedBrief(input);
    const blob = brief ? await this.store.putBlob(brief) : null;
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
      const base = { requestId: input.requestId, requestHash: digest(input), scopeId, epoch: binding.epoch, attemptId,
        planRevision: input.revision || null, subjectHash: input.subjectHash ?? digest(command), policyVector: input.policyVector,
        approvalId: input.approvalId, state: "reserved" as const, receiptRef: null, version: 1 };
      const intent = workerWorkspaceIntent(task, ordinal, launch, ids.workspace);
      const effects: SupervisionEffect[] = [
        { ...base, id: ids.workspace, logicalKey: key("workspace.open"), operation: "workspace.open", evidenceVector: input.evidenceVector,
          resourceIds: [`workspace-intent:${intent.key}`], receiverKey: intent.key },
        { ...base, id: ids.create, logicalKey: key("agent.create"), operation: "agent.create", evidenceVector: input.evidenceVector,
          resourceIds: [`agent:${agentId}`], receiverKey: agentId },
        { ...base, id: ids.send, logicalKey: key("agent.send"), operation: "agent.send", evidenceVector: [...input.evidenceVector, payloadRef(blob.id)],
          resourceIds: [`turn:${agentId}`], receiverKey: sendMessageId(ids.send) },
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
    if (!started.attemptId) { // Replay: report the original reservation, never a new one.
      const status = await this.store.read();
      const attempt = status.attempts.find(a => status.effects.some(e => e.id === a.launchEffectId && e.requestId === input.requestId));
      if (attempt) started = { attemptId: attempt.id, effects: effectsFor(status, attempt.id) };
    }
    return { ...committed, ...started };
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

  /** One external boundary per call. Concurrent dispatchers race on the effect version; one wins. */
  async dispatch(effectId: string): Promise<SupervisionEffect> {
    this.enabled();
    const status = await this.store.read(), effect = status.effects.find(e => e.id === effectId);
    if (!effect) refuse("UNKNOWN_OWNER", "Unknown effect.");
    if (effect.state === "succeeded") return effect;
    if (["dispatching", "uncertain", "accepted"].includes(effect.state)) refuse("UNCERTAIN", "This effect may already have crossed its boundary; reconcile it, never resend.");
    if (effect.state !== "reserved") refuse("HELD", `Effect is ${effect.state}; a new step needs a new logical cause.`);
    const operation = requireGatewayOperation(effect.operation), call = await this.prepareCall(status, effect, operation);
    // Commit the boundary first: a crash after this leaves `dispatching`, which status reports as uncertain.
    const dispatching = { ...effect, state: "dispatching" as const, version: effect.version + 1 };
    const binding = status.bindings.find(b => b.scopeId === effect.scopeId)!;
    await this.store.transact([{ kind: "effect", id: effect.id, version: effect.version }, { kind: "binding", id: binding.scopeId, version: version(status, "binding", binding.scopeId) },
      ...call.fence], randomUUID(), [{ kind: "effect", value: dispatching }]);
    let outcome: { state: "succeeded" | "failed" | "uncertain"; receiptRef: string | null };
    try { outcome = { state: "succeeded", receiptRef: await call.run() }; }
    catch (error) {
      outcome = error instanceof ReceiverRejected ? { state: "failed", receiptRef: `rejected:${error.reason}:${error.message}`.slice(0, 1024) } :
        { state: "uncertain", receiptRef: null };
    }
    return this.settle(dispatching, outcome, call.after);
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
  private async prepareCall(status: SupervisionStatus, effect: SupervisionEffect, operation: GatewayOperation): Promise<{
    run: () => Promise<string>; fence: SupervisionExpected[]; after?: (status: SupervisionStatus) => SupervisionMutation[] }> {
    const scope = status.scopes.find(s => s.id === effect.scopeId), binding = status.bindings.find(b => b.scopeId === effect.scopeId);
    if (status.freshness !== "current" || status.storage.admissionsHeld) refuse("HELD", "Store is held; no new external effect.");
    if (!scope || !binding || binding.epoch !== effect.epoch || ["retired", "suspect"].includes(binding.state)) refuse("STALE", "The effect's owner epoch is no longer current.");
    const supervisor = effect.attemptId === null;
    // Supervisor activation effects run while the scope is preparing its binding; worker effects need an active owner.
    if (supervisor ? !["transferring", "active"].includes(scope.state) : scope.state !== "active" || binding.state !== "active") refuse("HELD", "Owner is not admitted for external effects.");
    if (!supervisor && status.operationHolds.some(h => h.scopeId === scope.id && h.state === "held" && h.operations.includes("plan.start"))) refuse("HELD", "Admissions are held for this scope.");
    const sibling = (op: GatewayOperation) => status.effects.find(e => e.scopeId === effect.scopeId && e.operation === op &&
      (supervisor ? e.attemptId === null && e.epoch === effect.epoch && e.requestId === effect.requestId : e.attemptId === effect.attemptId));
    const capabilities = await this.capabilities();
    const attempt = effect.attemptId ? status.attempts.find(a => a.id === effect.attemptId) : undefined;
    const task = attempt ? status.tasks.find(t => t.id === attempt.taskId) : undefined;
    if (!supervisor && (!attempt || !task || task.currentAttempt !== attempt.id)) refuse("STALE", "The attempt is no longer current for its task.");
    const fence: SupervisionExpected[] = attempt ? [{ kind: "attempt", id: attempt.id, version: attempt.version }] : [];
    switch (operation) {
      case "workspace.open": {
        const intent = supervisor ? supervisorWorkspaceIntent(scope.id, effect.epoch, effect.id) : workerIntentFor(status, effect);
        return { fence, run: async () => JSON.stringify(WorkspaceReceiptSchema.parse(await this.receiver.openWorkspace(intent))) };
      }
      case "agent.create": {
        if (!capabilities.selectedAgentIds) refuse("UNSUPPORTED", "Receiver no longer supports caller-selected IDs; the reservation stays as it is.");
        const workspace = workspaceReceipt(sibling("workspace.open"));
        if (!workspace) refuse("HELD", "The workspace effect has not succeeded; creation waits for it.");
        const create = supervisor ? supervisorCreate(effect, workspace, await this.profile(binding.profileDigest)) : workerCreate(status, effect, workspace);
        return { fence, run: async () => {
          const created = await this.receiver.createAgent(create);
          if (created.agentId !== create.agentId) throw new Error("Receiver returned a different identity; treated as uncertain.");
          return `agent:${created.agentId}`;
        } };
      }
      case "agent.send": {
        const target = supervisor ? binding.agentId : attempt?.worker?.agentId;
        if (supervisor ? binding.state !== "active" : attempt?.state !== "active" || !target) refuse("HELD", "Send waits for verified, active identity.");
        const text = await this.payload(effect);
        return { fence, run: async () => { await this.receiver.send(target!, text, effect.receiverKey!); return `message:${effect.receiverKey}`; },
          after: s => supervisor ? [] : promoteAttempt(s, effect.attemptId!, "prompted") };
      }
      case "agent.interrupt": {
        const target = attempt?.worker?.agentId ?? refuse("HELD", "Interrupt needs a verified current worker.");
        return { fence, run: async () => { await this.receiver.interrupt(target); return `interrupted:${target}`; } };
      }
      case "agent.archive": {
        const target = attempt?.worker?.agentId ?? refuse("HELD", "Archive needs a verified worker.");
        await this.checkInventory(capabilities, target, effect.receiverKey);
        return { fence, run: async () => `archived:${(await this.receiver.archive(target)).archivedAt}` };
      }
    }
  }
  /** The binding's profile digest is the canonical blob identity of the reserved profile. */
  async profile(profileDigest: string): Promise<AgentProfile> {
    const bytes = await readFile(join(this.store.root, "blobs", profileDigest)).catch(() => refuse("HELD", "The reserved supervisor profile blob is missing."));
    if (sha256(bytes) !== profileDigest) refuse("HELD", "The reserved supervisor profile blob is corrupt.");
    return AgentProfileSchema.parse(JSON.parse(bytes.toString("utf8")));
  }
  /** Payloads are immutable store blobs, so a retried or reconciled send can never change its words. */
  private async payload(effect: SupervisionEffect): Promise<string> {
    const ref = effect.evidenceVector.find(r => r.kind === PAYLOAD_KIND) ?? refuse("HELD", "Send effect has no durable payload.");
    const bytes = await readFile(join(this.store.root, "blobs", ref.id));
    if (sha256(bytes) !== ref.id) refuse("HELD", "Send payload is missing or corrupt.");
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

  /** Exact identity lookup only. A negative answer never proves non-creation; nothing is resent. */
  async reconcile(effectId: string): Promise<SupervisionEffect> {
    this.enabled();
    const status = await this.store.read(), effect = status.effects.find(e => e.id === effectId) ?? refuse("UNKNOWN_OWNER", "Unknown effect.");
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
      found = observed?.archivedAt ? `archived:${observed.archivedAt}` : null;
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
    const capabilities = await this.capabilities(), pre = await this.store.read(), replay = pre.commands.some(c => c.id === input.requestId);
    const worker = pre.attempts.find(a => a.id === input.attemptId)?.worker?.agentId;
    const inventoryKey = operation === "agent.archive" && worker && !replay ? await this.checkInventory(capabilities, worker, null) : null;
    const { receipt } = await this.store.transactCommand(input.requestId, digest({ propose: input }), actor, async status => {
      const scope = status.scopes.find(s => s.id === input.scopeId), binding = status.bindings.find(b => b.scopeId === input.scopeId);
      if (!scope || scope.state !== "active" || binding?.state !== "active" || binding.epoch !== input.epoch) refuse("STALE", "Owner epoch is not current.");
      if (actor.kind !== "agent" || actor.id !== binding.agentId) refuse("UNKNOWN_OWNER", "Only the bound plan owner proposes worker interrupt or archive; General is not a bypass.");
      const attempt = status.attempts.find(a => a.id === input.attemptId), task = attempt ? status.tasks.find(t => t.id === attempt.taskId) : undefined;
      if (!attempt?.worker || !task || task.ownerScopeId !== scope.id || task.currentAttempt !== attempt.id) refuse("UNKNOWN_OWNER", "Target is not this owner's verified current worker.");
      if (operation === "agent.archive") {
        const node = status.plans.find(p => p.plan.definition.id === task.planId)?.plan.nodes[task.nodeId];
        if (!node || !["done", "landed", "failed", "cancelled"].includes(node.state)) refuse("HELD", "Idle is not finished; archive needs a recorded terminal outcome.");
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
function supervisorCreate(effect: SupervisionEffect, workspace: WorkspaceReceipt, profile: AgentProfile) {
  return { agentId: effect.receiverKey!, workspaceId: workspace.workspaceId, cwd: workspace.directory, profile,
    title: `Plan supervisor ${effect.scopeId.slice(0, 8)}`, labels: supervisorLabels(effect.scopeId, effect.epoch) };
}
export function supervisorLabels(scopeId: string, epoch: number): Record<string, string> {
  return { [CREW_LABELS.role]: SUPERVISOR_ROLE, [SCOPE_LABELS.scope]: scopeId, [SCOPE_LABELS.epoch]: String(epoch) };
}
function promoteAttempt(status: SupervisionStatus, attemptId: string, state: string): SupervisionMutation[] {
  const attempt = status.attempts.find(a => a.id === attemptId)!;
  return attempt.state === state ? [] : [{ kind: "attempt", value: { ...attempt, state, version: attempt.version + 1 } }];
}
