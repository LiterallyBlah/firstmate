import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { WorkflowPlanStore } from "../server/workflow-plans";
import { workflowCloseContext, definition } from "./workflow-close-context";

async function fixture(signal?: AbortSignal) {
  const home = join(process.env.PASEO_HOME!, randomUUID()), root = join(home, "ledger");
  await mkdir(join(home, "data/build"), { recursive: true });
  await writeFile(join(home, "data/build/brief.md"), "Run a trial.");
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  return workflowCloseContext({ home, root, store: new WorkflowPlanStore(root, home), ...(signal ? { signal } : {}) });
}
it.each([false, true])("a delayed case retains its own store when the next case starts (aborted: %s)", async aborted => {
  const controller = new AbortController(), a = await fixture(controller.signal), b = await fixture();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const execute = a.store.execute.bind(a.store);
  a.store.execute = (async (...args: Parameters<typeof execute>) => {
    const value = await execute(...args);
    if (args[0].op === "draft") { entered(); await gate; }
    return value;
  }) as typeof a.store.execute;
  let currentCase = a;
  const pending = currentCase.start();
  await started;
  if (aborted) controller.abort();
  currentCase = b;
  await currentCase.execute({ op: "draft", definition: definition("trial", "build") });
  release();
  if (aborted) await expect(pending).rejects.toThrow("Fixture deadline expired");
  else await pending;
  await Promise.all([a.drain(), b.drain()]);
  expect((await b.store.get("trial"))?.nodes.build?.state).toBe("planned");
  expect((await a.store.get("trial"))?.nodes.build?.state).toBe(aborted ? "planned" : "done");
});
