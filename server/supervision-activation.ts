/** Default-off production wiring. Views never initialize a store or acquire a coordinator.
 * Attach is an app convention, NOT a verified captain principal. No background dispatch loop ships. */
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { GatewayReceiver } from "../shared/supervision-effects";
import { ActivationSnapshotSchema, readSupervisionActivation, migrateSupervisionPlan, attachSupervisorFromUi,
  type ActivationSnapshot, type MigrationCommand, type AttachSupervisorInput, type ResumeSupervisorInput } from "../shared/supervision-activation";
import type { SupervisionStatus, SupervisionActor } from "../shared/supervision";
import { readFirstmateConfig, resolveHome } from "./config";
import { oneAtATime, requireNoMigration } from "./mate";
import { serialized } from "./serialize";
import { SupervisionStore } from "./supervision-store";
import { SupervisionMigrator, type LegacyDeliveryAdapters } from "./supervision-migrate";
import { workflowStore } from "./workflow-service";
import { SupervisionCommands } from "./supervision-commands";
import { effectLogicalKey, stableId, refuse, SupervisionGateway } from "./supervision-effects";
import { activationEffects, SupervisorSessions } from "./supervisor-sessions";
import { workflowHomeIdentity } from "./workflow-ownership";
import { SupervisionUiReceiver } from "./supervision-ui-receiver";
import type { PaseoApi } from "./host-types";
import { cooperativeReadiness } from "./supervision-cooperative";
import { SupervisionRuntime } from "./supervision-runtime";
import { checkGeneralHeadroom, withScopeAdmission } from "./supervision-headroom";
const UI_CALL: SupervisionActor = { kind: "plugin-ui-unverified", id: "unauthenticated-plugin-call", source: "client UI (unverified)" };

