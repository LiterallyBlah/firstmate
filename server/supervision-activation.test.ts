import { createHash, randomUUID } from "node:crypto";
import { MigrationSettings } from "./migration-settings";
import { acceptPolicyInventory, policyRef } from "./supervision-policy";
import { SupervisionProjects } from "./supervision-projects";
import { PolicySourceSchema } from "../shared/supervision-policy";
import { workflowSnapshot } from "./workflow-board";
import { mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { WARMUP_TIMEOUT_MS, warmWindowsIdentityProbe } from "../test/supervision-warmup";
import { workflowFixture } from "../test/workflow-fixture";
import { SyntheticReceiver } from "../test/synthetic-receiver";
import { AttachSupervisorInputSchema, ResumeSupervisorInputSchema, MigrationCommandSchema, type AttachSupervisorInput, type MigrationCommand } from "../shared/supervision-activation";
import { SupervisionActivation, registerSupervisionActivation, decisionProblems } from "./supervision-activation";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { SupervisionStore } from "./supervision-store";
import { SupervisionRuntime } from "./supervision-runtime";
import { pluginDir } from "./data-dir";
import { readFirstmateConfig, updateFirstmateConfig } from "./config";
import { workflowStore } from "./workflow-service";
import { legacyAdapters, SupervisionMigrator } from "./supervision-migrate";
import { NeedsYouService, readConfiguredDecisionHome } from "./needs-you-service";
import { workflowHomeIdentity } from "./workflow-ownership";
import type { PaseoApi } from "./host-types";
import { askMate } from "./mate";
import { evidenceReferences } from "../shared/plan-help";
import { planSubjectHash } from "./workflow-plans";
import { digest } from "./submissions";
import { SUPERVISE_ACTOR_SOURCE, SUPERVISE_PROVENANCE } from "../shared/supervise";
vi.setConfig({ testTimeout: 30000 });
const root = process.env.PASEO_HOME!;
let home: string, activation: SupervisionActivation, receiver: SyntheticReceiver, ledger: NeedsYouService, clock: number;
let prepare: Extract<MigrationCommand, { op: "prepare" | "resume" }>;
// As in the crash and recovery suites, pay the cold Windows host startup before the real probes.
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
  clock = 1000;
  ledger = new NeedsYouService({ root: join(process.env.PASEO_HOME!, "ledger"), home: readConfiguredDecisionHome,
    catalog: async () => null, enabled: () => true, now: () => clock });
  await ledger.read(); clock += 2000; await ledger.read();
  receiver = new SyntheticReceiver(); receiver.supervisorRoot = pluginDir();
  activation = make(true);
  prepare = { op: "prepare", homeId: workflowHomeIdentity(home), plan: "scheduler", scopeId: randomUUID(), projectId: randomUUID(),
    migrationId: randomUUID(), prerequisites: { inventory: "drained inventory", policy: "reviewed policy", rollbackBuild: "compatible build" } };
});
afterEach(async () => { await activation?.stop(); await ledger?.stop(); });
function make(enabled?: boolean) { return new SupervisionActivation(pluginDir(), { ...(enabled === undefined ? {} : { enabled }),
  adapters: () => legacyAdapters(null, () => ledger.read()), receiver: () => receiver }); }
const api = { providers: { listAvailable: async () => ({ providers: [{ provider: "codex", available: true }] }),
  listModels: async () => ({ models: [{ id: "gpt-6.1-sol", label: "Sol", thinkingOptions: [] }] }),
  listModes: async () => ({ modes: [{ id: "full-access", label: "Full access" }] }) } } as unknown as PaseoApi;
