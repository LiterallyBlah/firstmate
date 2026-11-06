import { featurePause } from "../shared/feature-settings";
/** Build A production service. No background model turns or worker dispatcher; provisioning is an
 * explicit app-button or first-mate supervise-tool action, recorded with its actor. */
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { z } from "zod";
import { isAbsolute, join, resolve } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { SupervisionActor, SupervisionStatus } from "../shared/supervision";
import type { WorkflowPlan } from "../shared/workflow-plans";
import { ProjectAdminSchema, ProjectRuntimeSnapshotSchema, administerProject, provisionProjectFromUi, readProjectMemory,
  readProjectRuntime, recoverProjectRuntimeFromUi, abortProjectProvisionFromUi, type ProjectAdmin, type ProjectRuntimeSnapshot } from "../shared/project-runtime";
import { ProjectProvisionInputSchema } from "../shared/supervision-policy";
import { SUPERVISE_ACTOR_SOURCE, isSuperviseMateActor, superviseReplayEquivalent } from "../shared/supervise";
import { registerProjectFolders } from "./project-folders";
import { normalizedName, type ProjectRecord } from "../shared/supervision-projects";
import type { GatewayReceiver } from "../shared/supervision-effects";
import { readFirstmateConfig, resolveHome } from "./config";
import { oneAtATime, requireNoMigration } from "./mate";
import { parseProjects } from "./home";
import { readTextFile, resolveInHome } from "./files";
import { digest, publish } from "./submissions";
import { serialized } from "./serialize";
import { workflowHomeIdentity } from "./workflow-ownership";
import { workflowStore } from "./workflow-service";
import { SupervisionRuntime } from "./supervision-runtime";
import { SupervisionProjects, expected } from "./supervision-projects";
import { projectRowId } from "./supervision-project-state";
import { SupervisionMemory, readProjectContext } from "./supervision-memory";
import { checkPolicySource, policyRef, sameVector, acceptPolicyInventory } from "./supervision-policy";
import { SupervisionCommands } from "./supervision-commands";
import { refuse, stableId, SupervisionGateway } from "./supervision-effects";
import { activationEffects, SupervisorSessions, supervisorSpend } from "./supervisor-sessions";
import { SupervisionUiReceiver } from "./supervision-ui-receiver";
import { checkGeneralHeadroom, withScopeAdmission } from "./supervision-headroom";
import { message, TEMPLATES } from "./templates";
import { supervisorWorkspace } from "./supervisor-workspace";
import { checkedSupervisorCatalog, supervisorCatalog } from "./supervisor-catalog";
import type { PaseoApi } from "./host-types";
import { SupervisionStore } from "./supervision-store";
import { RemoteSnapshot } from "../shared/remotes";
import { pluginDir } from "./data-dir";

const UI: SupervisionActor = { kind: "plugin-ui-unverified", id: "unauthenticated-plugin-call", source: "project provision button (unverified)" };
/** A recorded provision belongs to the origin that started it: the captain's app button or the
 * current first mate's supervise tool. Journal replay is provenance-bound, so each resumes its own. */
