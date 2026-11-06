// The /2 anchor format: tips and publications carry only the ownership delta their own
// transaction changed (plus the full ownership digest and the incremental projection set
// hash), instead of embedding the whole retained ownership - which made every anchor grow
// with history and the journal's bytes grow faster than its transaction count (365 MB of
// anchors over 7 MB of events at the owner's 3,349 transactions, a 17 s cold check).
// The migration rewrites existing /1 anchors in place under a published receipt; the
// projection set hash is verified at every transaction, closing the off-stride gap the
// stride spot-check left on /1 journals.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { expected, ids, scope } from "../test/supervision-fixture";
import { workflowFixture } from "../test/workflow-fixture";
import { SupervisionRuntime } from "./supervision-runtime";
import { SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { WorkflowPlanStore } from "./workflow-plans";
import { canonical, digest } from "./submissions";

const identity = async () => ({ state: "alive" as const, start: "anchor-delta-fixture" });

async function journal(transactions: number, legacyFormat = false, fat = false, longLived = false) {
  const home = join(process.env.PASEO_HOME!, randomUUID()), data = join(home, "data");
  const store = new SupervisionStore(data, home, { writable: true, legacyFormat, processIdentity: identity });
  await store.initialize(); await store.acquireCoordinator();
  if (longLived) await store.enableLongLived();
  for (let version = 0; version < transactions; version++) {
    const mutation = fat
      ? [{ kind: "scope" as const, value: { ...scope(store.homeId), id: randomUUID(), version: 1, projectIds: Array.from({ length: 32 }, () => randomUUID()) } }]
      : [{ kind: "scope" as const, value: { ...scope(store.homeId), version: version + 1 } }];
    await store.transact(expected(mutation, fat ? 0 : version), randomUUID(), mutation);
  }
  return { store, home, data };
}

async function anchorBytes(root: string): Promise<number> {
  const dir = join(root, "transactions");
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const names = entry.isDirectory() ? await readdir(join(dir, entry.name)) : [entry.name];
    for (const name of names) if (/\.(?:tip|publication)\.json$/.test(name))
      total += (await stat(join(dir, ...(entry.isDirectory() ? [entry.name, name] : [name])))).size;
  }
  return total;
}

const fileName = (seq: number, kind: string) => `${String(seq).padStart(12, "0")}.${kind}.json`;

async function rewriteFrom(root: string, count: number, from: number, tamper: (events: any[]) => void) {
  const dir = join(root, "transactions");
  const read = async (seq: number, kind: string) => JSON.parse(await readFile(join(dir, fileName(seq, kind)), "utf8"));
  const write = async (seq: number, kind: string, value: unknown) => writeFile(join(dir, fileName(seq, kind)), `${canonical(value)}\n`);
  const unsigned = ({ hash: _hash, ...rest }: any) => rest;
  const events: any[] = [], tips: any[] = [], markers: any[] = [];
  for (let seq = 1; seq <= count; seq++) { events.push(await read(seq, "event")); tips.push(await read(seq, "tip")); markers.push(await read(seq, "publication")); }
  tamper(events);
  for (let i = from; i < count; i++) {
    if (i > 0) events[i].previous = events[i - 1].hash;
    events[i].requestHash = digest(events[i].body);
    events[i].hash = digest(unsigned(events[i]));
    tips[i].previous = i > 0 ? events[i - 1].hash : null;
    tips[i].transactionHash = events[i].hash; tips[i].requestHash = events[i].requestHash;
    tips[i].hash = digest(unsigned(tips[i]));
    markers[i] = { ...tips[i], format: String(tips[i].format).replace("tip", "publication"), hash: "" };
    markers[i].hash = digest(unsigned(markers[i]));
    await write(i + 1, "event", events[i]); await write(i + 1, "tip", tips[i]); await write(i + 1, "publication", markers[i]);
  }
  let prefix = digest({ format: "firstmate.supervision-prefix/1" });
  for (let i = 0; i < count; i++) prefix = digest({ previous: prefix, sequence: i + 1, event: events[i].hash, tip: tips[i].hash, publication: markers[i].hash });
  const checkpoint = JSON.parse(await readFile(join(root, "checkpoint.json"), "utf8"));
  checkpoint.transactionHash = events[count - 1].hash; checkpoint.prefixDigest = prefix;
  checkpoint.anchorHash = digest({ event: events[count - 1].hash, tip: tips[count - 1].hash, publication: markers[count - 1].hash });
  checkpoint.hash = digest(unsigned(checkpoint));
  await writeFile(join(root, "checkpoint.json"), `${canonical(checkpoint)}\n`);
}

