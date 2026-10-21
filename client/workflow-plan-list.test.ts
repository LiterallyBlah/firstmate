import { expect, it } from "vitest";
import { workflowFixture } from "../test/workflow-fixture";
import type { NodeState, WorkflowPlan } from "../shared/workflow-plans";
import { dependencyText, planBudgetUsed, planGroups, planStatus, runState, planSteps, planSummary, stepState, reviewStatus, uniquePlans } from "./workflow-plan-list";
import { compactPlansFixture } from "../test/compact-plans-fixture";

function plan(id: string, state: NodeState = "planned"): WorkflowPlan {
  const definition = workflowFixture(); definition.id = id; definition.title = id;
  return { definition, revision: 1, sequence: 0, hash: "a".repeat(64), posture: "review", status: "active", approvedBudget: { agents: 2, turns: 2 },
    nodes: { trial: { state }, database: { state }, build: { state } }, told: [], handled: [], history: [] };
}

it("keeps ship deliverables and uncertain evidence open, orders review first and finished history by completion", () => {
  const old = plan("old", "landed"), recent = plan("recent", "landed"), ship = plan("ship", "done"), uncertain = plan("uncertain", "landed"), review = plan("review"), declined = plan("declined");
  old.nodes.build!.completedAt = "2026-10-20T13:00:00Z";
  recent.nodes.build!.completedAt = "2026-10-21T13:00:00Z";
  uncertain.nodes.build!.invalidated = "Head changed"; review.status = "review"; declined.status = "abandoned";
  const groups = planGroups([old, ship, uncertain, declined, recent, review]);
  expect(groups.open.map(p => p.definition.id)).toEqual(["review", "ship", "uncertain"]);
  expect(groups.finished.map(p => p.definition.id)).toEqual(["recent", "old", "declined"]);
  expect(planStatus(review)).toBe("Awaiting approval"); expect(planStatus(declined)).toBe("Declined");
});

it.each([ ["planned", "ready"], ["starting", "starting"], ["running", "running"], ["done", "done"], ["landed", "landed"], ["failed", "failed"], ["cancelled", "cancelled"], ["unresolved", "uncertain"] ] as const)("presents durable %s as %s", (state, label) => {
  expect(runState({ state })).toBe(label);
});
it("does not label invalidated or missing evidence ready", () => {
  expect(runState({ state: "done", invalidated: "Stale result" })).toBe("uncertain");
  expect(runState(undefined)).toBe("uncertain");
});
it("searches title, task, assigned worker and pinned host without modifying the snapshot", () => {
  const p = plan("Authored scheduler"), other = plan("other");
  other.definition.nodes = other.definition.nodes.map(n => ({ ...n, title: "Unrelated work" }));
  const node = p.definition.nodes[0]!; if (node.kind !== "run") throw new Error("fixture");
  p.nodes.trial = { state: "running", agentId: "agent-42", launch: { ...node.launch, host: "Remote lab", agentTitle: "Storage engineer" } };
  const before = JSON.stringify(p);
  for (const search of ["AUTHORED", "database trial", "agent-42", "storage engineer", " remote lab "]) expect(planGroups([p, other], search).open).toEqual([p]);
  expect(planGroups([p], "missing").open).toEqual([]); expect(JSON.stringify(p)).toBe(before);
});
it("counts cumulative spent once, including removed runs and legacy attempt records", () => {
  const p = plan("budget");
  p.nodes.trial = { state: "running", attempt: "current", spent: 3, priorAttempts: [{ state: "failed", attempt: "old", spent: 2 }] };
  p.nodes.build = { state: "starting", attempt: "legacy" };
  p.removed = [{ node: { ...p.definition.nodes[0]!, id: "removed" }, state: { state: "cancelled", spent: 2 } }];
  expect(planBudgetUsed(p)).toEqual({ agents: 6, turns: 6 });
});
it("resolves cross-plan dependency reasons and preserves missing identifiers", () => {
  const p = plan("dependencies");
  expect(dependencyText({ node: "trial", reason: "needs-evidence", on: "done" }, [p])).toBe("Database trial — needs its evidence; once done");
  expect(dependencyText({ node: "build", reason: "builds-on", on: "landed" }, [p])).toContain("needs its code; after landing");
  expect(dependencyText({ node: "database", reason: "decision", on: "answered" }, [p])).toContain("needs your answer; once answered");
  expect(dependencyText({ node: "missing", reason: "shared-state", on: "done" }, [p])).toBe("missing — shares mutable state; once done");
});

it("groups the seven Starpath builds with their fourteen reviews, retaining reader probes and decisions", () => {
  const [star, reader] = compactPlansFixture();
  const steps = planSteps(star!);
  expect(steps.filter(s => s.node.kind === "run")).toHaveLength(7);
  expect(steps.flatMap(s => s.reviews)).toHaveLength(14);
  expect(steps[0]!.reviews.map(n => n.id)).toEqual(["starpath-scheduler-slice10-review-astra", "starpath-scheduler-slice10-review-opus"]);
  expect(planSteps(reader!).filter(s => s.node.kind === "run")).toHaveLength(6);
  expect(planSteps(reader!).filter(s => s.node.kind === "decision")).toHaveLength(2);
  expect(planSteps(reader!).flatMap(s => s.reviews)).toHaveLength(8);
});

