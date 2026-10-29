/** Checked app review over Build A. Reads never acquire a writer or initialize a journal. */
import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { addProjectSetupFolder, commitProjectSetup, previewProjectSetup, readProjectSetup, readSavedProjectSetup, resumeProjectSetup, saveProjectSetupInstructions,
  ProjectSetupChoicesSchema, ProjectSetupFolderSchema, ProjectSetupInstructionsSchema, type ProjectSetupChoices, type ProjectSetupCatalog, type ProjectSetupPreview } from "../shared/project-setup";
import { ProjectSetupInputSchema } from "../shared/supervision-policy";
import { normalizedName } from "../shared/supervision-projects";
import type { PaseoApi } from "./host-types";
import type { ProjectRuntime } from "./project-runtime";
import { migrationTargets } from "./migration";
import { digest, publishBytes } from "./submissions";
import { refuse, stableId } from "./supervision-effects";
import { checkGeneralHeadroom } from "./supervision-headroom";
import { checkPolicySource, policyRef } from "./supervision-policy";
import { readTextFile, replaceTextIfUnchanged, resolveInHome } from "./files";
import { message, TEMPLATES } from "./templates";
import { serialized } from "./serialize";
import { selectProjectFolder } from "./project-folder-picker";
import { requireNoMigration } from "./mate";
import type { SupervisionStatus } from "../shared/supervision";
import { activationEffects } from "./supervisor-sessions";
import { parseProjects } from "./home";
import { registerProjectBatches } from "./project-setup-batch";

