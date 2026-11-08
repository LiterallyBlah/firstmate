import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { canonical, digest } from "./submissions";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { SupervisionRuntime } from "./supervision-runtime";
import { PlanRuntime } from "./plan-runtime";
import { FirstmateConfigSchema } from "../shared/fleet";
import { expected, scope } from "../test/supervision-fixture";

// Reproduces the live hold of 2026-11-07: the final transaction's event and tip were published,
// its publication was written and synced to a `.tmp` but never linked into place.
const PENDING = "Final transaction awaits publication.";
const processIdentity = async () => ({ state: "alive" as const, start: "isolated-fixture-process" });
let dataRoot: string, home: string, runtime: SupervisionRuntime, crash: string | null;
beforeEach(() => {
  const base = join(process.env.PASEO_HOME!, randomUUID());
  dataRoot = join(base, "data"); home = join(base, "home"); crash = null;
  runtime = new SupervisionRuntime(dataRoot, (root, h) => new SupervisionStore(root, h, { writable: true, processIdentity,
    actor: { kind: "system", id: "scoped-runtime", source: "owned-plugin-runtime" },
    boundary: async name => { if (name === crash) throw new Error(`simulated loss at ${name}`); } }));
});
afterEach(async () => { await runtime.stop(); vi.restoreAllMocks(); });

async function heldJournal() {
  const first: SupervisionMutation[] = [{ kind: "scope", value: scope("placeholder") }];
  await runtime.mutate(home, async store => {
    first[0] = { kind: "scope", value: scope(store.homeId) };
    await store.transact(expected(first), randomUUID(), first);
    crash = "publication:synced";
    const next: SupervisionMutation[] = [{ kind: "scope", value: { ...scope(store.homeId), version: 2 } }];
    await expect(store.transact(expected(first, 1), randomUUID(), next)).rejects.toMatchObject({ code: "HELD" });
    crash = null;
  });
  const store = runtime.readStore(home), names = await readdir(join(store.root, "transactions"));
  expect(names.filter(n => n.startsWith("000000000002."))).toEqual(expect.arrayContaining(["000000000002.event.json", "000000000002.tip.json"]));
  expect(names.some(n => /^000000000002\.publication\.json\..+\.tmp$/.test(n))).toBe(true);
  expect(names).not.toContain("000000000002.publication.json");
}

it("a held pending publication is validated once, not replayed in full on every read", async () => {
  await heldJournal();
  const reader = new SupervisionStore(dataRoot, home);
  const scanFull = vi.spyOn(reader as unknown as { scanFull: () => Promise<unknown> }, "scanFull");
  for (let n = 0; n < 5; n++) {
    const status = await reader.read();
    expect(status.freshness).toBe("held"); expect(status.problems).toEqual([PENDING]); expect(status.sequence).toBe(1);
  }
  expect(scanFull, "every held read replayed the whole journal").toHaveBeenCalledTimes(1);
});

it("the runtime finishes the exact pending publication through recoverPublication, once", async () => {
  await heldJournal();
  // An independent warm reader (another instance) remembers the hold, and must see the recovery.
  const reader = new SupervisionStore(dataRoot, home); expect((await reader.read()).problems).toEqual([PENDING]);
  const recover = vi.spyOn(SupervisionStore.prototype, "recoverPublication");
  expect((await runtime.read(home)).problems).toEqual([PENDING]);
  expect(await runtime.recoverPendingPublication(home)).toBe(true);
  expect(recover).toHaveBeenCalledOnce();
  const status = await runtime.read(home);
  expect(status.freshness).toBe("current"); expect(status.sequence).toBe(2); expect(status.problems).toEqual([]);
  // A fresh process's reader sees the same recovered head; nothing else was invented.
  const fresh = await new SupervisionStore(dataRoot, home).read();
  expect(fresh).toMatchObject({ freshness: "current", sequence: 2, hash: status.hash });
  expect(await reader.read()).toMatchObject({ freshness: "current", sequence: 2, hash: status.hash });
  expect(await runtime.recoverPendingPublication(home)).toBe(false); expect(recover).toHaveBeenCalledOnce();
});

