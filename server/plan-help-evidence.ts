/** Read-only evidence selection. Reading a report does not certify it or grant authority. */
import { createHash } from "node:crypto";
import type { HandoverEvidenceReview, PlanHelpReview } from "../shared/plan-help";
import type { SupervisionStatus } from "../shared/supervision";
import { listDirectory, readTextFile } from "./files";
import { digest } from "./submissions";
import { checkPolicySource, policyRef, sameVector } from "./supervision-policy";
import { SupervisionMigrator, type LegacyDeliveryAdapters } from "./supervision-migrate";
import { SupervisionStore } from "./supervision-store";
import { workflowStore } from "./workflow-service";
export async function handoverEvidence(root: string, home: string, review: PlanHelpReview, status: SupervisionStatus,
  adapters: LegacyDeliveryAdapters, folder: string, rollbackPath?: string): Promise<HandoverEvidenceReview> {
  const result: HandoverEvidenceReview = { homeId: review.homeId, plan: review.plan, reviewHash: review.reviewHash,
    folder, entries: [], inventory: null, policy: null, rollback: null, problems: [] };
  try {
    const directory = await listDirectory(home, folder); result.folder = directory.path;
    if (directory.entries.length > 200) result.problems.push("This folder has too many files. Choose a smaller folder for the rollback report.");
    else result.entries = directory.entries.filter(e => e.kind === "dir" || /\.(md|txt|json)$/i.test(e.name)).map(({ name, path, kind }) => ({ name, path, kind }));
  } catch { result.problems.push("This folder isn't available. Choose another folder in FirstMate's home."); }
  if (rollbackPath) try {
    const file = await readTextFile(home, rollbackPath);
    if (file.content === null || !file.content.trim() || file.size > 32768 || Buffer.byteLength(file.content) > 32768) throw new Error();
    result.rollback = { path: file.path, content: file.content, hash: createHash("sha256").update(file.content).digest("hex") };
  } catch { result.problems.push("The rollback report couldn't be read. Choose a text report under 32 KB inside FirstMate's home."); }
  const project = status.projects?.projects.find(p => p.id === review.projectId);
  const sources = project ? status.policySources.filter(s => project.sourceVector.some(ref => sameVector([ref], [policyRef("policy-source", s)])) && !status.policySources.some(next => next.supersedes.includes(s.id))) : [];
  if (project && sources.length && sources.length === project.sourceVector.length) try {
    const excerpts = [];
    for (const source of sources) {
      await checkPolicySource(home, source);
      const file = await readTextFile(home, source.path);
      if (file.content === null) throw new Error();
      const content = file.content.replace(/\r\n/g, "\n").split("\n").slice(source.lineStart - 1, source.lineEnd).join("\n");
      if (Buffer.byteLength(content) > 8192 || excerpts.length >= 16 || createHash("sha256").update(content).digest("hex") !== source.excerptHash) throw new Error();
      await checkPolicySource(home, source);
      excerpts.push({ path: source.path, lines: `${source.lineStart}–${source.lineEnd}`, content });
    }
    result.policy = { hash: digest({ project: project.sourceVector, sources }), sources: excerpts };
  } catch { result.problems.push("The accepted permission sources need a fresh review. Open project setup in FirstMate settings before continuing; this handover cannot create permission evidence."); }
  if (!result.policy) result.problems.push("Accepted project permissions are missing. Open project setup in FirstMate settings and review its original permission sources first.");
  if (review.projectId && !status.migrations?.some(m => m.planId === review.plan)) try {
    const dry = await new SupervisionMigrator({ home, store: new SupervisionStore(root, home), legacy: workflowStore(home), adapters, enabled: true }).dryRun({
      plan: review.plan, scopeId: review.scopeId, projectId: review.projectId, migrationId: review.migrationId,
      prerequisites: { inventory: "Read-only preview; not accepted", policy: "Read-only preview; not accepted", rollbackBuild: "Read-only preview; not accepted" } });
    result.inventory = { hash: digest({ source: dry.sourceHash, dispositions: dry.dispositions, launches: dry.receipt.launches, dependents: dry.receipt.dependents, capacity: dry.capacity }),
      summary: [`${dry.dispositions.length} pending or recorded deliveries checked.`, ...dry.dispositions.map(d => `${d.source}: ${d.reason}`),
        `${dry.receipt.launches.length} launch records and ${dry.receipt.dependents.length} dependent steps checked.`, "Uncertain deliveries remain held; no message will be resent."], problems: dry.problems };
  } catch { result.problems.push("Pending deliveries couldn't all be checked. Refresh Needs you, then check this evidence again before handover."); }
  return result;
}
