import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { SupervisionStatusReader } from "./supervision-status-reader";
import { SupervisionStore } from "./supervision-store";
import { expected, scope } from "../test/supervision-fixture";
import { s04Fixture } from "../test/supervision-s04-fixture";
let bounds: { sourceHead: string | undefined; history: number; historySeedMs: number; warmReadMs: number[]; fullScans: number;
  historicalReducerCalls: number; newTransitionCalls: number; commitMs: number; committedBeforePollRelease: boolean } | null = null;
let warm: { history: number; firstPollAfterLaunchMs: number; pollsDuringLaunch: number; maxPollDuringLaunchMs: number; fullScans: number } | null = null;
afterAll(async () => {
  if (process.env.FIRSTMATE_PILOT_EVIDENCE !== "1" || !bounds) return;
  await mkdir(".local/s06", { recursive: true });
  await writeFile(".local/s06/status-reader-bound-evidence.json", JSON.stringify({ ...bounds, launchesBetweenPolls: warm }, null, 2) + "\n");
});

it("production status reader stays warm across real launches (blob writes) at about 176 transactions", async () => {
  const f = await s04Fixture({ limits: { supervisorSessions: 99, supervisorTurns: 999 } });
  const plan = async (n: number) => {
    const handle = await f.addScope(n, `warm-${n}`, [`w${n}-a`, `w${n}-b`]);
    await f.draft(handle, [{ id: `w${n}-a`, kind: "ship" }, { id: `w${n}-b`, after: [{ node: `w${n}-a`, on: "done" }] }], true);
    return handle;
  };
  await f.launch(await plan(1), "w1-a");
  let version = 0;
  while ((await f.store.read()).sequence < 154) {
    const mutation = [{ kind: "scope" as const, value: { ...scope(f.store.homeId), version: version + 1 } }];
    await f.store.transact(expected(mutation, version), randomUUID(), mutation); version++;
  }
  let store!: SupervisionStore;
  const reader = new SupervisionStatusReader(join(f.home, "store"), (root, home) => (store = new SupervisionStore(root, home)));
  expect((await reader.read(f.home)).freshness).toBe("current");
  const full = vi.spyOn(store as any, "scanFull");
  const blobsDirectory = async () => (await stat(join(store.root, "blobs"), { bigint: true })).mtimeNs;
  const second = await plan(2), before = await blobsDirectory();
  await f.launch(second, "w2-a");
  expect(await blobsDirectory()).not.toBe(before); // The launch published (deduplicated) brief evidence.
  let start = performance.now();
  const afterLaunch = await reader.read(f.home), firstPollMs = performance.now() - start;
  expect(afterLaunch).toMatchObject({ freshness: "current", sequence: (await f.store.read()).sequence });
  expect(full).not.toHaveBeenCalled(); expect(firstPollMs).toBeLessThan(2000);

  // Poll continuously (three overlapping callers, with the display routes' settle budget) during a launch.
  const third = await plan(3), polls: { ms: number; sequence: number; freshness: string }[] = [];
  let polling = true;
  const poller = async () => { while (polling) {
    const t = performance.now(), r = await reader.read(f.home, { settleAfterMs: 750 });
    polls.push({ ms: performance.now() - t, sequence: r.sequence, freshness: r.freshness });
    await new Promise(resolve => setTimeout(resolve, 0));
  } };
  const loops = [poller(), poller(), poller()];
  await f.store.putBlob(Buffer.from(`new evidence ${randomUUID()}`)); // And a newly named blob.
  await f.launch(third, "w3-a"); polling = false; await Promise.all(loops);
  const writer = await f.store.read(), quiescent = await reader.read(f.home);
  expect(writer.sequence).toBeGreaterThanOrEqual(176);
  expect(quiescent).toMatchObject({ freshness: "current", sequence: writer.sequence, hash: writer.hash });
  expect(full).not.toHaveBeenCalled();
  expect(polls.length).toBeGreaterThan(0); expect(polls.every(p => p.freshness === "current")).toBe(true);
  expect(Math.max(...polls.map(p => p.ms))).toBeLessThan(2000);
  warm = { history: writer.sequence, firstPollAfterLaunchMs: firstPollMs, pollsDuringLaunch: polls.length,
    maxPollDuringLaunchMs: Math.max(...polls.map(p => p.ms)), fullScans: full.mock.calls.length };
}, 120000);
// Includes 176 durable setup writes. Match the adjacent index history fixtures' budget on loaded Windows runners;
// zero historical scans/reducers and the explicit three-second writer bound remain the performance checks.
it("production status reader reuses one validated store per home at 176 transactions", async () => {
  const f = await s04Fixture(), stores: SupervisionStore[] = [];
  let version = 0; const seedStart = performance.now();
  for (let n = 0; n < 176; n++) {
    const mutation = [{ kind: "scope" as const, value: { ...scope(f.store.homeId), version: version + 1 } }];
    await f.store.transact(expected(mutation, version), randomUUID(), mutation); version++;
  }
  const historySeedMs = performance.now() - seedStart;
  const reader = new SupervisionStatusReader(join(f.home, "store"), (root, home) => {
    const store = new SupervisionStore(root, home); stores.push(store); return store;
  });
  expect(await reader.read(f.home)).toMatchObject({ freshness: "current", sequence: 176 });
  const scan = vi.spyOn(stores[0] as any, "scanFull"), apply = vi.spyOn(stores[0] as any, "apply");
  const warmReadMs: number[] = [];
  for (let n = 0; n < 5; n++) {
    const start = performance.now();
    expect(await reader.read(f.home)).toMatchObject({ freshness: "current", sequence: 176 });
    warmReadMs.push(performance.now() - start);
  }
  expect(stores).toHaveLength(1); expect(scan).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  const historicalReducerCalls = apply.mock.calls.length;

  // Pause an ordinary warm poll at its anchor read. A writer on the same journal must
  // commit before the poll is released, and the poll must then retry to the new head.
  let entered!: () => void, resume!: () => void;
  const atAnchor = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const originalAnchor = (stores[0] as any).anchorHash.bind(stores[0]);
  vi.spyOn(stores[0] as any, "anchorHash").mockImplementation(async (...args: unknown[]) => {
    entered(); await gate; return originalAnchor(args[0] as number);
  });
  const polling = reader.read(f.home); await atAnchor;
  const mutation = [{ kind: "scope" as const, value: { ...scope(f.store.homeId), version: version + 1 } }];
  const start = performance.now(), writing = f.store.transact(expected(mutation, version), randomUUID(), mutation);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let commitMs = 0;
  try {
    const completedBeforeRelease = await Promise.race([writing.then(() => true), new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), 3000);
    })]);
    expect(completedBeforeRelease).toBe(true);
    commitMs = performance.now() - start;
    expect(commitMs).toBeLessThan(3000);
  } finally { clearTimeout(timer); resume(); await writing; }
  expect(await polling).toMatchObject({ freshness: "current", sequence: 177 });
  expect(scan).not.toHaveBeenCalled();
  expect(apply).toHaveBeenCalledTimes(1); // Only the newly committed tail transition.
  bounds = { sourceHead: process.env.FIRSTMATE_PILOT_SOURCE_HEAD, history: 176, historySeedMs, warmReadMs,
    fullScans: scan.mock.calls.length, historicalReducerCalls, newTransitionCalls: apply.mock.calls.length,
    commitMs, committedBeforePollRelease: true };
}, 60000);