it("migrates a legacy journal to delta anchors without changing its status", async () => {
  const { store, home, data } = await journal(128, true, true);
  const before = await store.read();
  expect(before.freshness).toBe("current");
  const bytesBefore = await anchorBytes(store.root);
  const headTip = JSON.parse(await readFile(join(store.root, "transactions", fileName(128, "tip")), "utf8"));
  expect(headTip.format).toBe("firstmate.supervision-tip/1");
  expect(headTip.ownership.scopes).toHaveLength(128);
  await store.releaseCoordinator();

  const migrator = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await migrator.acquireCoordinator();
  await expect(migrator.migrateAnchors()).resolves.toEqual({ migrated: 256, sequence: 128, held: false });
  await expect(migrator.migrateAnchors()).resolves.toMatchObject({ migrated: 0, held: false });

  const after = await new SupervisionStore(data, home).read();
  expect(after.freshness).toBe("current");
  // Everything a reader can see is identical but for the storage accounting, which shrinks.
  expect({ ...after, storage: before.storage }).toEqual(before);
  expect(after.storage.bytes).toBeLessThan(before.storage.bytes);
  const bytesAfter = await anchorBytes(store.root);
  expect(bytesAfter).toBeLessThan(bytesBefore / 3);
  const receipt = JSON.parse(await readFile(join(store.root, "anchor-migration.json"), "utf8"));
  expect(receipt).toMatchObject({ sequence: 128, headHash: before.hash });
  expect(receipt.old).toHaveLength(128); expect(receipt.next).toHaveLength(128);
  const migratedTip = JSON.parse(await readFile(join(store.root, "transactions", fileName(128, "tip")), "utf8"));
  expect(migratedTip.format).toBe("firstmate.supervision-tip/2");
  expect(migratedTip.ownership).toBeUndefined();
  expect(migratedTip.ownershipDelta.entries).toHaveLength(1);

  // New work appends /2 records over the migrated prefix, and a warm reader follows it.
  const reader = new SupervisionStore(data, home);
  expect((await reader.read()).sequence).toBe(128);
  const mutation = [{ kind: "scope" as const, value: { ...scope(store.homeId), id: randomUUID(), version: 1 } }];
  await migrator.transact(expected(mutation, 0), randomUUID(), mutation);
  expect(await reader.read()).toMatchObject({ freshness: "current", sequence: 129 });
  await migrator.releaseCoordinator();

  // A later cold writer over the completed, since-grown migration does no work and no audit.
  const restarted = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await restarted.acquireCoordinator();
  await expect(restarted.migrateAnchors()).resolves.toEqual({ migrated: 0, sequence: 129, held: false });
  expect((await restarted.read()).freshness).toBe("current");
  await restarted.releaseCoordinator();
}, 180_000);

it("resumes an interrupted anchor migration from its receipt", async () => {
  const { store, home, data } = await journal(12, true, true);
  await store.releaseCoordinator();
  let replaced = 0;
  const crashing = new SupervisionStore(data, home, { writable: true, processIdentity: identity,
    boundary: async name => { if (name === "anchor-migration:replaced" && ++replaced === 3) throw new Error("crash mid-migration"); } });
  await crashing.acquireCoordinator();
  // A mid-replacement failure reports held instead of stranding the caller with a throw.
  await expect(crashing.migrateAnchors()).resolves.toEqual({ migrated: 3, sequence: 12, held: true });
  // The mixed journal is held (stale checkpoint), never silently rebuilt over half-replaced anchors.
  expect((await new SupervisionStore(data, home).read()).freshness).toBe("held");
  await expect(crashing.recoverIndex()).rejects.toMatchObject({ code: "HELD", message: expect.stringContaining("Anchor migration is incomplete") });
  await expect(crashing.migrateAnchors()).resolves.toMatchObject({ migrated: 21, sequence: 12, held: false });
  expect(await new SupervisionStore(data, home).read()).toMatchObject({ freshness: "current", sequence: 12 });
  await crashing.releaseCoordinator();
}, 180_000);

