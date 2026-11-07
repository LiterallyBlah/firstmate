/** A write published by another Node process must move a warm reader's stat fingerprint,
 * so its very next read serves the new head - no in-process epoch or shared cache involved. */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { expected, ids, scope } from "../test/supervision-fixture";

const CHILD = "FIRSTMATE_TEST_FASTREAD_CHILD", DATA = "FIRSTMATE_TEST_FASTREAD_DATA", HOME = "FIRSTMATE_TEST_FASTREAD_HOME";

it.skipIf(!process.env[CHILD])("isolated fast-read publication worker", async () => {
  const store = new SupervisionStore(process.env[DATA]!, process.env[HOME]!, { writable: true });
  await store.acquireCoordinator();
  await store.transact([{ kind: "scope", id: ids.scope, version: 1 }], randomUUID(),
    [{ kind: "scope", value: { ...scope(store.homeId), version: 2 } }]);
  await store.releaseCoordinator();
}, 60000);

it.skipIf(!!process.env[CHILD])("a warm reader sees another process's write on its next read", async () => {
  const base = join(process.env.PASEO_HOME!, randomUUID());
  const home = join(base, "home"), data = join(base, "data");
  const writer = new SupervisionStore(data, home, { writable: true,
    processIdentity: async () => ({ state: "alive" as const, start: "isolated-fixture-process" }) });
  await writer.initialize(); await writer.acquireCoordinator();
  const mutations: SupervisionMutation[] = [{ kind: "scope", value: scope(writer.homeId) }];
  await writer.transact(expected(mutations), randomUUID(), mutations);
  await writer.releaseCoordinator();

  const reader = new SupervisionStore(data, home);
  await reader.read(); // Cold validation.
  const warm = await reader.read(); // Establishes the stat fingerprint.
  expect(warm).toMatchObject({ freshness: "current", sequence: 1 });
  expect(await reader.read()).toBe(warm); // Unchanged fingerprint: same frozen status.

  const vitest = join(dirname(fileURLToPath(import.meta.resolve("vitest/package.json"))), "vitest.mjs");
  await promisify(execFile)(process.execPath,
    [vitest, "run", "server/supervision-fast-read-process.test.ts", "--maxWorkers=1", "--testNamePattern=^isolated fast-read publication worker$"],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), windowsHide: true, timeout: 90000,
      env: { ...process.env, [CHILD]: "1", [DATA]: data, [HOME]: home } });

  const next = await reader.read();
  expect(next.freshness).toBe("current"); expect(next.sequence).toBe(2);
  expect(next.scopes.find(s => s.id === ids.scope)?.version).toBe(2);
}, 180000);
