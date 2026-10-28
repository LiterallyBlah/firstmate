/** RR3–RR5: retained observations keep their owner, occurrence identity and order. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MIGRATION_COMPATIBILITY } from "../shared/supervision-migration";
import { readFirstmateConfig, resolveHome, updateFirstmateConfig } from "./config";
import type { PaseoApi } from "./host-types";
import { releaseMate } from "./mate";
import { cutoverGate, type CutoverGate } from "./supervision-gate";
import { deliverToMate } from "./watch-service";
import { MAX_HELD_WATCHES, WatchRunner, type WatchRunnerOptions } from "./watches";

async function freeze(gate: CutoverGate) {
  await gate.arm([]);
  await gate.run(() => gate.publishSidecar({ format: "firstmate.cutover-sidecar/1", compatibility: MIGRATION_COMPATIBILITY,
    stage: "freeze", homeId: "fixture", planId: "scheduler", migrationId: randomUUID(), scopeId: randomUUID(), at: new Date().toISOString(),
    sourceHash: "1".repeat(64), inventoryHash: "2".repeat(64), transaction: null,
    tokens: { plan: "scheduler", nodes: [], actions: [], agents: [], tasks: [] } }));
}
async function abort(gate: CutoverGate) {
  const { hash: _hash, ...body } = (await gate.sidecar("scheduler", "freeze"))!;
  await gate.run(() => gate.publishSidecar({ ...body, stage: "aborted" }));
}
async function fixture() {
  const root = join(process.env.PASEO_HOME!, randomUUID()), homeA = join(root, "home-a"), homeB = join(root, "home-b");
  await mkdir(homeA, { recursive: true }); await mkdir(homeB, { recursive: true });
  await updateFirstmateConfig({ home: homeA, mateAgentId: "", migration: null, mateLaunch: null });
  await updateFirstmateConfig({ mateAgentId: "mate-A" });
  const gate = cutoverGate(homeA), sends: { recipient: string; text: string }[] = [];
  let waiting = false;
  let beforeDelivery = async () => {}, beforeRefresh = async () => {};
  const api = { agents: { ref: (id: string) => ({
    refresh: async () => { await beforeRefresh(); return { agent: { id, status: waiting ? "running" : "idle", archivedAt: null, pendingPermissions: [] } }; },
    send: async (text: string) => { sends.push({ recipient: id, text }); },
  }) } } as unknown as PaseoApi;
  const create = (options: Partial<WatchRunnerOptions> = {}) => new WatchRunner({ home: async () => resolveHome(await readFirstmateConfig()), disabled: async () => [],
    gate: async () => { const config = await readFirstmateConfig(); return { gate: cutoverGate(resolveHome(config)), recipient: config.mateAgentId }; },
    stateFile: join(root, "watches.json"), scriptStateRoot: join(root, "script-state"),
    deliver: async (text, expected) => { await beforeDelivery(); return deliverToMate(api, await readFirstmateConfig(), text, readFirstmateConfig, expected); }, ...options });
  return { root, homeA, homeB, gate, create, sends, set waiting(value: boolean) { waiting = value; },
    set beforeDelivery(value: () => Promise<void>) { beforeDelivery = value; }, set beforeRefresh(value: () => Promise<void>) { beforeRefresh = value; } };
}
const at = (minute: number, seconds = 0) => new Date(Date.parse("2026-10-28T10:00:00Z") + minute * 60_000 + seconds * 1000);
function signal() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}

it("RR3 recovered held evidence stays with its originating home through busy delivery and reload", async () => {
  const f = await fixture(); let runner = f.create();
  try {
    await freeze(f.gate);
    await expect(runner.enqueuePrompt("probe", "scheduler PRIVATE_HOME_A_EVIDENCE", at(0))).rejects.toThrow(/retained durably/);
    await abort(f.gate); f.waiting = true; await runner.flush();
    expect(await runner.queued()).toHaveLength(1);
    runner.stop(); runner = f.create();
    await releaseMate(); await updateFirstmateConfig({ home: f.homeB }); await updateFirstmateConfig({ mateAgentId: "mate-B" });
    f.waiting = false; await runner.flush(); expect(f.sends).toEqual([]);
    await releaseMate(); await updateFirstmateConfig({ home: f.homeA }); await updateFirstmateConfig({ mateAgentId: "mate-A" });
    await runner.flush(); expect(f.sends).toEqual([{ recipient: "mate-A", text: expect.stringContaining("PRIVATE_HOME_A_EVIDENCE") }]);
    expect(await runner.held()).toEqual([]);
    runner.stop(); runner = f.create(); await runner.flush(); expect(f.sends).toHaveLength(1);
  } finally { runner.stop(); }
});

it("RR4 four prompt timer retries retain and deliver one due-minute occurrence", async () => {
  const f = await fixture(); let runner = f.create();
  try {
    await freeze(f.gate);
    for (const seconds of [0, 15, 30, 45]) {
      await expect(runner.enqueuePrompt("probe", "scheduler RUN_ONCE_PER_MINUTE", at(0, seconds))).rejects.toThrow(/retained durably/);
      runner.stop(); runner = f.create(); // The occurrence identity must survive reloads too.
    }
    expect(await runner.held()).toHaveLength(1);
    await abort(f.gate); await runner.flush();
    expect(f.sends.map(s => s.text).join("\n").split("RUN_ONCE_PER_MINUTE")).toHaveLength(2);
  } finally { runner.stop(); }
});

it("RR5 recovery delivers sequential occurrences in occurrence order", async () => {
  const f = await fixture(); const runner = f.create();
  try {
    await freeze(f.gate);
    for (let i = 0; i < 8; i++) await expect(runner.enqueuePrompt(`probe-${i}`, `scheduler OCCURRENCE_${i}`, at(i))).rejects.toThrow(/retained durably/);
    await abort(f.gate); await runner.flush();
    expect([...f.sends.map(s => s.text).join("\n").matchAll(/OCCURRENCE_(\d)/g)].map(m => Number(m[1]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  } finally { runner.stop(); }
});

it("RR4 ordinary prompt retries still deliver once without retention writes", async () => {
  const f = await fixture(); const runner = f.create();
  try {
    for (const seconds of [0, 15, 30, 45]) await runner.enqueuePrompt("probe", "RUN_ONCE_PER_MINUTE", at(0, seconds));
    await runner.flush(); expect(f.sends).toHaveLength(1); expect(await runner.held()).toEqual([]);
  } finally { runner.stop(); }
});

it.each(["home", "mate"])("RR3 %s changes after admission cannot replace the claimed recipient", async change => {
  const f = await fixture(), runner = f.create();
  try {
    await freeze(f.gate); await expect(runner.enqueuePrompt("probe", "scheduler OWNED", at(0))).rejects.toThrow(/retained durably/);
    await abort(f.gate);
    f.beforeDelivery = async () => {
      f.beforeDelivery = async () => {};
      expect(await f.gate.claims()).toEqual([expect.objectContaining({ claim: expect.objectContaining({ recipient: "mate-A" }), result: null })]);
      await releaseMate();
      if (change === "home") await updateFirstmateConfig({ home: f.homeB });
      await updateFirstmateConfig({ mateAgentId: "mate-B" });
    };
    await runner.flush(); expect(f.sends).toEqual([]); expect(await runner.held()).toHaveLength(1);
    if (change === "home") {
      await releaseMate(); await updateFirstmateConfig({ home: f.homeA }); await updateFirstmateConfig({ mateAgentId: "mate-A" });
    }
    await runner.flush(); expect(f.sends).toEqual([{ recipient: change === "home" ? "mate-A" : "mate-B", text: expect.stringContaining("OWNED") }]);
    expect(await runner.held()).toEqual([]);
  } finally { runner.stop(); }
});

it("RR3 a mate change during native refresh still refuses the captured recipient", async () => {
  const f = await fixture(), runner = f.create();
  try {
    await freeze(f.gate); await expect(runner.enqueuePrompt("probe", "scheduler OWNED", at(0))).rejects.toThrow(/retained durably/);
    await abort(f.gate);
    f.beforeRefresh = async () => { f.beforeRefresh = async () => {}; await updateFirstmateConfig({ mateAgentId: "mate-B" }); };
    await runner.flush(); expect(f.sends).toEqual([]); expect(await runner.held()).toHaveLength(1);
    await runner.flush(); expect(f.sends).toHaveLength(1); expect(f.sends[0]!.recipient).toBe("mate-B");
  } finally { runner.stop(); }
});

it("RR3 bare restored rows from the previous reader are rebound before any foreign delivery", async () => {
  const f = await fixture(); let runner = f.create();
  try {
    await freeze(f.gate); await expect(runner.enqueuePrompt("probe", "scheduler OWNED", at(0))).rejects.toThrow(/retained durably/);
    await abort(f.gate); f.waiting = true; await runner.flush(); runner.stop();
    const path = join(f.root, "watches.json"), state = JSON.parse(await readFile(path, "utf8"));
    delete state.queue[0].retained; await writeFile(path, JSON.stringify(state));
    await releaseMate(); await updateFirstmateConfig({ home: f.homeB }); await updateFirstmateConfig({ mateAgentId: "mate-B" });
    runner = f.create(); f.waiting = false; await runner.flush(); expect(f.sends).toEqual([]);
    await releaseMate(); await updateFirstmateConfig({ home: f.homeA }); await updateFirstmateConfig({ mateAgentId: "mate-A" });
    await runner.flush(); expect(f.sends).toHaveLength(1); expect(f.sends[0]!.recipient).toBe("mate-A");
  } finally { runner.stop(); }
});

it("RR3 malformed queued ownership fails closed rather than becoming an ordinary note", async () => {
  const f = await fixture(); let runner = f.create();
  try {
    await freeze(f.gate); await expect(runner.enqueuePrompt("probe", "scheduler OWNED", at(0))).rejects.toThrow(/retained durably/);
    await abort(f.gate); f.waiting = true; await runner.flush(); runner.stop();
    const path = join(f.root, "watches.json"), state = JSON.parse(await readFile(path, "utf8"));
    state.queue[0].retained.owner = "0".repeat(64); await writeFile(path, JSON.stringify(state));
    runner = f.create(); f.waiting = false;
    await expect(runner.flush()).rejects.toThrow(/provenance/); expect(f.sends).toEqual([]); expect(await runner.held()).toHaveLength(1);
  } finally { runner.stop(); }
});

it("RR4 retention capacity stops prompt growth and scripts before baseline advancement", async () => {
  const f = await fixture(); let produced = 0;
  const runner = f.create({ run: async () => { produced++; return { code: 0, timedOut: false, stdout: "scheduler baseline advanced", stderr: "", truncated: false, spawnError: null }; } });
  try {
    await freeze(f.gate);
    for (let i = 0; i < MAX_HELD_WATCHES; i++) await expect(runner.enqueuePrompt("probe", `scheduler COMMAND_${i}`, at(i))).rejects.toThrow(/retained durably/);
    for (let i = 0; i < 8; i++) await expect(runner.enqueuePrompt("probe", "scheduler OVER_CAP", at(MAX_HELD_WATCHES, i * 7))).rejects.toThrow(/retention capacity/);
    await expect(runner.runOne(f.homeA, { name: "stateful", path: "unused" } as never, at(30))).rejects.toThrow(/retention capacity/);
    expect(produced).toBe(0); expect(await runner.held()).toHaveLength(MAX_HELD_WATCHES); expect(await runner.queued()).toEqual([]);
    const refusals = await Promise.all((await readdir(join(f.gate.directory, "refusals"))).map(name => readFile(join(f.gate.directory, "refusals", name), "utf8").then(JSON.parse)));
    expect(refusals.filter(row => row.item.id === "retention-capacity:probe")).toHaveLength(1);
    expect(refusals.filter(row => row.item.id === "retention-capacity:stateful")).toHaveLength(1);
    await abort(f.gate); await runner.flush(); expect(await runner.held()).toEqual([]);
    await runner.runOne(f.homeA, { name: "stateful", path: "unused" } as never, at(31)); expect(produced).toBe(1);
  } finally { runner.stop(); }
});

it("RR4 concurrent script producers reserve capacity before advancing their baselines", async () => {
  const f = await fixture(); let produced = 0, release!: () => void;
  const native = new Promise<void>(r => { release = r; });
  const started = signal();
  const runner = f.create({ run: async () => { produced++; if (produced === MAX_HELD_WATCHES) started.open(); await native; return { code: 0, timedOut: false, stdout: "scheduler observed", stderr: "", truncated: false, spawnError: null }; } });
  await freeze(f.gate);
  const work = Promise.allSettled(Array.from({ length: MAX_HELD_WATCHES }, (_, i) => runner.runOne(f.homeA, { name: `probe-${i}`, path: "unused" } as never, at(i))));
  try {
    await started.promise;
    await expect(runner.runOne(f.homeA, { name: "overflow", path: "unused" } as never, at(30))).rejects.toThrow(/retention capacity/);
    expect(produced).toBe(MAX_HELD_WATCHES); release(); await work;
    expect(await runner.held()).toHaveLength(MAX_HELD_WATCHES);
  } finally { release(); await work; runner.stop(); }
});

it("RR4 sixteen minutes of prompt retries retain sixteen occurrences rather than sixty-four commands", async () => {
  const f = await fixture(), runner = f.create();
  try {
    await freeze(f.gate);
    for (let i = 0; i < 64; i++) await expect(runner.enqueuePrompt("probe", "scheduler OBSERVED", at(Math.floor(i / 4), (i % 4) * 15))).rejects.toThrow(/retained durably/);
    expect(await runner.held()).toHaveLength(16);
  } finally { runner.stop(); }
});

it("RR4 unarmed producers retain their existing concurrency and bounded normal queue behavior", async () => {
  const f = await fixture(); let produced = 0, release!: () => void;
  const native = new Promise<void>(r => { release = r; });
  const started = signal();
  const runner = f.create({ run: async () => { produced++; if (produced === count) started.open(); await native; return { code: 0, timedOut: false, stdout: "ordinary observation", stderr: "", truncated: false, spawnError: null }; } });
  const count = MAX_HELD_WATCHES + 5;
  const work = Promise.allSettled(Array.from({ length: count }, (_, i) => runner.runOne(f.homeA, { name: `probe-${i}`, path: "unused" } as never, at(i))));
  try {
    await started.promise; release();
    expect((await work).every(result => result.status === "fulfilled")).toBe(true);
    expect(await runner.held()).toEqual([]); expect(await runner.queued()).toHaveLength(20);
    await expect(readdir(f.gate.directory)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { release(); await work; runner.stop(); }
});

it("RR4 a full foreign namespace does not throttle an unarmed home's stateful producer", async () => {
  const f = await fixture(); let produced = 0;
  const runner = f.create({ run: async () => { produced++; return { code: 0, timedOut: false, stdout: "ordinary observation", stderr: "", truncated: false, spawnError: null }; } });
  try {
    await freeze(f.gate);
    for (let i = 0; i < MAX_HELD_WATCHES; i++) await expect(runner.enqueuePrompt("probe", "scheduler OBSERVED", at(i))).rejects.toThrow(/retained durably/);
    await releaseMate(); await updateFirstmateConfig({ home: f.homeB }); await updateFirstmateConfig({ mateAgentId: "mate-B" });
    await runner.runOne(f.homeB, { name: "probe", path: "unused" } as never, at(30));
    expect(produced).toBe(1); expect(await runner.held()).toHaveLength(MAX_HELD_WATCHES);
    await expect(readdir(cutoverGate(f.homeB).directory)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { runner.stop(); }
});

it("RR4 observations already in flight when arming survive the admission cap with an explicit capacity receipt", async () => {
  const f = await fixture(); let produced = 0, release!: () => void;
  const native = new Promise<void>(r => { release = r; });
  const started = signal();
  const runner = f.create({ run: async () => { produced++; if (produced === count) started.open(); await native; return { code: 0, timedOut: false, stdout: "scheduler observed", stderr: "", truncated: false, spawnError: null }; } });
  const count = MAX_HELD_WATCHES + 1;
  const work = Promise.allSettled(Array.from({ length: count }, (_, i) => runner.runOne(f.homeA, { name: `probe-${i}`, path: "unused" } as never, at(i))));
  try {
    await started.promise; await freeze(f.gate); release(); await work;
    expect(await runner.held()).toHaveLength(count); // Baselines advanced before arming; none may be discarded.
    const refusals = await Promise.all((await readdir(join(f.gate.directory, "refusals"))).map(name => readFile(join(f.gate.directory, "refusals", name), "utf8").then(JSON.parse)));
    expect(refusals.filter(row => row.item.id.startsWith("retention-capacity:"))).toHaveLength(1);
    await expect(runner.runOne(f.homeA, { name: "overflow", path: "unused" } as never, at(30))).rejects.toThrow(/retention capacity/);
    expect(produced).toBe(count);
  } finally { release(); await work; runner.stop(); }
});

it("RR4 a script with held output pauses until delivery and a delivered prompt occurrence stays deduplicated", async () => {
  const f = await fixture(); let produced = 0;
  const runner = f.create({ run: async () => { produced++; return { code: 0, timedOut: false, stdout: "scheduler observed", stderr: "", truncated: false, spawnError: null }; } });
  try {
    await freeze(f.gate);
    await expect(runner.runOne(f.homeA, { name: "stateful", path: "unused" } as never, at(0))).rejects.toThrow(/retained durably/);
    await runner.runOne(f.homeA, { name: "stateful", path: "unused" } as never, at(1)); expect(produced).toBe(1);
    await expect(runner.enqueuePrompt("prompt", "scheduler RUN_ONCE", at(0))).rejects.toThrow(/retained durably/);
    await abort(f.gate); await runner.flush();
    await runner.enqueuePrompt("prompt", "scheduler RUN_ONCE", at(0, 45)); await runner.flush();
    expect(f.sends.map(s => s.text).join("\n").split("RUN_ONCE")).toHaveLength(2);
    await runner.runOne(f.homeA, { name: "stateful", path: "unused" } as never, at(2)); expect(produced).toBe(2);
  } finally { runner.stop(); }
});

it("RR5 retained transitions preserve occurrence order across message fitting and reloads", async () => {
  const f = await fixture(); let runner = f.create();
  try {
    await freeze(f.gate);
    for (let i = 0; i < 8; i++) await expect(runner.enqueuePrompt(`probe-${i}`, `scheduler OCCURRENCE_${i} ${"x".repeat(15980)}`, at(i))).rejects.toThrow(/retained durably/);
    await abort(f.gate);
    for (let i = 0; i < 8; i++) { await runner.flush(); runner.stop(); runner = f.create(); }
    expect([...f.sends.map(s => s.text).join("\n").matchAll(/OCCURRENCE_(\d)/g)].map(m => Number(m[1]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(await runner.held()).toEqual([]);
  } finally { runner.stop(); }
});
