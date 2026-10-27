import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FirstmateConfig } from "../shared/fleet";
import type { SupervisionActor } from "../shared/supervision";
import { expected, hash } from "../test/supervision-fixture";
import * as daemonSession from "./daemon-session";
import { nativeSchedules, retainedWorkspaces, type NativeSchedule, type NativeTimerInventory } from "./archive-inventory";
import { SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { SupervisionJobs, timerInventory } from "./supervision-jobs";
import { occurrenceId } from "./supervision-maintenance-state";
import { WatchConfigStore } from "./watch-config";
import { readTimerInventory } from "./watch-service";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const M = id(0x5a), J = id(0x10b);
const captain: SupervisionActor = { kind: "captain-ui", id: "fixture-captain", source: "fixture/button/1" };
const supervisor: SupervisionActor = { kind: "agent", id: "maintenance-supervisor", source: "fixture/maintenance" };
// The live home's four disabled watches and their retained schedules (pilot runbook, A17.preserve), plus two enabled built-ins.
const WATCHES: [string, string][] = [["board-review", "*/15 * * * *"], ["workspace-review", "5 */12 * * *"], ["metis-pentest", "*/10 * * * *"],
  ["launch-metrics.mjs", "*/15 * * * *"], ["pr-watch", "*/5 * * * *"], ["remote-watch", "* * * * *"]];
const DISABLED = ["board-review", "launch-metrics.mjs", "metis-pentest", "workspace-review"];
const MATE = "e986ab48-5849-47dd-bff9-df6473147d19";
const STORAGE: NativeSchedule = { id: "storage-0315", name: "host-storage", cadence: { type: "cron", expression: "15 3 * * *" },
  target: { type: "new-agent", config: { cwd: "/fleet/storage" } }, status: "active" };
const HEARTBEAT: NativeSchedule = { id: "hb-fleet", name: "fleet heartbeat", cadence: { type: "every", everyMs: 900_000 },
  target: { type: "agent", agentId: "69c1921d-0791-4579-931e-c0c0afe884a9" }, status: "active" };
const native: NativeTimerInventory = { complete: true, schedules: [STORAGE, HEARTBEAT] };
let home: string, watchConfig: WatchConfigStore;
const config = { disabledWatches: DISABLED, mateAgentId: MATE } as unknown as FirstmateConfig;

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) if (entry.isFile()) {
    const path = join(entry.parentPath, entry.name);
    out[path.slice(dir.length)] = createHash("sha256").update(await readFile(path)).digest("hex");
  }
  return out;
}

