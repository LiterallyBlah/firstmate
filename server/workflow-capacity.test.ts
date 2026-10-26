import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PlanDefinitionSchema, WorkflowCommandSchema, planProblems, planSpent, planWorstCase, type PlanNodeState, type WorkflowCommand, type WorkflowPlan } from "../shared/workflow-plans";
import { workflowFixture } from "../test/workflow-fixture";
import { checkNewWorkflowAction, replayWorkflowEvent, WorkflowEventSchema, WorkflowPlanStore, type WorkflowEvent } from "./workflow-plans";
import { replaySupervisionWorkflow } from "./supervision-workflows";
import { workflowHomeIdentity } from "./workflow-ownership";
import { digest } from "./submissions";

const budget = (n: number) => ({ agents: n, turns: n });
const run = (id: string) => {
  const node = structuredClone(workflowFixture().nodes[2]!);
  if (node.kind !== "run") throw new Error("fixture");
  node.id = id; node.launch.id = id; node.launch.brief.file = `data/${id}/brief.md`; node.after = [];
  return node;
};
function event(previous: WorkflowPlan | null, command: WorkflowCommand): WorkflowEvent {
  const body = { version: 1 as const, home: process.env.PASEO_HOME!, plan: previous?.definition.id ?? "capacity", sequence: previous ? previous.sequence + 1 : 0,
    previous: previous?.hash ?? null, requestId: randomUUID(), requestHash: digest(command), at: "2026-10-26T12:00:00Z", by: "fixture-mate", command };
  return { ...body, hash: digest(body) };
}
// Same accounting shape as the saved capacity diagnosis at 40b769fa...: 93 runs,
// seven decisions, 88 started runs with 100 cumulative attempts, five pending runs,
// ten removed zero-spend rows. Prior attempts are already included in each spent count.
function capacityPlan(): WorkflowPlan {
  const runs = Array.from({ length: 93 }, (_, i) => run(`run-${i}`));
  const decisions = Array.from({ length: 7 }, (_, i) => {
    const node = structuredClone(workflowFixture().nodes[1]!);
    if (node.kind !== "decision") throw new Error("fixture");
    node.id = `decision-${i}`; node.after = []; return node;
  });
  for (const [i, decision] of decisions.entries()) runs[i]!.after = [{ node: decision.id, reason: "decision", on: "answered" }];
  const definition = PlanDefinitionSchema.parse({ ...workflowFixture(), id: "capacity", nodes: [...runs, ...decisions], budget: budget(100) });
  const plan = replayWorkflowEvent(null, event(null, { op: "draft", definition }));
  for (let i = 0; i < 88; i++) {
    const spent = [5, 5, 3, 2, 2][i] ?? 1;
    const priorAttempts: PlanNodeState[] = Array.from({ length: spent - 1 }, (_, n) => ({ state: "done", attempt: randomUUID(), spent: n + 1, agentId: `old-${i}-${n}`, workspaceId: `space-${i}` }));
    plan.nodes[`run-${i}`] = { state: "done", attempt: randomUUID(), spent, agentId: `worker-${i}`, workspaceId: `space-${i}`, priorAttempts, evidence: "Verified report and head" };
  }
  for (const node of decisions) plan.nodes[node.id] = { state: "done", answer: "sqlite", evidence: "Recorded choice" };
  plan.removed = Array.from({ length: 10 }, (_, i) => ({ node: run(`removed-${i}`), state: { state: "planned" } }));
  plan.status = "active";
  return plan;
}
const replacement = (p: WorkflowPlan, n: number): Extract<WorkflowCommand, { op: "replace" }> => ({ op: "replace", plan: p.definition.id, node: "run-0", attempt: p.nodes["run-0"]!.attempt!, expected: p.hash, kind: "relaunch", evidence: "Inspected worker and preserved workspace", budget: budget(n) });

