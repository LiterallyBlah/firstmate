import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { workflowFixture } from "../test/workflow-fixture";
import { attentionRequest, attentionSnapshot } from "../test/attention-deck-fixture";
import { decisionCardSnapshot } from "../shared/plan-decisions";
import { PlanDefinitionSchema, planOwner, type PlanDefinition, type WorkflowCommand } from "../shared/workflow-plans";
import { workflowStore } from "./workflow-service";
import { planSubjectHash } from "./workflow-plans";
import { workflowSnapshot, withWorkflowNeeds } from "./workflow-board";

let home: string;
const originalHome = process.env.PASEO_HOME!;
beforeEach(async () => {
  process.env.PASEO_HOME = join(originalHome, randomUUID());
  home = join(process.env.PASEO_HOME, "home");
  for (const id of ["trial", "build", "extra-a", "extra-b", "database"]) {
    await mkdir(join(home, "data", id), { recursive: true });
    await writeFile(join(home, "data", id, "brief.md"), `Brief for ${id}`);
  }
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
});
const store = () => workflowStore(home);
async function draft(delegated: boolean) {
  const definition = workflowFixture();
  if (delegated) {
    definition.ownership = { owner: "firstmate", evidence: "Captain: own this outcome and routine stages." };
  }
  await store().execute({ op: "draft", definition }, randomUUID(), "mate-v1");
  return definition;
}
async function current() { return (await store().get("scheduler"))!; }
async function transfer(owner: "captain" | "firstmate", evidence = `Captain explicitly transfers to ${owner}`) {
  const p = await current();
  return store().execute({ op: "captain", plan: "scheduler", revision: p.revision, subjectHash: planSubjectHash(p), action: "transfer", owner, text: evidence }, randomUUID(), "board:captain");
}
async function progress(action: "stage" | "answer", node?: string, option?: string, evidence = "Reviewed current plan and evidence") {
  const p = await current();
  return store().execute({ op: "progress", plan: "scheduler", revision: p.revision, subjectHash: planSubjectHash(p), action, evidence, ...(node ? { node } : {}), ...(option ? { option } : {}) }, randomUUID(), "mate-v2");
}

it("keeps existing and new default plans captain-owned; explicit transfer survives restart, stales pending decisions and replays once", async () => {
  await draft(false);
  const before = await current();
  expect(planOwner(before)).toBe("captain");
  const stale = { op: "captain" as const, plan: "scheduler", revision: before.revision, subjectHash: planSubjectHash(before), action: "approve" as const, text: "" };
  await expect(progress("stage")).rejects.toThrow("captain owns");
  const id = randomUUID();
  const transferCommand = { ...stale, action: "transfer" as const, owner: "firstmate" as const, text: "Captain delegates routine progression" };
  await store().execute(transferCommand, id, "board:captain");
  expect((await current()).status).toBe("active");
  expect((await workflowSnapshot(home)).comingUp).toEqual([]); // Explicit transfer delegates pending routine choices.
  expect((await current()).ownerEvents).toMatchObject([{ from: "captain", to: "firstmate", evidence: transferCommand.text }]);
  const madeCaptainOnly = structuredClone((await current()).definition);
  const oldChoice = madeCaptainOnly.nodes.find(n => n.id === "database"); if (oldChoice?.kind === "decision") oldChoice.authority = "captain";
  await store().execute({ op: "revise", definition: madeCaptainOnly, expected: (await current()).hash, reason: "Mark explicit captain exception" }, randomUUID(), "mate-v2");
  expect((await workflowSnapshot(home)).comingUp).toMatchObject([{ node: "database" }]);
  const altered = structuredClone((await current()).definition);
  const alteredChoice = altered.nodes.find(n => n.id === "database"); if (alteredChoice?.kind === "decision") alteredChoice.authority = "owner";
  await expect(store().execute({ op: "revise", definition: altered, expected: (await current()).hash, reason: "Quietly remove captain exception" }, randomUUID(), "mate-v2")).rejects.toThrow("captain-owned decision");
  await expect(store().execute(stale, randomUUID(), "board:captain")).rejects.toThrow("changed since you opened");
  await expect(store().execute(transferCommand, randomUUID(), "board:captain")).rejects.toThrow("changed since you opened");
  await transfer("captain");
  expect((await current()).status).toBe("review");
  expect((await current()).ownerEvents).toHaveLength(2);
  const replayed: any = await store().execute(transferCommand, id, "board:captain");
  expect(replayed.plan.owner).toBe("captain");
  expect((await current()).ownerEvents).toHaveLength(2);
  expect((await current()).definition.ownership).toBeUndefined();
  expect((await workflowSnapshot(home)).now).toMatchObject([{ review: { revision: 2 } }]);
});

