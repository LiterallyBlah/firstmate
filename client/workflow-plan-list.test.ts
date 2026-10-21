import { expect, it } from "vitest";
import { workflowFixture } from "../test/workflow-fixture";
import type { NodeState, WorkflowPlan } from "../shared/workflow-plans";
import { dependencyText, planBudgetUsed, planGroups, planStatus, runState } from "./workflow-plan-list";

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
