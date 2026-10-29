import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectRuntime } from "./project-runtime";
import { ProjectSetupService } from "./project-setup";
import { projectRuntimeFixture } from "../test/project-runtime-fixture";
import { SyntheticReceiver } from "../test/synthetic-receiver";
import { updateFirstmateConfig } from "./config";
import type { PaseoApi } from "./host-types";
import type { ProjectSetupChoices } from "../shared/project-setup";
import { ProjectSetupInputSchema } from "../shared/supervision-policy";
import { stableId } from "./supervision-effects";
import { FeaturePolicyRuntime } from "./feature-policy-runtime";
import { FEATURES_OFF } from "../shared/feature-settings";
const root = process.env.PASEO_HOME!, api = {} as PaseoApi;
let home: string, data: string, runtime: ReturnType<typeof projectRuntimeFixture>, projects: ProjectRuntime, service: ProjectSetupService,
  receiver: SyntheticReceiver, models: { provider: string; label: string; modes: { id: string; label: string }[]; thinking: { id: string; label: string }[] }[];
const profile = { provider: "codex/test", modeId: "full-access" };
function make() {
  projects = new ProjectRuntime(runtime, { enabled: true, receiver: () => receiver, legacy: async () => ({ plans: [], problems: [] }) });
  service = new ProjectSetupService(projects, { models: async () => structuredClone(models), folder: async () => join(home, "extra") });
}
async function choices(): Promise<ProjectSetupChoices> { return { homeId: (await projects.read()).homeId, name: "alpha", profile, sourcePath: "data/orders.md",
  budget: { agents: 3, turns: 9 }, limits: { supervisorSessions: 1, supervisorTurns: 5 } }; }
