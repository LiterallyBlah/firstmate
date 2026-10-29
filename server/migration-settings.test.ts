import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MigrationSettings } from "./migration-settings";
import { workflowHomeIdentity } from "./workflow-ownership";
const fixture = async () => {
  const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(root, "home"), destination = join(root, "independent-backups");
  await mkdir(home, { recursive: true }); await mkdir(destination);
  const store = new MigrationSettings(join(root, "plugin"));
  const input = { homeId: workflowHomeIdentity(home), expectedRevision: 0, requestId: randomUUID(), backup: { destination, retention: "Keep for 30 days; retain manually until handover is verified." } };
  return { root, home, destination, store, input };
};
it("reads are inert; exact saved settings survive reload without enabling or creating work", async () => {
  const f = await fixture();
  expect(await f.store.read(f.home)).toMatchObject({ revision: 0, source: "default", backup: null });
  await expect(readdir(join(f.root, "plugin"))).rejects.toMatchObject({ code: "ENOENT" });
  const saved = await f.store.set(f.home, f.input);
  expect(saved).toMatchObject({ revision: 1, source: "saved", requestId: f.input.requestId, backup: f.input.backup, problems: [] });
  const reload = new MigrationSettings(join(f.root, "plugin"));
  expect(await reload.read(f.home)).toEqual(saved);
  expect(await reload.set(f.home, f.input)).toEqual(saved);
  expect(await readdir(join(f.root, "plugin"))).toEqual(["migration-settings"]);
});
it("two clients CAS; changed request reuse and cross-home saves refuse; legacy stays home-bound", async () => {
  const f = await fixture(), second = new MigrationSettings(join(f.root, "plugin"));
  const results = await Promise.allSettled([f.store.set(f.home, f.input), second.set(f.home, { ...f.input, requestId: randomUUID() })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  await expect(f.store.set(f.home, { ...f.input, backup: { ...f.input.backup, retention: "changed" } })).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(f.store.set(join(f.root, "other"), f.input)).rejects.toMatchObject({ code: "STALE" });
  const legacy = new MigrationSettings(join(f.root, "legacy-plugin"), { homeId: f.input.homeId, ...f.input.backup });
  expect(await legacy.read(f.home)).toMatchObject({ source: "legacy-environment", backup: f.input.backup });
  expect(await legacy.read(join(f.root, "other"))).toMatchObject({ source: "default", backup: null });
});
it("invalid and aliased home locations/retention are held before save; damaged records never reset", async () => {
  const f = await fixture();
  for (const destination of ["relative", join(f.root, "missing"), f.home, f.root]) {
    await expect(f.store.set(f.home, { ...f.input, backup: { ...f.input.backup, destination } })).rejects.toThrow();
  }
  await expect(f.store.set(f.home, { ...f.input, backup: { ...f.input.backup, retention: " " } })).rejects.toThrow();
  const alias = join(f.root, "alias"); await symlink(f.home, alias, process.platform === "win32" ? "junction" : "dir");
  await expect(f.store.set(f.home, { ...f.input, backup: { ...f.input.backup, destination: alias } })).rejects.toThrow("separate backup");
  await f.store.set(f.home, f.input);
  const file = join(f.store.directory(f.home), (await readdir(f.store.directory(f.home)))[0]!);
  const row = JSON.parse(await readFile(file, "utf8")); row.request.backup.retention = "changed";
  await writeFile(file, JSON.stringify(row));
  await expect(f.store.read(f.home)).rejects.toMatchObject({ code: "HELD" });
  await expect(f.store.set(f.home, { ...f.input, requestId: randomUUID(), expectedRevision: 1 })).rejects.toMatchObject({ code: "HELD" });
});
