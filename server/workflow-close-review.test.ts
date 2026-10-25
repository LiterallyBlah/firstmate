import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { workflowCloseContext, definition } from "../test/workflow-close-context";
import { WorkflowPlanStore, planSubjectHash, replayWorkflowEvent } from "./workflow-plans";

let fixture: ReturnType<typeof workflowCloseContext>;
beforeEach(async ({ signal }) => {
  const home = join(process.env.PASEO_HOME!, randomUUID()), root = join(home, "ledger");
  await mkdir(join(home, "data/build"), { recursive: true }); await writeFile(join(home, "data/build/brief.md"), "Run a trial.");
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  const store = new WorkflowPlanStore(root, home);
  fixture = workflowCloseContext({ home, root, store, signal });
});

afterEach(() => fixture.drain());

it.each(["declined", "quarantined", "quarantined-declined"])("refuses close with a %s landing dependent, preserving later unrelated commands", async scenario => {
  const { root, store, execute, start, close } = fixture;
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
}, 15000);

it.each(["scout", "running", "unresolved"] as const)("refuses close on %s work without changing the journal", async scenario => {
  const { root, store, start, close } = fixture;
  const attempt = await start(scenario === "scout" ? "scout" : "ship", scenario === "scout" ? "done" : scenario);
  const before = (await store.get("trial"))!, files = await readdir(join(root, "trial"));
  await expect(close(attempt)).rejects.toThrow("verified done ship");
  expect((await store.get("trial"))!.hash).toBe(before.hash);
  expect(await readdir(join(root, "trial"))).toEqual(files);
});
it("refuses a held done ship during replay, preserving its held state", async () => {
  const { root, store, start } = fixture;
  const attempt = await start(), before = (await store.get("trial"))!;
  before.nodes.build!.held = "Prerequisite removed; replan before starting.";
  const event = JSON.parse(await readFile(join(root, "trial/00000002.json"), "utf8"));
  event.command = { op: "close", plan: "trial", node: "build", attempt, expected: before.hash, evidence: "Nothing to land" };
  expect(() => replayWorkflowEvent(before, event)).toThrow("verified done ship");
  expect(before.nodes.build!.closedWithoutLanding).toBeUndefined();
});
it("refuses a second close with a new request id and current hash, retaining the first receipt", async () => {
  const { root, store, start, close } = fixture;
  const attempt = await start(); await close(attempt);
  const before = (await store.get("trial"))!, files = await readdir(join(root, "trial"));
  await expect(close(attempt)).rejects.toThrow("verified done ship");
  expect((await store.get("trial"))!).toEqual(before);
  expect(await readdir(join(root, "trial"))).toEqual(files);
});
it("refuses close when the dependency inventory itself is unavailable", async () => {
  const { store, start, close } = fixture;
  const attempt = await start(), before = (await store.get("trial"))!;
  const read = vi.spyOn(store, "read").mockResolvedValueOnce({ plans: [], problems: ["Cannot list ledger"], warnings: [], quarantined: [], unavailable: true });
  try { await expect(close(attempt)).rejects.toThrow("dependencies are unavailable"); }
  finally { read.mockRestore(); }
  expect((await store.get("trial"))!).toEqual(before);
});
it("allows close after explicit retirement makes a quarantined plan permanently non-executable", async () => {
  const { root, store, execute, start, close } = fixture;
  const attempt = await start(); await execute({ op: "draft", definition: definition("broken") });
  await writeFile(join(root, "broken/00000000.json"), "{");
  await expect(close(attempt)).rejects.toThrow("dependencies are unavailable");
  const held = (await store.read()).quarantined.find(p => p.plan === "broken")!;
  await execute({ op: "retire", plan: "broken", expected: held.fingerprint, evidence: "Inspected damaged plan; retain its reservations and never execute it again." });
  await expect(close(attempt)).resolves.toBeTruthy();
  await expect(execute({ op: "draft", definition: definition("later") })).resolves.toBeTruthy();
});
