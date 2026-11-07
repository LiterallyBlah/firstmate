import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
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
