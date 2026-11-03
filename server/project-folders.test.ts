import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ProjectRuntime } from "./project-runtime";
import { ProjectFolderService } from "./project-folders";
import { projectRuntimeFixture } from "../test/project-runtime-fixture";
import { SyntheticReceiver } from "../test/synthetic-receiver";
import { updateFirstmateConfig } from "./config";
import { ProjectFolderSchema } from "../shared/project-folders";
import { digest } from "./submissions";
const root = process.env.PASEO_HOME!;
let home: string, data: string, runtime: ReturnType<typeof projectRuntimeFixture>, projects: ProjectRuntime, service: ProjectFolderService, receiver: SyntheticReceiver;
beforeEach(async () => {
  process.env.PASEO_HOME = join(root, randomUUID()); home = join(process.env.PASEO_HOME, "home"); data = join(process.env.PASEO_HOME, "data");
  await mkdir(join(home, "data"), { recursive: true }); await mkdir(join(home, "alpha")); await mkdir(join(home, "extra"));
  await writeFile(join(home, "data/projects.md"), `- alpha - ${join(home, "alpha")}\n`);
  await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null }); await updateFirstmateConfig({ mateAgentId: "general" });
  receiver = new SyntheticReceiver(); receiver.supervisorRoot = data; runtime = projectRuntimeFixture(data);
  projects = new ProjectRuntime(runtime, { enabled: true, receiver: () => receiver, legacy: async () => ({ plans: [], problems: [] }) });
  service = new ProjectFolderService(projects, { folder: async () => join(home, "extra") });
});
afterEach(async () => { await runtime.stop(); });
/** The checked row identity the folder RPC binds a replacement to. */
const replacement = (name: string, location: string) => ({ location, rowDigest: digest({ name, location }) });

