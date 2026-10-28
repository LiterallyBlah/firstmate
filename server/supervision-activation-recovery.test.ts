/** Production service, S07 queues and SDK receiver; only the daemon's network boundary is simulated. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPaseoApi } from "@getpaseo/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { workflowFixture } from "../test/workflow-fixture";
import { WARMUP_TIMEOUT_MS, warmWindowsIdentityProbe } from "../test/supervision-warmup";
import type { AttachSupervisorInput, MigrationCommand } from "../shared/supervision-activation";
import { SupervisionActivation } from "./supervision-activation";
import { SupervisionStore } from "./supervision-store";
import { legacyAdapters, SupervisionMigrator } from "./supervision-migrate";
import { cutoverGate } from "./supervision-gate";
import { WatchRunner, watchItem } from "./watches";
import { NeedsYouService, readConfiguredDecisionHome } from "./needs-you-service";
import { updateFirstmateConfig } from "./config";
import { pluginDir } from "./data-dir";
import { workflowStore } from "./workflow-service";
import { workflowHomeIdentity } from "./workflow-ownership";
import type { PaseoAgent } from "./host-types";
import { canonical, digest } from "./submissions";

vi.setConfig({ testTimeout: 30000 });
const root = process.env.PASEO_HOME!;
let home: string, activation: SupervisionActivation, ledger: NeedsYouService, runner: WatchRunner;
let input: Extract<MigrationCommand, { op: "prepare" | "resume" }>;
let fixtureStore: SupervisionStore | undefined;
type Daemon = Parameters<typeof createPaseoApi>[0];
type CreateOptions = Parameters<Daemon["createAgent"]>[0];
function nativeDaemon() {
  const agents = new Map<string, PaseoAgent>(), workspaces: { id: string; workspaceDirectory: string }[] = [];
  let loseCreate = false, visible = true;
  const openProject = vi.fn(async (cwd: string) => {
    const workspace = { id: randomUUID(), workspaceDirectory: cwd }; workspaces.push(workspace); return { workspace };
  });
  const createAgent = vi.fn(async (options: CreateOptions) => {
    const config = options.config;
    if (!config?.cwd || !options.agentId) throw new Error("Native create requires its reserved identity and workspace");
    const agent: PaseoAgent = { id: options.agentId, provider: config.provider, model: config.model ?? null,
      cwd: config.cwd, ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}), labels: options.labels ?? {},
      currentModeId: config.modeId ?? null, thinkingOptionId: config.thinkingOptionId ?? null,
      status: "idle", pendingPermissions: [], archivedAt: null, createdAt: "2026-10-28T12:00:00Z", updatedAt: "2026-10-28T12:00:00Z",
      lastUserMessageAt: null, availableModes: [], persistence: null, title: options.config?.title ?? null,
      capabilities: { supportsStreaming: false, supportsSessionPersistence: true, supportsDynamicModes: false,
        supportsMcpServers: false, supportsReasoningStream: false, supportsToolInvocations: true } };
    agents.set(agent.id, agent);
    if (loseCreate) { loseCreate = false; throw new Error("create reply lost after native creation"); }
    return agent;
  });
  const sendAgentMessage = vi.fn(async () => {});
  // Exercise the installed SDK's provider/model parsing and workspace/agent handles too.
  const api = createPaseoApi({ openProject, createAgent, sendAgentMessage,
    fetchWorkspaces: async () => ({ entries: workspaces, pageInfo: { nextCursor: null } }),
    fetchAgent: async ({ agentId }: { agentId: string }) => ({ agent: visible ? agents.get(agentId) ?? null : null }),
  } as unknown as Daemon);
  return { api, agents, createAgent, openProject, sendAgentMessage,
    loseCreate: () => { loseCreate = true; }, visible: (value: boolean) => { visible = value; } };
}
let native: ReturnType<typeof nativeDaemon>;
// As in the crash suite, pay the cold Windows host startup before the real, unchanged 5 s probes.
beforeAll(async () => {
  if (process.platform === "win32") await warmWindowsIdentityProbe();
}, WARMUP_TIMEOUT_MS + 10000);
beforeEach(async () => {
  process.env.PASEO_HOME = join(root, randomUUID()); home = join(process.env.PASEO_HOME, "home");
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "data/backlog.md"), "# Backlog\n## In flight\n## Queued\n## Done\n");
  await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null });
  await updateFirstmateConfig({ mateAgentId: "general" });
  await workflowStore(home).execute({ op: "draft", definition: workflowFixture() }, randomUUID(), "general");
  let clock = 1000;
  ledger = new NeedsYouService({ root: join(pluginDir(), "ledger"), home: readConfiguredDecisionHome,
    catalog: async () => null, enabled: () => true, now: () => clock });
  await ledger.read(); clock += 2000; await ledger.read();
  runner = new WatchRunner({ home: async () => home, disabled: async () => [], deliver: async () => "wait",
    gate: async () => ({ gate: cutoverGate(home), recipient: "general" }),
    stateFile: join(pluginDir(), "watches.json"), scriptStateRoot: join(pluginDir(), "watch-state") });
  native = nativeDaemon(); activation = make();
  input = { op: "prepare", homeId: workflowHomeIdentity(home), plan: "scheduler", scopeId: randomUUID(), projectId: randomUUID(),
    migrationId: randomUUID(), prerequisites: { inventory: "checked inventory", policy: "reviewed policy", rollbackBuild: "retained build" } };
});
afterEach(async () => { await activation.stop(); await fixtureStore?.releaseCoordinator(); fixtureStore = undefined;
  runner.stop(); await ledger.stop(); await native.api.dispose(); });
function make() { return new SupervisionActivation(pluginDir(), { enabled: true, adapters: () => legacyAdapters(runner, () => ledger.read()) }); }
const op = (op: "reconcile" | "barrier" | "commit") => ({ op, homeId: input.homeId, migrationId: input.migrationId });
const abort = () => ({ op: "abort" as const, homeId: input.homeId, migrationId: input.migrationId, reason: "Release isolated cutover" });
async function cutover() { await activation.migrate(input); await activation.migrate(op("reconcile"));
  await activation.migrate(op("barrier")); await activation.migrate(op("commit")); }
async function attachment(): Promise<AttachSupervisorInput> {
  const plan = (await activation.read()).plans[0]!;
  return { requestId: randomUUID(), homeId: input.homeId, plan: plan.plan, planHash: plan.hash, scopeId: plan.scopeId,
    scopeVersion: plan.scopeVersion, supervisorId: plan.supervisorId, profile: { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" },
    opening: "Supervise Scheduler only; never invoke attach." };
}
async function interrupted(boundary?: (name: string) => Promise<void>, storeBoundary?: (name: string) => Promise<void>) {
  fixtureStore = new SupervisionStore(pluginDir(), home, { writable: true, ...(storeBoundary ? { boundary: storeBoundary } : {}) });
  await fixtureStore.initialize(); await fixtureStore.acquireCoordinator();
  const migrator = new SupervisionMigrator({ home, store: fixtureStore, legacy: workflowStore(home),
    adapters: legacyAdapters(runner, () => ledger.read()), enabled: true, ...(boundary ? { boundary } : {}) });
  await migrator.arm(); return migrator;
}
async function handBack() { await fixtureStore!.releaseCoordinator(); fixtureStore = undefined; }

it("A1: a real attach through the production receiver and installed SDK reaches opening sent", async () => {
  await cutover(); const request = await attachment();
  const result = await activation.attach(request, native.api);
  expect(result.plans[0]).toMatchObject({ binding: "active", opening: "succeeded", canAttach: false });
  expect(native.createAgent).toHaveBeenCalledOnce();
  expect(native.createAgent.mock.calls[0]![0]).toMatchObject({ agentId: request.supervisorId, idempotencyKey: request.supervisorId,
    config: { provider: "codex", model: "gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" } });
  expect(native.createAgent.mock.calls[0]![0]).not.toHaveProperty("initialPrompt");
  expect(native.createAgent.mock.calls[0]![0]).not.toHaveProperty("callerAgentId");
  expect(native.agents.get(request.supervisorId)).toMatchObject({ provider: "codex", model: "gpt-6.1-sol" });
  expect(native.sendAgentMessage).toHaveBeenCalledWith(request.supervisorId, request.opening,
    { messageId: expect.stringMatching(/^firstmate-s04-/), activeTurnBehavior: "steer" });
  await activation.attach(request, native.api);
  expect(native.openProject).toHaveBeenCalledOnce(); expect(native.createAgent).toHaveBeenCalledOnce();
  expect(native.sendAgentMessage).toHaveBeenCalledOnce(); expect((await activation.read()).audits).toHaveLength(1);
});
it("B1: a lost create reply is reconciled from the exact observed supervisor after service restart", async () => {
  await cutover(); const request = await attachment(); native.loseCreate();
  expect((await activation.attach(request, native.api)).plans[0]).toMatchObject({ binding: "prepared", opening: "reserved" });
  expect(native.agents.has(request.supervisorId)).toBe(true);
  await activation.stop(); activation = make();
  expect((await activation.attach(request, native.api)).plans[0]).toMatchObject({ binding: "active", opening: "succeeded" });
  expect(native.openProject).toHaveBeenCalledOnce(); expect(native.createAgent).toHaveBeenCalledOnce();
  expect(native.sendAgentMessage).toHaveBeenCalledOnce(); expect((await activation.read()).audits).toHaveLength(1);
});
it("B1: a negative lookup never recreates the supervisor; a changed model never receives the opening", async () => {
  await cutover(); const request = await attachment(); native.loseCreate();
  await activation.attach(request, native.api); native.visible(false);
  const missing = await activation.attach(request, native.api);
  expect(missing.plans[0]).toMatchObject({ binding: "prepared", opening: "reserved" });
  expect(native.createAgent).toHaveBeenCalledOnce(); expect(native.sendAgentMessage).not.toHaveBeenCalled();
  native.visible(true); native.agents.get(request.supervisorId)!.model = "different-model";
  await expect(activation.attach(request, native.api)).rejects.toMatchObject({ code: "HELD", message: expect.stringContaining("settings differ") });
  expect(native.createAgent).toHaveBeenCalledOnce(); expect(native.sendAgentMessage).not.toHaveBeenCalled();
});
it("B1: a fresh client resumes only the durable audited attachment, without retaining its original form", async () => {
  await cutover(); const request = await attachment(); native.loseCreate();
  await activation.attach(request, native.api); await activation.stop(); activation = make();
  const plan = (await activation.read()).plans[0]!;
  expect(plan).toHaveProperty("resumeRequestId", request.requestId);
  const resume = { homeId: input.homeId, requestId: request.requestId, resume: true } as const;
  const completed = await activation.attach(resume, native.api);
  expect(completed.plans[0]).toMatchObject({ binding: "active", opening: "succeeded", resumeRequestId: null });
  await activation.attach(resume, native.api);
  await expect(activation.attach({ ...resume, requestId: randomUUID() }, native.api)).rejects.toMatchObject({ code: "HELD" });
  expect(native.createAgent).toHaveBeenCalledOnce(); expect(native.sendAgentMessage).toHaveBeenCalledOnce();
  expect(completed.audits).toHaveLength(1);
});
it("B2: production resume publishes an exact interrupted event/tip, then resumes and aborts idempotently", async () => {
  let crashed = false;
  const migrator = await interrupted(undefined, async name => { if (name === "event:linked" && !crashed) { crashed = true; throw new Error("crash before publication"); } });
  await expect(migrator.prepare(input)).rejects.toMatchObject({ code: "HELD" }); await handBack();
  expect((await activation.read()).problems).toContain("Final transaction awaits publication.");
  const resumed = await activation.migrate({ ...input, op: "resume" });
  expect(resumed.problems).toEqual([]); expect(resumed.migrations[0]).toMatchObject({ id: input.migrationId, state: "prepared" });
  expect((await activation.migrate({ ...input, op: "resume" })).migrations).toEqual(resumed.migrations);
  const released = await activation.migrate(abort()); expect(released.migrations[0]!.state).toBe("aborted");
  expect((await activation.migrate(abort())).migrations).toEqual(released.migrations);
  expect(native.openProject).not.toHaveBeenCalled(); expect(native.sendAgentMessage).not.toHaveBeenCalled();
});
it("B2: production resume refuses a missing event and leaves its retained tip intact", async () => {
  const migrator = await interrupted(undefined, async name => { if (name === "event:linked") throw new Error("crash"); });
  await expect(migrator.prepare(input)).rejects.toMatchObject({ code: "HELD" });
  const storeRoot = fixtureStore!.root;
  // Exact journal paths are intentionally inspected: recovery must not invent a missing event.
  const tipPath = join(storeRoot, "transactions", "000000000001.tip.json"), tipBytes = await readFile(tipPath);
  await unlink(join(storeRoot, "transactions", "000000000001.event.json")); await handBack();
  await expect(activation.migrate({ ...input, op: "resume" })).rejects.toMatchObject({ code: "HELD" });
  expect(await readFile(tipPath)).toEqual(tipBytes); expect(native.createAgent).not.toHaveBeenCalled();
});
it.each(["publication:linked", "checkpoint:written", "checkpoint:synced", "checkpoint:replaced"])(
  "B2-R1: fresh production resume recovers the published transaction at %s before acquiring its coordinator", async point => {
    let published = false, crashed = false;
    const migrator = await interrupted(undefined, async name => {
      if (name === "publication:linked") published = true;
      if (published && name === point && !crashed) { crashed = true; throw new Error("published before checkpoint completion"); }
    });
    await expect(migrator.prepare(input)).rejects.toMatchObject({ code: "HELD" });
    const storeRoot = fixtureStore!.root, checkpointPath = join(storeRoot, "checkpoint.json"); await handBack();
    const checkpoint = await readFile(checkpointPath);
    await activation.read(); expect(await readFile(checkpointPath)).toEqual(checkpoint);
    const disabled = new SupervisionActivation(pluginDir(), { enabled: false, adapters: () => legacyAdapters(runner, () => ledger.read()) });
    await expect(disabled.migrate({ ...input, op: "resume" })).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await disabled.stop(); expect(await readFile(checkpointPath)).toEqual(checkpoint);
    const [first, replay] = await Promise.all([activation.migrate({ ...input, op: "resume" }), activation.migrate({ ...input, op: "resume" })]);
    expect(first.migrations).toEqual(replay.migrations); expect(first.migrations[0]).toMatchObject({ id: input.migrationId, state: "prepared" });
    const status = await new SupervisionStore(pluginDir(), home).read();
    expect(status).toMatchObject({ sequence: 1, freshness: "current" }); expect(status.plans).toHaveLength(1);
    expect(JSON.parse(await readFile(checkpointPath, "utf8")).sequence).toBe(1);
    await activation.migrate(abort()); await activation.migrate(abort());
    expect(await new SupervisionStore(pluginDir(), home).read()).toMatchObject({ sequence: 2, migrations: [expect.objectContaining({ state: "aborted" })] });
    expect(native.openProject).not.toHaveBeenCalled(); expect(native.createAgent).not.toHaveBeenCalled(); expect(native.sendAgentMessage).not.toHaveBeenCalled();
  });
it.each(["event:linked", "publication:linked"])("B2-R1: direct production abort recovers prepare interrupted at %s after restart", async point => {
  let crashed = false;
  const migrator = await interrupted(undefined, async name => {
    if (name === point && !crashed) { crashed = true; throw new Error("interrupted prepare publication"); }
  });
  await expect(migrator.prepare(input)).rejects.toMatchObject({ code: "HELD" }); await handBack();
  const released = await activation.migrate(abort()); expect(released.migrations[0]!.state).toBe("aborted");
  await activation.migrate(abort()); expect((await new SupervisionStore(pluginDir(), home).read()).sequence).toBe(2);
  expect(await cutoverGate(home).sidecar(input.plan, "aborted")).not.toBeNull(); expect(native.createAgent).not.toHaveBeenCalled();
});
it("B2-R1: an attachment's published audit/effects recover from the journal after restart without another reservation", async () => {
  await cutover(); const request = await attachment();
  const writers = (activation as unknown as { writers: Map<string, SupervisionStore> }).writers;
  const writer = [...writers.values()][0]!; let crashed = false;
  // Inject only the real file-publication boundary; every adapter and store operation stays production.
  const boundary = vi.spyOn(writer as unknown as { boundary(name: string): Promise<void> }, "boundary").mockImplementation(async name => {
    if (name === "publication:linked" && !crashed) { crashed = true; throw new Error("published attachment before checkpoint"); }
  });
  await expect(activation.attach(request, native.api)).rejects.toMatchObject({ code: "HELD" });
  expect(native.openProject).not.toHaveBeenCalled(); boundary.mockRestore(); await activation.stop(); activation = make();
  const completed = await activation.attach(request, native.api);
  expect(completed.plans[0]).toMatchObject({ binding: "active", opening: "succeeded" });
  await activation.attach({ homeId: input.homeId, requestId: request.requestId, resume: true }, native.api);
  const status = await new SupervisionStore(pluginDir(), home).read();
  expect(status.effects.filter(e => e.operation === "agent.create")).toHaveLength(1); expect(completed.audits).toHaveLength(1);
  expect(native.openProject).toHaveBeenCalledOnce(); expect(native.createAgent).toHaveBeenCalledOnce(); expect(native.sendAgentMessage).toHaveBeenCalledOnce();
});
it.each(["missing-checkpoint", "divergent-checkpoint", "corrupt-checkpoint", "shortened-journal"])(
  "B2-R1: production recovery refuses %s and retains the checkpoint witness", async damage => {
    await activation.migrate(input); await activation.stop(); activation = make();
    const storeRoot = new SupervisionStore(pluginDir(), home).root, checkpointPath = join(storeRoot, "checkpoint.json");
    if (damage === "missing-checkpoint") await unlink(checkpointPath);
    if (damage === "corrupt-checkpoint") await writeFile(checkpointPath, "incomplete{");
    if (damage === "divergent-checkpoint") {
      const { hash: _hash, ...checkpoint } = JSON.parse(await readFile(checkpointPath, "utf8")); checkpoint.prefixDigest = "a".repeat(64);
      await writeFile(checkpointPath, `${canonical({ ...checkpoint, hash: digest(checkpoint) })}\n`);
    }
    if (damage === "shortened-journal") for (const suffix of ["event", "tip", "publication"])
      await unlink(join(storeRoot, "transactions", `000000000001.${suffix}.json`));
    const witness = damage === "missing-checkpoint" ? null : await readFile(checkpointPath);
    for (const command of [{ ...input, op: "resume" as const }, abort()])
      await expect(activation.migrate(command)).rejects.toMatchObject({ code: "HELD" });
    if (witness) expect(await readFile(checkpointPath)).toEqual(witness);
    else await expect(readFile(checkpointPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await activation.read()).migrations).toEqual([]);
    expect(native.openProject).not.toHaveBeenCalled(); expect(native.createAgent).not.toHaveBeenCalled(); expect(native.sendAgentMessage).not.toHaveBeenCalled();
  });
it("B3: production resume accounts for a real late watch after freeze-before-receipt, then releases it unchanged", async () => {
  const migrator = await interrupted(async name => { if (name === "frozen") throw new Error("crash after freeze"); });
  await expect(migrator.prepare(input)).rejects.toThrow("crash after freeze"); await handBack();
  await expect(runner.enqueuePrompt("late-plan-note", "scheduler requires attention", new Date("2026-10-28T12:00:00Z"))).rejects.toThrow();
  const queued = await runner.queued(); expect(queued).toHaveLength(1);
  await expect(activation.migrate({ ...input, op: "resume", scopeId: randomUUID() })).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
  const resumed = await activation.migrate({ ...input, op: "resume" });
  expect(resumed.migrations[0]!.state).toBe("prepared");
  expect(resumed.dispositions).toEqual([expect.objectContaining({ source: "watch-queue", route: "hold", imperative: true })]);
  expect((await activation.migrate({ ...input, op: "resume" })).dispositions).toEqual(resumed.dispositions);
  await expect(activation.migrate(op("barrier"))).rejects.toMatchObject({ code: "HELD" });
  const released = await activation.migrate(abort()); expect(released.migrations[0]!.state).toBe("aborted");
  await activation.migrate(abort()); expect(await runner.queued()).toEqual(queued);
  expect(await cutoverGate(home).sidecar(input.plan, "aborted")).not.toBeNull();
  expect(await cutoverGate(home).targets()).toEqual([]); expect(native.sendAgentMessage).not.toHaveBeenCalled();
});
it("B3: resume distinguishes original watches from late watches even after flush protects both", async () => {
  const migrator = await interrupted(async name => { if (name === "frozen") throw new Error("crash after freeze"); });
  // This row arrives after arm but BEFORE freeze: an armed preexisting set cannot identify it.
  await runner.enqueuePrompt("original-plan-note", "scheduler original output", new Date("2026-10-28T11:00:00Z"));
  await expect(migrator.prepare(input)).rejects.toThrow("crash after freeze"); await handBack();
  await expect(runner.enqueuePrompt("late-plan-note", "scheduler late output", new Date("2026-10-28T12:00:00Z"))).rejects.toThrow();
  await runner.flush(); const queued = await runner.queued();
  expect(queued).toHaveLength(2); expect(queued.every(q => q.hold?.stage === "freeze")).toBe(true);
  const resumed = await activation.migrate({ ...input, op: "resume" });
  expect(resumed.dispositions).toHaveLength(2); expect(resumed.dispositions.every(d => d.route === "hold")).toBe(true);
  await activation.migrate(abort()); expect(await runner.queued()).toEqual(queued);
});
it("B3: a lost original watch cannot be hidden by a late held row or a shorter matching attempt", async () => {
  const migrator = await interrupted(async name => { if (name === "frozen") throw new Error("crash after freeze"); });
  await runner.enqueuePrompt("original-plan-note", "scheduler original output", new Date("2026-10-28T11:00:00Z"));
  await expect(migrator.prepare(input)).rejects.toThrow("crash after freeze"); await handBack();
  const original = watchItem((await runner.queued())[0]!);
  // Simulate lost queue data using its real compare/remove boundary, never edit a journal or sidecar.
  expect(await runner.removeQueued(original.id, original.payloadHash)).toBe("removed");
  await expect(runner.enqueuePrompt("late-plan-note", "scheduler late output", new Date("2026-10-28T12:00:00Z"))).rejects.toThrow();
  await expect(activation.migrate({ ...input, op: "resume" })).rejects.toMatchObject({ code: "HELD" });
  expect((await activation.read()).migrations).toEqual([]);
  expect(await cutoverGate(home).sidecar(input.plan, "aborted")).toBeNull();
  expect(await runner.queued()).toHaveLength(1); expect(native.createAgent).not.toHaveBeenCalled();
});