it("catches a tampered ownership delta entry in a /2 anchor", async () => {
  const { store, home, data } = await journal(8, false, true);
  expect((await new SupervisionStore(data, home).read()).freshness).toBe("current");
  const dir = join(store.root, "transactions");
  const read = async (seq: number, kind: string) => JSON.parse(await readFile(join(dir, fileName(seq, kind)), "utf8"));
  const unsigned = ({ hash: _hash, ...rest }: any) => rest;
  const tip = await read(3, "tip");
  expect(tip.ownershipDelta.entries).toHaveLength(1);
  tip.ownershipDelta.entries[0].id = randomUUID();
  tip.hash = digest(unsigned(tip));
  const marker = { ...tip, format: "firstmate.supervision-publication/2", hash: "" };
  marker.hash = digest(unsigned(marker));
  await writeFile(join(dir, fileName(3, "tip")), `${canonical(tip)}\n`);
  await writeFile(join(dir, fileName(3, "publication")), `${canonical(marker)}\n`);
  let prefix = digest({ format: "firstmate.supervision-prefix/1" });
  for (let seq = 1; seq <= 8; seq++)
    prefix = digest({ previous: prefix, sequence: seq, event: (await read(seq, "event")).hash, tip: (await read(seq, "tip")).hash, publication: (await read(seq, "publication")).hash });
  const checkpoint = JSON.parse(await readFile(join(store.root, "checkpoint.json"), "utf8"));
  checkpoint.prefixDigest = prefix; checkpoint.hash = digest(unsigned(checkpoint));
  await writeFile(join(store.root, "checkpoint.json"), `${canonical(checkpoint)}\n`);
  expect((await new SupervisionStore(data, home).read()).freshness).toBe("held");
}, 120_000);

it("catches a self-consistent rewrite of a recorded projection hash between stride points", async () => {
  const { store, home, data } = await journal(96);
  expect((await new SupervisionStore(data, home).read()).freshness).toBe("current");
  // Sequence 37 is not a multiple of 64 and not the head: the /1 stride+head check accepted
  // this rewrite. The /2 projection set hash is verified at every transaction.
  await rewriteFrom(store.root, 96, 36, events => { events[36].projectionHash = "f".repeat(64); });
  expect((await new SupervisionStore(data, home).read()).freshness).toBe("held");
}, 180_000);

it("catches a body rewrite whose replay difference settles before the head", async () => {
  const { store, home, data } = await journal(96);
  expect((await new SupervisionStore(data, home).read()).freshness).toBe("current");
  // Grow the scope's projectIds at sequence 37; sequence 38's own body writes the original
  // value back, so the head projection is unchanged. Re-derived hashes make the journal
  // self-consistent; only per-transaction replay comparison catches the detour.
  await rewriteFrom(store.root, 96, 36, events => {
    events[36].body.mutations[0].value.projectIds = [...events[36].body.mutations[0].value.projectIds, randomUUID()];
  });
  expect((await new SupervisionStore(data, home).read()).freshness).toBe("held");
}, 180_000);

it("crosses anchor resets and journal pages with identical cold status", async () => {
  const { store, home, data } = await journal(300, false, true, true);
  const warm = await store.read();
  expect(warm.retainedOwnership).toHaveLength(300);
  expect(warm.retainedOwnership[299]!.scopes).toHaveLength(300);
  // The page-crossing anchor at 257 restarts reconstruction from a full entry list.
  const page = String(Math.floor((257 - 1) / 256)).padStart(12, "0");
  const resetTip = JSON.parse(await readFile(join(store.root, "transactions", page, fileName(257, "tip")), "utf8"));
  expect(resetTip.ownershipDelta.reset).toBe(true);
  expect(resetTip.ownershipDelta.entries.length).toBeGreaterThan(256);
  const cold = await new SupervisionStore(data, home).read();
  expect(cold).toEqual(warm);
  // Warm tail over /2 anchors after the cold read needs no further full scan.
  const reader = new SupervisionStore(data, home);
  await reader.read();
  const scan = vi.spyOn(SupervisionStore.prototype as any, "scanFull");
  const mutation = [{ kind: "scope" as const, value: { ...scope(store.homeId), id: randomUUID(), version: 1 } }];
  await store.transact(expected(mutation, 0), randomUUID(), mutation);
  expect((await reader.read()).sequence).toBe(301);
  expect(scan.mock.calls.length).toBeLessThanOrEqual(1); // at most the background audit
  scan.mockRestore();
  await store.releaseCoordinator();
}, 300_000);