const provisionOrigin = (actor: SupervisionActor) => digest(actor) === digest(UI) || actor.kind === "mate-chat" && actor.source === SUPERVISE_ACTOR_SOURCE;
const result = { planId: null, planHash: null, decisionId: null, outboxId: null };
const normalPath = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
const generalScopeId = (home: string) => projectRowId("general", workflowHomeIdentity(home));
const recordedProvisionRecord = (status: SupervisionStatus, projectId: string) => status.commands.flatMap(c => {
  const input = c.result.projectProvision;
  return input && input.homeId === status.homeId && input.projectId === projectId && c.id === stableId("project-provision-input", input.requestId) &&
    c.inputHash === digest(input) && provisionOrigin(c.actor) ? [{ input, actor: c.actor }] : [];
})[0] ?? null;
const recordedProvision = (status: SupervisionStatus, projectId: string) => recordedProvisionRecord(status, projectId)?.input ?? null;
type RegistryEntry = { name: string; location: string | null; directory: string | null; projectId: string | null; scopeId: string | null; reason: string | null };
type RemoteCatalog = z.infer<typeof RemoteSnapshot>;
/** The saved remote catalog the poll publishes; null until a poll has recorded one. */
async function savedRemoteCatalog(): Promise<RemoteCatalog | null> {
  try {
    const parsed = RemoteSnapshot.safeParse(JSON.parse(await readFile(join(pluginDir(), "remote-status.json"), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
const remotePathKey = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");
/** The registry row for an admitted project. Local projects match by their derived projectId;
 * a remote-owned project's id is derived from its declared (hostId, directory), which this
 * machine's registry rows never carry, so it matches by its reviewed name or alias, exactly one. */
function registryEntryFor(rows: RegistryEntry[], project: ProjectRecord): RegistryEntry | null {
  if (project.owner && project.owner.hostId !== "local") {
    const byName = rows.filter(r => [project.name, ...project.aliases].some(n => normalizedName(n) === normalizedName(r.name)));
    return byName.length === 1 ? byName[0]! : null;
  }
  return rows.find(r => r.projectId === project.id) ?? null;
}
async function registry(home: string) {
  const file = await readTextFile(home, "data/projects.md");
  if (file.content === null || file.size > 256 * 1024) refuse("HELD", "Project registry is unreadable or exceeds 256 KiB.");
  const rows: RegistryEntry[] = [];
  const uncommented = file.content.replace(/<!--[^]*?-->/g, "");
  for (const project of parseProjects(uncommented)) {
    let directory: string | null = null, reason: string | null = null;
    if (!project.location || !isAbsolute(project.location)) reason = "A canonical local project directory is required; URLs and remote locations need explicit mapping.";
    else try {
      const path = await realpath(project.location);
      if (!(await stat(path)).isDirectory()) reason = "Project location is not a directory.";
      else directory = normalPath(path);
    } catch { reason = "Project directory is unavailable; identity was not guessed."; }
    const projectId = directory ? projectRowId("registry", workflowHomeIdentity(home), "local", directory) : null;
    rows.push({ name: project.name, location: project.location, directory, projectId, scopeId: projectId ? projectRowId("project-scope", projectId) : null, reason });
  }
  for (const row of rows) if (rows.filter(r => normalizedName(r.name) === normalizedName(row.name)).length > 1 || row.directory && rows.filter(r => r.directory === row.directory).length > 1)
    row.reason = "Registry name or canonical directory is ambiguous; admission is held.";
  // A malformed non-comment list entry must be accounted for, never disappear through the lenient delivery parser.
  const lines = uncommented.split(/\r?\n/);
  for (const line of lines.filter(l => /^\s*[-*]\s/.test(l))) if (parseProjects(line).length !== 1)
    rows.push({ name: line.trim().slice(0, 200), location: null, directory: null, projectId: null, scopeId: null, reason: "Registry row is malformed; explicit correction is required." });
  return { digest: digest(file.content), rows };
}
function planAssociations(status: SupervisionStatus, legacy: readonly WorkflowPlan[], rows: RegistryEntry[]) {
  const scoped = new Set(status.plans.map(p => p.plan.definition.id));
  return [...status.plans.map(({ scopeId, plan }) => {
    const scope = status.scopes.find(s => s.id === scopeId), sponsor = status.projects?.sponsors.find(s => s.id === scopeId && s.state !== "released");
    return { id: plan.definition.id, title: plan.definition.title, backend: "scoped" as const, state: sponsor ? `sponsorship ${sponsor.state}` : "Awaiting sponsorship",
      projectIds: scope?.projectIds ?? [], sponsorScopeId: sponsor?.sponsorScopeId ?? null, ownerScopeId: scopeId };
  }), ...legacy.filter(p => !scoped.has(p.definition.id)).map(plan => ({ id: plan.definition.id, title: plan.definition.title, backend: "legacy" as const,
    state: "Pending migration; project oversight only", projectIds: [...new Set(plan.definition.nodes.flatMap(n => n.kind === "run" ? rows.filter(r => r.projectId &&
      [r.name, ...(status.projects?.projects.filter(p => p.id === r.projectId).flatMap(p => [p.name, ...p.aliases]) ?? [])].some(name => normalizedName(name) === normalizedName(n.launch.project)) &&
      n.launch.host.trim().toLowerCase() === (status.projects?.projects.find(p => p.id === r.projectId)?.owner?.hostId ?? "local").trim().toLowerCase()).map(r => r.projectId!) : []))],
    sponsorScopeId: null, ownerScopeId: null }))];
}
export interface ProjectRuntimeOptions {
  enabled?: boolean; config?: typeof readFirstmateConfig; slots?: number; generalHeadroom?: number;
  receiver?: (paseo: PaseoApi) => GatewayReceiver;
  legacy?: (home: string) => Promise<{ plans: WorkflowPlan[]; problems: string[] }>;
  /** Saved remote catalog for remote admission checks; defaults to the poll's published snapshot. */
  remoteCatalog?: () => Promise<RemoteCatalog | null>;
}
export class ProjectRuntime {
  readonly slots: number; readonly headroom: number;
  constructor(readonly runtime: SupervisionRuntime, private readonly options: ProjectRuntimeOptions = {}) {
    this.slots = options.slots ?? 4; this.headroom = options.generalHeadroom ?? 1;
    if (!Number.isSafeInteger(this.slots) || !Number.isSafeInteger(this.headroom) || this.headroom < 1 || this.slots <= this.headroom)
      throw new Error("Project slots must leave at least one configured General slot.");
  }
  capacity(home: string) { return this.runtime.features?.capacity(home) ?? Promise.resolve({ slots: this.slots, generalHeadroom: this.headroom }); }
  setupReceiver(paseo: PaseoApi) { return this.options.receiver?.(paseo) ?? new SupervisionUiReceiver(paseo, this.runtime.root, { projectMates: true }); }
  get setupEnabled() { return !!this.options.enabled; }
  /** Folder corrections and reviewed admissions share this boundary; picking a folder acquires no writer. */
  withRegistry<T>(homeId: string, run: () => Promise<T>) { return serialized(`project-registry:${homeId}`, run); }
  private config() { return (this.options.config ?? readFirstmateConfig)(); }
  private async checkedConfig(homeId: string, generalId?: string, settlement = false) {
    if (!this.options.enabled && !this.runtime.features) refuse("UNSUPPORTED", "Supervisors are off; no store or session was created.");
    const config = await this.config(); requireNoMigration(config); const home = resolveHome(config);
    if (homeId !== workflowHomeIdentity(home) || generalId !== undefined && generalId !== config.mateAgentId)
      refuse("STALE", "Home or General ownership changed; refresh before acting.");
    if (!settlement) await this.runtime.features?.check(home, "projectMates");
    else if (this.runtime.features && !(await this.runtime.features.read(home)).effective.projectMates &&
      (await this.runtime.read(home)).freshness === "uninitialized") refuse("UNSUPPORTED", "There is no saved work to check for this paused help.");
    return { config, home };
  }
  /** Uses the existing workflow clock, outside its lifecycle lock; no second timer or model wake. */
  async processRequests() {
    if (!this.options.enabled && !this.runtime.features) return;
    const config = await this.config(), home = resolveHome(config);
    if (config.migration || config.mateLaunch) return;
    const { absolute: directory } = await resolveInHome(home, "data/project-requests");
    await serialized(directory, async () => {
      let names: string[];
      try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      const Request = z.object({ id: z.uuid(), actor: z.string(), command: z.union([ProjectAdminSchema,
        z.object({ op: z.literal("read") }).strict(), z.object({ op: z.literal("memory-read"), projectId: z.uuid() }).strict()]) }).strict();
      let processed = 0;
      for (const name of names.filter(n => /^[0-9a-f-]{36}\.json$/.test(n)).sort()) {
        const relative = `data/project-requests/${name}`, reply = (await resolveInHome(home, relative.replace(/\.json$/, ".reply.json"))).absolute;
        try { await stat(reply); continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (processed++ >= 20) break;
        let response;
        try {
          const path = (await resolveInHome(home, relative)).absolute;
          if ((await stat(path)).size > 256 * 1024) refuse("HELD", "Project request exceeds 256 KiB.");
          const request = Request.parse(JSON.parse(await readFile(path, "utf8")));
          if (`${request.id}.json` !== name) refuse("CONFLICT", "Project request identity differs from its filename.");
          const command = request.command;
          response = { ok: true, result: command.op === "read" ? await this.read() : command.op === "memory-read" ? await this.memory({ homeId: workflowHomeIdentity(home), projectId: command.projectId }) :
            await this.admin({ homeId: workflowHomeIdentity(home), requestId: request.id, actorId: request.actor, command }) };
        } catch (error) { response = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
        await publish(reply, response);
      }
    });
  }
  async inputs(observed?: SupervisionStatus) {
    const config = await this.config(), home = resolveHome(config), problems: string[] = [];
    const status = observed ?? await this.runtime.read(home);
    let catalog: { digest: string | null; rows: RegistryEntry[] } = { digest: null, rows: [] };
    try { catalog = await registry(home); } catch (error) { problems.push(String(error)); }
    let legacy: WorkflowPlan[] = [];
    try { const read = await (this.options.legacy?.(home) ?? workflowStore(home).read()); legacy = read.plans; problems.push(...read.problems); }
    catch (error) { problems.push(`Plan inventory unavailable: ${String(error)}`); }
    return { home, config, status, catalog, legacy, problems };
  }
  async read(): Promise<ProjectRuntimeSnapshot> {
    const { config, status, catalog, legacy, problems } = await this.inputs();
    const policy = await this.runtime.features?.read(status.homeId);
    const capacity = policy?.capacity ?? { slots: this.slots, generalHeadroom: this.headroom };
    if (policy) problems.push(...policy.problems);
    const associations = planAssociations(status, legacy, catalog.rows);
    const associationWarnings = associations.filter(p => p.backend === "legacy" && !p.projectIds.length)
      .map(p => `Plan ${p.id} has unresolved project or host membership; no ownership was guessed.`);
    for (const plan of associations.filter(p => !p.projectIds.length)) problems.push(`Plan ${plan.id} has unresolved project or host membership; no ownership was guessed.`);
    const rows = [...catalog.rows];
    for (const p of status.projects?.projects ?? []) if (!rows.some(r => r.projectId === p.id)) rows.push({ name: p.name, location: p.owner?.directory ?? null, directory: p.owner?.directory ?? null,
      projectId: p.id, scopeId: p.scopeId, reason: "Admitted project is absent from the current registry; retained for reconciliation." });
    return ProjectRuntimeSnapshotSchema.parse({ enabled: policy?.effective.projectMates ?? !!this.options.enabled, homeId: status.homeId, registryDigest: catalog.digest,
      pause: policy ? featurePause(status, policy.effective, "project") : null,
      sequence: status.sequence, hash: status.hash, freshness: status.freshness, problems: [...status.problems, ...problems], associationWarnings,
      recovery: status.problems.length && status.problems.every(p => p.startsWith("Checkpoint validation failed;") || p === "Final transaction awaits publication.")
        ? { sequence: status.sequence, hash: status.hash } : null,
      general: { agentId: config.mateAgentId || null, scopeId: status.scopes.find(s => s.kind === "general")?.id ?? null,
        headroom: capacity.generalHeadroom, slots: capacity.slots, providerAvailability: "unknown" },
      projects: rows.map(row => {
        const project = status.projects?.projects.find(p => p.id === row.projectId) ?? (row.projectId ? undefined : status.projects?.projects.find(p => p.owner && p.owner.hostId !== "local" && normalizedName(p.name) === normalizedName(row.name))), scope = status.scopes.find(s => s.id === project?.scopeId),
          binding = status.bindings.find(b => b.scopeId === scope?.id), spend = scope ? supervisorSpend(status, scope.id) : { sessions: 0, turns: 0, uncertain: 0 };
        const effects = binding ? activationEffects(status, binding.scopeId, binding.epoch) : null;
        const provisionRecord = project ? recordedProvisionRecord(status, project.id) : null, provisionInput = provisionRecord?.input ?? null;
        const provisionOriginName = provisionRecord ? isSuperviseMateActor(provisionRecord.actor) ? "first-mate" as const : "app" as const : null;
        const stopped = binding?.state === "suspect" || !!provisionInput && status.commands.some(c => c.id === stableId("project-provision-abort", provisionInput.requestId));
        const aliasKnown = !project || [project.name, ...project.aliases].some(name => normalizedName(name) === normalizedName(row.name));
        const reason = (project?.owner && project.owner.hostId !== "local" ? null : row.reason) ?? (!aliasKnown ? "Registry name changed; record a reviewed alias before provisioning." : !project ? "Awaiting reviewed admission and allocation." : !project.owner ? "Durable profile and caps are missing." :
          binding?.state === "retired" ? "Supervisor retired; identity, spend and history retained. The project stays as context." :
          stopped ? "Provisioning stopped; identity and spend retained. Inspect any uncertain operation." :
          !binding ? provisionInput ? "Provisioning incomplete; inspect and resume the recorded request." : null : binding.state !== "active" || effects?.send?.state !== "succeeded" ? "Provisioning incomplete; inspect and resume the recorded request." : null);
        return { name: row.name, directory: project?.owner?.directory ?? row.directory, registryLocation: row.location, hostId: project?.owner?.hostId ?? (row.directory ? "local" : null), projectId: project?.id ?? row.projectId, scopeId: project?.scopeId ?? row.scopeId,
          reason, state: row.reason && !(project?.owner && project.owner.hostId !== "local") ? "held" : project?.state ?? "unadmitted", version: project?.version ?? 0, aliases: project?.aliases ?? [],
          agentId: binding?.agentId ?? null, workspaceId: binding?.workspaceId ?? null, provisionRequestId: effects?.create?.requestId ?? provisionInput?.requestId ?? null, provisionInput, provisionOrigin: provisionOriginName,
          ...spend, profile: project?.owner?.profile ?? null, limits: project?.owner?.limits ?? null,
          memoryPending: status.projects?.memoryProposals.filter(p => p.projectId === project?.id && p.state === "proposed").length ?? 0,
          plans: associations.filter(a => row.projectId && a.projectIds.includes(row.projectId)) };
      }) });
  }
  private mutate<T>(homeId: string, run: (home: string, store: SupervisionStore, config: Awaited<ReturnType<typeof readFirstmateConfig>>) => Promise<T>, independent = false, settlement = false, admission = false) {
    const work = async () => {
      const { config, home } = await this.checkedConfig(homeId, undefined, settlement);
      return this.runtime.mutate(home, async store => {
        if ((await store.read()).problems.includes("Final transaction awaits publication.")) await store.recoverPublication();
        await store.enableLongLived();
        const commit = async () => { await this.checkedConfig(homeId, config.mateAgentId, settlement); return run(home, store, config); };
        return admission && this.runtime.features ? this.runtime.features.boundary(home, commit) : commit();
      }, true);
    };
    // Mate-authored administration keeps its role lock. Project app work never borrows General's conversation queue.
    return independent ? work() : oneAtATime(work);
  }
  async recover(input: { homeId: string; sequence: number; hash: string | null }) {
    const { home } = await this.checkedConfig(input.homeId, undefined, true), observed = await this.runtime.read(home);
    if (observed.freshness === "uninitialized") refuse("HELD", "There are no recorded project records to recover.");
    if (observed.sequence !== input.sequence || observed.hash !== input.hash) refuse("STALE", "Recovery observation changed; refresh and inspect again.");
    if (observed.freshness !== "current" && !observed.problems.every(p => p.startsWith("Checkpoint validation failed;") || p === "Final transaction awaits publication."))
      refuse("HELD", "Authority history needs deliberate reconciliation; app recovery cannot reconstruct it.");
    await this.runtime.mutate(home, async store => {
      await this.checkedConfig(input.homeId, undefined, true);
      const current = await store.read();
      if (current.sequence !== input.sequence || current.hash !== input.hash) refuse("STALE", "Recovery observation changed; refresh and inspect again.");
      if (current.problems.includes("Final transaction awaits publication.")) await store.recoverPublication(input);
      else if (current.freshness !== "current") refuse("HELD", "Journal is not recoverable by the app.");
    }, input);
    return this.read();
  }
  async abort(input: { homeId: string; projectId: string; projectVersion: number; provisionRequestId: string }) {
    await this.mutate(input.homeId, async (_home, store) => {
      await store.transactCommand(stableId("project-provision-abort", input.provisionRequestId), digest(input), UI, async status => {
        const project = status.projects?.projects.find(p => p.id === input.projectId), binding = status.bindings.find(b => b.scopeId === project?.scopeId);
        const marker = status.commands.find(c => c.id === stableId("project-provision-input", input.provisionRequestId));
        const original = marker?.result.projectProvision;
        const effects = status.effects.filter(e => e.scopeId === project?.scopeId && e.requestId === input.provisionRequestId && e.attemptId === null);
        const legacyBinding = !original && binding && effects.some(e => e.operation === "agent.create" && e.receiverKey === binding.agentId);
        if (!project || project.version !== input.projectVersion || !marker || !provisionOrigin(marker.actor) ||
          (original ? original.projectId !== project.id || original.homeId !== input.homeId : !legacyBinding)) refuse("STALE", "Inspect the current recorded provisioning before stopping it.");
        if (effects.some(e => e.operation === "agent.send" && e.state === "succeeded")) refuse("HELD", "Opening already completed; use the project's reviewed stop controls.");
        const scope = status.scopes.find(s => s.id === project.scopeId)!;
        const mutations = [...effects.filter(e => e.state === "reserved").map(e => ({ kind: "effect" as const, value: { ...e, state: "cancelled" as const, version: e.version + 1 } })),
          ...(binding ? [{ kind: "binding" as const, value: { ...binding, state: "suspect" as const } },
            { kind: "scope" as const, value: { ...scope, state: "transferring" as const, version: scope.version + 1 } }] : [])];
        return { mutations, expectedVersions: expected(status, mutations), result };
      });
    }, true, true);
    return this.read();
  }
  async admin(input: { homeId: string; requestId: string; actorId: string; command: ProjectAdmin }) {
    const command = ProjectAdminSchema.parse(input.command);
    const settlement = command.op === "release-sponsor" || command.op === "project" && command.state === "stopped";
    const observedConfig = await this.config();
    if (!observedConfig.mateAgentId || observedConfig.mateAgentId !== input.actorId) refuse("UNKNOWN_OWNER", "Current first-mate role required for recorded project administration.");
    const update = () => this.mutate(input.homeId, async (home, store, config) => {
      // Same behavioral role check as workflow transport. The request is not authenticated filesystem/native IPC.
      if (!config.mateAgentId || input.actorId !== config.mateAgentId) refuse("UNKNOWN_OWNER", "Current first-mate role required for recorded project administration.");
      const actor: SupervisionActor = { kind: "mate-chat", id: input.actorId, source: "project administration (same-user role convention, unverified)" };
      await store.transactCommand(stableId("project-admin-input", input.requestId), digest(input), actor,
        async () => ({ mutations: [], expectedVersions: [], result }));
      const alreadyAccepted = (await store.read()).commands.some(c => c.id === input.requestId);
      if (command.op === "admit" && alreadyAccepted) {
        await store.transactCommand(input.requestId, digest(command), actor, async () => refuse("CONFLICT", "Expected accepted admission replay.")); return;
      }
      const projects = new SupervisionProjects(store, { enabled: true, sourceCheck: source => checkPolicySource(home, source) }), memory = new SupervisionMemory(store, { enabled: true });
      const { op, ...data } = command;
      switch (command.op) {
        case "admit": await this.admit(home, store, input.requestId, actor, command, config.mateAgentId); break;
        case "project": {
          const project = (await store.read()).projects?.projects.find(p => p.id === command.projectId) ?? refuse("UNKNOWN_OWNER", "Project is not admitted.");
          if (!alreadyAccepted) for (const ref of command.sourceVector) { const source = (await store.read()).policySources.find(s => s.id === ref.id); if (source) await checkPolicySource(home, source); }
          const { op: _op, ...change } = command;
          await projects.recordProject(input.requestId, actor, { ...change, name: project.name, scopeId: project.scopeId, aliases: command.aliases ?? project.aliases }); break;
        }
        case "sponsor": {
          if (!alreadyAccepted) {
            const s = await store.read(), owned = s.plans.filter(p => p.scopeId === command.planScopeId);
            if (owned.length !== 1 || !s.backends.some(b => b.planId === owned[0]!.plan.definition.id && b.ownerScopeId === command.planScopeId && b.backend === "scoped" && b.state === "active"))
              refuse("HELD", "Sponsorship requires one authoritative scoped plan; legacy associations remain pending migration.");
            const inventory = await this.inputs();
            if (inventory.problems.length) refuse("HELD", "Sponsorship waits for a complete legacy inventory.");
            const legacy = inventory.legacy;
            if (legacy.some(p => p.definition.id === owned[0]!.plan.definition.id) && !s.migrations?.some(m => m.scopeId === command.planScopeId && m.planId === owned[0]!.plan.definition.id && m.state === "committed"))
              refuse("HELD", "Complete the exact legacy inventory and S07 cutover before claiming sponsorship.");
          }
          await projects.claimSponsor(input.requestId, actor, data as Parameters<typeof projects.claimSponsor>[2]); break;
        }
        case "release-sponsor": await projects.releaseSponsor(input.requestId, actor, data as Parameters<typeof projects.releaseSponsor>[2]); break;
        case "promote": await projects.promote(input.requestId, actor, data as { projectId: string }); break;
        case "intake": await projects.claimIntent(input.requestId, actor, data as Parameters<typeof projects.claimIntent>[2]); break;
        case "resolve-conflict": await projects.resolveConflict(input.requestId, actor, data as Parameters<typeof projects.resolveConflict>[2]); break;
        case "resolve-dependencies": await projects.resolveDependencies(input.requestId, actor, data as Parameters<typeof projects.resolveDependencies>[2], (await this.inputs()).legacy); break;
        case "memory-propose": await memory.propose(actor, data as Parameters<typeof memory.propose>[1], input.requestId); break;
        case "memory-decide": await memory.decide(input.requestId, actor, data as Parameters<typeof memory.decide>[2]); break;
      }
    }, false, settlement, true);
    await (command.op === "admit" || command.op === "project" ? this.withRegistry(input.homeId, update) : update());
    return this.read();
  }
  private async admit(home: string, store: SupervisionStore, requestId: string, actor: SupervisionActor, input: Extract<ProjectAdmin, { op: "admit" }>, generalId: string, app = false) {
    const catalog = await registry(home);
    if (catalog.digest !== input.registryDigest) refuse("STALE", "Project registry changed; review the current census.");
    const declared = catalog.rows.find(p => normalizedName(p.name) === normalizedName(input.name));
    // A remote owner is declared with the reviewed admission: a saved host's serverId and the directory
    // chosen from that host's catalog rows. It is never resolved or realpath'd on this machine.
    const remote = input.hostId !== undefined && input.hostId.trim().toLowerCase() !== "local";
    if (remote !== (input.directory !== undefined)) refuse("HELD", "Remote admission needs both the saved host and its declared directory.");
    if (remote && (!/^(?:\/|[A-Za-z]:[\\/])/.test(input.directory!) || /[\x00-\x1f\x7f]/.test(input.directory!))) refuse("HELD", "The declared remote directory must be an absolute path on that host.");
    if (remote) {
      // The host must be a saved host and the directory one of its catalog rows (a project path or
      // a workspace path/cwd), exactly as reviewed; an unrecorded host or directory is refused.
      const catalogHosts = await (this.options.remoteCatalog ?? savedRemoteCatalog)();
      const host = catalogHosts?.hosts.find(h => h.serverId === input.hostId);
      if (!host) refuse("HELD", "Remote admission needs a saved host from the remote catalog; this hostId is not recorded there.");
      const directories = [...host!.projects.map(r => r.path), ...host!.workspaces.flatMap(r => [r.path, r.cwd])]
        .filter((value): value is string => typeof value === "string" && !!value);
      if (!directories.some(d => remotePathKey(d) === remotePathKey(input.directory!)))
        refuse("HELD", "The declared remote directory does not appear in that host's catalog rows; review it from the catalog.");
    }
    const entry = !remote ? declared : declared && catalog.rows.filter(p => normalizedName(p.name) === normalizedName(input.name)).length === 1
      ? { ...declared, directory: input.directory!, projectId: projectRowId("registry", workflowHomeIdentity(home), input.hostId!, input.directory!),
          scopeId: projectRowId("project-scope", projectRowId("registry", workflowHomeIdentity(home), input.hostId!, input.directory!)), reason: null }
      : declared;
    if (!entry || entry.reason || !entry.projectId || !entry.scopeId || !entry.directory) refuse("HELD", entry?.reason ?? "Project is not in the current registry.");
    if (digest(input.source.provenance) !== digest(actor)) refuse("CONFLICT", "Reviewed source must retain its adapter provenance.");
    await acceptPolicyInventory(store, home, stableId("project-source", requestId), actor, { sources: [input.source], rules: [], reviewedHolds: [] }, true, app);
    await store.transactCommand(stableId("project-scopes", requestId), digest(input), actor, async status => {
      await this.checkedConfig(store.homeId, generalId);
      const mutations = [], general = status.scopes.filter(s => s.kind === "general");
      if (general.length > 1 || general.length === 1 && general[0]!.id !== generalScopeId(home)) refuse("CONFLICT", "General scope requires explicit identity reconciliation.");
      if (!general.length) mutations.push({ kind: "scope" as const, value: { id: generalScopeId(home), homeId: store.homeId, kind: "general" as const,
        projectIds: [], sponsorId: null, version: 1, mode: "legacy" as const, state: "active" as const } });
      if (!status.scopes.some(s => s.id === entry.scopeId)) mutations.push({ kind: "scope" as const, value: { id: entry.scopeId!, homeId: store.homeId, kind: "project" as const,
        projectIds: [entry.projectId!], sponsorId: generalScopeId(home), version: 1, mode: "scoped" as const, state: "dormant" as const } });
      return { mutations, expectedVersions: expected(status, mutations), result };
    });
    const before = await store.read(), old = before.projects?.projects.find(p => p.id === entry.projectId);
    if (!old) await new SupervisionProjects(store, { enabled: true, projectSetupUi: app, sourceCheck: source => checkPolicySource(home, source) }).recordProject(stableId("project-admission", requestId), actor, {
      projectId: entry.projectId, scopeId: entry.scopeId, expectedVersion: 0, name: input.name, aliases: input.aliases, state: "admitted", budget: input.budget,
      sourceVector: [policyRef("policy-source", input.source)] });
    await store.transactCommand(requestId, digest(input), actor, async status => {
      await this.checkedConfig(store.homeId, generalId);
      const project = status.projects!.projects.find(p => p.id === entry.projectId)!;
      if (project.owner) refuse("CONFLICT", "This project already has durable ownership; use versioned allocation commands.");
      const value: ProjectRecord = { ...project, version: project.version + 1, owner: { directory: entry.directory!, hostId: remote ? input.hostId! : "local", registryDigest: catalog.digest,
        generalAgentId: generalId, profile: input.profile, limits: input.limits } };
      const mutations = [{ kind: "project" as const, value }]; return { mutations, expectedVersions: expected(status, mutations), result };
    });
  }
  /** The app review is durable before admission. It never impersonates General or captain-ui. */
  async memory(input: { homeId: string; projectId: string }) {
    const config = await this.config(), home = resolveHome(config);
    if (input.homeId !== workflowHomeIdentity(home)) refuse("STALE", "Home changed.");
    // Borrow an inert reader, never mutate/initialize on a context view.
    const reader = this.runtime.inertStore(home), context = await readProjectContext(reader, input.projectId), status = await reader.read();
    const pending = status.projects?.memoryProposals.filter(p => p.projectId === input.projectId && p.state === "proposed") ?? [];
    if (pending.length > 32) refuse("HELD", "Memory review exceeds its 32-proposal snapshot bound.");
    let bytes = Buffer.byteLength(JSON.stringify(context));
    const proposals = [];
    for (const p of pending) {
      const content = await reader.readBlob(p.textDigest, 16384); bytes += content.length;
      if (bytes > 512 * 1024) refuse("HELD", "The saved memory review is too large to open (over 512 KiB). Review fewer pending proposals, then reopen memory.");
      const text = Buffer.from(content).toString("utf8");
      if (text.includes("\0") || !Buffer.from(text).equals(Buffer.from(content))) refuse("HELD", "Memory proposal is not valid UTF-8 text.");
      proposals.push({ id: p.id, version: p.version, key: p.key, expectedVersion: p.expectedVersion, digest: p.textDigest, text });
    }
    if ((await reader.read()).hash !== status.hash) refuse("STALE", "Memory review changed; reload it.");
    return { ...context, proposals };
  }
  /** A project's Supervisor, from Supervisors' Add (or an older recorded request, replayed exactly). */
  async provision(input: z.infer<typeof ProjectProvisionInputSchema>, paseo: PaseoApi, actor: SupervisionActor = UI) {
    if (!provisionOrigin(actor)) refuse("UNKNOWN_OWNER", "Provisioning is recorded by the captain's app button or the current first mate.");
    ProjectProvisionInputSchema.parse(input);
    await serialized(`firstmate.project-provision:${input.homeId}:${input.projectId}`, () => this.mutate(input.homeId, async (home, store, config) => {
      if (actor.kind === "mate-chat" && actor.id !== config.mateAgentId) refuse("UNKNOWN_OWNER", "Current first-mate role required for provisioning.");
      let status = await store.read();
      const project = status.projects?.projects.find(p => p.id === input.projectId);
      if (!project?.owner) refuse("HELD", "Reviewed project with durable profile and caps required.");
      if (input.limits && (input.limits.supervisorSessions > project.owner.limits.supervisorSessions || input.limits.supervisorTurns > project.owner.limits.supervisorTurns))
        refuse("HELD", "These limits exceed the project's admitted allocation. A Supervisor grants no budget increase.");
      const retained = recordedProvision(status, project.id);
      if (retained && retained.requestId !== input.requestId) return;
      if (status.commands.some(c => c.id === stableId("project-provision-abort", input.requestId))) refuse("HELD", "Provisioning was stopped; its identity and spend remain reserved.");
      const marker = status.commands.find(c => c.id === stableId("project-provision-input", input.requestId));
      if (marker && marker.inputHash !== digest(input)) refuse("CONFLICT", "Request ID belongs to different provisioning input.");
      if (marker && digest(marker.actor) !== digest(actor)) {
        // Only a first-mate-started request can be taken over (by the successor first mate or the
        // captain's app); the takeover itself is recorded before the recorded request continues.
        if (!isSuperviseMateActor(marker.actor) || !superviseReplayEquivalent(marker.actor, actor))
          refuse("CONFLICT", "Request ID belongs to a different provenance. Resume it through the route that started it.");
        await store.transactCommand(stableId("supervise-takeover", input.requestId, digest(actor)),
          digest({ superviseTakeover: { requestId: input.requestId, from: marker.actor, to: actor } }), actor,
          async () => ({ mutations: [], expectedVersions: [], result }));
      }
      const binding = status.bindings.find(b => b.scopeId === project.scopeId), accepted = status.commands.find(c => c.id === input.requestId);
      if (binding && accepted) {
        const recorded = activationEffects(status, project.scopeId, binding.epoch);
        if (recorded.create?.requestId === input.requestId && [recorded.workspace, recorded.create, recorded.send].every(e => e?.state === "succeeded")) return;
      }
      if (binding?.state === "retired") refuse("HELD", "This project's Supervisor is retired; its identity, spend and history are retained.");
      if (project.state !== "admitted") refuse("HELD", "Project admissions are stopped.");
      if (accepted && project.version !== input.projectVersion) refuse("HELD", "The retained provisioning's project version changed; reconcile its existing effects before proceeding.");
      if (!accepted && project.version !== input.projectVersion) refuse("STALE", "Project allocation or ownership changed; refresh before provisioning.");
      // Checked before the request is recorded, so an unavailable profile never pins this project to a dead request.
      // Requested caps alone still bind a configuration: the admitted profile is reviewed with them, so they hold for every later turn.
      const reviewedProfile = input.profile ?? (input.limits ? project.owner.profile : undefined);
      const workspace = reviewedProfile && supervisorWorkspace(this.runtime.root, project.scopeId, 1);
      // A captain-chosen profile must be in the host catalog; the admitted one was reviewed at admission and is recorded against what is seen now.
      const reviewedCatalog = !reviewedProfile || binding ? null : input.profile ? await checkedSupervisorCatalog(paseo, workspace!.directory, input.profile) : await supervisorCatalog(paseo, workspace!.directory);
      await store.transactCommand(stableId("project-provision-input", input.requestId), digest(input), actor,
        async current => {
          const owner = current.projects?.projects.find(p => p.id === project.id);
          if (owner?.version !== input.projectVersion || owner.state !== "admitted") refuse("STALE", "Project admission changed before recording provisioning.");
          return { mutations: [], expectedVersions: [], result: { ...result, projectProvision: input } };
        });
      const catalog = await registry(home), entry = registryEntryFor(catalog.rows, project);
      // A remote owner's directory is declared at admission, not resolved from this registry; only its reviewed name is rechecked here.
      if (!entry || (project.owner.hostId === "local" && (entry.reason || entry.directory !== project.owner.directory)) || ![project.name, ...project.aliases].some(name => normalizedName(name) === normalizedName(entry.name))) refuse("HELD", "Current registry identity or reviewed alias does not match admitted ownership.");
      const receiver = this.options.receiver?.(paseo) ?? new SupervisionUiReceiver(paseo, this.runtime.root, { projectMates: true });
      const commands = new SupervisionCommands(store, home, { enabled: true }), gateway = new SupervisionGateway(store, commands, home, receiver, { enabled: true, policyFence: this.runtime.features?.gateway(home, "projectMates", () => store.read()),
        admissionCheck: async (current, effect) => {
          await this.checkedConfig(input.homeId, config.mateAgentId);
          const owner = current.projects?.projects.find(p => p.id === project.id);
          if (owner?.version !== input.projectVersion || owner.state !== "admitted") refuse("STALE", "Project admission changed before dispatch.");
          for (const ref of owner.sourceVector) {
            const source = current.policySources.find(s => s.id === ref.id);
            if (!source || !sameVector([ref], [policyRef("policy-source", source)]) || current.policySources.some(s => s.supersedes.includes(ref.id))) refuse("STALE", "Project admission source changed.");
            await checkPolicySource(home, source);
          }
          const capacity = await this.capacity(home);
          await checkGeneralHeadroom(current, receiver, capacity.slots, capacity.generalHeadroom, effect.id);
          const live = registryEntryFor((await registry(home)).rows, project);
          if (!live || (project.owner!.hostId === "local" && (live.reason || live.directory !== project.owner!.directory))) refuse("HELD", "Registry ownership changed before dispatch.");
        } });
      // A reviewed profile is pinned to the exact host catalog and policy, as plan Attach pins its own.
      // Older requests replay the retired project-setup review's configuration, when one was recorded.
      const reviewed = status.commands.find(c => c.result.projectSetup?.review.projectId === project.id)?.result.projectSetup?.review;
      const configuration = reviewedProfile && reviewedCatalog ? { id: input.requestId, scopeId: project.scopeId, generation: 1, workspace: workspace!, requested: reviewedProfile, resolved: reviewedProfile,
        catalogDigest: digest(reviewedCatalog), policyDigest: digest(await this.runtime.features?.read(home) ?? { enabled: true }),
        target: { homeId: input.homeId, hostId: "local" as const, scopeId: project.scopeId, kind: "project" as const, planId: null, planHash: null },
        limits: input.limits ?? project.owner.limits, effectiveEpoch: 1, provenance: actor.kind === "mate-chat" ? "first mate tool (unverified)" as const : "client UI (unverified)" as const } : reviewed?.catalogDigest ? { id: input.requestId, scopeId: project.scopeId, generation: 1,
        ...(reviewed.workspace ? { workspace: reviewed.workspace } : {}), requested: reviewed.profile, resolved: reviewed.profile, catalogDigest: reviewed.catalogDigest, policyDigest: reviewed.policyHash,
        target: { homeId: input.homeId, hostId: "local" as const, scopeId: project.scopeId, kind: "project" as const, planId: null, planHash: null },
        limits: reviewed.limits, effectiveEpoch: 1, provenance: "client UI (unverified)" as const } : undefined;
      const sessions = new SupervisorSessions(store, gateway, receiver, { enabled: true, ...(configuration ? { configuration } : {}),
        featurePolicy: async () => this.runtime.features?.reservation(home, "projectMates"),
        reserveBoundary: run => this.runtime.features ? this.runtime.features.boundary(home, run) : run(), limits: project.owner.limits,
        globalMateId: async () => (await this.checkedConfig(input.homeId, config.mateAgentId)).config.mateAgentId || null,
        reserveCheck: async current => {
          await this.checkedConfig(input.homeId, config.mateAgentId);
          const owner = current.projects?.projects.find(p => p.id === project.id);
          if (owner?.version !== input.projectVersion || owner.state !== "admitted" || current.commands.some(c => c.id === stableId("project-provision-abort", input.requestId)))
            refuse("HELD", "Project provisioning admission changed before reservation.");
        } });
      if (!binding) {
        // An older request resumes with its retired setup review's exact opening, never newly generated text.
        const opening = input.opening ?? reviewed?.opening ?? await message(TEMPLATES.projectSupervisorOpening, { project: project.name, scopeId: project.scopeId,
          context: JSON.stringify({ ...await readProjectContext(store, project.id), directory: project.owner.directory, limits: input.limits ?? project.owner.limits }).replace(/</g, "\\u003c") });
        await withScopeAdmission(input.homeId, async () => {
          await this.checkedConfig(input.homeId, config.mateAgentId);
          status = await store.read();
          if (status.commands.some(c => c.id === stableId("project-provision-abort", input.requestId))) refuse("HELD", "Provisioning was stopped before admission.");
          const capacity = await this.capacity(home);
          await checkGeneralHeadroom(status, receiver, capacity.slots, capacity.generalHeadroom);
          await sessions.prepare({ requestId: input.requestId, scopeId: project.scopeId, scopeVersion: status.scopes.find(s => s.id === project.scopeId)!.version,
            profile: reviewedProfile ?? project.owner!.profile, opening, purpose: "work" }, actor);
        });
      } else if (!accepted || activationEffects(status, project.scopeId, binding.epoch).create?.requestId !== input.requestId) {
        // Another explicit press cannot allocate another identity, even if it uses a different request ID.
        return;
      }
      status = await store.read(); const current = status.bindings.find(b => b.scopeId === project.scopeId)!;
      const effects = activationEffects(status, project.scopeId, current.epoch);
      for (const e of [effects.workspace, effects.create]) {
        if (!e || e.requestId !== input.requestId) refuse("HELD", "Provisioning effects do not match the retained request.");
        if (e.state === "succeeded") continue;
        const next = ["dispatching", "uncertain", "accepted"].includes(e.state) ? await gateway.reconcile(e.id) : await gateway.dispatch(e.id);
        if (next.state !== "succeeded") return;
      }
      if (current.state === "prepared") await sessions.verify(project.scopeId, current.epoch);
      if (effects.send?.state === "reserved") await gateway.dispatch(effects.send.id);
    }, true));
    return this.read();
  }
}
export function registerProjectRuntime(server: Pick<PluginServerContext, "handle">, projects: ProjectRuntime) {
  registerProjectFolders(server, projects);
  server.handle(readProjectRuntime, () => projects.read());
  server.handle(administerProject, input => projects.admin(input));
  server.handle(provisionProjectFromUi, (input, { paseo }) => projects.provision(input, paseo));
  server.handle(readProjectMemory, input => projects.memory(input));
  server.handle(recoverProjectRuntimeFromUi, input => projects.recover(input));
  server.handle(abortProjectProvisionFromUi, input => projects.abort(input));
}
