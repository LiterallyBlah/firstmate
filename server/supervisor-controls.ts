/** Dedicated app convention only. No helper/CLI transport, hot settings API or native stop shortcut. */
import type { SupervisionStatus } from "../shared/supervision";
import type { GatewayLimits, GatewayReceiver } from "../shared/supervision-effects";
import { profileProblem, SupervisorReplacementInputSchema, type SupervisorCatalog, type SupervisorProfile, type SupervisorConfiguration } from "../shared/supervisor-profile";
import { digest } from "./submissions";
import { expectedFor, refuse, stableId, type SupervisionGateway } from "./supervision-effects";
import { activationEffects, type SupervisorSessions } from "./supervisor-sessions";
import type { SupervisionStore } from "./supervision-store";
import { supervisorControl, supervisorConfigurations, supervisorView } from "./supervisor-configuration";
export const SUPERVISOR_UI = { kind: "plugin-ui-unverified" as const, id: "unauthenticated-plugin-call", source: "Supervisor controls (unverified)" };
type Target = { requestId: string; homeId: string; scopeId: string; expectedEpoch: number; bindingDigest: string | null; planHash?: string | null | undefined };
type Stage = Target & { profile: SupervisorProfile; limits: GatewayLimits; policyDigest: string };
const empty = { planId: null, planHash: null, decisionId: null, outboxId: null };
export class SupervisorControls {
  constructor(readonly store: SupervisionStore, readonly sessions: SupervisorSessions, readonly gateway: SupervisionGateway,
    readonly receiver: GatewayReceiver, private readonly options: { enabled: boolean; catalog: (scopeId: string, configuration?: SupervisorConfiguration) => Promise<SupervisorCatalog>;
      workspace?: (scopeId: string, epoch: number) => { intentKey: string; directory: string };
      validate: (status: SupervisionStatus, scopeId: string) => Promise<void>; limits?: (status: SupervisionStatus, scopeId: string) => GatewayLimits;
      policyDigest?: () => Promise<string>; reserve?: <T>(run: () => Promise<T>) => Promise<T> }) {}
  read = supervisorView;
  private check(status: SupervisionStatus, input: Target) {
    if (!this.options.enabled) refuse("UNSUPPORTED", "Supervisor controls are disabled.");
    const scope = status.scopes.find(s => s.id === input.scopeId), binding = status.bindings.find(b => b.scopeId === input.scopeId);
    if (status.homeId !== input.homeId || scope?.homeId !== input.homeId || !binding || binding.hostId !== "local" ||
      binding.epoch !== input.expectedEpoch || digest(binding) !== input.bindingDigest) refuse("STALE", "The exact home, host or Supervisor changed. Reopen its review.");
    const plan = status.plans.find(p => p.scopeId === input.scopeId)?.plan;
    if (plan && input.planHash !== plan.hash) refuse("STALE", "The displayed plan changed. Reopen its Supervisor review.");
    return { scope, binding };
  }
  async stageFromUnverifiedUi(input: Stage) {
    const hash = digest({ stage: input });
    // Replay precedes discovery, source and native reads, including after a lost reply.
    if ((await this.store.read()).commands.some(c => c.id === input.requestId))
      return this.store.transactCommand(input.requestId, hash, SUPERVISOR_UI, async () => refuse("CONFLICT", "Expected accepted replay."));
    const workspace = this.options.workspace?.(input.scopeId, input.expectedEpoch + 1);
    const catalog = await this.options.catalog(input.scopeId), problem = profileProblem(input.profile, catalog);
    if (problem) refuse("UNSUPPORTED", problem);
    const policy = await this.options.policyDigest?.();
    return this.store.transactCommand(input.requestId, hash, SUPERVISOR_UI, async status => {
      const { scope, binding } = this.check(status, input); await this.options.validate(status, input.scopeId);
      if (binding.state !== "active" || scope.state !== "active") refuse("HELD", "Only an active exact owner can stage a profile change.");
      const prior = supervisorControl(status, input.scopeId);
      if (prior && ["stage", "pause"].includes(prior.action)) refuse("HELD", "A pending change or pause already holds this Supervisor. Inspect its saved review.");
      if (policy !== undefined && policy !== input.policyDigest) refuse("STALE", "Effective policy changed; review again.");
      const limits = this.options.limits?.(status, input.scopeId);
      if (input.limits.supervisorSessions < 1 || input.limits.supervisorTurns < 1 || limits &&
        (input.limits.supervisorSessions > limits.supervisorSessions || input.limits.supervisorTurns > limits.supervisorTurns)) refuse("HELD", "These limits exceed the existing reviewed allocation. Configuration grants no budget increase.");
      const plan = status.plans.find(p => p.scopeId === scope.id)?.plan;
      const configuration: SupervisorConfiguration = { id: input.requestId, scopeId: scope.id,
        generation: (supervisorConfigurations(status, scope.id).at(-1)?.generation ?? 0) + 1,
        ...(workspace ? { workspace } : {}), requested: input.profile, resolved: input.profile, catalogDigest: digest(catalog), policyDigest: input.policyDigest,
        target: { homeId: status.homeId, hostId: "local", scopeId: scope.id, kind: scope.kind as "plan" | "project" | "maintenance", planId: plan?.definition.id ?? null, planHash: plan?.hash ?? null },
        limits: input.limits, effectiveEpoch: binding.epoch + 1, provenance: "client UI (unverified)" };
      return { expectedVersions: [], mutations: [], result: { ...empty, supervisorConfiguration: configuration,
        supervisorControl: { id: input.requestId, scopeId: scope.id, epoch: binding.epoch, action: "stage", predecessor: prior?.id ?? null, configuration } } };
    });
  }
  pauseFromUnverifiedUi(input: Target) { return this.pauseOrResume(input, false); }
  resumeFromUnverifiedUi(input: Target & { expectedControlId: string }) { return this.pauseOrResume(input, true); }
  private pauseOrResume(input: Target & { expectedControlId?: string }, resume: boolean) {
    return this.store.transactCommand(input.requestId, digest({ [resume ? "resume" : "pause"]: input }), SUPERVISOR_UI, async status => {
      const { scope, binding } = this.check(status, input); await this.options.validate(status, input.scopeId);
      const prior = supervisorControl(status, input.scopeId);
      if (scope.state !== "active" || binding.state !== "active" || (resume ? prior?.action !== "pause" || prior.id !== input.expectedControlId : prior && ["stage", "pause"].includes(prior.action)))
        refuse("HELD", "Resume releases only the displayed ordinary pause. Pending changes, suspect bindings and other holds require their own disposition.");
      return { expectedVersions: [], mutations: [], result: { ...empty, supervisorControl: { id: input.requestId, scopeId: input.scopeId,
        epoch: input.expectedEpoch, action: resume ? "resume" as const : "pause" as const, predecessor: prior?.id ?? null } } };
    });
  }
  /** Exact pending-subject withdrawal. Only its own unreserved transfer hold can be released; budgets, generations and other holds remain. */
  withdrawProposalFromUnverifiedUi(input: Target & { expectedControlId: string; configurationDigest: string }) {
    return this.store.transactCommand(input.requestId, digest({ withdrawProposal: input }), SUPERVISOR_UI, async status => {
      const { scope, binding } = this.check(status, input); await this.options.validate(status, input.scopeId);
      const prior = supervisorControl(status, scope.id);
      if (prior?.action !== "stage" || prior.id !== input.expectedControlId || digest(prior.configuration) !== input.configurationDigest)
        refuse("STALE", "The exact pending proposal changed. Reopen its review.");
      const held = status.commands.flatMap(c => c.result.supervisorReplacement?.expectedControlId === prior.id ? [c.result.supervisorReplacement] : []).at(-1);
      const ownUnreservedHold = scope.state === "transferring" && binding.state === "suspect" && held?.expectedEpoch === binding.epoch &&
        digest({ ...binding, state: "active" }) === held.bindingDigest && !status.effects.some(e => e.scopeId === scope.id && e.epoch > binding.epoch);
      if ((scope.state !== "active" || binding.state !== "active") && !ownUnreservedHold) refuse("HELD", "A replacement is already reserved or another hold owns this binding; retain its original request.");
      const mutations = ownUnreservedHold ? [{ kind: "scope" as const, value: { ...scope, state: "active" as const, version: scope.version + 1 } },
        { kind: "binding" as const, value: { ...binding, state: "active" as const } }] : [];
      return { expectedVersions: expectedFor(status, mutations), mutations, result: { ...empty, supervisorControl: { id: input.requestId, scopeId: scope.id,
        epoch: binding.epoch, action: "withdraw" as const, predecessor: prior.id } } };
    });
  }
  /** Explicit non-delivery disposition, only for an exact never-dispatched owner input. Workers use their existing stop path. */
  withdrawInputFromUnverifiedUi(input: Target & { expectedControlId: string; effectId: string; effectVersion: number }) {
    return this.store.transactCommand(input.requestId, digest({ withdrawInput: input }), SUPERVISOR_UI, async status => {
      const { scope, binding } = this.check(status, input); await this.options.validate(status, input.scopeId);
      const prior = supervisorControl(status, scope.id), effect = status.effects.find(e => e.id === input.effectId);
      if (prior?.action !== "stage" || prior.id !== input.expectedControlId || !effect || effect.scopeId !== scope.id ||
        effect.epoch !== binding.epoch || effect.version !== input.effectVersion) refuse("STALE", "The pending proposal or exact input changed.");
      if (binding.state !== "active" || scope.state !== "active" || effect.attemptId !== null || effect.operation !== "agent.send" || effect.state !== "reserved")
        refuse("HELD", "Only a never-dispatched owner input can be withdrawn. Worker and uncertain effects retain their own disposition.");
      const mutations = [{ kind: "effect" as const, value: { ...effect, state: "cancelled" as const,
        receiptRef: `withdrawn-undelivered:${input.requestId}`, version: effect.version + 1 } }];
      return { expectedVersions: expectedFor(status, mutations), mutations, result: empty };
    });
  }
  async replaceFromUnverifiedUi(input: Target & { expectedControlId: string; opening: string }) {
    const original = SupervisorReplacementInputSchema.parse({ ...input, op: "replace" });
    const s = await this.store.read(), accepted = s.commands.find(c => c.id === input.requestId);
    const pending = supervisorControl(s, input.scopeId), config = pending?.configuration;
    if (!accepted) {
      const held = s.commands.find(c => c.id === stableId("supervisor-replacement-hold", input.requestId));
      const checked = held ? { ...s, bindings: s.bindings.map(b => b.scopeId === input.scopeId && b.state === "suspect" ? { ...b, state: "active" as const } : b) } : s;
      const { binding } = this.check(checked, input); await this.options.validate(s, input.scopeId);
      if (pending?.action !== "stage" || pending.id !== input.expectedControlId || !config) refuse("STALE", "The pending configuration changed. Reopen review.");
      const catalog = await this.options.catalog(input.scopeId, config);
      const problem = profileProblem(config.resolved, catalog);
      if (problem) refuse("UNSUPPORTED", problem);
      if (config.catalogDigest !== digest(catalog)) refuse("STALE", "Catalog changed after the profile review; replacement is held.");
      const plan = s.plans.find(p => p.scopeId === input.scopeId)?.plan;
      if (config.target.planHash !== (plan?.hash ?? null)) refuse("STALE", "The reviewed target changed; replacement is held.");
      if (this.options.policyDigest && config.policyDigest !== await this.options.policyDigest()) refuse("STALE", "Policy changed after this proposal; replacement is held.");
      if (s.effects.some(e => e.scopeId === input.scopeId && ["dispatching", "uncertain", "accepted"].includes(e.state)))
        refuse("UNCERTAIN", "Reconcile uncertain effects under their original identities before replacement.");
      if (s.effects.some(e => e.scopeId === input.scopeId && e.epoch === binding.epoch && e.state === "reserved"))
        refuse("HELD", "Withdraw each undelivered owner input explicitly; reserved workers require their existing stop disposition before replacement.");
      const old = await this.receiver.findAgent(binding.agentId);
      if (old?.id !== binding.agentId || (!old.archivedAt && old.status !== "closed")) refuse("HELD", "Open this exact native session and stop it. Idle, offline and timeout are not stopped proof.");
      await this.sessions.holdFromUnverifiedUi({ requestId: stableId("supervisor-replacement-hold", input.requestId), scopeId: input.scopeId,
        expectedEpoch: input.expectedEpoch, reason: `Reviewed replacement ${digest(original)}; native predecessor observed stopped.`, replacementInput: original, configuration: config, controlId: input.expectedControlId });
    }
    const current = await this.store.read(), configuration = accepted?.result.supervisorControl?.configuration ?? accepted?.result.supervisorConfiguration ?? config;
    if (!configuration) refuse("HELD", "Original configuration is unavailable; restore its receipt.");
    const reserve = () => this.sessions.prepareReplacementFromUnverifiedUi({ requestId: input.requestId, scopeId: input.scopeId,
      scopeVersion: current.scopes.find(x => x.id === input.scopeId)!.version, expectedEpoch: input.expectedEpoch,
      profile: configuration.resolved, opening: input.opening, configuration, controlId: input.expectedControlId, reviewIdentity: digest(original), replacementInput: original });
    await (this.options.reserve ? this.options.reserve(reserve) : reserve());
    const status = await this.store.read(), binding = status.bindings.find(b => b.scopeId === input.scopeId)!;
    const effects = activationEffects(status, input.scopeId, binding.epoch);
    for (const e of [effects.workspace, effects.create]) {
      if (!e || e.requestId !== input.requestId) refuse("STALE", "This request no longer owns the replacement.");
      if (e.state === "succeeded") continue;
      const result = ["dispatching", "uncertain", "accepted"].includes(e.state) ? await this.gateway.reconcile(e.id) : await this.gateway.dispatch(e.id);
      if (result.state !== "succeeded") return;
    }
    if (binding.state === "prepared") await this.sessions.verify(input.scopeId, binding.epoch);
    if (effects.send?.requestId !== input.requestId) refuse("STALE", "Opening request changed.");
    if (effects.send.state === "reserved") await this.gateway.dispatch(effects.send.id);
  }
}