it("keeps warm reads warm when a workflow follows a retirement-only plan", async () => {
  const home = join(process.env.PASEO_HOME!, randomUUID()), data = join(home, "data");
  for (const id of ["build", "trial"]) { await mkdir(join(home, `data/${id}`), { recursive: true }); await writeFile(join(home, `data/${id}/brief.md`), "Bounded fixture evidence only."); }
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  const legacy = new WorkflowPlanStore(join(home, "legacy"), home);
  const run = (command: any) => legacy.execute(command, randomUUID(), "fixture-mate") as Promise<any>;
  const scoped = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await scoped.initialize(); await scoped.acquireCoordinator();
  // A retirement-only plan: its ownership entry comes from a retirement row alone.
  const retiredDef = { ...workflowFixture(), id: "retired", nodes: [workflowFixture().nodes[0]] };
  await run({ op: "draft", definition: retiredDef }); await run({ op: "start", plan: "retired", node: "trial" });
  await writeFile(join(legacy.root, "retired/00000001.json"), "{corrupt");
  const held = (await legacy.read()).quarantined[0]!;
  const receipt = await run({ op: "retire", plan: "retired", expected: held.fingerprint, evidence: "Inspected damaged fixture." });
  const first: SupervisionMutation[] = [{ kind: "scope", value: scope(scoped.homeId) }, { kind: "retirement", scopeId: ids.scope, receipt }];
  await scoped.transact(expected(first), randomUUID(), first);
  // A workflow for another plan, drafted in the legacy log and mirrored in. Its node and
  // launch identities are its own - the fixture's would collide with the retired plan's.
  const laterNode = workflowFixture().nodes[0]!;
  if (laterNode.kind !== "run") throw new Error("fixture");
  await mkdir(join(home, "data/later-node"), { recursive: true });
  await writeFile(join(home, "data/later-node/brief.md"), "Bounded fixture evidence only.");
  const workflowDef = { ...workflowFixture(), id: "later", nodes: [{ ...laterNode, id: "later-node",
    launch: { ...laterNode.launch, id: "later-node", brief: { file: "data/later-node/brief.md" } } }] };
  await run({ op: "draft", definition: workflowDef });
  const event = JSON.parse(await readFile(join(legacy.root, "later/00000000.json"), "utf8"));
  const reader = new SupervisionStore(data, home);
  expect((await reader.read()).freshness).toBe("current");
  const scan = vi.spyOn(SupervisionStore.prototype as any, "scanFull");
  const second: SupervisionMutation[] = [
    { kind: "backend", value: { planId: "later", ownerScopeId: ids.scope, backend: "scoped", state: "active", sourceHash: null, version: 1 } },
    { kind: "workflow", scopeId: ids.scope, event }];
  await scoped.transact(expected(second), randomUUID(), second);
  const status = await reader.read();
  expect(status.freshness).toBe("current");
  // Order: workflow inventories first, retirement inventories after - and no fallback scan.
  expect(status.retainedOwnership.at(-1)?.workflows.map(w => w.plan)).toEqual(["later", "retired"]);
  expect(scan.mock.calls.length).toBeLessThanOrEqual(1); // at most the background audit
  scan.mockRestore();
  await scoped.releaseCoordinator();
}, 180_000);

