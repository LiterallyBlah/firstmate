import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { workflowFixture } from "../test/workflow-fixture";
import type { PlanDefinition, WorkflowCommand } from "../shared/workflow-plans";
import { WorkflowPlanStore, planSubjectHash, replayWorkflowEvent } from "./workflow-plans";

let home: string, root: string, store: WorkflowPlanStore;
function definition(id: string, nodeId = id): PlanDefinition {
  const source = workflowFixture(), node = source.nodes.find(n => n.kind === "run" && n.launch.kind === "ship")!;
  if (node.kind !== "run") throw new Error("fixture");
  return { ...source, id, request: { ...source.request, posture: "sail", quote: "Sail within this approved trial." }, nodes: [
    { ...node, id: nodeId, after: [], launch: { ...node.launch, id: nodeId, brief: { file: `data/${nodeId}/brief.md` } } },
  ] };
}
const execute = (command: WorkflowCommand) => store.execute(command, randomUUID(), "mate");
async function start(kind: "ship" | "scout" = "ship", state: "done" | "running" | "unresolved" = "done") {
  const plan = definition("trial", "build"), node = plan.nodes[0]!;
  if (node.kind !== "run") throw new Error("fixture");
  node.launch.kind = kind; node.workflow = kind === "ship" ? "task@1" : "scout@1";
  await execute({ op: "draft", definition: plan });
  const result: any = await execute({ op: "start", plan: "trial", node: "build" });
  const attempt = result.launch.workflow.attempt;
  await execute({ op: "record", plan: "trial", node: "build", attempt, state, evidence: "Inspected trial report and worker.",
    ...(state === "running" ? { agentId: "worker", workspaceId: "workspace" } : {}) });
  return attempt as string;
}
async function close(attempt: string) {
  return execute({ op: "close", plan: "trial", node: "build", attempt, expected: (await store.get("trial"))!.hash, evidence: "Verified evidence-only trial; nothing to land." });
}
beforeEach(async () => {
  home = join(process.env.PASEO_HOME!, randomUUID()); root = join(home, "ledger");
  await mkdir(join(home, "data/build"), { recursive: true }); await writeFile(join(home, "data/build/brief.md"), "Run a trial.");
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  store = new WorkflowPlanStore(root, home);
});

it.each(["declined", "quarantined", "quarantined-declined"])("refuses close with a %s landing dependent, preserving later unrelated commands", async scenario => {
  const attempt = await start(), dependent = definition("dependent", "consumer");
  dependent.nodes[0]!.after = [{ node: "build", reason: "builds-on", on: "landed" }];
  await execute({ op: "draft", definition: dependent });
  if (scenario.includes("declined")) {
    const current = (await store.get("dependent"))!;
    await execute({ op: "captain", plan: "dependent", revision: current.revision, subjectHash: planSubjectHash(current), action: "decline", text: "Do not start this consumer." });
  }
  const path = join(root, "dependent/00000000.json"), bytes = await readFile(path, "utf8");
  if (scenario.includes("quarantined")) await writeFile(path, "{");
  const before = (await store.get("trial"))!, files = await readdir(join(root, "trial"));
  await expect(close(attempt)).rejects.toThrow(scenario.includes("quarantined") ? "dependencies are unavailable" : "requires this run to land");
  expect((await store.get("trial"))!.hash).toBe(before.hash);
  expect(await readdir(join(root, "trial"))).toEqual(files);
  if (scenario.includes("quarantined")) await writeFile(path, bytes);
  // Restoring the hidden dependent must not poison the home's global validation.
  await expect(execute({ op: "draft", definition: definition("unrelated") })).resolves.toBeTruthy();
  const current = (await store.get("dependent"))!;
  dependent.nodes[0]!.after = [];
  await execute({ op: "revise", definition: dependent, expected: current.hash, reason: "Remove the retained landing prerequisite before closing the trial." });
  await close(attempt);
  await expect(execute({ op: "draft", definition: definition("later") })).resolves.toBeTruthy();
});

it.each(["scout", "running", "unresolved"] as const)("refuses close on %s work without changing the journal", async scenario => {
  const attempt = await start(scenario === "scout" ? "scout" : "ship", scenario === "scout" ? "done" : scenario);
  const before = (await store.get("trial"))!, files = await readdir(join(root, "trial"));
  await expect(close(attempt)).rejects.toThrow("verified done ship");
  expect((await store.get("trial"))!.hash).toBe(before.hash);
  expect(await readdir(join(root, "trial"))).toEqual(files);
});
it("refuses a held done ship during replay, preserving its held state", async () => {
  const attempt = await start(), before = (await store.get("trial"))!;
  before.nodes.build!.held = "Prerequisite removed; replan before starting.";
  const event = JSON.parse(await readFile(join(root, "trial/00000002.json"), "utf8"));
  event.command = { op: "close", plan: "trial", node: "build", attempt, expected: before.hash, evidence: "Nothing to land" };
  expect(() => replayWorkflowEvent(before, event)).toThrow("verified done ship");
  expect(before.nodes.build!.closedWithoutLanding).toBeUndefined();
});
it("refuses a second close with a new request id and current hash, retaining the first receipt", async () => {
  const attempt = await start(); await close(attempt);
  const before = (await store.get("trial"))!, files = await readdir(join(root, "trial"));
  await expect(close(attempt)).rejects.toThrow("verified done ship");
  expect((await store.get("trial"))!).toEqual(before);
  expect(await readdir(join(root, "trial"))).toEqual(files);
});
it("refuses close when the dependency inventory itself is unavailable", async () => {
  const attempt = await start(), before = (await store.get("trial"))!;
  const read = vi.spyOn(store, "read").mockResolvedValueOnce({ plans: [], problems: ["Cannot list ledger"], warnings: [], quarantined: [], unavailable: true });
  try { await expect(close(attempt)).rejects.toThrow("dependencies are unavailable"); }
  finally { read.mockRestore(); }
  expect((await store.get("trial"))!).toEqual(before);
});
it("allows close after explicit retirement makes a quarantined plan permanently non-executable", async () => {
  const attempt = await start(); await execute({ op: "draft", definition: definition("broken") });
  await writeFile(join(root, "broken/00000000.json"), "{");
  await expect(close(attempt)).rejects.toThrow("dependencies are unavailable");
  const held = (await store.read()).quarantined.find(p => p.plan === "broken")!;
  await execute({ op: "retire", plan: "broken", expected: held.fingerprint, evidence: "Inspected damaged plan; retain its reservations and never execute it again." });
  await expect(close(attempt)).resolves.toBeTruthy();
  await expect(execute({ op: "draft", definition: definition("later") })).resolves.toBeTruthy();
});
