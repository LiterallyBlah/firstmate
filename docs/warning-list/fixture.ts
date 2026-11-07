/** Synthetic records only. Invoked by render.mjs with a disposable PASEO_HOME. */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { FirstmateConfigSchema } from "../../shared/fleet";
import type { SupervisionStatus } from "../../shared/supervision";
import { workflowFixture } from "../../test/workflow-fixture";
import { loadFleet, ReportCache } from "../../server/fleet";
import { shareScopedStatusReader, workflowSnapshot, withWorkflowFleet } from "../../server/workflow-board";
import { workflowStore } from "../../server/workflow-service";
import { cutoverGate } from "../../server/supervision-gate";

const previewRoot = resolve(process.env.PASEO_HOME ?? "");
if (dirname(previewRoot) !== resolve(tmpdir()) || !basename(previewRoot).startsWith("firstmate-warning-preview-")) throw new Error("Run through render.mjs with its disposable preview home.");
const home = join(previewRoot, "fixture"), scenario = process.argv[2] ?? "historical";
await mkdir(join(home, "data"), { recursive: true });
await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
const definition = workflowFixture(); definition.id = "remote-supervisors"; definition.title = "Remote Supervisors reporting fixture";
definition.nodes = definition.nodes.filter(n => n.kind === "run");
definition.nodes.forEach(n => { n.after = []; });
await workflowStore(home).execute({ op: "draft", definition }, randomUUID(), "fixture-mate");
const plan = (await workflowStore(home).get(definition.id))!;
plan.status = "active";
const at = "2026-11-05T12:00:00Z", completedAt = "2026-11-06T12:00:00Z", scopeId = randomUUID(), attempt = randomUUID();
plan.nodes.trial = { state: "done", attempt: randomUUID(), agentId: "slice-1-current", completedAt, evidence: "Accepted bounded slice-1 evidence",
  priorAttempts: [{ state: "done", attempt: randomUUID(), agentId: "slice-1-prior", completedAt: at, evidence: "Retained prior slice-1 evidence" }] };
plan.nodes.build = { state: "done", attempt: randomUUID(), agentId: "slice-2-current", completedAt, evidence: "Accepted bounded slice-2 evidence",
  priorAttempts: [{ state: "failed", attempt, agentId: "slice-2-prior", completedAt: at, evidence: "Retained failed CI attempt; never reclassified as successful" }] };
const conditions = ["current source-bound rule record and digest required", "failure regression-a needs its reproduced regression case in the next attempt; failure regression-b needs its reproduced regression case in the next attempt", "regression regression-a has not passed on this fix; regression regression-b has not passed on this fix"];
const ruleViolations = conditions.map((condition, i) => ({ format: "firstmate.rule-violation/1" as const, id: randomUUID(), version: 1 as const, homeId: home, scopeId,
  planId: definition.id, nodeId: i ? "build" : "trial", attemptId: i === 2 ? attempt : null, stage: i === 2 ? "completion" as const : "dispatch" as const,
  subjectHash: "a".repeat(64), rules: null, conditions: [condition], at }));
const scoped = { freshness: "current", plans: [{ scopeId, plan }], backends: [{ planId: definition.id, ownerScopeId: scopeId, backend: "scoped", state: "active" }], ruleViolations } as SupervisionStatus;
if (scenario === "current") { plan.nodes.build!.state = "unresolved"; plan.nodes.trial!.invalidated = "Renewed verification required"; }
if (scenario === "clean") scoped.ruleViolations = [];
await cutoverGate(home).publishSidecar({ format: "firstmate.cutover-sidecar/1", compatibility: 1, stage: "committed", homeId: home, planId: definition.id,
  migrationId: randomUUID(), scopeId, at, sourceHash: "a".repeat(64), inventoryHash: "b".repeat(64), transaction: null,
  tokens: { plan: definition.id, nodes: ["trial", "build"], actions: [], agents: ["slice-1-prior", "slice-2-current", "slice-2-prior"], tasks: [{ task: "trial", host: "local" }, { task: "build", host: "local" }] } });
const agents = ["slice-1-prior", "slice-2-current", "slice-2-prior"].map(id => ({ id, title: `Remote Supervisors ${id}`, workspaceId: "fixture", archivedAt: null,
  provider: "muse", model: null, status: "idle", cwd: home, pendingPermissions: [], updatedAt: completedAt,
  labels: { "firstmate.role": "crew", "firstmate.task": id.startsWith("slice-1") ? "trial" : "build", "firstmate.project": "scheduler" } }));
const paseo: any = { agents: { list: async () => ({ entries: agents.map(agent => ({ agent })), pageInfo: {} }) }, config: { get: async () => ({ config: { mcp: { injectIntoAgents: true } } }) } };
class PendingReports extends ReportCache {
  override async reportFor() { return { state: scenario === "clean" ? "current" as const : "pending" as const, report: null }; }
}
const release = shareScopedStatusReader(async () => scoped);
try {
  const fleet = await withWorkflowFleet(await loadFleet(paseo, FirstmateConfigSchema.parse({ home }), new PendingReports()));
  console.log(JSON.stringify({ fleet, workflow: await workflowSnapshot(home, scoped) }));
} finally { release(); }
