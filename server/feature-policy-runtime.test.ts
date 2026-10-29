import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { DEFAULT_FEATURE_CAPACITY, FEATURES_OFF, type FeatureCapabilities } from "../shared/feature-settings";
import { FirstmateConfigSchema } from "../shared/fleet";
import { s04Fixture, captain } from "../test/supervision-s04-fixture";
import { FeaturePolicyRuntime, installFeaturePolicy } from "./feature-policy-runtime";
import { FeatureSettingsStore, legacyFeatureSettings } from "./feature-settings";
import { FeatureSettingsService, registerFeatureSettingsRpc } from "./feature-settings-rpc";
import { SupervisionRuntime } from "./supervision-runtime";
import { ProjectRuntime } from "./project-runtime";
import { MaintenanceRuntime } from "./maintenance-runtime";
import { SupervisionGateway } from "./supervision-effects";
import { SupervisorSessions, supervisorSpend } from "./supervisor-sessions";
import { ScopeRuntime } from "./scope-runtime";
import { SupervisionActivation } from "./supervision-activation";
import { askMate } from "./mate";
import { updateFirstmateConfig } from "./config";
import type { PaseoApi } from "./host-types";
import { registerScopeRpcs } from "./scope-rpc";
import { readScopes } from "../shared/supervision-rpc";
import { SupervisionStore } from "./supervision-store";
import { SyntheticReceiver } from "../test/synthetic-receiver";
import { syncFeatureHelpers } from "./home";

const change = (home: string, expectedRevision: number, requested: Partial<FeatureCapabilities>) => ({ home, expectedRevision, requestId: randomUUID(),
  change: { requested: { ...FEATURES_OFF, ...requested }, capacity: { ...DEFAULT_FEATURE_CAPACITY } } });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