async function guided(decisions: () => Promise<NeedsYouSnapshot> = () => ledger.read()) {
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
    adapters: () => legacyAdapters(null, decisions), receiver: () => receiver });
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
it("plan help keys its host check to the admitted project owner, a remote owner included", async () => {
  const { runtime } = await guided();
  try {
    expect((await activation.planHelp(prepare.homeId, "scheduler")).problems.join(" ")).not.toContain("host doesn't match");
    await runtime.mutate(home, async store => {
      const s = await store.read(), p = s.projects!.projects[0]!;
      await store.transact([{ kind: "project", id: p.id, version: p.version }], randomUUID(),
        [{ kind: "project", value: { ...p, version: p.version + 1, owner: { hostId: "srv_remote", directory: "/home/ariadne/work",
          registryDigest: "0".repeat(64), generalAgentId: "general", profile: { provider: "codex/gpt-6.1-sol", modeId: "full-access" },
          limits: { supervisorSessions: 1, supervisorTurns: 5 } } } }] as never);
    });
    // The plan's runs are local; a remote owner no longer matches them, with no change to the check itself.
    expect((await activation.planHelp(prepare.homeId, "scheduler")).problems.join(" ")).toContain("host doesn't match");
    expect(receiver.calls).toEqual([]);
  } finally { await activation.stop(); await runtime.stop(); }
});
it("a changed reviewed source/backup or incomplete decision census holds guided handover before freeze", async () => {
  const { runtime } = await guided();
  try {
    const review = await activation.planHelp(prepare.homeId, "scheduler");
    const command = { ...prepare, scopeId: review.scopeId, projectId: review.projectId!, migrationId: review.migrationId, reviewHash: review.reviewHash };
    const fresh = await ledger.read();
    vi.spyOn(ledger, "read").mockResolvedValueOnce({ ...fresh, freshness: { ...fresh.freshness, status: "stale", problems: ["Waiting for a stable backlog observation."] } });
    expect((await activation.planHelp(prepare.homeId, "scheduler")).problems.join(" ")).toContain("The backlog is still being changed");
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
it("N1: real approved work has plain next steps, exact hidden diagnostics and unchanged inventory holds", async () => {
  const { runtime } = await guided();
  try {
    const legacy = workflowStore(home), plan = (await legacy.get("scheduler"))!;
    await legacy.execute({ op: "captain", plan: "scheduler", revision: plan.revision, subjectHash: planSubjectHash(plan), action: "approve", text: "" }, randomUUID(), "board:captain");
    await mkdir(join(home, "data/trial"), { recursive: true });
    await writeFile(join(home, "data/trial/brief.md"), "Isolated trial; do not create a live worker.");
    await legacy.execute({ op: "start", plan: "scheduler", node: "trial" }, randomUUID(), "general");
    const handlers = new Map<string, (input: any) => Promise<any>>();
    registerSupervisionActivation({ handle: (rpc: any, fn: any) => handlers.set(rpc.name, fn) } as any, activation);
    const before = await runtime.read(home), review = await activation.planHelp(prepare.homeId, "scheduler");
    const dry = await new SupervisionMigrator({ home, store: new SupervisionStore(pluginDir(), home), legacy, adapters: legacyAdapters(null, () => ledger.read()), enabled: true }).dryRun({
      plan: "scheduler", scopeId: review.scopeId, projectId: review.projectId!, migrationId: review.migrationId, prerequisites: prepare.prerequisites });
    const evidence = await handlers.get("firstmate.supervision.plan-help.evidence")!({ homeId: prepare.homeId, plan: "scheduler", folder: "data" });
    expect(evidence.problems).toEqual([]); expect(evidence.inventory.problems).toEqual(dry.problems);
    const { sequence: _sequence, ceiling: _ceiling, problem: _problem, ...capacity } = dry.capacity;
    expect(evidence.inventory.hash).toBe(digest({ source: dry.sourceHash, dispositions: dry.dispositions, launches: dry.receipt.launches, dependents: dry.receipt.dependents, capacity }));
    const ordinary = evidence.inventory.summary.join("\n");
    expect(ordinary).toContain("2 saved items checked"); expect(ordinary).toContain("Scheduler");
    expect(ordinary).toContain("Wait for FirstMate to confirm that “Database trial” has finished");
    expect(ordinary).not.toMatch(/plan-action|worker-callback|scoped owner|quiescent|native callback|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    for (const d of dry.dispositions) {
      expect(evidence.inventory.details.join("\n")).toContain(d.source);
      expect(evidence.inventory.details.join("\n")).toContain(d.id);
      expect(evidence.inventory.details.join("\n")).toContain(d.reason);
    }
    expect(dry.dispositions.find(d => d.source === "worker-callback")?.route).toBe("hold");
    expect((await runtime.read(home)).sequence).toBe(before.sequence);
    expect(await legacy.cutover("scheduler")).toBe(null); expect(receiver.calls).toEqual([]);
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
it("foundation app controls read inertly, pin generations and retain an exact pending profile request without native work", async () => {
  await cutover(); const input = await attachment(); await activation.attach(input, api);
  const before = await new SupervisionStore(pluginDir(), home).read(), calls = receiver.calls.length;
  const review = await activation.readControls({ homeId: input.homeId, scopeId: input.scopeId }, api);
  expect(review.view.configurations).toHaveLength(1);
  expect(review.view.configurations[0]?.workspace?.directory).toBe(receiver.agents.get(before.bindings[0]!.agentId)?.cwd);
  expect(review.view.configurations[0]).toMatchObject({ resolved: input.profile, effectiveEpoch: 1, provenance: "client UI (unverified)" });
  expect((await new SupervisionStore(pluginDir(), home).read()).sequence).toBe(before.sequence);
  const stage = { op: "stage" as const, requestId: randomUUID(), homeId: input.homeId, scopeId: input.scopeId,
    expectedEpoch: 1, bindingDigest: review.view.bindingDigest, planHash: review.planHash, profile: input.profile,
    limits: review.limits!, policyDigest: review.policyDigest };
  await activation.control(stage, api); await activation.control(stage, api);
  const pending = await activation.readControls(stage, api);
  expect(pending.view.state).toBe("change-pending"); expect(pending.view.configurations).toHaveLength(2);
  expect(receiver.calls).toHaveLength(calls); expect((await new SupervisionStore(pluginDir(), home).read()).effects).toEqual(before.effects);
  await expect(activation.control({ ...stage, profile: { provider: "codex/missing", modeId: "full-access" } }, api)).rejects.toMatchObject({ code: "CONFLICT" });
});
it("foundation app pause is independent of transfer and exact resume leaves all original reservations intact", async () => {
  await cutover(); const input = await attachment(); await activation.attach(input, api);
  const review = await activation.readControls({ homeId: input.homeId, scopeId: input.scopeId }, api), before = await new SupervisionStore(pluginDir(), home).read();
  const pause = { op: "pause" as const, requestId: randomUUID(), homeId: input.homeId, scopeId: input.scopeId,
    expectedEpoch: 1, bindingDigest: review.view.bindingDigest, planHash: review.planHash };
  const paused = await activation.control(pause, api); expect(paused.view.state).toBe("paused"); expect(paused.view.binding?.state).toBe("active");
  const resumed = await activation.control({ ...pause, op: "resume", requestId: randomUUID(), expectedControlId: paused.view.controlId! }, api);
  expect(resumed.view.state).toBe("active"); expect((await new SupervisionStore(pluginDir(), home).read()).effects).toEqual(before.effects);
});
it("app retire is for a project's Supervisor only: a plan's is refused with nothing recorded", async () => {
  await cutover(); const input = await attachment(); await activation.attach(input, api);
  const review = await activation.readControls({ homeId: input.homeId, scopeId: input.scopeId }, api), before = await new SupervisionStore(pluginDir(), home).read();
  expect(review.kind).toBe("plan");
  await expect(activation.control({ op: "retire", requestId: randomUUID(), homeId: input.homeId, scopeId: input.scopeId, expectedEpoch: 1,
    bindingDigest: review.view.bindingDigest, planHash: review.planHash }, api)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect((await new SupervisionStore(pluginDir(), home).read()).sequence).toBe(before.sequence);
});
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

it("the current first mate runs the reviewed handover and Attach, recorded as mate-chat; a bare prepare, replay and takeover hold", async () => {
  const mate = { kind: "mate-chat", id: "general", source: SUPERVISE_ACTOR_SOURCE } as const;
  await expect(activation.migrate(prepare, { kind: "agent", id: "bound-supervisor", source: "scope helper" })).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
  await expect(activation.migrate(prepare, { ...mate, id: "crewmate-7" })).rejects.toMatchObject({ code: "STALE" });
  // F1: a bare first-mate prepare (no reviewHash, no evidence) never reaches the migrator.
  await expect(activation.migrate(prepare, mate)).rejects.toMatchObject({ code: "HELD" });
  await expect(activation.migrate({ ...prepare, op: "resume" }, mate)).rejects.toMatchObject({ code: "HELD" });
  expect(await workflowStore(home).cutover("scheduler")).toBe(null); expect(receiver.calls).toEqual([]);
  const { runtime } = await guided();
  try {
    // F6 (saveBackup half): the inner checked config refuses a non-mate actor id.
    await expect(activation.saveBackup({ homeId: prepare.homeId, expectedRevision: 1, requestId: randomUUID(),
      backup: (await activation.readBackup(prepare.homeId)).backup! }, SUPERVISE_PROVENANCE, "crewmate-7")).rejects.toMatchObject({ code: "STALE" });
    const report = "Retained FirstMate build: isolated tested build; location: reviewed test archive.\nRecovery test: exact S07 history and external-effect reconciliation verified.\n";
    await writeFile(join(home, "data/rollback.md"), report);
    const review = await activation.planHelp(prepare.homeId, "scheduler");
    expect(review.problems).toEqual([]);
    const evidence = await activation.evidence({ homeId: prepare.homeId, plan: "scheduler", folder: "data", rollbackPath: "data/rollback.md" });
    const selected = { inventory: evidence.inventory!.hash, policy: evidence.policy!.hash, rollback: { path: evidence.rollback!.path, hash: evidence.rollback!.hash } };
    const command = { ...prepare, scopeId: review.scopeId, projectId: review.projectId!, migrationId: review.migrationId, reviewHash: review.reviewHash,
      evidence: selected, prerequisites: evidenceReferences(selected) };
    // F1: reviewHash without checked evidence is still refused for the first mate.
    await expect(activation.migrate({ ...command, evidence: undefined }, mate)).rejects.toMatchObject({ code: "HELD" });
    expect(await workflowStore(home).cutover("scheduler")).toBe(null);
    await activation.migrate(command, mate);
    // F5: a successor first mate finishes the recorded handover; its own stages record it.
    await updateFirstmateConfig({ mateAgentId: "successor" });
    const successor = { ...mate, id: "successor" };
    await activation.migrate({ ...command, op: "resume" }, successor);
    await activation.migrate({ op: "reconcile", homeId: prepare.homeId, migrationId: review.migrationId }, successor);
    await activation.migrate({ op: "barrier", homeId: prepare.homeId, migrationId: review.migrationId }, successor);
    const committed = await activation.migrate({ op: "commit", homeId: prepare.homeId, migrationId: review.migrationId }, successor);
    expect(committed.migrations[0]).toMatchObject({ state: "committed" }); expect(committed.plans[0]!.canAttach).toBe(true);
    const input = await attachment();
    await expect(activation.attach(input, api, { kind: "agent", id: "bound-supervisor", source: "scope helper" })).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
    await expect(activation.attach(input, api, mate)).rejects.toMatchObject({ code: "STALE" });
    expect(receiver.calls).toEqual([]);
    const next = await activation.attach(input, api, successor);
    expect(next.plans[0]).toMatchObject({ supervisorId: input.supervisorId, binding: "active", opening: "succeeded", canAttach: false });
    expect(next.audits).toEqual([{ at: expect.any(String), plan: "scheduler", supervisor: input.supervisorId,
      source: "first mate tool (unverified)", authorization: "current first mate role convention, not verified" }]);
    let status = await new SupervisionStore(pluginDir(), home).read();
    expect(status.commands.find(c => c.id === input.requestId)?.actor).toEqual(successor);
    expect(status.commands.find(c => c.id === input.requestId)?.result.supervisorConfiguration?.provenance).toBe("first mate tool (unverified)");
    expect(receiver.calls.map(c => c.op)).toEqual(["openWorkspace", "createAgent", "send"]);
    await activation.attach(input, api, successor);
    await activation.attach({ homeId: input.homeId, requestId: input.requestId, resume: true }, api, successor);
    expect(receiver.calls).toHaveLength(3); expect((await activation.read()).audits).toHaveLength(1);
    // F5: the captain's app can take the recorded attachment over; the takeover itself is recorded.
    await activation.attach({ homeId: input.homeId, requestId: input.requestId, resume: true }, api);
    status = await new SupervisionStore(pluginDir(), home).read();
    expect(status.commands.some(c => c.actor.kind === "plugin-ui-unverified" && c.id !== input.requestId)).toBe(true);
    expect(receiver.calls).toHaveLength(3);
    await expect(activation.attach({ ...input, opening: "different opening" }, api, successor)).rejects.toMatchObject({ code: "CONFLICT" });
  } finally { await activation.stop(); await runtime.stop(); }
});
it("a first-mate prepare re-checks its evidence without listing a data/ folder over the picker's 200-entry cap", async () => {
  const mate = { kind: "mate-chat", id: "general", source: SUPERVISE_ACTOR_SOURCE } as const;
  const { runtime } = await guided();
  try {
    // A real home's data/ holds well over 200 entries; the evidence folder is a smaller one inside it.
    await Promise.all(Array.from({ length: 250 }, (_, i) => writeFile(join(home, `data/note-${i}.md`), "x")));
    await mkdir(join(home, "data/handover"), { recursive: true });
    await writeFile(join(home, "data/handover/rollback.md"), "Retained FirstMate build: isolated tested build.\nRecovery test: verified.\n");
    const review = await activation.planHelp(prepare.homeId, "scheduler");
    expect(review.problems).toEqual([]);
    const evidence = await activation.evidence({ homeId: prepare.homeId, plan: "scheduler", folder: "data/handover", rollbackPath: "data/handover/rollback.md" });
    expect(evidence.problems).toEqual([]);
    const selected = { inventory: evidence.inventory!.hash, policy: evidence.policy!.hash, rollback: { path: evidence.rollback!.path, hash: evidence.rollback!.hash } };
    const command = { ...prepare, scopeId: review.scopeId, projectId: review.projectId!, migrationId: review.migrationId, reviewHash: review.reviewHash,
      evidence: selected, prerequisites: evidenceReferences(selected) };
    // The real checks still hold: a changed rollback report is stale.
    await expect(activation.migrate({ ...command, evidence: { ...selected, rollback: { ...selected.rollback, hash: "a".repeat(64) } } }, mate)).rejects.toMatchObject({ code: "STALE" });
    const prepared = await activation.migrate(command, mate);
    expect(prepared.migrations[0]).toMatchObject({ planId: "scheduler" });
  } finally { await activation.stop(); await runtime.stop(); }
});
async function unrelatedActivity(runtime: SupervisionRuntime, transactions: number) {
  // Another plan's helper, a scoped tick or a timer: journal transactions that touch nothing of this plan.
  await runtime.mutate(home, async store => {
    for (let n = 0; n < transactions; n++) await store.transactCommand(randomUUID(), "a".repeat(64), { kind: "system", id: "load", source: "isolated-unrelated-activity" },
      async () => ({ expectedVersions: [], mutations: [], result: { planId: null, planHash: null, decisionId: null, outboxId: null } }));
  });
}
async function selectedEvidence(rollbackPath: string) {
  const review = await activation.planHelp(prepare.homeId, "scheduler");
  expect(review.problems).toEqual([]);
  const evidence = await activation.evidence({ homeId: prepare.homeId, plan: "scheduler", folder: "data", rollbackPath });
  expect(evidence.problems).toEqual([]); expect(evidence.inventory?.problems).toEqual([]);
  const selected = { inventory: evidence.inventory!.hash, policy: evidence.policy!.hash, rollback: { path: evidence.rollback!.path, hash: evidence.rollback!.hash } };
  return { review, selected, command: { ...prepare, scopeId: review.scopeId, projectId: review.projectId!, migrationId: review.migrationId, reviewHash: review.reviewHash,
    evidence: selected, prerequisites: evidenceReferences(selected) } };
}
it("handover evidence is stable across unrelated journal activity, and the first mate's prepare is not refused for it", async () => {
  const mate = { kind: "mate-chat", id: "general", source: SUPERVISE_ACTOR_SOURCE } as const;
  const { runtime } = await guided();
  try {
    await writeFile(join(home, "data/rollback.md"), "Retained FirstMate build: isolated tested build.\nRecovery test: verified.\n");
    const first = await selectedEvidence("data/rollback.md"), before = await runtime.read(home);
    const dryRun = () => new SupervisionMigrator({ home, store: new SupervisionStore(pluginDir(), home), legacy: workflowStore(home), adapters: legacyAdapters(null, () => ledger.read()), enabled: true })
      .dryRun({ plan: "scheduler", scopeId: first.review.scopeId, projectId: first.review.projectId!, migrationId: first.review.migrationId, prerequisites: prepare.prerequisites });
    const dryBefore = await dryRun();
    await unrelatedActivity(runtime, 5);
    const after = await runtime.read(home), dryAfter = await dryRun();
    // The journal's sequence and size moved; nothing the handover depends on did.
    expect(after.sequence).toBeGreaterThan(before.sequence); expect(after.storage.bytes).toBeGreaterThan(before.storage.bytes);
    // The volatile part of the dry run is its capacity snapshot of the journal: sequence and ceiling.
    expect(dryAfter.capacity.sequence).toBeGreaterThan(dryBefore.capacity.sequence);
    const { sequence: _s1, ceiling: _c1, ...stableBefore } = dryBefore.capacity, { sequence: _s2, ceiling: _c2, ...stableAfter } = dryAfter.capacity;
    expect(stableAfter).toEqual(stableBefore);
    expect({ source: dryAfter.sourceHash, dispositions: dryAfter.dispositions, launches: dryAfter.receipt.launches, dependents: dryAfter.receipt.dependents })
      .toEqual({ source: dryBefore.sourceHash, dispositions: dryBefore.dispositions, launches: dryBefore.receipt.launches, dependents: dryBefore.receipt.dependents });
    const second = await selectedEvidence("data/rollback.md");
    expect(second.selected).toEqual(first.selected);
    await unrelatedActivity(runtime, 3);
    const prepared = await activation.migrate(first.command, mate);
    expect(prepared.migrations[0]).toMatchObject({ planId: "scheduler" });
    // Capacity is still checked live by the cutover itself, against the journal as it is now.
    expect(prepared.migrations[0]!.capacity.sequenceAtFreeze).toBeGreaterThan(after.sequence);
  } finally { await activation.stop(); await runtime.stop(); }
});
it("a real change to launches, dependents, deliveries or the plan still refuses a first-mate prepare as stale", async () => {
  const mate = { kind: "mate-chat", id: "general", source: SUPERVISE_ACTOR_SOURCE } as const;
  const { runtime } = await guided();
  try {
    await writeFile(join(home, "data/rollback.md"), "Retained FirstMate build: isolated tested build.\nRecovery test: verified.\n");
    const legacy = workflowStore(home), stale = { code: "STALE", message: expect.stringContaining("Handover evidence changed") };
    // A new launch record for one of the plan's own steps.
    let { command } = await selectedEvidence("data/rollback.md");
    await mkdir(join(home, "data/trial/launches"), { recursive: true });
    await writeFile(join(home, "data/trial/launches/1.json"), JSON.stringify({ state: "abandoned" }));
    await expect(activation.migrate(command, mate)).rejects.toMatchObject(stale);
    // A new plan with a step that depends on this one.
    ({ command } = await selectedEvidence("data/rollback.md"));
    const fixture = workflowFixture(), base = fixture.nodes.find(n => n.id === "trial")!;
    await legacy.execute({ op: "draft", definition: { ...fixture, id: "dependent", title: "Dependent",
      nodes: [{ ...base, id: "follow-up", title: "Follow up", launch: { ...(base as any).launch, id: "follow-up", agentTitle: "follow-up", brief: { file: "data/follow-up/brief.md" } }, after: [{ node: "trial", reason: "builds-on", on: "done" }] }] } as never }, randomUUID(), "general");
    await expect(activation.migrate(command, mate)).rejects.toMatchObject(stale);
    // The plan itself: a captain action is recorded on it (refused by the plan review, not the inventory).
    ({ command } = await selectedEvidence("data/rollback.md"));
    const plan = (await legacy.get("scheduler"))!;
    await legacy.execute({ op: "captain", plan: "scheduler", revision: plan.revision, subjectHash: planSubjectHash(plan), action: "approve", text: "" }, randomUUID(), "board:captain");
    await expect(activation.migrate(command, mate)).rejects.toMatchObject({ code: "STALE" });
    // A pending delivery alone: that action's note is now queued for the first mate, the plan unchanged.
    ({ command } = await selectedEvidence("data/rollback.md"));
    const action = (await legacy.get("scheduler"))!.captainEvents!.at(-1)!;
    await updateFirstmateConfig({ mateNotes: [{ id: `firstmate-plan-${action.id}`, text: "The captain approved Scheduler." }] });
    expect((await activation.planHelp(prepare.homeId, "scheduler")).reviewHash).toBe(command.reviewHash);
    await expect(activation.migrate(command, mate)).rejects.toMatchObject(stale);
    expect(await legacy.cutover("scheduler")).toBe(null); expect(receiver.calls).toEqual([]);
    // With nothing further changed, a fresh read prepares.
    ({ command } = await selectedEvidence("data/rollback.md"));
    expect((await activation.migrate(command, mate)).migrations[0]).toMatchObject({ planId: "scheduler" });
  } finally { await activation.stop(); await runtime.stop(); }
});
it("F6: a first mate replaced between migrate's entry and inner checks refuses before any write", async () => {
  const real = await readFirstmateConfig(); let reads = 0;
  activation = new SupervisionActivation(pluginDir(), { enabled: true, adapters: () => legacyAdapters(null, () => ledger.read()), receiver: () => receiver,
    config: async () => ({ ...real, mateAgentId: ++reads <= 2 ? "general" : "replacement" }) });
  const mate = { kind: "mate-chat", id: "general", source: SUPERVISE_ACTOR_SOURCE } as const;
  await expect(activation.migrate({ op: "reconcile", homeId: prepare.homeId, migrationId: prepare.migrationId }, mate)).rejects.toMatchObject({ code: "STALE" });
  expect(reads).toBeGreaterThanOrEqual(3);
  expect(await workflowStore(home).cutover("scheduler")).toBe(null); expect(receiver.calls).toEqual([]);
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
it("strict RPCs accept no actor/source and no attach operation exists on migration or the app RPC tools", async () => {
  await cutover();
  expect(AttachSupervisorInputSchema.safeParse({ ...await attachment(), actor: { kind: "captain-ui" } }).success).toBe(false);
  for (const extra of [{ actor: { kind: "captain-ui" } }, { supervisorId: randomUUID() }, { opening: "replacement opening" }, { profile: { provider: "codex/test", modeId: "" } }])
    expect(ResumeSupervisorInputSchema.safeParse({ homeId: prepare.homeId, requestId: randomUUID(), resume: true, ...extra }).success).toBe(false);
  expect(MigrationCommandSchema.safeParse({ ...prepare, op: "attach" }).success).toBe(false);
  const handlers: string[] = [];
  registerSupervisionActivation({ handle: (rpc: { name: string }) => { handlers.push(rpc.name); } } as never, activation);
  expect(handlers).toEqual(["firstmate.supervisor.controls.read", "firstmate.supervisors.read", "firstmate.supervisor.controls.act-ui", "firstmate.supervision.plan-help.evidence", "firstmate.supervision.backup.read", "firstmate.supervision.backup.set", "firstmate.supervision.plan-help.read", "firstmate.supervision.activation", "firstmate.supervision.migrate", "firstmate.supervision.attach-ui"]);
  for (const file of await readdir("templates/tools")) {
    const source = await readFile(join("templates/tools", file), "utf8");
    expect(source).not.toMatch(/attach-ui|attachSupervisorFromUi|attachFromUnverifiedUi/);
  }
  for (const file of ["server/scope-requests.ts", "server/workflow-service.ts", "server/cli.ts", "index.client.tsx"])
    expect(await readFile(file, "utf8")).not.toMatch(/attach-ui|attachSupervisorFromUi|attachFromUnverifiedUi/);
});
it("plan help observes Needs you itself through settled(), holding only on this plan's quarantined rows", async () => {
  const backlog = (rows: string[]) => writeFile(join(home, "data/backlog.md"),
    ["# Backlog", "## In flight", ...rows, "## Queued", "## Done", ""].join("\n"));
  await backlog(["- [ ] other - Other plan's task (broken:"]);
  // A cold service, as after a daemon restart: nothing has observed this backlog yet.
  const live = new NeedsYouService({ root: join(process.env.PASEO_HOME!, "live-ledger"), home: readConfiguredDecisionHome,
    catalog: async () => null, enabled: () => true, stableMs: 40 });
  const { runtime } = await guided(() => live.settled(1000));
  try {
    expect((await activation.planHelp(prepare.homeId, "scheduler")).problems).toEqual([]);
    await backlog(["- [ ] other - Other plan's task (broken:", "- [ ] trial - Database trial (broken:"]);
    const held = (await activation.planHelp(prepare.homeId, "scheduler")).problems;
    expect(held).toEqual([expect.stringMatching(/^Needs you can't check this plan's decisions until this is repaired: Line 4, task trial: /)]);
    expect(held.join(" ")).not.toMatch(/refresh|task other/i);
    // A removed run step's task still holds the plan, as the cutover's inventory counts it.
    const plan = (await workflowStore(home).read()).plans.find(p => p.definition.id === "scheduler")!;
    await workflowStore(home).execute({ op: "revise", expected: plan.hash, reason: "Drop the build and its decision",
      definition: { ...plan.definition, nodes: plan.definition.nodes.filter(n => n.id === "trial") } }, randomUUID(), "general");
    expect((await workflowStore(home).read()).plans.find(p => p.definition.id === "scheduler")!.removed?.map(r => r.node.id)).toEqual(expect.arrayContaining(["build"]));
    await backlog(["- [ ] build - Build the scheduler (broken:"]);
    expect((await activation.planHelp(prepare.homeId, "scheduler")).problems).toEqual([expect.stringContaining("task build: ")]);
  } finally { await activation.stop(); await runtime.stop(); await live.stop(); }
});
it("plan help names why Needs you can't vouch for its decisions, and only this plan's quarantines hold it", () => {
  const snapshot = (freshness: Partial<NeedsYouSnapshot["freshness"]>, quarantined: NeedsYouSnapshot["quarantined"] = []) =>
    ({ homeId: "home", quarantined, freshness: { status: "fresh", asOf: 1, checkedAt: 1, problems: [], ...freshness } }) as NeedsYouSnapshot;
  expect(decisionProblems(null, [])).toEqual([expect.stringContaining("Needs you is off")]);
  expect(decisionProblems(snapshot({ status: "stale", problems: ["Waiting for a stable backlog observation."] }), []))
    .toEqual(["The backlog is still being changed, so its decisions haven't settled yet. Try again in a few seconds."]);
  expect(decisionProblems(snapshot({ status: "stale", problems: ["Backlog is missing its ## Done section."] }), []))
    .toEqual(["Decisions couldn't be checked: Backlog is missing its ## Done section."]);
  const missing = { line: 0, taskId: "gone", key: null, hasHold: true, problem: "Task gone is missing. Restore its backlog record before answering it." };
  const broken = { line: 12, taskId: "scheduler-run", key: null, hasHold: false, problem: "Line 12, task scheduler-run: Could not read metadata." };
  expect(decisionProblems(snapshot({}, [missing]), ["scheduler-run"])).toEqual([]);
  expect(decisionProblems(snapshot({}, [missing, broken]), ["scheduler-run"]))
    .toEqual(["Needs you can't check this plan's decisions until this is repaired: Line 12, task scheduler-run: Could not read metadata."]);
  expect(decisionProblems(snapshot({}, [{ ...broken, taskId: null, problem: "Line 12: Could not read metadata." }]), []))
    .toEqual([expect.stringContaining("repaired: Line 12: Could not read metadata.")]);
  // A settling read lists every detected quarantine, including other plans'; the wait is the cause.
  expect(decisionProblems(snapshot({ status: "stale", problems: ["Line 7, task other: Could not read metadata.", "Waiting for a stable backlog observation."] }), []))
    .toEqual(["The backlog is still being changed, so its decisions haven't settled yet. Try again in a few seconds."]);
  expect(decisionProblems(snapshot({}), ["scheduler-run"])).toEqual([]);
  for (const text of decisionProblems(snapshot({ status: "stale", problems: ["Waiting for a stable backlog observation."] }), []))
    expect(text).not.toMatch(/refresh/i);
});