it("after a restart (the interrupted writer's process gone), the first clock tick recovers the hold", async () => {
  await heldJournal(); await runtime.stop();
  // A new process: same pid in this fixture, but a different start, so the old claim is dead.
  const restarted = new SupervisionRuntime(dataRoot, (root, h) => new SupervisionStore(root, h, { writable: true,
    processIdentity: async () => ({ state: "alive" as const, start: "restarted-process" }),
    actor: { kind: "system", id: "scoped-runtime", source: "owned-plugin-runtime" } }));
  runtime = restarted;
  const plans = new PlanRuntime(restarted, { enabled: true, config: async () => FirstmateConfigSchema.parse({ home, mateAgentId: "general" }) });
  expect((await restarted.read(home)).problems).toEqual([PENDING]);
  await plans.tick();
  expect(await restarted.read(home)).toMatchObject({ freshness: "current", sequence: 2, problems: [] });
  expect(await new SupervisionStore(dataRoot, home).read()).toMatchObject({ freshness: "current", sequence: 2 });
});

it("the workflow clock's plan tick recovers the hold with no Attach or admission", async () => {
  await heldJournal();
  const plans = new PlanRuntime(runtime, { enabled: true, config: async () => FirstmateConfigSchema.parse({ home, mateAgentId: "general" }) });
  await plans.tick();
  expect(await runtime.read(home)).toMatchObject({ freshness: "current", sequence: 2, problems: [] });
});

it("a refused recovery keeps the hold, is reported once and is not retried every tick", async () => {
  await heldJournal();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const recover = vi.spyOn(SupervisionStore.prototype, "recoverPublication").mockRejectedValue(Object.assign(new Error("audit refused"), { code: "HELD" }));
  for (let n = 0; n < 5; n++) expect(await runtime.recoverPendingPublication(home)).toBe(false);
  expect(recover).toHaveBeenCalledOnce();
  expect(error.mock.calls.filter(call => String(call[0]).includes("pending journal publication"))).toHaveLength(1);
  expect((await runtime.read(home)).problems).toEqual([PENDING]);
});

it("does nothing for a current journal or for any other hold", async () => {
  await runtime.mutate(home, async store => {
    const first: SupervisionMutation[] = [{ kind: "scope", value: scope(store.homeId) }];
    await store.transact(expected(first), randomUUID(), first);
  });
  const recover = vi.spyOn(SupervisionStore.prototype, "recoverPublication");
  expect(await runtime.recoverPendingPublication(home)).toBe(false);
  expect(recover).not.toHaveBeenCalled();
});

// The live home of 2026-11-08 also kept its one-time anchor-migration receipt and /1 backup
// (the 7-day rollback window). With a receipt present, writer creation treated the pending
// publication as an unfinished anchor migration and refused, so recoverPublication never ran.
async function migratedHeldJournal() {
  const legacy = new SupervisionStore(dataRoot, home, { writable: true, legacyFormat: true, processIdentity });
  await legacy.initialize(); await legacy.acquireCoordinator();
  const versions = (n: number): SupervisionMutation[] => [{ kind: "scope", value: { ...scope(legacy.homeId), version: n } }];
  for (let n = 0; n < 4; n++) await legacy.transact(expected(versions(n + 1), n), randomUUID(), versions(n + 1));
  await legacy.releaseCoordinator();
  // The runtime's first writer runs the one-time /1 -> /2 anchor migration (receipt + backup),
  // then a transaction is interrupted after its publication's .tmp was synced.
  await runtime.mutate(home, async store => {
    await store.transact(expected(versions(5), 4), randomUUID(), versions(5));
    crash = "publication:synced";
    await expect(store.transact(expected(versions(6), 5), randomUUID(), versions(6))).rejects.toMatchObject({ code: "HELD" });
    crash = null;
  });
  const root = runtime.readStore(home).root, names = await readdir(root), tx = await readdir(join(root, "transactions"));
  expect(names).toEqual(expect.arrayContaining(["anchor-migration.json", "anchor-backup"]));
  expect(tx.some(n => /^000000000006\.publication\.json\..+\.tmp$/.test(n))).toBe(true);
  expect(tx).not.toContain("000000000006.publication.json");
  await runtime.stop();
  return root;
}
function restartedRuntime(start = "restarted-process") {
  return new SupervisionRuntime(dataRoot, (root, h) => new SupervisionStore(root, h, { writable: true,
    processIdentity: async () => ({ state: "alive" as const, start }),
    actor: { kind: "system", id: "scoped-runtime", source: "owned-plugin-runtime" } }));
}

