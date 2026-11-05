// Regression for the recurring "Plans are still loading after a restart" / "some plans
// unavailable" banner: a cold journal validation used to copy and re-serialize the whole
// projection once per transaction (quadratic in journal length — about 27 s at the owner's
// 1,464 transactions), the runtime paid that validation twice at startup (its status reader
// and its writer were separate instances), and every legacy plan write paid it again inside
// the writer's lock (the route check built a fresh store per mutation). The bounds here are
// work counts, not wall time: deep copies and full scans per cold start.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { PlanDefinitionSchema, type PlanDefinition } from "../shared/workflow-plans";
import { expected, scope } from "../test/supervision-fixture";
import { pluginDir } from "./data-dir";
import { SupervisionRuntime } from "./supervision-runtime";
import { SupervisionStore } from "./supervision-store";
import { workflowStore } from "./workflow-service";

afterEach(() => vi.restoreAllMocks());

async function journal(transactions: number, dataRoot?: string) {
  const home = join(process.env.PASEO_HOME!, randomUUID()), data = dataRoot ?? join(home, "data");
  const store = new SupervisionStore(data, home, { writable: true,
    processIdentity: async () => ({ state: "alive", start: "cold-read-fixture" }) });
  await store.initialize(); await store.acquireCoordinator();
  for (let version = 0; version < transactions; version++) {
    const mutation = [{ kind: "scope" as const, value: { ...scope(store.homeId), version: version + 1 } }];
    await store.transact(expected(mutation, version), randomUUID(), mutation);
  }
  return { store, home, data };
}
const fullScans = () => vi.spyOn(SupervisionStore.prototype as any, "scanFull");

it("a cold read folds the journal without copying the whole projection per transaction", async () => {
  const { store, home, data } = await journal(48);
  const expectedStatus = await store.read();
  const clone = vi.spyOn(globalThis, "structuredClone");
  const cold = await new SupervisionStore(data, home).read();
  // Replay replaces rows instead of deep-cloning every row per transaction; all that remains
  // is the read's own copy of the finished status. It was one clone per transaction before.
  expect(clone.mock.calls.length).toBeLessThanOrEqual(4);
  clone.mockRestore();
  expect(cold).toEqual(expectedStatus);
}, 120_000);

it("the runtime validates the journal once across its first read and first write", async () => {
  const { store, home, data } = await journal(6);
  await store.releaseCoordinator();
  const runtime = new SupervisionRuntime(data, (root, h) => new SupervisionStore(root, h, { writable: true,
    processIdentity: async () => ({ state: "alive", start: "cold-read-runtime" }) }));
  const scan = fullScans();
  try {
    expect((await runtime.read(home)).freshness).toBe("current");
    await runtime.mutate(home, async writer => { expect((await writer.read()).freshness).toBe("current"); });
    expect((await runtime.read(home)).freshness).toBe("current");
    // One instance serves the read and the write; separate reader/writer instances each
    // paid a full cold validation, racing on the one thread after every restart.
    expect(scan).toHaveBeenCalledTimes(1);
  } finally { await runtime.stop(); }
}, 120_000);

function definition(id: string): PlanDefinition {
  const node = `${id}-build`;
  return PlanDefinitionSchema.parse({ format: "firstmate.plan/1", id, title: `Plan ${id}`, request: { text: "Build it", at: "2026-10-20T12:00:00Z" },
    budget: { agents: 5, turns: 5 }, nodes: [{ id: node, kind: "run", title: "Build", summary: "Build the requested change", workflow: "task@1",
      launch: { id: node, title: "Build", agentTitle: "Build", project: "project", host: "local", baseBranch: "main", kind: "ship", mode: "reviewed-PR",
        brief: { file: `data/${node}/brief.md` }, agent: { provider: "codex/model", modeId: "full-access" }, backlog: { existing: "none" } } }] });
}

it("legacy plan writes reuse one warm journal reader for the route check", async () => {
  const { store, home } = await journal(3, pluginDir());
  await store.releaseCoordinator();
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  for (const id of ["route-one", "route-two"]) {
    await mkdir(join(home, "data", `${id}-build`), { recursive: true });
    await writeFile(join(home, "data", `${id}-build`, "brief.md"), "Build only this.");
  }
  const scan = fullScans();
  await workflowStore(home).execute({ op: "draft", definition: definition("route-one") }, randomUUID(), "mate");
  await workflowStore(home).execute({ op: "draft", definition: definition("route-two") }, randomUUID(), "mate");
  // The shared reader validates once; a fresh store per mutation validated in full per write.
  expect(scan.mock.calls.length).toBeLessThanOrEqual(1);
}, 120_000);
