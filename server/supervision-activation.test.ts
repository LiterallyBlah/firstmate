import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { workflowFixture } from "../test/workflow-fixture";
import { SyntheticReceiver } from "../test/synthetic-receiver";
import { AttachSupervisorInputSchema, ResumeSupervisorInputSchema, MigrationCommandSchema, type AttachSupervisorInput, type MigrationCommand } from "../shared/supervision-activation";
import { SupervisionActivation, registerSupervisionActivation } from "./supervision-activation";
import { SupervisionStore } from "./supervision-store";
import { SupervisionRuntime } from "./supervision-runtime";
import { pluginDir } from "./data-dir";
import { updateFirstmateConfig } from "./config";
import { workflowStore } from "./workflow-service";
import { legacyAdapters, SupervisionMigrator } from "./supervision-migrate";
import { NeedsYouService, readConfiguredDecisionHome } from "./needs-you-service";
import { workflowHomeIdentity } from "./workflow-ownership";
import type { PaseoApi } from "./host-types";
vi.setConfig({ testTimeout: 30000 });
const root = process.env.PASEO_HOME!;
let home: string, activation: SupervisionActivation, receiver: SyntheticReceiver, ledger: NeedsYouService, clock: number;
let prepare: Extract<MigrationCommand, { op: "prepare" | "resume" }>;
beforeEach(async () => {
  process.env.PASEO_HOME = join(root, randomUUID()); home = join(process.env.PASEO_HOME, "home");
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "data/backlog.md"), "# Backlog\n## In flight\n## Queued\n## Done\n");
  await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null });
  await updateFirstmateConfig({ mateAgentId: "general" });
  await workflowStore(home).execute({ op: "draft", definition: workflowFixture() }, randomUUID(), "general");
  clock = 1000;
  ledger = new NeedsYouService({ root: join(process.env.PASEO_HOME!, "ledger"), home: readConfiguredDecisionHome,
    catalog: async () => null, enabled: () => true, now: () => clock });
  await ledger.read(); clock += 2000; await ledger.read();
  receiver = new SyntheticReceiver();
  activation = make(true);
  prepare = { op: "prepare", homeId: workflowHomeIdentity(home), plan: "scheduler", scopeId: randomUUID(), projectId: randomUUID(),
    migrationId: randomUUID(), prerequisites: { inventory: "drained inventory", policy: "reviewed policy", rollbackBuild: "compatible build" } };
});
afterEach(async () => { await activation?.stop(); await ledger?.stop(); });
function make(enabled?: boolean) { return new SupervisionActivation(pluginDir(), { ...(enabled === undefined ? {} : { enabled }),
  adapters: () => legacyAdapters(null, () => ledger.read()), receiver: () => receiver }); }