export const PROJECT_SETUP_UI = { kind: "plugin-ui-unverified" as const, id: "unauthenticated-plugin-call", source: "project setup review (unverified)" };
type Input = z.infer<typeof ProjectSetupInputSchema>;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const contextOnly = (path: string) => /^data\/(projects|backlog|suggestions|learnings|project-mates|maintenance|workflows)\.md$/i.test(path.replace(/\\/g, "/")) || /^data\/(scoped|project-memory)\//i.test(path.replace(/\\/g, "/"));
export class ProjectSetupService {
  constructor(readonly projects: ProjectRuntime, private readonly options: {
    models?: (paseo: PaseoApi) => Promise<ProjectSetupCatalog["models"]>; folder?: () => Promise<string | null>;
  } = {}) {}
  private async context(homeId: string, observed?: SupervisionStatus) {
    const c = await this.projects.inputs(observed);
    if (c.status.homeId !== homeId) refuse("STALE", "FirstMate's home changed. Close setup and open it again on this home.");
    requireNoMigration(c.config);
    return c;
  }
  private async models(paseo: PaseoApi) {
    let timer!: ReturnType<typeof setTimeout>;
    try { return await Promise.race([this.options.models?.(paseo) ?? migrationTargets(paseo).then(r => r.targets),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Models and permissions couldn't be checked. Reconnect the host and refresh setup.")), 5000); })]); }
    finally { clearTimeout(timer); }
  }
  private folderIssues(c: Awaited<ReturnType<ProjectRuntime["inputs"]>>) {
    const norm = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
    return c.catalog.rows.filter(r => !r.directory && r.location && isAbsolute(r.location)).map(r => {
      const retained = c.status.projects?.projects.some(p => [p.name, ...p.aliases].some(n => normalizedName(n) === normalizedName(r.name)) ||
        p.owner && norm(p.owner.directory) === norm(r.location!)) || c.status.commands.some(command => {
          const review = command.result.projectSetup?.review;
          return review && [review.name, ...review.aliases].some(n => normalizedName(n) === normalizedName(r.name));
        });
      return { name: r.name, location: r.location!, rowDigest: digest({ name: r.name, location: r.location }),
        canReplace: !retained && isAbsolute(r.location!) && ["Project directory is unavailable; identity was not guessed.", "Project location is not a directory."].includes(r.reason ?? "") &&
          !c.status.problems.length && !c.problems.length && ["current", "uninitialized"].includes(c.status.freshness) };
    });
  }
  async read(homeId: string, paseo: PaseoApi): Promise<ProjectSetupCatalog> {
    const { home, status, catalog } = await this.context(homeId), problems: string[] = [], sources: ProjectSetupCatalog["sources"] = [];
    let models: ProjectSetupCatalog["models"] = [];
    try { models = await this.models(paseo); } catch { problems.push("Models and permissions couldn't be checked. Reconnect this host and refresh setup."); }
    const paths = new Set(status.policySources.filter(s => !status.policySources.some(n => n.supersedes.includes(s.id))).map(s => s.path));
    try { for (const name of (await readdir(resolve(home, "data"))).filter(n => n.endsWith(".md")).sort().slice(0, 64)) paths.add(`data/${name}`); }
    catch { problems.push("Project instructions couldn't be listed. Check access to this home's files, then refresh."); }
    let remaining = 512 * 1024;
    for (const path of [...paths].slice(0, 64)) try {
      const file = await readTextFile(home, path);
      if (file.content === null || file.size > 64 * 1024) continue;
      if (file.size > remaining) { problems.push("Some instruction files exceed this review's size limit. Choose a shorter recorded instruction source or save this project's instructions here."); break; }
      remaining -= file.size;
      sources.push({ path, text: file.content, problem: contextOnly(path) ? "This is a work record, not instructions authorizing project setup." : !file.content.trim() || /\(none yet\)/i.test(file.content) ? "No project permission has been recorded here. Choose instructions that authorize this project's setup." : null });
    } catch { sources.push({ path, text: "", problem: "These instructions couldn't be read. Restore access or choose another recorded source." }); }
    const snapshot = await this.projects.read(); await this.context(homeId);
    if (snapshot.homeId !== homeId) refuse("STALE", "FirstMate's home changed. Close setup and open it again.");
    return { snapshot, models, sources, problems, folderIssues: this.folderIssues(await this.context(homeId)), reviewed: (status.projects?.projects ?? []).filter(p => p.owner && p.budget).map(p => ({
      homeId, name: catalog.rows.find(r => r.projectId === p.id)?.name ?? p.name, profile: p.owner!.profile, limits: { supervisorSessions: 1, supervisorTurns: p.owner!.limits.supervisorTurns }, budget: p.budget!,
      sourcePath: status.policySources.find(s => p.sourceVector.some(ref => ref.id === s.id))?.path ?? null,
    })) };
  }
  async preview(raw: ProjectSetupChoices, paseo: PaseoApi, aggregate = false): Promise<ProjectSetupPreview> {
    const choices = ProjectSetupChoicesSchema.parse(raw), c = await this.context(choices.homeId), reasons: string[] = [];
    const snapshot = await this.projects.read(), p = snapshot.projects.find(p => p.name === choices.name);
    const row = c.catalog.rows.find(r => r.name === choices.name), saved = c.status.projects?.projects.find(p => p.id === row?.projectId);
    if (!c.config.mateAgentId) reasons.push("Set up FirstMate first, then return to project setup.");
    if (c.status.problems.length || c.problems.length || !["current", "uninitialized"].includes(c.status.freshness)) reasons.push("Some saved work couldn't be checked. Open Advanced work details and resolve it before setup.");
    if (!row || row.reason || !row.projectId || !row.directory || !c.catalog.digest) reasons.push(row?.reason ?? "This project is no longer listed. Refresh projects or choose its folder again.");
    if (saved && ![saved.name, ...saved.aliases].some(n => normalizedName(n) === normalizedName(choices.name))) reasons.push("This project's name changed. Restore its reviewed name or record the alias in Advanced work details.");
    if (saved?.state === "stopped") reasons.push("This project's help was stopped. Review its saved allocation in Advanced work details before resuming.");
    if (p?.agentId || p?.provisionInput) reasons.push("This project already has a saved setup. Check saved setup or open its conversation; no new mate will be created.");
    const profile = saved?.owner?.profile ?? choices.profile, limits = saved?.owner?.limits ?? choices.limits, budget = saved?.budget ?? choices.budget;
    const models = await this.models(paseo).catch(() => []), model = models.find(m => m.provider === profile?.provider);
    if (!profile || !model || !model.modes.some(m => m.id === profile.modeId) || profile.thinkingOptionId && !model.thinking.some(t => t.id === profile.thinkingOptionId)) reasons.push("Choose an available model and its actual permission mode. Refresh setup if the saved profile is unavailable.");
    if (!limits || limits.supervisorSessions !== 1 || !budget || budget.agents < 1 || budget.turns < limits.supervisorTurns) reasons.push("Review one session, its total turn limit and a project allocation that covers it. No preset spending limits have been approved.");
    let source = saved ? c.status.policySources.find(s => saved.sourceVector.some(ref => ref.id === s.id && ref.digest === digest(s))) : undefined;
    if (!source && choices.sourcePath && contextOnly(choices.sourcePath)) reasons.push("Project lists, work records and memory cannot authorize setup. Choose or write this project's instructions instead.");
    if (!source && choices.sourcePath && !contextOnly(choices.sourcePath)) {
      try {
        const file = await readTextFile(c.home, choices.sourcePath);
        if (file.content === null || file.size > 64 * 1024 || !file.content.trim() || /\(none yet\)/i.test(file.content)) throw Error();
        const text = file.content.replace(/\r\n/g, "\n");
        source = { id: stableId("project-setup-source", digest([choices.homeId, row?.projectId, choices.sourcePath, sha(file.content)])), version: 1,
          path: choices.sourcePath, lineStart: 1, lineEnd: text.split("\n").length, fileHash: sha(file.content), excerptHash: sha(text), provenance: PROJECT_SETUP_UI, supersedes: [] };
      } catch { reasons.push("The selected instructions are unavailable or contain no recorded project permission. Choose another source, or review instructions in Home files."); }
    }
    if (!source) reasons.push("Choose recorded instructions that authorize this project's setup. Reading a project list does not grant permission.");
    else try { await checkPolicySource(c.home, source); if (c.status.policySources.some(s => s.supersedes.includes(source!.id))) throw Error(); }
    catch { reasons.push("The recorded instructions changed. Refresh and review their current contents before continuing."); }
    if (saved) for (const ref of saved.sourceVector) {
      const value = c.status.policySources.find(s => s.id === ref.id);
      try {
        if (!value || digest(policyRef("policy-source", value)) !== digest(ref) || c.status.policySources.some(s => s.supersedes.includes(ref.id))) throw Error();
        await checkPolicySource(c.home, value);
      } catch { reasons.push("One of this project's reviewed instruction sources changed or is unavailable. Restore its reviewed source before continuing."); }
    }
    let capacity;
    try { capacity = await this.projects.capacity(c.home); if (!aggregate) await checkGeneralHeadroom(c.status, this.projects.setupReceiver(paseo), capacity.slots, capacity.generalHeadroom); }
    catch { reasons.push("There isn't confirmed room for this mate while keeping FirstMate's reserved capacity. Review capacity in Help settings, choose fewer helpers, or check saved operations."); }
    const policy = await this.projects.runtime.features?.read(c.home);
    if (!snapshot.enabled) reasons.push("Turn on project controls in Help settings, then return here. Turning them on creates no mate.");
    if (reasons.length || !row?.projectId || !profile || !limits || !budget || !source || !capacity || !c.catalog.digest) return { choices, review: null, reviewDigest: null, reasons };
    const opening = await message(TEMPLATES.projectMateOpening, { project: row.name, scopeId: row.scopeId!,
      context: JSON.stringify({ projectId: row.projectId, name: row.name, directory: row.directory, limits, source: { path: source.path, fileHash: source.fileHash }, authority: "none" }).replace(/</g, "\\u003c") });
    const review: Input["review"] = { homeId: choices.homeId, registryDigest: c.catalog.digest, generalAgentId: c.config.mateAgentId, projectId: row.projectId,
      name: row.name, projectVersion: saved?.version ?? 0, aliases: saved?.aliases ?? [], source, profile, budget,
      limits: { supervisorSessions: 1, supervisorTurns: limits.supervisorTurns }, capacity,
      policyHash: digest(policy ?? { enabled: snapshot.enabled, capacity }), sourceVector: saved?.sourceVector ?? [policyRef("policy-source", source)], opening,
      spent: { sessions: p?.sessions ?? 0, turns: p?.turns ?? 0 } };
    return { choices, review, reviewDigest: digest(review), reasons };
  }
  async status(homeId: string) {
    const { status } = await this.context(homeId);
    const snapshot = await this.projects.read(); await this.context(homeId);
    if (snapshot.homeId !== homeId) refuse("STALE", "FirstMate's home changed. Close setup and open it again.");
    const requests = status.commands.flatMap(c => c.result.projectSetup && c.id === stableId("project-setup-input", c.result.projectSetup.requestId) &&
      c.inputHash === digest(c.result.projectSetup) && digest(c.actor) === digest(PROJECT_SETUP_UI) ? [c.result.projectSetup] : []);
    // Only the create lookup may be retried here. A reserved opening proves no send was armed.
    const recoverableCreates = requests.filter(input => {
      const project = snapshot.projects.find(p => p.projectId === input.review.projectId), binding = status.bindings.find(b => b.scopeId === project?.scopeId);
      const effects = binding && activationEffects(status, binding.scopeId, binding.epoch);
      return !status.problems.length && status.freshness === "current" && project?.state === "admitted" && binding?.state !== "suspect" &&
        project?.provisionInput?.requestId === stableId("project-setup-provision", input.requestId) && effects?.send?.state === "reserved" &&
        !!effects.create && ["dispatching", "accepted", "uncertain"].includes(effects.create.state) && !project.reason?.startsWith("Provisioning stopped");
    }).map(input => input.requestId);
    return { snapshot, requests, recoverableCreates };
  }
  async commit(raw: Input, paseo: PaseoApi) {
    const input = ProjectSetupInputSchema.parse(raw), r = input.review;
    if (input.homeId !== r.homeId || input.reviewDigest !== digest(r)) refuse("CONFLICT", "The setup review does not match its recorded contents. Refresh and review again.");
    return serialized(`project-setup:${input.homeId}:${r.projectId}`, async () => {
      const saved = (await this.status(input.homeId)).requests;
      const old = saved.find(s => s.requestId === input.requestId), other = saved.find(s => s.review.projectId === r.projectId && s.requestId !== input.requestId);
      if (old && digest(old) !== digest(input)) refuse("CONFLICT", "This saved request has different choices. Check its original setup.");
      if (other) refuse("CONFLICT", "This project already has a saved setup. Check that original request before making any change.");
      const validate = async (observed?: SupervisionStatus) => {
        const c = await this.context(input.homeId, observed), row = c.catalog.rows.find(p => p.projectId === r.projectId);
        if (c.status.commands.some(command => command.result.projectProvision?.projectId === r.projectId &&
          command.result.projectProvision.requestId !== stableId("project-setup-provision", input.requestId)))
          refuse("STALE", "Another setup request already owns this project. Check its original saved setup or open its conversation; this review creates nothing.");
        if (c.catalog.digest !== r.registryDigest || !row || row.reason || row.name !== r.name || c.config.mateAgentId !== r.generalAgentId)
          refuse("STALE", "The project list, folder, name or FirstMate changed. Review the current project before any new setup effect.");
        for (const ref of r.sourceVector) {
          const source = ref.id === r.source.id ? r.source : c.status.policySources.find(s => s.id === ref.id);
          if (!source || digest(policyRef("policy-source", source)) !== digest(ref) || c.status.policySources.some(s => s.supersedes.includes(ref.id))) refuse("STALE", "A saved instruction source changed. Restore the reviewed sources before continuing this exact setup.");
          await checkPolicySource(c.home, source);
        }
        if (c.status.policySources.some(s => s.supersedes.includes(r.source.id))) refuse("STALE", "Project instructions were replaced. Review the new instructions.");
        const policy = await this.projects.runtime.features?.read(c.home), capacity = await this.projects.capacity(c.home);
        const enabled = policy?.effective.projectMates ?? this.projects.setupEnabled;
        if (!enabled || digest(policy ?? { enabled, capacity }) !== r.policyHash) refuse("STALE", "Help settings changed. Review the current setup before continuing.");
        const models = await this.models(paseo), model = models.find(m => m.provider === r.profile.provider);
        if (!model?.modes.some(m => m.id === r.profile.modeId) || r.profile.thinkingOptionId && !model.thinking.some(t => t.id === r.profile.thinkingOptionId)) refuse("HELD", "The reviewed model or permission is unavailable. Restore it and check saved setup; another model will not be chosen.");
        const p = c.status.projects?.projects.find(p => p.id === r.projectId);
        if (p?.owner) {
          const expectedVersion = r.projectVersion || 2;
          if (p.version !== expectedVersion || p.state !== "admitted" || digest(p.owner.profile) !== digest(r.profile) || digest(p.owner.limits) !== digest(r.limits) || digest(p.budget) !== digest(r.budget) ||
            digest(p.sourceVector) !== digest(r.sourceVector))
            refuse("STALE", "The project's reviewed instructions, allocation or profile changed. Inspect its saved setup before continuing.");
        } else if (r.projectVersion || p && (p.version !== 1 || p.state !== "admitted" || p.name !== r.name || digest(p.budget) !== digest(r.budget) ||
          digest(p.sourceVector) !== digest(r.sourceVector)))
          refuse("STALE", "Project admission changed. Inspect saved setup before continuing.");
      };
      if (!old) {
        const preview = await this.preview({ homeId: input.homeId, name: r.name, profile: r.profile, budget: r.budget, limits: r.limits, sourcePath: r.source.path }, paseo);
        if (preview.reviewDigest !== input.reviewDigest) refuse("STALE", preview.reasons.join(" ") || "The project review changed. Review its current profile, permissions and limits.");
      }
      await this.projects.admitSetup(input, PROJECT_SETUP_UI, validate);
      const p = (await this.projects.read()).projects.find(p => p.projectId === r.projectId)!;
      const requestId = stableId("project-setup-provision", input.requestId);
      if (p.provisionInput && p.provisionInput.requestId !== requestId) refuse("STALE", "Another setup request owns this project. Keep and inspect its original saved operation.");
      const provision = p.provisionInput ?? { homeId: input.homeId, projectId: r.projectId, projectVersion: p.version, requestId };
      return this.projects.provision(provision, paseo, { opening: r.opening, validate });
    });
  }
  async resume(homeId: string, requestId: string, paseo: PaseoApi) {
    const input = (await this.status(homeId)).requests.find(r => r.requestId === requestId) ?? refuse("UNKNOWN_OWNER", "No saved setup matches this request. Refresh saved setup; do not create a replacement.");
    return this.commit(input, paseo);
  }
  async instructions(raw: { homeId: string; requestId: string; registryDigest: string; name: string; text: string }) {
    const input = ProjectSetupInstructionsSchema.parse(raw);
    const c = await this.context(input.homeId), row = c.catalog.rows.find(r => r.name === input.name);
    if (c.catalog.digest !== input.registryDigest || !row?.projectId || row.reason) refuse("STALE", "This project's identity changed. Refresh and choose it again before recording instructions.");
    const path = `data/project-setup-${input.requestId}.md`, { absolute } = await resolveInHome(c.home, path);
    const content = `${await message(TEMPLATES.projectSetupInstructions, { project: input.name, projectId: row.projectId, instructions: input.text.trim() })}\n`;
    if ((await this.context(input.homeId)).catalog.digest !== input.registryDigest) refuse("STALE", "Projects changed before saving instructions. Refresh and choose the project again.");
    try { await publishBytes(absolute, content); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await readFile(absolute, "utf8") !== content) refuse("CONFLICT", "This saved instructions request has different text. Keep its original text or save a new reviewed version.");
    }
    return { path };
  }
  async folder(raw: z.infer<typeof ProjectSetupFolderSchema>) {
    const input = ProjectSetupFolderSchema.parse(raw);
    const c = await this.context(input.homeId);
    if (c.catalog.digest !== input.registryDigest) refuse("STALE", "Projects changed. Refresh before choosing a folder.");
    const checkReplacement = (current: typeof c) => {
      if (!input.replace) return;
      const issue = this.folderIssues(current).find(r => r.name === input.name && r.location === input.replace!.location && r.rowDigest === input.replace!.rowDigest);
      if (!issue?.canReplace) refuse("HELD", "This folder cannot be replaced. Restore the original folder for a retained project; refresh projects before reviewing an unadmitted correction.");
    };
    checkReplacement(c);
    let picked: string | null;
    try { picked = await (this.options.folder?.() ?? selectProjectFolder()); }
    catch { return refuse("UNSUPPORTED", "The folder picker couldn't open on this computer. Choose a registered project, or restore access to the computer's folder picker and try again."); }
    if (!picked) return this.projects.read();
    const directory = await realpath(picked);
    if (!(await stat(directory)).isDirectory() || /[\r\n]|\s[-–—]\s/.test(directory)) refuse("HELD", "Choose a local folder whose name can be recorded safely in the project list.");
    return this.projects.withRegistry(input.homeId, async () => {
      const fresh = await this.context(input.homeId), norm = (v: string) => process.platform === "win32" ? resolve(v).toLowerCase() : resolve(v);
      if (fresh.catalog.digest !== input.registryDigest) refuse("STALE", "Projects changed while the picker was open. Refresh and choose the folder again.");
      checkReplacement(fresh);
      if (fresh.catalog.rows.some(r => (!input.replace && normalizedName(r.name) === normalizedName(input.name)) || r.directory === norm(directory)) ||
        fresh.status.projects?.projects.some(p => p.owner && norm(p.owner.directory) === norm(directory))) refuse("CONFLICT", "This name or folder is already registered. Choose its existing project or a different name.");
      const file = await readTextFile(fresh.home, "data/projects.md");
      if (file.content === null || digest(file.content) !== input.registryDigest) refuse("STALE", "The project list changed. Refresh and try again.");
      checkReplacement(await this.context(input.homeId));
      // Registration is identity only: no delivery mode, yolo or authority is inferred.
      let content = `${file.content.trimEnd()}\n- ${input.name} - ${directory}\n`;
      if (input.replace) {
        let replaced = 0;
        const visibleLines = file.content.replace(/<!--[^]*?-->/g, comment => comment.replace(/[^\r\n]/g, " ")).split(/(?<=\n)/);
        content = file.content.split(/(?<=\n)/).map((line, index) => {
          const row = parseProjects(visibleLines[index]!)[0];
          if (!row || row.name !== input.name || row.location !== input.replace!.location) return line;
          const start = line.indexOf(row.location, line.search(/\s+[-–—]\s+/));
          if (start < 0) refuse("STALE", "The original folder row changed. Refresh before correcting it.");
          replaced++; return line.slice(0, start) + directory + line.slice(start + row.location.length);
        }).join("");
        if (replaced !== 1) refuse("HELD", "The original folder row is ambiguous. Restore one unambiguous project entry before correcting it.");
      }
      await replaceTextIfUnchanged(fresh.home, "data/projects.md", file.content, content);
      return this.projects.read();
    });
  }
}
export function registerProjectSetup(server: Pick<PluginServerContext, "handle">, projects: ProjectRuntime) {
  const service = new ProjectSetupService(projects);
  server.handle(readProjectSetup, (i, { paseo }) => service.read(i.homeId, paseo));
  server.handle(previewProjectSetup, (i, { paseo }) => service.preview(i, paseo));
  server.handle(commitProjectSetup, (i, { paseo }) => service.commit(i, paseo));
  server.handle(readSavedProjectSetup, i => service.status(i.homeId));
  server.handle(resumeProjectSetup, (i, { paseo }) => service.resume(i.homeId, i.requestId, paseo));
  server.handle(addProjectSetupFolder, i => service.folder(i));
  server.handle(saveProjectSetupInstructions, i => service.instructions(i));
  registerProjectBatches(server, service);
}
