import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { PlanDefinitionSchema, planFinished, type WorkflowCommand, type WorkflowPlan } from "../shared/workflow-plans";
import { workflowFixture } from "../test/workflow-fixture";
import { expected, hash, ids, scope } from "../test/supervision-fixture";
import { SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { replaySupervisionWorkflow } from "./supervision-workflows";
import { digest } from "./submissions";
import { dependenciesMet, replayWorkflowEvent, WorkflowEventSchema, WorkflowPlanStore, type WorkflowEvent } from "./workflow-plans";
import { planOwnership, type WorkflowRetirement } from "./workflow-ownership";

let home: string, legacy: WorkflowPlanStore, scoped: SupervisionStore;
const processIdentity = async () => ({ state: "alive" as const, start: "workflow-fixture" });
beforeEach(async () => {
  home = join(process.env.PASEO_HOME!, randomUUID());
  for (const id of ["build", "trial"]) { await mkdir(join(home, `data/${id}`), { recursive: true }); await writeFile(join(home, `data/${id}/brief.md`), "Bounded fixture evidence only."); }
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  legacy = new WorkflowPlanStore(join(home, "legacy"), home);
  scoped = new SupervisionStore(join(home, "store"), home, { writable: true, processIdentity });
  await scoped.initialize(); await scoped.acquireCoordinator();
});
const run = (command: WorkflowCommand) => legacy.execute(command, randomUUID(), "fixture-mate") as Promise<any>;
async function mirror(planId: string) {
  const directory = join(legacy.root, planId), names = (await readdir(directory)).filter(n => /^\d{8}\.json$/.test(n)).sort();
  const bytesBefore = await Promise.all(names.map(n => readFile(join(directory, n), "utf8")));
  for (let i = 0; i < bytesBefore.length; i++) {
    const mutation: SupervisionMutation = { kind: "workflow", scopeId: ids.scope, event: JSON.parse(bytesBefore[i]!) };
    const mutations: SupervisionMutation[] = i === 0 ? [
      { kind: "scope", value: scope(scoped.homeId) },
      { kind: "backend", value: { planId, ownerScopeId: ids.scope, backend: "scoped", state: "active", sourceHash: null, version: 1 } }, mutation,
    ] : [mutation];
    await scoped.transact(expected(mutations).map(ref => ({ ...ref, version: ref.kind === "workflow" ? i : 0 })), randomUUID(), mutations);
  }
  expect(await Promise.all(names.map(n => readFile(join(directory, n), "utf8")))).toEqual(bytesBefore);
  const old = (await legacy.get(planId))!, fresh = (await new SupervisionStore(join(home, "store"), home).read()).plans[0]!.plan;
  expect(fresh).toEqual(old);
  expect(planOwnership(fresh)).toEqual(planOwnership(old));
  return fresh;
}
it("preserves exact frozen pre-default definitions/hashes in the existing reducer seam", async () => {
  const raw = JSON.parse(await readFile(resolve(`test/fixtures/workflow-log/${process.platform === "win32" ? "windows" : "linux"}.json`), "utf8")) as WorkflowEvent;
  const parsed = WorkflowEventSchema.parse(raw), homeId = new SupervisionStore(join(home, "frozen"), raw.home).homeId;
  const result = replaySupervisionWorkflow(null, raw, homeId);
  expect(result).toEqual(replayWorkflowEvent(null, parsed)); expect(result.hash).toBe(raw.hash);
  // The transaction also retains the original object rather than silently adding defaults to its hash.
  const frozen = new SupervisionStore(join(home, "frozen"), raw.home, { writable: true, processIdentity });
  await frozen.initialize(); await frozen.acquireCoordinator();
  const mutations: SupervisionMutation[] = [{ kind: "scope", value: scope(frozen.homeId) },
    { kind: "backend", value: { planId: raw.plan, ownerScopeId: ids.scope, backend: "scoped", state: "active", sourceHash: null, version: 1 } },
    { kind: "workflow", scopeId: ids.scope, event: raw }];
  await frozen.transact(expected(mutations), randomUUID(), mutations);
  expect((await frozen.read()).plans[0]!.plan).toEqual(result);
});
it("captures raw workflow input before asynchronous work, preserving its content-bound request", async () => {
  const raw = JSON.parse(await readFile(resolve(`test/fixtures/workflow-log/${process.platform === "win32" ? "windows" : "linux"}.json`), "utf8"));
  raw.home = home; const { hash: _hash, ...body } = raw; raw.hash = digest(body);
  const originalTitle = raw.command.definition.title;
  const mutations: SupervisionMutation[] = [{ kind: "scope", value: scope(scoped.homeId) },
    { kind: "backend", value: { planId: raw.plan, ownerScopeId: ids.scope, backend: "scoped", state: "active", sourceHash: null, version: 1 } },
    { kind: "workflow", scopeId: ids.scope, event: raw }];
  const pending = scoped.transact(expected(mutations), randomUUID(), mutations);
  raw.command.definition.title = "Caller changed this after submission"; raw.hash = "0".repeat(64);
  await pending;
  const status = await scoped.read(); expect(status.freshness).toBe("current"); expect(status.plans[0]?.plan.definition.title).toBe(originalTitle);
});
it("replays real automatic one-run history without another plan model or budget reset", async () => {
  const definition = workflowFixture(), node = definition.nodes[0]!;
  if (node.kind !== "run") throw new Error("fixture");
  const launch = { ...node.launch, id: "trial", brief: { file: "data/trial/brief.md" }, kind: "scout" as const };
  const started = await run({ op: "implicit", launch });
  await run({ op: "record", plan: "trial", node: "trial", attempt: started.launch.workflow.attempt, state: "done", evidence: "Verified synthetic report." });
  const result = await mirror("trial"); expect(result.definition.implicit).toBe(true); expect(planFinished(result)).toBe(true);
  expect(result.nodes.trial?.spent).toBe(1);
});
it("preserves approvals, prior attempts, promotion, invalidation and evidence-only closure from real logs", async () => {
  const d = PlanDefinitionSchema.parse({ ...workflowFixture(), id: "promotion", nodes: [workflowFixture().nodes[0]], budget: { agents: 2, turns: 2 } });
  await run({ op: "draft", definition: d });
  const first = await run({ op: "start", plan: d.id, node: "trial" });
  await run({ op: "record", plan: d.id, node: "trial", attempt: first.launch.workflow.attempt, state: "running", agentId: "worker", workspaceId: "space", evidence: "Exact inspected worker/workspace." });
  await run({ op: "record", plan: d.id, node: "trial", attempt: first.launch.workflow.attempt, state: "done", evidence: "Verified scout report." });
  let p = (await legacy.get(d.id))!;
  await run({ op: "replace", plan: d.id, node: "trial", attempt: first.launch.workflow.attempt, expected: p.hash, kind: "promote", evidence: "Approved bounded fix in same workspace.", budget: { agents: 2, turns: 2 } });
  p = (await legacy.get(d.id))!; await run({ op: "approve", plan: d.id, expected: p.hash, quote: "Approve the additional attempt." });
  const second = await run({ op: "start", plan: d.id, node: "trial" });
  await run({ op: "record", plan: d.id, node: "trial", attempt: second.launch.workflow.attempt, state: "running", agentId: "replacement", workspaceId: "space", evidence: "Verified replacement, preserved workspace." });
  await run({ op: "record", plan: d.id, node: "trial", attempt: second.launch.workflow.attempt, state: "done", evidence: "Verified evidence-only ship report." });
  await run({ op: "invalidate", plan: d.id, node: "trial", attempt: second.launch.workflow.attempt, evidence: "Report requires renewal." });
  p = (await legacy.get(d.id))!; await run({ op: "validate", plan: d.id, node: "trial", attempt: second.launch.workflow.attempt, expected: p.hash, evidence: "Inspected current report/head again." });
  p = (await legacy.get(d.id))!; await run({ op: "close", plan: d.id, node: "trial", attempt: second.launch.workflow.attempt, expected: p.hash, evidence: "Nothing to land; verified trial only." });
  const result = await mirror(d.id);
  expect(result.nodes.trial?.spent).toBe(2); expect(result.nodes.trial?.priorAttempts).toHaveLength(1); expect(planFinished(result)).toBe(true);
  const node = result.definition.nodes[0]!;
  expect(dependenciesMet({ ...node, after: [{ node: "trial", reason: "needs-evidence", on: "done" }] }, [result])).toBe(true);
  expect(dependenciesMet({ ...node, after: [{ node: "trial", reason: "builds-on", on: "landed" }] }, [result])).toBe(false);
});
it("keeps a committed historical early answer without applying today's admission guards on replay", async () => {
  await run({ op: "draft", definition: workflowFixture() });
  const prior = (await legacy.get("scheduler"))!;
  const command = { op: "captain" as const, plan: "scheduler", revision: prior.revision, subjectHash: hash,
    action: "answer" as const, node: "database", option: "sqlite", text: "Historically accepted early answer" };
  const body = { version: 1, home, plan: "scheduler", sequence: 1, previous: prior.hash, requestId: randomUUID(), requestHash: digest(command), at: new Date().toISOString(), by: "board:captain", command };
  const event = { ...body, hash: digest(body) };
  await writeFile(join(legacy.root, "scheduler/00000001.json"), JSON.stringify(event));
  await writeFile(join(legacy.root, ".tips/scheduler/00000001.json"), JSON.stringify({ sequence: 1, hash: event.hash }));
  const result = await mirror("scheduler");
  expect(result.nodes.database?.answer).toBe("sqlite"); expect(result.status).toBe("review");
  expect(result.captainEvents?.[0]?.by).toBe("board:captain");
  const replay = await scoped.workflowRequest("scheduler", event.requestId);
  expect(replay).toMatchObject({ requestHash: event.requestHash, eventHash: event.hash, receipt: { sequence: 2 } });
});
it("preserves removed prerequisites and held dependents from real revision history", async () => {
  const d = workflowFixture(); d.nodes = d.nodes.filter(n => n.kind === "run");
  d.nodes[1]!.after = [{ node: "trial", reason: "builds-on", on: "done" }];
  d.request = { ...d.request, posture: "sail", quote: "Go ahead" };
  await run({ op: "draft", definition: d }); const prior = (await legacy.get(d.id))!;
  d.nodes.shift(); await run({ op: "revise", definition: d, expected: prior.hash, reason: "Retain removed trial identity." });
  const result = await mirror(d.id);
  expect(result.removed?.[0]?.node.id).toBe("trial"); expect(result.nodes.build?.held).toContain("Prerequisite removed");
  expect(dependenciesMet(result.definition.nodes[0]!, [result])).toBe(false);
});
it("retains an actual quarantine retirement receipt, attempts, budget and scoped reservations", async () => {
  const d = PlanDefinitionSchema.parse({ ...workflowFixture(), id: "retired", nodes: [workflowFixture().nodes[0]] });
  await run({ op: "draft", definition: d }); await run({ op: "start", plan: d.id, node: "trial" });
  const original = (await legacy.get(d.id))!;
  await writeFile(join(legacy.root, "retired/00000001.json"), "{corrupt");
  const held = (await legacy.read()).quarantined[0]!;
  const receipt = await run({ op: "retire", plan: d.id, expected: held.fingerprint, evidence: "Inspected damaged fixture and retained all reservations." }) as WorkflowRetirement;
  const mutations: SupervisionMutation[] = [{ kind: "scope", value: scope(scoped.homeId) }, { kind: "retirement", scopeId: ids.scope, receipt }];
  await scoped.transact(expected(mutations), randomUUID(), mutations);
  const status = await scoped.read(); expect(status.retirements[0]?.hash).toBe(receipt.hash);
  expect(status.retainedOwnership.at(-1)?.workflows[0]?.inventory).toEqual(receipt.inventory);
  expect(receipt.inventory.attempts[0]?.attempt).toBe(original.nodes.trial?.attempt);
  expect((await scoped.backend(d.id)).held).toBe(true);
  const event = JSON.parse(await readFile(join(legacy.root, "retired/00000000.json"), "utf8"));
  await expect(scoped.transact([{ kind: "workflow", id: d.id, version: 0 }], randomUUID(), [{ kind: "workflow", scopeId: ids.scope, event }])).rejects.toMatchObject({ code: "HELD" });
  const collision = { ...event, plan: "another", command: { ...event.command, definition: { ...event.command.definition, id: "another" } } };
  const { hash: _hash, ...collisionBody } = collision; collision.hash = digest(collisionBody); collision.requestHash = digest(collision.command);
  const { hash: _hash2, ...fixedBody } = collision; collision.hash = digest(fixedBody);
  const newRows: SupervisionMutation[] = [{ kind: "backend", value: { planId: "another", ownerScopeId: ids.scope, backend: "scoped", state: "active", sourceHash: null, version: 1 } }, { kind: "workflow", scopeId: ids.scope, event: collision }];
  await expect(scoped.transact(expected(newRows), randomUUID(), newRows)).rejects.toMatchObject({ code: "CONFLICT" });
});
