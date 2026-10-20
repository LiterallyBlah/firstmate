import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { workflowFixture } from "../test/workflow-fixture";
import { PlanDefinitionSchema } from "../shared/workflow-plans";
import { WorkflowSnapshotSchema } from "../shared/workflow-rpc";
import { FirstmateConfigSchema, FleetSchema } from "../shared/fleet";
import { workflowOwnsCard } from "../shared/workflow-identity";
import { workflowStore } from "./workflow-service";
import { dependenciesMet, planBacklogLine, planSubjectHash, replayWorkflowEvent } from "./workflow-plans";
import { workflowSnapshot, withWorkflowNeeds, withWorkflowCards, withWorkflowFleet, workflowBearings } from "./workflow-board";
import { NeedsYouService } from "./needs-you-service";
import { registerNeedsYouRpc } from "./needs-you-rpc";
import { loadFleet, ReportCache } from "./fleet";
import { updateFirstmateConfig } from "./config";
import { resolvePlanPosture } from "./workflow-posture";

let home: string;
const execute = (command: any, by = "mate") => workflowStore(home).execute(command, randomUUID(), by) as Promise<any>;
const act = async (action: string, extra = {}, by = "board:captain") => {
  const p = (await workflowStore(home).get("scheduler"))!;
  return execute({ op: "captain", plan: "scheduler", revision: p.revision, subjectHash: planSubjectHash(p), action, text: "Captain's words", ...extra }, by);
};
beforeEach(async () => {
  home = join(process.env.PASEO_HOME!, randomUUID());
  for (const id of ["trial", "build", "broken-task"]) { await mkdir(join(home, `data/${id}`), { recursive: true }); await writeFile(join(home, `data/${id}/brief.md`), "# Status line\ndone: verified result"); }
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n- [ ] legacy - Legacy decision (kind: captain) (hold: Decide?)\n## Done\n");
  await updateFirstmateConfig({ mateAgentId: "" }); await updateFirstmateConfig({ home }); await updateFirstmateConfig({ mateAgentId: "mate" });
  await execute({ op: "draft", definition: workflowFixture() });
});
it.each(["malformed JSON", "missing interior", "unknown log file", "stray root file"])("keeps fleet, public Needs-you reads/mutations and Bearings usable with %s", async kind => {
  const d = workflowFixture(); d.id = "broken"; d.nodes = [d.nodes[0]!]; d.nodes[0]!.id = "broken-task";
  if (d.nodes[0]!.kind === "run") { d.nodes[0]!.launch.id = "broken-task"; d.nodes[0]!.launch.brief.file = "data/broken-task/brief.md"; }
  await execute({ op: "draft", definition: d }); const root = workflowStore(home).root;
  if (kind === "malformed JSON") await writeFile(join(root, "broken/00000000.json"), "{");
  if (kind === "missing interior") { await execute({ op: "start", plan: "broken", node: "broken-task" }); await rm(join(root, "broken/00000000.json")); }
  if (kind === "unknown log file") await writeFile(join(root, "broken/desktop.ini"), "stray");
  if (kind === "stray root file") await writeFile(join(root, "desktop.ini"), "stray");
  const problemCount = kind === "stray root file" ? 0 : 1;
  const workflow = WorkflowSnapshotSchema.parse(await workflowSnapshot(home));
  expect(workflow.problems).toHaveLength(problemCount);
  if (!problemCount) expect(workflow.warnings?.join()).toContain("Ignored non-plan entry");
  let clock = 1000;
  const service = new NeedsYouService({ root: join(home, "decisions"), home: async () => home, catalog: async () => null, enabled: () => true, now: () => clock });
  await service.read(); clock += 2000; await service.read();
  const handlers = new Map<string, any>();
  registerNeedsYouRpc({ handle: (rpc: any, handle: any) => handlers.set(rpc.name, { ...rpc, handle }) } as any, service, snapshot => withWorkflowNeeds(snapshot, home));
  const call = async (name: string, input = {}) => { const h = handlers.get(`firstmate.needs-you.${name}`); return h.output.parse(await h.handle(h.input.parse(input))); };
  const read = await call("read"); expect(read.actionCount).toBe(2); expect(read.planProblems).toHaveLength(problemCount);
  const legacy = read.requests.find((r: any) => r.source.taskId === "legacy");
  const seen = await call("seen", { homeId: read.homeId, id: legacy.id, revision: legacy.revision });
  expect(seen.requests.find((r: any) => r.id === legacy.id).state).toBe("seen"); expect(seen.planProblems).toHaveLength(problemCount);
  const paseo: any = { agents: { list: async () => ({ entries: [], hasMore: false }) }, config: { get: async () => ({ mcp: { injectIntoAgents: true } }) } };
  const fleet = FleetSchema.parse(await withWorkflowFleet(await loadFleet(paseo, FirstmateConfigSchema.parse({ home }), new ReportCache(), async () => [], async () => null, service)));
  expect(fleet.cards.some(c => c.taskId === "legacy")).toBe(true); expect(fleet.needsYou?.actionCount).toBe(2); expect(fleet.warnings.join()).toContain("Workflow:");
  expect(await workflowBearings(home)).toContain(problemCount ? "Plans unavailable" : "Ignored non-plan entry");
  await service.stop();
});
it("refuses a captain host edit into a quarantined task scope without holding another host", async () => {
  const d = workflowFixture(); d.id = "broken"; d.nodes = [d.nodes[0]!]; d.nodes[0]!.id = "broken-task";
  if (d.nodes[0]!.kind !== "run") throw new Error("fixture");
  d.nodes[0]!.launch.id = "broken-task"; d.nodes[0]!.launch.brief.file = "data/broken-task/brief.md";
  await execute({ op: "draft", definition: d }); await writeFile(join(workflowStore(home).root, "broken/00000000.json"), "{");
  d.id = "other-host"; d.nodes[0]!.launch.host = "remote";
  await execute({ op: "draft", definition: d }); const p = (await workflowStore(home).get("other-host"))!;
  await expect(execute({ op: "captain", plan: "other-host", revision: p.revision, subjectHash: planSubjectHash(p), action: "edit", text: "Move to local", edits: [{ kind: "host", node: "broken-task", host: "local" }] })).rejects.toThrow("ownership");
  expect((await workflowStore(home).get("other-host"))?.hash).toBe(p.hash);
  expect((await execute({ op: "start", plan: "other-host", node: "broken-task" })).launch.workflow.attempt).toBeTruthy();
});
it("counts a due cross-plan choice after its completed implicit prerequisite leaves presentation", async () => {
  // Use a separate home to reproduce an implicit trial followed by an explicit plan.
  home = join(home, "cross-plan");
  await mkdir(join(home, "data/trial"), { recursive: true });
  await writeFile(join(home, "data/trial/brief.md"), "# Status line\ndone: verified trial");
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  const d = workflowFixture(), trial = d.nodes.shift()!;
  if (trial.kind !== "run") throw new Error("fixture");
  const started = await execute({ op: "implicit", launch: trial.launch });
  await execute({ op: "record", plan: "trial", node: "trial", attempt: started.launch.workflow.attempt, state: "done", evidence: "Verified comparison report" });
  d.id = "followup"; d.request = { ...d.request, posture: "sail", quote: "Present the choice when the trial is done, then build" };
  d.nodes[0]!.id = "choose"; d.nodes[0]!.title = "Choose";
  d.nodes[1]!.after = [{ node: "choose", reason: "decision", on: "answered" }];
  await execute({ op: "draft", definition: d });
  expect(dependenciesMet(d.nodes[0]!, await workflowStore(home).list())).toBe(true);
  expect((await workflowStore(home).agenda()).some(i => i.text === "Decision due: Choose.")).toBe(true);

  const view = await workflowSnapshot(home);
  expect(view.plans.map(p => p.definition.id)).toEqual(["followup"]);
  expect(view.now).toMatchObject([{ plan: "followup", node: "choose", question: "Choose", waits: ["Database trial"] }]);
  expect(view.comingUp).toEqual([]);
  const base: any = { actionCount: 0, newCount: 0, requests: [], parked: [], freshness: { status: "fresh" } };
  const needs = await withWorkflowNeeds(base, home, view);
  expect(needs.actionCount).toBe(1); expect(needs.planNow?.map(n => n.node)).toEqual(["choose"]);
  expect((await workflowBearings(home)).split("Recently Landed")[0]).toContain("Choose");
});
it("never suppresses same-slug holds on another host/project or attaches their chips/cards", async () => {
  const p = (await workflowStore(home).get("scheduler"))!;
  await writeFile(join(home, "data/backlog.md"), `## In flight\n## Queued\n${planBacklogLine(p, p.definition.nodes.find(n => n.id === "database")!)}\n## Done\n`);
  const sources = [{ taskId: "database", hostId: "local", project: null }, { taskId: "database", hostId: "remote", project: null }, { taskId: "database", hostId: "local", project: "other" }];
  const base: any = { actionCount: 3, newCount: 3, requests: sources.map((source, i) => ({ id: String(i), source, state: "new" })), parked: sources, freshness: { status: "fresh" } };
  await act("approve"); const needs = await withWorkflowNeeds(base, home);
  expect(needs.requests.map(r => r.source)).toEqual(sources.slice(1)); expect(needs.actionCount).toBe(2); expect(needs.parked).toEqual(sources.slice(1));
  const owned = (await withWorkflowCards([], home)).find(c => c.taskId === "build")!;
  const otherProject = { ...owned, key: "other-project", project: "other", note: "Keep me", column: "blocked" as const };
  const remote = { ...owned, key: "remote", remote: { serverId: "remote", host: "Remote", online: true, worker: null, clockSkewSeconds: null }, note: "Keep remote", column: "blocked" as const };
  expect(workflowOwnsCard(p, owned)).toBe(true); expect(workflowOwnsCard(p, otherProject)).toBe(false); expect(workflowOwnsCard(p, remote)).toBe(false);
  const cards = await withWorkflowCards([otherProject, remote], home);
  expect(cards.find(c => c.key === "other-project")?.note).toBe("Keep me"); expect(cards.find(c => c.key === "remote")?.note).toBe("Keep remote");
});
it("removes only scoped removed-node cards and escalates unexpected workers", async () => {
  const cards = await withWorkflowCards([], home), p = (await workflowStore(home).get("scheduler"))!;
  await writeFile(join(home, "data/backlog.md"), `## In flight\n## Queued\n${p.definition.nodes.map(n => planBacklogLine(p, n)).join("\n")}\n## Done\n`);
  await act("edit", { edits: [{ kind: "remove", node: "trial" }] });
  expect((await withWorkflowCards(cards, home)).some(c => c.taskId === "trial")).toBe(false);
  expect((await workflowStore(home).agenda()).some(i => i.node === "trial" && i.section === "remove")).toBe(true);
  const trial = cards.find(c => c.taskId === "trial")!; trial.backlog = { ...trial.backlog!, agentId: "unexpected" };
  const retained = await withWorkflowCards([trial], home); expect(retained.find(c => c.taskId === "trial")?.note).toContain("inspect the worker");
});
it("distinguishes captain presses from mate-recorded chat approvals in history, plan.md and agenda", async () => {
  await act("approve", {}, "mate"); let p = (await workflowStore(home).get("scheduler"))!;
  expect(p.captainEvents?.at(-1)?.by).toBe("mate"); expect(await readFile(join(home, "data/plans/scheduler/plan.md"), "utf8")).toContain("Recorded by the first mate from chat");
  expect((await workflowStore(home).agenda()).some(i => i.text.includes("Recorded by the first mate from chat"))).toBe(true);
  await act("hold"); p = (await workflowStore(home).get("scheduler"))!;
  expect(p.captainEvents?.at(-1)?.by).toBe("board:captain"); expect(await readFile(join(home, "data/plans/scheduler/plan.md"), "utf8")).toContain("Captain pressed: hold");
  const stale = { op: "captain", plan: "scheduler", revision: p.revision, subjectHash: planSubjectHash(p), action: "approve", text: "Old press" };
  await act("hold"); await expect(execute(stale)).rejects.toThrow("changed since you opened"); expect((await workflowStore(home).get("scheduler"))?.status).toBe("held");
});
it("replays committed captain actions across derived-state additions while checking new presses", async () => {
  const before = (await workflowStore(home).get("scheduler"))!; await act("hold");
  const event = JSON.parse(await readFile(join(workflowStore(home).root, "scheduler/00000001.json"), "utf8"));
  Object.assign(before.nodes.trial!, { upgradeDefault: "new derived field" });
  expect(planSubjectHash(before)).not.toBe(event.command.subjectHash);
  expect(replayWorkflowEvent(before, event).status).toBe("held");
});
it("refuses dependency-free starts in held and declined plans", async () => {
  await act("hold"); await expect(execute({ op: "start", plan: "scheduler", node: "trial" })).rejects.toThrow("held");
  await act("decline"); await expect(execute({ op: "start", plan: "scheduler", node: "trial" })).rejects.toThrow("held");
});
it("resolves only fenced plan-posture with D2 fallback, explicit overrides and conservative invalid orders", async () => {
  const d = workflowFixture(), single = PlanDefinitionSchema.parse({ ...d, nodes: [d.nodes[0]] });
  expect(resolvePlanPosture(single, null).posture).toBe("sail"); expect(resolvePlanPosture(d, "plan-posture: sail").posture).toBe("review");
  for (const [value, expected] of [["review", "review"], ["sail", "sail"], ["default", "review"], ["typo", "review"]]) expect(resolvePlanPosture(d, `\`\`\`standing-orders\nplan-posture: ${value}\nmerge: anything\n\`\`\``).posture).toBe(expected);
  d.request.posture = "sail"; d.request.quote = "Just go"; expect(resolvePlanPosture(d, "```standing-orders\nplan-posture: review\n```").source).toBe("request");
  await writeFile(join(home, "data/captain.md"), "```standing-orders\nplan-posture: review\n```");
  const node = single.nodes[0]!; if (node.kind !== "run") throw new Error("fixture");
  const implicit = await execute({ op: "implicit", launch: { ...node.launch, id: "broken-task", brief: { file: "data/broken-task/brief.md" } } });
  expect(implicit.launch).toBeUndefined(); expect(implicit.plan.postureSource.source).toBe("standing-orders");
  expect((await workflowSnapshot(home)).now.some(n => n.plan === "broken-task")).toBe(true);
  await expect(execute({ op: "start", plan: "broken-task", node: "broken-task" })).rejects.toThrow("held");
});
it("bounds Bearings and the agenda after many completed plans, retaining verifiable history", async () => {
  const template = workflowFixture().nodes[0]!; if (template.kind !== "run") throw new Error("fixture");
  for (let i = 0; i < 30; i++) {
    const id = `finished-${i}`; await mkdir(join(home, `data/${id}`)); await writeFile(join(home, `data/${id}/brief.md`), "Verified report");
    const launch = { ...template.launch, id, brief: { file: `data/${id}/brief.md` } };
    if (i < 12) await execute({ op: "draft", definition: PlanDefinitionSchema.parse({ format: "firstmate.plan/1", id, title: id, request: { text: id, at: "2026-10-20T12:00:00Z" }, budget: { agents: 1, turns: 1 }, nodes: [{ ...template, id, launch }] }) });
    const started = await execute(i < 12 ? { op: "start", plan: id, node: id } : { op: "implicit", launch });
    await execute({ op: "record", plan: id, node: id, attempt: started.launch.workflow.attempt, state: "done", evidence: "Verified report" });
  }
  const snapshot = await workflowSnapshot(home); expect(snapshot.plans).toHaveLength(13); // Twelve explicit histories and the open scheduler.
  const bearings = await workflowBearings(home); expect(bearings.split("\n").filter(l => l.startsWith("- finished-"))).toHaveLength(10);
  expect(await workflowBearings(home, Date.now() + 8 * 86400000)).not.toContain("- finished-");
  expect((await workflowStore(home).agenda()).filter(i => i.plan.startsWith("finished-")).every(i => i.kind === "tell")).toBe(true);
  expect(await withWorkflowCards([], home)).toHaveLength(2);
  expect(await workflowStore(home).list()).toHaveLength(31);
}, 30000);
