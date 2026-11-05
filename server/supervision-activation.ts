import { supervisorWorkspace } from "./supervisor-workspace";
import { readSupervisorControls, actSupervisorControls, readSupervisorList, type SupervisorControlInput, type SupervisorList } from "../shared/supervisor-controls";
import { supervisorList, supervisorView } from "./supervisor-configuration";
import { SupervisorControls } from "./supervisor-controls";
import { supervisorCatalog, checkedSupervisorCatalog } from "./supervisor-catalog";
import { supervisorWorkspaceIntent } from "./supervision-effects";
import { planSupervisorLimits } from "../shared/plan-supervisor-limits";
import { checkPlanSupervisorAuthority } from "./plan-supervisor-authority";
import type { GatewayLimits } from "../shared/supervision-effects";
import type { SupervisorConfiguration } from "../shared/supervisor-profile";
import { featurePause } from "../shared/feature-settings";
/** Default-off production wiring. Views never initialize a store or acquire a coordinator.
 * Attach is an app convention or the current first mate's supervise-tool role convention, never a verified principal. */
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { GatewayReceiver } from "../shared/supervision-effects";
import { ActivationSnapshotSchema, readSupervisionActivation, migrateSupervisionPlan, attachSupervisorFromUi,
  type ActivationSnapshot, type MigrationCommand, type AttachSupervisorInput, type ResumeSupervisorInput } from "../shared/supervision-activation";
