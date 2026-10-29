import { featurePause } from "../shared/feature-settings";
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
import { migrationUuid, SupervisionMigrator, type LegacyDeliveryAdapters } from "./supervision-migrate";
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
import { readMigrationSettings, setMigrationSettings } from "../shared/migration-settings";
import { readPlanHelp, readHandoverEvidence, evidenceReferences, type PlanHelpReview, type HandoverEvidenceInputSchema } from "../shared/plan-help";
import type { z } from "zod";
import { MigrationSettings } from "./migration-settings";
import { digest } from "./submissions";
import { checkPolicySource, policyRef, sameVector } from "./supervision-policy";
import { planFinished, planOwner } from "../shared/workflow-plans";
import { planBudgetUsed } from "../shared/workflow-plan-summary";
import { PlanHelpPreparations } from "./plan-help-preparations";
import { handoverEvidence } from "./plan-help-evidence";
import { workflowHomeId } from "./workflow-board";
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
  /** Standalone/test compatibility. Production reads the home's live feature policy. */
  enabled?: boolean;
  adapters(home: string): LegacyDeliveryAdapters;
  config?: typeof readFirstmateConfig;
  receiver?: (paseo: PaseoApi) => GatewayReceiver;
  snapshots?: MigrationSnapshots;
  backupSettings?: MigrationSettings;
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
  private async snapshotRequired(home: string) { return !!this.options.backupSettings || !!this.options.requireSnapshots || !!(await this.runtime.features?.read(home))?.effective.planSupervisors; }
  private snapshots(home: string) { return this.options.backupSettings?.service(home) ?? Promise.resolve(this.options.snapshots); }
  private preparations() { return new PlanHelpPreparations(this.root); }
  async readBackup(homeId: string, workflowId?: string) {
    const home = resolveHome(await this.config());
    if (homeId !== workflowHomeIdentity(home) || workflowId !== undefined && workflowId !== workflowHomeId(home)) refuse("STALE", "FirstMate's home changed. Reopen this review.");
    if (!this.options.backupSettings) refuse("UNSUPPORTED", "Backup setup isn't available in this build.");
    return this.options.backupSettings.read(home);
  }
  async saveBackup(input: Parameters<MigrationSettings["set"]>[1]) {
    return serialized(this.lock, async () => {
      const { home } = await this.checkedConfig(input.homeId);
      if (!this.options.backupSettings) refuse("UNSUPPORTED", "Backup setup isn't available in this build.");
      return this.options.backupSettings.set(home, input);
    });
  }
  async planHelp(homeId: string, planId: string, workflowId?: string): Promise<PlanHelpReview> {
    const config = await this.config(), home = resolveHome(config);
    if (workflowHomeIdentity(home) !== homeId || workflowId !== undefined && workflowId !== workflowHomeId(home)) refuse("STALE", "FirstMate's home changed. Reopen this review.");
    const legacy = await workflowStore(home).read(), status = await this.runtime.read(home);
    const scoped = status.plans.find(p => p.plan.definition.id === planId && status.backends.some(b => b.planId === planId && b.ownerScopeId === p.scopeId && b.backend === "scoped" && b.state === "active"));
    const plan = scoped?.plan ?? legacy.plans.find(p => p.definition.id === planId);
    if (!plan) refuse("HELD", "This plan couldn't be checked. Refresh Plans before reviewing help.");
    const problems: string[] = [];
    if (config.migration || config.mateLaunch || !config.mateAgentId) problems.push("Finish FirstMate's current setup before reviewing a plan handover.");
    const policy = await this.runtime.features?.read(home);
    if (!(policy?.effective.scopedActivation ?? this.options.enabled)) problems.push("Plan handover is off. Open FirstMate settings, review Plan help, and save your choice.");
    if (policy && !policy.effective.planSupervisors) problems.push("Ongoing plan help is off. Review Plan help in FirstMate settings before handing over a plan.");
    if (legacy.problems.length || status.problems.length) problems.push("Some saved work couldn't be checked. Review Advanced work details before handing over this plan.");
    if (planFinished(plan) || plan.status === "abandoned") problems.push("This plan has finished. Its history stays with its recorded owner.");
    const names = [...new Set(plan.definition.nodes.flatMap(n => n.kind === "run" ? [n.launch.project.trim().toLowerCase()] : []))];
    const projects = status.projects?.projects.filter(p => p.state === "admitted" && [p.name, ...p.aliases].some(n => names.includes(n.trim().toLowerCase()))) ?? [];
    const project = names.length === 1 && projects.length === 1 ? projects[0] : null;
    if (!project) problems.push("This plan needs one checked project setup. Review its project in FirstMate settings first; projects with different owners need a separate review.");
    if (project && plan.definition.nodes.some(n => n.kind === "run" && n.launch.host.trim().toLowerCase() !== (project.owner?.hostId ?? "local").trim().toLowerCase()))
      problems.push("This plan's host doesn't match its checked project setup. Review the project's original host before handing over this plan.");
    const sources = project ? status.policySources.filter(s => project.sourceVector.some(ref => sameVector([ref], [policyRef("policy-source", s)])) && !status.policySources.some(next => next.supersedes.includes(s.id))) : [];
    if (!sources.length || project && sources.length !== project.sourceVector.length) problems.push("The project's permission evidence is missing. Review its original permission sources before continuing.");
    for (const source of sources) try { await checkPolicySource(home, source); } catch { problems.push(`Permission evidence changed or is unavailable: ${source.path}. Review that source before continuing.`); }
    const decisions = await this.options.adapters(home).decisions();
    if (!decisions || decisions.freshness.status !== "fresh" || !decisions.homeId || decisions.quarantined?.length)
      problems.push("Decisions haven't all been checked. Refresh Needs you and resolve any unchecked work before handing over this plan.");
    const migration = status.migrations?.find(m => m.planId === planId), scopeId = migration?.scopeId ?? migrationUuid(homeId, planId, "plan-help-scope");
    const preparation = await this.preparations().read(home, planId);
    const freeze = await workflowStore(home).cutover(planId).catch(() => "damaged");
    if (freeze && !migration && !preparation) problems.push("A saved handover needs recovery. Use its original preparation in Advanced work details; don't start a second handover.");
    const backup = this.options.backupSettings ? await this.options.backupSettings.read(home) : null;
    if (!backup?.backup || backup.problems.length) problems.push(...(backup?.problems.length ? backup.problems : ["Choose a separate backup folder and how long to keep its files below."]));
    const binding = status.bindings.find(b => b.scopeId === scopeId);
    const backend = status.backends.find(b => b.planId === planId && b.backend === "scoped");
    const opening = binding ? activationEffects(status, scopeId, binding.epoch).send?.state : null;
    const body = { homeId, plan: planId, title: plan.definition.title, planHash: plan.hash,
      currentOwner: binding ? binding.state === "active" && opening === "succeeded" ? "Dedicated plan helper" : "Saved plan helper; setup needs checking" :
        backend?.state === "active" ? "Handover complete; waiting for the captain to attach a helper" : planOwner(plan) === "firstmate" ? "FirstMate" : "Captain",
      projectId: project?.id ?? null, scopeId, migrationId: migration?.id ?? (freeze && preparation ? preparation.migrationId :
        migrationUuid(homeId, planId, "plan-help-handover", preparation?.migrationId ?? "first-review", digest({ plan: plan.hash, sources, project, backupRevision: backup?.revision ?? 0, effective: policy?.effective ?? null }))),
      supervisorId: binding?.agentId ?? proposedSupervisor(scopeId), budget: plan.definition.budget, spent: planBudgetUsed(plan),
      problems, sourcePaths: sources.map(s => s.path), backupRevision: backup?.revision ?? 0 };
    return { ...body, preparation, canCorrectPreparation: !freeze && !migration,
      reviewHash: digest({ ...body, problems: [], sources, project, effective: policy?.effective ?? null }) };
  }
  async evidence(input: z.infer<typeof HandoverEvidenceInputSchema>) {
    const review = await this.planHelp(input.homeId, input.plan, input.workflowHomeId), home = resolveHome(await this.config());
    if (workflowHomeIdentity(home) !== input.homeId) refuse("STALE", "FirstMate's home changed. Reopen this review.");
    return handoverEvidence(this.root, home, review, await this.runtime.read(home), this.options.adapters(home), input.folder, input.rollbackPath);
  }
  private config() { return (this.options.config ?? readFirstmateConfig)(); }
  private async checkedConfig(homeId: string, generalId?: string, settlement = false) {
    if ((!this.options.enabled && !this.runtime.features) || this.closed) refuse("UNSUPPORTED", "Scoped activation is disabled. No store or session was created.");
    const config = await this.config(); requireNoMigration(config);
    const home = resolveHome(config);
    if (homeId !== workflowHomeIdentity(home) || generalId !== undefined && config.mateAgentId !== generalId)
      refuse("STALE", "Home or General ownership changed. Refresh before acting.");
    if (!settlement) await this.runtime.features?.check(home, "scopedActivation");
    else if (this.runtime.features && !(await this.runtime.features.read(home)).effective.scopedActivation &&
      (await this.runtime.read(home)).freshness === "uninitialized") refuse("UNSUPPORTED", "There is no saved work to check for this paused help.");
    return { home, config };
  }
  async read() {
    const home = resolveHome(await this.config()), id = workflowHomeIdentity(home);
    const status = await this.runtime.read(home), policy = await this.runtime.features?.read(home);
    return { ...activationSnapshot(status, policy?.effective.scopedActivation ?? !!this.options.enabled, await this.snapshotRequired(home)),
      pause: policy ? featurePause(status, policy.effective, "plan") : null };
  }
  private mutate<T>(homeId: string, run: (home: string, store: SupervisionStore) => Promise<T>, recoverIndex = false, settlement = false) {
    // Same lock order as legacy delivery: lifecycle -> gate/queue/store. Cleanup waits for all writes.
    return oneAtATime(() => serialized(this.lock, async () => {
      const { home } = await this.checkedConfig(homeId, undefined, settlement);
      return this.runtime.mutate(home, store => {
        const commit = async () => { await this.checkedConfig(homeId, undefined, settlement); return run(home, store); };
        return !settlement && this.runtime.features ? this.runtime.features.boundary(home, commit) : commit();
      }, recoverIndex);
    }));
  }
  async migrate(input: MigrationCommand) {
    return this.mutate(input.homeId, async (home, store) => {
      if ((input.op === "prepare" || input.op === "resume") && input.reviewHash) {
        const original = await this.preparations().read(home, input.plan);
        const frozen = await workflowStore(home).cutover(input.plan);
        const accepted = (await store.read()).migrations?.some(m => m.planId === input.plan);
        if (original && (frozen || accepted) && digest({ ...original, op: "prepare" }) !== digest({ ...input, op: "prepare" }))
          refuse("CONFLICT", "This handover already paused its previous owner. Resume its exact saved review; its inputs cannot be replaced.");
      }
      if ((input.op === "prepare" || input.op === "resume") && input.reviewHash && !(await store.read()).migrations?.some(m => m.id === input.migrationId)) {
        const review = await this.planHelp(input.homeId, input.plan);
        if (review.problems.length) refuse("HELD", review.problems.join(" "));
        if (review.reviewHash !== input.reviewHash || review.scopeId !== input.scopeId || review.projectId !== input.projectId || review.migrationId !== input.migrationId)
          refuse("STALE", "The plan, permissions or backup settings changed. Refresh and review plan help again.");
        if (input.evidence) {
          const evidence = await handoverEvidence(this.root, home, review, await store.read(), this.options.adapters(home), "data", input.evidence.rollback.path);
          if (evidence.problems.length || !evidence.inventory || evidence.inventory.problems.length || !evidence.policy || !evidence.rollback)
            refuse("HELD", [...evidence.problems, ...(evidence.inventory?.problems ?? [])].join(" ") || "Choose and review the missing handover evidence before continuing.");
          const checkedEvidence = { inventory: evidence.inventory.hash, policy: evidence.policy.hash, rollback: { path: evidence.rollback.path, hash: evidence.rollback.hash } };
          if (digest(checkedEvidence) !== digest(input.evidence) || digest(evidenceReferences(checkedEvidence)) !== digest(input.prerequisites))
            refuse("STALE", "Handover evidence changed. Check pending deliveries, permissions and the selected rollback report again.");
        }
        const original = await this.preparations().read(home, input.plan);
        if (original && digest({ ...original, op: "prepare" }) !== digest({ ...input, op: "prepare" }) &&
          (input.op !== "prepare" || !review.canCorrectPreparation)) refuse("CONFLICT", "Resume this handover's exact saved review.");
        await this.preparations().save(home, input);
      }
      const expected = { homeId: store.homeId, migrationId: input.migrationId,
        planId: "plan" in input ? input.plan : (await store.read()).migrations?.find(m => m.id === input.migrationId)?.planId ?? "" };
      let checked = input;
      if ((await this.snapshotRequired(home)) && input.op !== "abort" && input.op !== "resolve-hold") {
        const snapshots = await this.snapshots(home);
        if (!snapshots) refuse("HELD", "An approved independent migration snapshot destination and retention are required.");
        if (input.op === "prepare" || input.op === "resume") {
          const saved = (await store.read()).migrations?.find(m => m.id === input.migrationId)?.prerequisites.snapshot;
          const snapshot = saved ?? (input.op === "resume" ? await snapshots.find(expected) : await snapshots.capture(store, workflowStore(home).root, home, input.migrationId, input.plan, input.evidence?.rollback));
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
      return activationSnapshot(await store.read(), true, await this.snapshotRequired(home));
    }, input.op === "resume" || input.op === "abort", ["abort", "reconcile", "resolve-hold"].includes(input.op));
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
        const gateway = new SupervisionGateway(store, commands, home, receiver, { enabled: true, policyFence: this.runtime.features?.gateway(home, "scopedActivation", () => store.read()), admissionCheck: async (status, effect) => {
          await checkOwner();
          const capacity = await this.runtime.features?.capacity(home);
          if (capacity) await checkGeneralHeadroom(status, receiver, capacity.slots, capacity.generalHeadroom, effect.id);
        } });
        const sessions = new SupervisorSessions(store, gateway, receiver, { enabled: true,
        featurePolicy: async () => this.runtime.features?.reservation(home, "scopedActivation"),
        reserveBoundary: run => this.runtime.features ? this.runtime.features.boundary(home, run) : run(), unverifiedUiAttach: true,
          limits: { supervisorSessions: 1, supervisorTurns: 1 }, reserveCheck: checkOwner,
          ...((await this.snapshotRequired(home)) ? { openingContext: (s: SupervisionStatus, scopeId: string) => ({
            guide: join(home, "data", "plan-supervisors.md"), helper: join(home, "tools", "scope.mjs"),
            rules: s.planRules?.filter(r => r.scopeId === scopeId && s.plans.some(p => p.scopeId === scopeId && p.plan.revision === r.revision)),
            instruction: "Read the guide. Retain current rules/evidence; routine repairs stay delegated. Missing report evidence alone does not justify rerunning. Opening counts against the durable continuing-turn cap. Attach provenance is unverified." }) } : {}),
          globalMateId: async () => (await this.checkedConfig(input.homeId, config.mateAgentId)).config.mateAgentId || null });
        // Explicit app retry can finish an exact pending publication, but never reconstruct lost history.
        await store.recoverPublication();
        if (!("resume" in input)) {
          if ((await this.snapshotRequired(home)) && !(await store.read()).commands.some(c => c.id === input.requestId)) {
            const migration = (await store.read()).migrations?.find(m => m.scopeId === input.scopeId && m.planId === input.plan && m.state === "committed");
            const snapshots = await this.snapshots(home);
            if (!migration?.prerequisites.snapshot || !snapshots) refuse("HELD", "This cutover has no verified independent snapshot; reconcile its evidence before a new attachment.");
            await snapshots.verify(migration.prerequisites.snapshot, { homeId: store.homeId, migrationId: migration.id, planId: migration.planId });
          }
          await withScopeAdmission(input.homeId, async () => {
            const capacity = await this.runtime.features?.capacity(home);
            if ((capacity || this.options.headroom) && !(await store.read()).commands.some(c => c.id === input.requestId))
              await checkGeneralHeadroom(await store.read(), receiver, capacity?.slots ?? this.options.headroom!.slots, capacity?.generalHeadroom ?? this.options.headroom!.reserved);
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
          if (next.state !== "succeeded") return activationSnapshot(await store.read(), true, await this.snapshotRequired(home));
        }
        if (binding.state === "prepared") await sessions.verify(binding.scopeId, binding.epoch);
        if (!effects.send || effects.send.requestId !== input.requestId) refuse("HELD", "Opening is not this attachment's reserved effect.");
        if (effects.send.state === "reserved") await gateway.dispatch(effects.send.id);
        return activationSnapshot(await store.read(), true, await this.snapshotRequired(home));
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
  server.handle(readHandoverEvidence, input => activation.evidence(input));
  server.handle(readMigrationSettings, input => activation.readBackup(input.homeId, input.workflowHomeId));
  server.handle(setMigrationSettings, input => activation.saveBackup(input));
  server.handle(readPlanHelp, input => activation.planHelp(input.homeId, input.plan, input.workflowHomeId));
  server.handle(readSupervisionActivation, () => activation.read());
  server.handle(migrateSupervisionPlan, input => activation.migrate(input));
  // This RPC has no caller identity. UI-only is a convention; do not label its caller captain-ui.
  server.handle(attachSupervisorFromUi, (input, { paseo }) => activation.attach(input, paseo));
}
