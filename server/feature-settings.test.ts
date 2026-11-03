import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { DEFAULT_FEATURE_CAPACITY, FEATURE_CAPABILITIES, FEATURES_OFF, supervisorCapabilities, type FeatureSetInput } from "../shared/feature-settings";
import { FeatureSettingsStore, legacyFeatureSettings } from "./feature-settings";
import { digest } from "./submissions";
import { publishFormat1 } from "../test/feature-policy-format1";
import { workflowHomeIdentity } from "./workflow-ownership";

const root = () => join(process.env.PASEO_HOME!, randomUUID());
const request = (home: string, expectedRevision = 0, supervisors = false): FeatureSetInput => ({
  home, expectedRevision, requestId: randomUUID(), change: { supervisors, capacity: { ...DEFAULT_FEATURE_CAPACITY } },
});
const ALL_ON = supervisorCapabilities(true);
const files = (store: FeatureSettingsStore) => readdir(store.directory);
const revisions = async (store: FeatureSettingsStore) => (await files(store)).filter(n => /^\d{16}\.json$/.test(n)).sort();

it("reads missing fresh/upgraded policy without creating any file, journal or coordinator", async () => {
  const data = root(), home = join(data, "home"), store = new FeatureSettingsStore(data, home);
  expect(await store.read()).toMatchObject({ homeId: workflowHomeIdentity(home), revision: 0, state: "ready", source: "default",
    requested: FEATURES_OFF, effective: FEATURES_OFF, policy: null, runtimeEnforced: false, writesAvailable: false });
  await expect(readdir(data)).rejects.toMatchObject({ code: "ENOENT" });
  await mkdir(home, { recursive: true }); await writeFile(join(home, "existing-chat.txt"), "prior conversation");
  await store.read();
  expect(await readdir(data)).toEqual(["home"]);
  expect(await readFile(join(home, "existing-chat.txt"), "utf8")).toBe("prior conversation");
});

it("shares lexical/case home aliases while keeping homes and captured pilot compatibility isolated", async () => {
  const data = root(), home = join(data, "home"), other = join(data, "other");
  const legacy = legacyFeatureSettings(home, { FIRSTMATE_SCOPE_UI: "1" });
  const store = new FeatureSettingsStore(data, home, legacy);
  const alias = process.platform === "win32" ? join(home, "..", "HOME").toUpperCase() : resolve(home, ".");
  const aliased = new FeatureSettingsStore(data, alias, legacy);
  expect(aliased.directory).toBe(store.directory);
  const result = await store.set(request(alias, 0, true));
  expect((await aliased.read()).policy).toEqual(result.policy);
  expect(await new FeatureSettingsStore(data, other, legacy).read()).toMatchObject({ source: "default", revision: 0, effective: FEATURES_OFF });
  await expect(store.set(request(other))).rejects.toMatchObject({ code: "STALE" });
  expect(() => new FeatureSettingsStore(data, "relative-home")).toThrow("absolute");
});

it("reads every env-only combination exactly until one saved Supervisors setting replaces the switches, including off", async () => {
  const keys = ["FIRSTMATE_PROJECT_MATES", "FIRSTMATE_PLAN_SUPERVISORS", "FIRSTMATE_SCOPED_ACTIVATION", "FIRSTMATE_SCOPE_UI", "FIRSTMATE_SCOPE_EXECUTION", "FIRSTMATE_MAINTENANCE"];
  for (let bits = 0; bits < 64; bits++) {
    const data = root(), home = join(data, "home"), env = Object.fromEntries(keys.map((key, n) => [key, bits & (1 << n) ? "1" : "0"]));
    const legacy = legacyFeatureSettings(home, env), store = new FeatureSettingsStore(data, home, legacy);
    const expected = Object.fromEntries(FEATURE_CAPABILITIES.map((key, n) => [key, !!(bits & (1 << n))]));
    const before = await store.read();
    expect(before).toMatchObject({ source: "legacy-environment", revision: 0, requested: expected, effective: expected });
    const input = request(home, 0, bits % 2 === 1); input.change.capacity = before.capacity!;
    const saved = await store.set(input);
    expect(saved.policy).toMatchObject({ format: "firstmate.feature-policy/2", supervisors: bits % 2 === 1 });
    const restarted = new FeatureSettingsStore(data, home, legacyFeatureSettings(home, Object.fromEntries(keys.map(key => [key, "1"]))));
    const fences = supervisorCapabilities(bits % 2 === 1);
    expect(await restarted.read()).toMatchObject({ source: "saved", requested: fences, effective: fences });
    await restarted.set(request(home, 1));
    expect(await restarted.read()).toMatchObject({ revision: 2, source: "saved", requested: FEATURES_OFF, effective: FEATURES_OFF });
  }
  // Windows CI: median 3.9 s, passes up to 22.1 s and two timeouts at 30 s; hosted Windows runner slowdowns add up to ~46 s (61 runs, 2026-10-28/29), so the budget is its Windows median + ~50 s.
}, 60_000);

