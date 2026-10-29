/** Two real Node processes must not overwrite a policy or both win the same revision. */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { DEFAULT_FEATURE_CAPACITY, FEATURES_OFF, type FeatureSetInput } from "../shared/feature-settings";
import { FeatureSettingsStore } from "./feature-settings";

async function until(test: () => Promise<boolean>) {
  const deadline = Date.now() + 15000;
  while (!await test()) {
    if (Date.now() > deadline) throw new Error("Policy race fixture did not reach its publication barrier.");
    await new Promise(done => setTimeout(done, 20));
  }
}
const exists = async (path: string) => { try { await readFile(path); return true; } catch { return false; } };

it.skipIf(!process.env.FIRSTMATE_TEST_FEATURE_POLICY_CHILD)("isolated policy publication worker", async () => {
  const root = process.env.FIRSTMATE_TEST_FEATURE_POLICY_ROOT!, child = process.env.FIRSTMATE_TEST_FEATURE_POLICY_CHILD!;
  // This helper can write only a stand-in created below a disposable test home.
  expect(resolve(root).toLowerCase().startsWith(resolve(tmpdir()).toLowerCase())).toBe(true);
  expect(root).toMatch(/firstmate-tests-[^\\/]+[\\/]policy-race-[^\\/]+$/);
  expect(["a", "b"]).toContain(child);
  const input = JSON.parse(await readFile(join(root, `${child}.request.json`), "utf8")) as FeatureSetInput;
  await writeFile(join(root, `${child}.ready`), "ready");
  await until(() => exists(join(root, "go")));
  const store = new FeatureSettingsStore(root, input.home);
  let result: unknown;
  try { result = { outcome: "saved", result: await store.set(input) }; }
  catch (error) { result = { outcome: "refused", code: (error as { code?: string }).code }; }
  await writeFile(join(root, `${child}.result.json`), JSON.stringify(result));
}, 25000);

it.skipIf(!!process.env.FIRSTMATE_TEST_FEATURE_POLICY_CHILD)("serializes concurrent policy publications across independent Node processes", async () => {
  const root = join(process.env.PASEO_HOME!, `policy-race-${randomUUID()}`), home = join(root, "home");
  await mkdir(root, { recursive: true });
  const inputs = ["a", "b"].map((): FeatureSetInput => ({ home, expectedRevision: 0, requestId: randomUUID(),
    change: { requested: { ...FEATURES_OFF }, capacity: { ...DEFAULT_FEATURE_CAPACITY } } }));
  await Promise.all(inputs.map((input, n) => writeFile(join(root, `${["a", "b"][n]}.request.json`), JSON.stringify(input))));
  const vitest = join(dirname(fileURLToPath(import.meta.resolve("vitest/package.json"))), "vitest.mjs");
  const children = ["a", "b"].map(child => promisify(execFile)(process.execPath,
    [vitest, "run", "server/feature-settings-process.test.ts", "--maxWorkers=1", "--testNamePattern=^isolated policy publication worker$"],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), windowsHide: true, timeout: 35000,
      env: { ...process.env, FIRSTMATE_TEST_FEATURE_POLICY_CHILD: child, FIRSTMATE_TEST_FEATURE_POLICY_ROOT: root } }));
  // Observe child failures immediately, even if they happen before the barrier is ready.
  const finished = Promise.all(children); void finished.catch(() => {});
  await Promise.race([until(async () => await exists(join(root, "a.ready")) && await exists(join(root, "b.ready"))), finished]);
  await writeFile(join(root, "go"), "publish"); await finished;
  const results = await Promise.all(["a", "b"].map(async child => JSON.parse(await readFile(join(root, `${child}.result.json`), "utf8"))));
  expect(results.filter(r => r.outcome === "saved")).toHaveLength(1);
  expect(["STALE", "HELD"]).toContain(results.find(r => r.outcome === "refused").code);
  const store = new FeatureSettingsStore(root, home);
  expect(await store.read()).toMatchObject({ state: "ready", revision: 1 });
  const winner = results.findIndex(r => r.outcome === "saved");
  expect(await store.set(inputs[winner]!)).toEqual(results[winner].result);
  await expect(store.set(inputs[1 - winner]!)).rejects.toMatchObject({ code: "STALE" });
}, 45000);