it("rolls a migrated journal back to a form a pre-/2 reader accepts", async () => {
  const { store, home, data } = await journal(8, true, true);
  const before = await store.read();
  await store.releaseCoordinator();
  const migrator = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await migrator.acquireCoordinator();
  await expect(migrator.migrateAnchors()).resolves.toMatchObject({ migrated: 16, held: false });
  await expect(migrator.rollbackAnchors()).resolves.toEqual({ restored: 16, sequence: 8, converted: 0 });
  const names = await readdir(store.root);
  expect(names).not.toContain("anchor-migration.json");
  expect(names).not.toContain("anchor-backup");
  expect(names).not.toContain("projection-cache.json");
  const tip = JSON.parse(await readFile(join(store.root, "transactions", fileName(8, "tip")), "utf8"));
  expect(tip.format).toBe("firstmate.supervision-tip/1");
  expect(tip.ownership.scopes).toHaveLength(8);
  const after = await new SupervisionStore(data, home, { legacyFormat: true }).read();
  expect(after).toEqual(before);
  await migrator.releaseCoordinator();
}, 180_000);

it("discards the anchor backup only on a verified /2 journal", async () => {
  const { store, home, data } = await journal(4, true, true);
  await store.releaseCoordinator();
  const migrator = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await migrator.acquireCoordinator();
  await migrator.migrateAnchors();
  expect(await readdir(store.root)).toContain("anchor-backup");
  await migrator.discardAnchorBackup();
  expect(await readdir(store.root)).not.toContain("anchor-backup");
  expect(await readdir(store.root)).not.toContain("anchor-migration.json");
  await expect(migrator.rollbackAnchors()).rejects.toMatchObject({ code: "HELD" });
  expect((await migrator.read()).freshness).toBe("current");
  await migrator.releaseCoordinator();
}, 120_000);

it("releases the coordinator claim when migration fails after claiming", async () => {
  const { store, home, data } = await journal(4, true, true);
  await store.releaseCoordinator();
  const runtime = new SupervisionRuntime(data, (root, h) => {
    const created = new SupervisionStore(root, h, { writable: true, processIdentity: identity });
    const original = created.migrateAnchors.bind(created);
    created.migrateAnchors = async () => {
      if ((created as any).coordinator) throw new Error("migration blew up after claiming");
      return original();
    };
    return created;
  });
  try {
    await expect(runtime.mutate(home, async () => {})).rejects.toThrow("migration blew up after claiming");
    // The claim was released: a fresh store can claim the next generation at once.
    const next = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
    await expect(next.acquireCoordinator()).resolves.toBeGreaterThan(0);
    await next.releaseCoordinator();
  } finally { await runtime.stop(); }
}, 120_000);

it("retains ownership from the publication when a late tip is damaged", async () => {
  const { store, home, data } = await journal(24, false, true);
  await store.releaseCoordinator();
  // Damage a tip well past the fallback readahead window; its mirrored publication must
  // stand in at its own sequence, so every later reservation is still retained.
  await writeFile(join(store.root, "transactions", fileName(20, "tip")), "{damaged");
  const held = await new SupervisionStore(data, home).read();
  expect(held.freshness).toBe("held");
  expect(held.retainedOwnership).toHaveLength(24);
  expect(held.retainedOwnership[23]!.scopes).toHaveLength(24);
}, 180_000);

it("serves a restart from the verified projection cache and catches later tampering", async () => {
  const { store, home, data } = await journal(48, false, true);
  const expectedStatus = await store.read();
  await store.releaseCoordinator();
  expect(await readdir(store.root)).toContain("projection-cache.json");
  // Cold instance: cache-bound serve without a checked full scan on the read path.
  const checked = vi.spyOn(SupervisionStore.prototype as any, "checkedFullScan");
  const reader = new SupervisionStore(data, home);
  const cold = await reader.read();
  expect(cold).toEqual(expectedStatus);
  expect(checked.mock.calls.length).toBe(0);
  checked.mockRestore();
  // Refresh the restart cache to the head through a writer claim, then tamper an early event
  // below it: only the background audit can catch this - it must poison the served cache so
  // a later read surfaces held through the ordinary checked scan.
  const claimer = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await claimer.acquireCoordinator(); await claimer.releaseCoordinator();
  const eventPath = join(store.root, "transactions", fileName(3, "event"));
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  event.body.mutations[0].value.projectIds = [randomUUID()];
  event.requestHash = digest(event.body);
  const { hash: _hash, ...unsignedEvent } = event; event.hash = digest(unsignedEvent);
  await writeFile(eventPath, `${canonical(event)}\n`);
  // Fresh instance serves the (still chain-bound at its sequence) cache, then its audit fails.
  const victim = new SupervisionStore(data, home);
  await victim.read();
  let held = false;
  for (let i = 0; i < 60 && !held; i++) { await new Promise(r => setTimeout(r, 250)); held = (await victim.read()).freshness === "held"; }
  expect(held).toBe(true);
}, 300_000);

