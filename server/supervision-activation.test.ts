import { createHash, randomUUID } from "node:crypto";
import { MigrationSettings } from "./migration-settings";
import { acceptPolicyInventory, policyRef } from "./supervision-policy";
import { SupervisionProjects } from "./supervision-projects";
import { PolicySourceSchema } from "../shared/supervision-policy";
import { workflowSnapshot } from "./workflow-board";
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
import { askMate } from "./mate";
import { evidenceReferences } from "../shared/plan-help";
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
async function guided() {
  await activation.stop();
  const backupSettings = new MigrationSettings(pluginDir()), runtime = new SupervisionRuntime(pluginDir());
  const actor = { kind: "captain-ui", id: "fixture", source: "isolated-test" } as const;
  const orders = "Reviewed project permissions.\n", sha = (s: string) => createHash("sha256").update(s).digest("hex");
  await writeFile(join(home, "data/orders.md"), orders);
  await runtime.mutate(home, async store => {
    const source = PolicySourceSchema.parse({ id: randomUUID(), version: 1, path: "data/orders.md", lineStart: 1, lineEnd: 1,
      fileHash: sha(orders), excerptHash: sha(orders.trimEnd()), provenance: actor, supersedes: [] });
    await acceptPolicyInventory(store, home, randomUUID(), actor, { sources: [source], rules: [] }, true);
    const projectId = randomUUID(), scopeId = randomUUID();
    await store.transact([{ kind: "scope", id: scopeId, version: 0 }], randomUUID(), [{ kind: "scope", value: { id: scopeId, homeId: store.homeId,
      kind: "project", projectIds: [projectId], sponsorId: null, version: 1, mode: "scoped", state: "active" } }]);
    await new SupervisionProjects(store, { enabled: true }).recordProject(randomUUID(), actor, { projectId, expectedVersion: 0,
      scopeId, name: "scheduler", aliases: [], state: "admitted", budget: { agents: 2, turns: 2 }, sourceVector: [policyRef("policy-source", source)] });
  });
  activation = new SupervisionActivation(pluginDir(), { enabled: true, runtime, backupSettings,
    adapters: () => legacyAdapters(null, () => ledger.read()), receiver: () => receiver });
  const destination = join(process.env.PASEO_HOME!, "independent-backups"); await mkdir(destination);
  await activation.saveBackup({ homeId: prepare.homeId, expectedRevision: 0, requestId: randomUUID(), backup: { destination, retention: "Retain for 30 days; operator-managed." } });
  return { runtime, backupSettings };
}
it("guided preview and backup configuration start no session; reviewed handover preserves bytes and only unlocks the original Attach", async () => {
  const { runtime } = await guided();
  try {
    const before = await runtime.read(home), review = await activation.planHelp(prepare.homeId, "scheduler");
    expect(review.problems).toEqual([]); expect(receiver.calls).toEqual([]);
    expect((await runtime.read(home)).sequence).toBe(before.sequence);
    const files = await readdir(join(workflowStore(home).root, "scheduler"));
    const bytes = await Promise.all(files.filter(f => /^\d+\.json$/.test(f)).map(f => readFile(join(workflowStore(home).root, "scheduler", f), "utf8")));
    const command = { ...prepare, scopeId: review.scopeId, projectId: review.projectId!, migrationId: review.migrationId, reviewHash: review.reviewHash };
    await activation.migrate(command);
    expect((await activation.planHelp(prepare.homeId, "scheduler")).preparation).toEqual(command);
    expect(receiver.calls).toEqual([]); expect((await activation.read()).plans[0]?.canAttach).toBe(false);
    for (const op of ["reconcile", "barrier", "commit"] as const) await activation.migrate({ homeId: prepare.homeId, migrationId: review.migrationId, op });
    expect(receiver.calls).toEqual([]); expect((await activation.read()).plans[0]?.canAttach).toBe(true);
    const receipt = (await activation.read()).migrations[0]!;
    expect(receipt.prerequisites.snapshot?.retention).toContain("30 days");
    expect(await Promise.all(files.filter(f => /^\d+\.json$/.test(f)).map(f => readFile(join(workflowStore(home).root, "scheduler", f), "utf8")))).toEqual(bytes);
    const attached = await activation.attach(await attachment(), api);
    expect(attached.plans[0]).toMatchObject({ binding: "active", opening: "succeeded" });
    expect(attached.audits[0]?.source).toBe("client UI (unverified)");
  } finally { await activation.stop(); await runtime.stop(); }
});
it("a changed reviewed source/backup or incomplete decision census holds guided handover before freeze", async () => {
  const { runtime } = await guided();
  try {
    const review = await activation.planHelp(prepare.homeId, "scheduler");
    const command = { ...prepare, scopeId: review.scopeId, projectId: review.projectId!, migrationId: review.migrationId, reviewHash: review.reviewHash };
    vi.spyOn(ledger, "read").mockResolvedValueOnce(null as never);
    expect((await activation.planHelp(prepare.homeId, "scheduler")).problems.join(" ")).toContain("Decisions haven't all been checked");
    await activation.saveBackup({ homeId: prepare.homeId, requestId: randomUUID(), expectedRevision: 1, backup: { destination: (await activation.readBackup(prepare.homeId)).backup!.destination, retention: "Keep indefinitely" } });
    await expect(activation.migrate(command)).rejects.toMatchObject({ code: "STALE" });
    expect(await workflowStore(home).cutover("scheduler")).toBe(null);
    await writeFile(join(home, "data/orders.md"), "changed permission source\n");
    expect((await activation.planHelp(prepare.homeId, "scheduler")).problems.join(" ")).toContain("Permission evidence changed");
    await expect(activation.migrate(command)).rejects.toMatchObject({ code: "HELD" });
    expect(await workflowStore(home).cutover("scheduler")).toBe(null); expect(receiver.calls).toEqual([]);
  } finally { await activation.stop(); await runtime.stop(); }
});
it("an interrupted freeze retains a named app recovery entry and resumes its exact saved preparation after restart", async () => {
  const { runtime, backupSettings } = await guided();
  let resumed: SupervisionRuntime | undefined;
  try {
    const review = await activation.planHelp(prepare.homeId, "scheduler");
    const command = { ...prepare, scopeId: review.scopeId, projectId: review.projectId!, migrationId: review.migrationId, reviewHash: review.reviewHash };
    const crash = vi.spyOn(SupervisionStore.prototype, "transact").mockRejectedValueOnce(new Error("interrupted before prepared receipt"));
    await expect(activation.migrate(command)).rejects.toThrow("interrupted before prepared receipt"); crash.mockRestore();
    expect(await workflowStore(home).cutover("scheduler")).toBe("freeze");
    expect((await workflowSnapshot(home, await runtime.read(home))).planHelpPending).toEqual([{ plan: "scheduler", title: "Scheduler" }]);
    await activation.stop(); await runtime.stop();
    resumed = new SupervisionRuntime(pluginDir());
    activation = new SupervisionActivation(pluginDir(), { enabled: true, runtime: resumed, backupSettings,
      adapters: () => legacyAdapters(null, () => ledger.read()), receiver: () => receiver });
    expect((await activation.planHelp(prepare.homeId, "scheduler")).preparation).toEqual(command);
    const next = await activation.migrate({ ...command, op: "resume" });
    expect(next.migrations).toHaveLength(1); expect(next.migrations[0]?.id).toBe(command.migrationId);
    expect(next.plans[0]?.scopeId).toBe(command.scopeId); expect(next.audits).toEqual([]); expect(receiver.calls).toEqual([]);
  } finally { await activation.stop(); await resumed?.stop(); await runtime.stop(); }
});
it("R3: an explicit corrected review after preflight refuses retains old evidence and can prepare before freeze", async () => {
  const { runtime } = await guided();
  try {
    const review = await activation.planHelp(prepare.homeId, "scheduler");
    const command = { ...prepare, scopeId: review.scopeId, projectId: review.projectId!, migrationId: review.migrationId, reviewHash: review.reviewHash };
    const failure = vi.spyOn(SupervisionStore.prototype, "validate").mockRejectedValueOnce(new Error("temporary preflight hold"));
    await expect(activation.migrate(command)).rejects.toThrow("temporary preflight hold"); failure.mockRestore();
    expect(await workflowStore(home).cutover("scheduler")).toBe(null);
    expect((await activation.read()).migrations).toEqual([]);
    const originalPath = join(pluginDir(), "plan-help-preparations");
    const original = await readdir(originalPath, { recursive: true });
    const originalBytes = await Promise.all(original.filter(f => f.endsWith(".json")).map(f => readFile(join(originalPath, f), "utf8")));
    const originalReview = await activation.planHelp(prepare.homeId, "scheduler");
    expect(originalReview.migrationId).not.toBe(command.migrationId);
    const backupRoot = (await activation.readBackup(prepare.homeId)).backup!.destination;
    expect(await readFile(join(backupRoot, command.migrationId, "manifest.json"), "utf8")).toContain(command.migrationId);
    await activation.saveBackup({ homeId: prepare.homeId, expectedRevision: 1, requestId: randomUUID(), backup: { destination: (await activation.readBackup(prepare.homeId)).backup!.destination, retention: "Keep indefinitely" } });
    const fresh = await activation.planHelp(prepare.homeId, "scheduler");
    expect(fresh.problems).toEqual([]); expect(fresh.reviewHash).not.toBe(command.reviewHash);
    await expect(activation.migrate({ ...command, op: "resume" })).rejects.toMatchObject({ code: "STALE" });
    const corrected = { ...command, migrationId: fresh.migrationId, reviewHash: fresh.reviewHash, replacesReview: command.reviewHash };
    expect((await activation.migrate(corrected)).migrations).toHaveLength(1);
    expect(await readdir(originalPath, { recursive: true })).toEqual(expect.arrayContaining(original));
    expect(await Promise.all(original.filter(f => f.endsWith(".json")).map(f => readFile(join(originalPath, f), "utf8")))).toEqual(originalBytes);
    expect(await readdir(backupRoot)).toEqual(expect.arrayContaining([command.migrationId, fresh.migrationId]));
    expect(receiver.calls).toEqual([]);
    // Once frozen/accepted, a newly reviewed body cannot replace the saved preparation.
    await expect(activation.migrate({ ...corrected, prerequisites: { ...corrected.prerequisites, inventory: "different" }, replacesReview: fresh.reviewHash })).rejects.toMatchObject({ code: "CONFLICT" });
  } finally { await activation.stop(); await runtime.stop(); }
});
it("R4: selected real rollback report, current inventory and accepted sources are read-only and rechecked before freeze", async () => {
  const { runtime } = await guided();
  try {
    const report = "Retained FirstMate build: isolated tested build; location: reviewed test archive.\nRecovery test: exact S07 history and external-effect reconciliation verified.\n";
    await writeFile(join(home, "data/rollback.md"), report);
    const before = await runtime.read(home), evidence = await activation.evidence({ homeId: prepare.homeId, plan: "scheduler", folder: "data", rollbackPath: "data/rollback.md" });
    expect(evidence.problems).toEqual([]); expect(evidence.inventory?.problems).toEqual([]);
    expect(evidence.entries).toContainEqual({ name: "rollback.md", path: "data/rollback.md", kind: "file" });
    expect(evidence.rollback?.content).toBe(report); expect(evidence.policy?.sources[0]?.content).toBe("Reviewed project permissions.");
    expect((await runtime.read(home)).sequence).toBe(before.sequence); expect(await workflowStore(home).cutover("scheduler")).toBe(null); expect(receiver.calls).toEqual([]);
    const review = await activation.planHelp(prepare.homeId, "scheduler");
    const selected = { inventory: evidence.inventory!.hash, policy: evidence.policy!.hash, rollback: { path: evidence.rollback!.path, hash: evidence.rollback!.hash } };
    const command = { ...prepare, migrationId: review.migrationId, scopeId: review.scopeId, projectId: review.projectId!, reviewHash: review.reviewHash,
      evidence: selected, prerequisites: evidenceReferences(selected) };
    await writeFile(join(home, "data/rollback.md"), `${report}Changed after selection.\n`);
    await expect(activation.migrate(command)).rejects.toMatchObject({ code: "STALE" });
    expect(await workflowStore(home).cutover("scheduler")).toBe(null);
    await writeFile(join(home, "data/rollback.md"), report);
    const prepared = await activation.migrate(command);
    expect(prepared.migrations).toHaveLength(1); expect(receiver.calls).toEqual([]);
    expect(await readFile(join(prepared.migrations[0]!.prerequisites.snapshot!.path, "handover/rollback-report.txt"), "utf8")).toBe(report);
    const missing = await activation.evidence({ homeId: prepare.homeId, plan: "scheduler", folder: "data", rollbackPath: "../outside.md" });
    expect(missing.rollback).toBe(null); expect(missing.problems.join(" ")).toContain("Choose a text report");
  } finally { await activation.stop(); await runtime.stop(); }
});
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
it("Attach native provisioning leaves General's conversation queue available", async () => {
  await cutover(); const input = await attachment();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(done => { release = done; }), ready = new Promise<void>(done => { entered = done; });
  const original = receiver.openWorkspace.bind(receiver);
  vi.spyOn(receiver, "openWorkspace").mockImplementationOnce(async intent => { entered(); await gate; return original(intent); });
  const attaching = activation.attach(input, api);
  let captain: Promise<unknown> | undefined;
  try {
    await ready;
    const send = vi.fn(async () => {});
    captain = askMate({ agents: { ref: () => ({ refresh: async () => ({ agent: { id: "general", archivedAt: null, status: "idle" } }), send }) } } as unknown as PaseoApi,
      { text: "captain request during Attach" });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1), { timeout: 2000 });
  } finally { release(); await Promise.all([attaching, captain]); }
  expect((await activation.read()).plans[0]).toMatchObject({ binding: "active", opening: "succeeded" });
});
it("Attach rechecks General ownership after receiver IO and resumes only the original reserved identity", async () => {
  await cutover(); const input = await attachment(), original = receiver.openWorkspace.bind(receiver);
  vi.spyOn(receiver, "openWorkspace").mockImplementationOnce(async intent => {
    const workspace = await original(intent); await updateFirstmateConfig({ mateAgentId: "new-general" }); return workspace;
  });
  await expect(activation.attach(input, api)).rejects.toMatchObject({ code: "STALE" });
  expect(receiver.calls.map(c => c.op)).toEqual(["openWorkspace"]);
  await updateFirstmateConfig({ mateAgentId: "general" });
  await activation.attach({ homeId: input.homeId, requestId: input.requestId, resume: true }, api);
  expect(receiver.agents.size).toBe(1); expect([...receiver.agents.keys()]).toEqual([input.supervisorId]);
  expect(receiver.calls.map(c => c.op)).toEqual(["openWorkspace", "createAgent", "send"]);
});
it("Attach refuses a General change during capability lookup before reserving any identity or spend", async () => {
  await cutover(); const input = await attachment(), original = receiver.capabilities.bind(receiver);
  vi.spyOn(receiver, "capabilities").mockImplementationOnce(async () => {
    await updateFirstmateConfig({ mateAgentId: "new-general" }); return original();
  });
  await expect(activation.attach(input, api)).rejects.toMatchObject({ code: "STALE" });
  const held = await new SupervisionStore(pluginDir(), home).read();
  expect(held.bindings).toEqual([]); expect(held.effects).toEqual([]); expect(receiver.calls).toEqual([]);
  await updateFirstmateConfig({ mateAgentId: "general" });
  await activation.attach(input, api);
  expect([...receiver.agents.keys()]).toEqual([input.supervisorId]); expect(receiver.sends).toHaveLength(1);
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
  expect(handlers).toEqual(["firstmate.supervision.plan-help.evidence", "firstmate.supervision.backup.read", "firstmate.supervision.backup.set", "firstmate.supervision.plan-help.read", "firstmate.supervision.activation", "firstmate.supervision.migrate", "firstmate.supervision.attach-ui"]);
  for (const file of await readdir("templates/tools")) {
    const source = await readFile(join("templates/tools", file), "utf8");
    expect(source).not.toMatch(/attach-ui|attachSupervisorFromUi|attachFromUnverifiedUi/);
  }
  for (const file of ["server/scope-requests.ts", "server/workflow-service.ts", "server/cli.ts", "index.client.tsx"])
    expect(await readFile(file, "utf8")).not.toMatch(/attach-ui|attachSupervisorFromUi|attachFromUnverifiedUi/);
});
