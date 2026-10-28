/** RR3–RR7: retained observations keep their owner, occurrence identity, order and exact receipts. */
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
import { MAX_QUEUED, watchItem, WatchRunner, type WatchRunnerOptions } from "./watches";

async function freeze(gate: CutoverGate, plan = "scheduler") {
  await gate.arm([]);
  await gate.run(() => gate.publishSidecar({ format: "firstmate.cutover-sidecar/1", compatibility: MIGRATION_COMPATIBILITY,
    stage: "freeze", homeId: "fixture", planId: plan, migrationId: randomUUID(), scopeId: randomUUID(), at: new Date().toISOString(),
    sourceHash: "1".repeat(64), inventoryHash: "2".repeat(64), transaction: null,
    tokens: { plan, nodes: [], actions: [], agents: [], tasks: [] } }));
}
async function abort(gate: CutoverGate, plan = "scheduler") {
  const { hash: _hash, ...body } = (await gate.sidecar(plan, "freeze"))!;
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
    await abort(f.gate); for (let i = 0; i < 8; i++) await runner.flush();
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
    delete state.queue[0].hold; await writeFile(path, JSON.stringify(state)); // Owner/occurrence identity stays on the ordinary row.
    await releaseMate(); await updateFirstmateConfig({ home: f.homeB }); await updateFirstmateConfig({ mateAgentId: "mate-B" });
    runner = f.create(); f.waiting = false; await runner.flush(); expect(f.sends).toEqual([]);
    await releaseMate(); await updateFirstmateConfig({ home: f.homeA }); await updateFirstmateConfig({ mateAgentId: "mate-A" });
    await runner.flush(); expect(f.sends).toHaveLength(1); expect(f.sends[0]!.recipient).toBe("mate-A");
  } finally { runner.stop(); }
});

it.each(["owner", "payload"])("RR3 malformed queued %s fails closed rather than becoming an ordinary note", async field => {
  const f = await fixture(); let runner = f.create();
  try {
    await freeze(f.gate); await expect(runner.enqueuePrompt("probe", "scheduler OWNED", at(0))).rejects.toThrow(/retained durably/);
    await abort(f.gate); f.waiting = true; await runner.flush(); runner.stop();
    const path = join(f.root, "watches.json"), state = JSON.parse(await readFile(path, "utf8"));
    if (field === "owner") state.queue[0].ownership.owner = "0".repeat(64);
    else state.queue[0].text = null;
    await writeFile(path, JSON.stringify(state));
    runner = f.create(); f.waiting = false;
    await expect(runner.flush()).rejects.toThrow(/provenance/); expect(f.sends).toEqual([]);
    expect(JSON.parse(await readFile(path, "utf8")).queue).toHaveLength(1);
  } finally { runner.stop(); }
});

it("RR4 retention capacity stops prompt growth and scripts before baseline advancement", async () => {
  const f = await fixture(); let produced = 0;
  const runner = f.create({ run: async () => { produced++; return { code: 0, timedOut: false, stdout: "scheduler baseline advanced", stderr: "", truncated: false, spawnError: null }; } });
  try {
    await freeze(f.gate);
    for (let i = 0; i < MAX_QUEUED; i++) await expect(runner.enqueuePrompt("probe", `scheduler COMMAND_${i}`, at(i))).rejects.toThrow(/retained durably/);
    for (let i = 0; i < 8; i++) await expect(runner.enqueuePrompt("probe", "scheduler OVER_CAP", at(MAX_QUEUED, i * 7))).rejects.toThrow(/retention capacity/);
    await expect(runner.runOne(f.homeA, { name: "stateful", path: "unused" } as never, at(30))).rejects.toThrow(/retention capacity/);
    expect(produced).toBe(0); expect(await runner.held()).toHaveLength(MAX_QUEUED); expect(await runner.queued()).toHaveLength(MAX_QUEUED);
    await expect(readdir(join(f.root, "watches.json.held"))).rejects.toMatchObject({ code: "ENOENT" });
    const refusals = await Promise.all((await readdir(join(f.gate.directory, "refusals"))).map(name => readFile(join(f.gate.directory, "refusals", name), "utf8").then(JSON.parse)));
    expect(refusals.filter(row => row.item.id === "retention-capacity:probe")).toHaveLength(1);
    expect(refusals.filter(row => row.item.id === "retention-capacity:stateful")).toHaveLength(1);
    await abort(f.gate); for (let i = 0; i < MAX_QUEUED; i++) await runner.flush(); expect(await runner.held()).toEqual([]);
    await runner.runOne(f.homeA, { name: "stateful", path: "unused" } as never, at(31)); expect(produced).toBe(1);
  } finally { runner.stop(); }
});

