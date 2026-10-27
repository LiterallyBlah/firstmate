/** S04 plan-supervisor lifecycle: reserved/unprompted -> verified -> active -> send, and manual transfer.
 * Disabled by default; no RPC, timer, lease, executor or automatic takeover. A supervisor is a home
 * guest bound to one scope epoch: it never holds or borrows the global first-mate role (role.mjs).
 * Accepted requests replay from their immutable command receipt before any mutable preflight.
 */
import { randomUUID } from "node:crypto";
import type { SupervisionActor, SupervisionBinding, SupervisionEffect, SupervisionStatus } from "../shared/supervision";
import { AgentProfileSchema, type AgentProfile, type GatewayLimits, type GatewayReceiver } from "../shared/supervision-effects";
import { canonical, digest } from "./submissions";
import type { SupervisionMutation, SupervisionStore } from "./supervision-store";
import {
  effectLogicalKey, expectedFor, refuse, sendMessageId, stableId, supervisorLabels, supervisorWorkspaceIntent,
  verifyObservation, workspaceReceipt, type SupervisionGateway,
} from "./supervision-effects";

export interface SupervisorOptions {
  enabled?: boolean;
  /** Fixture-supplied caps; the durable policy source for them is an integration item. */
  limits: GatewayLimits;
  /** The configured global first mate, read fresh. A scope binding can never be that identity. */
  globalMateId: () => Promise<string | null>;
}
/** Cumulative reservation accounting. A supervisor session/turn is spent when it is reserved; neither
 * cancellation, definite failure nor uncertainty decreases it. `uncertain` is shown separately.
 */
export function supervisorSpend(status: SupervisionStatus, scopeId: string) {
  const own = status.effects.filter(e => e.scopeId === scopeId && e.attemptId === null);
  return { sessions: own.filter(e => e.operation === "agent.create").length, turns: own.filter(e => e.operation === "agent.send").length,
    uncertain: own.filter(e => ["dispatching", "uncertain", "accepted"].includes(e.state)).length };
}
export function activationEffects(status: SupervisionStatus, scopeId: string, epoch: number) {
  const of = (operation: "workspace.open" | "agent.create" | "agent.send") => status.effects.find(e => e.scopeId === scopeId &&
    e.logicalKey === effectLogicalKey({ scopeId, subject: `epoch:${epoch}`, operation, causation: "scope.activate", objectiveRevision: 0 }));
  return { workspace: of("workspace.open"), create: of("agent.create"), send: of("agent.send") };
}
/** A committed stop or policy hold freezes new supervisor model work for this scope, as for workers. */
function refuseHeld(status: SupervisionStatus, scopeId: string) {
  if (status.operationHolds.some(h => h.scopeId === scopeId && h.state === "held" && h.operations.some(o => o === "plan.start" || o === "model.use")))
    refuse("HELD", "Admissions are held for this scope; no supervisor session or turn is reserved.");
}
const NO_RESULT = { planId: null, planHash: null, decisionId: null, outboxId: null };
/** S07 has cut this scope over: some plan's latest migration is committed, none is prepared or at its barrier, and
 * every backend the scope owns is scoped and active. */
function cutOver(status: SupervisionStatus, scopeId: string) {
  const migrations = (status.migrations ?? []).filter(m => m.scopeId === scopeId);
  const latest = [...new Set(migrations.map(m => m.planId))].map(plan => migrations.filter(m => m.planId === plan).at(-1)!);
  return latest.some(m => m.state === "committed") && latest.every(m => m.state === "committed" || m.state === "aborted") &&
    status.backends.filter(b => b.ownerScopeId === scopeId).every(b => b.backend === "scoped" && b.state === "active");
}

export class SupervisorSessions {
  constructor(readonly store: SupervisionStore, readonly gateway: SupervisionGateway, readonly receiver: GatewayReceiver,
    private readonly options: SupervisorOptions) {}
  private enabled() { if (!this.options.enabled) refuse("UNSUPPORTED", "Scoped supervisor sessions are disabled."); }
  private async accepted(requestId: string) { return (await this.store.read()).commands.some(c => c.id === requestId); }
  /** Replay only: an accepted request returns its original receipt; different bytes conflict; nothing runs. */
  private replay(requestId: string, inputHash: string, actor: SupervisionActor) {
    return this.store.transactCommand(requestId, inputHash, actor, async () => refuse("CONFLICT", "Expected an accepted replay."));
  }

