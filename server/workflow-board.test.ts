import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { workflowFixture } from "../test/workflow-fixture";
import { type PlanCaptainCommand } from "../shared/workflow-plans";
import { workflowStore, queuePlanNotes } from "./workflow-service";
import { planSubjectHash, WorkflowPlanStore } from "./workflow-plans";
import { workflowSnapshot, withWorkflowCards, withWorkflowNeeds, workflowBearings } from "./workflow-board";
import { updateFirstmateConfig, readFirstmateConfig } from "./config";
import { commandMessage } from "./mate";
import { readBearingsMessage } from "../shared/bearings";
import { planGroups } from "../shared/workflow-plan-summary";

let home: string;
const daemonRoot = process.env.PASEO_HOME!;
beforeEach(async () => {
  // Each test has its own daemon data as well as its own configured home.
  process.env.PASEO_HOME = join(daemonRoot, randomUUID()); home = join(process.env.PASEO_HOME!, "home");
  for (const id of ["trial", "build"]) { await mkdir(join(home, `data/${id}`), { recursive: true }); await writeFile(join(home, `data/${id}/brief.md`), `Instructions for ${id}.`); }
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  await updateFirstmateConfig({ home }); await updateFirstmateConfig({ mateAgentId: "mate" });
  await workflowStore(home).execute({ op: "draft", definition: workflowFixture() }, randomUUID(), "mate");
});
async function command(action: PlanCaptainCommand["action"], extra: Partial<PlanCaptainCommand> = {}): Promise<PlanCaptainCommand> {
  const p = (await workflowStore(home).get("scheduler"))!;
  return { op: "captain", plan: "scheduler", revision: p.revision, subjectHash: planSubjectHash(p), action, text: "", ...extra };
}
const act = async (c: PlanCaptainCommand, id = randomUUID()) => workflowStore(home).execute(c, id, "board:captain");
it("shows a plan read failure in Bearings with one unavailable prefix", async () => {
  const read = vi.spyOn(WorkflowPlanStore.prototype, "read").mockRejectedValueOnce(new Error("Ledger offline"));
  try {
    const text = await workflowBearings(home);
    expect(text).toBe("Open plans\n- Plans unavailable: Error: Ledger offline");
  } finally { read.mockRestore(); }
});
it("sends a compact owned Bearings envelope and moves six explicitly closed trials into history", async () => {
  const template = workflowFixture().nodes[2]!; if (template.kind !== "run") throw new Error("fixture");
  for (let i = 0; i < 6; i++) {
    const id = `evidence-trial-${i}`; await mkdir(join(home, `data/${id}`)); await writeFile(join(home, `data/${id}/brief.md`), "Run an experiment and retain its report.");
    const started: any = await workflowStore(home).execute({ op: "implicit", launch: { ...template.launch, id, title: `Evidence-only trial ${i}`, brief: { file: `data/${id}/brief.md` } } }, randomUUID(), "mate");
    await workflowStore(home).execute({ op: "record", plan: id, node: id, attempt: started.launch.workflow.attempt, state: "done", evidence: "Verified trial report" }, randomUUID(), "mate");
    const before = (await workflowStore(home).get(id))!;
    expect((await workflowStore(home).execute({ op: "plans" }, randomUUID(), "mate") as any[]).some(p => p.definition.id === id)).toBe(true);
    await workflowStore(home).execute({ op: "close", plan: id, node: id, attempt: started.launch.workflow.attempt, expected: before.hash, evidence: "Inspected experiment branch and report; there is no deliverable to land." }, randomUUID(), "mate");
  }
  const snapshot = await workflowSnapshot(home);
  expect(planGroups(snapshot.plans).finished).toHaveLength(6);
  expect(planGroups(snapshot.plans).open).toHaveLength(1);
  const message = await commandMessage("bearings", "");
  const folded = readBearingsMessage(message.text, message.messageId)!;
  expect(folded.visible).toBe("Bearings, please."); expect(folded.overview).toContain("Open plans");
  expect(folded.overview).not.toContain("evidence-trial-");
  expect(folded.overview.split("\n").filter(line => line.startsWith("- scheduler —"))).toHaveLength(1);
  expect(folded.overview).not.toContain("Independent astra review");
  expect((await withWorkflowCards([], home, snapshot)).some(c => c.taskId?.startsWith("evidence-trial-"))).toBe(false);
}, 20000);
it("applies D2, keeps Coming up outside the urgent count and exposes worker-less planned cards", async () => {
  const snapshot = await workflowSnapshot(home); expect(snapshot.now).toHaveLength(1); expect(snapshot.comingUp).toHaveLength(1);
  const base: any = { actionCount: 0, newCount: 0, requests: [], parked: [], freshness: { status: "fresh" } };
  expect(await withWorkflowNeeds(base, home)).toMatchObject({ actionCount: 1, comingUp: [{ node: "database" }] });
  const cards = await withWorkflowCards([], home); expect(cards).toHaveLength(2); expect(cards.every(c => c.agent === null && c.remote?.worker == null && c.column === "queued")).toBe(true);
  await act(await command("approve")); expect((await workflowStore(home).agenda()).some(i => i.kind === "start" && i.node === "trial")).toBe(true);
  expect((await workflowSnapshot(home)).now).toHaveLength(0);
});
it("binds answers to revision and subject, refuses a second device, and permits an early choice", async () => {
  const firstDevice = await command("answer", { node: "database", option: "sqlite" }), secondDevice = { ...firstDevice, option: "postgres" };
  await act(firstDevice); await expect(act(secondDevice)).rejects.toThrow("changed since you opened");
  expect((await workflowStore(home).get("scheduler"))?.nodes.database?.answer).toBe("sqlite");
  const current = await command("answer", { node: "database", option: "postgres" }); await expect(act(current)).rejects.toThrow("already answered");
  const snapshot = await workflowSnapshot(home); expect(snapshot.comingUp).toEqual([]); expect(snapshot.now).toHaveLength(1); // Plan approval is separate.
});
it("replays one action once, records requested changes in agenda order and queues a durable note once", async () => {
  const c = await command("changes", { text: "Keep the trial read-only." }), id = randomUUID(); await act(c, id); await act(c, id);
  await queuePlanNotes(home); await queuePlanNotes(home);
  expect((await readFirstmateConfig()).mateNotes).toHaveLength(1);
  expect((await readFirstmateConfig()).mateNotes[0]?.text).toContain("Keep the trial read-only.");
  const agenda = await workflowStore(home).agenda(); expect(agenda[0]?.kind).toBe("captain"); expect(agenda[1]?.kind).toBe("replan");
  expect((await workflowStore(home).get("scheduler"))?.status).toBe("held");
});
it.each(["active", "held"] as const)("rejects new review actions on a fresh %s plan without changing its ledger", async status => {
  await act(await command(status === "active" ? "approve" : "hold"));
  const store = workflowStore(home), before = (await store.get("scheduler"))!;
  const files = await readdir(join(store.root, "scheduler"));
  for (const action of ["approve", "edit", "changes"] as const) {
    const attempted = await command(action, { text: "Change the scope.", ...(action === "edit" ? { edits: [{ kind: "posture", posture: "sail" }] } : {}) });
    await expect(act(attempted)).rejects.toThrow("not awaiting review");
    expect(await store.get("scheduler")).toEqual(before);
    expect(await readdir(join(store.root, "scheduler"))).toEqual(files);
  }
});
it("replays an accepted approval after the plan becomes active without recording it twice", async () => {
  const accepted = await command("approve"), id = randomUUID();
  await act(accepted, id);
  const before = (await workflowStore(home).get("scheduler"))!;
  expect(before.status).toBe("active");
  await act(accepted, id);
  expect(await workflowStore(home).get("scheduler")).toEqual(before);
  expect(before.captainEvents?.filter(e => e.id === id)).toHaveLength(1);
});
it("applies edits atomically, pins in-flight runs and holds a removed prerequisite's dependents", async () => {
  const before = (await workflowStore(home).get("scheduler"))!;
  await expect(act(await command("edit", { edits: [{ kind: "dependencies", node: "trial", after: [{ node: "build", reason: "builds-on", on: "done" }] }] }))).rejects.toThrow("cycle");
  expect((await workflowStore(home).get("scheduler"))?.hash).toBe(before.hash);
  await act(await command("edit", { edits: [{ kind: "remove", node: "trial" }] }));
  const p = (await workflowStore(home).get("scheduler"))!; expect(p.revision).toBe(2); expect(p.nodes.database?.held).toBe(true);
  expect((await workflowStore(home).agenda()).some(i => i.kind === "start")).toBe(false);
  expect((await workflowSnapshot(home)).now.some(n => n.node === "database")).toBe(true);
});
it("holds new starts, refuses to decline started work, and builds read-only Bearings from plans", async () => {
  await act(await command("approve")); await workflowStore(home).execute({ op: "start", plan: "scheduler", node: "trial" }, randomUUID(), "mate");
  await expect(act(await command("decline"))).rejects.toThrow("started plan");
  const current = (await workflowStore(home).get("scheduler"))!;
  await workflowStore(home).execute({ op: "revise", definition: current.definition, expected: current.hash, reason: "Review the remaining work." }, randomUUID(), "mate");
  await expect(act(await command("edit", { edits: [{ kind: "model", node: "trial", agent: { provider: "claude/opus", modeId: "plan" } }] }))).rejects.toThrow("unstarted");
  await act(await command("hold")); const before = await readdir(join(workflowStore(home).root, "scheduler"));
  const bearings = await workflowBearings(home); expect(bearings).toContain("running: Database trial (starting)"); expect(bearings).toContain("Coming up");
  expect(await readdir(join(workflowStore(home).root, "scheduler"))).toEqual(before);
  expect(await readFile(join(home, "data/plans/scheduler/plan.md"), "utf8")).toContain("held");
});
it("retains an old answer when changed assumptions route unstarted work through a replacement decision", async () => {
  await act(await command("answer", { node: "database", option: "sqlite" }));
  const p = (await workflowStore(home).get("scheduler"))!, revised = structuredClone(p.definition);
  const original = revised.nodes.find(n => n.id === "database")!;
  revised.nodes.push({ ...original, id: "database-revised", title: "Choose with new evidence" });
  revised.nodes.find(n => n.id === "build")!.after = [{ node: "database-revised", reason: "decision", on: "answered" }];
  await workflowStore(home).execute({ op: "revise", definition: revised, expected: p.hash, reason: "New storage evidence invalidates the earlier assumption." }, randomUUID(), "mate");
  expect((await workflowStore(home).get("scheduler"))?.nodes.database?.answer).toBe("sqlite");
  expect((await workflowStore(home).agenda()).some(i => i.kind === "start" && i.node === "build")).toBe(false);
});
it("keeps a decline on the agenda, removes pending projections and leaves backlog cleanup to the mate", async () => {
  const cards = await withWorkflowCards([], home);
  const backlog = "## In flight\n## Queued\n- [ ] trial - Database trial (project: scheduler) (plan: scheduler)\n- [ ] build - Build the scheduler (project: scheduler) (plan: scheduler)\n## Done\n";
  await writeFile(join(home, "data/backlog.md"), backlog);
  await act(await command("decline"));
  const agenda = await workflowStore(home).agenda();
  expect(agenda[0]?.kind).toBe("captain"); expect(agenda.filter(i => i.kind === "books" && i.section === "remove")).toHaveLength(2);
  expect(await withWorkflowCards(cards, home)).toEqual([]); expect((await workflowSnapshot(home)).now).toEqual([]);
  expect(await readFile(join(home, "data/backlog.md"), "utf8")).toBe(backlog);
});