import { isSuperviseMateActor, isSuperviseOriginActor, superviseReplayEquivalent, type SupervisionStatus, type SupervisionActor } from "../shared/supervision";
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
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { SETTLING_PROBLEM } from "./needs-you-service";
import { PlanHelpPreparations } from "./plan-help-preparations";
import { handoverEvidence } from "./plan-help-evidence";
import { workflowHomeId } from "./workflow-board";
import { TEMPLATES } from "./templates";
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
      const attachment = status.commands.find(c => c.id === effects?.create?.requestId && isSuperviseOriginActor(c.actor) &&
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
  async saveBackup(input: Parameters<MigrationSettings["set"]>[1], provenance?: Parameters<MigrationSettings["set"]>[2], actorId?: string) {
    return serialized(this.lock, async () => {
      const { home } = await this.checkedConfig(input.homeId, actorId);
      if (!this.options.backupSettings) refuse("UNSUPPORTED", "Backup setup isn't available in this build.");
      return this.options.backupSettings.set(home, input, provenance);
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
    if (legacy.problems.length || status.problems.length) problems.push("Some saved work couldn't be checked. Review Supervisors before handing over this plan.");
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
    problems.push(...decisionProblems(await this.options.adapters(home).decisions(),
      [...plan.definition.nodes, ...(plan.removed ?? []).map(r => r.node)].flatMap(n => n.kind === "run" ? [n.id] : [])));
    const migration = status.migrations?.find(m => m.planId === planId), scopeId = migration?.scopeId ?? migrationUuid(homeId, planId, "plan-help-scope");
    const preparation = await this.preparations().read(home, planId);
    const freeze = await workflowStore(home).cutover(planId).catch(() => "damaged");
    if (freeze && !migration && !preparation) problems.push("A saved handover needs recovery. Use its original preparation in Supervisors; don't start a second handover.");
    const backup = this.options.backupSettings ? await this.options.backupSettings.read(home) : null;
    if (!backup?.backup || backup.problems.length) problems.push(...(backup?.problems.length ? backup.problems : ["Choose a separate backup folder and how long to keep its files below."]));
    const binding = status.bindings.find(b => b.scopeId === scopeId);
    const backend = status.backends.find(b => b.planId === planId && b.backend === "scoped");
    const opening = binding ? activationEffects(status, scopeId, binding.epoch).send?.state : null;
    const body = { homeId, plan: planId, title: plan.definition.title, planHash: plan.hash,
      currentOwner: binding ? binding.state === "active" && opening === "succeeded" ? "Dedicated plan helper" : "Saved plan helper; setup needs checking" :
        backend?.state === "active" ? "Handover complete; waiting for a helper to be attached" : planOwner(plan) === "firstmate" ? "FirstMate" : "Captain",
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
  private mutate<T>(homeId: string, run: (home: string, store: SupervisionStore) => Promise<T>, recoverIndex = false, settlement = false, generalId?: string) {
    // Same lock order as legacy delivery: lifecycle -> gate/queue/store. Cleanup waits for all writes.
    // A first-mate actor is re-checked by id at every inner boundary, so a restart mid-mutation refuses.
    return oneAtATime(() => serialized(this.lock, async () => {
      const { home } = await this.checkedConfig(homeId, generalId, settlement);
      return this.runtime.mutate(home, store => {
        const commit = async () => { await this.checkedConfig(homeId, generalId, settlement); return run(home, store); };
        return !settlement && this.runtime.features ? this.runtime.features.boundary(home, commit) : commit();
      }, recoverIndex);
    }));
  }
  async migrate(input: MigrationCommand, actor: SupervisionActor = UI_CALL) {
    if (actor.kind === "mate-chat") await this.checkedConfig(input.homeId, actor.id);
    else if (digest(actor) !== digest(UI_CALL)) refuse("UNKNOWN_OWNER", "Handover is recorded by the captain's app controls or the current first mate.");
    return this.mutate(input.homeId, async (home, store) => {
      if (actor.kind === "mate-chat" && (input.op === "prepare" || input.op === "resume")) {
        const recorded = (await store.read()).migrations?.some(m => m.id === input.migrationId);
        if ((!input.reviewHash || !input.evidence) && (input.op === "prepare" || !recorded))
          refuse("HELD", "First-mate handover preparation requires the reviewed plan-help hash and its checked evidence. Read plan-help and evidence first, then prepare with both; a bare prepare is refused.");
      }
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
          // No folder listing: it only feeds the picker, and a busy data/ holds far more than its 200-entry cap.
          const evidence = await handoverEvidence(this.root, home, review, await store.read(), this.options.adapters(home), null, input.evidence.rollback.path);
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
      const migrator = new SupervisionMigrator({ home, store, legacy: workflowStore(home), adapters: this.options.adapters(home), enabled: true, actor });
      switch (checked.op) {
        case "prepare": await migrator.arm(); await migrator.prepare(checked); break;
        case "reconcile": await migrator.reconcile(input.migrationId); break;
        case "barrier": await migrator.barrier(input.migrationId); break;
        case "commit": await migrator.commit(input.migrationId); break;
        case "abort": await store.recoverPublication(); await migrator.abort(checked.migrationId, checked.reason, actor); break;
        case "resolve-hold": await migrator.resolveHold(checked.migrationId, checked.dispositionId, checked.route, checked.evidence, actor); break;
        // Deliberate recovery only: validates the complete event+tip, never reconstructs missing history.
        case "resume": await store.recoverPublication(); await migrator.resume(checked); break;
      }
      return activationSnapshot(await store.read(), true, await this.snapshotRequired(home));
    }, input.op === "resume" || input.op === "abort", ["abort", "reconcile", "resolve-hold"].includes(input.op), actor.kind === "mate-chat" ? actor.id : undefined);
  }
  async attach(input: AttachSupervisorInput | ResumeSupervisorInput, paseo: PaseoApi, actor: SupervisionActor = UI_CALL) {
    const fromMate = actor.kind === "mate-chat";
    if (!fromMate && digest(actor) !== digest(UI_CALL)) refuse("UNKNOWN_OWNER", "Attach is recorded by the captain's app button or the current first mate.");
    // Neither this queue nor capacity/receiver IO may be awaited under General's lifecycle lock.
    // Migration retains the legacy lifecycle -> gate ordering; it never waits for this Attach queue.
    return serialized(this.attachLock, async () => {
      const { home, config } = await this.checkedConfig(input.homeId, fromMate ? actor.id : undefined);
      return this.runtime.mutate(home, async store => {
        const checkOwner = async () => { await this.checkedConfig(input.homeId, config.mateAgentId); };
        const receiver = this.options.receiver?.(paseo) ?? new SupervisionUiReceiver(paseo, this.root);
        const commands = new SupervisionCommands(store, home, { enabled: true });
        const gateway = new SupervisionGateway(store, commands, home, receiver, { enabled: true, policyFence: this.runtime.features?.gateway(home, "scopedActivation", () => store.read()), admissionCheck: async (status, effect) => {
          await checkOwner();
          const capacity = await this.runtime.features?.capacity(home);
          if (capacity) await checkGeneralHeadroom(status, receiver, capacity.slots, capacity.generalHeadroom, effect.id);
        } });
        let configuration: SupervisorConfiguration | undefined;
        const prior = (await store.read()).commands.find(c => c.id === input.requestId);
        if (!("resume" in input) && !prior) {
          const intent = supervisorWorkspaceIntent(input.scopeId, 1, stableId("effect", effectLogicalKey({ scopeId: input.scopeId, subject: "epoch:1", operation: "workspace.open", causation: "scope.activate", objectiveRevision: 0 })));
          const catalog = await checkedSupervisorCatalog(paseo, join(this.root, "supervisor-workspaces", intent.key), input.profile);
          const policy = await this.runtime.features?.read(home);
          configuration = { id: input.requestId, scopeId: input.scopeId, generation: 1, workspace: supervisorWorkspace(this.root, input.scopeId, 1), requested: input.profile, resolved: input.profile,
            catalogDigest: digest(catalog), policyDigest: digest(policy ?? { enabled: true }),
            target: { homeId: input.homeId, hostId: "local", scopeId: input.scopeId, kind: "plan", planId: input.plan, planHash: input.planHash },
            limits: this.controlsLimits(await store.read(), input.scopeId) ?? { supervisorSessions: 1, supervisorTurns: 1 }, effectiveEpoch: 1, provenance: fromMate ? "first mate tool (unverified)" as const : "client UI (unverified)" as const };
        }
        const priorMate = prior ? isSuperviseMateActor(prior.actor) : false;
        const sessions = new SupervisorSessions(store, gateway, receiver, { enabled: true, ...(configuration ? { configuration } : {}),
        featurePolicy: async () => this.runtime.features?.reservation(home, "scopedActivation"),
        reserveBoundary: run => this.runtime.features ? this.runtime.features.boundary(home, run) : run(), unverifiedUiAttach: true, mateAttach: fromMate || priorMate,
          limits: { supervisorSessions: 1, supervisorTurns: 1 }, reserveCheck: checkOwner,
          ...((await this.snapshotRequired(home)) ? { openingContext: (s: SupervisionStatus, scopeId: string) => ({
            guide: join(home, TEMPLATES.scopeGuide), helper: join(home, "tools", "scope.mjs"),
            rules: s.planRules?.filter(r => r.scopeId === scopeId && s.plans.some(p => p.scopeId === scopeId && p.plan.revision === r.revision)),
            instruction: `Read the guide. Retain current rules/evidence; routine repairs stay delegated. Missing report evidence alone does not justify rerunning. Opening counts against the durable continuing-turn cap. Attached by ${fromMate ? "the current first mate through its supervise tool" : "the captain's app button"}; provenance is unverified.` }) } : {}),
          globalMateId: async () => (await this.checkedConfig(input.homeId, config.mateAgentId)).config.mateAgentId || null });
        // Explicit app retry can finish an exact pending publication, but never reconstruct lost history.
        await store.recoverPublication();
        if (prior && digest(prior.actor) !== digest(actor)) {
          // Taking over another supervise origin's recorded request (a replaced first mate's, by the
          // successor or the captain) is itself recorded before anything is dispatched for it.
          if (!isSuperviseMateActor(prior.actor)) refuse("HELD", "This attachment was started from the app; resume it there. Nothing is dispatched.");
          await store.transactCommand(stableId("supervise-takeover", input.requestId, digest(actor)),
            digest({ superviseTakeover: { requestId: input.requestId, from: prior.actor, to: actor } }), actor,
            async () => ({ mutations: [], expectedVersions: [], result: { planId: null, planHash: null, decisionId: null, outboxId: null } }));
        }
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
            const reserved = { requestId: input.requestId, scopeId: input.scopeId, scopeVersion: input.scopeVersion,
              planId: input.plan, planHash: input.planHash, supervisorId: input.supervisorId, profile: input.profile, opening: input.opening };
            // Replay identity includes the recorded origin's seam: a takeover replays through it, under its actor.
            if (priorMate) await sessions.attachFromMate(reserved, prior!.actor);
            else if (prior) await sessions.attachFromUnverifiedUi(reserved);
            else if (fromMate) await sessions.attachFromMate(reserved, actor);
            else await sessions.attachFromUnverifiedUi(reserved);
          });
        }
        // Only this accepted request's three supervisor effects. Never launch workers or replay an uncertain send.
        const status = await store.read(), accepted = status.commands.find(c => c.id === input.requestId), audit = accepted?.result.attachmentAudit;
        if (!audit || !accepted || !superviseReplayEquivalent(accepted.actor, actor)) refuse("HELD", "Attachment audit is missing; nothing is dispatched.");
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
  /** The Supervisors list: stored truth for every scope kind, with no native or catalog read. */
  async listSupervisors(): Promise<SupervisorList> {
    const home = resolveHome(await this.config()), status = await this.runtime.read(home);
    return { homeId: workflowHomeIdentity(home), rows: supervisorList(status, scopeId => this.controlsLimits(status, scopeId)), problems: status.problems };
  }
  private controlsLimits(status: SupervisionStatus, scopeId: string): GatewayLimits | null {
    const scope = status.scopes.find(s => s.id === scopeId);
    if (scope?.kind === "plan") { const c = planSupervisorLimits(status, scopeId).limits; return c ? { supervisorSessions: c.sessions, supervisorTurns: c.turns } : { supervisorSessions: 1, supervisorTurns: 1 }; }
    if (scope?.kind === "project") return status.projects?.projects.find(p => p.scopeId === scopeId)?.owner?.limits ?? null;
    return status.commands.find(c => c.result.maintenanceAdmission?.scopeId === scopeId)?.result.maintenanceAdmission?.limits ?? null;
  }
  private async controlsContext(homeId: string, scopeId: string) {
    const config = await this.config(), home = resolveHome(config);
    if (this.closed || workflowHomeIdentity(home) !== homeId || !config.mateAgentId || config.migration || config.mateLaunch) refuse("STALE", "Home or FirstMate changed; reopen Supervisor controls.");
    const status = await this.runtime.read(home), scope = status.scopes.find(s => s.id === scopeId);
    if (!scope || !["plan", "project", "maintenance"].includes(scope.kind)) refuse("UNKNOWN_OWNER", "One exact local Supervisor scope is required.");
    const capability = scope.kind === "project" ? "projectMates" as const : scope.kind === "maintenance" ? "maintenance" as const : "scopedActivation" as const;
    const policy = await this.runtime.features?.read(home);
    return { config, home, status, scope, capability, policyDigest: digest(policy ?? { enabled: !!this.options.enabled }), enabled: policy?.effective[capability] ?? !!this.options.enabled };
  }
  async readControls(input: { homeId: string; scopeId: string }, paseo: PaseoApi) {
    const c = await this.controlsContext(input.homeId, input.scopeId), view = supervisorView(c.status, input.scopeId), problems = [...c.status.problems];
    const receiver = this.options.receiver?.(paseo) ?? new SupervisionUiReceiver(paseo, this.root);
    let catalog: Awaited<ReturnType<typeof supervisorCatalog>> = [];
    try {
      const observed = view.binding && await receiver.findAgent(view.binding.agentId);
      if (!observed || observed.id !== view.binding?.agentId) throw Error("The exact native Supervisor is unavailable. Reconnect its host before reviewing configuration.");
      const expected = view.configurations.find(g => g.id === view.binding?.configurationId)?.resolved ?? view.binding?.profileReadback;
      if (expected && (observed.provider !== expected.provider || observed.modeId !== (expected.modeId || null) || observed.thinkingOptionId !== (expected.thinkingOptionId || null)))
        problems.push("Native profile drift: the exact Supervisor differs from its recorded model, permissions or reasoning. Restore its recorded profile or inspect a checked replacement; no setting was adopted.");
      catalog = await supervisorCatalog(paseo, supervisorWorkspace(this.root, input.scopeId, (view.binding?.epoch ?? 0) + 1).directory);
    } catch (e) { problems.push(e instanceof Error ? e.message : "The exact host catalog is unavailable."); }
    if (!c.enabled) problems.push("This responsibility is paused in Help settings. Inspect retained work before resuming.");
    const reader = new SupervisionStore(this.root, c.home);
    const reservedOwnerInputs = await Promise.all(view.reservedOwnerInputs.map(async input => {
      try { const text = Buffer.from(await reader.readBlob(input.payloadDigest)).toString("utf8");
        return { ...input, preview: text.slice(0, 16000), truncated: text.length > 16000 };
      } catch { return { ...input, preview: null, truncated: false }; }
    }));
    const plan = c.status.plans.find(p => p.scopeId === input.scopeId)?.plan;
    return { homeId: input.homeId, scopeId: input.scopeId, title: plan?.definition.title ?? c.status.projects?.projects.find(p => p.scopeId === input.scopeId)?.name ?? c.scope.kind,
      kind: c.scope.kind as "plan" | "project" | "maintenance", planHash: plan?.hash ?? null,
      view: { ...view, reservedOwnerInputs }, catalog, problems, policyDigest: c.policyDigest, limits: this.controlsLimits(c.status, input.scopeId) };
  }
  async control(input: SupervisorControlInput, paseo: PaseoApi) {
    await serialized(`${this.attachLock}:${input.scopeId}`, async () => {
      const c = await this.controlsContext(input.homeId, input.scopeId);
      if (!c.enabled) refuse("UNSUPPORTED", "This Supervisor responsibility is disabled.");
      await this.runtime.mutate(c.home, async store => {
        const receiver = this.options.receiver?.(paseo) ?? new SupervisionUiReceiver(paseo, this.root, { projectMates: true, maintenanceMates: true });
        const validate = async (status: SupervisionStatus, scopeId: string) => {
          const current = await this.controlsContext(input.homeId, scopeId);
          if (current.config.mateAgentId !== c.config.mateAgentId || current.policyDigest !== c.policyDigest || !current.enabled) refuse("STALE", "General or effective policy changed.");
          await this.runtime.features?.check(c.home, c.capability);
          if (c.scope.kind === "plan" && this.runtime.features) await checkPlanSupervisorAuthority(c.home, status, scopeId);
          const project = status.projects?.projects.find(p => p.scopeId === scopeId);
          if (project && project.state !== "admitted") refuse("HELD", "This project is stopped or held.");
          for (const ref of project?.sourceVector ?? []) {
            const source = status.policySources.find(s => s.id === ref.id);
            if (!source || digest(policyRef("policy-source", source)) !== digest(ref) || status.policySources.some(s => s.supersedes.includes(ref.id))) refuse("STALE", "Reviewed project sources changed.");
            await checkPolicySource(c.home, source);
          }
        };
        const limitsFor = (s: SupervisionStatus, id: string) => this.controlsLimits(s, id) ?? refuse("HELD", "Reviewed cumulative caps are unavailable.");
        const commands = new SupervisionCommands(store, c.home, { enabled: true });
        const occupancy = (s: SupervisionStatus) => digest({ bindings: s.bindings, attempts: s.attempts,
          effects: s.effects.filter(e => ["reserved", "dispatching", "accepted", "uncertain"].includes(e.state)) });
        const gateway = new SupervisionGateway(store, commands, c.home, receiver, { enabled: true,
          policyFence: this.runtime.features?.gateway(c.home, c.capability, () => store.read()),
          // Native capacity reads finish outside the owned writer. The final claim rechecks their read set.
          prepareAdmission: async effect => {
            const before = await store.read(), cap = await this.runtime.features?.capacity(c.home);
            if (cap) await checkGeneralHeadroom(before, receiver, cap.slots, cap.generalHeadroom, effect.id);
            const expected = occupancy(before);
            return current => { if (occupancy(current) !== expected) refuse("STALE", "Capacity reservations changed; inspect and retry this reserved effect."); };
          }, admissionCheck: (s, effect) => validate(s, effect.scopeId) });
        const sessions = new SupervisorSessions(store, gateway, receiver, { enabled: true, unverifiedUiAttach: true,
          limits: limitsFor(await store.read(), input.scopeId), limitsFor, reserveCheck: validate,
          reserveBoundary: run => this.runtime.features ? this.runtime.features.boundary(c.home, run) : run(),
          featurePolicy: async () => this.runtime.features?.reservation(c.home, c.capability),
          globalMateId: async () => (await this.controlsContext(input.homeId, input.scopeId)).config.mateAgentId });
        const controls = new SupervisorControls(store, sessions, gateway, receiver, { enabled: true, validate, limits: limitsFor,
          policyDigest: async () => (await this.controlsContext(input.homeId, input.scopeId)).policyDigest,
          reserve: run => withScopeAdmission(input.homeId, async () => {
            const accepted = (await store.read()).commands.some(command => command.id === input.requestId);
            const capacity = await this.runtime.features?.capacity(c.home);
            if (!accepted && capacity) await checkGeneralHeadroom(await store.read(), receiver, capacity.slots, capacity.generalHeadroom);
            return run();
          }),
          workspace: (scopeId, epoch) => supervisorWorkspace(this.root, scopeId, epoch),
          catalog: async (scopeId, configuration) => {
            const b = (await store.read()).bindings.find(b => b.scopeId === scopeId);
            if (!b) refuse("HELD", "Exact Supervisor unavailable; no configuration fallback.");
            const workspace = supervisorWorkspace(this.root, scopeId, configuration?.effectiveEpoch ?? b.epoch + 1);
            if (configuration && (!configuration.workspace || digest(configuration.workspace) !== digest(workspace)))
              refuse("STALE", "The next workspace was not qualified by this proposal. Withdraw it and review again.");
            return supervisorCatalog(paseo, workspace.directory);
          } });
        switch (input.op) {
          case "stage": await controls.stageFromUnverifiedUi(input); break;
          case "pause": await controls.pauseFromUnverifiedUi(input); break;
          case "resume": await controls.resumeFromUnverifiedUi(input); break;
          case "withdraw-proposal": await controls.withdrawProposalFromUnverifiedUi(input); break;
          case "withdraw-input": await controls.withdrawInputFromUnverifiedUi(input); break;
          case "replace": await controls.replaceFromUnverifiedUi(input); break;
          case "retire": await controls.retireFromUnverifiedUi(input); break;
        }
      }, true);
    });
    return this.readControls(input, paseo);
  }
  async stop() {
    await serialized(this.lock, async () => { this.closed = true; });
    // Drain independently so a migration never acquires General's lock then waits for native Attach IO.
    await serialized(this.attachLock, async () => {
      if (!this.options.runtime) await this.runtime.stop();
    });
  }
}
/** Why plan help can't rely on Needs you, naming the cause. The adapter has already observed and
 * waited for the backlog to settle, so the captain is never asked to refresh. Like the cutover's own
 * inventory, only a quarantine that may belong to this plan's tasks holds it. */
export function decisionProblems(decisions: NeedsYouSnapshot | null, planTasks: readonly string[]): string[] {
  if (!decisions || decisions.freshness.status === "disabled")
    return ["Needs you is off, so this plan's decisions can't be checked. Turn Needs you back on before handing over this plan."];
  if (!decisions.homeId || decisions.freshness.status !== "fresh") {
    // A settling backlog also lists every row it would quarantine, most of them other plans'; the
    // wait is the cause. Only a read that could not settle at all has its own problems to name.
    if (decisions.freshness.problems.includes(SETTLING_PROBLEM) || !decisions.freshness.problems.length)
      return ["The backlog is still being changed, so its decisions haven't settled yet. Try again in a few seconds."];
    return [`Decisions couldn't be checked: ${decisions.freshness.problems.join(" ")}`];
  }
  // Each problem already names its line and task where the backlog has them.
  return (decisions.quarantined ?? []).filter(q => q.taskId === null || planTasks.includes(q.taskId)).map(q =>
    `Needs you can't check this plan's decisions until this is repaired: ${q.problem}`);
}

export function registerSupervisionActivation(server: Pick<PluginServerContext, "handle">, activation: SupervisionActivation) {
  server.handle(readSupervisorControls, (input, { paseo }) => activation.readControls(input, paseo));
  server.handle(readSupervisorList, () => activation.listSupervisors());
  server.handle(actSupervisorControls, (input, { paseo }) => activation.control(input, paseo));
  server.handle(readHandoverEvidence, input => activation.evidence(input));
  server.handle(readMigrationSettings, input => activation.readBackup(input.homeId, input.workflowHomeId));
  server.handle(setMigrationSettings, input => activation.saveBackup(input));
  server.handle(readPlanHelp, input => activation.planHelp(input.homeId, input.plan, input.workflowHomeId));
  server.handle(readSupervisionActivation, () => activation.read());
  server.handle(migrateSupervisionPlan, input => activation.migrate(input));
  // This RPC has no caller identity. UI-only is a convention; do not label its caller captain-ui.
  server.handle(attachSupervisorFromUi, (input, { paseo }) => activation.attach(input, paseo));
}