  /** Reserve one supervisor for a dormant scope: a prepared binding with a selected, unprompted identity. */
  prepare(input: { requestId: string; scopeId: string; scopeVersion: number; profile: AgentProfile; opening: string; purpose?: "discussion" | "work" }, actor: SupervisionActor) {
    return this.reserve(input, actor, "activate", null);
  }
  /** S11: the first supervisor of a scope S07 has cut over (committed migration, scope active, no binding). Explicit
   * captain or first-mate action only; nothing attaches on its own, and it never replaces an existing binding. The
   * same reserved, unprompted identity and verify/activate path as `prepare` follow. */
  async attach(input: { requestId: string; scopeId: string; scopeVersion: number; profile: AgentProfile; opening: string; purpose?: "discussion" | "work" }, actor: SupervisionActor) {
    this.enabled();
    if (actor.kind !== "captain-ui" && actor.kind !== "mate-chat") refuse("UNSUPPORTED", "Attaching a supervisor to a cut-over scope is an explicit captain or first-mate action.");
    return this.reserve(input, actor, "attach", null);
  }
  /** Manual replacement only after the exact old supervisor is shown stopped; a lease or timeout proves nothing. */
  async prepareReplacement(input: { requestId: string; scopeId: string; scopeVersion: number; expectedEpoch: number; profile: AgentProfile; opening: string }, actor: SupervisionActor) {
    this.enabled();
    const inputHash = digest({ supervisor: "replace", input });
    if (await this.accepted(input.requestId)) return this.replay(input.requestId, inputHash, actor);
    if (actor.kind !== "captain-ui") refuse("UNSUPPORTED", "Pilot replacement is an explicit captain action.");
    const binding = (await this.store.read()).bindings.find(b => b.scopeId === input.scopeId);
    if (!binding || binding.epoch !== input.expectedEpoch || !["suspect", "retired"].includes(binding.state)) refuse("STALE", "Hold the current binding before preparing its replacement.");
    const old = await this.receiver.findAgent(binding.agentId);
    // Archived/closed is the only quiescence this cooperative pilot can observe, and only for the exact identity.
    if (old?.id !== binding.agentId || (!old.archivedAt && old.status !== "closed")) refuse("HELD", "The previous full-access supervisor is not shown stopped under its exact identity; no automatic takeover.");
    return this.reserve(input, actor, "replace", binding);
  }
  private async reserve(input: { requestId: string; scopeId: string; scopeVersion: number; expectedEpoch?: number; profile: AgentProfile; opening: string; purpose?: "discussion" | "work" },
    actor: SupervisionActor, mode: "activate" | "attach" | "replace", checked: SupervisionBinding | null) {
    this.enabled();
    const inputHash = digest({ supervisor: mode, input });
    if (mode !== "replace" && await this.accepted(input.requestId)) return this.replay(input.requestId, inputHash, actor);
    if (actor.kind === "agent") refuse("UNSUPPORTED", "Agents cannot activate scopes; General and supervisors are not bypass principals.");
    const profile = AgentProfileSchema.parse(input.profile), capabilities = await this.gateway.capabilities();
    if (!capabilities.selectedAgentIds) refuse("UNSUPPORTED", "Receiver lacks caller-selected agent IDs; no legacy or fresh-ID fallback.");
    // Blobs are content-addressed and inert until referenced, so preparing them before the lock is safe.
    const opening = await this.store.putBlob(Buffer.from(input.opening, "utf8")), profileBlob = await this.store.putBlob(Buffer.from(canonical(profile), "utf8"));
    if (profileBlob.id !== digest(profile)) refuse("CONFLICT", "Profile encoding mismatch.");
    return this.store.transactCommand(input.requestId, inputHash, actor, async status => {
      const scope = status.scopes.find(s => s.id === input.scopeId), old = status.bindings.find(b => b.scopeId === input.scopeId);
      if (!scope || !["plan", "project"].includes(scope.kind) || scope.mode !== "scoped") refuse("UNKNOWN_OWNER", "Exact scoped plan or project discussion owner required.");
      if (scope.version !== input.scopeVersion) refuse("STALE", "Scope version changed.");
      if (mode === "activate" ? scope.state !== "dormant" || old : mode === "attach" ? scope.state !== "active" || old || !cutOver(status, scope.id)
        : scope.state !== "transferring" || !old || old.epoch !== input.expectedEpoch || !["suspect", "retired"].includes(old.state))
        refuse("HELD", mode === "activate" ? "Only a dormant scope without a binding is activated here."
          : mode === "attach" ? "Only a scope S07 has cut over (committed, active, no binding and no migration in progress) is attached here."
          : "Replacement needs the held previous epoch.");
      // The observed-stopped identity must still be the binding being replaced.
      if (mode === "replace" && digest(old) !== digest(checked)) refuse("STALE", "The held binding changed after its quiescence was observed.");
      refuseHeld(status, scope.id);
      const spent = supervisorSpend(status, scope.id), limits = this.options.limits;
      if (spent.sessions + 1 > limits.supervisorSessions || spent.turns + 1 > limits.supervisorTurns)
        refuse("HELD", "Supervisor session/turn budget is exhausted; one scoped budget decision is required. Nothing was reserved.");
      const epoch = (old?.epoch ?? 0) + 1, key = (operation: "workspace.open" | "agent.create" | "agent.send") =>
        effectLogicalKey({ scopeId: scope.id, subject: `epoch:${epoch}`, operation, causation: "scope.activate", objectiveRevision: 0 });
      const ids = { workspace: stableId("effect", key("workspace.open")), create: stableId("effect", key("agent.create")), send: stableId("effect", key("agent.send")) };
      const agentId = stableId("agent", ids.create), intent = supervisorWorkspaceIntent(scope.id, epoch, ids.workspace);
      // Explicit intent; the verified workspace ID is unknown (null) until its own effect succeeds and verify binds it.
      const binding: SupervisionBinding = { scopeId: scope.id, epoch, hostId: "local", agentId, workspaceId: null, workspaceIntent: intent.key,
        profileDigest: profileBlob.id, state: "prepared", checkpointHash: opening.id, acknowledgedSeq: old?.acknowledgedSeq ?? 0, heartbeatDue: null,
        purpose: old?.purpose === "discussion" || input.purpose === "discussion" ? "discussion" : "work" };
      const base = { requestId: input.requestId, requestHash: digest(input), scopeId: scope.id, epoch, attemptId: null, planRevision: null,
        subjectHash: digest({ scope: scope.id, epoch }), policyVector: [], evidenceVector: [], approvalId: null, state: "reserved" as const, receiptRef: null, version: 1 };
      const effects: SupervisionEffect[] = [
        { ...base, id: ids.workspace, logicalKey: key("workspace.open"), operation: "workspace.open", resourceIds: [`workspace-intent:${intent.key}`], receiverKey: intent.key },
        { ...base, id: ids.create, logicalKey: key("agent.create"), operation: "agent.create", resourceIds: [`agent:${agentId}`], receiverKey: agentId },
        { ...base, id: ids.send, logicalKey: key("agent.send"), operation: "agent.send", resourceIds: [`turn:${agentId}`], receiverKey: sendMessageId(ids.send), payloadDigest: opening.id },
      ];
      const blobs = [opening, profileBlob].filter((b, i, all) => all.findIndex(o => o.id === b.id) === i && !status.versions.some(v => v.kind === "blob" && v.id === b.id));
      const mutations: SupervisionMutation[] = [
        { kind: "scope", value: { ...scope, state: "transferring", version: scope.version + 1 } }, { kind: "binding", value: binding },
        ...effects.map(value => ({ kind: "effect" as const, value })), ...blobs.map(value => ({ kind: "blob" as const, value })),
      ];
      return { expectedVersions: expectedFor(status, mutations), mutations, result: NO_RESULT };
    });
  }

