/** Actual registered handlers, default UUID decision ledger and optional native history failures. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import contribute from "../index.server";
import { CREW_LABELS, FleetSchema } from "../shared/fleet";
import { updateFirstmateConfig } from "./config";
import { pluginDir } from "./data-dir";
import { SupervisionStore } from "./supervision-store";
import { expected } from "../test/supervision-fixture";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function production(legacyDecisions = true) {
  const home = join(process.env.PASEO_HOME!, randomUUID());
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "data/backlog.md"), "# Backlog\n## In flight\n## Queued\n- [ ] choice - Choose (hold: Which?)\n## Done\n");
  await writeFile(join(process.env.PASEO_HOME!, "server-id"), "isolated-ui-readiness");
  await updateFirstmateConfig({ home, mateAgentId: "" });
  const store = new SupervisionStore(pluginDir(), home, { writable: true });
  await store.initialize(); await store.acquireCoordinator();
  const mutations = [{ kind: "scope" as const, value: { id: randomUUID(), homeId: store.homeId, kind: "general" as const,
    projectIds: [], sponsorId: null, version: 1, mode: "legacy" as const, state: "active" as const } }];
  await store.transact(expected(mutations), randomUUID(), mutations); await store.releaseCoordinator();
  vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref() {} } as never);
  vi.stubEnv("FIRSTMATE_NEEDS_YOU", legacyDecisions ? "1" : "0");
  const handlers = new Map<string, { contract: any; fn: any }>();
  const cleanup = contribute({ handle: (contract: any, fn: any) => handlers.set(contract.name, { contract, fn }),
    on: () => () => {}, before: () => () => {}, registerSettings() {} } as never);
  const call = async (name: string, paseo: any = {}) => { const h = handlers.get(name)!; return h.contract.output.parse(await h.fn({}, { paseo })); };
  return { home, store, call, cleanup };
}
it("default-created UUID ledger composes through both production decision handlers without rewriting IDs", async () => {
  const f = await production();
  try {
    const snapshot = await f.call("firstmate.needs-you.read");
    const folder = (await readdir(join(pluginDir(), "needs-you")))[0]!;
    const ledger = JSON.parse(await readFile(join(pluginDir(), "needs-you", folder, "ledger.json"), "utf8"));
    expect(snapshot.homeId).toBe(ledger.homeId);
    expect(snapshot.homeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(snapshot.homeId).not.toBe(f.store.homeId);
    expect(snapshot.scopedComplete).toBe(true);
    expect(snapshot.scopedProblems).toEqual([]);
    const scoped = await f.call("firstmate.scope.needs");
    expect(scoped.homeId).toBe(ledger.homeId);
    expect(scoped.scopedComplete).toBe(true);
  } finally { await f.cleanup(); }
});
it("keeps scoped-only reads available when the existing legacy decision observer is disabled", async () => {
  const f = await production(false);
  try {
    const snapshot = await f.call("firstmate.scope.needs");
    expect(snapshot.homeId).toBe(f.store.homeId);
    expect(snapshot.scopedComplete).toBe(true);
    expect(snapshot.freshness.status).toBe("disabled");
  } finally { await f.cleanup(); }
});
it("registered fleet handler returns before 30s with never-settling history and healthy unrelated crew", async () => {
  const f = await production();
  const slow = vi.fn(() => new Promise(() => {})), healthy = vi.fn(async () => ({ entries: [{ item: { type: "assistant_message", text: "done: ready for review" } }] }));
  const agents = ["slow", "healthy"].map(id => ({ id, title: id, workspaceId: id, cwd: f.home, status: "idle", pendingPermissions: [],
    labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole }, updatedAt: "2026-11-01T00:00:00Z", archivedAt: null, provider: "fixture", model: "fixture" }));
  const paseo = { agents: { list: async () => ({ entries: agents.map(agent => ({ agent })), pageInfo: {} }),
    ref: (id: string) => ({ timeline: { refetch: id === "slow" ? slow : healthy } }) }, config: { get: async () => ({ config: { mcp: { injectIntoAgents: true } } }) } };
  try {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let result: any;
    const started = Date.now();
    // Installed PluginRuntime ordinary invoke contract: the response is lost after 30 seconds.
    const invoke = async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([f.call("firstmate.fleet.load", paseo), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Plugin RPC timed out: firstmate.invoke")), 30_000);
      })]); } finally { clearTimeout(timer); }
    };
    const first = invoke().then(r => { result = r; });
    const second = invoke();
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(5_001);
    await vi.waitFor(() => expect(result).toBeDefined(), { timeout: 1_000 });
    await first; await second;
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(slow).toHaveBeenCalledTimes(1); expect(healthy).toHaveBeenCalledTimes(1);
    const fleet = FleetSchema.parse(result);
    expect(fleet.cards.find(c => c.agent?.id === "healthy")?.column).toBe("ready");
    expect(fleet.cards.find(c => c.agent?.id === "slow")?.report).toBeNull();
    expect(fleet.warnings.join(" ")).toMatch(/slow.*report.*pending/i);
    expect(fleet.agentTools).toBe(true);
  } finally { vi.useRealTimers(); await f.cleanup(); }
});
