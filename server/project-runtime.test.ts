import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectAdmin } from "../shared/project-runtime";
import { updateFirstmateConfig } from "./config";
import { SupervisionRuntime } from "./supervision-runtime";
import { ProjectRuntime, registerProjectRuntime } from "./project-runtime";
import { SupervisionStore } from "./supervision-store";
import { SyntheticReceiver } from "../test/synthetic-receiver";
import type { PaseoApi } from "./host-types";
import { policyRef } from "./supervision-policy";
import { scopeSnapshot } from "./scope-projection";
import { workflowFixture } from "../test/workflow-fixture";
import { workflowStore } from "./workflow-service";
const root = process.env.PASEO_HOME!, api = {} as PaseoApi;
let home: string, data: string, runtime: SupervisionRuntime, service: ProjectRuntime, receiver: SyntheticReceiver, source: Extract<ProjectAdmin, { op: "admit" }>["source"];
const actor = { kind: "mate-chat" as const, id: "general", source: "project administration (same-user role convention, unverified)" };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
beforeEach(async () => {
  process.env.PASEO_HOME = join(root, randomUUID()); home = join(process.env.PASEO_HOME, "home"); data = join(process.env.PASEO_HOME, "data");
  await mkdir(join(home, "data"), { recursive: true });
  for (const name of ["scheduler", "beta", "gamma"]) await mkdir(join(home, "projects", name), { recursive: true });
  await writeFile(join(home, "data/projects.md"), ["scheduler", "beta", "gamma"].map(name => `- ${name} [reviewed-PR] - ${join(home, "projects", name)} - test`).join("\n") + "\n- remote [local-only] - https://example.invalid/repo\n");
  await writeFile(join(home, "data/orders.md"), "Reviewed project allocation and project-mate profile.\n");
  await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null });
  await updateFirstmateConfig({ mateAgentId: "general" });
  source = { id: randomUUID(), version: 1, path: "data/orders.md", lineStart: 1, lineEnd: 1, fileHash: sha("Reviewed project allocation and project-mate profile.\n"),
    excerptHash: sha("Reviewed project allocation and project-mate profile."), provenance: actor, supersedes: [] };
  runtime = new SupervisionRuntime(data); receiver = new SyntheticReceiver(); service = make();
});
afterEach(async () => { await runtime?.stop(); });
const make = (enabled = true) => new ProjectRuntime(runtime, { enabled, receiver: () => receiver });
async function admin(command: ProjectAdmin, requestId = randomUUID()) {
  return service.admin({ homeId: (await service.read()).homeId, requestId, actorId: "general", command });
}
async function admit(name = "scheduler") {
  const read = await service.read();
  return admin({ op: "admit", name, aliases: [name + "-alias"], registryDigest: read.registryDigest!, source: { ...source, id: randomUUID() },
    profile: { provider: "codex/test", modeId: "full-access", thinkingOptionId: "xhigh" }, budget: { agents: 4, turns: 12 }, limits: { supervisorSessions: 1, supervisorTurns: 5 } });
}
it("production RPCs are registered; off and enabled reads create nothing, account every registry entry, and never provision", async () => {
  const handles: string[] = []; registerProjectRuntime({ handle: ((rpc: { name: string }) => { handles.push(rpc.name); }) as never }, make(false));
  expect(handles).toHaveLength(4);
  expect((await service.read()).projects).toHaveLength(4);
  expect((await service.read()).projects.find(p => p.name === "remote")?.reason).toMatch(/canonical local/);
  service = make(false); const read = await service.read();
  await expect(service.provision({ homeId: read.homeId, requestId: randomUUID(), projectId: randomUUID(), projectVersion: 1 }, api)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(stat(join(data, "supervision"))).rejects.toMatchObject({ code: "ENOENT" }); expect(receiver.calls).toEqual([]);
});
it("admits from an exact reviewed census, provisions one independent project mate, and retains context/spend on restart", async () => {
  await workflowStore(home).execute({ op: "draft", definition: workflowFixture() }, randomUUID(), "general");
  const admitted = await admit(), project = admitted.projects.find(p => p.name === "scheduler")!;
  await writeFile(join(home, "projects/scheduler/AGENTS.md"), "Project conventions: isolated fixtures.\n");
  expect(project.plans[0]).toMatchObject({ backend: "legacy", state: expect.stringContaining("Pending migration"), ownerScopeId: null });
  const proposeId = randomUUID(); await admin({ op: "memory-propose", projectId: project.projectId!, key: "conventions", expectedVersion: 0, text: "Use isolated tests.", evidence: [] }, proposeId);
  await admin({ op: "memory-decide", proposalId: proposeId, proposalVersion: 1, decision: "accept", memoryVersion: 0 });
  expect((await service.memory({ homeId: admitted.homeId, projectId: project.projectId! })).memory[0]).toMatchObject({ text: "Use isolated tests.", authority: "none" });
  const input = { homeId: admitted.homeId, requestId: randomUUID(), projectId: project.projectId!, projectVersion: project.version };
  const provisioned = await service.provision(input, api), owner = provisioned.projects.find(p => p.name === "scheduler")!;
  expect(receiver.calls.map(c => c.op)).toEqual(["openWorkspace", "createAgent", "send"]);
  expect(receiver.agents.get(owner.agentId!)?.labels["firstmate.role"]).toBe("project-mate");
  expect(receiver.agents.get(owner.agentId!)?.labels["paseo.parent-agent-id"]).toBeUndefined();
  expect(receiver.sends[0]?.text).toContain("Use isolated tests."); expect(owner).toMatchObject({ sessions: 1, turns: 1, uncertain: 0 });
  expect(receiver.sends[0]?.text).toContain("Project conventions: isolated fixtures.");
  await Promise.all([service.provision(input, api), service.provision({ ...input, requestId: randomUUID() }, api)]);
  expect(receiver.calls).toHaveLength(3);
  await runtime.stop(); runtime = new SupervisionRuntime(data); service = make();
  await service.provision(input, api);
  expect((await service.read()).projects.find(p => p.name === "scheduler")).toMatchObject({ agentId: owner.agentId, workspaceId: owner.workspaceId, sessions: 1, turns: 1 });
  expect(receiver.calls).toHaveLength(3);
  await expect(service.provision({ ...input, projectVersion: input.projectVersion + 1 }, api)).rejects.toMatchObject({ code: "CONFLICT" });
});
it("lost opening stays uncertain across explicit resume and restart, with no extra send or identity", async () => {
  const read = await admit(), p = read.projects.find(p => p.name === "scheduler")!, input = { homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, requestId: randomUUID() };
  receiver.faults.send = ["lose"];
  await service.provision(input, api); await runtime.stop(); runtime = new SupervisionRuntime(data); service = make();
  await service.provision(input, api); await service.provision({ ...input, requestId: randomUUID() }, api);
  const latest = (await service.read()).projects.find(p => p.name === "scheduler")!;
  expect(latest).toMatchObject({ sessions: 1, turns: 1, uncertain: 1 }); expect(receiver.calls.filter(c => c.op === "send")).toHaveLength(1);
});
it("stop holds only the affected project; an unrelated project provisions, and original accepted admission replays", async () => {
  const first = await admit(), a = first.projects.find(p => p.name === "scheduler")!; await admit("beta");
  const stored = await new SupervisionStore(data, home).read(), record = stored.projects!.projects.find(p => p.id === a.projectId)!;
  await admin({ op: "project", projectId: record.id, expectedVersion: record.version, state: "stopped", budget: record.budget, sourceVector: record.sourceVector });
  await expect(service.provision({ homeId: first.homeId, requestId: randomUUID(), projectId: record.id, projectVersion: record.version + 1 }, api)).rejects.toMatchObject({ code: "HELD" });
  const b = (await service.read()).projects.find(p => p.name === "beta")!;
  await service.provision({ homeId: first.homeId, requestId: randomUUID(), projectId: b.projectId!, projectVersion: b.version }, api);
  expect(receiver.agents.size).toBe(1); expect((await new SupervisionStore(data, home).read()).operationHolds.every(h => h.scopeId === record.scopeId)).toBe(true);
});
it("intake deduplicates; malformed source/census and stale memory refuse without second ownership", async () => {
  const read = await admit(), p = read.projects.find(p => p.name === "scheduler")!;
  const planScopeId = randomUUID();
  await runtime.mutate(home, store => store.transact([{ kind: "scope", id: planScopeId, version: 0 }], randomUUID(), [{ kind: "scope", value: {
    id: planScopeId, homeId: store.homeId, kind: "plan", projectIds: [p.projectId!], sponsorId: p.scopeId!, version: 1, mode: "scoped", state: "dormant" } }]));
  const intake: ProjectAdmin = { op: "intake", intakeId: "original-message", textDigest: "a".repeat(64), ownerScopeId: planScopeId, projectIds: [p.projectId!], tasks: [] };
  await admin(intake); await admin(intake);
  expect((await new SupervisionStore(data, home).read()).projects?.intents).toHaveLength(1);
  await expect(admin({ op: "admit", name: "beta", aliases: [], registryDigest: "b".repeat(64), source, budget: { agents: 1, turns: 1 }, profile: { provider: "codex/test", modeId: "full-access" }, limits: { supervisorSessions: 1, supervisorTurns: 1 } })).rejects.toMatchObject({ code: "STALE" });
  const id = randomUUID(); await admin({ op: "memory-propose", projectId: p.projectId!, key: "rule", expectedVersion: 0, text: "Cannot grant anything", evidence: [] }, id);
  const review = await service.memory({ homeId: read.homeId, projectId: p.projectId! }); expect(review.proposals[0]?.text).toBe("Cannot grant anything");
  await expect(admin({ op: "memory-decide", proposalId: id, proposalVersion: 1, decision: "accept", memoryVersion: 3 })).rejects.toMatchObject({ code: "STALE" });
  const store = new SupervisionStore(data, home), status = await store.read(), blob = status.projects!.memoryProposals[0]!.textDigest;
  await writeFile(join(store.root, "blobs", blob), "corrupt");
  await expect(service.memory({ homeId: read.homeId, projectId: p.projectId! })).rejects.toMatchObject({ code: "HELD" });
});

it("reserves General headroom before a second project session and resumes after the first becomes dormant", async () => {
  await admit(); const read = await admit("beta");
  service = new ProjectRuntime(runtime, { enabled: true, slots: 2, generalHeadroom: 1, receiver: () => receiver });
  const a = read.projects.find(p => p.name === "scheduler")!, b = read.projects.find(p => p.name === "beta")!;
  const input = (p: typeof a) => ({ homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, requestId: randomUUID() });
  const first = await service.provision(input(a), api);
  await expect(service.provision(input(b), api)).rejects.toMatchObject({ code: "HELD", message: expect.stringContaining("General headroom") });
  expect(receiver.agents.size).toBe(1);
  receiver.finish(first.projects.find(p => p.name === "scheduler")!.agentId!);
  await service.provision(input(b), api); expect(receiver.agents.size).toBe(2);
});

it("the existing-clock transport pages past replied requests, and rejects provisioning or Attach files", async () => {
  const directory = join(home, "data/project-requests"); await mkdir(directory);
  const names = Array.from({ length: 21 }, () => randomUUID()).sort();
  for (const id of names) await writeFile(join(directory, `${id}.json`), JSON.stringify({ id, actor: "guest", command: { op: "read" } }));
  await service.processRequests(); await service.processRequests();
  expect(JSON.parse(await readFile(join(directory, `${names[20]}.reply.json`), "utf8")).ok).toBe(true);
  const id = randomUUID(); await writeFile(join(directory, `${id}.json`), JSON.stringify({ id, actor: "general", command: { op: "provision" } }));
  await service.processRequests(); expect(JSON.parse(await readFile(join(directory, `${id}.reply.json`), "utf8")).ok).toBe(false);
  expect(receiver.calls).toEqual([]); await expect(stat(join(data, "supervision"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("a source changed after workspace admission holds creation; restoring it resumes the same reservation", async () => {
  const read = await admit(), p = read.projects.find(p => p.name === "scheduler")!, input = { homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, requestId: randomUUID() };
  const original = receiver.openWorkspace.bind(receiver);
  vi.spyOn(receiver, "openWorkspace").mockImplementationOnce(async intent => {
    const receipt = await original(intent); await writeFile(join(home, "data/orders.md"), "Changed instructions.\n"); return receipt;
  });
  await expect(service.provision(input, api)).rejects.toMatchObject({ code: "STALE" });
  expect(receiver.calls.map(c => c.op)).toEqual(["openWorkspace"]);
  expect((await service.read()).projects.find(p => p.name === "scheduler")).toMatchObject({ sessions: 1, turns: 1 });
  await writeFile(join(home, "data/orders.md"), "Reviewed project allocation and project-mate profile.\n");
  await service.provision(input, api);
  expect(receiver.calls.map(c => c.op)).toEqual(["openWorkspace", "createAgent", "send"]);
});

it("reviewed aliases keep canonical identity and both old plan membership and new routing after a registry rename", async () => {
  await workflowStore(home).execute({ op: "draft", definition: workflowFixture() }, randomUUID(), "general");
  const read = await admit(), original = read.projects.find(p => p.name === "scheduler")!;
  const path = join(home, "data/projects.md"); await writeFile(path, (await readFile(path, "utf8")).replace("- scheduler [", "- scheduler-next ["));
  expect((await service.read()).projects.find(p => p.name === "scheduler-next")?.reason).toMatch(/reviewed alias/);
  const status = await new SupervisionStore(data, home).read(), project = status.projects!.projects.find(p => p.id === original.projectId)!;
  const next = await admin({ op: "project", projectId: project.id, expectedVersion: project.version, state: "admitted", aliases: ["scheduler-next"], budget: project.budget, sourceVector: project.sourceVector });
  const renamed = next.projects.find(p => p.name === "scheduler-next")!;
  expect(renamed.projectId).toBe(original.projectId); expect(renamed.plans[0]?.id).toBe("scheduler");
  expect(scopeSnapshot(await new SupervisionStore(data, home).read(), "general").projects).toContainEqual({ id: project.id, name: "scheduler-next" });
});