  /** Verify the created, unprompted supervisor, then commit the verified workspace, binding and scope active in one record. */
  async verify(scopeId: string, epoch: number): Promise<SupervisionBinding> {
    this.enabled();
    const status = await this.store.read(), binding = status.bindings.find(b => b.scopeId === scopeId);
    if (!binding || binding.epoch !== epoch) refuse("STALE", "Binding epoch changed.");
    if (binding.state === "active") return binding;
    if (binding.state !== "prepared") refuse("HELD", `Binding is ${binding.state}.`);
    const effects = activationEffects(status, scopeId, epoch), workspace = workspaceReceipt(effects.workspace);
    if (effects.create?.state !== "succeeded" || !workspace || effects.workspace?.receiverKey !== binding.workspaceIntent)
      refuse("HELD", "Supervisor creation is not confirmed for this intent; verification waits.");
    const problem = verifyObservation(await this.receiver.findAgent(binding.agentId), { agentId: binding.agentId, workspace,
      profile: await this.gateway.profile(binding.profileDigest), labels: supervisorLabels(scopeId, epoch) });
    if (problem) refuse("HELD", `${problem} No opening was sent.`);
    // No scope authority may leak into the global role: a supervisor is always a home guest.
    if ((await this.options.globalMateId()) === binding.agentId) refuse("CONFLICT", "The global first mate cannot also be a scope supervisor.");
    const fresh = await this.store.read(), scope = fresh.scopes.find(s => s.id === scopeId)!, current = fresh.bindings.find(b => b.scopeId === scopeId)!;
    if (digest(current) !== digest(binding) || scope.state !== "transferring") refuse("STALE", "The binding changed during verification.");
    const active: SupervisionBinding = { ...binding, workspaceId: workspace.workspaceId, state: "active" };
    const mutations: SupervisionMutation[] = [{ kind: "binding", value: active }, { kind: "scope", value: { ...scope, state: "active", version: scope.version + 1 } }];
    await this.store.transact(expectedFor(fresh, mutations), randomUUID(), mutations);
    return active;
  }

