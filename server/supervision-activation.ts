/** Default-off production wiring. Views never initialize a store or acquire a coordinator.
 * Attach is an app convention, NOT a verified captain principal. Build B's operating loop is separate. */
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
import { MigrationSnapshots } from "./migration-snapshot";
import { join } from "node:path";
const UI_CALL: SupervisionActor = { kind: "plugin-ui-unverified", id: "unauthenticated-plugin-call", source: "client UI (unverified)" };

export function proposedSupervisor(scopeId: string) {
  const key = effectLogicalKey({ scopeId, subject: "epoch:1", operation: "agent.create", causation: "scope.activate", objectiveRevision: 0 });
  return stableId("agent", stableId("effect", key));
}
export function activationSnapshot(status: SupervisionStatus, enabled: boolean, operator = false): ActivationSnapshot {
  return ActivationSnapshotSchema.parse({ enabled, homeId: status.homeId, problems: status.problems,
    audits: status.commands.flatMap(c => c.result.attachmentAudit ? [c.result.attachmentAudit] : []),
    migrations: status.migrations ?? [], dispositions: status.dispositions ?? [],
    ...(operator ? { operatorEnabled: true, resumeMigrations: (status.migrations ?? []).flatMap(m => {
      const scope = status.scopes.find(s => s.id === m.scopeId);
      return scope?.projectIds.length === 1 ? [{ migrationId: m.id, plan: m.planId, scopeId: m.scopeId, projectId: scope.projectIds[0]!, prerequisites: m.prerequisites }] : [];
    }) } : {}),
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
  snapshots?: MigrationSnapshots;
  requireSnapshots?: boolean;
}
export class SupervisionActivation {
  private readonly runtime: SupervisionRuntime;
  private readonly lock: string;
  private readonly attachLock: string;
  private closed = false;
  constructor(private readonly root: string, private readonly options: ActivationOptions) {
    this.runtime = options.runtime ?? new SupervisionRuntime(root); this.lock = `firstmate.activation:${root}`;
    this.attachLock = `firstmate.supervisor-attach:${root}`;
  }
  private config() { return (this.options.config ?? readFirstmateConfig)(); }
  private async checkedConfig(homeId: string, generalId?: string) {
    if (!this.options.enabled || this.closed) refuse("UNSUPPORTED", "Scoped activation is disabled. No store or session was created.");
    const config = await this.config(); requireNoMigration(config);
    const home = resolveHome(config);
    if (homeId !== workflowHomeIdentity(home) || generalId !== undefined && config.mateAgentId !== generalId)
      refuse("STALE", "Home or General ownership changed. Refresh before acting.");
    return { home, config };
  }
  async read() {
    const home = resolveHome(await this.config()), id = workflowHomeIdentity(home);
    return activationSnapshot(await this.runtime.read(home), !!this.options.enabled, !!this.options.requireSnapshots);
  }
  private mutate<T>(homeId: string, run: (home: string, store: SupervisionStore) => Promise<T>, recoverIndex = false) {
    // Same lock order as legacy delivery: lifecycle -> gate/queue/store. Cleanup waits for all writes.
    return oneAtATime(() => serialized(this.lock, async () => {
      const { home } = await this.checkedConfig(homeId);
      return this.runtime.mutate(home, store => run(home, store), recoverIndex);
    }));
  }
  async migrate(input: MigrationCommand) {
    return this.mutate(input.homeId, async (home, store) => {
      const expected = { homeId: store.homeId, migrationId: input.migrationId,
        planId: "plan" in input ? input.plan : (await store.read()).migrations?.find(m => m.id === input.migrationId)?.planId ?? "" };
      let checked = input;
      if (this.options.requireSnapshots && input.op !== "abort" && input.op !== "resolve-hold") {
        const snapshots = this.options.snapshots;
        if (!snapshots) refuse("HELD", "An approved independent migration snapshot destination and retention are required.");
        if (input.op === "prepare" || input.op === "resume") {
          const saved = (await store.read()).migrations?.find(m => m.id === input.migrationId)?.prerequisites.snapshot;
          const snapshot = saved ?? (input.op === "resume" ? await snapshots.find(expected) : await snapshots.capture(store, workflowStore(home).root, home, input.migrationId, input.plan));
          await snapshots.verify(snapshot, expected);
          checked = { ...input, prerequisites: { ...input.prerequisites, snapshot } };
        } else {
          const snapshot = (await store.read()).migrations?.find(m => m.id === input.migrationId)?.prerequisites.snapshot;
          if (!snapshot) refuse("HELD", "This migration has no verified independent snapshot; inspect and reconcile it before continuing.");
          await snapshots.verify(snapshot, expected);
        }
      }
      const migrator = new SupervisionMigrator({ home, store, legacy: workflowStore(home), adapters: this.options.adapters(home), enabled: true, actor: UI_CALL });
      switch (checked.op) {
        case "prepare": await migrator.arm(); await migrator.prepare(checked); break;
        case "reconcile": await migrator.reconcile(input.migrationId); break;
        case "barrier": await migrator.barrier(input.migrationId); break;
        case "commit": await migrator.commit(input.migrationId); break;
        case "abort": await store.recoverPublication(); await migrator.abort(checked.migrationId, checked.reason, UI_CALL); break;
        case "resolve-hold": await migrator.resolveHold(checked.migrationId, checked.dispositionId, checked.route, checked.evidence, UI_CALL); break;
        // Deliberate recovery only: validates the complete event+tip, never reconstructs missing history.
        case "resume": await store.recoverPublication(); await migrator.resume(checked); break;
      }
      return activationSnapshot(await store.read(), true, !!this.options.requireSnapshots);
    }, input.op === "resume" || input.op === "abort");
  }
  async attach(input: AttachSupervisorInput | ResumeSupervisorInput, paseo: PaseoApi) {
    // Neither this queue nor capacity/receiver IO may be awaited under General's lifecycle lock.
    // Migration retains the legacy lifecycle -> gate ordering; it never waits for this Attach queue.
    return serialized(this.attachLock, async () => {
      const { home, config } = await this.checkedConfig(input.homeId);
      return this.runtime.mutate(home, async store => {
        const checkOwner = async () => { await this.checkedConfig(input.homeId, config.mateAgentId); };
        const receiver = this.options.receiver?.(paseo) ?? new SupervisionUiReceiver(paseo, this.root);
        const commands = new SupervisionCommands(store, home, { enabled: true });
        const gateway = new SupervisionGateway(store, commands, home, receiver, { enabled: true, admissionCheck: checkOwner });
        const sessions = new SupervisorSessions(store, gateway, receiver, { enabled: true, unverifiedUiAttach: true,
          limits: { supervisorSessions: 1, supervisorTurns: 1 }, reserveCheck: checkOwner,
          ...(this.options.requireSnapshots ? { openingContext: (s: SupervisionStatus, scopeId: string) => ({
            guide: join(home, "data", "plan-supervisors.md"), helper: join(home, "tools", "scope.mjs"),
            rules: s.planRules?.filter(r => r.scopeId === scopeId && s.plans.some(p => p.scopeId === scopeId && p.plan.revision === r.revision)),
            instruction: "Read the guide. Retain current rules/evidence; routine repairs stay delegated. Missing report evidence alone does not justify rerunning. Opening counts against the durable continuing-turn cap. Attach provenance is unverified." }) } : {}),
          globalMateId: async () => (await this.checkedConfig(input.homeId, config.mateAgentId)).config.mateAgentId || null });
        // Explicit app retry can finish an exact pending publication, but never reconstruct lost history.
        await store.recoverPublication();
        if (!("resume" in input)) {
          if (this.options.requireSnapshots && !(await store.read()).commands.some(c => c.id === input.requestId)) {
            const migration = (await store.read()).migrations?.find(m => m.scopeId === input.scopeId && m.planId === input.plan && m.state === "committed");
            if (!migration?.prerequisites.snapshot || !this.options.snapshots) refuse("HELD", "This cutover has no verified independent snapshot; reconcile its evidence before a new attachment.");
            await this.options.snapshots.verify(migration.prerequisites.snapshot, { homeId: store.homeId, migrationId: migration.id, planId: migration.planId });
          }
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
          if (next.state !== "succeeded") return activationSnapshot(await store.read(), true, !!this.options.requireSnapshots);
        }
        if (binding.state === "prepared") await sessions.verify(binding.scopeId, binding.epoch);
        if (!effects.send || effects.send.requestId !== input.requestId) refuse("HELD", "Opening is not this attachment's reserved effect.");
        if (effects.send.state === "reserved") await gateway.dispatch(effects.send.id);
        return activationSnapshot(await store.read(), true, !!this.options.requireSnapshots);
      }, true);
    });
  }
  async stop() {
    await serialized(this.lock, async () => { this.closed = true; });
    // Drain independently so a migration never acquires General's lock then waits for native Attach IO.
    await serialized(this.attachLock, async () => {
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
