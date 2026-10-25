import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { rolldown } from "rolldown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupervisionStore } from "./supervision-store";
import { supervisionProcessIdentity } from "./supervision-process";
import { expected, hash, ids, scope, seed } from "../test/supervision-fixture";
import type { SupervisionMutation } from "./supervision-store";
import { capture, captureLedger, observed } from "../test/ci-diagnostics";
import { WARMUP_TIMEOUT_MS, warmWindowsIdentityProbe } from "../test/supervision-warmup";

let bundle: string;
const children = new Set<ChildProcess>();
beforeAll(async () => {
  const directory = join(process.env.PASEO_HOME!, "child-bundle"); await mkdir(directory);
  bundle = join(directory, "child.cjs");
  const build = await rolldown({ input: resolve("test/supervision-child.ts"), platform: "node" });
  try { await build.write({ file: bundle, format: "cjs" }); } finally { await build.close(); }
});
// Windows: the first PowerShell start on a cold runner took 3.3–5.3 s, past the probe's 5 s deadline, in whichever
// child ran first. Pay it here, under the warm-up's own bound, so every child's probe runs warm; assertions are unchanged.
beforeAll(async () => {
  if (process.platform === "win32") capture("crash-probe-warmup", { result: await observed("crash-probe-warmup-run", {}, warmWindowsIdentityProbe()) });
}, WARMUP_TIMEOUT_MS + 10000);
afterAll(() => { for (const child of children) child.kill("SIGKILL"); });
afterAll(() => captureLedger("crash"));
async function launch(config: object) {
  const path = join(process.env.PASEO_HOME!, `${randomUUID()}.json`); await writeFile(path, JSON.stringify(config));
  const child = spawn(process.execPath, [bundle, path], { windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"], env: { ...process.env } });
  children.add(child); let stdout = "", stderr = "", crashBoundary: string | null = null;
  child.stdout!.on("data", bytes => { stdout += String(bytes); }); child.stderr!.on("data", bytes => { stderr += String(bytes); });
  child.on("message", message => {
    if (typeof message === "object" && message && "crashBoundary" in message && typeof message.crashBoundary === "string") {
      crashBoundary = message.crashBoundary;
      child.send({ crashAck: crashBoundary });
    }
  });
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; crashBoundary: string | null }>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Fixture child timed out: ${stdout} ${stderr}`)); }, 20000);
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", (code, signal) => { clearTimeout(timeout); children.delete(child); resolve({ code, signal, stdout, stderr, crashBoundary }); });
  });
  return { child, done, output: () => stdout };
}
function expectTargetCrash(result: Awaited<Awaited<ReturnType<typeof launch>>["done"]>, point: string) {
  expect(result.crashBoundary, `Child did not reach ${point}: ${JSON.stringify(result)}`).toBe(point);
  expect(result.stderr).toBe("");
  expect(result.code === 0).toBe(false);
}
async function fixture() {
  const directory = join(process.env.PASEO_HOME!, randomUUID()), home = join(directory, "home"), dataRoot = join(directory, "data");
  const store = new SupervisionStore(dataRoot, home, { writable: true }); await store.initialize();
  return { home, dataRoot, store };
}
describe("actual child-process / filesystem publication", () => {
  const points = ["tip:written", "tip:synced", "tip:linked", "event:written", "event:synced", "event:linked", "publication:written", "publication:synced", "publication:linked"];
  for (const point of points) it(`SIGKILL at ${point}: no partial exposure, duplicate reservation or budget reset`, async () => {
    const { store, home, dataRoot } = await fixture(), mutations = seed(store.homeId), requestId = randomUUID();
    if (point === "publication:linked") for (const mutation of mutations) if (mutation.kind === "effect") mutation.value.state = "dispatching";
    const childStart = performance.now();
    const worker = await launch({ home, dataRoot, mode: "crash", crash: point, mutations, expected: expected(mutations), requestId });
    const result = await worker.done;
    // CI diagnostics only (inert locally): bounded child result and duration for this crash point.
    capture("crash-child", { point, code: result.code, signal: result.signal, stdoutBytes: result.stdout.length, stderr: result.stderr.slice(0, 4096), ms: performance.now() - childStart });
    // A child killed at its crash point writes nothing to stderr. A pre-claim refusal (for example a timed-out
    // Windows process-identity probe, UNSUPPORTED) writes its error there; fail on that cause, not later on generation.
    if (result.stderr !== "") { // Gather coordinator context only for the failure; successful crash cases do no extra work.
      const coordinators = await readdir(join(store.root, "coordinators")).catch((error: unknown) => [String(error)]);
      expect(result.stderr, `child exit ${result.code}, signal ${result.signal}, coordinators [${coordinators.join(", ")}]`).toBe("");
    }
    expectTargetCrash(result, point);
    expect(result.stdout).toBe(""); expect(result.code === 0).toBe(false);
    const status = await store.read();
    const exposed = point === "publication:linked", beforeTip = ["tip:written", "tip:synced"].includes(point);
    const recoverable = ["event:linked", "publication:written", "publication:synced"].includes(point);
    expect(status.sequence).toBe(exposed ? 1 : 0);
    expect(status.freshness).toBe(exposed || beforeTip ? "current" : "held"); expect(status.executable).toBe(false);
    if (!beforeTip) expect(status.retainedOwnership.some(o => o.attempts.some(a => a.id === ids.attempt && a.spentAgents === 1))).toBe(true);
    if (exposed) {
      const receipt = await store.transact(expected(mutations), requestId, mutations);
      expect(receipt).toMatchObject({ requestId, sequence: 1, generation: 1, hash: status.hash });
      expect((await store.read()).attempts[0]?.spentAgents).toBe(1);
      expect(status.uncertainEffectIds).toEqual([ids.effect]); // Coordinator death never proves external termination.
    } else if (beforeTip || recoverable) {
      expect(await observed("crash-parent-acquire", { point }, store.acquireCoordinator())).toBe(2); // Confirmed OS process death, never TTL.
      if (recoverable) {
        const receipt = await store.recoverPublication();
        expect(receipt?.requestId).toBe(requestId);
        expect(await store.transact(expected(mutations), requestId, mutations)).toEqual(receipt);
      } else await store.transact(expected(mutations), requestId, mutations);
      expect((await store.read()).attempts[0]?.spentAgents).toBe(1);
      expect((await readdir(join(store.root, "transactions"))).filter(f => f.endsWith(".event.json"))).toHaveLength(1);
      await store.releaseCoordinator();
    } else {
      // Missing event after a tip is never guessed away. Launch inventory reconciliation is S04/S07.
      await expect(store.acquireCoordinator()).rejects.toMatchObject({ code: "HELD" });
      await expect(store.recoverPublication()).rejects.toMatchObject({ code: "HELD" });
    }
  }, 30000);
  it("races actual exclusive links from two processes: one whole record, one EEXIST refusal", async () => {
    const path = join(process.env.PASEO_HOME!, `${randomUUID()}.publication.json`);
    const workers = await Promise.all([launch({ mode: "publish", path }), launch({ mode: "publish", path })]);
    const results = await Promise.all(workers.map(w => w.done));
    expect(results.filter(r => r.code === 0)).toHaveLength(1);
    expect(results.filter(r => r.code === 2)[0]?.stderr).toContain("EEXIST");
    const record = JSON.parse(await readFile(path, "utf8")); expect(Number.isSafeInteger(record.pid)).toBe(true);
  }, 30000);
  it("races two process claims/transactions against the same expected rows: one owner/effect commit", async () => {
    const { store, home, dataRoot } = await fixture();
    const workers = await Promise.all([0, 1].map(async () => {
      const mutations = seed(store.homeId);
      return launch({ home, dataRoot, mode: "claim", mutations, expected: expected(mutations), requestId: randomUUID() });
    }));
    const results = await Promise.all(workers.map(worker => worker.done));
    expect(results.filter(r => r.code === 0)).toHaveLength(1);
    const refused = results.find(r => r.code === 2)!;
    expect(["STALE", "HELD", "CONFLICT"]).toContain(JSON.parse(refused.stderr).code);
    const status = await store.read(); expect(status.sequence).toBe(1); expect(status.effects).toHaveLength(1); expect(status.attempts).toHaveLength(1);
  }, 30000);
  for (const point of ["tip:linked", "event:linked", "publication:linked"]) it(`backend barrier crash at ${point}: both writer choices remain held`, async () => {
    const { store, home, dataRoot } = await fixture();
    await store.acquireCoordinator();
    const initial: SupervisionMutation[] = [{ kind: "scope", value: { ...scope(store.homeId), mode: "legacy", state: "active" } },
      { kind: "backend", value: { planId: "legacy", ownerScopeId: ids.scope, backend: "legacy", state: "active", sourceHash: hash, version: 1 } }];
    await store.transact(expected(initial), randomUUID(), initial); await store.releaseCoordinator();
    const barrier: SupervisionMutation[] = [{ kind: "scope", value: { ...scope(store.homeId), mode: "legacy", state: "transferring", version: 2 } },
      { kind: "backend", value: { planId: "legacy", ownerScopeId: ids.scope, backend: "legacy", state: "prepared", sourceHash: hash, version: 2 } }];
    const worker = await launch({ home, dataRoot, mode: "crash", crash: point, mutations: barrier, expected: expected(barrier, 1), requestId: randomUUID() });
    expectTargetCrash(await worker.done, point);
    const routing = await store.backend("legacy"); expect(routing).toMatchObject({ backend: "legacy", held: true });
    expect((await store.read()).sequence).toBe(point === "publication:linked" ? 2 : 1);
    // This is the journal barrier only. S07 owns source/delivery inventory and actual backend switching.
  }, 30000);
  it("distinguishes a refused process identity before claim from the requested publication crash", async () => {
    const { store, home, dataRoot } = await fixture(), mutations = seed(store.homeId);
    const worker = await launch({ home, dataRoot, mode: "crash", crash: "tip:written", unknownProcessIdentity: true,
      mutations, expected: expected(mutations), requestId: randomUUID() });
    const result = await worker.done;
    expect(result).toMatchObject({ code: 2, crashBoundary: null, stdout: "" });
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "UNSUPPORTED" });
    expect(() => expectTargetCrash(result, "tip:written")).toThrow("Child did not reach tip:written");
    expect(await readdir(join(store.root, "coordinators"))).toEqual([]);
    // First acquisition is generation 1: this is not a recovery of the requested killed writer.
    expect(await store.acquireCoordinator()).toBe(1);
    await store.releaseCoordinator();
  }, 30000);
  it("refuses a live overlapping installation, then permits only explicit released handoff", async () => {
    const { store, home, dataRoot } = await fixture();
    const owner = await launch({ home, dataRoot, mode: "hold" });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Owner fixture did not become ready")), 15000);
        owner.child.stdout!.on("data", () => { if (owner.output().includes("ready")) { clearTimeout(timeout); resolve(); } });
        void owner.done.then(result => { clearTimeout(timeout); reject(new Error(`Owner exited before ready: ${result.stderr}`)); });
      });
      const contender = await launch({ home, dataRoot, mode: "claim" });
      expect(await contender.done).toMatchObject({ code: 2 });
      expect((await readdir(join(store.root, "coordinators"))).filter(f => /^\d{12}\.json$/.test(f))).toHaveLength(1);
      owner.child.send("release"); expect((await owner.done).code).toBe(0);
      expect(await store.acquireCoordinator()).toBe(2); await store.releaseCoordinator();
    } finally { if (children.has(owner.child)) owner.child.kill("SIGKILL"); }
  }, 30000);
  it("qualifies the actual local PID/start probe without treating an unsupported OS as dead", async () => {
    const self = await supervisionProcessIdentity(process.pid);
    if (["win32", "linux"].includes(process.platform)) expect(self).toMatchObject({ state: "alive", start: expect.any(String) });
    else expect(self).toEqual({ state: "unknown" });
    expect(await supervisionProcessIdentity(-1)).toEqual({ state: "unknown" });
  });
});