it("lets a delegated plan extend count-only budget and answer once without a captain event, while captain control still stops", async () => {
  const definition = await draft(true), initial = await current();
  expect(initial.status).toBe("active");
  await progress("stage", undefined, undefined, "Proceed with the independent trial within delegated scope");
  expect((await current()).history.at(-1)?.reason).toContain("Delegated stage");
  expect((await current()).captainEvents).toBeUndefined();
  const started: any = await store().execute({ op: "start", plan: "scheduler", node: "trial" }, randomUUID(), "mate-v1");
  await store().execute({ op: "record", plan: "scheduler", node: "trial", attempt: started.launch.workflow.attempt, state: "done", evidence: "Verified trial report" }, randomUUID(), "mate-v2");
  const ready = await current();
  expect((await workflowSnapshot(home)).now).toEqual([]);
  const legacy = attentionRequest("database"); legacy.source.project = "scheduler";
  legacy.source.key = JSON.stringify([["local"], "scheduler", "database"]);
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n- [ ] database - Choose database (kind: captain) (project: scheduler) (plan: scheduler) (hold: Which database?)\n## Done\n");
  const delegatedNeeds = await withWorkflowNeeds(attentionSnapshot([legacy]), home);
  expect(delegatedNeeds.requests).toEqual([]); expect(delegatedNeeds.planNow).toEqual([]); expect(delegatedNeeds.actionCount).toBe(0);
  const answer = { op: "progress" as const, plan: "scheduler", revision: ready.revision, subjectHash: planSubjectHash(ready), action: "answer" as const, node: "database", option: "sqlite", evidence: "Trial favors SQLite" };
  const answerId = randomUUID();
  await store().execute(answer, answerId, "mate-v2");
  await expect(store().execute({ ...answer, option: "postgres" }, randomUUID(), "mate-v2")).rejects.toThrow("changed since you opened");
  await store().execute(answer, answerId, "mate-v2");
  expect((await current()).captainEvents).toBeUndefined();
  expect((await current()).nodes.database?.answer).toBe("sqlite");
  const build: any = await store().execute({ op: "start", plan: "scheduler", node: "build" }, randomUUID(), "mate-v2");
  expect(build.launch.workflow.attempt).toBeTruthy();
  const expanded = structuredClone(definition);
  for (const id of ["extra-a", "extra-b"]) {
    const run = structuredClone(definition.nodes.find(n => n.id === "build")!);
    if (run.kind !== "run") throw new Error("fixture");
    run.id = id; run.title = id; run.launch.id = id; run.launch.title = id; run.launch.brief.file = `data/${id}/brief.md`; run.after = [];
    expanded.nodes.push(run);
  }
  expanded.budget = { agents: 4, turns: 4 };
  await store().execute({ op: "revise", definition: expanded, expected: (await current()).hash, reason: "Two independent implementation checks within delegated scope" }, randomUUID(), "mate-v2");
  const after = await current();
  expect(after.status).toBe("active");
  expect(after.nodes.build?.attempt).toBe(build.launch.workflow.attempt);
  expect(after.nodes.trial?.spent).toBe(1);
  expect(after.approvedBudget).toEqual({ agents: 2, turns: 2 }); // No captain approval was forged.
  expect((await store().agenda()).filter(i => i.kind === "start").map(i => i.node).sort()).toEqual(["extra-a", "extra-b"]);
  expect(await readFile(join(home, "data/plans/scheduler/plan.md"), "utf8")).toContain("FirstMate (routine plan progression)");
  const widened = structuredClone(expanded);
  if (widened.nodes[3]?.kind === "run") widened.nodes[3].launch.host = "other-host";
  await expect(store().execute({ op: "revise", definition: widened, expected: after.hash, reason: "Move work" }, randomUUID(), "mate-v2")).rejects.toThrow("scope");
  if (widened.nodes[3]?.kind === "run") { widened.nodes[3].launch.host = "local"; widened.nodes[3].launch.captainAuthority = { hold: "Get access", authority: "Captain must grant access" }; }
  await expect(store().execute({ op: "revise", definition: widened, expected: after.hash, reason: "Add access gate" }, randomUUID(), "mate-v2")).rejects.toThrow("captain authority");
  await expect(store().execute({ op: "approve", plan: "scheduler", expected: after.hash, quote: "Pretend captain approved" }, randomUUID(), "mate-v2")).rejects.toThrow("belongs to FirstMate");
}, 15000);