/** Read the restart cache, mutate it, and rewrite it with a valid file hash (the reviewer's forge). */
async function forgeCache(root: string, mutate: (cache: any) => void): Promise<void> {
  const path = join(root, "projection-cache.json");
  const cache = JSON.parse(await readFile(path, "utf8"));
  mutate(cache);
  const { hash: _hash, ...unsigned } = cache; cache.hash = digest(unsigned);
  await writeFile(path, `${canonical(cache)}\n`);
}

async function untilHeld(reader: SupervisionStore): Promise<boolean> {
  for (let i = 0; i < 80; i++) { if ((await reader.read()).freshness === "held") return true; await new Promise(r => setTimeout(r, 250)); }
  return false;
}

it("never serves a forged restart cache whose frames do not hash to the witnessed projection", async () => {
  const { store, home, data } = await journal(24, false, true);
  const truth = await store.read();
  await store.releaseCoordinator();
  const claimer = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await claimer.acquireCoordinator(); await claimer.releaseCoordinator();
  // Forge: rewrite one cached scope's projectIds and rehash the file (checkpoint untouched).
  await forgeCache(store.root, cache => {
    const entry = cache.frames.find(([, frame]: any) => frame.kind === "scope");
    entry[1].value.projectIds = [randomUUID()];
  });
  const reader = new SupervisionStore(data, home);
  const served = await reader.read();
  // The forged contents are rejected at load (projection recomputed from the frames); the
  // ordinary validated read serves the journal's truth, and no audit can resurrect the forge.
  expect(served.freshness).toBe("current");
  expect(served).toEqual(truth);
  expect((await new SupervisionStore(data, home).read()).scopes.map(s => s.projectIds)).toEqual(truth.scopes.map(s => s.projectIds));
}, 300_000);

it("never serves a forged cached transaction index and never acts on it (R2/R2b)", async () => {
  const { store, home, data } = await journal(24, false, true);
  const truth = await store.read();
  await store.releaseCoordinator();
  const claimer = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await claimer.acquireCoordinator(); await claimer.releaseCoordinator();
  // Forge: the cached index claims transaction 3 was request X with the hash of a request
  // the captain is about to submit (the matching-hash replay trap). The anchors witnessed
  // otherwise, so the whole cache is rejected at load and the index is never served.
  const futureId = randomUUID();
  const mutation = [{ kind: "scope" as const, value: { ...scope(store.homeId), id: randomUUID(), version: 1 } }];
  const futureHash = digest({ actor: { kind: "system", id: "s01-fixture", source: "unwired-storage" }, expectedVersions: expected(mutation, 0), mutations: mutation });
  await forgeCache(store.root, cache => { cache.transactions[2].requestId = futureId; cache.transactions[2].requestHash = futureHash; });
  const victim = new SupervisionStore(data, home);
  expect(await victim.read()).toEqual(truth);
  const page = await victim.historyPage({ after: 0, limit: 100 });
  expect(page.events.map(e => e.requestId)).not.toContain(futureId);
  // Submitting that very request commits it honestly (sequence advances); it is neither
  // refused as a conflict nor answered with a phantom replay receipt.
  const writer = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await writer.acquireCoordinator();
  const receipt = await writer.transact(expected(mutation, 0), futureId, mutation);
  expect(receipt.sequence).toBe(truth.sequence + 1);
  expect((await writer.read()).sequence).toBe(truth.sequence + 1);
  await writer.releaseCoordinator();
}, 300_000);

it("ignores a forged cached projection vector instead of committing on it (R4)", async () => {
  const { store, home, data } = await journal(24, false, true);
  await store.releaseCoordinator();
  const claimer = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await claimer.acquireCoordinator(); await claimer.releaseCoordinator();
  await forgeCache(store.root, cache => { cache.projectionVector = "ff".repeat(128); });
  const writer = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await writer.acquireCoordinator();
  const mutation = [{ kind: "scope" as const, value: { ...scope(store.homeId), id: randomUUID(), version: 1 } }];
  await writer.transact(expected(mutation, 0), randomUUID(), mutation);
  await writer.releaseCoordinator();
  // The write recorded the true set hash (vector recomputed from frames): a cold full
  // validation stays current instead of holding the journal at a real transaction.
  const cold = await new SupervisionStore(data, home).read();
  expect(cold).toMatchObject({ freshness: "current", sequence: 25 });
}, 300_000);