  /** Explicit hold before any replacement. Never triggered by a lease, heartbeat gap or timeout. */
  async hold(input: { requestId: string; scopeId: string; expectedEpoch: number; reason: string }, actor: SupervisionActor) {
    this.enabled();
    if (actor.kind !== "captain-ui") refuse("UNSUPPORTED", "Holding a supervisor for transfer is an explicit captain action.");
    return this.store.transactCommand(input.requestId, digest({ hold: input }), actor, async status => {
      const scope = status.scopes.find(s => s.id === input.scopeId), binding = status.bindings.find(b => b.scopeId === input.scopeId);
      if (!scope || !binding || binding.epoch !== input.expectedEpoch || !["active", "prepared"].includes(binding.state)) refuse("STALE", "Binding epoch changed.");
      // Uncertain and dispatched effects stay with their original epoch and reservations; nothing is cancelled as proof.
      const mutations: SupervisionMutation[] = [{ kind: "scope", value: { ...scope, state: "transferring", version: scope.version + 1 } },
        { kind: "binding", value: { ...binding, state: "suspect" } }];
      return { expectedVersions: expectedFor(status, mutations), mutations, result: NO_RESULT };
    });
  }

  /** A counted supervisor turn (e.g. an S02 informational offer). Spent at reservation; unknown delivery keeps it. */
  reserveTurn(input: { requestId: string; scopeId: string; epoch: number; causation: string; text: string }, actor: SupervisionActor): Promise<string> {
    return this.reserveTurnWith(input, actor);
  }
  /** S02 composition: offer claim and counted turn reservation publish together. The callback runs
   * only on a new accepted command, under the same writer boundary, never on request replay. */
  async reserveTurnWith(input: { requestId: string; scopeId: string; epoch: number; causation: string; text: string }, actor: SupervisionActor,
    extend?: (status: SupervisionStatus) => SupervisionMutation[]): Promise<string> {
    this.enabled();
    const inputHash = digest({ turn: input });
    const { receipt } = await this.accepted(input.requestId) ? await this.replay(input.requestId, inputHash, actor) : await (async () => {
      if (actor.kind === "agent") refuse("UNSUPPORTED", "Supervisor turns are reserved by the plugin, not by agents.");
      const blob = await this.store.putBlob(Buffer.from(input.text, "utf8"));
      return this.store.transactCommand(input.requestId, inputHash, actor, async status => {
        const scope = status.scopes.find(s => s.id === input.scopeId), binding = status.bindings.find(b => b.scopeId === input.scopeId);
        if (!scope || scope.state !== "active" || binding?.state !== "active" || binding.epoch !== input.epoch) refuse("STALE", "No active owner at this epoch.");
        refuseHeld(status, scope.id);
        if (status.effects.some(e => e.scopeId === scope.id && e.attemptId === null && e.operation === "agent.send" && ["reserved", "dispatching", "uncertain", "accepted"].includes(e.state)))
          refuse("HELD", "Reconcile the existing supervisor turn before reserving another; uncertainty retains its spend.");
        if (supervisorSpend(status, scope.id).turns + 1 > this.options.limits.supervisorTurns) refuse("HELD", "Supervisor turn budget is exhausted; one scoped budget decision is required.");
        const key = effectLogicalKey({ scopeId: scope.id, subject: `epoch:${binding.epoch}`, operation: "agent.send", causation: input.causation, objectiveRevision: 0 });
        if (status.index.effectKeys[key]) refuse("CONFLICT", `This turn's cause is already reserved as ${status.index.effectKeys[key]}.`);
        const id = stableId("effect", key);
        const effect: SupervisionEffect = { id, logicalKey: key, requestId: input.requestId, requestHash: digest(input), scopeId: scope.id, epoch: binding.epoch,
          attemptId: null, operation: "agent.send", planRevision: null, subjectHash: digest({ turn: input.causation }), policyVector: [],
          evidenceVector: [], approvalId: null, resourceIds: [`turn:${binding.agentId}`], state: "reserved", receiverKey: sendMessageId(id), receiptRef: null, version: 1,
          payloadDigest: blob.id };
        const mutations: SupervisionMutation[] = [...(extend?.(status) ?? []),
          { kind: "binding", value: { ...binding, observation: { state: "unknown", at: new Date().toISOString() } } }, { kind: "effect", value: effect },
          ...(status.versions.some(v => v.kind === "blob" && v.id === blob.id) ? [] : [{ kind: "blob" as const, value: blob }])];
        return { expectedVersions: expectedFor(status, mutations), mutations, result: NO_RESULT };
      });
    })();
    return receipt.versions.find(v => v.kind === "effect")!.id;
  }
}
