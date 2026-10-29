/** Durable intent only. All outcomes come from the individual setup's authoritative receipts. */
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ProjectSetupChoices } from "../shared/project-setup";
import { cancelProjectBatch, commitProjectBatch, continueProjectBatch, previewProjectBatch, readProjectBatches,
  ProjectBatchCommitSchema, type ProjectBatchCommit, type ProjectBatchPreview, type ProjectBatchStatus } from "../shared/project-setup-batch";
import { SupervisionUuid } from "../shared/supervision";
import type { ProjectSetupService } from "./project-setup";
import type { PaseoApi } from "./host-types";
import { digest, publish } from "./submissions";
import { refuse, stableId } from "./supervision-effects";
import { pluginOccupancy, withScopeAdmission } from "./supervision-headroom";
import { serialized } from "./serialize";
import { workflowHomeIdentity } from "./workflow-ownership";
import { activationEffects } from "./supervisor-sessions";

export class ProjectBatchService {
  constructor(readonly setup: ProjectSetupService) {}
  private async context(homeId: string) {
    const c = await this.setup.projects.inputs();
    if (workflowHomeIdentity(c.home) !== homeId) refuse("STALE", "FirstMate's home changed. Close setup and open it again.");
    return c;
  }
  private directory(homeId: string) { return join(this.setup.projects.runtime.root, "project-setup-batches", digest(homeId)); }
  private path(homeId: string, batchId: string) { return join(this.directory(homeId), `${SupervisionUuid.parse(batchId)}.json`); }
  private async load(homeId: string, batchId: string): Promise<ProjectBatchCommit | null> {
    let bytes: string;
    try { bytes = await readFile(this.path(homeId, batchId), "utf8"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
    const input = ProjectBatchCommitSchema.parse(JSON.parse(bytes));
    if (input.manifest.homeId !== homeId || input.manifest.batchId !== batchId || digest(input.manifest) !== input.reviewDigest ||
      input.manifest.children.some(c => digest(c.review) !== c.reviewDigest || c.requestId !== stableId("project-batch-child", batchId, c.review.projectId)))
      refuse("HELD", "Saved project setup is inconsistent. Review Advanced work details before continuing; nothing will be recreated.");
    return input;
  }
  private async cancelled(input: ProjectBatchCommit) {
    const { homeId, batchId } = input.manifest, path = this.path(homeId, batchId).replace(/\.json$/, ".cancel.json");
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!value || typeof value !== "object" || digest(value) !== digest({ batchDigest: input.reviewDigest, cancelled: true }))
        refuse("HELD", "Saved cancellation couldn't be checked. Inspect its details before continuing.");
      return true;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
  }
  async preview(homeId: string, batchId: string, choices: ProjectSetupChoices[], paseo: PaseoApi): Promise<ProjectBatchPreview> {
    SupervisionUuid.parse(batchId);
    if (!choices.length || choices.length > 64 || choices.some(c => c.homeId !== homeId) || new Set(choices.map(c => c.name)).size !== choices.length)
      refuse("CONFLICT", "Choose 1 to 64 distinct projects from this home.");
    const c = await this.context(homeId), reviews = [];
    for (const choice of [...choices].sort((a, b) => a.name < b.name ? -1 : 1)) reviews.push(await this.setup.preview(choice, paseo, true));
    const reasons = reviews.flatMap(r => r.reasons.map(reason => `${r.choices.name}: ${reason}`));
    let capacity: ProjectBatchPreview["capacity"] = null;
    try {
      const limits = await this.setup.projects.capacity(c.home), occupied = await pluginOccupancy(c.status, this.setup.projects.setupReceiver(paseo));
      capacity = { ...limits, occupied, available: Math.max(0, limits.slots - limits.generalHeadroom - occupied) };
      if (choices.length > capacity.available) reasons.push(`${choices.length} selected; room for ${capacity.available}. Review capacity in Help settings or choose fewer projects. FirstMate keeps ${capacity.generalHeadroom} reserved slots. Provider quota is unknown.`);
    } catch { reasons.push("Available capacity couldn't be checked. Reconnect this host and check saved operations before creating mates."); }
    const children = reviews.flatMap(r => r.review && r.reviewDigest ? [{ homeId, requestId: stableId("project-batch-child", batchId, r.review.projectId), review: r.review, reviewDigest: r.reviewDigest }] : []);
    let commit: ProjectBatchCommit | null = null;
    if (!reasons.length && children.length === choices.length && capacity) {
      const manifest = { version: 1 as const, homeId, batchId, registryDigest: children[0]!.review.registryDigest, policyHash: children[0]!.review.policyHash, children, capacity };
      commit = ProjectBatchCommitSchema.parse({ manifest, reviewDigest: digest(manifest) });
    }
    await this.context(homeId);
    return { reviews, commit, reasons, capacity };
  }
  private async projectStatus(input: ProjectBatchCommit): Promise<ProjectBatchStatus> {
    const { homeId } = input.manifest, saved = await this.setup.status(homeId), c = await this.context(homeId), cancelled = await this.cancelled(input);
    const problems = [...saved.snapshot.problems.filter(p => !saved.snapshot.associationWarnings?.includes(p)), ...c.status.problems, ...c.problems];
    if (!["uninitialized", "current"].includes(c.status.freshness)) problems.push("Some saved work couldn't be checked. Review details before continuing.");
    const children: ProjectBatchStatus["children"] = await Promise.all(input.manifest.children.map(async child => {
      let diagnostic: string | null = null;
      try {
        const record = z.object({ batchDigest: z.string(), requestId: z.string(), reason: z.string().max(2000) }).strict().parse(JSON.parse(
          await readFile(this.path(homeId, input.manifest.batchId).replace(/\.json$/, `.${child.requestId}.hold.json`), "utf8")));
        if (record.batchDigest !== input.reviewDigest || record.requestId !== child.requestId) refuse("HELD", "Saved setup diagnostics don't match this batch. Inspect details.");
        diagnostic = record.reason;
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      const p = saved.snapshot.projects.find(p => p.projectId === child.review.projectId), receipt = saved.requests.find(r => r.requestId === child.requestId);
      const other = saved.requests.some(r => r.review.projectId === child.review.projectId && r.requestId !== child.requestId);
      const exact = receipt && digest(receipt) === digest(child);
      const known = !problems.length, waiting = known && !receipt && !other && !p?.provisionInput && !p?.agentId;
      const ready = !!exact && !!p?.agentId && !p.reason && p.state === "admitted" && p.sessions > 0 && p.turns > 0;
      const checking = !known || !!p?.uncertain;
      const recoverableCreate = !!exact && saved.recoverableCreates.includes(child.requestId);
      const binding = c.status.bindings.find(b => b.scopeId === p?.scopeId), effects = binding ? activationEffects(c.status, binding.scopeId, binding.epoch) : null;
      const failed = effects && [effects.workspace, effects.create, effects.send].some(e => e && ["failed", "cancelled"].includes(e.state));
      const canContinue = !cancelled && known && !ready && !other && (!p?.uncertain || recoverableCreate) && !failed && (waiting || !!exact) && p?.state !== "stopped" && !p?.reason?.startsWith("Provisioning stopped");
      return { requestId: child.requestId, projectId: child.review.projectId, name: child.review.name,
        state: ready ? "ready" : waiting && cancelled ? "cancelled" : checking ? "checking" : waiting && !diagnostic ? "waiting" : "needs-change",
        reason: ready ? "Ready" : waiting && cancelled ? "Cancelled before project admission. Its reviewed identity is kept; no spending was refunded." : checking ?
          canContinue && recoverableCreate ? "The setup reply was lost. Continue saved batch to find the same mate and finish its first message once creation is confirmed. Its model, permissions and spending limits are kept." :
          "Check saved setup to inspect the result. An uncertain opening stays held and won't be sent again." : diagnostic ? `Saved setup needs a check: ${diagnostic}` : waiting ? "Waiting to start" : other ? "Another saved setup owns this project. Check its original request." : p?.reason ?? "Needs a change. Check this project's recorded setup before continuing.",
        agentId: exact ? p?.agentId ?? null : null, sessions: p?.sessions ?? 0, turns: p?.turns ?? 0, canContinue, canCancel: waiting && !cancelled };
    }));
    return { commit: input, children, problems };
  }
  async status(homeId: string): Promise<ProjectBatchStatus[]> {
    await this.context(homeId);
    let names: string[];
    try { names = await readdir(this.directory(homeId)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
    const manifests = names.filter(n => /^[\da-f-]{36}\.json$/i.test(n)).sort();
    if (manifests.length > 256) refuse("HELD", "Saved batch history exceeds this view's limit. Inspect Advanced work details.");
    const result = [];
    for (const name of manifests) result.push(await this.projectStatus((await this.load(homeId, name.slice(0, -5)))!));
    return result;
  }
  async commit(raw: ProjectBatchCommit, paseo: PaseoApi) {
    const input = ProjectBatchCommitSchema.parse(raw), { homeId, batchId } = input.manifest;
    if (digest(input.manifest) !== input.reviewDigest) refuse("CONFLICT", "This batch review changed. Review the selected projects again.");
    await serialized(`project-batch-save:${homeId}`, async () => {
      await this.context(homeId);
      const old = await this.load(homeId, batchId);
      if (old) { if (digest(old) !== digest(input)) refuse("CONFLICT", "This batch ID already has different saved choices. Check saved setup."); return; }
      const existing = await this.status(homeId);
      if (existing.some(batch => batch.children.some(child => child.state !== "cancelled" && input.manifest.children.some(c => c.review.projectId === child.projectId))))
        refuse("STALE", "A saved batch already owns one of these projects. Check and continue its original setup, or explicitly cancel its waiting projects before a new review.");
      const choices = input.manifest.children.map(c => ({ homeId, name: c.review.name, sourcePath: c.review.source.path, profile: c.review.profile, limits: c.review.limits, budget: c.review.budget }));
      const current = await this.preview(homeId, batchId, choices, paseo);
      // Occupancy is a read-time observation, not reviewed authority. Keep all durable choices
      // exact, including configured capacity/headroom, and admit only while the whole set fits.
      const reviewed = (value: ProjectBatchCommit) => ({ ...value.manifest,
        capacity: { slots: value.manifest.capacity.slots, generalHeadroom: value.manifest.capacity.generalHeadroom } });
      if (!current.commit || digest(reviewed(current.commit)) !== digest(reviewed(input))) refuse("STALE", current.reasons.join(" ") || "The aggregate review changed. Review all selected projects again.");
      // Only the final capacity observation/publication shares the admission queue. Source/model
      // review and all child effects stay outside it and never borrow General's conversation lock.
      await withScopeAdmission(homeId, async () => {
        const c = await this.context(homeId), limits = await this.setup.projects.capacity(c.home);
        const occupied = await pluginOccupancy(c.status, this.setup.projects.setupReceiver(paseo));
        if (limits.slots !== input.manifest.capacity.slots || limits.generalHeadroom !== input.manifest.capacity.generalHeadroom ||
          input.manifest.children.length > limits.slots - limits.generalHeadroom - occupied)
          refuse("STALE", "Available capacity changed. Keep your selection and review capacity again before creating mates.");
        const path = this.path(homeId, batchId); await mkdir(this.directory(homeId), { recursive: true });
        try { await publish(path, input); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST" || digest(await this.load(homeId, batchId)) !== digest(input)) throw e; }
      });
    });
    return this.continue(homeId, batchId, paseo);
  }
  async continue(homeId: string, batchId: string, paseo: PaseoApi) {
    const input = await this.load(homeId, batchId) ?? refuse("UNKNOWN_OWNER", "No saved batch matches this request. Check saved setup before continuing.");
    for (const child of input.manifest.children) await serialized(`project-batch-child:${homeId}:${batchId}`, async () => {
      const current = await this.projectStatus(input), row = current.children.find(c => c.requestId === child.requestId)!;
      if (!row.canContinue) return;
      // The saved app review, individual queues and fresh dispatch guards remain the sole effect path.
      try { await this.setup.commit(child, paseo); }
      catch (e) {
        // A diagnostic is not a native outcome. Status still checks exact authoritative child receipts.
        const path = this.path(homeId, batchId).replace(/\.json$/, `.${child.requestId}.hold.json`);
        try { await publish(path, { batchDigest: input.reviewDigest, requestId: child.requestId, reason: String(e instanceof Error ? e.message : e).slice(0, 2000) }); }
        catch (saveError) { if ((saveError as NodeJS.ErrnoException).code !== "EEXIST") throw saveError; }
      }
    });
    return this.projectStatus(input);
  }
  async cancel(homeId: string, batchId: string) {
    return serialized(`project-batch-child:${homeId}:${batchId}`, async () => {
      await this.context(homeId);
      const input = await this.load(homeId, batchId) ?? refuse("UNKNOWN_OWNER", "No saved batch matches this request.");
      await this.projectStatus(input);
      const path = this.path(homeId, batchId).replace(/\.json$/, ".cancel.json");
      try { await publish(path, { batchDigest: input.reviewDigest, cancelled: true }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      return this.projectStatus(input);
    });
  }
}
export function registerProjectBatches(server: Pick<PluginServerContext, "handle">, setup: ProjectSetupService) {
  const batches = new ProjectBatchService(setup);
  server.handle(previewProjectBatch, (i, { paseo }) => batches.preview(i.homeId, i.batchId, i.choices, paseo));
  server.handle(commitProjectBatch, (i, { paseo }) => batches.commit(i, paseo));
  server.handle(readProjectBatches, i => batches.status(i.homeId));
  server.handle(continueProjectBatch, (i, { paseo }) => batches.continue(i.homeId, i.batchId, paseo));
  server.handle(cancelProjectBatch, i => batches.cancel(i.homeId, i.batchId));
}
