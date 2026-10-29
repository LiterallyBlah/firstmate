import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { s04Fixture } from "../test/supervision-s04-fixture";
import { MigrationSnapshots } from "./migration-snapshot";
it("retains and verifies independent exact bytes and prefix; edits cannot resume from a changed snapshot", async () => {
  const f = await s04Fixture(), scope = await f.addScope(1, "snapshot", ["build"]); await f.draft(scope, [{ id: "build" }], true);
  const legacy = join(f.home, "legacy"), approved = join(process.env.PASEO_HOME!, randomUUID());
  await mkdir(legacy); await mkdir(approved); await writeFile(join(legacy, "plan.jsonl"), "original bytes\r\n");
  const service = new MigrationSnapshots(approved, "Retain for 30 days under the operator's approved policy"), migrationId = randomUUID();
  const expected = { homeId: f.store.homeId, migrationId, planId: "snapshot" }, before = await f.store.read();
  const ref = await service.capture(f.store, legacy, f.home, migrationId, "snapshot");
  expect(ref.sequence).toBe(before.sequence); expect(ref.hash).toBe(before.hash); expect(await service.find(expected)).toEqual(ref);
  expect(await readFile(join(ref.path, "legacy", "plan.jsonl"), "utf8")).toBe("original bytes\r\n");
  expect(await service.capture(f.store, legacy, f.home, migrationId, "snapshot")).toEqual(ref);
  await writeFile(join(ref.path, "legacy", "plan.jsonl"), "changed\n");
  await expect(service.verify(ref, expected)).rejects.toThrow("changed");
  expect((await f.store.read()).hash).toBe(before.hash);
});
it("refuses local/unknown retention destinations and preserves incomplete captures", async () => {
  const f = await s04Fixture(), legacy = join(f.home, "legacy"); await mkdir(legacy);
  await expect(new MigrationSnapshots(f.home, "approved").capture(f.store, legacy, f.home, randomUUID(), "snapshot")).rejects.toThrow("independent");
  await expect(new MigrationSnapshots("", "").capture(f.store, legacy, f.home, randomUUID(), "snapshot")).rejects.toThrow("approved");
  const root = join(process.env.PASEO_HOME!, randomUUID()), id = randomUUID(); await mkdir(join(root, id), { recursive: true });
  await expect(new MigrationSnapshots(root, "approved").capture(f.store, legacy, f.home, id, "snapshot")).rejects.toThrow("incomplete snapshot");
});