it("RR4 concurrent script producers reserve capacity before advancing their baselines", async () => {
  const f = await fixture(); let produced = 0, release!: () => void;
  const native = new Promise<void>(r => { release = r; });
  const started = signal();
  const runner = f.create({ run: async () => { produced++; if (produced === MAX_QUEUED) started.open(); await native; return { code: 0, timedOut: false, stdout: "scheduler observed", stderr: "", truncated: false, spawnError: null }; } });
  await freeze(f.gate);
  const work = Promise.allSettled(Array.from({ length: MAX_QUEUED }, (_, i) => runner.runOne(f.homeA, { name: `probe-${i}`, path: "unused" } as never, at(i))));
  try {
    await started.promise;
    await expect(runner.runOne(f.homeA, { name: "overflow", path: "unused" } as never, at(30))).rejects.toThrow(/retention capacity/);
    expect(produced).toBe(MAX_QUEUED); release(); await work;
    expect(await runner.held()).toHaveLength(MAX_QUEUED);
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
  const count = MAX_QUEUED + 5;
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
    for (let i = 0; i < MAX_QUEUED; i++) await expect(runner.enqueuePrompt("probe", "scheduler OBSERVED", at(i))).rejects.toThrow(/retained durably/);
    await releaseMate(); await updateFirstmateConfig({ home: f.homeB }); await updateFirstmateConfig({ mateAgentId: "mate-B" });
    await runner.runOne(f.homeB, { name: "probe", path: "unused" } as never, at(30));
    expect(produced).toBe(1); expect(await runner.held()).toHaveLength(MAX_QUEUED);
    await expect(readdir(cutoverGate(f.homeB).directory)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { runner.stop(); }
});

it("RR4 observations already in flight when arming survive the admission cap with an explicit capacity receipt", async () => {
  const f = await fixture(); let produced = 0, release!: () => void;
  const native = new Promise<void>(r => { release = r; });
  const started = signal();
  const runner = f.create({ run: async () => { produced++; if (produced === count) started.open(); await native; return { code: 0, timedOut: false, stdout: "scheduler observed", stderr: "", truncated: false, spawnError: null }; } });
  const count = MAX_QUEUED + 1;
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
    await abort(f.gate); await runner.flush(); await runner.flush();
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

async function keepReceipts(gate: CutoverGate) {
  // Committed opaque mentions are allowed and keep their claims available for S07 inventory.
  await freeze(gate, "harbor");
  const { hash: _hash, ...body } = (await gate.sidecar("harbor", "freeze"))!;
  await gate.run(() => gate.publishSidecar({ ...body, stage: "committed" }));
}
const receiptNames = (items: { id: string }[]) => items.map(item => item.id.split("@")[0]);
const deliveredNames = (text: string) => [...text.matchAll(/name="(probe-\d)"/g)].map(match => match[1]);

it.each(["small", "large"])("RR6 %s retained send claims and settles exactly the fitted occurrences", async size => {
  const f = await fixture();
  f.beforeDelivery = async () => {
    const pending = (await f.gate.claims()).filter(row => !row.result);
    expect(pending).toHaveLength(1);
    expect(receiptNames(pending[0]!.claim.items)).toEqual(["probe-0"]);
  };
  let runner = f.create();
  try {
    await keepReceipts(f.gate); await freeze(f.gate);
    for (let i = 0; i < 3; i++) await expect(runner.enqueuePrompt(`probe-${i}`, `scheduler harbor RECEIPT_${i} ${"x".repeat(size === "large" ? 15980 : 0)}`, at(i))).rejects.toThrow(/retained durably/);
    await abort(f.gate); await runner.flush();
    const accepted = (await f.gate.claims()).filter(row => row.result?.outcome === "accepted");
    expect(accepted).toHaveLength(1);
    expect(receiptNames(accepted[0]!.claim.items)).toEqual(deliveredNames(f.sends[0]!.text));
    expect(await runner.held()).toHaveLength(2);
    expect(await runner.queued()).toHaveLength(2);
    // Deferred occurrences have no result until a later native message actually includes them.
    f.beforeDelivery = async () => {};
    for (let i = 0; i < 2; i++) { runner.stop(); runner = f.create(); await runner.flush(); }
    expect(f.sends.flatMap(send => deliveredNames(send.text))).toEqual(["probe-0", "probe-1", "probe-2"]);
    expect(receiptNames((await f.gate.claims()).flatMap(row => row.claim.items))).toEqual(["probe-0", "probe-1", "probe-2"]);
    expect(await runner.held()).toEqual([]);
  } finally { runner.stop(); }
});

it.each(["wait", "uncertain"] as const)("RR6 a partial retained %s result never receipts deferred occurrences", async outcome => {
  const f = await fixture(), runner = f.create({ deliver: async () => {
    if (outcome === "uncertain") throw new Error("native acknowledgement lost");
    return "wait";
  } });
  try {
    await keepReceipts(f.gate); await freeze(f.gate);
    for (let i = 0; i < 3; i++) await expect(runner.enqueuePrompt(`probe-${i}`, `scheduler harbor ${"x".repeat(15980)}`, at(i))).rejects.toThrow(/retained durably/);
    await abort(f.gate); await runner.flush();
    const claims = await f.gate.claims(); expect(claims).toHaveLength(1);
    expect(receiptNames(claims[0]!.claim.items)).toEqual(["probe-0"]);
    expect(claims[0]!.result?.outcome).toBe(outcome === "wait" ? "failed" : "uncertain");
    expect(await runner.queued()).toHaveLength(3); expect(await runner.held()).toHaveLength(3);
  } finally { runner.stop(); }
});

it("RR6 ordinary rows cut to fit are counted as dropped without an accepted delivery receipt", async () => {
  const f = await fixture(), runner = f.create();
  try {
    // Default unarmed batches retain their existing newest-fit/drop behavior.
    for (let i = 0; i < 3; i++) await runner.enqueuePrompt(`probe-${i}`, `harbor ${"x".repeat(15980)}`, at(i));
    await runner.flush();
    expect(deliveredNames(f.sends[0]!.text)).toEqual(["probe-2"]);
    expect(f.sends[0]!.text).toContain('<firstmate-watch-dropped count="2"/>');
    expect(await f.gate.claims()).toEqual([]); expect(await runner.queued()).toEqual([]);
  } finally { runner.stop(); }
});

it.each([{ blocked: 1, ready: false }, { blocked: MAX_QUEUED, ready: false }, { blocked: 1, ready: true }])(
  "RR7 $blocked frozen ordinary rows with ready=$ready cannot starve a released retained scope", async ({ blocked, ready }) => {
    const f = await fixture(), runner = f.create();
    try {
      for (let i = 0; i < blocked; i++) await runner.enqueuePrompt(`harbor-${i}`, "harbor WAIT_FOR_RECONCILIATION", at(i));
      await freeze(f.gate, "harbor"); await freeze(f.gate);
      if (ready) await runner.enqueuePrompt("ordinary-ready", "UNRELATED_READY", at(30));
      await expect(runner.enqueuePrompt("released", "scheduler READY_AFTER_ABORT", at(31))).rejects.toThrow(/retained durably/);
      await abort(f.gate);
      for (let i = 0; i < 3; i++) await runner.flush();
      expect(f.sends.map(send => send.text).join("\n")).toContain("READY_AFTER_ABORT");
      expect(f.sends.map(send => send.text).join("\n")).not.toContain("WAIT_FOR_RECONCILIATION");
      if (ready) expect(f.sends[0]!.text).toContain("UNRELATED_READY");
      const remaining = blocked === MAX_QUEUED ? MAX_QUEUED - 1 : blocked;
      const start = blocked === MAX_QUEUED ? 1 : 0;
      expect((await runner.queued()).map(note => note.name)).toEqual(Array.from({ length: remaining }, (_, i) => `harbor-${i + start}`));
      expect((await runner.held()).map(row => row.note.name)).toEqual(Array.from({ length: remaining }, (_, i) => `harbor-${i + start}`));
      expect((await f.gate.claims()).flatMap(row => row.claim.items)).toEqual([]); // Refused rows were never claimed.
    } finally { runner.stop(); }
  });

it("RR7 a frozen retained prefix cannot block a later admitted occurrence", async () => {
  const f = await fixture(), runner = f.create();
  try {
    await freeze(f.gate);
    await expect(runner.enqueuePrompt("blocked", "scheduler harbor WAIT_FOR_RECONCILIATION", at(0))).rejects.toThrow(/retained durably/);
    await expect(runner.enqueuePrompt("ready", "scheduler READY_AFTER_ABORT", at(1))).rejects.toThrow(/retained durably/);
    await abort(f.gate); f.waiting = true; await runner.flush();
    await freeze(f.gate, "harbor"); f.waiting = false; await runner.flush();
    expect(f.sends).toHaveLength(1); expect(f.sends[0]!.text).toContain("READY_AFTER_ABORT");
    expect(f.sends[0]!.text).not.toContain("WAIT_FOR_RECONCILIATION");
    expect((await runner.held()).map(record => record.note.name)).toEqual(["blocked"]);
    expect((await runner.queued()).map(note => note.name)).toEqual(["blocked"]);
  } finally { runner.stop(); }
});

it("RR7 held rows share ordinary queue capacity and survive ordinary overflow", async () => {
  const f = await fixture(), runner = f.create();
  try {
    for (let i = 0; i < MAX_QUEUED; i++) await runner.enqueuePrompt(`harbor-${i}`, "harbor HELD_ORDINARY", at(i));
    await freeze(f.gate, "harbor"); await freeze(f.gate);
    await expect(runner.enqueuePrompt("released", "scheduler READY_AFTER_ABORT", at(30))).rejects.toThrow(/retained durably/);
    await abort(f.gate); f.waiting = true; await runner.flush();
    expect(await runner.queued()).toHaveLength(MAX_QUEUED);
    await expect(runner.enqueuePrompt("ordinary-new", "UNRELATED_READY", at(31))).rejects.toThrow(/capacity/);
    const queue = await runner.queued();
    expect(queue.filter(note => note.hold)).toHaveLength(MAX_QUEUED);
    expect(queue[0]!.name).toBe("harbor-1"); // Once admission refuses a row, overflow cannot evict it.
    f.waiting = false; await runner.flush();
    await runner.enqueuePrompt("ordinary-new", "UNRELATED_READY", at(31)); await runner.flush();
    expect(f.sends.map(send => send.text).join("\n")).toContain("READY_AFTER_ABORT");
    expect((await runner.queued()).map(note => note.name)).toEqual(Array.from({ length: MAX_QUEUED - 1 }, (_, i) => `harbor-${i + 1}`));
  } finally { runner.stop(); }
});

it("RR4 archive restoration shares the queue cap without discarding protected output", async () => {
  const f = await fixture(), runner = f.create(), archive = f.create({ stateFile: join(f.root, "archived-queue.json") });
  try {
    await freeze(f.gate);
    for (let i = 0; i < MAX_QUEUED; i++) await expect(runner.enqueuePrompt(`held-${i}`, "scheduler HELD", at(i))).rejects.toThrow(/retained durably/);
    await expect(archive.enqueuePrompt("archived", "scheduler ARCHIVED", at(30))).rejects.toThrow(/retained durably/);
    const saved = (await archive.queued())[0]!;
    await expect(runner.restoreQueued(saved)).rejects.toThrow(/capacity/);
    expect(await runner.queued()).toHaveLength(MAX_QUEUED); expect(await archive.queued()).toEqual([saved]);
    const first = watchItem((await runner.queued())[0]!);
    await runner.removeQueued(first.id, first.payloadHash); // An explicit reconciliation frees one slot.
    expect(await runner.restoreQueued(saved)).toBe("restored"); expect(await runner.queued()).toHaveLength(MAX_QUEUED);
    expect((await runner.queued()).at(-1)).toEqual(saved);
  } finally { runner.stop(); archive.stop(); }
});

it("RR3 legacy spool evidence fails closed for explicit reconciliation", async () => {
  const f = await fixture(), runner = f.create();
  try {
    const directory = join(f.root, "watches.json.held"); await mkdir(directory);
    const evidence = join(directory, "legacy.json"); await writeFile(evidence, '{"output":"DO_NOT_LOSE"}');
    await expect(runner.flush()).rejects.toThrow(/Legacy watch spool.*reconciliation/);
    expect(await readFile(evidence, "utf8")).toContain("DO_NOT_LOSE"); expect(f.sends).toEqual([]);
  } finally { runner.stop(); }
});