export function proposedSupervisor(scopeId: string) {
  const key = effectLogicalKey({ scopeId, subject: "epoch:1", operation: "agent.create", causation: "scope.activate", objectiveRevision: 0 });
  return stableId("agent", stableId("effect", key));
}
export function activationSnapshot(status: SupervisionStatus, enabled: boolean): ActivationSnapshot {
  return ActivationSnapshotSchema.parse({ enabled, homeId: status.homeId, problems: status.problems,
    audits: status.commands.flatMap(c => c.result.attachmentAudit ? [c.result.attachmentAudit] : []),
    migrations: status.migrations ?? [], dispositions: status.dispositions ?? [],
    plans: status.plans.flatMap(({ scopeId, plan }) => {
      const scope = status.scopes.find(s => s.id === scopeId);
      if (!scope || scope.kind !== "plan") return [];
      const binding = status.bindings.find(b => b.scopeId === scopeId), effects = binding ? activationEffects(status, scopeId, binding.epoch) : null;
      const migrations = (status.migrations ?? []).filter(m => m.scopeId === scopeId);
      const readiness = cooperativeReadiness(status, scopeId);
      const attachment = status.commands.find(c => c.id === effects?.create?.requestId && c.actor.kind === "plugin-ui-unverified" &&
        c.result.attachmentAudit?.supervisor === binding?.agentId && c.result.attachmentAudit?.plan === plan.definition.id);
      const resumeRequestId = enabled && status.freshness === "current" && !status.storage.admissionsHeld && attachment &&
        binding && ["prepared", "active"].includes(binding.state) && effects?.send?.state === "reserved" &&
        [effects.workspace, effects.create].every(e => e && ["reserved", "dispatching", "uncertain", "accepted", "succeeded"].includes(e.state))
        ? attachment.id : null;
      return [{ plan: plan.definition.id, title: plan.definition.title, hash: plan.hash, scopeId, scopeVersion: scope.version,
        supervisorId: binding?.agentId ?? proposedSupervisor(scopeId), binding: binding?.state ?? null, opening: effects?.send?.state ?? null,
        resumeRequestId,
        readiness: { ready: readiness.ready, reasons: readiness.dependencies.flatMap(d => d.reasons) },
        canAttach: enabled && status.freshness === "current" && !status.storage.admissionsHeld && !binding && scope.state === "active" &&
          migrations.some(m => m.state === "committed") && migrations.every(m => ["committed", "aborted"].includes(m.state)) &&
          status.backends.filter(b => b.ownerScopeId === scopeId).every(b => b.backend === "scoped" && b.state === "active") }];
    }),
  });
}
export interface ActivationOptions {
  runtime?: SupervisionRuntime;
  headroom?: { slots: number; reserved: number };
  /** One switch, sampled at plugin start; absent/anything except exactly 1 is off. */
  enabled?: boolean;
  adapters(home: string): LegacyDeliveryAdapters;
  config?: typeof readFirstmateConfig;
  receiver?: (paseo: PaseoApi) => GatewayReceiver;
}
export class SupervisionActivation {
  private readonly runtime: SupervisionRuntime;
  private readonly lock: string;
  private closed = false;
  constructor(private readonly root: string, private readonly options: ActivationOptions) {
    this.runtime = options.runtime ?? new SupervisionRuntime(root); this.lock = `firstmate.activation:${root}`;
  }
  private config() { return (this.options.config ?? readFirstmateConfig)(); }
  async read() {
    const home = resolveHome(await this.config()), id = workflowHomeIdentity(home);
    return activationSnapshot(await this.runtime.read(home), !!this.options.enabled);
  }
  private mutate<T>(homeId: string, run: (home: string, store: SupervisionStore) => Promise<T>, recoverIndex = false) {
    // Same lock order as legacy delivery: lifecycle -> gate/queue/store. Cleanup waits for all writes.
    return oneAtATime(() => serialized(this.lock, async () => {
      if (!this.options.enabled || this.closed) refuse("UNSUPPORTED", "Scoped activation is disabled. No store or session was created.");
      const config = await this.config(); requireNoMigration(config);
      const home = resolveHome(config), id = workflowHomeIdentity(home);
      if (homeId !== id) refuse("STALE", "Home changed. Refresh before acting.");
      return this.runtime.mutate(home, store => run(home, store), recoverIndex);
    }));
  }
  async migrate(input: MigrationCommand) {
    return this.mutate(input.homeId, async (home, store) => {
      const migrator = new SupervisionMigrator({ home, store, legacy: workflowStore(home), adapters: this.options.adapters(home), enabled: true, actor: UI_CALL });
      switch (input.op) {
        case "prepare": await migrator.arm(); await migrator.prepare(input); break;
        case "reconcile": await migrator.reconcile(input.migrationId); break;
        case "barrier": await migrator.barrier(input.migrationId); break;
        case "commit": await migrator.commit(input.migrationId); break;
        case "abort": await store.recoverPublication(); await migrator.abort(input.migrationId, input.reason, UI_CALL); break;
        case "resolve-hold": await migrator.resolveHold(input.migrationId, input.dispositionId, input.route, input.evidence, UI_CALL); break;
        // Deliberate recovery only: validates the complete event+tip, never reconstructs missing history.
        case "resume": await store.recoverPublication(); await migrator.resume(input); break;
      }
      return activationSnapshot(await store.read(), true);
    }, input.op === "resume" || input.op === "abort");
  }
  async attach(input: AttachSupervisorInput | ResumeSupervisorInput, paseo: PaseoApi) {
    return this.mutate(input.homeId, async (home, store) => {
      const receiver = this.options.receiver?.(paseo) ?? new SupervisionUiReceiver(paseo, this.root);
      const commands = new SupervisionCommands(store, home, { enabled: true });
      const gateway = new SupervisionGateway(store, commands, home, receiver, { enabled: true });
      const sessions = new SupervisorSessions(store, gateway, receiver, { enabled: true, unverifiedUiAttach: true,
        limits: { supervisorSessions: 1, supervisorTurns: 1 }, globalMateId: async () => (await this.config()).mateAgentId || null });
      // Explicit app retry can finish an exact pending publication, but never reconstruct lost history.
      await store.recoverPublication();
      if (!("resume" in input)) {
        await withScopeAdmission(input.homeId, async () => {
          if (this.options.headroom && !(await store.read()).commands.some(c => c.id === input.requestId))
            await checkGeneralHeadroom(await store.read(), receiver, this.options.headroom.slots, this.options.headroom.reserved);
          await sessions.attachFromUnverifiedUi({ requestId: input.requestId, scopeId: input.scopeId, scopeVersion: input.scopeVersion,
            planId: input.plan, planHash: input.planHash, supervisorId: input.supervisorId, profile: input.profile, opening: input.opening });
        });
      }
      // Only this accepted request's three supervisor effects. Never launch workers or replay an uncertain send.
      const status = await store.read(), accepted = status.commands.find(c => c.id === input.requestId), audit = accepted?.result.attachmentAudit;
      if (!audit || accepted?.actor.kind !== "plugin-ui-unverified") refuse("HELD", "Attachment audit is missing; nothing is dispatched.");
      const create = status.effects.find(e => e.requestId === input.requestId && e.attemptId === null && e.operation === "agent.create");
      const binding = status.bindings.find(b => b.scopeId === create?.scopeId);
      if (!binding || binding.agentId !== audit.supervisor || binding.epoch !== create?.epoch ||
        !status.plans.some(p => p.scopeId === binding.scopeId && p.plan.definition.id === audit.plan))
        refuse("STALE", "Attachment no longer owns this binding.");
      const effects = activationEffects(status, binding.scopeId, binding.epoch);
      if ([effects.workspace, effects.create, effects.send].some(e => !e || e.requestId !== input.requestId))
        refuse("HELD", "Attachment effects do not match the accepted request.");
      for (const effect of [effects.workspace, effects.create]) {
        if (!effect || effect.requestId !== input.requestId) refuse("HELD", "Attachment effects do not match the accepted request.");
        if (effect.state === "succeeded") continue;
        const next = ["dispatching", "uncertain", "accepted"].includes(effect.state)
          ? await gateway.reconcile(effect.id) : await gateway.dispatch(effect.id);
        if (next.state !== "succeeded") return activationSnapshot(await store.read(), true);
      }
      if (binding.state === "prepared") await sessions.verify(binding.scopeId, binding.epoch);
      if (!effects.send || effects.send.requestId !== input.requestId) refuse("HELD", "Opening is not this attachment's reserved effect.");
      if (effects.send.state === "reserved") await gateway.dispatch(effects.send.id);
      return activationSnapshot(await store.read(), true);
    }, true);
  }
  async stop() {
    await serialized(this.lock, async () => {
      this.closed = true;
      if (!this.options.runtime) await this.runtime.stop();
    });
  }
}
export function registerSupervisionActivation(server: Pick<PluginServerContext, "handle">, activation: SupervisionActivation) {
  server.handle(readSupervisionActivation, () => activation.read());
  server.handle(migrateSupervisionPlan, input => activation.migrate(input));
  // This RPC has no caller identity. UI-only is a convention; do not label its caller captain-ui.
  server.handle(attachSupervisorFromUi, (input, { paseo }) => activation.attach(input, paseo));
}