const api = {} as PaseoApi;
it("the shared runtime supports production migration and the existing Attach beyond the pilot history ceiling", async () => {
  const runtime = new SupervisionRuntime(pluginDir());
  try {
    await runtime.mutate(home, async store => {
      await store.enableLongLived();
      for (let n = 0; n < 260; n++) await store.transactCommand(randomUUID(), "a".repeat(64), { kind: "system", id: "load", source: "isolated-multi-service-fixture" },
        async () => ({ expectedVersions: [], mutations: [], result: { planId: null, planHash: null, decisionId: null, outboxId: null } }));
    });
    activation = new SupervisionActivation(pluginDir(), { enabled: true, runtime, adapters: () => legacyAdapters(null, () => ledger.read()), receiver: () => receiver });
    await cutover(); const input = await attachment();
    const next = await activation.attach(input, api);
    expect(next.plans[0]).toMatchObject({ binding: "active", opening: "succeeded" });
    expect((await runtime.read(home)).sequence).toBeGreaterThan(260);
  } finally { await activation.stop(); await runtime.stop(); }
}, 120000);
async function cutover() {
  await activation.migrate(prepare);
  await activation.migrate({ op: "reconcile", homeId: prepare.homeId, migrationId: prepare.migrationId });
  await activation.migrate({ op: "barrier", homeId: prepare.homeId, migrationId: prepare.migrationId });
  return activation.migrate({ op: "commit", homeId: prepare.homeId, migrationId: prepare.migrationId });
}
async function attachment(): Promise<AttachSupervisorInput> {
  const plan = (await activation.read()).plans[0]!;
  return { requestId: randomUUID(), homeId: prepare.homeId, plan: plan.plan, planHash: plan.hash, scopeId: plan.scopeId,
    scopeVersion: plan.scopeVersion, supervisorId: plan.supervisorId, profile: { provider: "codex/gpt-6.1-sol", modeId: "full-access" }, opening: "Supervise Scheduler only; do not invoke attach." };
}
it("default off: view and every mutation leave supervision, gate and receiver untouched", async () => {
  activation = make();
  expect((await activation.read()).enabled).toBe(false);
  await expect(activation.migrate(prepare)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(activation.attach({ homeId: prepare.homeId } as AttachSupervisorInput, api)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(activation.attach({ homeId: prepare.homeId, requestId: randomUUID(), resume: true }, api)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(stat(join(pluginDir(), "supervision"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(receiver.calls).toEqual([]);
});
it("enabled views still create no journal or coordinator; stale home refuses before writing", async () => {
  expect((await activation.read()).enabled).toBe(true);
  await expect(activation.migrate({ ...prepare, homeId: "another-home" })).rejects.toMatchObject({ code: "STALE" });
  await expect(stat(join(pluginDir(), "supervision"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("production adapters migrate one plan and attach once, auditing unverified provenance before dispatch", async () => {
  const before = await cutover(); expect(before.plans[0]!.canAttach).toBe(true);
  const input = await attachment();
  const originalOpen = receiver.openWorkspace.bind(receiver);
  vi.spyOn(receiver, "openWorkspace").mockImplementationOnce(async intent => {
    const beforeExternalEffect = await new SupervisionStore(pluginDir(), home).read();
    expect(beforeExternalEffect.commands.find(c => c.id === input.requestId)?.result.attachmentAudit?.supervisor).toBe(input.supervisorId);
    expect(beforeExternalEffect.effects.find(e => e.operation === "workspace.open")?.state).toBe("dispatching");
    return originalOpen(intent);
  });
  const next = await activation.attach(input, api);
  expect(next.plans[0]).toMatchObject({ supervisorId: input.supervisorId, binding: "active", opening: "succeeded", canAttach: false });
  expect(next.audits).toEqual([{ at: expect.any(String), plan: "scheduler", supervisor: input.supervisorId,
    source: "client UI (unverified)", authorization: "by convention, not verified" }]);
  const status = await new SupervisionStore(pluginDir(), home).read();
  expect(status.commands.find(c => c.id === input.requestId)?.actor).toEqual({ kind: "plugin-ui-unverified", id: "unauthenticated-plugin-call", source: "client UI (unverified)" });
  expect(receiver.calls.map(c => c.op)).toEqual(["openWorkspace", "createAgent", "send"]);
  await activation.attach(input, api);
  expect(receiver.calls).toHaveLength(3); expect((await activation.read()).audits).toHaveLength(1);
  await expect(activation.attach({ ...input, requestId: randomUUID() }, api)).rejects.toMatchObject({ code: "STALE" });
  await expect(activation.attach({ ...input, opening: "different opening" }, api)).rejects.toMatchObject({ code: "CONFLICT" });
});
it("stale plan/supervisor and uncommitted cutovers cannot attach", async () => {
  await activation.migrate(prepare);
  const input = await attachment();
  await expect(activation.attach(input, api)).rejects.toMatchObject({ code: "HELD" });
  await activation.migrate({ op: "barrier", homeId: prepare.homeId, migrationId: prepare.migrationId });
  await activation.migrate({ op: "commit", homeId: prepare.homeId, migrationId: prepare.migrationId });
  const fresh = await attachment();
  await expect(activation.attach({ ...fresh, planHash: "a".repeat(64) }, api)).rejects.toMatchObject({ code: "STALE" });
  await expect(activation.attach({ ...fresh, supervisorId: randomUUID() }, api)).rejects.toMatchObject({ code: "STALE" });
  expect(receiver.calls).toEqual([]); expect((await activation.read()).audits).toEqual([]);
});
it("audit survives an unknown opening; retry does not resend or spend another session", async () => {
  await cutover(); const input = await attachment(); receiver.faults.send = ["lose"];
  const next = await activation.attach(input, api);
  expect(next.plans[0]!.opening).toBe("uncertain"); expect(next.audits).toHaveLength(1);
  await activation.attach(input, api);
  expect(receiver.calls.filter(c => c.op === "send")).toHaveLength(1);
  const status = await new SupervisionStore(pluginDir(), home).read();
  expect(status.effects.filter(e => e.operation === "agent.create")).toHaveLength(1);
});
it("abort uses S07 restoration and cleanup releases the coordinator for a later plugin instance", async () => {
  await activation.migrate(prepare);
  const snapshot = await activation.migrate({ op: "abort", homeId: prepare.homeId, migrationId: prepare.migrationId, reason: "Return to legacy" });
  expect(snapshot.migrations[0]!.state).toBe("aborted"); expect(snapshot.plans.every(p => !p.canAttach)).toBe(true);
  await activation.stop(); activation = make(true);
  await expect(activation.migrate({ ...prepare, op: "resume" })).resolves.toMatchObject({ migrations: [expect.objectContaining({ state: "aborted" })] });
});
it("production resume accepts the original fields after freeze-before-receipt interruption", async () => {
  const store = new SupervisionStore(pluginDir(), home, { writable: true });
  await store.initialize(); await store.acquireCoordinator();
  const migrator = new SupervisionMigrator({ home, store, legacy: workflowStore(home), adapters: legacyAdapters(null, () => ledger.read()),
    enabled: true, boundary: async name => { if (name === "frozen") throw new Error("interrupted after freeze"); } });
  await migrator.arm(); await expect(migrator.prepare(prepare)).rejects.toThrow("interrupted after freeze");
  expect((await store.read()).migrations).toEqual([]); await store.releaseCoordinator();
  const resumed = await activation.migrate({ ...prepare, op: "resume" });
  expect(resumed.migrations[0]).toMatchObject({ id: prepare.migrationId, state: "prepared" });
  await activation.migrate({ op: "abort", homeId: prepare.homeId, migrationId: prepare.migrationId, reason: "End isolated recovery check" });
});
it("strict RPCs accept no actor/source and no attach operation exists on migration or home/CLI tools", async () => {
  await cutover();
  expect(AttachSupervisorInputSchema.safeParse({ ...await attachment(), actor: { kind: "captain-ui" } }).success).toBe(false);
  for (const extra of [{ actor: { kind: "captain-ui" } }, { supervisorId: randomUUID() }, { opening: "replacement opening" }, { profile: { provider: "codex/test", modeId: "" } }])
    expect(ResumeSupervisorInputSchema.safeParse({ homeId: prepare.homeId, requestId: randomUUID(), resume: true, ...extra }).success).toBe(false);
  expect(MigrationCommandSchema.safeParse({ ...prepare, op: "attach" }).success).toBe(false);
  const handlers: string[] = [];
  registerSupervisionActivation({ handle: (rpc: { name: string }) => { handlers.push(rpc.name); } } as never, activation);
  expect(handlers).toEqual(["firstmate.supervision.activation", "firstmate.supervision.migrate", "firstmate.supervision.attach-ui"]);
  for (const file of await readdir("templates/tools")) {
    const source = await readFile(join("templates/tools", file), "utf8");
    expect(source).not.toMatch(/attach-ui|attachSupervisorFromUi|attachFromUnverifiedUi/);
  }
  for (const file of ["server/scope-requests.ts", "server/workflow-service.ts", "server/cli.ts", "index.client.tsx"])
    expect(await readFile(file, "utf8")).not.toMatch(/attach-ui|attachSupervisorFromUi|attachFromUnverifiedUi/);
});