it("keeps captain-only decisions and holds with the captain under delegation, and suppresses the plan-associated legacy gate", async () => {
  const definition = workflowFixture();
  definition.ownership = { owner: "firstmate", evidence: "Captain delegates routine work" };
  const decision = definition.nodes.find(n => n.id === "database")!;
  if (decision.kind !== "decision") throw new Error("fixture");
  decision.authority = "captain";
  await store().execute({ op: "draft", definition }, randomUUID(), "mate-v1");
  const started: any = await store().execute({ op: "start", plan: "scheduler", node: "trial" }, randomUUID(), "mate-v1");
  await store().execute({ op: "record", plan: "scheduler", node: "trial", attempt: started.launch.workflow.attempt, state: "done", evidence: "Trial report inspected" }, randomUUID(), "mate-v2");
  await expect(progress("answer", "database", "sqlite")).rejects.toThrow("belongs to the captain");
  const now = await workflowSnapshot(home);
  expect(now.now).toMatchObject([{ node: "database" }]);
  const legacy = attentionRequest("database");
  legacy.source.project = "scheduler";
  legacy.source.key = JSON.stringify([["local"], "scheduler", "database"]);
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n- [ ] database - Choose database (kind: captain) (project: scheduler) (plan: scheduler) (hold: Which database?)\n## Done\n");
  const needs = await withWorkflowNeeds(attentionSnapshot([legacy]), home);
  expect(needs.requests).toEqual([]);
  expect(needs.actionCount).toBe(1);
  expect(decisionCardSnapshot(needs).requests).toHaveLength(1);
  const p = await current();
  await store().execute({ op: "captain", plan: "scheduler", revision: p.revision, subjectHash: planSubjectHash(p), action: "hold", text: "Pause for access" }, randomUUID(), "board:captain");
  await expect(progress("answer", "database", "sqlite")).rejects.toThrow("belongs to the captain");
  await store().execute({ op: "captain", plan: "scheduler", revision: (await current()).revision, subjectHash: planSubjectHash(await current()), action: "resume", text: "Access clarified" }, randomUUID(), "board:captain");
  expect((await current()).status).toBe("active");
  const latest = await current();
  await store().execute({ op: "captain", plan: "scheduler", revision: latest.revision, subjectHash: planSubjectHash(latest), action: "answer", node: "database", option: "sqlite", text: "Captain chooses SQLite" }, randomUUID(), "board:captain");
  expect((await current()).captainEvents?.at(-1)?.action).toBe("answer");
});