async function review() {
  const p = await service.preview(await choices(), api);
  expect(p.reasons).toEqual([]); expect(p.review).not.toBeNull();
  return ProjectSetupInputSchema.parse({ homeId: p.choices.homeId, requestId: randomUUID(), review: p.review, reviewDigest: p.reviewDigest });
}
beforeEach(async () => {
  process.env.PASEO_HOME = join(root, randomUUID()); home = join(process.env.PASEO_HOME, "home"); data = join(process.env.PASEO_HOME, "data");
  await mkdir(join(home, "data"), { recursive: true }); await mkdir(join(home, "alpha")); await mkdir(join(home, "extra"));
  await writeFile(join(home, "data/projects.md"), `- alpha - ${join(home, "alpha")}\n`);
  await writeFile(join(home, "data/orders.md"), "The captain authorizes one persistent mate for alpha using the reviewed profile and allocation.\n");
  await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null }); await updateFirstmateConfig({ mateAgentId: "general" });
  models = [{ provider: "codex/test", label: "Test model", modes: [{ id: "full-access", label: "Full access" }], thinking: [] }];
  receiver = new SyntheticReceiver(); runtime = projectRuntimeFixture(data); make();
});
afterEach(async () => { await runtime.stop(); });
it("app reads/previews and cancel initialize no journal, source, coordinator or session", async () => {
  const c = await choices(), before = await readFile(join(home, "data/projects.md"), "utf8");
  await service.read(c.homeId, api); await service.preview(c, api); await service.status(c.homeId);
  expect((await runtime.read(home)).freshness).toBe("uninitialized"); expect(receiver.calls).toEqual([]);
  expect(await readdir(process.env.PASEO_HOME!)).not.toContain("data"); expect(await readFile(join(home, "data/projects.md"), "utf8")).toBe(before);
});
it("one explicit app confirmation admits an unadmitted project and creates exactly one persistent mate/opening with unverified provenance", async () => {
  const input = await review(); const result = await service.commit(input, api);
  expect(result.projects[0]?.agentId).toBeTruthy(); expect(result.projects[0]?.reason).toBeNull();
  expect(receiver.agents.size).toBe(1); expect(receiver.sends).toHaveLength(1); expect(receiver.sends[0]?.text).toBe(input.review.opening);
  const state = await runtime.read(home);
  expect(state.projects?.projects[0]?.provenance.kind).toBe("plugin-ui-unverified"); expect(state.commands.some(c => c.result.attachmentAudit)).toBe(false);
  expect((await service.status(input.homeId)).requests).toEqual([input]);
  await service.commit(input, api); await service.resume(input.homeId, input.requestId, api);
  expect(receiver.agents.size).toBe(1); expect(receiver.sends).toHaveLength(1);
});
it.each(["registry", "folder", "source", "model", "mode", "general"])("changed %s refuses the review before native effects", async kind => {
  const input = await review();
  if (kind === "registry") await writeFile(join(home, "data/projects.md"), `- renamed - ${join(home, "alpha")}\n`);
  if (kind === "folder") await rename(join(home, "alpha"), join(home, "moved"));
  if (kind === "source") await writeFile(join(home, "data/orders.md"), "changed instructions\n");
  if (kind === "model") models = [];
  if (kind === "mode") models[0]!.modes = [];
  if (kind === "general") await updateFirstmateConfig({ mateAgentId: "new-general" });
  await expect(service.commit(input, api)).rejects.toMatchObject({ code: "STALE" }); expect(receiver.calls).toEqual([]);
});
it.each([
  ["missing", "- alpha - C:/definitely-missing-firstmate-project-folder\n", /unavailable/i],
  ["remote", "- alpha - ssh://other/project\n", /local.*mapping/i],
  ["duplicate", null, /ambiguous/i],
] as const)("%s identities have a precise blocker and no native effects", async (_kind, line, message) => {
  await writeFile(join(home, "data/projects.md"), line ?? `- alpha - ${join(home, "alpha")}\n- alias - ${join(home, "alpha")}\n`);
  expect((await service.preview(await choices(), api)).reasons.join(" ")).toMatch(message); expect(receiver.calls).toEqual([]);
});
it("missing/placeholder source authority and invalid allocations never become a grant", async () => {
  const c = await choices(); expect((await service.preview({ ...c, sourcePath: null }, api)).reasons.join(" ")).toMatch(/recorded instructions/i);
  expect((await service.preview({ ...c, sourcePath: "data/projects.md" }, api)).reasons.join(" ")).toMatch(/cannot authorize setup/i);
  await writeFile(join(home, "data/orders.md"), "- (none yet)\n");
  expect((await service.preview(c, api)).reasons.join(" ")).toMatch(/no recorded project permission/i);
  expect((await service.preview({ ...c, budget: { agents: 1, turns: 1 } }, api)).reasons.join(" ")).toMatch(/allocation/i);
  expect((await runtime.read(home)).freshness).toBe("uninitialized");
});
it("reload after admission preserves the original request before creating any session", async () => {
  const input = await review(), original = projects.provision.bind(projects);
  vi.spyOn(projects, "provision").mockRejectedValueOnce(Error("connection lost after admission"));
  await expect(service.commit(input, api)).rejects.toThrow("after admission");
  expect((await projects.read()).projects[0]?.profile).toEqual(profile); expect(receiver.calls).toEqual([]);
  await runtime.stop(); runtime = projectRuntimeFixture(data); make();
  expect((await service.status(input.homeId)).requests).toEqual([input]);
  const next = await service.resume(input.homeId, input.requestId, api); expect(next.projects[0]?.reason).toBeNull();
  expect(receiver.agents.size).toBe(1); expect(receiver.sends).toHaveLength(1); void original;
});
it.each(["createAgent", "send"] as const)("lost %s reply retains identity/spend, status is read-only and resume never repeats an uncertain effect", async op => {
  const input = await review(); receiver.faults[op] = ["lose"];
  await service.commit(input, api); const first = await service.status(input.homeId), calls = receiver.calls.length;
  await service.status(input.homeId); expect(receiver.calls).toHaveLength(calls);
  await runtime.stop(); runtime = projectRuntimeFixture(data); make();
  const next = await service.resume(input.homeId, input.requestId, api);
  expect(next.projects[0]?.agentId).toBe(first.snapshot.projects[0]?.agentId); expect(next.projects[0]?.sessions).toBe(1); expect(next.projects[0]?.turns).toBe(1);
  expect(receiver.calls.filter(c => c.op === op)).toHaveLength(1); expect(receiver.agents.size).toBe(1); expect(receiver.sends).toHaveLength(1);
  if (op === "send") expect(next.projects[0]?.uncertain).toBeGreaterThan(0);
});
it("duplicate/two-client confirms and request/body mismatch never allocate a second identity", async () => {
  const input = await review();
  await Promise.all([service.commit(input, api), service.commit(input, api)]);
  await expect(service.commit({ ...input, requestId: randomUUID() }, api)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(service.commit({ ...input, review: { ...input.review, profile: { provider: "other", modeId: "full-access" } } }, api)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(receiver.agents.size).toBe(1); expect(receiver.sends).toHaveLength(1);
});
it("reuses a valid reviewed profile/source/caps exactly, rather than silently changing a model or permission", async () => {
  const r = await review(), actor = { kind: "mate-chat" as const, id: "general", source: "project administration (same-user role convention, unverified)" };
  await projects.admin({ homeId: r.homeId, requestId: randomUUID(), actorId: "general", command: { op: "admit", name: r.review.name, aliases: [], registryDigest: r.review.registryDigest,
    source: { ...r.review.source, provenance: actor }, profile, budget: r.review.budget, limits: r.review.limits } });
  const preview = await service.preview({ ...await choices(), profile: null, limits: null, budget: null, sourcePath: null }, api);
  expect(preview.reasons).toEqual([]); expect(preview.review?.profile).toEqual(profile); expect(preview.review?.limits).toEqual(r.review.limits);
  expect((await service.read(r.homeId, api)).reviewed[0]?.profile).toEqual(profile);
  await service.commit({ homeId: r.homeId, requestId: randomUUID(), review: preview.review!, reviewDigest: preview.reviewDigest! }, api);
  expect([...receiver.agents.values()][0]?.provider).toBe(profile.provider); expect([...receiver.agents.values()][0]?.modeId).toBe(profile.modeId);
});
it("the new source provenance cannot enter the existing helper admission or general policy importer", async () => {
  const r = await review();
  await expect(projects.admin({ homeId: r.homeId, requestId: randomUUID(), actorId: "general", command: { op: "admit", name: r.review.name, aliases: [], registryDigest: r.review.registryDigest,
    source: r.review.source, profile, budget: r.review.budget, limits: r.review.limits } })).rejects.toMatchObject({ code: "CONFLICT" });
  const { acceptPolicyInventory } = await import("./supervision-policy");
  await runtime.mutate(home, async store => {
    await expect(acceptPolicyInventory(store, home, randomUUID(), r.review.source.provenance, { sources: [r.review.source], rules: [] }, true)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
  expect(receiver.calls).toEqual([]);
});
it("a source change after workspace creation is caught before agent creation or opening", async () => {
  const input = await review(), open = receiver.openWorkspace.bind(receiver);
  vi.spyOn(receiver, "openWorkspace").mockImplementation(async intent => { const value = await open(intent); await writeFile(join(home, "data/orders.md"), "changed after workspace\n"); return value; });
  await expect(service.commit(input, api)).rejects.toMatchObject({ code: "STALE" });
  expect(receiver.agents.size).toBe(0); expect(receiver.sends).toHaveLength(0);
  const project = (await service.status(input.homeId)).snapshot.projects[0]!;
  expect(project.sessions).toBe(1); expect(project.turns).toBe(1);
});
it("fresh capacity guard keeps General headroom and exposes a capacity repair before effects", async () => {
  const input = await review(); projects = new ProjectRuntime(runtime, { enabled: true, slots: 2, generalHeadroom: 1, receiver: () => receiver });
  service = new ProjectSetupService(projects, { models: async () => models });
  // Complete one project; a second valid project is still visible but cannot fit.
  input.review.capacity = { slots: 2, generalHeadroom: 1 };
  const first = await service.preview(await choices(), api);
  const exact = ProjectSetupInputSchema.parse({ ...input, review: first.review, reviewDigest: first.reviewDigest });
  await service.commit(exact, api); for (const a of receiver.agents.values()) a.status = "running";
  await writeFile(join(home, "data/projects.md"), `- alpha - ${join(home, "alpha")}\n- extra - ${join(home, "extra")}\n`);
  const result = await service.preview({ ...await choices(), name: "extra" }, api);
  expect(result.reasons.join(" ")).toMatch(/reserved capacity/i); expect(receiver.agents.size).toBe(1);
});
it("folder selection performs checked registration only; duplicate paths, stale registry and cancellation refuse safely", async () => {
  let snapshot = await projects.read(); await service.folder({ homeId: snapshot.homeId, registryDigest: snapshot.registryDigest!, name: "extra" });
  snapshot = await projects.read(); expect(snapshot.projects).toHaveLength(2); expect(receiver.calls).toEqual([]); expect((await runtime.read(home)).freshness).toBe("uninitialized");
  await expect(service.folder({ homeId: snapshot.homeId, registryDigest: snapshot.registryDigest!, name: "duplicate" })).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(service.folder({ homeId: snapshot.homeId, registryDigest: "0".repeat(64), name: "new" })).rejects.toMatchObject({ code: "STALE" });
  const canceled = new ProjectSetupService(projects, { folder: async () => null });
  expect((await canceled.folder({ homeId: snapshot.homeId, registryDigest: snapshot.registryDigest!, name: "cancel" })).projects).toHaveLength(2);
});
it("explicitly written instructions save durably without inventing a source grant, admission or session", async () => {
  const c = await choices(), s = await projects.read(), input = { homeId: c.homeId, registryDigest: s.registryDigest!, name: c.name, requestId: randomUUID(), text: "Keep track of alpha and answer my project questions. Do not execute plans or create workers." };
  const saved = await service.instructions(input); expect((await service.instructions(input)).path).toBe(saved.path);
  await expect(service.instructions({ ...input, text: "different authority" })).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await service.read(c.homeId, api)).sources.find(s => s.path === saved.path)?.text).toContain(input.text);
  expect((await service.preview({ ...c, sourcePath: saved.path }, api)).reasons).toEqual([]);
  expect((await runtime.read(home)).freshness).toBe("uninitialized"); expect(receiver.calls).toEqual([]);
});
it("feature-off and home switch refuse without weakening the original helper role convention", async () => {
  const input = await review();
  await expect(projects.admin({ homeId: input.homeId, requestId: randomUUID(), actorId: "arbitrary-caller", command: { op: "promote", projectId: input.review.projectId } })).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
  const policy = new FeaturePolicyRuntime(data, { homeId: input.homeId, present: false, problems: [], requested: { ...FEATURES_OFF }, capacity: { slots: 4, generalHeadroom: 1 } });
  projects = new ProjectRuntime(new (await import("./supervision-runtime")).SupervisionRuntime(data, undefined, policy), { enabled: true, receiver: () => receiver });
  service = new ProjectSetupService(projects, { models: async () => models });
  await expect(service.commit(input, api)).rejects.toMatchObject({ code: "STALE" });
  await expect(service.read("another-home", api)).rejects.toMatchObject({ code: "STALE" }); expect(receiver.calls).toEqual([]);
});
