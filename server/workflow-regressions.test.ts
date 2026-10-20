import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { PlanDefinitionSchema, PlanLaunchSchema, type PlanDefinition } from "../shared/workflow-plans";
import { backlogSection, dependenciesMet, planBacklogLine, WorkflowPlanStore } from "./workflow-plans";
import { authorizeWorkflowActor, processWorkflowRequests, workflowStore } from "./workflow-service";
import { observeNeedsYou } from "./needs-you-detect";
import { parseBacklog } from "./backlog";

let home: string, root: string, store: WorkflowPlanStore;
const run = (id = "build") => ({ id, title: id, summary: "Do the work", kind: "run", workflow: "task@1", after: [],
  launch: { id, title: id, agentTitle: "Fix (web)", project: "project", host: "local", baseBranch: "main", kind: "ship", mode: "reviewed-PR +yolo", brief: { file: `data/${id}/brief.md` }, agent: { provider: "codex/model", modeId: "full-access" }, backlog: { existing: "none" } } });
const definition = (id = "request", nodes = [run()]): PlanDefinition => PlanDefinitionSchema.parse({ format: "firstmate.plan/1", id, title: id, request: { text: "Build it", at: "2026-10-20T12:00:00Z" }, budget: { agents: 10, turns: 10 }, nodes });
const execute = (command: any) => store.execute(command, randomUUID(), "mate") as Promise<any>;
beforeEach(async () => {
  home = join(process.env.PASEO_HOME!, randomUUID()); root = join(home, "ledger"); store = new WorkflowPlanStore(root, home);
  for (const id of ["build", "next"]) { await mkdir(join(home, `data/${id}`), { recursive: true }); await writeFile(join(home, `data/${id}/brief.md`), "# Status line\nDo the work\ndone: result"); }
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
});
it("keeps legacy prose blockers, including a parked captain hold, and recognizes only ID lists", () => {
  const text = "## In flight\n## Queued\n- [ ] choice - Pick (kind: captain) (hold: Choose) (blocked-by: waiting for evidence) (since 2026-10-20)\n## Done\n";
  expect(observeNeedsYou(text, null)).toMatchObject({ valid: true, problems: [], sources: [{ disposition: "parked", blockedBy: "waiting for evidence" }] });
  expect(parseBacklog(text)[0]?.blockedByIds).toBeUndefined();
  expect(parseBacklog(text.replace("waiting for evidence", "trial, design"))[0]?.blockedByIds).toEqual(["trial", "design"]);
});
it("accepts the launch helper's opaque modes, parenthesized agent title and 10,000-character notes", async () => {
  for (const mode of ["reviewed-PR +yolo", "local-only +yolo", "captain's custom delivery", "direct-PR", "reviewed-PR", "local-only"]) {
    const launch = PlanLaunchSchema.parse({ ...run().launch, mode, backlog: { existing: "none", note: "n".repeat(10000) }, dependency: { satisfiedBy: "d".repeat(10000) }, captainAuthority: { hold: "h".repeat(10000), authority: "a".repeat(10000) } });
    expect(launch.agentTitle).toBe("Fix (web)"); expect(launch.mode).toBe(mode);
  }
});
it("refuses a dependency-free start before approval, and requires fresh approval above 1.5 times worst case", async () => {
  const d = definition("request", [run(), run("next")]);
  await execute({ op: "draft", definition: d });
  await expect(execute({ op: "start", plan: "request", node: "build" })).rejects.toThrow("held");
  let p = (await store.get("request"))!;
  await execute({ op: "approve", plan: "request", expected: p.hash, quote: "Go ahead" });
  p = (await store.get("request"))!;
  const changed = structuredClone(d); changed.nodes.push(PlanDefinitionSchema.parse({ ...d, nodes: [run("third")] }).nodes[0]!);
  changed.request.posture = "sail"; changed.request.quote = "Go";
  await execute({ op: "revise", definition: changed, expected: p.hash, reason: "Exactly 1.5 times" });
  expect((await store.get("request"))?.status).toBe("active");
  p = (await store.get("request"))!; changed.nodes.push(PlanDefinitionSchema.parse({ ...d, nodes: [run("fourth")] }).nodes[0]!);
  await execute({ op: "revise", definition: changed, expected: p.hash, reason: "Above 1.5 times" });
  expect((await store.get("request"))?.status).toBe("review");
  await expect(execute({ op: "start", plan: "request", node: "build" })).rejects.toThrow("held");
});
it("commits satisfied dependency evidence in the exact claimed launch", async () => {
  const d = definition("request", [run(), run("next")]); d.request = { ...d.request, posture: "sail", quote: "Go" };
  d.nodes[1]!.after = [{ node: "build", on: "done", reason: "builds-on" }];
  await execute({ op: "draft", definition: d }); const first = await execute({ op: "start", plan: "request", node: "build" });
  await execute({ op: "record", plan: "request", node: "build", attempt: first.launch.workflow.attempt, state: "done", evidence: "PR ready, not merged" });
  const second = await execute({ op: "start", plan: "request", node: "next" });
  expect(second.launch.dependency.satisfiedBy).toContain("build: done");
  const { workflow, ...launch } = second.launch; await execute({ op: "claim", ...workflow, launch });
});
it("keeps unlanded ship completion in flight and preserves the existing captain hold and PR", async () => {
  await execute({ op: "draft", definition: definition() }); const started = await execute({ op: "start", plan: "request", node: "build" });
  await execute({ op: "record", plan: "request", node: "build", attempt: started.launch.workflow.attempt, state: "done", evidence: "PR ready, not merged; head abc" });
  const p = (await store.get("request"))!, node = p.definition.nodes[0]!;
  expect(backlogSection(node, p.nodes.build!.state)).toBe("in-flight");
  const current = parseBacklog("## In flight\n- [ ] build - build (project: project) (plan: request) (hold: Merge this PR?) https://github.com/example/project/pull/1")[0]!;
  expect(planBacklogLine(p, node, current)).toContain("(hold: Merge this PR?)");
  expect(planBacklogLine(p, node, current)).toContain(current.url);
  await writeFile(join(home, "data/backlog.md"), `## In flight\n${planBacklogLine(p, node, current)}\n## Queued\n## Done\n`);
  expect((await store.agenda()).filter(i => i.kind === "books")).toEqual([]);
  const landed = await execute({ op: "record", plan: "request", node: "build", attempt: started.launch.workflow.attempt, state: "landed", evidence: "Confirmed merge at approved head" });
  expect(landed.backlog[0].line).toContain("(hold: Merge this PR?)"); expect(landed.backlog[0].line).toContain(current.url);
  await expect(execute({ op: "record", plan: "request", node: "build", attempt: started.launch.workflow.attempt, state: "running", agentId: "replacement", workspaceId: "space", evidence: "Blind reset" })).rejects.toThrow("immutable");
});
it("invalidates evidence append-only and stops every dependent, including held dependencies", async () => {
  const d = definition("request", [run(), run("next")]); d.request = { ...d.request, posture: "sail", quote: "Go" }; d.nodes[1]!.after = [{ node: "build", on: "done", reason: "needs-evidence" }];
  await execute({ op: "draft", definition: d }); const started = await execute({ op: "start", plan: "request", node: "build" });
  await execute({ op: "record", plan: "request", node: "build", attempt: started.launch.workflow.attempt, state: "done", evidence: "Original report" });
  const prior = await readFile(join(root, "request/00000002.json"), "utf8");
  const p = (await store.get("request"))!; p.nodes.build!.held = "Assumption changed"; expect(dependenciesMet(d.nodes[1]!, [p])).toBe(false);
  await execute({ op: "invalidate", plan: "request", node: "build", attempt: started.launch.workflow.attempt, evidence: "Contradictory new evidence" });
  expect(await readFile(join(root, "request/00000002.json"), "utf8")).toBe(prior);
  await expect(execute({ op: "start", plan: "request", node: "next" })).rejects.toThrow("dependencies");
  expect((await store.agenda())[0]?.kind).toBe("escalation");
  const invalidated = (await store.get("request"))!;
  await execute({ op: "validate", plan: "request", node: "build", attempt: started.launch.workflow.attempt, expected: invalidated.hash, evidence: "Rechecked report against the changed design" });
  expect(dependenciesMet(d.nodes[1]!, [(await store.get("request"))!])).toBe(true);
});
it("replays frozen committed bytes before applying schema defaults", async () => {
  const bytes = await readFile(`test/fixtures/workflow-log/${process.platform === "win32" ? "windows" : "linux"}.json`, "utf8"), raw = JSON.parse(bytes);
  await mkdir(join(root, "frozen"), { recursive: true }); await mkdir(join(root, ".tips/frozen"), { recursive: true });
  await writeFile(join(root, "frozen/00000000.json"), bytes); await writeFile(join(root, ".tips/frozen/00000000.json"), JSON.stringify({ sequence: 0, hash: raw.hash }));
  const frozen = await new WorkflowPlanStore(root, raw.home).get("frozen");
  expect(frozen?.definition.implicit).toBe(false); expect(frozen?.definition.nodes[0]?.after).toEqual([]); expect(frozen?.hash).toBe(raw.hash);
  expect(await readFile(join(root, "frozen/00000000.json"), "utf8")).toBe(bytes);
});
it("recovers a lost implicit reply without a new attempt and releases only an uncreated start", async () => {
  const launch = PlanLaunchSchema.parse(run().launch), first = await execute({ op: "implicit", launch });
  const again = await execute({ op: "implicit", launch }); expect(again.launch.workflow).toEqual(first.launch.workflow);
  await execute({ op: "release", plan: "build", node: "build", attempt: first.launch.workflow.attempt, evidence: "Inspected; no launch record and no create performed" });
  const resumed = await execute({ op: "start", plan: "build", node: "build" }); expect(resumed.launch.workflow.attempt).toBe(first.launch.workflow.attempt);
  await mkdir(join(home, "data/build/launches")); await writeFile(join(home, "data/build/launches/1.json"), JSON.stringify({ state: "issued", workflow: resumed.launch.workflow }));
  await expect(execute({ op: "release", plan: "build", node: "build", attempt: resumed.launch.workflow.attempt, evidence: "No" })).rejects.toThrow("Launch record exists");
});
it("returns the committed intent even if its readable projection fails after publication", async () => {
  const launch = PlanLaunchSchema.parse(run().launch), render = vi.spyOn(store, "render").mockRejectedValueOnce(new Error("projection unavailable"));
  const first = await execute({ op: "implicit", launch }); expect(first.projectionProblem).toContain("Plan committed"); expect(first.launch.workflow.attempt).toBeTruthy();
  const again = await execute({ op: "implicit", launch }); expect(again.launch.workflow).toEqual(first.launch.workflow); expect(again.plan.sequence).toBe(0);
  render.mockRestore();
});
it("preserves task/workspace identity, old attempts and cumulative budget on manual replacement and promotion", async () => {
  const d = definition(); const node = d.nodes[0]!; if (node.kind === "run") { node.workflow = "scout@1"; node.launch.kind = "scout"; }
  await execute({ op: "draft", definition: d }); const first = await execute({ op: "start", plan: "request", node: "build" });
  await execute({ op: "record", plan: "request", node: "build", attempt: first.launch.workflow.attempt, state: "running", agentId: "worker", workspaceId: "space", evidence: "Inspected" });
  await execute({ op: "record", plan: "request", node: "build", attempt: first.launch.workflow.attempt, state: "done", evidence: "Verified report" });
  let p = (await store.get("request"))!;
  await execute({ op: "replace", plan: "request", node: "build", attempt: first.launch.workflow.attempt, expected: p.hash, kind: "promote", evidence: "Captain approved fix; inspected original worker and preserved workspace", budget: { agents: 2, turns: 2 } });
  p = (await store.get("request"))!; expect(p.status).toBe("review"); expect(p.nodes.build!.priorAttempts?.[0]?.agentId).toBe("worker");
  await execute({ op: "approve", plan: "request", expected: p.hash, quote: "Approve additional work" });
  const second = await execute({ op: "start", plan: "request", node: "build" }); expect(second.launch.id).toBe("build"); expect(second.launch.kind).toBe("ship"); expect(second.launch.workflow.attempt).not.toBe(first.launch.workflow.attempt);
  await execute({ op: "record", plan: "request", node: "build", attempt: second.launch.workflow.attempt, state: "running", agentId: "replacement", workspaceId: "space", evidence: "Manual promotion in preserved workspace" });
  expect((await store.get("request"))?.nodes.build?.spent).toBe(2);
});
it("quarantines a bad plan, interior gap and stray file without losing healthy plans or agenda", async () => {
  await execute({ op: "draft", definition: definition() });
  await mkdir(join(root, "broken")); await writeFile(join(root, "broken/00000000.json"), "{");
  await writeFile(join(root, "desktop.ini"), "stray");
  const read = await store.read(); expect(read.plans).toHaveLength(1); expect(read.problems).toHaveLength(2);
  expect((await store.agenda()).some(i => i.kind === "start")).toBe(true);
});
it("detects lost final events and emptied known plan directories after reopening", async () => {
  await execute({ op: "draft", definition: definition() }); await execute({ op: "start", plan: "request", node: "build" });
  await rm(join(root, "request/00000001.json")); store = new WorkflowPlanStore(root, home);
  await expect(store.get("request")).rejects.toThrow("tail");
  await rm(join(root, "request"), { recursive: true }); expect((await store.read()).problems.join()).toContain("tail");
  await expect(execute({ op: "draft", definition: definition() })).rejects.toThrow("tail");
});
it("namespaces home changes and restores each intact history", async () => {
  const a = workflowStore(home), b = workflowStore(home + "-other"); await a.execute({ op: "draft", definition: definition() }, randomUUID(), "mate");
  expect(await b.list()).toEqual([]); expect(await workflowStore(home).list()).toHaveLength(1);
  await expect(new WorkflowPlanStore(a.root, home + "-other").get("request")).rejects.toThrow("home identity");
});
it("rechecks a queued former mate at daemon consumption using the live role/home/lifecycle closure", async () => {
  const config = join(process.env.PASEO_HOME!, "plugin-data/firstmate/config.json"); await mkdir(join(config, ".."), { recursive: true });
  const dir = join(home, "data/workflow-requests"); await mkdir(dir); const id = randomUUID();
  await writeFile(join(dir, `${id}.json`), JSON.stringify({ id, actor: "former", command: { op: "draft", definition: definition() } }));
  await writeFile(config, JSON.stringify({ home, mateAgentId: "current" }));
  await processWorkflowRequests(home, store, actor => authorizeWorkflowActor(home, actor));
  expect(JSON.parse(await readFile(join(dir, `${id}.reply.json`), "utf8"))).toMatchObject({ ok: false, error: "Current first-mate role required." });
  expect(await store.list()).toEqual([]);
  for (const extra of [{ home: home + "-other" }, { migration: { sourceId: "source", sourceRevision: "revision", agentId: "replacement", target: { provider: "codex/model" }, prompt: "handoff", handoffPath: "data/handoff.md" } }, { mateLaunch: { agentId: "replacement", home, target: { provider: "codex/model" }, prompt: "hello", state: "prepared" } }]) {
    await writeFile(config, JSON.stringify({ home, mateAgentId: "current", ...extra })); await expect(authorizeWorkflowActor(home, "current")).rejects.toThrow();
  }
});
it("retains removed node tombstones, holds dependents, and reconciles dependency metadata", async () => {
  const d = definition("request", [run(), run("next")]); d.request = { ...d.request, posture: "sail", quote: "Go" }; d.nodes[1]!.after = [{ node: "build", reason: "builds-on", on: "done" }];
  await execute({ op: "draft", definition: d }); const p = (await store.get("request"))!;
  await writeFile(join(home, "data/backlog.md"), `## In flight\n## Queued\n${d.nodes.map(n => planBacklogLine(p, n)).join("\n")}\n## Done\n`);
  d.nodes.shift(); await execute({ op: "revise", definition: d, expected: p.hash, reason: "Remove trial" });
  expect((await store.agenda()).find(i => i.node === "build" && i.kind === "books")?.section).toBe("remove");
  expect((await store.get("request"))?.nodes.next?.held).toContain("Prerequisite removed");
  await expect(execute({ op: "start", plan: "request", node: "next" })).rejects.toThrow("dependencies");
});
it("caches by event file identity and bounds the agenda with many finished implicit plans", async () => {
  for (let i = 0; i < 30; i++) {
    const id = `finished-${i}`; await mkdir(join(home, `data/${id}`)); await writeFile(join(home, `data/${id}/brief.md`), "Verified scout report");
    const started = await execute({ op: "implicit", launch: { ...run(id).launch, kind: "scout" } });
    await execute({ op: "record", plan: id, node: id, attempt: started.launch.workflow.attempt, state: "done", evidence: "Verified report" });
  }
  expect(await store.agenda()).toEqual([]);
  const fresh = new WorkflowPlanStore(root, home), readEvents = vi.spyOn(fresh as any, "events");
  await fresh.list(); expect(readEvents).not.toHaveBeenCalled();
  const path = join(root, "finished-0/00000001.json"); await writeFile(path, (await readFile(path, "utf8")).replace("Verified report", "Tampered report"));
  expect((await fresh.read()).problems.join()).toContain("hash chain"); expect(readEvents).toHaveBeenCalledOnce();
}, 30000);