it("captures only exact legacy opt-ins and holds invalid capacity without a default reset", async () => {
  const data = root(), home = join(data, "home");
  const legacy = legacyFeatureSettings(home, { FIRSTMATE_SCOPE_UI: "true", FIRSTMATE_SCOPE_EXECUTION: "yes", FIRSTMATE_MAINTENANCE: "01" });
  expect(legacy.requested).toEqual(FEATURES_OFF);
  const invalid = legacyFeatureSettings(home, { FIRSTMATE_PROJECT_MATES: "1", FIRSTMATE_PROJECT_SLOTS: "1", FIRSTMATE_GENERAL_HEADROOM: "1" });
  expect(await new FeatureSettingsStore(data, home, invalid).read()).toMatchObject({ state: "held", capacity: null, effective: FEATURES_OFF });
  await expect(readdir(data)).rejects.toMatchObject({ code: "ENOENT" });
});

it("atomically CASes concurrent clients and replays the exact receipt after later changes/restart", async () => {
  const data = root(), home = join(data, "home"), first = new FeatureSettingsStore(data, home), second = new FeatureSettingsStore(data, home);
  const a = request(home, 0, true), b = request(home);
  const saves = await Promise.allSettled([first.set(a), second.set(b)]);
  expect(saves.filter(s => s.status === "fulfilled")).toHaveLength(1);
  expect(saves.find(s => s.status === "rejected")).toMatchObject({ reason: { code: "STALE" } });
  const original = await first.set(a);
  await second.set(request(home, 1));
  const restarted = new FeatureSettingsStore(data, home);
  expect(await restarted.set(a)).toEqual(original);
  expect(await restarted.read()).toMatchObject({ revision: 2, effective: FEATURES_OFF });
  for (const changed of [{ ...a, expectedRevision: 2 }, { ...a, change: b.change },
    { ...a, change: { ...a.change, capacity: { slots: 5, generalHeadroom: 1 } } }])
    await expect(restarted.set(changed)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await revisions(restarted)).toHaveLength(2);
});

it("stores only reviewed capacity and unverified app provenance, never caller identity or display settings", async () => {
  const data = root(), home = join(data, "home"), store = new FeatureSettingsStore(data, home), input = request(home);
  input.change.capacity = { slots: 8, generalHeadroom: 2 };
  const saved = await store.set(input);
  expect(saved.policy).toMatchObject({ capacity: input.change.capacity,
    updated: { kind: "plugin-ui-unverified", source: "firstmate.features.set", requestId: input.requestId } });
  await expect(store.set({ ...input, actor: "captain" } as any)).rejects.toThrow();
  expect(await readdir(data)).toEqual(["feature-settings"]);
});