it("reproduces the captain's 1.5x replacement stop and keeps delegated relaunch accounted", async () => {
  for (const delegated of [false, true]) {
    const node = structuredClone(workflowFixture().nodes[0]!);
    if (node.kind !== "run") throw new Error("fixture");
    node.id = delegated ? "delegated-trial" : "captain-trial";
    node.launch.id = node.id; node.launch.brief.file = `data/${node.id}/brief.md`;
    await mkdir(join(home, "data", node.id), { recursive: true });
    await writeFile(join(home, "data", node.id, "brief.md"), "Bounded trial");
    const definition: PlanDefinition = PlanDefinitionSchema.parse({ ...workflowFixture(), id: delegated ? "delegated" : "captain", nodes: [node], budget: { agents: 1, turns: 1 }, ...(delegated ? { ownership: { owner: "firstmate", evidence: "Captain delegates this bounded outcome" } } : {}) });
    await store().execute({ op: "draft", definition }, randomUUID(), "mate-v1");
    const started: any = await store().execute({ op: "start", plan: definition.id, node: node.id }, randomUUID(), "mate-v1");
    await store().execute({ op: "record", plan: definition.id, node: node.id, attempt: started.launch.workflow.attempt, state: "running", evidence: "Worker observed", agentId: `worker-${definition.id}`, workspaceId: `space-${definition.id}` }, randomUUID(), "mate-v1");
    const before = (await store().get(definition.id))!;
    await store().execute({ op: "replace", plan: definition.id, node: node.id, attempt: started.launch.workflow.attempt, expected: before.hash, kind: "relaunch", budget: { agents: 2, turns: 2 }, evidence: "Worker failed; preserve workspace and retry" }, randomUUID(), "mate-v2");
    const after = (await store().get(definition.id))!;
    expect(after.status).toBe(delegated ? "active" : "review");
    expect(after.nodes[node.id]?.spent).toBe(1);
    expect(after.nodes[node.id]?.priorAttempts?.[0]?.workspaceId).toBe(`space-${definition.id}`);
    expect(after.definition.budget).toEqual({ agents: 2, turns: 2 });
    expect(after.approvedBudget).toEqual({ agents: 1, turns: 1 });
  }
}, 15000);
it("refuses a delegated start behind an unapproved access gate", async () => {
  const definition = workflowFixture();
  definition.ownership = { owner: "firstmate", evidence: "Captain delegates routine development" };
  const trial = definition.nodes[0]; if (trial?.kind !== "run") throw new Error("fixture");
  trial.launch.captainAuthority = { hold: "Grant production access", authority: "Captain explicitly grants access" };
  await store().execute({ op: "draft", definition }, randomUUID(), "mate-v1");
  await expect(store().execute({ op: "start", plan: "scheduler", node: "trial" }, randomUUID(), "mate-v2")).rejects.toThrow("captain authority gate");
  expect((await current()).nodes.trial?.attempt).toBeUndefined();
});
it("keeps scout-only delegation from becoming ship work through a revision or added run", async () => {
  const definition = workflowFixture();
  definition.ownership = { owner: "firstmate", evidence: "Captain delegates investigation and report only" };
  definition.request.text = "Investigate storage and report; implementation requires a separate Captain choice.";
  definition.nodes = [definition.nodes[0]!]; definition.budget = { agents: 1, turns: 1 };
  await store().execute({ op: "draft", definition }, randomUUID(), "mate-v1");
  const before = await current(), promoted = structuredClone(before.definition);
  const trial = promoted.nodes[0]; if (!trial || trial.kind !== "run") throw new Error("fixture");
  trial.workflow = "task@1"; trial.launch.kind = "ship";
  await expect(store().execute({ op: "revise", definition: promoted, expected: before.hash, reason: "Promote investigation" }, randomUUID(), "mate-v2")).rejects.toThrow("scope");
  expect((await current()).hash).toBe(before.hash);
  const added = structuredClone(before.definition), newRun = structuredClone(added.nodes[0]!);
  if (newRun.kind !== "run") throw new Error("fixture");
  newRun.id = "extra-a"; newRun.launch.id = "extra-a"; newRun.launch.brief.file = "data/extra-a/brief.md";
  newRun.workflow = "task@1"; newRun.launch.kind = "ship"; added.nodes.push(newRun); added.budget = { agents: 2, turns: 2 };
  await expect(store().execute({ op: "revise", definition: added, expected: before.hash, reason: "Add implementation" }, randomUUID(), "mate-v2")).rejects.toThrow("scope");
  newRun.workflow = "scout@1"; newRun.launch.kind = "scout";
  await store().execute({ op: "revise", definition: added, expected: before.hash, reason: "Run a second in-scope investigation" }, randomUUID(), "mate-v2");
  expect((await current()).status).toBe("active");
});
it("preserves every Captain-gate path when a delegated plan has two consumers", async () => {
  const definition = workflowFixture();
  definition.ownership = { owner: "firstmate", evidence: "Captain delegates implementation after the explicit gate" };
  const gate = definition.nodes.find(n => n.id === "database")!;
  if (gate.kind !== "decision") throw new Error("fixture");
  gate.authority = "captain"; gate.after = [];
  const trial = definition.nodes.find(n => n.id === "trial")!;
  if (trial.kind !== "run") throw new Error("fixture");
  trial.after = [{ node: "database", reason: "decision", on: "answered" }];
  await store().execute({ op: "draft", definition }, randomUUID(), "mate-v1");
  await expect(store().execute({ op: "start", plan: "scheduler", node: "build" }, randomUUID(), "mate-v2")).rejects.toThrow("dependencies");
  const before = await current(), unguarded = structuredClone(before.definition);
  unguarded.nodes.find(n => n.id === "build")!.after = [];
  await expect(store().execute({ op: "revise", definition: unguarded, expected: before.hash, reason: "Remove the second gate edge" }, randomUUID(), "mate-v2")).rejects.toThrow("captain gate");
  expect((await current()).hash).toBe(before.hash);
  const expanded = structuredClone(before.definition), added = structuredClone(expanded.nodes.find(n => n.id === "build")!);
  if (added.kind !== "run") throw new Error("fixture");
  added.id = "extra-a"; added.launch.id = "extra-a"; added.launch.brief.file = "data/extra-a/brief.md"; added.after = [];
  expanded.nodes.push(added); expanded.budget = { agents: 3, turns: 3 };
  await expect(store().execute({ op: "revise", definition: expanded, expected: before.hash, reason: "Add ungated work in the protected scope" }, randomUUID(), "mate-v2")).rejects.toThrow("captain gate");
  expect((await current()).hash).toBe(before.hash);
  const routine = structuredClone(before.definition); routine.nodes.find(n => n.id === "build")!.title = "Build the scheduler with verified evidence";
  await store().execute({ op: "revise", definition: routine, expected: before.hash, reason: "Clarify the work title" }, randomUUID(), "mate-v2");
  expect((await current()).definition.nodes.find(n => n.id === "build")?.after).toEqual(before.definition.nodes.find(n => n.id === "build")?.after);
  added.after = structuredClone(before.definition.nodes.find(n => n.id === "build")!.after);
  const next = structuredClone((await current()).definition); next.nodes.push(added); next.budget = { agents: 3, turns: 3 };
  await store().execute({ op: "revise", definition: next, expected: (await current()).hash, reason: "Add a gated in-scope build" }, randomUUID(), "mate-v2");
  expect((await current()).status).toBe("active");
}, 15000);
it("keeps an invalid standing-order posture for captain review under delegation", async () => {
  await writeFile(join(home, "data/captain.md"), "```standing-orders\nplan-posture: sometimes\n```");
  await draft(true);
  expect((await current()).status).toBe("review");
  expect((await workflowSnapshot(home)).now).toMatchObject([{ review: { revision: 1 } }]);
  await expect(progress("stage")).rejects.toThrow("captain review");
  const p = await current();
  await store().execute({ op: "captain", plan: "scheduler", revision: p.revision, subjectHash: planSubjectHash(p), action: "approve", text: "Reviewed invalid posture" }, randomUUID(), "board:captain");
  expect((await current()).status).toBe("active");
});
