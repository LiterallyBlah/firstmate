import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { FirstmateConfigSchema } from "../../shared/fleet";
import { BOARD_REVIEW_ROUTING } from "../../shared/watch-routing";
import { WatchInspections } from "../../server/watch-inspections";
import { oneAtATime } from "../../server/mate";
import { workflowHomeIdentity } from "../../server/workflow-ownership";
import { digest } from "../../server/submissions";
import type { PaseoApi } from "../../server/host-types";
async function fixture(qualified = true) {
  const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(process.env.PASEO_HOME!, randomUUID());
  const catalog = [{ provider: "codex/observer", label: "Observer · codex", modes: [{ id: "read-only", label: "Read only" }], thinking: [{ id: "high", label: "High" }] }];
  const configuration = { format: "firstmate.supervisor-inspection-profile/1" as const, homeId: workflowHomeIdentity(home), hostId: "local" as const,
    watch: "checks", definitionDigest: digest("watch"), generation: 1, profile: { provider: "codex/observer", modeId: "read-only" as const, thinkingOptionId: "high" },
    catalogDigest: digest(catalog), limits: { sessions: 1, turns: 1 }, isolation: "independent-parentless-restricted-tools" as const, provenance: "client UI (unverified)" as const };
  const calls: any[] = [], agents = new Map<string, any>(); let available = true, lost = false;
  const paseo = { providers: { listAvailable: async () => ({ providers: [{ provider: "codex", available: true }] }),
    listModels: async () => ({ models: [{ id: "observer", label: "Observer", thinkingOptions: [{ id: "high", label: "High" }] }] }),
    listModes: async () => ({ modes: available ? [{ id: "read-only", label: "Read only" }] : [{ id: "full-access", label: "Full access" }] }) },
    workspaces: { open: async (cwd: string) => { calls.push({ op: "open", cwd }); return { id: "isolated", agents: { create: async (input: any) => {
      calls.push({ op: "create", input }); agents.set(input.agentId, { id: input.agentId, provider: "codex", model: "observer", thinkingOptionId: input.config.thinkingOptionId,
        cwd, workspaceId: "isolated", currentModeId: input.config.modeId, labels: input.labels, status: "idle", archivedAt: null, pendingPermissions: [] }); return { id: input.agentId }; } } }; } },
    agents: { ref: (id: string) => ({ refresh: async () => ({ agent: agents.get(id) }), send: async (text: string, input: any) => { calls.push({ op: "send", id, text, input }); if (lost) throw Error("acknowledgement unknown"); },
      timeline: { refetch: async () => ({ entries: [], error: null }) } }) } } as unknown as PaseoApi;
  const options = { root, paseo: () => paseo, config: async () => FirstmateConfigSchema.parse({ home, mateAgentId: "general" }), snapshot: async () => ({ cards: [] }),
    profile: async () => configuration, observerQualified: () => qualified };
  return { root, configuration, calls, options, runner: new WatchInspections(options), unavailable: () => { available = false; }, loseSend: () => { lost = true; } };
}
it("A4: unqualified installed observer and missing read-only mode refuse before creation/reservation", async () => {
  const f = await fixture(false); await expect(f.runner.start("checks", "Inspect only", BOARD_REVIEW_ROUTING)).rejects.toThrow(/unqualified/);
  expect(f.calls).toEqual([]);
  const g = await fixture(); g.unavailable(); await expect(g.runner.start("checks", "Inspect only", BOARD_REVIEW_ROUTING)).rejects.toThrow(/read.only/);
  expect(g.calls).toEqual([]);
});
it("A2/A4/A9: qualified synthetic observer captures its own high profile outside General's lock", async () => {
  const f = await fixture(); let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(r => { entered = r; }), held = oneAtATime(async () => { entered(); await new Promise<void>(r => { release = r; }); }); await ready;
  try {
    expect(await f.runner.start("checks", "Inspect only", BOARD_REVIEW_ROUTING)).toBe(true);
    expect(f.calls.map(c => c.op)).toEqual(["open", "create", "send"]);
    const create = f.calls[1].input; expect(create.config).toMatchObject({ provider: "codex/observer", modeId: "read-only", thinkingOptionId: "high" });
    expect(create.labels["paseo.parent-agent-id"]).toBeUndefined(); expect(create.config.mcpServers.paseo.args[0]).toContain("inspector-mcp.mjs");
    const state = JSON.parse(await readFile(join(f.root, "inspection-runs.json"), "utf8"));
    expect(state.runs[0].configuration).toEqual(f.configuration);
    expect(new Set(state.runs[0].operations.map((op: any) => op.key)).size).toBe(3);
  } finally { release(); await held; }
});
it("A3/A4/A12: uncertain observer send retains slot and spend across restart and profile generation", async () => {
  const f = await fixture(); f.loseSend(); await f.runner.start("checks", "Inspect only", BOARD_REVIEW_ROUTING);
  const before = JSON.parse(await readFile(join(f.root, "inspection-runs.json"), "utf8"));
  expect(before.runs[0].operations.at(-1).state).toBe("uncertain");
  f.configuration.generation++;
  const restarted = new WatchInspections(f.options); await restarted.reconcile();
  expect(await restarted.start("checks", "New profile cannot retry", BOARD_REVIEW_ROUTING)).toBe(false);
  expect(f.calls.map(c => c.op)).toEqual(["open", "create", "send"]);
  expect(JSON.parse(await readFile(join(f.root, "inspection-runs.json"), "utf8")).runs).toHaveLength(1);
});