it("project-only help supplies its checked reply transport without advertising plan execution, and pause retains it", async () => {
  const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(root, "home"), policy = new FeaturePolicyRuntime(root);
  await mkdir(join(home, "tools"), { recursive: true }); await mkdir(join(home, "data"));
  await writeFile(join(home, "AGENTS.md"), "Existing reviewed home.");
  const uninstall = installFeaturePolicy(policy);
  try {
    await policy.set(change(home, 0, { projectMates: true })); await syncFeatureHelpers(home);
    const transport = await readFile(join(home, "tools/scope.mjs"), "utf8");
    expect(transport).toContain("scope commands belong to their bound owners");
    expect(await readFile(join(home, "data/project-mates.md"), "utf8")).toContain("grant no plan execution or Attach");
    await expect(readFile(join(home, "data/plan-supervisors.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(home, "tools/maintenance.mjs"))).rejects.toMatchObject({ code: "ENOENT" });
    await policy.set(change(home, 1, {})); await syncFeatureHelpers(home);
    expect(await readFile(join(home, "tools/scope.mjs"), "utf8")).toBe(transport);
    expect((await policy.read(home)).effective).toEqual(FEATURES_OFF);
    expect((await readdir(root)).sort()).toEqual(["feature-settings", "home"]);
  } finally { uninstall(); }
});

it("two app clients hot-apply independent settings with CAS, no model/writer/clock creation, and home-bound legacy compatibility", async () => {
  const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(root, "home");
  const policy = new FeaturePolicyRuntime(root, legacyFeatureSettings(home, { FIRSTMATE_SCOPE_UI: "1" }));
  const create = vi.fn(), runtime = new SupervisionRuntime(root, create, policy);
  const config = async () => FirstmateConfigSchema.parse({ home, mateAgentId: "general" });
  const projects = new ProjectRuntime(runtime, { config, legacy: async () => ({ plans: [], problems: [] }) });
  const maintenance = new MaintenanceRuntime(runtime, { config, inventory: async () => ({ format: "firstmate.timer-inventory/1", complete: true, problems: [], rows: [], hashes: { config: "c", timers: "t", coverage: "v" } }) });
  const client = () => {
    const service = new FeatureSettingsService(root, { home: async () => home, runtime: policy }), handlers = new Map<string, (input: any) => Promise<any>>();
    registerFeatureSettingsRpc({ handle: (rpc: any, handler: any) => handlers.set(rpc.name, handler) } as any, service);
    return { read: (input: { home: string }) => handlers.get("firstmate.features.read")!(input),
      set: (input: Parameters<typeof service.set>[0]) => handlers.get("firstmate.features.set")!(input) };
  };
  const a = client(), b = client();
  expect((await a.read({ home })).effective).toEqual({ ...FEATURES_OFF, scopeUi: true });
  await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });
  await a.set(change(home, 0, { projectMates: true }));
  expect((await projects.read()).enabled).toBe(true);
  expect((await maintenance.read()).enabled).toBe(false);
  expect((await b.read({ home })).effective).toEqual({ ...FEATURES_OFF, projectMates: true });
  await expect(b.set(change(home, 0, {}))).rejects.toMatchObject({ code: "STALE" });
  const off = change(home, 1, {}); const receipt = await b.set(off);
  expect((await projects.read()).enabled).toBe(false);
  await a.set(change(home, 2, { projectMates: true }));
  expect(await a.set(off)).toEqual(receipt);
  expect((await projects.read()).enabled).toBe(true);
  expect((await policy.read(join(root, "other"))).effective).toEqual(FEATURES_OFF);
  expect(create).not.toHaveBeenCalled();
  expect(await readdir(root)).toEqual(["feature-settings"]);
  maintenance.stop(); await runtime.stop();
});

it("presentation/execution dependency is explicit, leaves requested pilot values intact and never enables plan or maintenance", async () => {
  const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(root, "home"), policy = new FeaturePolicyRuntime(root);
  await policy.set(change(home, 0, { scopeExecution: true }));
  expect(await policy.read(home)).toMatchObject({ requested: { scopeExecution: true }, effective: FEATURES_OFF,
    dependencyRefusals: [{ capability: "scopeExecution", code: "DEPENDENCY_DISABLED" }] });
  const runtime = new SupervisionRuntime(root, undefined, policy), config = async () => FirstmateConfigSchema.parse({ home });
  const scope = new ScopeRuntime(runtime, { config });
  await expect(scope.execute((await policy.read(home)).homeId, "general", {} as PaseoApi, async () => {})).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await policy.set(change(home, 1, { scopeUi: true, scopeExecution: true, projectMates: true }));
  expect((await policy.read(home)).effective).toEqual({ ...FEATURES_OFF, scopeUi: true, scopeExecution: true, projectMates: true });
  const handlers = new Map();
  registerScopeRpcs({ handle: (rpc: any, handler: any) => handlers.set(rpc.name, handler) } as any, {
    read: async () => ({ home, generalId: null, status: await runtime.read(home) }), readNeeds: vi.fn(), policy: h => policy.read(h),
  });
  expect(await handlers.get(readScopes.name)()).toMatchObject({ uiEnabled: true, executionEnabled: true });
  await policy.set(change(home, 2, {}));
  expect(await handlers.get(readScopes.name)()).toMatchObject({ uiEnabled: false, executionEnabled: false });
  await runtime.stop();
});

async function effectsFixture() {
  const f = await s04Fixture(), scope = await f.addScope(1, "hot-policy", ["probe"]);
  await f.draft(scope, [{ id: "probe" }]);
  const policy = new FeaturePolicyRuntime(join(f.home, "store"));
  await policy.set(change(f.home, 0, { planSupervisors: true }));
  const gateway = new SupervisionGateway(f.store, f.commands, f.home, f.receiver, { enabled: true, policyFence: policy.gateway(f.home, "planSupervisors") });
  const started = await f.start(scope, "probe");
  return { ...f, scope, policy, liveGateway: gateway, started };
}

it("disable during dispatch preflight refuses the unclaimed effect; re-enable permits the same identity and never refunds spend", async () => {
  const f = await effectsFixture(), entered = deferred(), release = deferred();
  const capabilities = f.receiver.capabilities.bind(f.receiver);
  vi.spyOn(f.receiver, "capabilities").mockImplementationOnce(async () => { entered.resolve(); await release.promise; return capabilities(); });
  const dispatch = f.liveGateway.dispatch(f.started.effects!.workspace); void dispatch.catch(() => {});
  await entered.promise; await f.policy.set(change(f.home, 1, {})); release.resolve();
  await expect(dispatch).rejects.toMatchObject({ code: "UNSUPPORTED" });
  const before = await f.store.read();
  expect(before.effects.find(e => e.id === f.started.effects!.workspace)?.state).toBe("reserved");
  expect(f.receiver.calls).toEqual([]);
  await f.policy.set(change(f.home, 2, { planSupervisors: true }));
  await f.liveGateway.dispatch(f.started.effects!.workspace);
  const after = await f.store.read();
  expect(after.attempts).toEqual(before.attempts);
  expect(f.receiver.calls.map(c => c.op)).toEqual(["openWorkspace"]);
  await f.store.releaseCoordinator();
});

it.each([false, true])("an in-flight send settles once after disable; lost=%s retains uncertainty and survives reload without resend", async lost => {
  const f = await effectsFixture();
  await f.liveGateway.dispatch(f.started.effects!.workspace); await f.liveGateway.dispatch(f.started.effects!.create);
  await f.liveGateway.verifyWorker(f.started.attemptId!);
  const entered = deferred(), release = deferred(); f.receiver.afterAdmission = entered.resolve; f.receiver.gate = release.promise;
  if (lost) f.receiver.faults.send = ["lose"];
  const dispatch = f.liveGateway.dispatch(f.started.effects!.send);
  await entered.promise;
  // This save must finish while the network reply is still blocked.
  await f.policy.set(change(f.home, 1, {}));
  const during = await f.store.read(), attempt = during.attempts[0]!;
  expect(during.effects.find(e => e.id === f.started.effects!.send)?.state).toBe("dispatching");
  release.resolve(); await dispatch;
  const after = await f.store.read();
  expect(after.effects.find(e => e.id === f.started.effects!.send)?.state).toBe(lost ? "uncertain" : "succeeded");
  expect(after.attempts[0]).toMatchObject({ id: attempt.id, worker: attempt.worker, spentAgents: attempt.spentAgents, spentTurns: attempt.spentTurns });
  await f.store.releaseCoordinator();
  const restarted = new FeaturePolicyRuntime(join(f.home, "store"));
  expect((await restarted.read(f.home)).effective).toEqual(FEATURES_OFF);
  await f.store.acquireCoordinator();
  await f.liveGateway.reconcile(f.started.effects!.send);
  if (lost) await expect(f.liveGateway.dispatch(f.started.effects!.send)).rejects.toMatchObject({ code: "UNCERTAIN" });
  else await expect(f.liveGateway.dispatch(f.started.effects!.send)).resolves.toMatchObject({ state: "succeeded" });
  expect(f.receiver.sends).toHaveLength(1);
  expect((await f.store.read()).bindings).toEqual(after.bindings);
  expect((await f.store.read()).attempts).toEqual(after.attempts);
  await f.store.releaseCoordinator();
});

it("a saved-policy revision fences preflight even after off/on, and damaged settings fail closed", async () => {
  const f = await effectsFixture(), fence = f.policy.gateway(f.home, "planSupervisors");
  const effect = (await f.store.read()).effects[0]!, captured = await fence.capture(effect);
  await f.policy.set(change(f.home, 1, {})); await f.policy.set(change(f.home, 2, { planSupervisors: true }));
  const run = vi.fn(async () => {});
  await expect(fence.run(captured, run)).rejects.toMatchObject({ code: "STALE" }); expect(run).not.toHaveBeenCalled();
  const store = new FeatureSettingsStore(join(f.home, "store"), f.home);
  await writeFile(join(store.directory, "0000000000000003.json"), "damaged");
  expect(await f.policy.read(f.home)).toMatchObject({ state: "held", effective: FEATURES_OFF });
  await expect(f.liveGateway.dispatch(f.started.effects!.workspace)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(f.receiver.calls).toEqual([]); await f.store.releaseCoordinator();
});

it("a different runtime cannot dispatch a disabled discussion capability's reserved effect", async () => {
  const f = await effectsFixture(), discussion = await f.addScope(2, "discussion-origin", [], false);
  await f.policy.set(change(f.home, 1, { planSupervisors: true, scopeUi: true, scopeExecution: true }));
  const sessions = new SupervisorSessions(f.store, f.liveGateway, f.receiver, { enabled: true, limits: { supervisorSessions: 1, supervisorTurns: 1 },
    globalMateId: async () => f.state.globalMate, featurePolicy: () => f.policy.reservation(f.home, "scopeExecution") });
  await sessions.prepare({ requestId: randomUUID(), scopeId: discussion.id, scopeVersion: 1, purpose: "discussion",
    profile: { provider: "codex/test", modeId: "full-access" }, opening: "Discuss this plan only." }, captain);
  const effect = (await f.store.read()).effects.find(e => e.scopeId === discussion.id && e.operation === "workspace.open")!;
  expect(effect.featurePolicy).toEqual({ capability: "scopeExecution", revision: 2 });
  await f.policy.set(change(f.home, 2, { planSupervisors: true }));
  await expect(f.liveGateway.dispatch(effect.id)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(f.receiver.calls).toEqual([]);
  const handlers = new Map<string, () => Promise<unknown>>();
  registerScopeRpcs({ handle: (rpc: any, handler: any) => handlers.set(rpc.name, handler) } as any, {
    // The unrelated S04 worker plan uses a short synthetic owner ID, outside the app UUID contract.
    read: async () => ({ home: f.home, generalId: f.state.globalMate, status: { ...await f.store.read(), plans: [] } }), readNeeds: vi.fn(), policy: h => f.policy.read(h),
  });
  expect(readScopes.output.parse(await handlers.get(readScopes.name)!()).activation?.pause).toBe("Paused for new work; checking 3 saved operations");
  // The origin stamp is part of the store's immutable effect identity, not editable dispatch input.
  await expect(f.store.transact([{ kind: "effect", id: effect.id, version: effect.version }], randomUUID(), [
    { kind: "effect", value: { ...effect, featurePolicy: { capability: "planSupervisors", revision: 3 }, version: effect.version + 1 } },
  ])).rejects.toMatchObject({ code: "HELD" });
  await f.store.releaseCoordinator();
});

it("a reviewed capacity reduction takes effect before a reserved native creation", async () => {
  const f = await effectsFixture(), input = change(f.home, 1, { planSupervisors: true });
  input.change.capacity = { slots: 2, generalHeadroom: 1 };
  await f.policy.set(input);
  const { checkGeneralHeadroom } = await import("./supervision-headroom");
  const gateway = new SupervisionGateway(f.store, f.commands, f.home, f.receiver, { enabled: true,
    policyFence: f.policy.gateway(f.home, "planSupervisors"), admissionCheck: async (status, effect) => {
      const capacity = await f.policy.capacity(f.home);
      await checkGeneralHeadroom(status, f.receiver, capacity.slots, capacity.generalHeadroom, effect.id);
    } });
  await expect(gateway.dispatch(f.started.effects!.workspace)).rejects.toMatchObject({ code: "HELD" });
  expect(f.receiver.calls).toEqual([]);
  expect((await f.store.read()).effects.find(e => e.id === f.started.effects!.workspace)?.state).toBe("reserved");
  await f.store.releaseCoordinator();
});

it("disabled reservation guard creates no new turn; prior receipts/spend and General chat are independent", async () => {
  const f = await effectsFixture(), runtime = new SupervisionRuntime(join(f.home, "store"), () => f.store, f.policy);
  const sessions = new SupervisorSessions(f.store, f.liveGateway, f.receiver, { enabled: true,
    limits: { supervisorSessions: 1, supervisorTurns: 5 }, globalMateId: async () => f.state.globalMate,
    reserveBoundary: run => f.policy.boundary(f.home, run), reserveCheck: async () => { await f.policy.check(f.home, "planSupervisors"); } });
  const before = await f.files(), spend = supervisorSpend(await f.store.read(), f.scope.id);
  await f.policy.set(change(f.home, 1, {}));
  await expect(sessions.reserveTurnWith({ requestId: randomUUID(), scopeId: f.scope.id, epoch: 1, causation: "new-input", text: "new turn" }, captain)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(await f.files()).toEqual(before); expect(supervisorSpend(await f.store.read(), f.scope.id)).toEqual(spend);
  const config = FirstmateConfigSchema.parse({ home: f.home, mateAgentId: f.state.globalMate });
  const activation = new SupervisionActivation(join(f.home, "store"), { runtime, config: async () => config, adapters: vi.fn() });
  await expect(activation.attach({ homeId: f.store.homeId } as any, {} as PaseoApi)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await updateFirstmateConfig({ home: f.home, mateAgentId: "" });
  await updateFirstmateConfig({ mateAgentId: f.state.globalMate! });
  const send = vi.fn(async () => {}), api = { agents: { ref: () => ({ send, refresh: async () => ({ agent: { id: f.state.globalMate, status: "idle", archivedAt: null } }) }) } } as unknown as PaseoApi;
  await askMate(api, { text: "Independent captain message" }); expect(send).toHaveBeenCalledOnce();
  await runtime.stop(); await f.store.releaseCoordinator();
});

it.each(["project", "maintenance"] as const)("%s provisioning hot-pauses after workspace admission and resumes only its retained request", async kind => {
  const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(root, "home"), projectPath = join(home, "project");
  await mkdir(join(home, "data"), { recursive: true }); await mkdir(projectPath);
  await writeFile(join(home, "data/projects.md"), `- Reader [local-only] - ${projectPath}\n`);
  const orders = "Reviewed bounded project help.\n"; await writeFile(join(home, "data/orders.md"), orders);
  const policy = new FeaturePolicyRuntime(root), receiver = new SyntheticReceiver();
  const create = vi.fn((data: string, path: string) => new SupervisionStore(data, path, { writable: true,
    processIdentity: async () => ({ state: "alive", start: "hot-policy-fixture" }) }));
  const runtime = new SupervisionRuntime(root, create, policy), config = async () => FirstmateConfigSchema.parse({ home, mateAgentId: "general" });
  const project = new ProjectRuntime(runtime, { config, receiver: () => receiver, legacy: async () => ({ plans: [], problems: [] }) });
  const maintenance = new MaintenanceRuntime(runtime, { config, receiver: () => receiver, inventory: vi.fn() });
  const service = new FeatureSettingsService(root, { home: async () => home, runtime: policy, readInventory: h => runtime.read(h) });
  await service.set(change(home, 0, kind === "project" ? { projectMates: true } : { maintenance: true }));
  const profile = { provider: "codex/test", modeId: "full-access" }, limits = { supervisorSessions: 1 as const, supervisorTurns: 4 };
  let provision: () => Promise<unknown>;
  if (kind === "project") {
    const before = await project.read(), hash = (v: string) => createHash("sha256").update(v).digest("hex");
    const admitted = await project.admin({ homeId: before.homeId, requestId: randomUUID(), actorId: "general", command: {
      op: "admit", name: "Reader", aliases: [], registryDigest: before.registryDigest!, budget: { agents: 2, turns: 4 }, profile, limits,
      source: { id: randomUUID(), version: 1, path: "data/orders.md", lineStart: 1, lineEnd: 1, fileHash: hash(orders), excerptHash: hash(orders.trimEnd()),
        provenance: { kind: "mate-chat", id: "general", source: "project administration (same-user role convention, unverified)" }, supersedes: [] } } });
    const row = admitted.projects[0]!, input = { homeId: admitted.homeId, requestId: randomUUID(), projectId: row.projectId!, projectVersion: row.version };
    provision = () => project.provision(input, {} as PaseoApi);
  } else {
    const input = { homeId: (await policy.read(home)).homeId, requestId: randomUUID(), scopeId: randomUUID(), name: "Routine checks", profile, limits };
    provision = () => maintenance.admit(input, {} as PaseoApi);
  }
  const entered = deferred(), release = deferred(); receiver.afterAdmission = entered.resolve; receiver.gate = release.promise;
  const pending = provision(); void pending.catch(() => {});
  await entered.promise; await service.set(change(home, 1, {})); release.resolve();
  await expect(pending).rejects.toMatchObject({ code: "UNSUPPORTED" });
  const paused = await runtime.read(home), binding = paused.bindings[0]!;
  expect(receiver.calls.map(c => c.op)).toEqual(["openWorkspace"]);
  expect(binding.state).toBe("prepared"); expect(supervisorSpend(paused, binding.scopeId)).toMatchObject({ sessions: 1, turns: 1 });
  expect((await service.read({ home })).pause).toBe("Paused for new work; checking 2 saved operations");
  expect((await project.read()).enabled).toBe(false); expect((await maintenance.read()).enabled).toBe(false);
  await service.set(change(home, 2, kind === "project" ? { projectMates: true } : { maintenance: true }));
  receiver.afterAdmission = null; receiver.gate = null;
  await provision(); await provision();
  const resumed = await runtime.read(home);
  expect(resumed.bindings[0]).toMatchObject({ agentId: binding.agentId, epoch: binding.epoch, state: "active" });
  expect(receiver.agents.size).toBe(1); expect(receiver.sends).toHaveLength(1); expect(create).toHaveBeenCalledOnce();
  expect(supervisorSpend(resumed, binding.scopeId)).toMatchObject({ sessions: 1, turns: 1 });
  maintenance.stop(); await runtime.stop();
});