it("recovers a pending publication while the anchor-migration receipt and backup are retained", async () => {
  const root = await migratedHeldJournal();
  runtime = restartedRuntime();
  expect(await runtime.read(home)).toMatchObject({ freshness: "held", problems: [PENDING], sequence: 5 });
  const recover = vi.spyOn(SupervisionStore.prototype, "recoverPublication");
  const error = vi.spyOn(console, "error");
  expect(await runtime.recoverPendingPublication(home)).toBe(true);
  expect(recover).toHaveBeenCalledOnce();
  expect(error.mock.calls.filter(call => String(call[0]).includes("pending journal publication"))).toHaveLength(0);
  const status = await runtime.read(home);
  expect(status).toMatchObject({ freshness: "current", sequence: 6, problems: [] });
  expect(await new SupervisionStore(dataRoot, home).read()).toMatchObject({ freshness: "current", sequence: 6, hash: status.hash });
  // The rollback window is untouched by recovery: receipt and backup stay until expiry.
  expect(await readdir(root)).toEqual(expect.arrayContaining(["anchor-migration.json", "anchor-backup"]));
  await runtime.stop();
  // ...and the receipt's clean-audit expiry works normally on the next writer once it is due.
  const receiptPath = join(root, "anchor-migration.json"), receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.createdAt = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  const { hash: _hash, ...unsigned } = receipt; receipt.hash = digest(unsigned);
  await writeFile(receiptPath, `${canonical(receipt)}\n`);
  runtime = restartedRuntime("expiry-process");
  await runtime.mutate(home, async () => {});
  expect(await readdir(root)).not.toContain("anchor-backup");
  expect(await readdir(root)).not.toContain("anchor-migration.json");
  expect(await runtime.read(home)).toMatchObject({ freshness: "current", sequence: 6 });
}, 120_000);

it("an aged receipt does not expire while the publication is pending, and recovery still runs", async () => {
  const root = await migratedHeldJournal();
  const receiptPath = join(root, "anchor-migration.json"), receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.createdAt = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  const { hash: _hash, ...unsigned } = receipt; receipt.hash = digest(unsigned);
  await writeFile(receiptPath, `${canonical(receipt)}\n`);
  runtime = restartedRuntime();
  expect(await runtime.recoverPendingPublication(home)).toBe(true);
  expect(await runtime.read(home)).toMatchObject({ freshness: "current", sequence: 6, problems: [] });
  // The expiry audit ran under the pending hold, so it kept the backup (it needs a clean audit).
  expect(await readdir(root)).toEqual(expect.arrayContaining(["anchor-migration.json", "anchor-backup"]));
}, 120_000);

it("a receipt that no longer binds its head still holds writer creation", async () => {
  const root = await migratedHeldJournal();
  const receiptPath = join(root, "anchor-migration.json"), receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.headHash = digest("another-head");
  const { hash: _hash, ...unsigned } = receipt; receipt.hash = digest(unsigned);
  await writeFile(receiptPath, `${canonical(receipt)}\n`);
  runtime = restartedRuntime();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const recover = vi.spyOn(SupervisionStore.prototype, "recoverPublication");
  expect(await runtime.recoverPendingPublication(home)).toBe(false);
  expect(recover).not.toHaveBeenCalled();
  expect((await runtime.read(home)).problems).toEqual([PENDING]);
  expect(await readdir(join(root, "transactions"))).not.toContain("000000000006.publication.json");
}, 120_000);

it("repeated refusals for the same held head back off instead of retrying every five minutes", async () => {
  await heldJournal();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const recover = vi.spyOn(SupervisionStore.prototype, "recoverPublication").mockRejectedValue(Object.assign(new Error("audit refused"), { code: "HELD" }));
  const start = Date.now(); let now = start;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const minute = 60_000, attemptsAt: number[] = [];
  for (let at = 0; at <= 24 * 60; at++) {
    now = start + at * minute;
    const before = recover.mock.calls.length;
    await runtime.recoverPendingPublication(home);
    if (recover.mock.calls.length > before) attemptsAt.push(at);
  }
  // 0, +5, +10, +20, +40, +80, +160, +320, then the six-hour cap.
  expect(attemptsAt).toEqual([0, 5, 15, 35, 75, 155, 315, 635, 995, 1355]);
  expect((await runtime.read(home)).problems).toEqual([PENDING]);
});
