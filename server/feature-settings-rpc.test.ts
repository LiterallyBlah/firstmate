import { randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DEFAULT_FEATURE_CAPACITY, FEATURES_OFF, FeatureSetInputSchema } from "../shared/feature-settings";
import { expected, seed } from "../test/supervision-fixture";
import { FeatureSettingsService, featureInventory, registerFeatureSettingsRpc } from "./feature-settings-rpc";
import { FeatureSettingsStore, legacyFeatureSettings } from "./feature-settings";
import { SupervisionStore } from "./supervision-store";
import { effectLogicalKey } from "./supervision-effects";

const fixture = () => {
  const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(root, "home");
  return { root, home, input: { home, expectedRevision: 0, requestId: randomUUID(),
    change: { requested: { ...FEATURES_OFF, projectMates: true }, capacity: { ...DEFAULT_FEATURE_CAPACITY } } } };
};
const snapshot = async (root: string) => Promise.all((await readdir(root, { recursive: true })).sort().map(async path => {
  const absolute = join(root, path), info = await stat(absolute);
  return [path, info.mtimeMs, info.isFile() ? (await readFile(absolute)).toString("base64") : null];
}));

it("reads fresh home without creating a policy, supervision journal, coordinator or host effects", async () => {
  const { root, home } = fixture(), service = new FeatureSettingsService(root, { home: async () => home });
  const result = await service.read({ home });
  expect(result).toMatchObject({ source: "default", state: "ready", requested: FEATURES_OFF, effective: FEATURES_OFF,
    runtimeEnforced: false, writesAvailable: false,
    inventory: { complete: false, active: 0, pending: 0, uncertain: 0, coverage: ["scoped-bindings", "scoped-effects"] } });
  expect(result.inventory.problems.join(" ")).toContain("legacy deliveries");
  await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });
});

it("refuses saves without the installed runtime fence while exposing strict transport shapes", async () => {
  const { root, home, input } = fixture(), service = new FeatureSettingsService(root, { home: async () => home });
  const handlers = new Map<string, (input: any) => Promise<unknown>>();
  registerFeatureSettingsRpc({ handle: (rpc: any, handler: any) => { handlers.set(rpc.name, handler); } } as any, service);
  expect(await handlers.get("firstmate.features.read")!({ home })).toMatchObject({ writesAvailable: false });
  await expect(handlers.get("firstmate.features.set")!(input)).rejects.toMatchObject({ code: "HELD" });
  await expect(service.set({ ...input, actor: "captain" } as any)).rejects.toThrow();
  expect(FeatureSetInputSchema.safeParse({ ...input, runtimeEnforced: true }).success).toBe(false);
  await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });
});

it("guards home before reading and after asynchronous inventory, retaining a pilot only at its original home", async () => {
  const { root, home } = fixture(), other = join(root, "other"); let current = home;
  const legacy = legacyFeatureSettings(home, { FIRSTMATE_SCOPE_UI: "1" });
  const service = new FeatureSettingsService(root, { home: async () => current, legacy });
  await expect(service.read({ home: other })).rejects.toMatchObject({ code: "STALE" });
  expect(await service.read({ home })).toMatchObject({ source: "legacy-environment", requested: { scopeUi: true } });
  current = other;
  expect(await service.read({ home: other })).toMatchObject({ source: "default", effective: FEATURES_OFF });
  await expect(service.read({ home })).rejects.toMatchObject({ code: "STALE" });
  current = home;
  const changing = new FeatureSettingsService(root, { home: async () => current, readInventory: async () => {
    current = other; return new SupervisionStore(root, home).read();
  } });
  await expect(changing.read({ home })).rejects.toMatchObject({ code: "STALE" });
  await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });
});

it("retains incomplete/failed inventory as unknown rather than an empty successful read", async () => {
  const { root, home } = fixture();
  const service = new FeatureSettingsService(root, { home: async () => home,
    readInventory: async () => { throw new Error("unreadable journal"); } });
  const result = await service.read({ home });
  expect(result.inventory).toMatchObject({ complete: false, active: null, pending: null, uncertain: null, coverage: [] });
  const status = await new SupervisionStore(root, home).read();
  const held = new FeatureSettingsService(root, { home: async () => home,
    readInventory: async () => ({ ...status, freshness: "held", problems: ["retained damaged scope"] }) });
  expect((await held.read({ home })).inventory).toMatchObject({ active: null, pending: null, uncertain: null,
    problems: expect.arrayContaining(["retained damaged scope"]) });
});

it("counts verified owners only after the exact epoch's successful opening and keeps accepted sends uncertain", async () => {
  const { root, home } = fixture(), status = await new SupervisionStore(root, home).read();
  const rows = seed(status.homeId), binding = rows.find(r => r.kind === "binding")!, effect = rows.find(r => r.kind === "effect")!;
  if (binding.kind !== "binding" || effect.kind !== "effect") throw new Error("Invalid fixture");
  const base = { ...status, bindings: [{ ...binding.value, state: "active" as const }] };
  expect(featureInventory(base).active).toBe(0);
  // Opening ownership uses the runtime's activationEffects selector, not a generic send.
  const opening = { ...effect.value, attemptId: null, operation: "agent.send", logicalKey: effectLogicalKey({
    scopeId: binding.value.scopeId, subject: "epoch:1", operation: "agent.send", causation: "scope.activate", objectiveRevision: 0 }), state: "accepted" as const };
  expect(featureInventory({ ...base, effects: [opening] })).toMatchObject({ active: 0, pending: 1, uncertain: 1 });
  const succeeded = { ...opening, state: "succeeded" as const };
  expect(featureInventory({ ...base, effects: [succeeded] })).toMatchObject({ active: 1, pending: 0, uncertain: 0 });
  expect(featureInventory({ ...base, bindings: [{ ...base.bindings[0]!, epoch: 2 }], effects: [succeeded] }).active).toBe(0);
  expect(featureInventory({ ...base, bindings: [...base.bindings, base.bindings[0]!], effects: [succeeded] }).active).toBe(0);
});

it("policy saves and inventory reads preserve real ownership, cumulative spend, authority and all journal bytes", async () => {
  const { root, home, input } = fixture(), writer = new SupervisionStore(root, home, { writable: true });
  await writer.initialize(); await writer.acquireCoordinator();
  try {
    const mutations = seed(writer.homeId); await writer.transact(expected(mutations), randomUUID(), mutations);
    const before = await writer.read(), bytes = await snapshot(writer.root);
    const service = new FeatureSettingsService(root, { home: async () => home });
    expect((await service.read({ home })).inventory).toMatchObject({ complete: false, active: 0, pending: 1, uncertain: 0 });
    await new FeatureSettingsStore(root, home).set(input);
    await service.read({ home });
    expect(await writer.read()).toEqual(before);
    expect(await snapshot(writer.root)).toEqual(bytes);
    expect((await readdir(root)).sort()).toEqual(["feature-settings", "supervision"]);
    expect(before.attempts[0]).toMatchObject({ spentAgents: 1, spentTurns: 1 });
  } finally { await writer.releaseCoordinator(); }
});
