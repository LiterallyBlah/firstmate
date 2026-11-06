// Regression for the recurring "Plans are still loading after a restart" / "some plans
// unavailable" banner: a cold journal validation used to copy and re-serialize the whole
// projection once per transaction (quadratic in journal length — about 27 s at the owner's
// 1,464 transactions), the runtime paid that validation twice at startup (its status reader
// and its writer were separate instances), and every legacy plan write paid it again inside
// the writer's lock (the route check built a fresh store per mutation). The bounds here are
// work counts, not wall time: deep copies and full scans per cold start.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { PlanDefinitionSchema, type PlanDefinition } from "../shared/workflow-plans";
import { expected, scope } from "../test/supervision-fixture";
import { pluginDir } from "./data-dir";
import { SupervisionRuntime } from "./supervision-runtime";
import { SupervisionStore, supervisionDigestStats } from "./supervision-store";
import { canonical, digest } from "./submissions";
import { workflowStore } from "./workflow-service";

afterEach(() => vi.restoreAllMocks());

async function journal(transactions: number, dataRoot?: string) {
  const home = join(process.env.PASEO_HOME!, randomUUID()), data = dataRoot ?? join(home, "data");
  const store = new SupervisionStore(data, home, { writable: true,
    processIdentity: async () => ({ state: "alive", start: "cold-read-fixture" }) });
  await store.initialize(); await store.acquireCoordinator();
  for (let version = 0; version < transactions; version++) {
    const mutation = [{ kind: "scope" as const, value: { ...scope(store.homeId), version: version + 1 } }];
    await store.transact(expected(mutation, version), randomUUID(), mutation);
  }
  return { store, home, data };
}
const fullScans = () => vi.spyOn(SupervisionStore.prototype as any, "scanFull");

it("a cold read folds the journal without copying the whole projection per transaction", async () => {
  const { store, home, data } = await journal(48);
  const expectedStatus = await store.read();
  const clone = vi.spyOn(globalThis, "structuredClone");
  const cold = await new SupervisionStore(data, home).read();
  // Replay replaces rows instead of deep-cloning every row per transaction; all that remains
  // is the read's own copy of the finished status. It was one clone per transaction before.
  expect(clone.mock.calls.length).toBeLessThanOrEqual(4);
  clone.mockRestore();
  expect(cold).toEqual(expectedStatus);
}, 120_000);

it("the runtime validates the journal once across its first read and first write", async () => {
  const { store, home, data } = await journal(6);
  await store.releaseCoordinator();
  const runtime = new SupervisionRuntime(data, (root, h) => new SupervisionStore(root, h, { writable: true,
    processIdentity: async () => ({ state: "alive", start: "cold-read-runtime" }) }));
  const scan = fullScans();
  try {
    expect((await runtime.read(home)).freshness).toBe("current");
    await runtime.mutate(home, async writer => { expect((await writer.read()).freshness).toBe("current"); });
    expect((await runtime.read(home)).freshness).toBe("current");
    // Every read-only view reads through that same current store behind a read-only face:
    // one warm cache, and writes still refuse like a never-writable store.
    const inert = runtime.inertStore(home);
    expect(inert).not.toBe(runtime.readStore(home));
    expect(runtime.inertStore(home)).toBe(inert);
    expect((await inert.read()).freshness).toBe("current");
    await expect(inert.transact([], "inert-refusal", [])).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(inert.putBlob(new Uint8Array([1]))).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(inert.acquireCoordinator()).rejects.toMatchObject({ code: "UNSUPPORTED" });
    // One validation serves the read, the inert views and the write (the writer adopts the
    // reader's completed check and absorbs its own coordinator claim); separate instances
    // each paid a full cold validation, racing on the one thread after every restart.
    expect(scan).toHaveBeenCalledTimes(1);
  } finally { await runtime.stop(); }
}, 120_000);

