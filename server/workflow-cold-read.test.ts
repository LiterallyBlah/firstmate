// Regression for the 3 Nov 2026 install: a fresh process verifies every plan log once, and the decisions read
// (firstmate.needs-you.read) waited on that cold read past the host's 30 s RPC limit. On the owner's home
// (138 plans, about 12,000 events) the first two reads after a start took over 45 s; see the PR for timings.
import { randomUUID } from "node:crypto";
import * as filesystem from "node:fs/promises";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { PlanDefinitionSchema, type PlanDefinition, type WorkflowPlan } from "../shared/workflow-plans";
import type { WorkflowSnapshot } from "../shared/workflow-rpc";
import { replayWorkflowEvent, WorkflowPlanStore } from "./workflow-plans";
import { workflowStore } from "./workflow-service";
import { PLAN_READ_BUDGET_MS, withWorkflowFleet, workflowSnapshotWithin } from "./workflow-board";
import type { Fleet } from "../shared/fleet";
import { updateFirstmateConfig } from "./config";
import { digest } from "./submissions";

// Real IO; wrapped so one test can hold a single stat open. Node's native ESM namespace is sealed.
vi.mock(import("node:fs/promises"), async importOriginal => {
  const actual = await importOriginal(); return { ...actual, stat: vi.fn(actual.stat) as typeof actual.stat };
});
const coldCache = () => ((WorkflowPlanStore as unknown as { cache: Map<string, unknown> }).cache).clear();
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function definition(id: string): PlanDefinition {
  const node = `${id}-build`;
  return PlanDefinitionSchema.parse({ format: "firstmate.plan/1", id, title: `Plan ${id}`, request: { text: "Build it", at: "2026-10-20T12:00:00Z" },
    budget: { agents: 5, turns: 5 }, nodes: [{ id: node, kind: "run", title: "Build", summary: "Build the requested change", workflow: "task@1",
      launch: { id: node, title: "Build", agentTitle: "Build", project: "project", host: "local", baseBranch: "main", kind: "ship", mode: "reviewed-PR",
        brief: { file: `data/${node}/brief.md` }, agent: { provider: "codex/model", modeId: "full-access" }, backlog: { existing: "none" } } }] });
}
async function home() {
  const path = join(process.env.PASEO_HOME!, randomUUID());
  await mkdir(join(path, "data"), { recursive: true }); await writeFile(join(path, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  return path;
}
/** A plan whose log holds `events` events: its draft and then acknowledgements, as a long-lived plan accumulates. */
async function plan(store: WorkflowPlanStore, path: string, id: string, events: number) {
  await mkdir(join(path, "data", `${id}-build`), { recursive: true }); await writeFile(join(path, "data", `${id}-build`, "brief.md"), "Build only this.");
  await store.execute({ op: "draft", definition: definition(id) }, randomUUID(), "mate");
  for (let n = 1; n < events; n++) await store.execute({ op: "ack", plan: id, kind: "told", ids: [`note-${n}`] }, randomUUID(), "mate");
}
/** The plan as replaying each event onto a copy gives it: the reference the in-place fold must match. */
async function replayed(store: WorkflowPlanStore, id: string): Promise<WorkflowPlan | null> {
  const internal = store as unknown as { events(id: string): Promise<Parameters<typeof replayWorkflowEvent>[1][]>; recoveryHistory(plan: WorkflowPlan): Promise<WorkflowPlan> };
  const plan = (await internal.events(id)).reduce<WorkflowPlan | null>((p, e) => replayWorkflowEvent(p, e), null);
  return plan ? internal.recoveryHistory(plan) : null;
}

it("a cold read of a long plan log copies the plan once, not once per event, and matches a copying replay", async () => {
  const path = await home(), store = new WorkflowPlanStore(join(path, "ledger"), path);
  await plan(store, path, "long", 120);
  coldCache();
  const clone = vi.spyOn(globalThis, "structuredClone");
  const cold = await new WorkflowPlanStore(join(path, "ledger"), path).get("long");
  // The fold owns its plan; only the cached copy and the caller's copy remain (it was 120 + 1).
  expect(clone.mock.calls.length).toBeLessThanOrEqual(2);
  clone.mockRestore();
  expect(cold?.sequence).toBe(119);
  expect(digest(cold)).toBe(digest(await replayed(store, "long")));
}, 120_000);

it("a reader whose stats finish after another reader's fold has completed reuses that fold", async () => {
  const path = await home(), store = new WorkflowPlanStore(join(path, "ledger"), path);
  await plan(store, path, "raced", 3);
  coldCache();
  // The oldest event is statted only in get()'s full identity round, after it has looked at the cache.
  const oldest = (await readdir(join(path, "ledger", "raced"))).sort()[0]!, target = join(path, "ledger", "raced", oldest);
  const real = (await vi.importActual<typeof filesystem>("node:fs/promises")).stat;
  let reached!: () => void, release!: () => void, armed = true;
  const inStats = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const held = (async (file: Parameters<typeof real>[0], options?: Parameters<typeof real>[1]) => {
    if (armed && String(file) === target) { armed = false; reached(); await gate; }
    return real(file, options);
  }) as typeof real;
  vi.mocked(filesystem.stat).mockImplementation(held);
  const proto = WorkflowPlanStore.prototype as unknown as { events(...args: unknown[]): Promise<unknown[]> };
  const original = proto.events, folds: string[] = [];
  vi.spyOn(proto, "events").mockImplementation(function (this: WorkflowPlanStore, ...args: unknown[]) {
    if (args.length === 1) folds.push(String(args[0])); return original.apply(this, args);
  });
  try {
    const late = new WorkflowPlanStore(join(path, "ledger"), path).get("raced");
    await inStats;
    const early = await new WorkflowPlanStore(join(path, "ledger"), path).get("raced");
    expect(folds).toEqual(["raced"]);
    release();
    expect(digest(await late)).toBe(digest(early));
    expect(folds).toEqual(["raced"]);
  } finally { release(); vi.mocked(filesystem.stat).mockImplementation(real); }
}, 60_000);

it("137 plans read cold by three callers at once are folded once each, and every caller gets the same plans", async () => {
  const path = await home(), store = new WorkflowPlanStore(join(path, "ledger"), path);
  for (let n = 0; n < 137; n++) await plan(store, path, `plan-${n}`, 2);
  coldCache();
  const proto = WorkflowPlanStore.prototype as unknown as { events(...args: unknown[]): Promise<unknown[]> };
  const original = proto.events, folds: string[] = [];
  vi.spyOn(proto, "events").mockImplementation(function (this: WorkflowPlanStore, ...args: unknown[]) {
    if (args.length === 1) folds.push(String(args[0])); return original.apply(this, args);
  });
  const readers = [0, 1, 2].map(() => new WorkflowPlanStore(join(path, "ledger"), path));
  const reads = await Promise.all(readers.map(r => r.read()));
  expect(reads.map(r => r.plans.length)).toEqual([137, 137, 137]);
  expect(new Set(reads.map(r => digest(r.plans))).size).toBe(1);
  expect(folds).toHaveLength(137); expect(new Set(folds).size).toBe(137);
  // Warm: nothing is folded again while the files are unchanged.
  folds.length = 0; await readers[0]!.read(); expect(folds).toEqual([]);
  // A changed log is a new identity: the next read folds that plan alone, never a stale shared result.
  await store.execute({ op: "ack", plan: "plan-7", kind: "told", ids: ["after"] }, randomUUID(), "mate");
  folds.length = 0; coldCache();
  const after = await Promise.all(readers.map(r => r.read()));
  expect(folds).toHaveLength(137);
  expect(after[1]!.plans.find(p => p.definition.id === "plan-7")?.sequence).toBe(2);
  expect(new Set(after.map(r => digest(r.plans))).size).toBe(1);
  folds.length = 0; await store.execute({ op: "ack", plan: "plan-9", kind: "told", ids: ["later"] }, randomUUID(), "mate"); folds.length = 0;
  const later = await readers[2]!.read();
  expect(folds).toEqual(["plan-9"]); expect(later.plans.find(p => p.definition.id === "plan-9")?.sequence).toBe(2);
  expect(after[1]!.plans.find(p => p.definition.id === "plan-7")?.sequence).toBe(2);
}, 600_000);

it("the board's fleet load waits for plans at most its budget, then answers with plans marked loading", async () => {
  vi.useFakeTimers();
  const never = vi.fn(() => new Promise<WorkflowSnapshot>(() => {}));
  const fleet = { home: "C:/home", cards: [], warnings: [], needsYou: { actionCount: 2 } } as unknown as Fleet;
  const waiting = withWorkflowFleet(fleet, PLAN_READ_BUDGET_MS, never);
  await vi.advanceTimersByTimeAsync(PLAN_READ_BUDGET_MS);
  const answered = await waiting;
  expect(answered.needsYou).toMatchObject({ actionCount: 2, plansLoading: true });
  expect(answered.needsYou?.planProblems).toBeUndefined();
  expect(answered.warnings).toEqual([expect.stringContaining("Plans are still loading")]);
});
it("the decisions read waits for plans at most its budget, then answers without them", async () => {
  vi.useFakeTimers();
  const never = vi.fn(() => new Promise<WorkflowSnapshot>(() => {}));
  const waiting = workflowSnapshotWithin("C:/home", PLAN_READ_BUDGET_MS, never);
  await vi.advanceTimersByTimeAsync(PLAN_READ_BUDGET_MS - 1);
  let settled = false; void waiting.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(0); expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await expect(waiting).resolves.toBeNull();
  const ready = { homeId: "h" } as unknown as WorkflowSnapshot;
  await expect(workflowSnapshotWithin("C:/home", PLAN_READ_BUDGET_MS, async () => ready)).resolves.toBe(ready);
  // A failing late read neither rejects the decisions read nor goes unhandled.
  const failing = workflowSnapshotWithin("C:/home", 5, () => new Promise((_, no) => setTimeout(() => no(new Error("late")), 50)));
  await vi.advanceTimersByTimeAsync(5); await expect(failing).resolves.toBeNull(); await vi.advanceTimersByTimeAsync(100);
  expect(PLAN_READ_BUDGET_MS).toBeLessThanOrEqual(15_000);
});

it("firstmate.needs-you.read stays inside the host's RPC limit on a realistic home during a cold start, and is complete once warm", async () => {
  const path = await home(), store = workflowStore(path);
  for (let n = 0; n < 137; n++) await plan(store, path, `plan-${n}`, 2);
  await writeFile(join(process.env.PASEO_HOME!, "server-id"), "realistic-home");
  await updateFirstmateConfig({ home: path, mateAgentId: "" }); await updateFirstmateConfig({ mateAgentId: "general" });
  const timers: unknown[] = [];
  vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => unknown) => { timers.push(callback); return { unref() {} } as never; }) as never);
  const handlers = new Map<string, (input: unknown, context?: unknown) => Promise<Record<string, unknown>>>();
  const server = { handle: (rpc: { name: string }, fn: never) => handlers.set(rpc.name, fn), on: () => () => {}, before: () => () => {}, registerSettings: () => {} } as never;
  // The decisions read makes no agent call; a fleet's worth of crew is listed for any reader that asks.
  const crew = Array.from({ length: 250 }, (_, n) => ({ agent: { id: `crew-${n}`, status: "idle", archivedAt: null, labels: { "firstmate.role": "crew" } } }));
  const paseo = { agents: { list: async () => ({ entries: crew, pageInfo: {} }), ref: (id: string) => ({ refresh: async () => ({ agent: { id, status: "idle", archivedAt: null } }) }) } };
  const contribute = (await import("../index.server")).default as unknown as (s: never) => () => Promise<void>;
  const cleanup = contribute(server);
  try {
    const read = () => handlers.get("firstmate.needs-you.read")!({}, { paseo });
    coldCache();
    // Cold, with two reads racing as the app's poll and a reread do.
    let started = Date.now();
    const cold = await Promise.all([read(), read()]);
    expect(Date.now() - started).toBeLessThan(25_000);
    for (const snapshot of cold) expect(snapshot.planProblems ?? []).toEqual([]);
    started = Date.now(); const warm = await read();
    expect(Date.now() - started).toBeLessThan(10_000); expect(warm.planProblems ?? []).toEqual([]);
    // However slow the plan store is, the read answers by the budget and says plans are still loading:
    // a delay, not an unavailable plan, so no plan problem and no claim that scoped reads failed.
    coldCache();
    let release!: () => void;
    const slow = new Promise<void>(done => { release = done; }), real = WorkflowPlanStore.prototype.read;
    const stalled = vi.spyOn(WorkflowPlanStore.prototype, "read").mockImplementation(async function (this: WorkflowPlanStore) { await slow; return real.call(this); });
    started = Date.now(); const loading = await read();
    expect(Date.now() - started).toBeLessThan(PLAN_READ_BUDGET_MS + 10_000);
    expect(loading.plansLoading).toBe(true);
    expect(loading.planProblems ?? []).toEqual([]); expect(loading.scopedComplete).not.toBe(false);
    // Once the slow read finishes, the next read (the app's poll) is complete with no manual retry.
    release(); stalled.mockRestore();
    const recovered = await read();
    expect(recovered.plansLoading).toBeUndefined(); expect(recovered.planProblems ?? []).toEqual([]);
  } finally { await cleanup(); }
}, 600_000);
