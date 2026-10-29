import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectAdmin } from "../shared/project-runtime";
import { updateFirstmateConfig } from "./config";
import { SupervisionRuntime } from "./supervision-runtime";
import { ProjectRuntime, registerProjectRuntime } from "./project-runtime";
import { SupervisionStore } from "./supervision-store";
import { SyntheticReceiver } from "../test/synthetic-receiver";
import { projectRuntimeFixture } from "../test/project-runtime-fixture";
import type { PaseoApi } from "./host-types";
import { policyRef } from "./supervision-policy";
import { scopeSnapshot } from "./scope-projection";
import { workflowFixture } from "../test/workflow-fixture";
import { workflowStore } from "./workflow-service";
import { askMate } from "./mate";
import { canonical, digest } from "./submissions";
import { stableId } from "./supervision-effects";
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
  runtime = projectRuntimeFixture(data); receiver = new SyntheticReceiver(); service = make();
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
async function cutoverForAttach(projectId: string) {
  const { SupervisionActivation } = await import("./supervision-activation");
  const { legacyAdapters } = await import("./supervision-migrate");
  const { NeedsYouService, readConfiguredDecisionHome } = await import("./needs-you-service");
  await writeFile(join(home, "data/backlog.md"), "# Backlog\n## In flight\n## Queued\n## Done\n");
  await workflowStore(home).execute({ op: "draft", definition: workflowFixture() }, randomUUID(), "general");
  let clock = 1000;
  const ledger = new NeedsYouService({ root: join(data, "ledger"), home: readConfiguredDecisionHome, catalog: async () => null, enabled: () => true, now: () => clock });
  await ledger.read(); clock += 2000; await ledger.read();
  const activation = new SupervisionActivation(data, { runtime, enabled: true, headroom: { slots: 4, reserved: 1 },
    adapters: () => legacyAdapters(null, () => ledger.read()), receiver: () => receiver });
  const read = await service.read(), migrationId = randomUUID();
  await activation.migrate({ op: "prepare", homeId: read.homeId, plan: "scheduler", scopeId: randomUUID(), projectId, migrationId,
    prerequisites: { inventory: "drained inventory", policy: "reviewed policy", rollbackBuild: "compatible build" } });
  for (const op of ["reconcile", "barrier", "commit"] as const) await activation.migrate({ op, homeId: read.homeId, migrationId });
  const plan = (await activation.read()).plans[0]!;
  return { activation, ledger, input: { requestId: randomUUID(), homeId: read.homeId, plan: plan.plan, planHash: plan.hash, scopeId: plan.scopeId,
    scopeVersion: plan.scopeVersion, supervisorId: plan.supervisorId, profile: { provider: "codex/test", modeId: "full-access" }, opening: "Supervise Scheduler only." } };
}
function captainRequest() {
  const send = vi.fn(async () => {}), refresh = vi.fn(async () => ({ agent: { id: "general", archivedAt: null, status: "idle" } }));
  const ref = vi.fn(() => ({ refresh, send }));
  return { send, ref, request: () => askMate({ agents: { ref } } as unknown as PaseoApi, { text: "captain request" }) };
}
function stallNextLookup() {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(done => { release = done; }), ready = new Promise<void>(done => { entered = done; });
  const original = receiver.findAgent.bind(receiver);
  vi.spyOn(receiver, "findAgent").mockImplementationOnce(async id => { entered(); await gate; return original(id); });
  return { release, ready };
}
it("review F1b: a concurrent real Attach cannot carry a stalled project lookup into General's lifecycle lock", async () => {
  await admit(); const read = await admit("beta"), a = read.projects.find(p => p.name === "scheduler")!, b = read.projects.find(p => p.name === "beta")!;
  const { activation, ledger, input } = await cutoverForAttach(a.projectId!);
  let pendingProject: Promise<unknown> | undefined, attaching: Promise<unknown> | undefined, captain: Promise<unknown> | undefined;
  const first = { homeId: read.homeId, projectId: a.projectId!, projectVersion: a.version, requestId: randomUUID() };
  await service.provision(first, api);
  const lookup = stallNextLookup();
  try {
    pendingProject = service.provision({ ...first, projectId: b.projectId!, projectVersion: b.version, requestId: randomUUID() }, api); await lookup.ready;
    const baseline = captainRequest(); await baseline.request(); expect(baseline.send).toHaveBeenCalledTimes(1);
    let enteredAttach = false;
    const original = SupervisionStore.prototype.recoverPublication;
    vi.spyOn(SupervisionStore.prototype, "recoverPublication").mockImplementation(async function(this: SupervisionStore, observed) {
      const result = await original.call(this, observed); enteredAttach = true; return result;
    });
    attaching = activation.attach(input, api);
    await vi.waitFor(() => expect(enteredAttach).toBe(true));
    const general = captainRequest(); captain = general.request();
    await vi.waitFor(() => expect(general.send).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(general.ref).toHaveBeenCalledWith("general");
  } finally {
    lookup.release(); await Promise.all([pendingProject, attaching, captain]); await activation.stop(); await ledger.stop();
  }
  expect(receiver.agents.size).toBe(3); expect(receiver.sends).toHaveLength(3);
}, 60000);
it.each(["project", "Attach"] as const)("a stalled %s capacity lookup times out without touching General or admitting late effects", async kind => {
  await admit(); const read = await admit("beta"), a = read.projects.find(p => p.name === "scheduler")!, b = read.projects.find(p => p.name === "beta")!;
  const { activation, ledger, input } = await cutoverForAttach(a.projectId!);
  await service.provision({ homeId: read.homeId, projectId: a.projectId!, projectVersion: a.version, requestId: randomUUID() }, api);
  const projectInput = { homeId: read.homeId, projectId: b.projectId!, projectVersion: b.version, requestId: randomUUID() };
  const calls = receiver.calls.length, before = await runtime.read(home), lookup = stallNextLookup();
  let result: unknown, settled = false, captain: Promise<unknown> | undefined;
  const pending = (kind === "project" ? service.provision(projectInput, api) : activation.attach(input, api))
    .then(value => { result = value; settled = true; }, error => { result = error; settled = true; });
  try {
    await lookup.ready;
    const general = captainRequest(); captain = general.request();
    await vi.waitFor(() => expect(general.send).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await vi.waitFor(() => expect(settled).toBe(true), { timeout: 8000 });
    expect(result).toMatchObject({ code: "HELD", message: expect.stringContaining("lookup timed out") });
    const held = await runtime.read(home);
    expect(held.bindings).toEqual(before.bindings); expect(held.effects).toEqual(before.effects);
    expect(receiver.calls).toHaveLength(calls);
    // The timed-out native read stays pending. Another admission can still use the released queue.
    await (kind === "project" ? activation.attach(input, api) : service.provision(projectInput, api));
    expect(receiver.agents.size).toBe(2);
    expect((await service.read()).general.agentId).toBe("general");
  } finally { lookup.release(); await Promise.all([pending, captain]); await activation.stop(); await ledger.stop(); }
  expect(receiver.agents.size).toBe(2); expect(receiver.sends).toHaveLength(2);
}, 60000);
it("production RPCs are registered; off and enabled reads create nothing, account every registry entry, and never provision", async () => {
  const handles: string[] = []; registerProjectRuntime({ handle: ((rpc: { name: string }) => { handles.push(rpc.name); }) as never }, make(false));
  expect(handles).toHaveLength(13); expect(handles).toContain("firstmate.projects.recover-ui"); expect(handles).toContain("firstmate.projects.abort-ui");
  expect((await service.read()).projects).toHaveLength(4);
  expect((await service.read()).projects.find(p => p.name === "remote")?.reason).toMatch(/canonical local/);
  service = make(false); const read = await service.read();
  await expect(service.recover({ homeId: read.homeId, sequence: 0, hash: null })).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(service.abort({ homeId: read.homeId, projectId: randomUUID(), projectVersion: 1, provisionRequestId: randomUUID() })).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(service.provision({ homeId: read.homeId, requestId: randomUUID(), projectId: randomUUID(), projectVersion: 1 }, api)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(stat(join(data, "supervision"))).rejects.toMatchObject({ code: "ENOENT" }); expect(receiver.calls).toEqual([]);
});
it("read-only presentation metadata identifies legacy membership warnings without removing guard problems", async () => {
  const definition = workflowFixture();
  for (const node of definition.nodes) if (node.kind === "run") node.launch.project = "older-unlinked-project";
  await workflowStore(home).execute({ op: "draft", definition }, randomUUID(), "general");
  const read = await service.read();
  expect(read.associationWarnings).toEqual(["Plan scheduler has unresolved project or host membership; no ownership was guessed."]);
  expect(read.problems).toEqual(expect.arrayContaining(read.associationWarnings!));
  expect(read.projects.find(p => p.name === "remote")).toMatchObject({ registryLocation: "https://example.invalid/repo", state: "held", directory: null });
  expect(receiver.calls).toEqual([]); expect((await runtime.read(home)).sequence).toBe(0);
});
it("review F1: General chat and another admitted project finish while a project's native workspace call waits", async () => {
  await admit(); const read = await admit("beta"), a = read.projects.find(p => p.name === "scheduler")!, b = read.projects.find(p => p.name === "beta")!;
  let release!: () => void, entered!: () => void, generalRead = false;
  const gate = new Promise<void>(done => { release = done; }), ready = new Promise<void>(done => { entered = done; });
  const original = receiver.openWorkspace.bind(receiver);
  vi.spyOn(receiver, "openWorkspace").mockImplementationOnce(async intent => { entered(); await gate; return original(intent); });
  const input = (p: typeof a) => ({ homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, requestId: randomUUID() });
  const first = service.provision(input(a), api); await ready;
  let secondFinished = false;
  const second = service.provision(input(b), api).then(() => { secondFinished = true; });
  const send = vi.fn(async () => {});
  const mateApi = { agents: { ref: () => ({ refresh: async () => { generalRead = true; return { agent: { id: "general", archivedAt: null, status: "idle", provider: "codex", capabilities: { supportsStreaming: false } } }; }, send }) } } as unknown as PaseoApi;
  const general = askMate(mateApi, { text: "captain request" });
  try {
    await vi.waitFor(() => { expect(generalRead).toBe(true); expect(send).toHaveBeenCalledTimes(1); expect(secondFinished).toBe(true); }, { timeout: 20000 });
    expect(receiver.agents.size).toBe(1); // Only B; A's native call is still waiting.
  } finally { release(); await Promise.all([first, second, general]); }
  expect(receiver.agents.size).toBe(2);
}, 60000);

it("review F2: the app can inspect and recover a stale checkpoint after restart, then resume its original input exactly once", async () => {
  const read = await admit(), p = read.projects.find(p => p.name === "scheduler")!;
  await runtime.stop(); let failOnce = true;
  runtime = projectRuntimeFixture(data, { boundary: async name => {
    if (name === "publication:linked" && failOnce) { failOnce = false; throw Error("review F2 checkpoint interruption"); }
  } }); service = make();
  const input = { homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, requestId: randomUUID() };
  await expect(service.provision(input, api)).rejects.toMatchObject({ code: "HELD" });
  await runtime.stop(); runtime = projectRuntimeFixture(data); service = make();
  const held = await service.read();
  expect(held.freshness).toBe("held"); expect(receiver.calls).toHaveLength(0);
  expect(held.recovery).toEqual({ sequence: held.sequence, hash: held.hash });
  const recovered = await service.recover({ homeId: held.homeId, ...held.recovery! });
  expect(recovered.freshness).toBe("current"); expect(receiver.calls).toHaveLength(0);
  const retained = recovered.projects.find(p => p.name === "scheduler")!;
  expect(retained.provisionInput).toEqual(input);
  await service.provision(retained.provisionInput!, api); await service.provision(input, api);
  expect(receiver.agents.size).toBe(1); expect(receiver.calls.map(c => c.op)).toEqual(["openWorkspace", "createAgent", "send"]);
  expect((await service.read()).projects.find(p => p.name === "scheduler")).toMatchObject({ sessions: 1, turns: 1 });
});
it("a stale provisioning input cannot pin an invalid request and block the next current app action", async () => {
  const read = await admit(), p = read.projects.find(p => p.name === "scheduler")!;
  await expect(service.provision({ homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version + 1, requestId: randomUUID() }, api)).rejects.toMatchObject({ code: "STALE" });
  expect((await service.read()).projects.find(row => row.projectId === p.projectId)?.provisionInput).toBeNull();
  await service.provision({ homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, requestId: randomUUID() }, api);
  expect(receiver.agents.size).toBe(1);
});
const interruptions = [
  ...Array.from({ length: 9 }, (_, i) => ["publication:linked", i + 1] as const),
  ...["checkpoint:written", "checkpoint:synced", "checkpoint:replaced"].flatMap(point => [1, 6, 9].map(n => [point, n] as const)),
  ["event:linked", 1] as const,
];
it.each(interruptions)("app recovery after %s at provisioning transaction %i retains one identity and offers safe resume or stop", async (point, transaction) => {
  const read = await admit(), p = read.projects.find(p => p.name === "scheduler")!;
  await runtime.stop(); let seen = 0, tripped = false;
  runtime = projectRuntimeFixture(data, { boundary: async name => {
    if (name === point && ++seen === transaction) { tripped = true; throw Error(`interrupted ${point}/${transaction}`); }
  } }); service = make();
  const input = { homeId: read.homeId, requestId: randomUUID(), projectId: p.projectId!, projectVersion: p.version };
  await expect(service.provision(input, api)).rejects.toMatchObject({ code: "HELD" }); expect(tripped).toBe(true);
  await runtime.stop(); runtime = projectRuntimeFixture(data); service = make();
  const held = await service.read(), calls = receiver.calls.length;
  if (held.recovery) {
    await expect(service.recover({ homeId: held.homeId, sequence: held.sequence, hash: "0".repeat(64) })).rejects.toMatchObject({ code: "STALE" });
    await service.recover({ homeId: held.homeId, ...held.recovery }); expect(receiver.calls).toHaveLength(calls);
  }
  const restored = await service.read(), reservedId = restored.projects.find(row => row.projectId === p.projectId)?.agentId;
  expect(restored.freshness).toBe("current"); expect(restored.projects.find(row => row.projectId === p.projectId)?.provisionInput).toEqual(input);
  await service.provision(input, api); await service.provision(input, api);
  let latest = (await service.read()).projects.find(row => row.projectId === p.projectId)!;
  if (reservedId) expect(latest.agentId).toBe(reservedId);
  expect(latest).toMatchObject({ sessions: 1, turns: 1 });
  if (latest.reason) {
    const abort = { homeId: read.homeId, projectId: p.projectId!, projectVersion: latest.version, provisionRequestId: input.requestId };
    await service.abort(abort); await service.abort(abort);
    await runtime.stop(); runtime = projectRuntimeFixture(data); service = make();
    latest = (await service.read()).projects.find(row => row.projectId === p.projectId)!;
    expect(latest.reason).toMatch(/Provisioning stopped/); expect(latest).toMatchObject({ sessions: 1, turns: 1 });
    await expect(service.provision(input, api)).rejects.toMatchObject({ code: "HELD" });
    await service.provision({ ...input, requestId: randomUUID() }, api);
  }
  expect(receiver.calls.filter(c => c.op === "createAgent").length).toBeLessThanOrEqual(1);
  expect(receiver.calls.filter(c => c.op === "send").length).toBeLessThanOrEqual(1);
}, 20000);

it.each(["checkpoint", "event"])("app recovery refuses missing %s authority/witness without creating or changing identities", async damage => {
  const read = await admit(); await runtime.stop();
  const store = new SupervisionStore(data, home), before = await store.read();
  const path = join(store.root, damage === "checkpoint" ? "checkpoint.json" : `transactions/${String(before.sequence).padStart(12, "0")}.event.json`);
  await rm(path); runtime = projectRuntimeFixture(data); service = make();
  const held = await service.read();
  await expect(service.recover({ homeId: read.homeId, sequence: held.sequence, hash: held.hash })).rejects.toMatchObject({ code: "HELD" });
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" }); expect(receiver.calls).toHaveLength(0);
});
it("app recovery preserves a divergent checkpoint instead of reconstructing authority", async () => {
  const read = await admit(); await runtime.stop(); const store = new SupervisionStore(data, home), path = join(store.root, "checkpoint.json");
  const { hash: _hash, ...body } = JSON.parse(await readFile(path, "utf8"));
  const changed = { ...body, sequence: 0, transactionHash: null }, bytes = canonical({ ...changed, hash: digest(changed) }) + "\n";
  await writeFile(path, bytes); runtime = projectRuntimeFixture(data); service = make(); const held = await service.read();
  await expect(service.recover({ homeId: read.homeId, sequence: held.sequence, hash: held.hash })).rejects.toMatchObject({ code: "HELD" });
  expect(await readFile(path, "utf8")).toBe(bytes); expect(receiver.calls).toHaveLength(0);
});
it("same-project accepted memory changes during provisioning still refuse the context snapshot", async () => {
  const read = await admit(), p = read.projects.find(p => p.name === "scheduler")!, proposal = randomUUID(), update = randomUUID();
  await admin({ op: "memory-propose", projectId: p.projectId!, key: "conventions", expectedVersion: 0, text: "original", evidence: [] }, proposal);
  await admin({ op: "memory-decide", proposalId: proposal, proposalVersion: 1, decision: "accept", memoryVersion: 0 });
  await admin({ op: "memory-propose", projectId: p.projectId!, key: "conventions", expectedVersion: 1, text: "updated", evidence: [] }, update);
  const original = SupervisionStore.prototype.readBlob;
  vi.spyOn(SupervisionStore.prototype, "readBlob").mockImplementationOnce(async function (this: SupervisionStore, id, max) {
    const bytes = await original.call(this, id, max);
    await admin({ op: "memory-decide", proposalId: update, proposalVersion: 1, decision: "accept", memoryVersion: 1 }); return bytes;
  });
  const input = { homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, requestId: randomUUID() };
  await expect(service.provision(input, api)).rejects.toMatchObject({ code: "STALE" }); expect(receiver.calls).toHaveLength(0);
  await service.provision(input, api); expect(receiver.sends[0]?.text).toContain("updated");
});

it("simultaneous project admissions keep General's reserved slot", async () => {
  await admit(); await admit("beta"); const read = await admit("gamma");
  service = new ProjectRuntime(runtime, { enabled: true, slots: 3, generalHeadroom: 1, receiver: () => receiver });
  const inputs = read.projects.filter(p => p.profile).map(p => ({ homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, requestId: randomUUID() }));
  const outcomes = await Promise.allSettled(inputs.map(input => service.provision(input, api)));
  expect(outcomes.filter(r => r.status === "fulfilled"), outcomes.map(r => r.status === "rejected" ? String(r.reason) : "ok").join("; ")).toHaveLength(2);
  expect(outcomes.filter(r => r.status === "rejected")).toHaveLength(1);
  expect(receiver.agents.size).toBe(2);
});
it("a General role change between native effects holds dispatch and resumes the original reservation after repair", async () => {
  const read = await admit(), p = read.projects.find(p => p.name === "scheduler")!;
  const original = receiver.openWorkspace.bind(receiver);
  vi.spyOn(receiver, "openWorkspace").mockImplementationOnce(async intent => { const receipt = await original(intent); await updateFirstmateConfig({ mateAgentId: "changed-general" }); return receipt; });
  const input = { homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, requestId: randomUUID() };
  await expect(service.provision(input, api)).rejects.toMatchObject({ code: "STALE" });
  expect(receiver.calls.map(c => c.op)).toEqual(["openWorkspace"]);
  await updateFirstmateConfig({ mateAgentId: "general" }); await service.provision(input, api);
  expect(receiver.agents.size).toBe(1); expect(receiver.sends).toHaveLength(1);
});
it("the app can stop an in-flight provisioning without waiting for its native IO or refunding its identity", async () => {
  const read = await admit(), p = read.projects.find(p => p.name === "scheduler")!;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(done => { release = done; }), ready = new Promise<void>(done => { entered = done; });
  const original = receiver.openWorkspace.bind(receiver);
  vi.spyOn(receiver, "openWorkspace").mockImplementationOnce(async intent => { entered(); await gate; return original(intent); });
  const input = { homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, requestId: randomUUID() };
  const running = service.provision(input, api).catch(error => error); await ready;
  try {
    const stopped = await service.abort({ homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, provisionRequestId: input.requestId });
    expect(stopped.projects.find(row => row.projectId === p.projectId)).toMatchObject({ sessions: 1, turns: 1, reason: expect.stringContaining("Provisioning stopped") });
  } finally { release(); await running; }
  expect(receiver.calls.map(c => c.op)).toEqual(["openWorkspace"]);
  await expect(service.provision(input, api)).rejects.toMatchObject({ code: "HELD" });
});

it("review O1: commented registry examples stay inactive while the raw reviewed fingerprint is retained", async () => {
  const path = join(home, "data/projects.md"), text = await readFile(path, "utf8"), next = `${text}\n<!-- old example\n${text.split("\n")[0]}\n-->\n`;
  await writeFile(path, next); const read = await service.read();
  expect(read.registryDigest).toBe(digest(next)); expect(read.projects.filter(p => p.name === "scheduler")).toHaveLength(1);
  expect(read.projects.find(p => p.name === "scheduler")?.reason).not.toMatch(/ambiguous/);
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
  await runtime.stop(); runtime = projectRuntimeFixture(data); service = make();
  await service.provision(input, api);
  expect((await service.read()).projects.find(p => p.name === "scheduler")).toMatchObject({ agentId: owner.agentId, workspaceId: owner.workspaceId, sessions: 1, turns: 1 });
  expect(receiver.calls).toHaveLength(3);
  await expect(service.provision({ ...input, projectVersion: input.projectVersion + 1 }, api)).rejects.toMatchObject({ code: "CONFLICT" });
});
it("lost opening stays uncertain across explicit resume and restart, with no extra send or identity", async () => {
  const read = await admit(), p = read.projects.find(p => p.name === "scheduler")!, input = { homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, requestId: randomUUID() };
  receiver.faults.send = ["lose"];
  await service.provision(input, api); await runtime.stop(); runtime = projectRuntimeFixture(data); service = make();
  await service.provision(input, api); await service.provision({ ...input, requestId: randomUUID() }, api);
  const latest = (await service.read()).projects.find(p => p.name === "scheduler")!;
  expect(latest).toMatchObject({ sessions: 1, turns: 1, uncertain: 1 }); expect(receiver.calls.filter(c => c.op === "send")).toHaveLength(1);
});
it("app stop also retains a legacy provisioning receipt that predates complete input metadata", async () => {
  const read = await admit(), p = read.projects.find(p => p.name === "scheduler")!, input = { homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, requestId: randomUUID() };
  await runtime.mutate(home, store => store.transactCommand(stableId("project-provision-input", input.requestId), digest(input),
    { kind: "plugin-ui-unverified", id: "unauthenticated-plugin-call", source: "project provision button (unverified)" },
    async () => ({ mutations: [], expectedVersions: [], result: { planId: null, planHash: null, decisionId: null, outboxId: null } })));
  receiver.faults.send = ["lose"]; await service.provision(input, api);
  expect((await service.read()).projects.find(row => row.projectId === p.projectId)?.provisionInput).toBeNull();
  await service.abort({ homeId: read.homeId, projectId: p.projectId!, projectVersion: p.version, provisionRequestId: input.requestId });
  await expect(service.provision(input, api)).rejects.toMatchObject({ code: "HELD" });
  expect(receiver.agents.size).toBe(1); expect(receiver.sends).toHaveLength(1);
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
  const secondInput = input(b);
  await expect(service.provision(secondInput, api)).rejects.toMatchObject({ code: "HELD", message: expect.stringContaining("General headroom") });
  expect(receiver.agents.size).toBe(1);
  receiver.finish(first.projects.find(p => p.name === "scheduler")!.agentId!);
  await service.provision(secondInput, api); expect(receiver.agents.size).toBe(2);
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
