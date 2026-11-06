// The /2 anchor format: tips and publications carry only the ownership delta their own
// transaction changed (plus the full ownership digest and the incremental projection set
// hash), instead of embedding the whole retained ownership - which made every anchor grow
// with history and the journal's bytes grow faster than its transaction count (365 MB of
// anchors over 7 MB of events at the owner's 3,349 transactions, a 17 s cold check).
// The migration rewrites existing /1 anchors in place under a published receipt; the
// projection set hash is verified at every transaction, closing the off-stride gap the
// stride spot-check left on /1 journals.
import { randomUUID } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { expected, scope } from "../test/supervision-fixture";
import { SupervisionStore } from "./supervision-store";
import { canonical, digest } from "./submissions";

const identity = async () => ({ state: "alive" as const, start: "anchor-delta-fixture" });

async function journal(transactions: number, legacyFormat = false, fat = false) {
  const home = join(process.env.PASEO_HOME!, randomUUID()), data = join(home, "data");
  const store = new SupervisionStore(data, home, { writable: true, legacyFormat, processIdentity: identity });
  await store.initialize(); await store.acquireCoordinator();
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
  await expect(crashing.migrateAnchors()).rejects.toThrow("crash mid-migration");
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