describe("cumulative capacity contract", () => {
  it("accepts 101 and safe integer limits at both entry points while retaining the 100-node bound", () => {
    const p = capacityPlan();
    for (const count of [1, 100, 101, Number.MAX_SAFE_INTEGER]) {
      expect(PlanDefinitionSchema.safeParse({ ...p.definition, budget: budget(count) }).success).toBe(true);
      expect(WorkflowCommandSchema.safeParse(replacement(p, count)).success).toBe(true);
    }
    for (const count of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) for (const field of ["agents", "turns"]) {
      const invalid = { ...budget(101), [field]: count };
      expect(PlanDefinitionSchema.safeParse({ ...p.definition, budget: invalid }).success).toBe(false);
      expect(WorkflowCommandSchema.safeParse({ ...replacement(p, 101), budget: invalid }).success).toBe(false);
    }
    expect(PlanDefinitionSchema.safeParse({ ...p.definition, budget: { ...budget(101), extra: 1 } }).success).toBe(false);
    expect(WorkflowCommandSchema.safeParse({ ...replacement(p, 101), budget: { ...budget(101), extra: 1 } }).success).toBe(false);
    expect(PlanDefinitionSchema.safeParse({ ...p.definition, nodes: [...p.definition.nodes, run("extra")], budget: budget(1000) }).success).toBe(false);
  });
  it("refuses 101/105 against the actual 105-worst shape and admits 106 without double counting prior attempts", () => {
    const p = capacityPlan(), before = structuredClone(p);
    expect(p.definition.nodes).toHaveLength(100);
    expect(planProblems(p.definition, [p])).toEqual([]);
    expect(planSpent(p.nodes, p.removed)).toBe(100);
    expect(planWorstCase(p.definition, p.nodes, p.removed)).toEqual(budget(105));
    for (const cap of [101, 105]) expect(() => checkNewWorkflowAction(replacement(p, cap), p, [p])).toThrow(/106/);
    for (const field of ["agents", "turns"]) expect(() => checkNewWorkflowAction({ ...replacement(p, 106), budget: { ...budget(106), [field]: 105 } }, p, [p])).toThrow(/106/);
    expect(() => checkNewWorkflowAction(replacement(p, 106), p, [p])).not.toThrow();
    expect(p).toEqual(before);
    const next = replayWorkflowEvent(p, event(p, replacement(p, 106)));
    expect(planSpent(next.nodes, next.removed)).toBe(100);
    expect(planWorstCase(next.definition, next.nodes, next.removed)).toEqual(budget(106));
    expect(next.nodes["run-0"]?.priorAttempts).toEqual([...p.nodes["run-0"]!.priorAttempts!, expect.objectContaining({ attempt: p.nodes["run-0"]!.attempt, workspaceId: "space-0", spent: 5 })]);
  });
  it("retains removed spending without counting a retained identity twice", () => {
    const p = capacityPlan();
    p.removed![0]!.state = { state: "planned", spent: 3, priorAttempts: [{ state: "done", spent: 1, attempt: randomUUID() }] };
    p.removed!.push({ node: run("run-1"), state: structuredClone(p.nodes["run-1"]!) });
    expect(planSpent(p.nodes, p.removed)).toBe(103);
    expect(planWorstCase(p.definition, p.nodes, p.removed)).toEqual(budget(108));
    expect(() => checkNewWorkflowAction(replacement(p, 108), p, [p])).toThrow(/109/);
    expect(() => checkNewWorkflowAction(replacement(p, 109), p, [p])).not.toThrow();
  });
  it("replays committed underdeclared replacements unchanged through both readers", () => {
    const p = capacityPlan();
    p.definition.nodes = [run("run-0"), run("run-1"), run("run-92")];
    p.nodes = Object.fromEntries(p.definition.nodes.map(n => [n.id, p.nodes[n.id]!]));
    // Historically legal (spent+1), yet below total pending commitments. Admission
    // now refuses it; committed replay must retain its exact command/hash and cap.
    const historical = event(p, replacement(p, 11)), bytes = JSON.stringify(historical);
    const next = replayWorkflowEvent(p, WorkflowEventSchema.parse(historical));
    expect(next.definition.budget).toEqual(budget(11));
    expect(next.hash).toBe(historical.hash);
    expect(planSpent(next.nodes, next.removed)).toBe(10);
    expect(planWorstCase(next.definition, next.nodes, next.removed)).toEqual(budget(12));
    expect(replaySupervisionWorkflow(p, historical, workflowHomeIdentity(historical.home))).toEqual(next);
    expect(JSON.stringify(historical)).toBe(bytes);
    expect(() => checkNewWorkflowAction(historical.command, p, [p])).toThrow(/12/);
  });
  it("requires a compatible reader after publishing a greater-than-100 event", () => {
    const p = capacityPlan(), committed = event(p, replacement(p, 106));
    expect(WorkflowEventSchema.safeParse(committed).success).toBe(true);
    // Reapply the old reader's exact budget contract to the same event schema.
    const oldBudget = z.object({ agents: z.number().int().min(1).max(100), turns: z.number().int().min(1).max(100) }).strict();
    const oldReader = WorkflowEventSchema.refine(e => e.command.op !== "replace" || oldBudget.safeParse(e.command.budget).success);
    expect(oldReader.safeParse(committed).success).toBe(false);
    expect(oldReader.safeParse(event(p, replacement(p, 100))).success).toBe(true);
  });
});

