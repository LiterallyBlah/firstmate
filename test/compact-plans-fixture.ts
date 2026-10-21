/** Real-shaped Starpath/reader-pass topology; synthetic progress, workers, hosts and evidence. */
import { workflowFixture } from "./workflow-fixture";
import type { PlanNode, WorkflowPlan } from "../shared/workflow-plans";

type Run = Extract<PlanNode, { kind: "run" }>;
function run(id: string, title: string, project: string, after: PlanNode["after"], reviewer?: string): Run {
  const source = workflowFixture().nodes[0] as Run;
  return { ...source, id, title, summary: title, after, workflow: reviewer ? "scout@1" : "task@1",
    launch: { ...source.launch, id, title, project, host: "Remote lab", agentTitle: title.slice(0, 60), kind: reviewer ? "scout" : "ship",
      brief: { file: `data/${id}/brief.md` }, agent: { ...source.launch.agent, provider: reviewer === "opus" ? "claude/claude-opus-5-5" : reviewer === "astra" ? "codex/gpt-6-astra" : "codex/gpt-6.1-sol" } } };
}
function reviewed(id: string, title: string, project: string, after: PlanNode["after"]): PlanNode[] {
  return [run(id, title, project, after), ...["astra", "opus"].map(reviewer => run(`${id}-review-${reviewer}`,
    `Independent ${reviewer} review of ${project === "starpath" ? "scheduler" : "reader pass"} slice ${id.match(/(?:slice|s)(\d+)$/)?.[1]}`,
    project, [{ node: id, on: "done", reason: "needs-evidence" }], reviewer))];
}
function plan(id: string, title: string, nodes: PlanNode[]): WorkflowPlan {
  return { definition: { ...workflowFixture(), id, title, nodes, implicit: false, budget: { agents: nodes.length, turns: nodes.length } },
    revision: 1, sequence: 0, hash: "a".repeat(64), posture: "sail", status: "active", approvedBudget: { agents: nodes.length, turns: nodes.length },
    nodes: Object.fromEntries(nodes.map(n => [n.id, { state: "planned" }])), told: [], handled: [], history: [] };
}
export function compactPlansFixture(): WorkflowPlan[] {
  const star = plan("starpath-scheduler", "Finish the Starpath scheduler: slices 10 to 16", [
    ...["parallel execution", "parked threads", "ranking in the scheduler", "invalidation and replay blocking", "research pack on by default", "postgres deployment", "decision nodes in shadow"].flatMap((title, i) => {
      const slice = i + 10;
      return reviewed(`starpath-scheduler-slice${slice}`, `Build scheduler slice ${slice}: ${title}`, "starpath",
        [{ node: `starpath-scheduler-slice${slice === 15 ? 13 : slice === 16 ? 14 : slice - 1}`, on: "landed", reason: "builds-on" },
          ...(slice === 15 ? [{ node: "starpath-postgres-deploy", on: "answered" as const, reason: "decision" as const }] : [])]);
    }),
    { ...(workflowFixture().nodes[1] as Extract<PlanNode, { kind: "decision" }>), id: "starpath-postgres-deploy", title: "Approve building the Postgres deployment, slice 15",
      after: [{ node: "starpath-scheduler-slice13", on: "landed", reason: "builds-on" }], recommendation: "build",
      options: [{ id: "build", label: "Build the deployment", consequence: "Prepare the deployment without deploying it." }, { id: "wait", label: "Wait", consequence: "Keep deployment work paused." }] },
  ]);
  for (const slice of [10, 11, 12]) {
    star.nodes[`starpath-scheduler-slice${slice}`] = { state: "landed", spent: 1 };
    for (const reviewer of ["astra", "opus"]) star.nodes[`starpath-scheduler-slice${slice}-review-${reviewer}`] = { state: "done", spent: 1 };
  }
  star.nodes["starpath-scheduler-slice13"] = { state: "done", spent: 1 };
  star.nodes["starpath-scheduler-slice13-review-astra"] = { state: "done", spent: 1 };
  star.nodes["starpath-scheduler-slice13-review-opus"] = { state: "running", spent: 1, agentId: "fixture-opus" };
  const reader = plan("ariadne-reader-pass", "Build the reader pass into chapter-making and roll it out", [
    ...[[4, "runner integration"], [5, "the captain controls"], [7, "the reader-pass probe"], [8, "the Anthropic reader route"]].flatMap(([slice, title]) =>
      reviewed(`ariadne-reader-pass-s${slice}`, `Build reader pass slice S${slice}: ${title}`, "Ariadne", slice === 4 ?
        [{ node: "ariadne-reader-pass-s2", on: "landed", reason: "builds-on" }, { node: "ariadne-reader-pass-s3", on: "landed", reason: "builds-on" }] :
        [{ node: `ariadne-reader-pass-s${slice === 5 ? 4 : 3}`, on: "landed", reason: "builds-on" }])),
    ...["claude-signin", "deploy"].map((id, i): PlanNode => ({ ...(workflowFixture().nodes[1] as Extract<PlanNode, { kind: "decision" }>), id: `ariadne-reader-pass-${id}`,
      title: i ? "Deploy the reader pass and switch it on" : "Sign in to the Claude subscription for Opus readers",
      after: [{ node: `ariadne-reader-pass-${i ? "r1" : "s8"}`, on: i ? "done" : "landed", reason: i ? "needs-evidence" : "builds-on" }], recommendation: "proceed",
      options: [{ id: "proceed", label: i ? "Deploy" : "Sign in", consequence: "Continue after the evidence is reviewed." }, { id: "wait", label: "Wait", consequence: "Keep the current setup." }] })),
    run("ariadne-reader-pass-r1", "Run reader pass R1: yield and parity checks", "Ariadne", [
      { node: "ariadne-reader-pass-s6", on: "landed", reason: "builds-on" }, { node: "ariadne-reader-pass-s7", on: "landed", reason: "builds-on" },
      { node: "ariadne-reader-pass-claude-signin", on: "answered", reason: "decision" }], "probe"),
    run("ariadne-reader-pass-r2", "Run reader pass R2: the next 3 chapters", "Ariadne", [{ node: "ariadne-reader-pass-deploy", on: "answered", reason: "decision" }], "probe"),
  ]);
  reader.nodes["ariadne-reader-pass-s4"] = { state: "running", spent: 1, agentId: "fixture-builder" };
  const duplicateNode = reader.definition.nodes[0]!;
  const duplicate = plan(duplicateNode.id, duplicateNode.title, [duplicateNode]); duplicate.definition.implicit = true;
  const prerequisites = ["ariadne-reader-pass-s2", "ariadne-reader-pass-s3", "ariadne-reader-pass-s6", "starpath-scheduler-slice9"].map(id => {
    const p = plan(id, `Earlier work: ${id}`, [run(id, `Earlier work: ${id}`, id.startsWith("starpath") ? "starpath" : "Ariadne", [])]);
    p.definition.implicit = true; p.nodes[id] = { state: "landed", spent: 1 }; return p;
  });
  return [star, reader, duplicate, ...prerequisites];
}

export function closedTrialsFixture(): WorkflowPlan[] {
  return Array.from({ length: 6 }, (_, i) => {
    const id = `evidence-trial-${i}`, title = `Evidence-only trial ${i + 1}`;
    const p = plan(id, title, [run(id, title, "Experiments", [])]); p.definition.implicit = true;
    p.definition.request.text = "Run an experiment and retain its branch and report as evidence; nothing is intended to land.";
    p.nodes[id] = { state: "done", spent: 1, evidence: "Verified experiment report", completedAt: "2026-10-21T12:00:00Z",
      closedWithoutLanding: { at: "2026-10-21T13:00:00Z", by: "mate", evidence: "Inspected branch and report. This completed trial has no deliverable to merge or deploy." } };
    return p;
  });
}
