import type { PlanNode, WorkflowPlan } from "../shared/workflow-plans";
import { workflowFixture } from "./workflow-fixture";

/** Diamond, decision and a final build; all four dependency reasons are represented. */
export function planGraphFixture(): WorkflowPlan {
  const source = workflowFixture(), run = source.nodes[0]!;
  if (run.kind !== "run") throw new Error("Expected run fixture");
  const build = (id: string, title: string, after: PlanNode["after"]): PlanNode => ({ ...run, id, title, after,
    launch: { ...run.launch, id, title, brief: { file: `data/${id}/brief.md` } } });
  const nodes: PlanNode[] = [build("root", "Prepare the interface", []),
    build("left", "Review the evidence", [{ node: "root", reason: "needs-evidence", on: "done" }]),
    build("right", "Build the independent adapter", [{ node: "root", reason: "builds-on", on: "landed" }]),
    { ...source.nodes[1]!, id: "join", title: "Choose the rollout", after: [
      { node: "left", reason: "needs-evidence", on: "done" }, { node: "right", reason: "shared-state", on: "done" }] },
    build("finish", "Implement the approved rollout", [{ node: "join", reason: "decision", on: "answered" }])];
  return { definition: { ...source, id: "diamond", title: "A parallel rollout", nodes, budget: { agents: 5, turns: 5 } },
    revision: 1, sequence: 1, hash: "a".repeat(64), posture: "sail", status: "active", approvedBudget: { agents: 5, turns: 5 },
    nodes: { root: { state: "landed" }, left: { state: "done" }, right: { state: "running", agentId: "adapter-worker" }, join: { state: "planned" }, finish: { state: "planned" } },
    told: [], handled: [], history: [] };
}
