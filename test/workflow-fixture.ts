import { PlanDefinitionSchema } from "../shared/workflow-plans";
export function workflowFixture() {
  const launch = (id: string, kind: "scout" | "ship") => ({ id, title: id === "trial" ? "Database trial" : "Build the scheduler", agentTitle: id, project: "scheduler", host: "local", baseBranch: "main", kind, mode: "reviewed-PR", brief: { file: `data/${id}/brief.md` }, agent: { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" }, backlog: { existing: "none" } });
  return PlanDefinitionSchema.parse({ format: "firstmate.plan/1", id: "scheduler", title: "Scheduler", request: { text: "Investigate storage, choose an approach, then build the scheduler.", at: "2026-10-20T12:00:00Z" }, budget: { agents: 2, turns: 2 }, nodes: [
    { kind: "run", id: "trial", title: "Database trial", summary: "Compare storage options with an isolated trial.", workflow: "scout@1", launch: launch("trial", "scout") },
    { kind: "decision", id: "database", title: "Choose the database", summary: "Choose the storage approach before implementation.", after: [{ node: "trial", reason: "needs-evidence", on: "done" }], options: [{ id: "sqlite", label: "SQLite", consequence: "Keep deployment simple; one database file." }, { id: "postgres", label: "Postgres", consequence: "Support concurrent writers; operate a service." }], recommendation: "sqlite", rationale: "The bounded workload fits a single process." },
    { kind: "run", id: "build", title: "Build the scheduler", summary: "Implement the chosen approach and deliver a reviewed pull request.", workflow: "task@1", launch: launch("build", "ship"), after: [{ node: "database", reason: "decision", on: "answered" }] },
  ] });
}
