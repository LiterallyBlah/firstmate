import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { s04Fixture } from "../test/supervision-s04-fixture";
import { MigrationSnapshots } from "./migration-snapshot";
import { pluginDir } from "./data-dir";
import { digest } from "./submissions";
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
it("A8/A12: compatible snapshots retain exact watch generations, queues and original inspector spend without rewriting source", async () => {
  const f = await s04Fixture(), legacy = join(f.home, "legacy"), approved = join(process.env.PASEO_HOME!, randomUUID());
  await mkdir(legacy); await mkdir(approved); await mkdir(join(pluginDir(), "watch-inspections"), { recursive: true });
  const records = { "watch-config.json": '{"version":1,"assignments":{"checks":{"generation":3,"stage":"paused"}}}\r\n',
    "watches.json": '{"queue":[{"id":"old","delivery":{"state":"uncertain"}}]}\r\n',
    "watch-inspections/inspection-runs.json": '{"version":1,"runs":[{"runId":"historical","status":"failed","operations":[{"state":"uncertain"}]}]}\r\n' };
  for (const [name, bytes] of Object.entries(records)) await writeFile(join(pluginDir(), name), bytes);
  const service = new MigrationSnapshots(approved, "Retain exact history"), migrationId = randomUUID();
  const before = await f.store.read(), ref = await service.capture(f.store, legacy, f.home, migrationId, "compatibility");
  for (const [name, bytes] of Object.entries(records)) {
    expect(await readFile(join(pluginDir(), name), "utf8")).toBe(bytes);
    expect(await readFile(join(ref.path, "supervisors", name.split("/").at(-1)!), "utf8")).toBe(bytes);
  }
  expect(JSON.parse(await readFile(join(ref.path, "manifest.json"), "utf8")).format).toBe("firstmate.migration-snapshot/1");
  expect((await f.store.read()).hash).toBe(before.hash);
  await writeFile(join(ref.path, "supervisors", "inspection-runs.json"), "{}");
  await expect(service.verify(ref, { homeId: f.store.homeId, migrationId, planId: "compatibility" })).rejects.toThrow(/changed/);
});
it("A12: a historical /1 manifest without Supervisor adjuncts remains readable without a rewrite or invented receipt", async () => {
  const f = await s04Fixture(), legacy = join(f.home, "legacy"), approved = join(process.env.PASEO_HOME!, randomUUID());
  await mkdir(legacy); await mkdir(approved);
  const service = new MigrationSnapshots(approved, "Retain historical evidence"), migrationId = randomUUID();
  const ref = await service.capture(f.store, legacy, f.home, migrationId, "historical");
  const path = join(ref.path, "manifest.json"), { hash: _hash, ...body } = JSON.parse(await readFile(path, "utf8"));
  body.files = body.files.filter((f: { name: string }) => !f.name.startsWith("supervisors/"));
  const original = JSON.stringify({ ...body, hash: digest(body) }); await writeFile(path, original);
  const before = await f.store.read();
  const found = await service.find({ homeId: f.store.homeId, migrationId, planId: "historical" });
  expect(found.sequence).toBe(ref.sequence); expect(found.hash).toBe(ref.hash);
  expect(await readFile(path, "utf8")).toBe(original); expect((await f.store.read()).hash).toBe(before.hash);
});
