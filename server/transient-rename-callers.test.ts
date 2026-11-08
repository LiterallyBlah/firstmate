import { randomUUID } from "node:crypto";
import * as filesystem from "node:fs/promises";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { expected, scope } from "../test/supervision-fixture";
import { readFirstmateConfig, updateFirstmateConfig } from "./config";
import { pluginDir } from "./data-dir";
import { SupervisionStore, type SupervisionMutation } from "./supervision-store";

// The writers themselves, not only the helper: refuse a rename the way Windows does while another
// handle holds the file. Real IO otherwise; the platform is Windows only around the refused write.
vi.mock(import("node:fs/promises"), async importOriginal => {
  const actual = await importOriginal(); return { ...actual, rename: vi.fn(actual.rename) as typeof actual.rename };
});
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const onWindows = async <T>(work: () => Promise<T>) => {
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  try { return await work(); } finally { Object.defineProperty(process, "platform", platform); }
};
const refusal = (code: string) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
/** Refuses the next `codes.length` renames onto `target`; every other rename is real. */
async function refuseRenames(target: string, codes: string[]) {
  const real = (await vi.importActual<typeof filesystem>("node:fs/promises")).rename, refused: string[] = [];
  vi.mocked(filesystem.rename).mockImplementation(async (from, to) => {
    if (basename(String(to)) === target && refused.length < codes.length) { const code = codes[refused.length]!; refused.push(code); throw refusal(code); }
    return real(from, to);
  });
  return refused;
}
beforeEach(() => { vi.mocked(filesystem.rename).mockClear(); });
afterEach(async () => {
  const real = (await vi.importActual<typeof filesystem>("node:fs/promises")).rename;
  vi.mocked(filesystem.rename).mockImplementation(real);
});

async function journal() {
  const base = join(process.env.PASEO_HOME!, randomUUID()), dataRoot = join(base, "data"), home = join(base, "home");
  const store = new SupervisionStore(dataRoot, home, { writable: true, processIdentity: async () => ({ state: "alive", start: "rename-fixture" }) });
  await store.initialize(); await store.acquireCoordinator();
  return { store, dataRoot, home };
}

it("a transient refusal of checkpoint.json's rename commits the transaction and leaves the journal current", async () => {
  const { store, dataRoot, home } = await journal(), before = await store.read();
  const mutations: SupervisionMutation[] = [{ kind: "scope", value: scope(store.homeId) }];
  const refused = await refuseRenames("checkpoint.json", ["EPERM", "EBUSY"]);
  await onWindows(() => store.transact(expected(mutations), randomUUID(), mutations));
  expect(refused).toEqual(["EPERM", "EBUSY"]);
  const after = await store.read();
  expect(after.freshness).toBe("current");
  expect(after.sequence).toBe(before.sequence + 1);
  expect(after.scopes).toHaveLength(1);
  expect((await readdir(store.root)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  // A reader starting afresh agrees: the checkpoint on disk is the new one, nothing awaits recovery.
  expect(await new SupervisionStore(dataRoot, home).read()).toMatchObject({ freshness: "current", sequence: after.sequence });
});

it("a transient refusal of config.json's rename still saves the config and leaves no temporary", async () => {
  await mkdir(pluginDir(), { recursive: true });
  await updateFirstmateConfig({ mateAgentId: "mate-1" });
  const refused = await refuseRenames("config.json", ["EPERM", "EACCES"]);
  await onWindows(() => updateFirstmateConfig({ disabledWatches: ["pr-watch"] }));
  expect(refused).toEqual(["EPERM", "EACCES"]);
  expect((await readFirstmateConfig()).disabledWatches).toEqual(["pr-watch"]);
  expect(JSON.parse(await readFile(join(pluginDir(), "config.json"), "utf8")).mateAgentId).toBe("mate-1");
  expect((await readdir(pluginDir())).filter(name => name.endsWith(".tmp"))).toEqual([]);
});
