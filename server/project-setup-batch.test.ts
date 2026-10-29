import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectRuntime } from "./project-runtime";
import { ProjectSetupService } from "./project-setup";
import { ProjectBatchService } from "./project-setup-batch";
import { ProjectBatchCommitSchema, type ProjectBatchCommit } from "../shared/project-setup-batch";
import { projectRuntimeFixture } from "../test/project-runtime-fixture";
import { SyntheticReceiver } from "../test/synthetic-receiver";
import { updateFirstmateConfig } from "./config";
import type { PaseoApi } from "./host-types";
import type { ProjectSetupChoices } from "../shared/project-setup";
import { digest } from "./submissions";
import { FeaturePolicyRuntime } from "./feature-policy-runtime";
import { FEATURES_OFF } from "../shared/feature-settings";
const root = process.env.PASEO_HOME!, api = {} as PaseoApi;
let home: string, data: string, homeId: string, runtime: ReturnType<typeof projectRuntimeFixture>, projects: ProjectRuntime,
  setup: ProjectSetupService, batches: ProjectBatchService, receiver: SyntheticReceiver;
const profile = { provider: "codex/test", modeId: "full-access" }, models = [{ provider: profile.provider, label: "Test model", modes: [{ id: profile.modeId, label: "Full access" }], thinking: [] }];
function make(slots = 4) {
  projects = new ProjectRuntime(runtime, { enabled: true, slots, receiver: () => receiver, legacy: async () => ({ plans: [], problems: [] }) });
  setup = new ProjectSetupService(projects, { models: async () => structuredClone(models) }); batches = new ProjectBatchService(setup);
}
function choices(name: string): ProjectSetupChoices { return { homeId, name, profile, sourcePath: `data/${name}.md`, budget: { agents: 3, turns: 9 }, limits: { supervisorSessions: 1, supervisorTurns: 5 } }; }
async function review(names = ["alpha", "beta"]) {
  const p = await batches.preview(homeId, randomUUID(), names.map(choices), api);
  expect(p.reasons).toEqual([]); expect(p.commit).not.toBeNull(); return p.commit!;
}
beforeEach(async () => {
  process.env.PASEO_HOME = join(root, randomUUID()); home = join(process.env.PASEO_HOME, "home"); data = join(process.env.PASEO_HOME, "data");
  await mkdir(join(home, "data"), { recursive: true });
  const names = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
  for (const name of names) { await mkdir(join(home, name)); await writeFile(join(home, "data", `${name}.md`), `The captain permits the reviewed persistent mate for ${name}.\n`); }
  await writeFile(join(home, "data/projects.md"), names.map(n => `- ${n} - ${join(home, n)}\n`).join(""));
  await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null }); await updateFirstmateConfig({ mateAgentId: "general" });
  receiver = new SyntheticReceiver(); runtime = projectRuntimeFixture(data); make(); homeId = (await projects.read()).homeId;
});
afterEach(async () => { await runtime.stop(); });
it("preview and status are inert; six selected remain six when only three fit", async () => {
  expect(await batches.status(homeId)).toEqual([]);
  const names = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"], p = await batches.preview(homeId, randomUUID(), names.map(choices), api);
  expect(p.reviews).toHaveLength(6); expect(p.capacity?.available).toBe(3); expect(p.reasons.join(" ")).toMatch(/6 selected; room for 3/); expect(p.commit).toBeNull();
  expect((await runtime.read(home)).freshness).toBe("uninitialized"); expect(receiver.calls).toEqual([]); expect(await readdir(process.env.PASEO_HOME!)).not.toContain("data");
});
it.each([1, 2])("one confirmation creates %i mates and writes the entire manifest before effects", async count => {
  const input = await review(["alpha", "beta"].slice(0, count));
  receiver.afterAdmission = () => { expect(receiver.calls.length).toBeGreaterThan(0); };
  const original = setup.commit.bind(setup);
  vi.spyOn(setup, "commit").mockImplementation(async (child, p) => {
    const saved = await batches.status(homeId); expect(saved[0]?.commit).toEqual(input); expect(saved[0]?.children).toHaveLength(count);
    return original(child, p);
  });
  const result = await batches.commit(input, api); expect(result.children.map(c => c.state)).toEqual(Array(count).fill("ready"));
  expect(receiver.agents.size).toBe(count); expect(receiver.sends).toHaveLength(count);
  expect((await setup.status(homeId)).requests.map(r => r.requestId).sort()).toEqual(input.manifest.children.map(c => c.requestId).sort());
  const status = await runtime.read(home); expect(status.commands.some(c => c.result.attachmentAudit)).toBe(false); expect(status.decisions).toEqual([]);
});
it("duplicate and two-client confirmations reconcile exact inputs; changed body refuses", async () => {
  const input = await review(), second = new ProjectBatchService(setup);
  await Promise.all([batches.commit(input, api), second.commit(input, api)]); expect(receiver.agents.size).toBe(2); expect(receiver.sends).toHaveLength(2);
  const changed = structuredClone(input); changed.manifest.children[0]!.review.profile.modeId = "other"; changed.reviewDigest = digest(changed.manifest);
  await expect(batches.commit(changed, api)).rejects.toMatchObject({ code: "CONFLICT" }); expect(receiver.sends).toHaveLength(2);
});
it("a second batch for the same projects cannot recreate a completed child", async () => {
  const first = await review(), second = await review();
  await batches.commit(first, api); await expect(batches.commit(second, api)).rejects.toMatchObject({ code: "STALE" }); expect(receiver.sends).toHaveLength(2);
});
it("two different batch IDs cannot replace a waiting batch's retained child identities", async () => {
  const first = await review(), second = await review(); vi.spyOn(setup, "commit").mockRejectedValue(Error("Host offline"));
  await batches.commit(first, api); await expect(batches.commit(second, api)).rejects.toMatchObject({ code: "STALE" });
  expect((await batches.status(homeId)).map(b => b.commit)).toEqual([first]); expect(receiver.calls).toEqual([]);
  await batches.cancel(homeId, first.manifest.batchId);
  await batches.commit(second, api); expect(await batches.status(homeId)).toHaveLength(2); expect(receiver.calls).toEqual([]);
});
it("a lost batch response, app reload and daemon restart retain every exact request", async () => {
  const input = await review(); await batches.commit(input, api); const calls = receiver.calls.length;
  await runtime.stop(); runtime = projectRuntimeFixture(data); make();
  const saved = await batches.status(homeId); expect(saved[0]?.commit).toEqual(input); expect(receiver.calls).toHaveLength(calls);
  await batches.commit(input, api); expect(receiver.calls).toHaveLength(calls); expect(receiver.sends).toHaveLength(2);
});
it.each(["send"] as const)("unknown %s remains held during read and duplicate/continue; successful sibling stays ready", async op => {
  const input = await review(); receiver.faults[op] = ["lose"];
  const result = await batches.commit(input, api); expect(result.children[0]?.state).toBe("checking"); expect(result.children[0]?.canContinue).toBe(false); expect(result.children[1]?.state).toBe("ready");
  const calls = receiver.calls.length; await batches.status(homeId); await batches.continue(homeId, input.manifest.batchId, api); await batches.commit(input, api);
  expect(receiver.calls).toHaveLength(calls); expect(receiver.calls.filter(c => c.op === op)).toHaveLength(2);
  await runtime.stop(); runtime = projectRuntimeFixture(data); make(); expect((await batches.status(homeId))[0]?.commit).toEqual(input);
  expect((await batches.status(homeId))[0]?.children[0]).toMatchObject({ state: "checking", sessions: 1, turns: 1, canContinue: false });
});
it("P2-1: unrelated fleet occupancy may change when the entire reviewed batch still fits", async () => {
  const input = await review(), extra = await setup.preview(choices("gamma"), api);
  await setup.commit({ homeId, requestId: randomUUID(), review: extra.review!, reviewDigest: extra.reviewDigest! }, api);
  const current = await batches.preview(homeId, input.manifest.batchId, [choices("alpha"), choices("beta")], api);
  expect(current.capacity).toMatchObject({ occupied: 1, available: 2 }); expect(current.reasons).toEqual([]);
  const result = await batches.commit(input, api);
  expect(result.commit).toEqual(input); expect(result.children.map(c => c.state)).toEqual(["ready", "ready"]);
  expect(receiver.agents.size).toBe(3); expect(receiver.sends).toHaveLength(3);
});
it("P2-1: occupancy churn at the final capacity boundary is a threshold, not an exact observation", async () => {
  const input = await review(), original = batches.preview.bind(batches);
  vi.spyOn(batches, "preview").mockImplementationOnce(async (...args) => {
    const result = await original(...args), extra = await setup.preview(choices("gamma"), api);
    await setup.commit({ homeId, requestId: randomUUID(), review: extra.review!, reviewDigest: extra.reviewDigest! }, api);
    return result;
  });
  expect((await batches.commit(input, api)).children.map(c => c.state)).toEqual(["ready", "ready"]);
  expect(receiver.agents.size).toBe(3); expect(receiver.sends).toHaveLength(3);
});
it("P2-1: occupancy that leaves too little room still refuses before selected child effects", async () => {
  const input = await review();
  for (const name of ["gamma", "delta"]) {
    const extra = await setup.preview(choices(name), api);
    await setup.commit({ homeId, requestId: randomUUID(), review: extra.review!, reviewDigest: extra.reviewDigest! }, api);
  }
  const calls = receiver.calls.length;
  await expect(batches.commit(input, api)).rejects.toMatchObject({ code: "STALE" });
  expect(receiver.calls).toHaveLength(calls); expect(await batches.status(homeId)).toEqual([]);
});
it("P2-2: lost create resumes the exact recoverable child after restart without a duplicate create", async () => {
  const input = await review(); receiver.faults.createAgent = ["lose"];
  const first = await batches.commit(input, api), child = input.manifest.children[0]!;
  expect((await setup.status(homeId)).recoverableCreates).toContain(child.requestId);
  expect(first.children[0]).toMatchObject({ state: "checking", canContinue: true, sessions: 1, turns: 1 });
  const calls = receiver.calls.length; await batches.status(homeId); expect(receiver.calls).toHaveLength(calls);
  await runtime.stop(); runtime = projectRuntimeFixture(data); make();
  const saved = (await batches.status(homeId))[0]!; expect(saved.commit).toEqual(input); expect(saved.children[0]?.canContinue).toBe(true);
  const result = await batches.continue(homeId, input.manifest.batchId, api);
  expect(result.children.map(c => c.state)).toEqual(["ready", "ready"]); expect(result.children[0]?.agentId).toBe(first.children[0]?.agentId);
  expect(receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(2); expect(receiver.agents.size).toBe(2); expect(receiver.sends).toHaveLength(2);
  expect(result.children[0]).toMatchObject({ sessions: 1, turns: 1 });
  expect((await setup.status(homeId)).requests).toEqual(expect.arrayContaining(input.manifest.children));
  const settledCalls = receiver.calls.length; await batches.commit(input, api); expect(receiver.calls).toHaveLength(settledCalls);
});
it("P2-2: a missing create lookup never recreates or sends; later exact evidence may finish the same mate", async () => {
  const input = await review(); receiver.faults.createAgent = ["hide"];
  const first = await batches.commit(input, api), identity = first.children[0]!.agentId!;
  expect(first.children[0]).toMatchObject({ state: "checking", canContinue: true });
  const calls = receiver.calls.length;
  await batches.continue(homeId, input.manifest.batchId, api);
  expect(receiver.calls).toHaveLength(calls); expect(receiver.sends).toHaveLength(1);
  expect((await batches.status(homeId))[0]!.children[0]).toMatchObject({ agentId: identity, sessions: 1, turns: 1 });
  receiver.reveal(identity);
  const result = await batches.continue(homeId, input.manifest.batchId, api);
  expect(result.children.map(c => c.state)).toEqual(["ready", "ready"]);
  expect(receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(2); expect(receiver.sends).toHaveLength(2);
  expect(result.children[0]).toMatchObject({ agentId: identity, sessions: 1, turns: 1 });
});
it("changed source holds only the remaining affected child and records its readable diagnostic", async () => {
  const input = await review(), original = setup.commit.bind(setup);
  vi.spyOn(setup, "commit").mockImplementation(async (child, p) => {
    const result = await original(child, p);
    if (child.review.name === "alpha") await writeFile(join(home, "data/beta.md"), "Changed authority.\n");
    return result;
  });
  const result = await batches.commit(input, api); expect(result.children[0]?.state).toBe("ready"); expect(result.children[1]?.state).toBe("needs-change");
  expect(result.children[1]?.reason).toMatch(/changed|review/i); expect(receiver.agents.size).toBe(1); expect(receiver.sends).toHaveLength(1);
  const calls = receiver.calls.length; await batches.status(homeId); expect(receiver.calls).toHaveLength(calls);
});
it("provider refusal has its own outcome and never rolls back a successful sibling", async () => {
  const input = await review(); receiver.faults.createAgent = ["reject"];
  const result = await batches.commit(input, api); expect(result.children[0]?.state).toBe("needs-change"); expect(result.children[1]?.state).toBe("ready");
  expect(result.children[0]).toMatchObject({ sessions: 1, turns: 1, canContinue: false }); expect(receiver.agents.size).toBe(1);
});
it("cancelling during one native child lets that effect settle and stops later children", async () => {
  const input = await review(); let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  receiver.gate = new Promise<void>(resolve => { release = resolve; }); receiver.afterAdmission = entered;
  const active = batches.commit(input, api); await ready;
  const cancelled = batches.cancel(homeId, input.manifest.batchId); release();
  const [result] = await Promise.all([active, cancelled]);
  expect(result.children.map(c => c.state)).toEqual(["ready", "cancelled"]); expect(receiver.agents.size).toBe(1); expect(receiver.sends).toHaveLength(1);
  expect(result.commit).toEqual(input); expect(result.children[0]).toMatchObject({ sessions: 1, turns: 1 });
});
it("capacity exhausted between children holds only the remaining work", async () => {
  const input = await review(), original = setup.commit.bind(setup);
  vi.spyOn(setup, "commit").mockImplementation(async (child, p) => {
    const result = await original(child, p);
    if (child.review.name === "alpha") vi.spyOn(projects, "capacity").mockResolvedValue({ slots: 2, generalHeadroom: 1 });
    return result;
  });
  const result = await batches.commit(input, api);
  expect(result.children.map(c => c.state)).toEqual(["ready", "needs-change"]); expect(receiver.agents.size).toBe(1); expect(receiver.sends).toHaveLength(1);
});
it("cancellation affects only not-yet-admitted children and keeps exact inputs and spend", async () => {
  const input = await review(); vi.spyOn(setup, "commit").mockRejectedValue(Error("Host is offline. Reconnect before continuing."));
  await batches.commit(input, api); const result = await batches.cancel(homeId, input.manifest.batchId);
  expect(result.children.map(c => c.state)).toEqual(["cancelled", "cancelled"]); expect(result.commit).toEqual(input);
  await batches.continue(homeId, input.manifest.batchId, api); expect(receiver.calls).toEqual([]); expect((await setup.status(homeId)).requests).toEqual([]);
});
it("cancelling a partial batch preserves ready and uncertain children", async () => {
  const input = await review(); receiver.faults.send = ["lose"]; await batches.commit(input, api);
  const calls = receiver.calls.length, result = await batches.cancel(homeId, input.manifest.batchId);
  expect(result.children.map(c => c.state)).toEqual(["checking", "ready"]); expect(result.children[0]).toMatchObject({ sessions: 1, turns: 1 });
  expect(receiver.calls).toHaveLength(calls);
});
it("capacity changes before confirmation refuse before manifest or native effects", async () => {
  const input = await review(); make(2); await expect(batches.commit(input, api)).rejects.toMatchObject({ code: "STALE" });
  expect(await batches.status(homeId)).toEqual([]); expect(receiver.calls).toEqual([]);
});
it("home switch and malformed/oversized selections cannot create a batch", async () => {
  const input = await review(); await expect(batches.preview("other-home", randomUUID(), [choices("alpha")], api)).rejects.toThrow();
  await expect(batches.preview(homeId, randomUUID(), Array(65).fill(choices("alpha")), api)).rejects.toThrow();
  expect(ProjectBatchCommitSchema.safeParse({ ...input, manifest: { ...input.manifest, children: Array(65).fill(input.manifest.children[0]) } }).success).toBe(false);
  expect(receiver.calls).toEqual([]);
});
it("corrupt manifest remains held and is never replaced", async () => {
  const input = await review(); await batches.commit(input, api);
  const path = join(data, "project-setup-batches", digest(homeId), `${input.manifest.batchId}.json`); await writeFile(path, "damaged");
  await expect(batches.status(homeId)).rejects.toThrow(); await expect(batches.commit(input, api)).rejects.toThrow(); expect(await readFile(path, "utf8")).toBe("damaged");
});
it("persisted policy applies to aggregate review and never broadens project capabilities", async () => {
  const features = new FeaturePolicyRuntime(join(process.env.PASEO_HOME!, "features"));
  await features.set({ home, requestId: randomUUID(), expectedRevision: 0, change: { requested: { ...FEATURES_OFF, projectMates: true }, capacity: { slots: 4, generalHeadroom: 1 } } });
  runtime = new (await import("./supervision-runtime")).SupervisionRuntime(data, undefined, features); make();
  const input: ProjectBatchCommit = await review(); const result = await batches.commit(input, api); expect(result.children.map(c => c.state)).toEqual(["ready", "ready"]);
  expect((await features.read(home)).requested).toEqual({ ...FEATURES_OFF, projectMates: true });
});
