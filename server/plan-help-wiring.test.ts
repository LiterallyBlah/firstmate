/** Production registration and real snapshot identities, not interchangeable fixture IDs. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement, type ReactNode } from "react";
import { act, create } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import contribute from "../index.server";
import { workflowFixture } from "../test/workflow-fixture";
import { workflowStore } from "./workflow-service";
import { planSubjectHash } from "./workflow-plans";
import { updateFirstmateConfig } from "./config";
import { workflowHomeIdentity } from "./workflow-ownership";
import { pluginDir } from "./data-dir";
import { FEATURES_OFF, DEFAULT_FEATURE_CAPACITY } from "../shared/feature-settings";
import { visibleText } from "../test/visible-text";
import { SupervisionRuntime } from "./supervision-runtime";
import { acceptPolicyInventory, policyRef } from "./supervision-policy";
import { SupervisionProjects } from "./supervision-projects";
import { capturePlanHelp } from "../test/plan-help-browser";
import { evidenceReferences } from "../shared/plan-help";
const ui = vi.hoisted(() => ({ context: {} as any, call: null as any }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: any) => (input: any) => ui.call(rpc.name, input) }));
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", Modal: Object.assign(({ children }: { children: ReactNode }) => children, { Content: "Content" }) }));
vi.mock("../client/workflow-plans", () => ({ workflowRequestId: () => randomUUID(), useWorkflowPlans: () => ui.context }));
vi.mock("../client/supervision-activation", () => ({ SupervisionActivationBoard: "ExistingAttachBoard" }));
import { PlanHelpSurface, PlanHelpAction } from "../client/plan-help";
vi.setConfig({ testTimeout: 60000 });
beforeEach(() => writeFile(join(process.env.PASEO_HOME!, "server-id"), "isolated-plan-help-review"));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function production() {
  vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref() {} } as any);
  const handlers = new Map<string, (input: any, context?: any) => Promise<any>>();
  const cleanup = contribute({ handle: (rpc: any, fn: any) => handlers.set(rpc.name, fn), on: () => () => {}, before: () => () => {}, registerSettings() {} } as any);
  const call = (name: string, input: any = {}) => handlers.get(name)!(input, { paseo: {} });
  return { call, cleanup };
}
it("R1: real workflow and supervision identities compose in Plans; switching home closes the captured review", async () => {
  const home = join(process.env.PASEO_HOME!, "r1-home");
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "data/backlog.md"), "# Backlog\n## In flight\n## Queued\n## Done\n");
  await writeFile(join(process.env.PASEO_HOME!, "server-id"), "isolated-plan-help-review");
  await updateFirstmateConfig({ home, mateAgentId: "" }); await updateFirstmateConfig({ mateAgentId: "general" });
  await workflowStore(home).execute({ op: "draft", definition: workflowFixture() }, randomUUID(), "general");
  const { call, cleanup } = production(), calls: { name: string; input: any }[] = [];
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree: ReturnType<typeof create> | undefined;
  try {
    await call("firstmate.features.set", { home, expectedRevision: 0, requestId: randomUUID(), change: { requested: { ...FEATURES_OFF, planSupervisors: true, scopedActivation: true, scopeUi: true, scopeExecution: true }, capacity: DEFAULT_FEATURE_CAPACITY } });
    const snapshot = await call("firstmate.workflow.read"), activation = await call("firstmate.supervision.activation");
    expect(snapshot.homeId).not.toBe(activation.homeId);
    // During a home switch these two caches may temporarily belong to different homes.
    await expect(call("firstmate.supervision.plan-help.read", { homeId: activation.homeId, plan: "scheduler", workflowHomeId: "other-home" })).rejects.toMatchObject({ code: "STALE" });
    await expect(call("firstmate.supervision.backup.read", { homeId: activation.homeId, workflowHomeId: "other-home" })).rejects.toMatchObject({ code: "STALE" });
    ui.context = { snapshot, activation, activationError: false, scope: "original-home" };
    ui.call = (name: string, input: any) => { calls.push({ name, input }); return call(name, input); };
    const theme = { colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#444", surface1: "#222" } } as any;
    const render = () => createElement(QueryClientProvider, { client: cache }, createElement(PlanHelpSurface, { theme, children: createElement(PlanHelpAction, { theme, plan: snapshot.plans[0] }) }));
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => { tree = create(render()); });
    await act(async () => tree!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === "Review plan help").props.onPress());
    await act(async () => { await new Promise(done => setTimeout(done, 40)); });
    expect(visibleText(tree!.toJSON())).toContain("Current owner:");
    expect(visibleText(tree!.toJSON())).not.toContain("This review couldn't be checked");
    expect(calls.filter(c => /plan-help.read|backup.read/.test(c.name))).toEqual([
      { name: "firstmate.supervision.plan-help.read", input: { homeId: activation.homeId, plan: "scheduler", workflowHomeId: snapshot.homeId } },
      { name: "firstmate.supervision.backup.read", input: { homeId: activation.homeId, workflowHomeId: snapshot.homeId } },
    ]);
    expect(calls.every(c => c.name.endsWith(".read"))).toBe(true);
    ui.context = { ...ui.context, snapshot: { ...snapshot, homeId: "other-workflow-home" } };
    await act(async () => tree!.update(render()));
    expect(tree!.root.findAll(n => n.props.testID === "plan-help-review")).toHaveLength(0);
    await expect(readdir(join(pluginDir(), "supervision"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await act(async () => tree?.unmount()); cache.clear(); await cleanup(); }
});
it("R2: production preserves the pilot backup environment only for the original supervision home", async () => {
  const home = join(process.env.PASEO_HOME!, "r2-home"), destination = join(process.env.PASEO_HOME!, "r2-backups");
  await mkdir(join(home, "data"), { recursive: true }); await mkdir(destination);
  await updateFirstmateConfig({ home, mateAgentId: "" });
  vi.stubEnv("FIRSTMATE_MIGRATION_BACKUP_ROOT", destination); vi.stubEnv("FIRSTMATE_MIGRATION_RETENTION", "Keep 30 days");
  const { call, cleanup } = production();
  try {
    expect(await call("firstmate.supervision.backup.read", { homeId: workflowHomeIdentity(home) })).toMatchObject({ source: "legacy-environment", revision: 0, backup: { destination, retention: "Keep 30 days" } });
    const other = join(process.env.PASEO_HOME!, "r2-other"); await mkdir(other);
    await updateFirstmateConfig({ home: other });
    expect(await call("firstmate.supervision.backup.read", { homeId: workflowHomeIdentity(other) })).toMatchObject({ source: "default", revision: 0, backup: null });
  } finally { await cleanup(); }
});
it.runIf(process.env.PR175_CAPTURE === "1")("real registered RPC before/after evidence review in both themes and widths", async () => {
  const home = join(process.env.PASEO_HOME!, "capture-home"), destination = join(process.env.PASEO_HOME!, "capture-backups");
  await mkdir(join(home, "data"), { recursive: true }); await mkdir(destination);
  await writeFile(join(home, "data/backlog.md"), "# Backlog\n## In flight\n## Queued\n## Done\n");
  await writeFile(join(home, "data/rollback.md"), "Isolated capture fixture: retained FirstMate build 0.4.0 at the reviewed test archive.\nS07 compatibility 1; exact history replay and external-effect reconciliation tested in this disposable fixture.\nThis fixture report is not production qualification.\n");
  await updateFirstmateConfig({ home, mateAgentId: "" }); await updateFirstmateConfig({ mateAgentId: "general" });
  await workflowStore(home).execute({ op: "draft", definition: workflowFixture() }, randomUUID(), "general");
  // Nonempty production inventory: a genuine captain action and durable start intent,
  // without launching any native worker. An empty inventory missed the wording defect.
  const legacy = workflowStore(home), plan = (await legacy.get("scheduler"))!;
  await legacy.execute({ op: "captain", plan: "scheduler", revision: plan.revision, subjectHash: planSubjectHash(plan), action: "approve", text: "" }, randomUUID(), "board:captain");
  await mkdir(join(home, "data/trial"), { recursive: true });
  await writeFile(join(home, "data/trial/brief.md"), "Isolated browser fixture; do not launch a native worker.");
  await legacy.execute({ op: "start", plan: "scheduler", node: "trial" }, randomUUID(), "general");
  const runtime = new SupervisionRuntime(pluginDir()), actor = { kind: "captain-ui", id: "capture-fixture", source: "isolated-test" } as const;
  const orders = "Previously accepted project permissions. No new permission is granted by handover.\n", sha = (s: string) => createHash("sha256").update(s).digest("hex");
  await writeFile(join(home, "data/orders.md"), orders);
  await runtime.mutate(home, async store => {
    const source = { id: randomUUID(), version: 1, path: "data/orders.md", lineStart: 1, lineEnd: 1, fileHash: sha(orders), excerptHash: sha(orders.trimEnd()), provenance: actor, supersedes: [] };
    await acceptPolicyInventory(store, home, randomUUID(), actor, { sources: [source], rules: [] }, true);
    const projectId = randomUUID(), scopeId = randomUUID();
    await store.transact([{ kind: "scope", id: scopeId, version: 0 }], randomUUID(), [{ kind: "scope", value: { id: scopeId, homeId: store.homeId, kind: "project", projectIds: [projectId], sponsorId: null, version: 1, mode: "scoped", state: "active" } }]);
    await new SupervisionProjects(store, { enabled: true }).recordProject(randomUUID(), actor, { projectId, expectedVersion: 0, scopeId, name: "scheduler", aliases: [], state: "admitted", budget: { agents: 2, turns: 2 }, sourceVector: [policyRef("policy-source", source)] });
  });
  await runtime.stop(); vi.stubEnv("FIRSTMATE_NEEDS_YOU", "1");
  const { call, cleanup } = production();
  try {
    await call("firstmate.features.set", { home, expectedRevision: 0, requestId: randomUUID(), change: { requested: { ...FEATURES_OFF, planSupervisors: true, scopedActivation: true, scopeUi: true, scopeExecution: true }, capacity: DEFAULT_FEATURE_CAPACITY } });
    await call("firstmate.supervision.backup.set", { homeId: workflowHomeIdentity(home), expectedRevision: 0, requestId: randomUUID(), backup: { destination, retention: "Keep indefinitely; reviewed manually." } });
    await call("firstmate.needs-you.read"); await new Promise(done => setTimeout(done, 2100)); await call("firstmate.needs-you.read");
    expect((await call("firstmate.supervision.plan-help.read", { homeId: workflowHomeIdentity(home), plan: "scheduler" })).problems).toEqual([]);
    await capturePlanHelp(call, async () => {
      expect((await call("firstmate.supervision.activation")).migrations).toEqual([]);
      expect(await workflowStore(home).cutover("scheduler")).toBe(null);
      const review = await call("firstmate.supervision.plan-help.read", { homeId: workflowHomeIdentity(home), plan: "scheduler" });
      const read = await call("firstmate.supervision.plan-help.evidence", { homeId: review.homeId, plan: "scheduler", folder: "data", rollbackPath: "data/rollback.md" });
      const evidence = { inventory: read.inventory.hash, policy: read.policy.hash, rollback: { path: read.rollback.path, hash: read.rollback.hash } };
      await call("firstmate.supervision.migrate", { op: "prepare", homeId: review.homeId, plan: "scheduler", migrationId: review.migrationId, scopeId: review.scopeId, projectId: review.projectId, reviewHash: review.reviewHash, evidence, prerequisites: evidenceReferences(evidence) });
    });
    expect((await call("firstmate.supervision.activation")).migrations[0]?.state).toBe("prepared");
    expect(await workflowStore(home).cutover("scheduler")).toBe("prepared");
  } finally { await cleanup(); }
}, 120000);