function definition(id: string): PlanDefinition {
  const node = `${id}-build`;
  return PlanDefinitionSchema.parse({ format: "firstmate.plan/1", id, title: `Plan ${id}`, request: { text: "Build it", at: "2026-10-20T12:00:00Z" },
    budget: { agents: 5, turns: 5 }, nodes: [{ id: node, kind: "run", title: "Build", summary: "Build the requested change", workflow: "task@1",
      launch: { id: node, title: "Build", agentTitle: "Build", project: "project", host: "local", baseBranch: "main", kind: "ship", mode: "reviewed-PR",
        brief: { file: `data/${node}/brief.md` }, agent: { provider: "codex/model", modeId: "full-access" }, backlog: { existing: "none" } } }] });
}

it("legacy plan writes reuse one warm journal reader for the route check", async () => {
  const { store, home } = await journal(3, pluginDir());
  await store.releaseCoordinator();
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  for (const id of ["route-one", "route-two"]) {
    await mkdir(join(home, "data", `${id}-build`), { recursive: true });
    await writeFile(join(home, "data", `${id}-build`, "brief.md"), "Build only this.");
  }
  const scan = fullScans();
  await workflowStore(home).execute({ op: "draft", definition: definition("route-one") }, randomUUID(), "mate");
  await workflowStore(home).execute({ op: "draft", definition: definition("route-two") }, randomUUID(), "mate");
  // The shared reader validates once; a fresh store per mutation validated in full per write.
  expect(scan.mock.calls.length).toBeLessThanOrEqual(1);
}, 120_000);

it("cold-check hash work and memory stay linear as the projection grows", async () => {
  // Each transaction adds a fat new scope row, so the projection (and every anchor after it)
  // grows with history - the shape that made per-transaction whole-projection hashing and
  // whole-anchor retention quadratic at the owner's 2k+ transactions.
  const home = join(process.env.PASEO_HOME!, randomUUID()), data = join(home, "data");
  const store = new SupervisionStore(data, home, { writable: true,
    processIdentity: async () => ({ state: "alive", start: "cold-read-scale" }) });
  await store.initialize(); await store.acquireCoordinator();
  const transactions = 96;
  for (let i = 0; i < transactions; i++) {
    const value = { ...scope(store.homeId), id: randomUUID(), version: 1,
      projectIds: Array.from({ length: 32 }, () => randomUUID()) };
    await store.transact(expected([{ kind: "scope", value }]), randomUUID(), [{ kind: "scope", value }]);
  }
  const before = { ...supervisionDigestStats };
  let peakHeap = 0;
  const sampler = setInterval(() => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); }, 5);
  const heapBefore = process.memoryUsage().heapUsed;
  const cold = await new SupervisionStore(data, home).read().finally(() => clearInterval(sampler));
  expect(cold.freshness).toBe("current"); expect(cold.sequence).toBe(transactions);
  // The whole-projection digest runs only at the head (plus its checkpoint comparison),
  // never once per transaction, and ownership hashing stays a small constant per event.
  expect(supervisionDigestStats.frameCalls - before.frameCalls).toBeLessThanOrEqual(Math.floor(transactions / 64) + 2);
  expect(supervisionDigestStats.ownershipCalls - before.ownershipCalls).toBeLessThanOrEqual(transactions * 3 + 8);
  // Smoke bound against retaining every parsed anchor for the whole check (the gigabyte
  // peak at production scale); the durable guards are the hash-work counts above.
  expect(peakHeap - heapBefore).toBeLessThan(96 * 1024 * 1024);
}, 180_000);