it("refuses underdeclared appends without publishing; admits and replays one same-workspace replacement", async () => {
  const home = join(process.env.PASEO_HOME!, randomUUID()), root = join(home, "ledger");
  await mkdir(join(home, "data/run-0"), { recursive: true });
  await writeFile(join(home, "data/run-0/brief.md"), "Bounded replacement fixture");
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  const store = new WorkflowPlanStore(root, home);
  const execute = (c: WorkflowCommand, id = randomUUID()) => store.execute(c, id, "fixture-mate") as Promise<any>;
  const definition = PlanDefinitionSchema.parse({ ...workflowFixture(), id: "capacity", nodes: [run("run-0"), run("pending")], budget: budget(2), ownership: { owner: "firstmate", evidence: "Captain delegates this outcome" } });
  await execute({ op: "draft", definition });
  const first = await execute({ op: "start", plan: "capacity", node: "run-0" });
  await execute({ op: "record", plan: "capacity", node: "run-0", attempt: first.launch.workflow.attempt, state: "running", agentId: "worker", workspaceId: "space-0", evidence: "Inspected worker" });
  const p = (await store.get("capacity"))!;
  const bytes = async () => Promise.all(["capacity", ".tips/capacity", ".published/capacity"].map(async part => Promise.all((await readdir(join(root, part))).sort().map(async name => [part, name, await readFile(join(root, part, name), "utf8")]))));
  const before = await bytes();
  await expect(execute(replacement(p, 2))).rejects.toThrow(/3/);
  expect(await bytes()).toEqual(before);
  expect((await store.get("capacity"))!.hash).toBe(p.hash);
  await expect(execute({ ...replacement(p, 3), expected: "0".repeat(64) })).rejects.toThrow(/current/);
  const id = randomUUID(), c = replacement(p, 3);
  await execute(c, id);
  const next = (await store.get("capacity"))!;
  expect(next.status).toBe("active"); expect(next.nodes["run-0"]?.spent).toBe(1);
  expect((await execute(c, id)).plan).toEqual(next);
  await expect(execute({ ...c, budget: budget(4) }, id)).rejects.toThrow("different content");
  const second = await execute({ op: "start", plan: "capacity", node: "run-0" });
  await expect(execute({ op: "record", plan: "capacity", node: "run-0", attempt: second.launch.workflow.attempt, state: "running", agentId: "worker-2", workspaceId: "other-space", evidence: "Wrong workspace" })).rejects.toThrow("workspace identity");
  await execute({ op: "record", plan: "capacity", node: "run-0", attempt: second.launch.workflow.attempt, state: "running", agentId: "worker-2", workspaceId: "space-0", evidence: "Same workspace" });
  const replayed = (await new WorkflowPlanStore(root, home).get("capacity"))!;
  expect(planSpent(replayed.nodes, replayed.removed)).toBe(2);
  expect(replayed.nodes["run-0"]?.priorAttempts?.[0]).toMatchObject({ agentId: "worker", workspaceId: "space-0", attempt: first.launch.workflow.attempt });
});

it("still refuses an extra start at the exact cumulative cap", () => {
  const p = capacityPlan();
  const e = { ...event(p, { op: "start", plan: p.definition.id, node: "run-92" }), attempt: randomUUID(), briefHash: "a".repeat(64) };
  expect(() => replayWorkflowEvent(p, e)).toThrow("cumulative budget is exhausted");
  expect(planSpent(p.nodes, p.removed)).toBe(100);
});
