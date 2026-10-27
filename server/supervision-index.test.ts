import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { SupervisionStore, SUPERVISION_INDEX_LIMITS } from "./supervision-store";
import { canonical, digest } from "./submissions";
import { expected, scope } from "../test/supervision-fixture";
import { s04Fixture } from "../test/supervision-s04-fixture";
const bounds: unknown[] = [];
afterAll(async () => {
  if (process.env.FIRSTMATE_PILOT_EVIDENCE !== "1") return;
  await mkdir(".local/s06", { recursive: true });
  await writeFile(".local/s06/index-bound-evidence.json", JSON.stringify({ sourceHead: process.env.FIRSTMATE_PILOT_SOURCE_HEAD,
    runtime: { node: process.version, platform: process.platform }, limits: SUPERVISION_INDEX_LIMITS, bounds }, null, 2) + "\n");
});

async function fixture() {
  const home = join(process.env.PASEO_HOME!, randomUUID()), data = join(home, "data");
  let fault: string | null = null;
  const store = new SupervisionStore(data, home, { writable: true,
    processIdentity: async () => ({ state: "alive", start: "index-fixture" }),
    boundary: async name => { if (name === fault) { fault = null; throw Error(`Injected ${name}`); } } });
  await store.initialize(); await store.acquireCoordinator(); let version = 0;
  const advance = async () => { const mutation = [{ kind: "scope" as const, value: { ...scope(store.homeId), version: version + 1 } }];
    const result = await store.transact(expected(mutation, version), randomUUID(), mutation); version++; return result; };
  const path = (n: number, suffix = "event") => join(store.root, "transactions", `${String(n).padStart(12, "0")}.${suffix}.json`);
  return { store, advance, home, data, path, fault: (name: string) => { fault = name; } };
}
// The bound under test is the spies' zero scanFull/apply counts, not wall time. Building 176 durable transactions takes
// ~4 s locally on Windows; a loaded hosted Windows runner (two heavy store files on its two workers, plus its random
// ~10-14 s pauses) took over 20 s on b4adc1c2 with no code slowdown (503e0c35 and b4adc1c2 time alike on one machine).
it.each([11, 176])("warm reads at %i transactions replay no historical reducers or full scans", async history => {
  const f = await fixture(); for (let n = 0; n < history; n++) await f.advance();
  const scan = vi.spyOn(f.store as any, "scanFull"), apply = vi.spyOn(f.store as any, "apply");
  const readMs: number[] = [];
  for (let n = 0; n < 5; n++) { const start = performance.now(); expect(await f.store.read()).toMatchObject({ freshness: "current", sequence: history }); readMs.push(performance.now() - start); }
  expect(scan).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  bounds.push({ history, readMs, fullScans: scan.mock.calls.length, historicalReducerCalls: apply.mock.calls.length });
  const status = await f.store.read(); status.scopes[0]!.state = "retired";
  expect((await f.store.read()).scopes[0]!.state).not.toBe("retired");
}, 60_000);
it("launch work stays bounded after 176 transactions instead of replaying the prefix for each step", async () => {
  const f = await s04Fixture(), owner = await f.addScope(1, "indexed", ["indexed-build", "indexed-next"]);
  await f.draft(owner, [{ id: "indexed-build" }, { id: "indexed-next" }]);
  while ((await f.store.read()).sequence < 176) {
    const s = (await f.store.read()).scopes[0]!;
    await f.store.transact([{ kind: "scope", id: s.id, version: s.version }], randomUUID(), [{ kind: "scope", value: { ...s, version: s.version + 1 } }]);
  }
  const scan = vi.spyOn(f.store as any, "scanFull"), apply = vi.spyOn(f.store as any, "apply");
  const start = performance.now(); const launched = await f.launch(owner, "indexed-build"); const launchMs = performance.now() - start;
  expect(scan).not.toHaveBeenCalled(); expect(apply.mock.calls.length).toBeLessThanOrEqual(12);
  bounds.push({ history: 176, launchMs, fullScans: scan.mock.calls.length, newTransitionCalls: apply.mock.calls.length });
  expect(f.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(1);
  scan.mockRestore(); apply.mockRestore();
  while ((await f.store.read()).sequence < SUPERVISION_INDEX_LIMITS.admissions) {
    const s = (await f.store.read()).scopes[0]!;
    await f.store.transact([{ kind: "scope", id: s.id, version: s.version }], randomUUID(), [{ kind: "scope", value: { ...s, version: s.version + 1 } }]);
  }
  await expect(f.launch(owner, "indexed-next")).rejects.toMatchObject({ code: "HELD" });
  expect((await f.store.read()).storage.admissionsHeld).toBe(true);
  // The reserved 64-record headroom can still record known admitted work; no new effect.
  await f.run(owner, { op: "record", plan: owner.planId, node: "indexed-build", attempt: launched.attemptId!, state: "done", evidence: "Owner inspected the admitted synthetic report." });
  expect((await f.store.read()).plans[0]!.plan.nodes["indexed-build"]!.state).toBe("done");
  expect(f.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(1);
}, 30000);
it("a reader validates a bounded new tail; startup and an oversized tail validate full history", async () => {
  const f = await fixture(); await f.advance();
  const reader = new SupervisionStore(f.data, f.home), full = vi.spyOn(reader as any, "scanFull");
  await reader.read(); expect(full).toHaveBeenCalledTimes(1); full.mockClear();
  for (let n = 0; n < 4; n++) await f.advance();
  expect(await reader.read()).toMatchObject({ freshness: "current", sequence: 5 }); expect(full).not.toHaveBeenCalled();
  for (let n = 0; n <= SUPERVISION_INDEX_LIMITS.tail; n++) await f.advance();
  expect((await reader.read()).freshness).toBe("current"); expect(full).toHaveBeenCalledTimes(1);
});
it("old in-place corruption is caught by explicit audit and automatic startup validation", async () => {
  const f = await fixture(); await f.advance(); await f.advance(); await writeFile(f.path(1), "{old-corruption");
  expect((await f.store.read()).freshness).toBe("current"); // Accepted prefix trust, not a historical audit.
  expect(await f.store.audit()).toMatchObject({ freshness: "held", sequence: 0 });
  expect((await f.store.read()).freshness).toBe("held");
  expect((await new SupervisionStore(f.data, f.home).read()).freshness).toBe("held");
  await expect(f.store.recoverIndex()).rejects.toMatchObject({ code: "HELD" });
});
it("a concurrent read waits for publication and checkpointing instead of exposing a transient held projection", async () => {
  const f = await s04Fixture();
  let resume!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; }), atCheckpoint = new Promise<void>(resolve => { entered = resolve; });
  f.hooks.boundary = async name => { if (name === "checkpoint:written") { entered(); await gate; } };
  const mutation = [{ kind: "scope" as const, value: scope(f.store.homeId) }];
  const write = f.store.transact(expected(mutation), randomUUID(), mutation); await atCheckpoint;
  const scan = vi.spyOn(f.store as any, "scan");
  try {
    const read = f.store.read(); expect(scan).not.toHaveBeenCalled();
    resume(); await write; expect(await read).toMatchObject({ freshness: "current", sequence: 1 });
  } finally { resume(); await write; scan.mockRestore(); }
});
it("a detached callback cannot reuse an expired writer lock while a later checkpoint is staged", async () => {
  const f = await s04Fixture();
  let releaseDetached!: () => void, releaseSecond!: () => void, enteredSecond!: () => void, attemptedRead!: () => void;
  const detachedGate = new Promise<void>(resolve => { releaseDetached = resolve; });
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
  const atSecond = new Promise<void>(resolve => { enteredSecond = resolve; });
  const atRead = new Promise<void>(resolve => { attemptedRead = resolve; });
  let resolveDetached!: (value: unknown) => void, rejectDetached!: (reason: unknown) => void;
  const detached = new Promise<unknown>((resolve, reject) => { resolveDetached = resolve; rejectDetached = reject; });
  let checkpoints = 0;
  f.hooks.boundary = async name => {
    if (name !== "checkpoint:written") return;
    if (++checkpoints === 1) {
      // This timer inherits the first writer's async context, but runs after its lease ends.
      setTimeout(async () => {
        await detachedGate; attemptedRead();
        try { resolveDetached(await f.store.read()); } catch (error) { rejectDetached(error); }
      }, 0);
    } else { enteredSecond(); await secondGate; }
  };
  const first = [{ kind: "scope" as const, value: scope(f.store.homeId) }];
  await f.store.transact(expected(first), randomUUID(), first);
  const existing = (await f.store.read()).scopes[0]!;
  const secondMutation = [{ kind: "scope" as const, value: { ...existing, version: existing.version + 1 } }];
  const second = f.store.transact(expected(secondMutation, existing.version), randomUUID(), secondMutation);
  await atSecond;
  const scan = vi.spyOn(f.store as any, "scan");
  try {
    releaseDetached(); await atRead;
    expect(scan).not.toHaveBeenCalled();
  } finally { releaseDetached(); releaseSecond(); await second; scan.mockRestore(); }
  await expect(detached).resolves.toMatchObject({ freshness: "current", sequence: 2 });
});
it.each(["event", "tip", "publication"])("every read detects a tampered checkpoint %s anchor", async suffix => {
  const f = await fixture(); await f.advance(); await f.advance(); await writeFile(f.path(2, suffix), "{anchor-corruption");
  for (let n = 0; n < 2; n++) expect((await f.store.read()).freshness).toBe("held");
});
it.each(["missing", "stale", "digest"])("a %s checkpoint validates history but refuses its projection until explicit recovery", async damage => {
  const f = await fixture(); await f.advance(); const path = join(f.store.root, "checkpoint.json"), old = await readFile(path, "utf8"); await f.advance();
  if (damage === "missing") await rm(path);
  if (damage === "stale") await writeFile(path, old);
  if (damage === "digest") { const { hash: _hash, ...checkpoint } = JSON.parse(await readFile(path, "utf8")); checkpoint.prefixDigest = "a".repeat(64);
    await writeFile(path, `${canonical({ ...checkpoint, hash: digest(checkpoint) })}\n`); }
  const status = await f.store.read(); expect(status.freshness).toBe("held"); expect(status.scopes).toEqual([]); expect(status.plans).toEqual([]);
  expect(status.retainedOwnership.length).toBeGreaterThan(0);
  if (damage === "stale") {
    await f.store.recoverIndex(); expect(await f.store.read()).toMatchObject({ freshness: "current", sequence: 2 });
  } else {
    // Only a consistent ancestor is repaired. A lost or divergent witness is an integrity incident.
    await expect(f.store.recoverIndex()).rejects.toMatchObject({ code: "HELD", message: expect.stringContaining("Integrity incident") });
    expect((await f.store.read()).freshness).toBe("held");
  }
});
it("a missing checkpoint over an empty journal (interrupted initialization) is rebuilt", async () => {
  const f = await fixture(); await rm(join(f.store.root, "checkpoint.json"));
  expect((await f.store.read()).freshness).toBe("held");
  await f.store.recoverIndex(); expect(await f.store.read()).toMatchObject({ freshness: "current", sequence: 0 });
});
it.each(["recoverIndex", "recoverPublication"] as const)("%s refuses a checkpoint ahead of a journal that lost its final published transaction", async operation => {
  const f = await fixture(); for (let n = 0; n < 5; n++) await f.advance();
  const checkpoint = await readFile(join(f.store.root, "checkpoint.json"), "utf8");
  for (const suffix of ["event", "tip", "publication"]) await rm(f.path(5, suffix));
  const held = await f.store.audit(); expect(held).toMatchObject({ freshness: "held", sequence: 4 });
  await expect(f.store[operation]()).rejects.toMatchObject({ code: "HELD", message: expect.stringContaining("journal ends at 4") });
  expect(await readFile(join(f.store.root, "checkpoint.json"), "utf8")).toBe(checkpoint);
  expect(await f.store.audit()).toMatchObject({ freshness: "held", sequence: 4 });
});
it("a status reader stays warm across new evidence blobs but never accepts a removed or forged one", async () => {
  const f = await fixture(); await f.advance();
  const reader = new SupervisionStore(f.data, f.home), full = vi.spyOn(reader as any, "scanFull");
  await reader.read(); full.mockClear();
  const blob = await f.store.putBlob(Buffer.from(`evidence ${randomUUID()}`));
  expect(await reader.read()).toMatchObject({ freshness: "current", sequence: 1 }); expect(full).not.toHaveBeenCalled();
  await f.advance(); await f.store.putBlob(Buffer.from(`more ${randomUUID()}`));
  expect(await reader.read()).toMatchObject({ freshness: "current", sequence: 2 }); expect(full).not.toHaveBeenCalled();
  // A forged name falls back to full validation; a removed blob also leaves the warm path.
  const forged = join(f.store.root, "blobs", "f".repeat(64)); await writeFile(forged, "not its digest");
  await reader.read(); expect(full).toHaveBeenCalledTimes(1); await rm(forged); full.mockClear();
  await reader.read(); await rm(join(f.store.root, "blobs", blob.id)); full.mockClear();
  await reader.read(); expect(full).toHaveBeenCalledTimes(1);
});
it("an overlapped display read settles on its committed head only past its budget; default reads retry", async () => {
  const f = await fixture(); await f.advance();
  const reader = new SupervisionStore(f.data, f.home); await reader.read();
  const overlapped = async (options: { settleAfterMs?: number }) => {
    let entered!: () => void, resume!: () => void, paused = true;
    const atAnchor = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
    const original = (reader as any).anchorHash.bind(reader);
    const spy = vi.spyOn(reader as any, "anchorHash").mockImplementation(async (...args: unknown[]) => {
      if (paused) { paused = false; entered(); await gate; } return original(args[0] as number);
    });
    try {
      const reading = reader.read(options); await atAnchor;
      await f.advance(); resume(); return await reading;
    } finally { resume(); spy.mockRestore(); }
  };
  expect(await overlapped({})).toMatchObject({ freshness: "current", sequence: 2 });
  expect(await overlapped({ settleAfterMs: 60_000 })).toMatchObject({ freshness: "current", sequence: 3 });
  expect(await overlapped({ settleAfterMs: 0 })).toMatchObject({ freshness: "current", sequence: 3 }); // Its own validated head.
  expect(await reader.read({ settleAfterMs: 0 })).toMatchObject({ freshness: "current", sequence: 4 });
});
it("concurrent status reads share one validation", async () => {
  const f = await fixture(); await f.advance();
  const reader = new SupervisionStore(f.data, f.home), scan = vi.spyOn(reader as any, "scan");
  const reads = await Promise.all(Array.from({ length: 5 }, () => reader.read()));
  expect(scan).toHaveBeenCalledTimes(1); expect(reads.every(r => r.freshness === "current" && r.sequence === 1)).toBe(true);
  reads[0]!.scopes.length = 0; expect(reads[1]!.scopes).toHaveLength(1); // Each caller owns its copy.
});
it.each(["checkpoint:written", "checkpoint:synced", "checkpoint:replaced"])("interruption at %s preserves the request and recovers only the index", async point => {
  const f = await fixture(); f.fault(point);
  const mutation = [{ kind: "scope" as const, value: scope(f.store.homeId) }], request = randomUUID();
  await expect(f.store.transact(expected(mutation), request, mutation)).rejects.toMatchObject({ code: "HELD" });
  expect((await f.store.read()).freshness).toBe(point === "checkpoint:replaced" ? "current" : "held");
  await f.store.recoverIndex();
  expect(await f.store.transact(expected(mutation), request, mutation)).toMatchObject({ requestId: request, sequence: 1 });
  expect((await f.store.read()).scopes).toHaveLength(1);
});
it("the history ceiling holds admissions without deleting or resetting history", async () => {
  const f = await fixture(); for (let n = 0; n < SUPERVISION_INDEX_LIMITS.transactions; n++) await f.advance();
  const before = await f.store.read(); await expect(f.advance()).rejects.toMatchObject({ code: "HELD" }); expect(await f.store.read()).toEqual(before);
}, 30000);