it("finishes the restart audit under steady writes and surfaces damage below the cache", async () => {
  const { store, home, data } = await journal(32, false, true);
  await store.releaseCoordinator();
  const claimer = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await claimer.acquireCoordinator(); await claimer.releaseCoordinator();
  // Corrupt an early event below the cache head, keeping its own hashes self-consistent.
  const eventPath = join(store.root, "transactions", fileName(3, "event"));
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  event.body.mutations[0].value.projectIds = [randomUUID()];
  event.requestHash = digest(event.body);
  const { hash: _hash, ...unsignedEvent } = event; event.hash = digest(unsignedEvent);
  await writeFile(eventPath, `${canonical(event)}\n`);
  // A cache-loaded writer appends steadily while its audit is still running. The audit is
  // bounded to the served prefix, so the appends can neither reset it nor make it give up:
  // the write that waits for it (or the next read) must surface held.
  const writer = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await writer.acquireCoordinator();
  await writer.read();
  let refused = false;
  for (let i = 0; i < 60 && !refused; i++) {
    await new Promise(r => setTimeout(r, 100));
    const mutation = [{ kind: "scope" as const, value: { ...scope(store.homeId), id: randomUUID(), version: 1 } }];
    try { await writer.transact(expected(mutation, 0), randomUUID(), mutation); }
    catch (error) { refused = (error as { code?: string }).code === "HELD"; if (!refused) throw error; }
  }
  expect(refused || await untilHeld(writer)).toBe(true);
  await writer.releaseCoordinator().catch(() => {});
}, 300_000);

it("treats a held post-claim migration like a failure: claim released, writer not registered", async () => {
  const { store, home, data } = await journal(4, true, true);
  await store.releaseCoordinator();
  let created = 0, holdMigration = true;
  const runtime = new SupervisionRuntime(data, (root, h) => {
    created++;
    const createdStore = new SupervisionStore(root, h, { writable: true, processIdentity: identity });
    const original = createdStore.migrateAnchors.bind(createdStore);
    createdStore.migrateAnchors = async () =>
      holdMigration && (createdStore as any).coordinator ? { migrated: 0, sequence: 4, held: true } : original();
    return createdStore;
  });
  try {
    await expect(runtime.mutate(home, async () => {})).rejects.toMatchObject({ code: "HELD" });
    const next = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
    await expect(next.acquireCoordinator()).resolves.toBeGreaterThan(0);
    await next.releaseCoordinator();
    // No writer was registered over the held migration: the next mutate builds a fresh one
    // and the migration is retried (and now completes).
    holdMigration = false;
    await runtime.stop();
    const runtime2 = new SupervisionRuntime(data, (root, h) => { created++; return new SupervisionStore(root, h, { writable: true, processIdentity: identity }); });
    try { await expect(runtime2.mutate(home, async () => {})).resolves.toBeUndefined(); } finally { await runtime2.stop(); }
    expect(created).toBeGreaterThan(1);
  } catch (error) { await runtime.stop().catch(() => {}); throw error; }
}, 120_000);