it("a coordinator claim does not absorb another writer's change made in its window", async () => {
  const home = join(process.env.PASEO_HOME!, randomUUID()), data = join(home, "data");
  const identity = async () => ({ state: "alive" as const, start: "cold-read-claim" });
  const writer = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await writer.initialize(); await writer.acquireCoordinator();
  const blob = await writer.putBlob(new TextEncoder().encode("evidence under claim"));
  const blobMutation = [{ kind: "blob" as const, value: blob }];
  await writer.transact(expected(blobMutation, 0), randomUUID(), blobMutation);
  const scopeMutation = [{ kind: "scope" as const, value: { ...scope(writer.homeId), version: 1 } }];
  await writer.transact(expected(scopeMutation, 0), randomUUID(), scopeMutation);
  await writer.releaseCoordinator();
  // A second instance validates, then claims the coordinator while the blob file disappears
  // in the claim's publish window (the boundary hook stands in for the other writer).
  let removed = false;
  const claimant = new SupervisionStore(data, home, { writable: true, processIdentity: identity,
    boundary: async name => { if (name === "coordinator:linked" && !removed) { removed = true; await rm(join(claimant.root, "blobs", blob.id)); } } });
  expect((await claimant.read()).freshness).toBe("current");
  await claimant.acquireCoordinator();
  expect(removed).toBe(true);
  // The absorbed directories must not bless the removal: the next read re-validates and holds.
  expect((await claimant.read()).freshness).toBe("held");
}, 120_000);

it("a self-consistent rewrite of a recorded projection hash is caught at its stride point", async () => {
  // The remaining gap from head-only projection checking: change a middle event's recorded
  // projectionHash, re-derive every later event/tip/publication hash and the checkpoint so
  // the journal is fully self-consistent. Only replay comparison can catch it - the stride
  // check (every 64th, plus head) restores that at the tampered point.
  const { store, home, data } = await journal(96);
  expect((await new SupervisionStore(data, home).read()).freshness).toBe("current");
  const dir = join(store.root, "transactions");
  const name = (seq: number, kind: string) => join(dir, `${String(seq).padStart(12, "0")}.${kind}.json`);
  const read = async (seq: number, kind: string) => JSON.parse(await readFile(name(seq, kind), "utf8"));
  const write = async (seq: number, kind: string, value: unknown) => writeFile(name(seq, kind), `${canonical(value)}\n`);
  const unsigned = ({ hash: _hash, ...rest }: any) => rest;
  const events: any[] = [], tips: any[] = [], markers: any[] = [];
  for (let seq = 1; seq <= 96; seq++) { events.push(await read(seq, "event")); tips.push(await read(seq, "tip")); markers.push(await read(seq, "publication")); }
  events[63].projectionHash = "f".repeat(64);
  for (let i = 63; i < 96; i++) {
    if (i > 0) events[i].previous = events[i - 1].hash;
    events[i].hash = digest(unsigned(events[i]));
    tips[i].previous = i > 0 ? events[i - 1].hash : null; tips[i].transactionHash = events[i].hash;
    tips[i].hash = digest(unsigned(tips[i]));
    markers[i] = { ...tips[i], format: "firstmate.supervision-publication/1", hash: "" };
    markers[i].hash = digest(unsigned(markers[i]));
    await write(i + 1, "event", events[i]); await write(i + 1, "tip", tips[i]); await write(i + 1, "publication", markers[i]);
  }
  let prefix = digest({ format: "firstmate.supervision-prefix/1" });
  for (let i = 0; i < 96; i++) prefix = digest({ previous: prefix, sequence: i + 1, event: events[i].hash, tip: tips[i].hash, publication: markers[i].hash });
  const checkpoint = JSON.parse(await readFile(join(store.root, "checkpoint.json"), "utf8"));
  checkpoint.transactionHash = events[95].hash; checkpoint.prefixDigest = prefix;
  checkpoint.anchorHash = digest({ event: events[95].hash, tip: tips[95].hash, publication: markers[95].hash });
  checkpoint.hash = digest(unsigned(checkpoint));
  await writeFile(join(store.root, "checkpoint.json"), `${canonical(checkpoint)}\n`);
  expect((await new SupervisionStore(data, home).read()).freshness).toBe("held");
}, 180_000);