it("leaves ambiguously linked reviews and ordinary investigations as independent steps", () => {
  const [p] = compactPlansFixture(), review = p!.definition.nodes[1]!;
  review.after.push({ node: "starpath-scheduler-slice11", on: "done", reason: "needs-evidence" });
  expect(planSteps(p!).some(s => s.node.id === review.id)).toBe(true);
  review.after.pop(); review.title = "Investigate performance after the build";
  expect(planSteps(p!).some(s => s.node.id === review.id)).toBe(true);
});

it("derives readiness from done, landed and answered prerequisites, including cross-plan, held, invalidated and missing evidence", () => {
  const p = plan("dependencies"), trial = p.definition.nodes[0]!, decision = p.definition.nodes[1]!, build = p.definition.nodes[2]!;
  expect(stepState(p, decision, [p])).toBe("waiting on Database trial");
  p.nodes.trial!.state = "done";
  expect(stepState(p, decision, [p])).toBe("waiting for your decision");
  expect(stepState(p, build, [p])).toBe("waiting on Choose the database (answer)");
  p.nodes.database!.answer = "sqlite";
  expect(stepState(p, build, [p])).toBe("ready");
  p.nodes.database!.invalidated = "stale";
  expect(stepState(p, build, [p])).toContain("waiting on");
  trial.after = [{ node: "external", reason: "builds-on", on: "landed" }];
  const other = plan("external"); other.definition.nodes = [{ ...trial, id: "external", title: "Earlier slice", after: [] }]; other.nodes = { external: { state: "done" } };
  p.nodes.trial!.state = "planned";
  expect(stepState(p, trial, [p, other])).toBe("waiting on Earlier slice (landing)");
  other.nodes.external!.state = "landed";
  expect(stepState(p, trial, [p, other])).toBe("ready");
  other.nodes.external!.held = true;
  expect(stepState(p, trial, [p, other])).toContain("waiting on");
  expect(stepState(p, trial, [p])).toBe("waiting on external (landing)");
  p.status = "review"; trial.after = [];
  expect(stepState(p, trial, [p])).toBe("awaiting plan approval");
  p.status = "held"; expect(stepState(p, trial, [p])).toBe("on hold");
});

it("summarizes progress, active reviews, the next work and upcoming captain decisions without claiming done ship work landed", () => {
  const plans = compactPlansFixture(), [star] = plans;
  const summary = planSummary(star!, plans);
  expect(summary.progress).toBe("3 of 7 steps landed");
  expect(summary.running).toContain("slice 13: invalidation and replay blocking reviews (Opus)");
  expect(summary.next).toContain("waiting on");
  expect(summary.decisions).toContain("Approve building the Postgres deployment");
  const review = planSteps(star!)[3]!.reviews[0]!;
  expect(reviewStatus(star!, review, plans)).toBe("✓");
  star!.nodes[review.id]!.invalidated = "Evidence changed";
  expect(reviewStatus(star!, review, plans)).toBe("uncertain");
  expect(reviewStatus(star!, planSteps(star!)[4]!.reviews[0]!, plans)).toBe("pending");
});

it("hides automatic copies before searching, preserving different project/host tasks and the original snapshot", () => {
  const plans = compactPlansFixture(), duplicate = plans[2]!;
  duplicate.definition.title = "Only the automatic copy has these words";
  const before = JSON.stringify(plans);
  expect(planGroups(plans).open.map(p => p.definition.id)).not.toContain(duplicate.definition.id);
  expect(planGroups(plans, "Only the automatic copy").open).toEqual([]);
  const node = duplicate.definition.nodes[0]!; if (node.kind !== "run") throw new Error("fixture");
  expect(JSON.stringify(plans)).toBe(before);
  // A shared task id alone must not erase an unrelated host/project's work.
  duplicate.definition.nodes = [{ ...node, launch: { ...node.launch, host: "Another host" } }];
  expect(planGroups(plans).open.map(p => p.definition.id)).toContain(duplicate.definition.id);
  duplicate.definition.nodes = [{ ...node, launch: { ...node.launch, project: "Another project" } }];
  expect(planGroups(plans).open.map(p => p.definition.id)).toContain(duplicate.definition.id);
});
it.each(["starting", "running", "done", "failed", "unresolved"] as const)("retains an automatic %s run until its owner has recorded an outcome or start", state => {
  const plans = compactPlansFixture(), owner = plans[1]!, automatic = plans[2]!, node = automatic.definition.nodes[0]!;
  automatic.nodes[node.id] = { state, agentId: "automatic-worker", attempt: "automatic-attempt" };
  owner.nodes[node.id] = { state: "planned" };
  expect(uniquePlans(plans)).toContain(automatic);
  delete owner.nodes[node.id];
  expect(uniquePlans(plans)).toContain(automatic);
  owner.nodes[node.id] = { state: "running", agentId: "automatic-worker", attempt: "automatic-attempt" };
  expect(uniquePlans(plans)).not.toContain(automatic);
});
it("still hides a merely planned automatic copy when the owner has no recorded start", () => {
  const plans = compactPlansFixture(), owner = plans[1]!, automatic = plans[2]!, node = automatic.definition.nodes[0]!;
  owner.nodes[node.id] = { state: "planned" }; automatic.nodes[node.id] = { state: "planned" };
  expect(uniquePlans(plans)).not.toContain(automatic);
});