it("rolls back across post-migration writes by converting the tail to /1 form", async () => {
  const { store, home, data } = await journal(6, true, true);
  await store.releaseCoordinator();
  const migrator = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await migrator.acquireCoordinator();
  await migrator.migrateAnchors();
  // New records are always /2 now; nothing is pinned to the old format for rollback's sake.
  for (let i = 0; i < 3; i++) {
    const mutation = [{ kind: "scope" as const, value: { ...scope(store.homeId), id: randomUUID(), version: 1 } }];
    await migrator.transact(expected(mutation, 0), randomUUID(), mutation);
  }
  const appended = JSON.parse(await readFile(join(store.root, "transactions", fileName(9, "event")), "utf8"));
  expect(appended.format).toBe("firstmate.supervision-transaction/2");
  const beforeRollback = await migrator.read();
  expect(beforeRollback).toMatchObject({ freshness: "current", sequence: 9 });
  // Rollback restores the migrated prefix from backups and converts the /2 tail itself.
  await expect(migrator.rollbackAnchors()).resolves.toMatchObject({ restored: 12, sequence: 9, converted: 3 });
  for (const seq of [1, 6, 7, 9]) {
    const event = JSON.parse(await readFile(join(store.root, "transactions", fileName(seq, "event")), "utf8"));
    const tip = JSON.parse(await readFile(join(store.root, "transactions", fileName(seq, "tip")), "utf8"));
    expect(event.format).toBe("firstmate.supervision-transaction/1");
    expect(tip.format).toBe("firstmate.supervision-tip/1");
    expect(tip.ownership.scopes.length).toBeGreaterThan(0);
  }
  const rolledBack = await new SupervisionStore(data, home, { legacyFormat: true }).read();
  expect(rolledBack.freshness).toBe("current");
  expect(rolledBack.sequence).toBe(9);
  expect(rolledBack.scopes).toEqual(beforeRollback.scopes);
  await migrator.releaseCoordinator();
  // Re-migrate and discard: the backup is gone and rollback no longer exists to take.
  const second = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await second.acquireCoordinator();
  await second.migrateAnchors();
  await second.discardAnchorBackup();
  await expect(second.rollbackAnchors()).rejects.toMatchObject({ code: "HELD" });
  const mutation = [{ kind: "scope" as const, value: { ...scope(store.homeId), id: randomUUID(), version: 1 } }];
  await second.transact(expected(mutation, 0), randomUUID(), mutation);
  const after = JSON.parse(await readFile(join(store.root, "transactions", fileName(10, "event")), "utf8"));
  expect(after.format).toBe("firstmate.supervision-transaction/2");
  await second.releaseCoordinator();
}, 300_000);

it("catches an off-stride rewrite of a record written after migration (R8)", async () => {
  const { store, home, data } = await journal(8, true, true);
  await store.releaseCoordinator();
  const migrator = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await migrator.acquireCoordinator();
  await migrator.migrateAnchors();
  for (let i = 0; i < 8; i++) {
    const mutation = [{ kind: "scope" as const, value: { ...scope(store.homeId), id: randomUUID(), version: 1, projectIds: Array.from({ length: 32 }, () => randomUUID()) } }];
    await migrator.transact(expected(mutation, 0), randomUUID(), mutation);
  }
  await migrator.releaseCoordinator();
  // Self-consistent rewrite from a post-migration sequence (chain, anchors and checkpoint
  // all re-derived); the per-transaction set hash on the /2 records catches it at replay.
  await rewriteFrom(store.root, 16, 10, events => { events[10].projectionHash = digest("forged-projection"); });
  const held = await new SupervisionStore(data, home).read();
  expect(held.freshness).toBe("held");
}, 300_000);

it("expires the anchor backup a week after migration on a verified writer", async () => {
  const { store, home, data } = await journal(6, true, true);
  await store.releaseCoordinator();
  const migrator = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await migrator.acquireCoordinator();
  await migrator.migrateAnchors();
  await migrator.releaseCoordinator();
  expect(await readdir(store.root)).toContain("anchor-backup");
  // Not yet a week old: a fresh writer keeps the backup.
  const early = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await early.acquireCoordinator(); await early.migrateAnchors(); await early.releaseCoordinator();
  expect(await readdir(store.root)).toContain("anchor-backup");
  // Age the receipt past the TTL (rehashed, as an old receipt legitimately looks).
  const receiptPath = join(store.root, "anchor-migration.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.createdAt = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  const { hash: _hash, ...unsigned } = receipt; receipt.hash = digest(unsigned);
  await writeFile(receiptPath, `${canonical(receipt)}\n`);
  const later = new SupervisionStore(data, home, { writable: true, processIdentity: identity });
  await later.acquireCoordinator(); await later.migrateAnchors(); await later.releaseCoordinator();
  expect(await readdir(store.root)).not.toContain("anchor-backup");
  expect(await readdir(store.root)).not.toContain("anchor-migration.json");
  expect((await new SupervisionStore(data, home).read()).freshness).toBe("current");
}, 300_000);
