import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { SupervisionStatusReader } from "./supervision-status-reader";
import { SupervisionStore } from "./supervision-store";
import { expected, scope } from "../test/supervision-fixture";
import { s04Fixture } from "../test/supervision-s04-fixture";
let bounds: { sourceHead: string | undefined; history: number; warmReadMs: number[]; fullScans: number;
  historicalReducerCalls: number; newTransitionCalls: number; commitMs: number; committedBeforePollRelease: boolean } | null = null;
afterAll(async () => {
  if (process.env.FIRSTMATE_PILOT_EVIDENCE !== "1" || !bounds) return;
  await mkdir(".local/s06", { recursive: true });
  await writeFile(".local/s06/status-reader-bound-evidence.json", JSON.stringify(bounds, null, 2) + "\n");
});

it("production status reader reuses one validated store per home at 176 transactions", async () => {
  const f = await s04Fixture(), stores: SupervisionStore[] = [];
  let version = 0;
  for (let n = 0; n < 176; n++) {
    const mutation = [{ kind: "scope" as const, value: { ...scope(f.store.homeId), version: version + 1 } }];
    await f.store.transact(expected(mutation, version), randomUUID(), mutation); version++;
  }
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
  bounds = { sourceHead: process.env.FIRSTMATE_PILOT_SOURCE_HEAD, history: 176, warmReadMs,
    fullScans: scan.mock.calls.length, historicalReducerCalls, newTransitionCalls: apply.mock.calls.length,
    commitMs, committedBeforePollRelease: true };
}, 20000);