beforeEach(async () => {
  home = join(process.env.PASEO_HOME!, randomUUID());
  await mkdir(join(home, "watches"), { recursive: true });
  for (const [name, schedule] of WATCHES) {
    const path = join(home, "watches", name);
    await writeFile(path, `#!/usr/bin/env node\n// schedule: ${schedule}\nconsole.log("fixture");\n`);
    await chmod(path, 0o755);
  }
  watchConfig = new WatchConfigStore(join(home, "plugin", "watch-config.json"));
  await watchConfig.create({ name: "nightly-brief", schedule: "0 7 * * *", prompt: "Synthetic managed watch.", enabled: false,
    executionSession: "current", newSessionReasoning: "inherit", notificationPolicy: "never" });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("A17.preserve: the timer disposition inventory", () => {
  it("lists every timer with its schedule, zone, owner and disposition, holding the unknown heartbeat", async () => {
    const inventory = await readTimerInventory(home, config, watchConfig, native);
    const row = (rowId: string) => inventory.rows.find(r => r.id === rowId)!;
    for (const name of DISABLED) expect(row(`script:${name}`)).toMatchObject({ enabled: false, disposition: "disabled-retained", zone: "daemon-local" });
    expect(row("script:workspace-review").schedule).toBe("5 */12 * * *");
    expect(row("script:pr-watch")).toMatchObject({ enabled: true, disposition: "legacy-retained" });
    expect(row("managed:nightly-brief")).toMatchObject({ enabled: false, disposition: "disabled-retained" });
    expect(row("native:storage-0315")).toMatchObject({ kind: "native-schedule", schedule: "15 3 * * *", zone: "daemon-local", owner: "unknown", disposition: "held-unknown-owner" });
    expect(row("native:hb-fleet")).toMatchObject({ kind: "native-heartbeat", owner: "unknown", disposition: "held-unknown-owner", enabled: true });
    expect(inventory.rows.filter(r => r.kind === "plugin-interval").map(r => r.disposition)).toEqual(["plugin-internal", "plugin-internal", "plugin-internal"]);
    expect(inventory).toMatchObject({ complete: true, problems: [] });
    const incomplete = await readTimerInventory(home, config, watchConfig);
    expect(incomplete.complete).toBe(false);
    expect(incomplete.problems).toEqual(["Native schedule inventory was not read."]);
    expect(incomplete.rows.some(r => r.kind.startsWith("native"))).toBe(false); // absence is never "no native timers"
  });

  it("S10 enable, ticks, observations and stop change no timer, configuration, schedule or coverage, and create no replacement", async () => {
    const files = await tree(home), before = await readTimerInventory(home, config, watchConfig, native);
    const store = new SupervisionStore(join(home, "store"), home, { writable: true, processIdentity: async () => ({ state: "alive", start: "fixture-process" }) });
    await store.initialize(); await store.acquireCoordinator();
    const setup: SupervisionMutation[] = [{ kind: "scope", value: { id: M, homeId: store.homeId, kind: "maintenance", projectIds: [], sponsorId: null, version: 1, mode: "scoped", state: "active" } },
      { kind: "binding", value: { scopeId: M, epoch: 1, hostId: "local", agentId: supervisor.id, workspaceId: "ws", profileDigest: hash, state: "active", checkpointHash: hash, acknowledgedSeq: 0, heartbeatDue: null } }];
    await store.transact(expected(setup), randomUUID(), setup);
    let clock = "2026-10-26T12:00:00Z";
    const jobs = new SupervisionJobs(store, { enabled: true, now: () => clock });
    // Observe the existing 03:15 storage timer over its full host set, offline Light included. Nothing replaces it.
    await jobs.defineJob(randomUUID(), captain, { jobId: J, expectedVersion: 0, scopeId: M, name: "host-storage", domain: "host-storage",
      schedule: { kind: "daily", at: "03:15", zone: "America/New_York" }, hosts: ["light", "mini", "studio"], resource: { class: "cleanup", keys: ["host:{host}:cache"] },
      selectors: [{ kind: "path-prefix", value: "/cache" }], retained: [], mode: "observe",
      legacyTimer: { kind: "native-schedule", id: STORAGE.id, disposition: "retained", evidence: [] }, budget: { turns: 2 }, maxPasses: 3 });
    await jobs.setState(randomUUID(), captain, { jobId: J, expectedVersion: 1, state: "active" });
    for (const at of ["2026-10-27T07:15:30Z", "2026-10-27T07:15:31Z", "2026-10-28T09:00:00Z"]) { clock = at; await jobs.tick(at); }
    const occ = occurrenceId(J, "America/New_York", "2026-10-28");
    await jobs.observe(randomUUID(), supervisor, { occurrenceId: occ, hostId: "light", outcome: "offline", detail: "Light has no route.", resultDigest: hash });
    await jobs.observe(randomUUID(), supervisor, { occurrenceId: occ, hostId: "mini", outcome: "completed", detail: "Pruned.", resultDigest: hash });
    const linked = (await store.read()).maintenance!.jobs;
    const during = await readTimerInventory(home, config, watchConfig, native, linked);
    expect(during.rows.find(r => r.id === "native:storage-0315")).toMatchObject({ disposition: "observed-by-job", jobId: J, enabled: true });
    expect(during.rows.find(r => r.id === "native:hb-fleet")!.disposition).toBe("held-unknown-owner");
    await jobs.setState(randomUUID(), captain, { jobId: J, expectedVersion: (await store.read()).maintenance!.jobs[0]!.version, state: "stopped" });
    const after = await readTimerInventory(home, config, watchConfig, native, (await store.read()).maintenance!.jobs);
    expect([during.hashes.config, during.hashes.timers, after.hashes.config, after.hashes.timers]).toEqual([before.hashes.config, before.hashes.timers, before.hashes.config, before.hashes.timers]);
    expect(after.rows.map(r => [r.id, r.disposition])).toEqual(before.rows.map(r => [r.id, r.disposition]));
    // Only the store directory is new: no watch, config or schedule file was written, and no native call exists to create one.
    const now = await tree(home);
    expect(Object.fromEntries(Object.entries(now).filter(([path]) => !path.replaceAll("\\", "/").startsWith("/store/")))).toEqual(files);
    const status = await store.read();
    expect(status.maintenance!.occurrences.map(o => [o.localDate, o.missed.count])).toEqual([["2026-10-27", 0], ["2026-10-28", 0]]);
    expect(status.maintenance!.incidents.map(i => [i.hostId, i.kind, i.notify.state])).toEqual([["light", "offline", "pending"]]);
  });

  it("flags a duplicate cleaner and a linked timer missing from a complete inventory", () => {
    const job = { id: J, name: "host-storage", state: "active", mode: "advisory", hosts: ["mini"],
      legacyTimer: { kind: "native-schedule", id: STORAGE.id, disposition: "retired", evidence: [{ ref: "x", digest: hash }] } } as never;
    const input = { scripts: [], disabledWatches: [], managed: [], mateAgentId: MATE, jobs: [job], configFingerprint: null };
    expect(timerInventory({ ...input, native }).problems).toEqual([`Duplicate cleaner: job "host-storage" runs beside its enabled legacy timer "host-storage".`]);
    expect(timerInventory({ ...input, native: { complete: true, schedules: [{ ...STORAGE, status: "paused" }] } }).problems).toEqual([]);
    expect(timerInventory({ ...input, native: { complete: true, schedules: [] } }).problems).toEqual([`Job "host-storage" names legacy timer "storage-0315", which the inventory does not contain.`]);
    const own = timerInventory({ ...input, jobs: [], native: { complete: true, schedules: [{ ...HEARTBEAT, target: { type: "agent", agentId: MATE } }] } });
    expect(own.rows.find(r => r.id === "native:hb-fleet")).toMatchObject({ owner: "first-mate", disposition: "legacy-retained" });
  });
});

describe("archive-inventory readers fail closed", () => {
  const page = (entries: { id: string; workspaceId: string | null; archivedAt: string | null }[], prev: string | null, next: string | null) => ({
    requestId: "x", error: null, entries: entries.map(agent => ({ agent: { ...agent, labels: {} } })), pageInfo: { prevCursor: prev, nextCursor: next, hasMore: next !== null } });
  it("retainedWorkspaces reads every page, or nothing", async () => {
    const send = vi.spyOn(daemonSession, "sendSessionRequest").mockImplementation(async message => {
      const cursor = (message.page as { cursor?: string }).cursor;
      return cursor === undefined ? page([{ id: "a", workspaceId: "ws-a", archivedAt: null }, { id: "b", workspaceId: "ws-b", archivedAt: null }], null, "c1")
        : page([{ id: "c", workspaceId: "ws-a", archivedAt: null }, { id: "d", workspaceId: null, archivedAt: null }], "c1", null);
    });
    expect(await retainedWorkspaces()).toEqual(["ws-a", "ws-b"]);
    expect(send.mock.calls[0]![0]).toMatchObject({ type: "fetch_agent_history_request", filter: { includeArchived: false } });
    send.mockImplementation(async message => (message.page as { cursor?: string }).cursor === undefined ? page([{ id: "a", workspaceId: "ws-a", archivedAt: null }], null, "c1")
      : (() => { throw new Error("socket closed"); })());
    await expect(retainedWorkspaces()).rejects.toThrow(/nothing may be cleaned/);
  });
  it("nativeSchedules parses the protocol answer and reports any failure as incomplete", async () => {
    const send = vi.spyOn(daemonSession, "sendSessionRequest").mockResolvedValue({ requestId: "x", error: null, schedules: [{ ...STORAGE, prompt: "p", createdAt: "t" }, HEARTBEAT] });
    expect(await nativeSchedules()).toMatchObject({ complete: true, schedules: [{ id: STORAGE.id }, { id: HEARTBEAT.id }] });
    send.mockResolvedValue({ requestId: "x", error: "denied", schedules: [] });
    expect(await nativeSchedules()).toMatchObject({ complete: false });
    send.mockResolvedValue({ requestId: "x", error: null, schedules: [{ id: 3 }] });
    expect(await nativeSchedules()).toMatchObject({ complete: false });
    send.mockRejectedValue(new Error("The daemon did not answer schedule/list within 10 seconds."));
    expect(await nativeSchedules()).toEqual({ complete: false, reason: "Native schedule inventory unavailable: The daemon did not answer schedule/list within 10 seconds." });
  });
});