it("Add project performs checked registration only; duplicate paths, stale registry and cancellation refuse safely", async () => {
  let snapshot = await projects.read(); await service.folder({ homeId: snapshot.homeId, registryDigest: snapshot.registryDigest!, name: "extra" });
  snapshot = await projects.read(); expect(snapshot.projects).toHaveLength(2); expect(receiver.calls).toEqual([]); expect((await runtime.read(home)).freshness).toBe("uninitialized");
  await expect(service.folder({ homeId: snapshot.homeId, registryDigest: snapshot.registryDigest!, name: "duplicate" })).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(service.folder({ homeId: snapshot.homeId, registryDigest: "0".repeat(64), name: "new" })).rejects.toMatchObject({ code: "STALE" });
  const canceled = new ProjectFolderService(projects, { folder: async () => null });
  expect((await canceled.folder({ homeId: snapshot.homeId, registryDigest: snapshot.registryDigest!, name: "cancel" })).projects).toHaveLength(2);
});
it.each(["café", "設計", "project+notes", "x".repeat(120)])("retains the new-name policy for adding %s without a replacement", async name => {
  const snapshot = await projects.read(), before = await readFile(join(home, "data/projects.md"), "utf8");
  await expect(service.folder({ homeId: snapshot.homeId, registryDigest: snapshot.registryDigest!, name })).rejects.toThrow();
  expect(await readFile(join(home, "data/projects.md"), "utf8")).toBe(before);
  expect(receiver.calls).toEqual([]); expect((await runtime.read(home)).freshness).toBe("uninitialized");
});
it.each(["alpha", "café", "設計", "project+notes", "x".repeat(120)])("corrects the existing %s registry folder without creating work", async name => {
  const missing = join(home, "missing");
  await writeFile(join(home, "data/projects.md"), `# Projects\n- ${name} [worktree +yolo] - ${missing} - Keep this description\n`);
  const snapshot = await projects.read();
  const fixed = await service.folder(ProjectFolderSchema.parse({ homeId: snapshot.homeId, registryDigest: snapshot.registryDigest!, name, replace: replacement(name, missing) }));
  expect(fixed.projects).toHaveLength(1); expect(fixed.projects[0]).toMatchObject({ name }); expect(fixed.projects[0]?.directory).toBeTruthy();
  expect(await readFile(join(home, "data/projects.md"), "utf8")).toBe(`# Projects\n- ${name} [worktree +yolo] - ${await realpath(join(home, "extra"))} - Keep this description\n`);
  expect(receiver.calls).toEqual([]); expect((await runtime.read(home)).freshness).toBe("uninitialized");
});
it.each(["fingerprint", "registry", "duplicate", "restored"] as const)("missing folder correction refuses %s changes without writing the registry or creating work", async kind => {
  const missing = join(home, "missing");
  await writeFile(join(home, "data/projects.md"), `- alpha - ${missing}\n${kind === "duplicate" ? `- other - ${join(home, "extra")}\n` : ""}`);
  const snapshot = await projects.read(), row = replacement("alpha", missing);
  const input = { homeId: snapshot.homeId, registryDigest: snapshot.registryDigest!, name: "alpha", replace: { ...row, rowDigest: kind === "fingerprint" ? "f".repeat(64) : row.rowDigest } };
  service = new ProjectFolderService(projects, { folder: async () => {
    if (kind === "registry") await writeFile(join(home, "data/projects.md"), `- renamed - ${missing}\n`);
    if (kind === "restored") await mkdir(missing);
    return join(home, "extra");
  } });
  await expect(service.folder(input)).rejects.toMatchObject({ code: kind === "registry" ? "STALE" : kind === "duplicate" ? "CONFLICT" : "HELD" });
  expect(await readFile(join(home, "data/projects.md"), "utf8")).not.toContain(`- alpha - ${join(home, "extra")}`);
  expect(receiver.calls).toEqual([]); expect((await runtime.read(home)).freshness).toBe("uninitialized");
});
it("refuses a home switch without writing", async () => {
  const snapshot = await projects.read(), before = await readFile(join(home, "data/projects.md"), "utf8");
  await expect(service.folder({ homeId: join(home, "elsewhere"), registryDigest: snapshot.registryDigest!, name: "extra" })).rejects.toMatchObject({ code: "STALE" });
  expect(await readFile(join(home, "data/projects.md"), "utf8")).toBe(before); expect(receiver.calls).toEqual([]);
});
it("an admitted project's missing folder keeps its identity: replacement is refused without creating work", async () => {
  const orders = "Reviewed project allocation and Supervisor profile.\n", sha = (v: string) => createHash("sha256").update(v).digest("hex");
  await writeFile(join(home, "data/orders.md"), orders);
  const read = await projects.read();
  await projects.admin({ homeId: read.homeId, requestId: randomUUID(), actorId: "general", command: { op: "admit", name: "alpha", aliases: [], registryDigest: read.registryDigest!,
    source: { id: randomUUID(), version: 1, path: "data/orders.md", lineStart: 1, lineEnd: 1, fileHash: sha(orders), excerptHash: sha(orders.trim()),
      provenance: { kind: "mate-chat", id: "general", source: "project administration (same-user role convention, unverified)" }, supersedes: [] },
    profile: { provider: "codex/test", modeId: "full-access" }, budget: { agents: 2, turns: 4 }, limits: { supervisorSessions: 1, supervisorTurns: 3 } } });
  await rename(join(home, "alpha"), join(home, "moved"));
  const snapshot = await projects.read(), before = receiver.calls.length;
  await expect(service.folder({ homeId: snapshot.homeId, registryDigest: snapshot.registryDigest!, name: "alpha", replace: replacement("alpha", join(home, "alpha")) }))
    .rejects.toMatchObject({ code: "HELD" });
  expect(await readFile(join(home, "data/projects.md"), "utf8")).toBe(`- alpha - ${join(home, "alpha")}\n`); expect(receiver.calls).toHaveLength(before);
});
