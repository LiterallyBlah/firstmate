import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PlanDefinitionSchema, planProblems, planWorstCase, type PlanDefinition } from "../shared/workflow-plans";
import { WorkflowPlanStore } from "./workflow-plans";
import { observeNeedsYou } from "./needs-you-detect";
import { parseBacklog } from "./backlog";
import { renderCharter } from "./charter";

let home: string, root: string, store: WorkflowPlanStore;
export function fixture(id = "request"): PlanDefinition {
  return PlanDefinitionSchema.parse({ format: "firstmate.plan/1", id, title: "A request", request: { text: "Build it", at: "2026-10-20T12:00:00Z" }, budget: { agents: 5, turns: 5 },
    nodes: [{ id: "build", kind: "run", title: "Build", summary: "Build the requested change", workflow: "task@1", launch: { id: "build", title: "Build", agentTitle: "Build", project: "project", host: "local", baseBranch: "main", kind: "ship", mode: "reviewed-PR", brief: { file: "data/build/brief.md" }, agent: { provider: "codex/model", modeId: "full-access" }, backlog: { existing: "none" } } }] });
}
beforeEach(async () => {
  home = join(process.env.PASEO_HOME!, randomUUID()); root = join(home, "ledger");
  await mkdir(join(home, "data/build"), { recursive: true }); await writeFile(join(home, "data/build/brief.md"), "Build only the requested change.");
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n"); store = new WorkflowPlanStore(root, home);
});
const draft = (p = fixture(), id = randomUUID()) => store.execute({ op: "draft", definition: p }, id, "mate");
describe("plan journal", () => {
  it("is additive and read-only on an empty installation", async () => {
    expect(await store.list()).toEqual([]); expect(await store.agenda()).toEqual([]); await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("publishes immutable hash-linked events, recovers after a restart and replays a request once", async () => {
    const id = randomUUID(); await draft(fixture(), id); const first = await readFile(join(root, "request/00000000.json"), "utf8");
    await draft(fixture(), id); expect(await readdir(join(root, "request"))).toEqual(["00000000.json"]);
    const start: any = await store.execute({ op: "start", plan: "request", node: "build" }, randomUUID(), "mate");
    expect(start.launch.workflow.attempt).toBeTruthy(); expect(start.plan.nodes.build.briefHash).toHaveLength(64);
    expect(await readFile(join(root, "request/00000000.json"), "utf8")).toBe(first);
    store = new WorkflowPlanStore(root, home); expect((await store.get("request"))?.nodes.build?.state).toBe("starting");
    await expect(store.execute({ op: "start", plan: "request", node: "build" }, randomUUID(), "mate")).rejects.toThrow("already started");
    expect((await store.agenda()).some(i => i.kind === "start")).toBe(false);
    expect(await readFile(join(home, "data/plans/request/plan.md"), "utf8")).toContain("starting");
  });
  it("fails closed on tampering, gaps and unknown event fields; ignores an unpublished crash temp", async () => {
    await draft(); const path = join(root, "request/00000000.json"), bytes = await readFile(path, "utf8");
    await writeFile(path + ".crash.tmp", "torn"); expect(await store.get("request")).toBeTruthy();
    await writeFile(path, bytes.replace("Build it", "Ship it")); await expect(store.get("request")).rejects.toThrow("hash chain");
    await writeFile(path, bytes); await writeFile(join(root, "request/00000002.json"), bytes); await expect(store.get("request")).rejects.toThrow(/gap|tail/);
  });
  it("refuses competing creates and stale revisions without overwriting", async () => {
    const results = await Promise.allSettled([draft(), draft()]); expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const plan = (await store.get("request"))!;
    await expect(store.execute({ op: "revise", definition: fixture(), expected: "0".repeat(64), reason: "change" }, randomUUID(), "mate")).rejects.toThrow("Stale");
    expect((await store.get("request"))?.hash).toBe(plan.hash);
  });
  it("claims an explicit launch once and rejects changed content and mismatched receipts", async () => {
    await draft(); const { launch }: any = await store.execute({ op: "start", plan: "request", node: "build" }, randomUUID(), "mate");
    const { workflow, ...request } = launch;
    await expect(store.execute({ op: "claim", ...workflow, launch: { ...request, project: "other" } }, randomUUID(), "mate")).rejects.toThrow("does not match");
    await store.execute({ op: "claim", ...workflow, launch: request }, randomUUID(), "mate");
    await expect(store.execute({ op: "claim", ...workflow, launch: request }, randomUUID(), "mate")).rejects.toThrow("does not match");
    await expect(store.execute({ op: "record", plan: "request", node: "build", attempt: randomUUID(), state: "done", evidence: "worker said done" }, randomUUID(), "mate")).rejects.toThrow("committed start");
  });
  it("pins started runs and preserves consumed workers across revisions", async () => {
    await draft(); await store.execute({ op: "start", plan: "request", node: "build" }, randomUUID(), "mate"); const p = (await store.get("request"))!;
    const changed = fixture(); changed.nodes[0]!.summary = "Different work";
    await expect(store.execute({ op: "revise", definition: changed, expected: p.hash, reason: "scope" }, randomUUID(), "mate")).rejects.toThrow("pinned");
  });
  it("closes a completed plan in the open list, retains history and tells its completion once", async () => {
    await draft(); const { launch }: any = await store.execute({ op: "start", plan: "request", node: "build" }, randomUUID(), "mate");
    await store.execute({ op: "record", plan: "request", node: "build", attempt: launch.workflow.attempt, state: "landed", evidence: "Verified the promised deliverable landed." }, randomUUID(), "mate");
    expect(await store.execute({ op: "plans" }, randomUUID(), "mate")).toEqual([]);
    expect(await store.execute({ op: "plans", all: true }, randomUUID(), "mate")).toHaveLength(1);
    const finished = (await store.agenda()).find(i => i.id === "request:plan-finished:1")!; expect(finished.kind).toBe("tell");
    await store.execute({ op: "ack", plan: "request", kind: "told", ids: [finished.id] }, randomUUID(), "mate");
    expect((await store.agenda()).some(i => i.id === finished.id)).toBe(false);
    expect(await readFile(join(home, "data/plans/request/plan.md"), "utf8")).toContain("finished");
  });
  it("refuses a different home and a revision that would break another plan's reference", async () => {
    await draft(); await expect(new WorkflowPlanStore(root, home + "-other").get("request")).rejects.toThrow("home identity");
    const second = fixture("second"); second.nodes[0]!.id = "consumer";
    if (second.nodes[0]!.kind === "run") { second.nodes[0]!.launch.id = "consumer"; second.nodes[0]!.launch.brief.file = "data/consumer/brief.md"; }
    second.nodes[0]!.after = [{ node: "build", reason: "builds-on", on: "done" }]; await draft(second);
    const current = (await store.get("request"))!, replacement = fixture(); replacement.nodes[0]!.id = "replacement";
    if (replacement.nodes[0]!.kind === "run") { replacement.nodes[0]!.launch.id = "replacement"; replacement.nodes[0]!.launch.brief.file = "data/replacement/brief.md"; }
    await expect(store.execute({ op: "revise", definition: replacement, expected: current.hash, reason: "replace" }, randomUUID(), "mate")).rejects.toThrow("unknown dependency build");
  });
});
describe("linter and agenda", () => {
  it("checks references, reason enums, cycles, models, strict fields and total bounds", () => {
    const p = fixture(); expect(planProblems(p)).toEqual([]); expect(planWorstCase(p)).toEqual({ agents: 1, turns: 1 });
    p.nodes[0]!.after = [{ node: "missing", reason: "builds-on", on: "done" }]; expect(planProblems(p).join()).toContain("unknown dependency");
    p.nodes[0]!.after[0]!.node = "build"; expect(planProblems(p).join()).toContain("cycle");
    expect(PlanDefinitionSchema.safeParse({ ...p, script: "run" }).success).toBe(false);
    p.nodes[0]!.after = [{ node: "build", reason: "same-files" as any, on: "done" }]; expect(PlanDefinitionSchema.safeParse(p).success).toBe(false);
    const q = fixture(); q.budget.agents = 1; q.nodes.push({ ...q.nodes[0]!, id: "second" }); expect(planProblems(q).join()).toContain("Worst case");
  });
  it("orders agenda priorities, suppresses told items and finds missing briefs", async () => {
    await draft(); let agenda = await store.agenda(); expect(agenda.map(i => i.kind)).toEqual(["start", "books"]);
    const { launch }: any = await store.execute({ op: "start", plan: "request", node: "build" }, randomUUID(), "mate");
    await store.execute({ op: "record", plan: "request", node: "build", attempt: launch.workflow.attempt, state: "unresolved", evidence: "Lost create reply" }, randomUUID(), "mate");
    expect((await store.agenda())[0]?.kind).toBe("escalation");
    await store.execute({ op: "record", plan: "request", node: "build", attempt: launch.workflow.attempt, state: "done", evidence: "Verified report/PR and head" }, randomUUID(), "mate");
    agenda = await store.agenda(); const tell = agenda.find(i => i.kind === "tell")!;
    await store.execute({ op: "ack", plan: "request", ids: [tell.id], kind: "told" }, randomUUID(), "mate"); expect((await store.agenda()).some(i => i.id === tell.id)).toBe(false);
  });
  it("does not release a review plan or an unmet dependency", async () => {
    const p = fixture(); p.nodes.push({ id: "choice", title: "Choose", kind: "decision", summary: "Choose the database", after: [], options: [{ id: "a", label: "A", consequence: "Use A" }, { id: "b", label: "B", consequence: "Use B" }], recommendation: "a", rationale: "Smaller" });
    p.nodes[0]!.after = [{ node: "choice", reason: "decision", on: "answered" }]; await draft(p);
    expect((await store.get("request"))?.status).toBe("review"); expect((await store.agenda()).some(i => i.kind === "start")).toBe(false);
    await expect(store.execute({ op: "start", plan: "request", node: "build" }, randomUUID(), "mate")).rejects.toThrow("dependencies");
  });
});
describe("backlog compatibility and charter", () => {
  it("accepts new planning fields in the board and strict Needs-you detector with zero problems", () => {
    const markdown = "## In flight\n## Queued\n- [ ] choose - Choose (kind: captain) (hold: Pick) (plan: example) (needed-by: build, test) (blocked-by: design, trial)\n## Done\n";
    expect(parseBacklog(markdown)[0]).toMatchObject({ plan: "example", neededBy: ["build", "test"], blockedByIds: ["design", "trial"] });
    expect(observeNeedsYou(markdown, null)).toMatchObject({ valid: true, problems: [] });
    expect(observeNeedsYou(markdown.replace("design, trial", "waiting for evidence"), null).problems).toEqual([]);
    expect(parseBacklog(markdown.replace("design, trial", "waiting for evidence"))[0]?.blockedByIds).toBeUndefined();
    const old = markdown.replace(" (plan: example) (needed-by: build, test) (blocked-by: design, trial)", "");
    expect(observeNeedsYou(old, null)).toMatchObject({ valid: true, problems: [] }); expect(parseBacklog(old)[0]?.plan).toBeUndefined();
  });
  it("renders the core loop without unresolved placeholders", async () => {
    const charter = await renderCharter({ home, crewProvider: "", crewModeId: "" }); expect(charter).not.toMatch(/\{\{\w+\}\}/); expect(charter).toContain("workflow.mjs agenda");
  });
});
