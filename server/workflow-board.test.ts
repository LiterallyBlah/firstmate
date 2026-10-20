import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { workflowFixture } from "../test/workflow-fixture";
import { type PlanCaptainCommand } from "../shared/workflow-plans";
import { workflowStore, queuePlanNotes } from "./workflow-service";
import { planSubjectHash } from "./workflow-plans";
import { workflowSnapshot, withWorkflowCards, withWorkflowNeeds, workflowBearings } from "./workflow-board";
import { updateFirstmateConfig, readFirstmateConfig } from "./config";
import { pluginDir } from "./data-dir";

let home: string;
beforeEach(async () => {
  // Each test has its own daemon data as well as its own configured home.
  process.env.PASEO_HOME = join(process.env.PASEO_HOME!, randomUUID()); home = join(process.env.PASEO_HOME!, "home");
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
  await act(firstDevice); await expect(act(secondDevice)).rejects.toThrow("another device");
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
  await expect(act(await command("edit", { edits: [{ kind: "model", node: "trial", agent: { provider: "claude/opus", modeId: "plan" } }] }))).rejects.toThrow("unstarted");
  await act(await command("hold")); const before = await readdir(join(pluginDir(), "workflow-plans/scheduler"));
  const bearings = await workflowBearings(home); expect(bearings).toContain("Underway\n- Scheduler · Database trial: starting"); expect(bearings).toContain("Coming up");
  expect(await readdir(join(pluginDir(), "workflow-plans/scheduler"))).toEqual(before);
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
  const backlog = "## In flight\n## Queued\n- [ ] trial - Database trial (plan: scheduler)\n- [ ] build - Build the scheduler (plan: scheduler)\n## Done\n";
  await writeFile(join(home, "data/backlog.md"), backlog);
  await act(await command("decline"));
  const agenda = await workflowStore(home).agenda();
  expect(agenda[0]?.kind).toBe("captain"); expect(agenda.filter(i => i.kind === "books" && i.section === "remove")).toHaveLength(2);
  expect(await withWorkflowCards(cards, home)).toEqual([]); expect((await workflowSnapshot(home)).now).toEqual([]);
  expect(await readFile(join(home, "data/backlog.md"), "utf8")).toBe(backlog);
});
