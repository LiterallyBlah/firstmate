import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { SupervisionStore } from "./supervision-store";
import { capacityHeld } from "../shared/supervision-capacity";
import { scope, seed, expected } from "../test/supervision-fixture";
import { pressure, DEFAULT_CAPACITY } from "./supervision-capacity";
import { SupervisionSources } from "./supervision-sources";
import { maintenanceAdmission } from "./supervision-resources";

it("retains global history/replay across three pages, all pilot bands, restart and old-page corruption", async () => {
  const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(root, "home");
  const store = new SupervisionStore(root, home, { writable: true });
  await store.initialize(); await store.acquireCoordinator(); await store.enableLongLived();
  const identities = Array.from({ length: 6 }, () => ({ scopeId: randomUUID(), projectId: randomUUID(), version: 0 })), requests = [];
  for (let n = 1; n <= 520; n++) {
    const owner = identities[(n - 1) % identities.length]!, requestId = randomUUID(), value = { ...scope(store.homeId), kind: "project" as const,
      id: owner.scopeId, projectIds: [owner.projectId], version: ++owner.version };
    requests.push(await store.transact([{ kind: "scope", id: owner.scopeId, version: owner.version - 1 }], requestId, [{ kind: "scope", value }]));
  }
  const before = await store.read();
  expect(before.sequence).toBe(520); expect(before.freshness).toBe("current");
  for (const band of ["sources", "maintenance", "admissions"] as const) expect(capacityHeld(before, band, 128)).toBe(false);
  expect(() => new SupervisionSources(store).budget(before)).not.toThrow(); expect(() => maintenanceAdmission(before)).not.toThrow();
  expect(before.scopes).toHaveLength(6);
  expect(await readdir(join(store.root, "transactions", "000000000001"))).toHaveLength(256 * 3);
  expect(await readdir(join(store.root, "transactions", "000000000002"))).toHaveLength(8 * 3);
  await store.releaseCoordinator();
  const restarted = new SupervisionStore(root, home, { writable: true });
  await restarted.acquireCoordinator();
  expect((await restarted.read()).sequence).toBe(520);
  expect(await restarted.requestReceipt(requests[0]!.requestId)).toEqual(requests[0]);
  const page = await restarted.historyPage({ after: 250, limit: 20, hash: before.hash });
  expect(page.events.map(e => e.sequence)).toEqual(Array.from({ length: 20 }, (_, i) => i + 251));
  expect(page.next).toBe(270);
  await expect(restarted.historyPage({ after: 0, limit: 101 })).rejects.toMatchObject({ code: "CONFLICT" });
  const event = join(store.root, "transactions", "000000000001.event.json"), bytes = await readFile(event);
  await writeFile(event, "{damaged"); expect((await restarted.audit()).freshness).toBe("held");
  await writeFile(event, bytes); await restarted.releaseCoordinator();
}, 120000);

it("pressure bands reserve obligations and stop admissions before reconciliation capacity", () => {
  const capacity = { ...DEFAULT_CAPACITY, format: "firstmate.supervision-capacity/1" as const, homeId: "fixture", baseSequence: 0, baseHash: null, hash: "a".repeat(64) };
  expect(pressure(capacity, capacity.journalBytes - capacity.reserveBytes * 3, 0, 0).held).toEqual(["sources"]);
  expect(pressure(capacity, capacity.journalBytes - capacity.reserveBytes * 2, 0, 0).held).toEqual(["sources", "maintenance"]);
  expect(pressure(capacity, capacity.journalBytes - capacity.reserveBytes, 0, 0).held).toEqual(["sources", "maintenance", "admissions"]);
  expect(pressure(capacity, 0, capacity.projectionBytes * .9, 0).held).toEqual(["sources", "maintenance", "admissions"]);
  expect(pressure(capacity, 0, 0, 7).reserveBytes).toBe(capacity.reserveBytes + 7 * 65536);
});

it("real byte pressure holds new effects while leaving journal room for reconciliation", async () => {
  const root = join(process.env.PASEO_HOME!, randomUUID()), store = new SupervisionStore(root, join(root, "home"), { writable: true });
  await store.initialize(); await store.acquireCoordinator();
  await store.enableLongLived({ ...DEFAULT_CAPACITY, journalBytes: 1024 * 1024, projectionBytes: 16 * 1024 * 1024, reserveBytes: 65536 });
  await store.putBlob(Buffer.alloc(512 * 1024, 1)); await store.putBlob(Buffer.alloc(420 * 1024, 2));
  let status = await store.read(); expect(status.storage.capacity?.held).toEqual(["sources", "maintenance"]);
  for (let n = 0; n < 80 && !status.storage.admissionsHeld; n++) {
    await store.transactCommand(randomUUID(), "a".repeat(64), { kind: "system", id: "reconciliation", source: "fixture" },
      async () => ({ expectedVersions: [], mutations: [], result: { planId: null, planHash: null, decisionId: null, outboxId: null } }));
    status = await store.read();
  }
  expect(status.storage.admissionsHeld).toBe(true); expect(status.storage.bytes).toBeLessThan(status.storage.limitBytes);
  const mutations = seed(store.homeId);
  await expect(store.transact(expected(mutations), randomUUID(), mutations)).rejects.toMatchObject({ code: "HELD" });
  const prior = status.sequence;
  await store.transactCommand(randomUUID(), "b".repeat(64), { kind: "system", id: "settlement", source: "fixture" },
    async () => ({ expectedVersions: [], mutations: [], result: { planId: null, planHash: null, decisionId: null, outboxId: null } }));
  expect((await store.read()).sequence).toBe(prior + 1); await store.releaseCoordinator();
});