it.each(["invalid-json", "changed-home", "changed-request", "changed-receipt", "missing-identity", "empty-directory", "lost-final-revision"])(
  "holds %s instead of reverting to defaults or env and preserves all damaged bytes", async damage => {
    const data = root(), home = join(data, "home");
    const store = new FeatureSettingsStore(data, home, legacyFeatureSettings(home, { FIRSTMATE_PROJECT_MATES: "1" }));
    await store.set(request(home)); await store.set(request(home, 1));
    const path = join(store.directory, (await revisions(store))[0]!);
    const change = async (key: string, value: unknown) => {
      const row = JSON.parse(await readFile(path, "utf8")); row[key] = value; await writeFile(path, JSON.stringify(row));
    };
    if (damage === "invalid-json") await writeFile(path, "{broken");
    if (damage === "changed-home") await writeFile(join(store.directory, "identity.json"), JSON.stringify({ format: "firstmate.feature-policy-home/1", homeId: "/other" }));
    if (damage === "changed-request") await change("requestHash", "0".repeat(64));
    if (damage === "changed-receipt") await writeFile(path.replace(".json", ".receipt.json"), "{}");
    if (damage === "missing-identity") await rm(join(store.directory, "identity.json"));
    if (damage === "empty-directory") for (const name of await files(store)) await rm(join(store.directory, name));
    if (damage === "lost-final-revision") await rm(join(store.directory, (await revisions(store))[1]!));
    const snapshot = async () => Promise.all((await files(store)).sort().map(async name => [name, await readFile(join(store.directory, name), "utf8")]));
    const before = await snapshot();
    expect(await store.read()).toMatchObject({ state: "held", source: "saved", revision: null, effective: FEATURES_OFF, policy: null });
    await expect(store.set(request(home))).rejects.toMatchObject({ code: "HELD" });
    expect(await snapshot()).toEqual(before);
  });

it("lets only the original exact request complete a final interrupted publication; reads never repair", async () => {
  const data = root(), home = join(data, "home"), store = new FeatureSettingsStore(data, home), input = request(home);
  const saved = await store.set(input), name = (await revisions(store))[0]!, receipt = join(store.directory, name.replace(".json", ".receipt.json"));
  await rm(receipt);
  expect(await store.read()).toMatchObject({ state: "held" });
  await expect(readFile(receipt)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(store.set(request(home))).rejects.toMatchObject({ code: "HELD" });
  expect(await new FeatureSettingsStore(data, home).set(input)).toEqual(saved);
  expect(await store.read()).toMatchObject({ revision: 1, state: "ready" });
});

it("replays format 1 revisions exactly, partial fences included, and continues the chain with the Supervisors setting", async () => {
  const data = root(), home = join(data, "home");
  const store = new FeatureSettingsStore(data, home, legacyFeatureSettings(home, { FIRSTMATE_PROJECT_MATES: "1" }));
  const partial = { ...FEATURES_OFF, planSupervisors: true, scopeUi: true };
  const first = await publishFormat1(data, home, partial);
  expect(await store.read()).toMatchObject({ source: "saved", revision: 1, state: "ready", requested: partial, effective: partial,
    policy: { format: "firstmate.feature-policy/1", requested: partial } });
  // A format 1 request is not a Supervisors save; it can't be resubmitted, only replayed from history.
  await expect(store.set(first.request as never)).rejects.toThrow();
  const next = request(home, 1, true), saved = await store.set(next);
  expect(saved.policy).toMatchObject({ format: "firstmate.feature-policy/2", revision: 2, supervisors: true });
  const restarted = new FeatureSettingsStore(data, home);
  expect(await restarted.read()).toMatchObject({ source: "saved", revision: 2, requested: ALL_ON, effective: ALL_ON });
  expect(await restarted.set(next)).toEqual(saved);
  // Changing a replayed format 1 revision still holds rather than reverting.
  const path = join(store.directory, (await revisions(store))[0]!), row = JSON.parse(await readFile(path, "utf8"));
  row.result.policy.requested = ALL_ON; await writeFile(path, JSON.stringify(row));
  expect(await restarted.read()).toMatchObject({ state: "held", effective: FEATURES_OFF });
});

it("refuses a format 2 revision whose saved setting differs from its request", async () => {
  const data = root(), home = join(data, "home"), store = new FeatureSettingsStore(data, home);
  await store.set(request(home, 0, false));
  const path = join(store.directory, (await revisions(store))[0]!), row = JSON.parse(await readFile(path, "utf8"));
  row.result.policy.supervisors = true;
  const { hash: _, ...body } = row; await writeFile(path, JSON.stringify({ ...body, hash: digest(body) }));
  await writeFile(path.replace(".json", ".receipt.json"), JSON.stringify({ ...body, hash: digest(body) }));
  expect(await store.read()).toMatchObject({ state: "held", effective: FEATURES_OFF });
});
