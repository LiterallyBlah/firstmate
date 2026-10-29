/** Read-only evidence selection. Reading a report does not certify it or grant authority. */
import { createHash } from "node:crypto";
import type { HandoverEvidenceReview, PlanHelpReview } from "../shared/plan-help";
import type { SupervisionStatus } from "../shared/supervision";
import type { LegacyDeliveryDisposition } from "../shared/supervision-migration";
import { listDirectory, readTextFile } from "./files";
import { digest } from "./submissions";
import { checkPolicySource, policyRef, sameVector } from "./supervision-policy";
import { SupervisionMigrator, type LegacyDeliveryAdapters } from "./supervision-migrate";
import { SupervisionStore } from "./supervision-store";
import { workflowStore } from "./workflow-service";
/** Presentation only: never infer handling from a send receipt or change a disposition. */
function deliveryExplanation(d: LegacyDeliveryDisposition, plan: string, work?: string): string {
  const subject = `“${work ?? plan}”`;
  const labels: Record<LegacyDeliveryDisposition["source"], string> = {
    "plan-action": `Your saved plan choice for ${subject}`,
    "config.mateNotes": `A saved message about ${subject}`,
    burst: `A saved conversation update about ${subject}`,
    "decision-submission": `Your saved answer about ${subject}`,
    "watch-queue": `A check report mentioning ${subject}`,
    "send-claim": `A message about ${subject}`,
    "worker-callback": `The result of work on ${subject}`,
  };
  switch (d.route) {
    case "already-handled": return `${labels[d.source]} has already been handled by FirstMate. No action is needed.`;
    case "transfer-fact": return `${labels[d.source]} will be kept with the plan if you complete handover. No reply is needed here.`;
    case "drain-legacy": return `${labels[d.source]} stays with the current owner. Let FirstMate finish checking it, then refresh this review.`;
    case "hold":
      if (d.source === "worker-callback") return `Work on ${subject} still needs a confirmed result. Wait for FirstMate to confirm that ${subject} has finished before completing handover.`;
      if (d.source === "decision-submission") return `${labels[d.source]} may already have been received. Keep the current owner and review this answer with FirstMate before continuing. It will not be sent again.`;
      if (d.source === "send-claim") return `${labels[d.source]} may already have arrived. Keep the current owner and ask FirstMate to check the result before continuing. It will not be sent again.`;
      return `${labels[d.source]} needs review. Keep the current owner and ask FirstMate to check it before continuing.`;
  }
}
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
    const plan = await workflowStore(home).get(review.plan);
    // A name must come from the same plan history as the inspected inventory.
    if (!plan || plan.hash !== dry.receipt.source.tip.hash) throw new Error("Plan changed during inventory read");
    result.inventory = { hash: digest({ source: dry.sourceHash, dispositions: dry.dispositions, launches: dry.receipt.launches, dependents: dry.receipt.dependents, capacity: dry.capacity }),
      summary: [`${dry.dispositions.length} saved item${dry.dispositions.length === 1 ? "" : "s"} checked before handover.`, ...dry.dispositions.map(d => {
        const node = dry.receipt.imported.attempts.find(a => a.attempt === d.original.attemptId)?.node;
        return deliveryExplanation(d, plan.definition.title, plan.definition.nodes.find(n => n.id === node)?.title);
      }), `${dry.receipt.launches.length} work starts and ${dry.receipt.dependents.length} steps that depend on this plan checked.`,
      "Messages whose result is unknown stay paused for review. Nothing will be sent again."],
      // Retain exact diagnostic data and guard inputs; only the client disclosure renders them.
      details: dry.dispositions.map(d => `${d.source} · ${d.id}\n${JSON.stringify(d.original)}\n${d.reason}`), problems: dry.problems };
  } catch { result.problems.push("Pending deliveries couldn't all be checked. Refresh Needs you, then check this evidence again before handover."); }
  return result;
}
