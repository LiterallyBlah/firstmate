import { featurePause } from "../shared/feature-settings";
/** Build A production service. No background model turns, attach path or worker dispatcher. */
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { z } from "zod";
import { isAbsolute, resolve } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { SupervisionActor, SupervisionStatus } from "../shared/supervision";
import type { WorkflowPlan } from "../shared/workflow-plans";
import { ProjectAdminSchema, ProjectRuntimeSnapshotSchema, administerProject, provisionProjectFromUi, readProjectMemory,
  readProjectRuntime, recoverProjectRuntimeFromUi, abortProjectProvisionFromUi, type ProjectAdmin, type ProjectRuntimeSnapshot } from "../shared/project-runtime";
import { ProjectProvisionInputSchema, type ProjectSetupInputSchema } from "../shared/supervision-policy";
import { registerProjectSetup } from "./project-setup";
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
import type { PaseoApi } from "./host-types";
import { SupervisionStore } from "./supervision-store";

const UI: SupervisionActor = { kind: "plugin-ui-unverified", id: "unauthenticated-plugin-call", source: "project provision button (unverified)" };
const result = { planId: null, planHash: null, decisionId: null, outboxId: null };
const normalPath = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
const generalScopeId = (home: string) => projectRowId("general", workflowHomeIdentity(home));
const recordedProvision = (status: SupervisionStatus, projectId: string) => status.commands.flatMap(c => {
  const input = c.result.projectProvision;
  return input && input.homeId === status.homeId && input.projectId === projectId && c.id === stableId("project-provision-input", input.requestId) &&
    c.inputHash === digest(input) && digest(c.actor) === digest(UI) ? [input] : [];
})[0] ?? null;
type RegistryEntry = { name: string; directory: string | null; projectId: string | null; scopeId: string | null; reason: string | null };
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
    rows.push({ name: project.name, directory, projectId, scopeId: projectId ? projectRowId("project-scope", projectId) : null, reason });
  }
  for (const row of rows) if (rows.filter(r => normalizedName(r.name) === normalizedName(row.name)).length > 1 || row.directory && rows.filter(r => r.directory === row.directory).length > 1)
    row.reason = "Registry name or canonical directory is ambiguous; admission is held.";
  // A malformed non-comment list entry must be accounted for, never disappear through the lenient delivery parser.
  const lines = uncommented.split(/\r?\n/);
  for (const line of lines.filter(l => /^\s*[-*]\s/.test(l))) if (parseProjects(line).length !== 1)
    rows.push({ name: line.trim().slice(0, 200), directory: null, projectId: null, scopeId: null, reason: "Registry row is malformed; explicit correction is required." });
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
      [r.name, ...(status.projects?.projects.filter(p => p.id === r.projectId).flatMap(p => [p.name, ...p.aliases]) ?? [])].some(name => normalizedName(name) === normalizedName(n.launch.project)) && n.launch.host.trim().toLowerCase() === "local").map(r => r.projectId!) : []))],
    sponsorScopeId: null, ownerScopeId: null }))];
}
export interface ProjectRuntimeOptions {
  enabled?: boolean; config?: typeof readFirstmateConfig; slots?: number; generalHeadroom?: number;
  receiver?: (paseo: PaseoApi) => GatewayReceiver;
  legacy?: (home: string) => Promise<{ plans: WorkflowPlan[]; problems: string[] }>;
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
  private config() { return (this.options.config ?? readFirstmateConfig)(); }
  private async checkedConfig(homeId: string, generalId?: string, settlement = false) {
    if (!this.options.enabled && !this.runtime.features) refuse("UNSUPPORTED", "Project mates are disabled; no store or session was created.");
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
    for (const plan of associations.filter(p => !p.projectIds.length)) problems.push(`Plan ${plan.id} has unresolved project or host membership; no ownership was guessed.`);
    const rows = [...catalog.rows];
    for (const p of status.projects?.projects ?? []) if (!rows.some(r => r.projectId === p.id)) rows.push({ name: p.name, directory: p.owner?.directory ?? null,
      projectId: p.id, scopeId: p.scopeId, reason: "Admitted project is absent from the current registry; retained for reconciliation." });
    return ProjectRuntimeSnapshotSchema.parse({ enabled: policy?.effective.projectMates ?? !!this.options.enabled, homeId: status.homeId, registryDigest: catalog.digest,
      pause: policy ? featurePause(status, policy.effective, "project") : null,
      sequence: status.sequence, hash: status.hash, freshness: status.freshness, problems: [...status.problems, ...problems],
      recovery: status.problems.length && status.problems.every(p => p.startsWith("Checkpoint validation failed;") || p === "Final transaction awaits publication.")
        ? { sequence: status.sequence, hash: status.hash } : null,
      general: { agentId: config.mateAgentId || null, scopeId: status.scopes.find(s => s.kind === "general")?.id ?? null,
        headroom: capacity.generalHeadroom, slots: capacity.slots, providerAvailability: "unknown" },
      projects: rows.map(row => {
        const project = status.projects?.projects.find(p => p.id === row.projectId), scope = status.scopes.find(s => s.id === project?.scopeId),
          binding = status.bindings.find(b => b.scopeId === scope?.id), spend = scope ? supervisorSpend(status, scope.id) : { sessions: 0, turns: 0, uncertain: 0 };
        const effects = binding ? activationEffects(status, binding.scopeId, binding.epoch) : null;
        const provisionInput = project ? recordedProvision(status, project.id) : null;
        const stopped = binding?.state === "suspect" || !!provisionInput && status.commands.some(c => c.id === stableId("project-provision-abort", provisionInput.requestId));
        const aliasKnown = !project || [project.name, ...project.aliases].some(name => normalizedName(name) === normalizedName(row.name));
        const reason = row.reason ?? (!aliasKnown ? "Registry name changed; record a reviewed alias before provisioning." : !project ? "Awaiting reviewed admission and allocation." : !project.owner ? "Durable profile and caps are missing." :
          stopped ? "Provisioning stopped; identity and spend retained. Inspect any uncertain operation." :
          !binding ? provisionInput ? "Provisioning incomplete; inspect and resume the recorded request." : null : binding.state !== "active" || effects?.send?.state !== "succeeded" ? "Provisioning incomplete; inspect and resume the recorded request." : null);
        return { ...row, hostId: project?.owner?.hostId ?? (row.directory ? "local" : null), projectId: row.projectId, scopeId: project?.scopeId ?? row.scopeId,
          reason, state: row.reason ? "held" : project?.state ?? "unadmitted", version: project?.version ?? 0, aliases: project?.aliases ?? [],
          agentId: binding?.agentId ?? null, workspaceId: binding?.workspaceId ?? null, provisionRequestId: effects?.create?.requestId ?? provisionInput?.requestId ?? null, provisionInput,
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
        if (!project || project.version !== input.projectVersion || !marker || digest(marker.actor) !== digest(UI) ||
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
    await this.mutate(input.homeId, async (home, store, config) => {
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
    return this.read();
  }
  private async admit(home: string, store: SupervisionStore, requestId: string, actor: SupervisionActor, input: Extract<ProjectAdmin, { op: "admit" }>, generalId: string, app = false) {
    const catalog = await registry(home);
    if (catalog.digest !== input.registryDigest) refuse("STALE", "Project registry changed; review the current census.");
    const entry = catalog.rows.find(p => normalizedName(p.name) === normalizedName(input.name));
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
      const value: ProjectRecord = { ...project, version: project.version + 1, owner: { directory: entry.directory!, hostId: "local", registryDigest: catalog.digest,
        generalAgentId: generalId, profile: input.profile, limits: input.limits } };
      const mutations = [{ kind: "project" as const, value }]; return { mutations, expectedVersions: expected(status, mutations), result };
    });
  }
  /** The app review is durable before admission. It never impersonates General or captain-ui. */
  async admitSetup(input: z.infer<typeof ProjectSetupInputSchema>, actor: SupervisionActor, validate: (status?: SupervisionStatus) => Promise<void>) {
    await this.mutate(input.homeId, async (home, store, config) => {
      await validate(await store.read());
      await store.transactCommand(stableId("project-setup-input", input.requestId), digest(input), actor,
        async () => ({ mutations: [], expectedVersions: [], result: { ...result, projectSetup: input } }));
      const project = (await store.read()).projects?.projects.find(p => p.id === input.review.projectId);
      if (!project?.owner) await this.admit(home, store, stableId("project-setup-admit", input.requestId), actor, {
        op: "admit", registryDigest: input.review.registryDigest, name: input.review.name, aliases: input.review.aliases,
        source: input.review.source, profile: input.review.profile, budget: input.review.budget, limits: input.review.limits,
      }, config.mateAgentId, true);
    }, true, false, true);
  }
  async memory(input: { homeId: string; projectId: string }) {
    const config = await this.config(), home = resolveHome(config);
    if (input.homeId !== workflowHomeIdentity(home)) refuse("STALE", "Home changed.");
    // Borrow an inert reader, never mutate/initialize on a context view.
    const reader = new SupervisionStore(this.runtime.root, home), context = await readProjectContext(reader, input.projectId), status = await reader.read();
    const pending = status.projects?.memoryProposals.filter(p => p.projectId === input.projectId && p.state === "proposed") ?? [];
    if (pending.length > 32) refuse("HELD", "Memory review exceeds its 32-proposal snapshot bound.");
    let bytes = Buffer.byteLength(JSON.stringify(context));
    const proposals = [];
    for (const p of pending) {
      const content = await reader.readBlob(p.textDigest, 16384); bytes += content.length;
      if (bytes > 128 * 1024) refuse("HELD", "Memory review exceeds its 128 KiB snapshot bound.");
      const text = Buffer.from(content).toString("utf8");
      if (text.includes("\0") || !Buffer.from(text).equals(Buffer.from(content))) refuse("HELD", "Memory proposal is not valid UTF-8 text.");
      proposals.push({ id: p.id, version: p.version, key: p.key, expectedVersion: p.expectedVersion, digest: p.textDigest, text });
    }
    if ((await reader.read()).hash !== status.hash) refuse("STALE", "Memory review changed; reload it.");
    return { ...context, proposals };
  }
  async provision(input: { homeId: string; requestId: string; projectId: string; projectVersion: number }, paseo: PaseoApi,
    setup?: { opening: string; validate(status?: SupervisionStatus): Promise<void> }) {
    ProjectProvisionInputSchema.parse(input);
    await serialized(`firstmate.project-provision:${input.homeId}:${input.projectId}`, () => this.mutate(input.homeId, async (home, store, config) => {
      let status = await store.read();
      const project = status.projects?.projects.find(p => p.id === input.projectId);
      if (!project?.owner) refuse("HELD", "Reviewed project with durable profile and caps required.");
      if (!setup && status.commands.some(c => c.result.projectSetup?.review.projectId === project.id))
        refuse("HELD", "Use Check saved setup to continue this project's exact app review.");
      const retained = recordedProvision(status, project.id);
      if (retained && retained.requestId !== input.requestId) return;
      if (status.commands.some(c => c.id === stableId("project-provision-abort", input.requestId))) refuse("HELD", "Provisioning was stopped; its identity and spend remain reserved.");
      const marker = status.commands.find(c => c.id === stableId("project-provision-input", input.requestId));
      if (marker && (marker.inputHash !== digest(input) || digest(marker.actor) !== digest(UI))) refuse("CONFLICT", "Request ID belongs to different provisioning input or provenance.");
      const binding = status.bindings.find(b => b.scopeId === project.scopeId), accepted = status.commands.find(c => c.id === input.requestId);
      if (binding && accepted) {
        const recorded = activationEffects(status, project.scopeId, binding.epoch);
        if (recorded.create?.requestId === input.requestId && [recorded.workspace, recorded.create, recorded.send].every(e => e?.state === "succeeded")) return;
      }
      if (project.state !== "admitted") refuse("HELD", "Project admissions are stopped.");
      await setup?.validate(status);
      if (accepted && project.version !== input.projectVersion) refuse("HELD", "The retained provisioning's project version changed; reconcile its existing effects before proceeding.");
      if (!accepted && project.version !== input.projectVersion) refuse("STALE", "Project allocation or ownership changed; refresh before provisioning.");
      await store.transactCommand(stableId("project-provision-input", input.requestId), digest(input), UI,
        async current => {
          const owner = current.projects?.projects.find(p => p.id === project.id);
          if (owner?.version !== input.projectVersion || owner.state !== "admitted") refuse("STALE", "Project admission changed before recording provisioning.");
          return { mutations: [], expectedVersions: [], result: { ...result, projectProvision: input } };
        });
      const catalog = await registry(home), entry = catalog.rows.find(p => p.projectId === project.id);
      if (!entry || entry.reason || entry.directory !== project.owner.directory || ![project.name, ...project.aliases].some(name => normalizedName(name) === normalizedName(entry.name))) refuse("HELD", "Current registry identity or reviewed alias does not match admitted ownership.");
      const receiver = this.options.receiver?.(paseo) ?? new SupervisionUiReceiver(paseo, this.runtime.root, { projectMates: true });
      const commands = new SupervisionCommands(store, home, { enabled: true }), gateway = new SupervisionGateway(store, commands, home, receiver, { enabled: true, policyFence: this.runtime.features?.gateway(home, "projectMates", () => store.read()),
        admissionCheck: async (current, effect) => {
          await setup?.validate(current);
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
          const live = (await registry(home)).rows.find(r => r.projectId === project.id);
          if (!live || live.reason || live.directory !== project.owner!.directory) refuse("HELD", "Registry ownership changed before dispatch.");
        } });
      const sessions = new SupervisorSessions(store, gateway, receiver, { enabled: true,
        featurePolicy: async () => this.runtime.features?.reservation(home, "projectMates"),
        reserveBoundary: run => this.runtime.features ? this.runtime.features.boundary(home, run) : run(), limits: project.owner.limits,
        globalMateId: async () => (await this.checkedConfig(input.homeId, config.mateAgentId)).config.mateAgentId || null,
        reserveCheck: async current => {
          await setup?.validate(current);
          await this.checkedConfig(input.homeId, config.mateAgentId);
          const owner = current.projects?.projects.find(p => p.id === project.id);
          if (owner?.version !== input.projectVersion || owner.state !== "admitted" || current.commands.some(c => c.id === stableId("project-provision-abort", input.requestId)))
            refuse("HELD", "Project provisioning admission changed before reservation.");
        } });
      if (!binding) {
        const context = setup ? null : await readProjectContext(store, project.id);
        const opening = setup?.opening ?? await message(TEMPLATES.projectMateOpening, { project: project.name, scopeId: project.scopeId,
          context: JSON.stringify({ ...context, directory: project.owner.directory, limits: project.owner.limits }).replace(/</g, "\\u003c") });
        await withScopeAdmission(input.homeId, async () => {
          await this.checkedConfig(input.homeId, config.mateAgentId);
          status = await store.read();
          if (status.commands.some(c => c.id === stableId("project-provision-abort", input.requestId))) refuse("HELD", "Provisioning was stopped before admission.");
          const capacity = await this.capacity(home);
          await checkGeneralHeadroom(status, receiver, capacity.slots, capacity.generalHeadroom);
          await sessions.prepare({ requestId: input.requestId, scopeId: project.scopeId, scopeVersion: status.scopes.find(s => s.id === project.scopeId)!.version,
            profile: project.owner!.profile, opening, purpose: "work" }, UI);
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
  registerProjectSetup(server, projects);
  server.handle(readProjectRuntime, () => projects.read());
  server.handle(administerProject, input => projects.admin(input));
  server.handle(provisionProjectFromUi, (input, { paseo }) => projects.provision(input, paseo));
  server.handle(readProjectMemory, input => projects.memory(input));
  server.handle(recoverProjectRuntimeFromUi, input => projects.recover(input));
  server.handle(abortProjectProvisionFromUi, input => projects.abort(input));
}
