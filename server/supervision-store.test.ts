import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { canonical, digest } from "./submissions";
import * as submissions from "./submissions";
import * as filesystem from "node:fs/promises";
import { workflowHomeIdentity } from "./workflow-ownership";
import { expected, hash, ids, scope, seed } from "../test/supervision-fixture";

// Keep real filesystem IO; wrap only stat so a regression can unlink one exact fixture file
// after directory enumeration and before its stat. Node's native ESM namespace is sealed.
vi.mock(import("node:fs/promises"), async importOriginal => {
  const actual = await importOriginal(); return { ...actual, stat: vi.fn(actual.stat) as typeof actual.stat };
});

let home: string, dataRoot: string, store: SupervisionStore;
const processIdentity = vi.fn(async () => ({ state: "alive" as const, start: "isolated-fixture-process" }));
beforeEach(async () => {
  const base = join(process.env.PASEO_HOME!, randomUUID());
  home = join(base, "home"); dataRoot = join(base, "data");
  store = new SupervisionStore(dataRoot, home, { writable: true, processIdentity });
  await store.initialize(); await store.acquireCoordinator(); processIdentity.mockClear();
});
const file = (sequence: number, suffix: string) => join(store.root, "transactions", `${String(sequence).padStart(12, "0")}.${suffix}.json`);
const commit = (mutations: SupervisionMutation[], request = randomUUID()) => store.transact(expected(mutations), request, mutations);
async function tree(path: string): Promise<unknown> {
  const rows = await readdir(path, { withFileTypes: true });
  return Promise.all(rows.sort((a, b) => a.name.localeCompare(b.name)).map(async row => [row.name,
    row.isDirectory() ? await tree(join(path, row.name)) : (await readFile(join(path, row.name))).toString("base64")]));
}
describe("scoped transaction authority", () => {
  it.each(["blobs", "transactions"] as const)("keeps a current read when an inert %s temp is unlinked between listing and stat", async directory => {
    await commit([{ kind: "scope", value: scope(store.homeId) }]);
    const before = await store.read(), temp = join(store.root, directory, directory === "blobs" ? `${hash}.${randomUUID()}.tmp` : `000000000099.event.json.${randomUUID()}.tmp`);
    await writeFile(temp, "inert publication staging bytes");
    const original = (await vi.importActual<typeof filesystem>("node:fs/promises")).stat, spy = vi.mocked(filesystem.stat); let removed = false;
    spy.mockImplementation(async (...args) => {
      if (String(args[0]) === temp) { await rm(temp); removed = true; }
      return original(...args);
    });
    try {
      // A new instance validates everything, so it lists and sizes the staging file.
      const after = await new SupervisionStore(dataRoot, home).read();
      expect(removed).toBe(true); expect(after.freshness).toBe("current"); expect(after).toEqual(before);
    } finally { spy.mockReset(); spy.mockImplementation(original); }
  });
  it("holds if a durable event disappears between listing and stat", async () => {
    await commit([{ kind: "scope", value: scope(store.homeId) }]);
    const event = file(1, "event"), original = (await vi.importActual<typeof filesystem>("node:fs/promises")).stat, spy = vi.mocked(filesystem.stat);
    spy.mockImplementation(async (...args) => { if (String(args[0]) === event) await rm(event); return original(...args); });
    try { expect((await store.read()).freshness).toBe("held"); } finally { spy.mockReset(); spy.mockImplementation(original); }
  });
  it("hashes retained capsules linearly on a cold scan without caching or losing ownership history", async () => {
    const count = 12, ids: string[] = [];
    for (let n = 0; n < count; n++) {
      const id = randomUUID(); ids.push(id);
      await commit([{ kind: "scope", value: { ...scope(store.homeId), id } }]);
    }
    const original = submissions.digest, spy = vi.spyOn(submissions, "digest");
    let ownershipHashes = 0;
    spy.mockImplementation(value => {
      if (value && typeof value === "object" && ["scopes", "tasks", "attempts", "effects", "backends", "workflows"].every(k => k in value)) ownershipHashes++;
      return original(value);
    });
    try {
      const snapshot = await new SupervisionStore(dataRoot, home).read();
      expect(snapshot.freshness).toBe("current"); expect(snapshot.sequence).toBe(count);
      expect(snapshot.retainedOwnership).toHaveLength(count);
      expect(snapshot.retainedOwnership.map(o => o.scopes).sort((a, b) => a.length - b.length)).toEqual(ids.map((_id, i) => ids.slice(0, i + 1)));
      // Two retained anchors plus the projection/expected-tip comparison per event. No timing threshold.
      expect(ownershipHashes).toBe(count * 4);
      // A later damaged anchor is reread and fails closed, even after a successful cold read.
      const reader = new SupervisionStore(dataRoot, home); await reader.read();
      await writeFile(file(count, "publication"), "{damaged");
      expect((await reader.read()).freshness).toBe("held");
    } finally { spy.mockRestore(); }
  });
  it("keeps disabled/uninitialized reads inert and never creates a store on render/read", async () => {
    const absent = new SupervisionStore(join(dataRoot, "absent"), home);
    const before = await tree(dataRoot);
    expect((await absent.read()).freshness).toBe("uninitialized");
    expect(await absent.backend("missing")).toEqual({ backend: null, held: true, ownerScopeId: null });
    await expect(absent.initialize()).rejects.toMatchObject({ code: "UNSUPPORTED" });
    const mutations: SupervisionMutation[] = [{ kind: "scope", value: scope(absent.homeId) }];
    await expect(absent.transact(expected(mutations), randomUUID(), mutations)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(await tree(dataRoot)).toEqual(before);
  });
  it("publishes all six related rows atomically, with deterministic replay and rebuildable indexes", async () => {
    const mutations = seed(store.homeId), receipt = await commit(mutations);
    const before = await tree(store.root), status = await store.read();
    expect(status).toMatchObject({ freshness: "current", sequence: 1, hash: receipt.hash, executable: false, guarantee: "cooperative-storage-only" });
    expect(status.versions).toHaveLength(6); expect(status.tasks[0]?.currentAttempt).toBe(ids.attempt);
    expect(status.index.taskOwners[JSON.stringify(["local", ids.project, "build"])]).toBe(ids.scope);
    expect(status.index.effectKeys["plan/build/attempt-1/create"]).toBe(ids.effect);
    expect(await new SupervisionStore(dataRoot, home).read()).toEqual(status);
    expect(await tree(store.root)).toEqual(before); expect(processIdentity).not.toHaveBeenCalled();
    expect(await store.backend("plan")).toEqual({ backend: "scoped", held: false, ownerScopeId: ids.scope });
  });
  it("returns the original accepted receipt before version checks and refuses divergent content", async () => {
    const mutations: SupervisionMutation[] = [{ kind: "scope", value: scope(store.homeId) }], requestId = randomUUID();
    const receipt = await commit(mutations, requestId);
    const changed: SupervisionMutation[] = [{ kind: "scope", value: { ...scope(store.homeId), state: "active", version: 2 } }];
    await store.transact(expected(changed, 1), randomUUID(), changed);
    expect(await store.transact(expected(mutations), requestId, mutations)).toEqual(receipt);
    expect(await new SupervisionStore(dataRoot, home).transact(expected(mutations), requestId, mutations)).toEqual(receipt);
    await expect(store.transact(expected(mutations), requestId, [{ kind: "scope", value: { ...scope(store.homeId), state: "retired" } }])).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await store.read()).sequence).toBe(2);
  });
  it("captures UI/chat provenance in the committed request without treating it as authentication", async () => {
    const mutations: SupervisionMutation[] = [{ kind: "scope", value: scope(store.homeId) }], requestId = randomUUID();
    await commit(mutations, requestId);
    const event = JSON.parse(await readFile(file(1, "event"), "utf8"));
    expect(event.body.actor).toEqual({ kind: "system", id: "s01-fixture", source: "unwired-storage" });
    const chat = new SupervisionStore(dataRoot, home, { actor: { kind: "mate-chat", id: "mate", source: "quoted chat action" } });
    await expect(chat.transact(expected(mutations), requestId, mutations)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("serializes competing commands: exactly one owner transition wins the same expected version", async () => {
    await commit([{ kind: "scope", value: scope(store.homeId) }]);
    const run = (state: "active" | "transferring") => {
      const mutations: SupervisionMutation[] = [{ kind: "scope", value: { ...scope(store.homeId), version: 2, state } }];
      return store.transact(expected(mutations, 1), randomUUID(), mutations);
    };
    const results = await Promise.allSettled([run("active"), run("transferring")]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "STALE" } });
    expect((await store.read()).sequence).toBe(2);
  });
  it("requires exact expected rows and refuses duplicate aliases/logical effects without partial ownership", async () => {
    const mutations = seed(store.homeId);
    await expect(store.transact(expected(mutations).slice(1), randomUUID(), mutations)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await store.read()).sequence).toBe(0);
    await commit(mutations);
    const task = (await store.read()).tasks[0]!;
    await expect(commit([{ kind: "task", value: { ...task, id: randomUUID(), currentAttempt: null, hostId: "LOCAL" } }])).rejects.toMatchObject({ code: "CONFLICT" });
    const effect = (await store.read()).effects[0]!;
    await expect(commit([{ kind: "effect", value: { ...effect, id: randomUUID(), attemptId: null } }])).rejects.toMatchObject({ code: "CONFLICT" });
    await commit([{ kind: "task", value: { ...task, id: randomUUID(), hostId: "other-host", currentAttempt: null } }]);
    expect((await store.read()).tasks).toHaveLength(2);
  });
  it("retains task, attempt, spend and effect identity, including uncertainty after coordinator handoff", async () => {
    await commit(seed(store.homeId));
    const status = await store.read(), attempt = status.attempts[0]!, effect = status.effects[0]!;
    const decrease: SupervisionMutation[] = [{ kind: "attempt", value: { ...attempt, spentAgents: 0, version: 2 } }];
    await expect(store.transact(expected(decrease, 1), randomUUID(), decrease)).rejects.toMatchObject({ code: "HELD" });
    const dispatch: SupervisionMutation[] = [{ kind: "effect", value: { ...effect, state: "dispatching", version: 2 } }];
    await store.transact(expected(dispatch, 1), randomUUID(), dispatch);
    await store.releaseCoordinator();
    const replacement = new SupervisionStore(dataRoot, home, { writable: true, processIdentity });
    expect(await replacement.acquireCoordinator()).toBe(2);
    expect((await replacement.read()).uncertainEffectIds).toEqual([ids.effect]);
    expect((await replacement.read()).attempts[0]?.spentAgents).toBe(1);
    const reset: SupervisionMutation[] = [{ kind: "effect", value: { ...effect, state: "reserved", version: 3 } }];
    await expect(replacement.transact(expected(reset, 2), randomUUID(), reset)).rejects.toMatchObject({ code: "HELD" });
  });
  it("keeps backend barriers held and refuses an S07 cutover/source replacement or rollback", async () => {
    await commit(seed(store.homeId)); const backend = (await store.read()).backends[0]!;
    const prepared: SupervisionMutation[] = [{ kind: "backend", value: { ...backend, state: "prepared", version: 2 } }];
    await store.transact(expected(prepared, 1), randomUUID(), prepared);
    expect((await store.backend("plan")).held).toBe(true);
    const active: SupervisionMutation[] = [{ kind: "backend", value: { ...backend, version: 3 } }];
    await expect(store.transact(expected(active, 2), randomUUID(), active)).rejects.toMatchObject({ code: "HELD" });
    await expect(store.transact(expected(active, 2), randomUUID(), [{ kind: "backend", value: { ...backend, backend: "legacy", version: 3 } }])).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(store.transact(expected(active, 2), randomUUID(), [{ kind: "backend", value: { ...backend, sourceHash: hash, version: 3 } }])).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
  it("uses exact lexical/case-fold home identity and canonical-string digest, keeping junction aliases distinct", async () => {
    expect(store.root).toBe(join(dataRoot, "supervision", digest(workflowHomeIdentity(home))));
    const target = join(dataRoot, "physical"), alias = join(dataRoot, "alias");
    await mkdir(target); await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    expect(new SupervisionStore(dataRoot, alias).homeId).not.toBe(new SupervisionStore(dataRoot, target).homeId);
    expect(new SupervisionStore(dataRoot, alias).root).not.toBe(new SupervisionStore(dataRoot, target).root);
    if (process.platform === "win32") expect(new SupervisionStore(dataRoot, home.toUpperCase()).root).toBe(store.root);
  });
  it("does not reset a missing identity in a nonempty store", async () => {
    await commit(seed(store.homeId)); await rm(join(store.root, "identity.json"));
    expect((await store.read()).freshness).toBe("held");
    await expect(store.initialize()).rejects.toMatchObject({ code: "HELD" });
    expect((await readdir(join(store.root, "transactions"))).filter(f => f.endsWith(".json"))).toHaveLength(3);
  });
  for (const damage of ["event", "tip", "publication", "event+tip", "corrupt-event", "duplicate-key", "old-snapshot"] as const) {
    it(`holds damaged authority (${damage}) with retained ownership, never a shorter executable history`, async () => {
      await commit(seed(store.homeId));
      const change: SupervisionMutation[] = [{ kind: "scope", value: { ...scope(store.homeId), state: "active", version: 2 } }];
      await store.transact(expected(change, 1), randomUUID(), change);
      if (damage === "event+tip") { await rm(file(2, "event")); await rm(file(2, "tip")); }
      else if (damage === "old-snapshot") { await rm(file(2, "event")); await rm(file(2, "tip")); /* publication is the independent surviving marker */ }
      else if (damage === "corrupt-event") await writeFile(file(2, "event"), "{broken");
      else if (damage === "duplicate-key") { const bytes = await readFile(file(2, "event"), "utf8"); await writeFile(file(2, "event"), bytes.replace('{"at":', '{"duplicate":1,"duplicate":2,"at":')); }
      else await rm(file(2, damage));
      const before = await tree(store.root), status = await store.read();
      expect(status).toMatchObject({ freshness: "held", executable: false, sequence: 1 });
      expect(status.retainedOwnership.some(o => o.attempts.some(a => a.id === ids.attempt))).toBe(true);
      expect((await store.backend("plan")).held).toBe(true);
      await expect(store.transact(expected(change, 1), randomUUID(), change)).rejects.toMatchObject({ code: "HELD" });
      expect(await tree(store.root)).toEqual(before);
    });
  }
  it("syncs evidence before its reference, rejects missing/corrupt bytes, and leaves orphan blobs inert", async () => {
    const blob = await store.putBlob(Buffer.from("verified evidence"));
    expect((await store.read()).sequence).toBe(0);
    await commit([{ kind: "blob", value: blob }]);
    expect((await store.read()).freshness).toBe("current");
    await writeFile(join(store.root, "blobs", blob.id), "bad");
    expect((await store.read()).freshness).toBe("held");
    await expect(store.putBlob(Buffer.from("another blob"))).rejects.toMatchObject({ code: "HELD" });
  });
  it("holds storage pressure before a tip or effect is published", async () => {
    await store.releaseCoordinator();
    const limited = new SupervisionStore(dataRoot, home, { writable: true, processIdentity, maxJournalBytes: 1 });
    await limited.acquireCoordinator();
    const mutations = seed(limited.homeId);
    await expect(limited.transact(expected(mutations), randomUUID(), mutations)).rejects.toMatchObject({ code: "HELD" });
    expect(await readdir(join(store.root, "transactions"))).toEqual([]);
  });
  it("exposes sync/link failures without publishing a receipt, then safely retries only a never-linked request", async () => {
    await store.releaseCoordinator();
    const fault = new SupervisionStore(dataRoot, home, { writable: true, processIdentity, boundary: async name => {
      if (name === "tip:synced") throw Object.assign(new Error("fixture disk full before exclusive link"), { code: "ENOSPC" });
    } });
    await fault.acquireCoordinator();
    const mutations = seed(fault.homeId), request = randomUUID();
    await expect(fault.transact(expected(mutations), request, mutations)).rejects.toMatchObject({ code: "HELD" });
    expect((await fault.read()).sequence).toBe(0); expect((await fault.read()).effects).toEqual([]);
    await fault.releaseCoordinator();
    await store.acquireCoordinator(); await store.transact(expected(mutations), request, mutations);
    expect((await store.read()).attempts[0]?.spentAgents).toBe(1);
  });
  it("refuses neighbor-project ownership and stale effect epochs while retaining older reservations", async () => {
    await commit(seed(store.homeId));
    const status = await store.read(), task = status.tasks[0]!, binding = status.bindings[0]!, effect = status.effects[0]!;
    await expect(commit([{ kind: "task", value: { ...task, id: randomUUID(), projectId: randomUUID(), currentAttempt: null } }])).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
    await store.transact([{ kind: "binding", id: ids.scope, version: 1 }], randomUUID(), [{ kind: "binding", value: { ...binding, state: "suspect" } }]);
    await store.transact([{ kind: "binding", id: ids.scope, version: 2 }], randomUUID(), [{ kind: "binding", value: { ...binding, epoch: 2, agentId: "replacement", state: "prepared" } }]);
    await expect(commit([{ kind: "effect", value: { ...effect, id: randomUUID(), logicalKey: "new-old-epoch", attemptId: null } }])).rejects.toMatchObject({ code: "STALE" });
    expect((await store.read()).effects[0]?.epoch).toBe(1);
  });
  it("keeps held owners out of backend eligibility and prevents retired binding reactivation", async () => {
    await commit(seed(store.homeId));
    const binding = (await store.read()).bindings[0]!;
    const held: SupervisionMutation[] = [{ kind: "scope", value: { ...scope(store.homeId), version: 2, state: "held" } }];
    await store.transact(expected(held, 1), randomUUID(), held);
    expect((await store.backend("plan")).held).toBe(true);
    await store.transact([{ kind: "binding", id: ids.scope, version: 1 }], randomUUID(), [{ kind: "binding", value: { ...binding, state: "retired" } }]);
    await expect(store.transact([{ kind: "binding", id: ids.scope, version: 2 }], randomUUID(), [{ kind: "binding", value: { ...binding, state: "active" } }])).rejects.toMatchObject({ code: "HELD" });
  });
  it("refuses an alive/unknown coordinator; verified PID reuse advances generation without changing reservations", async () => {
    await commit(seed(store.homeId));
    const unknown = new SupervisionStore(dataRoot, home, { writable: true, processIdentity: async () => ({ state: "unknown" }) });
    await expect(unknown.acquireCoordinator()).rejects.toMatchObject({ code: "HELD" });
    const alive = new SupervisionStore(dataRoot, home, { writable: true, processIdentity });
    await expect(alive.acquireCoordinator()).rejects.toMatchObject({ code: "HELD" });
    const reused = new SupervisionStore(dataRoot, home, { writable: true, processIdentity: async () => ({ state: "alive", start: "confirmed-different-start-identity" }) });
    expect(await reused.acquireCoordinator()).toBe(2);
    await expect(store.transact([{ kind: "scope", id: ids.scope, version: 1 }], randomUUID(), [{ kind: "scope", value: { ...scope(store.homeId), version: 2 } }])).rejects.toMatchObject({ code: "HELD" });
    expect((await reused.read()).attempts[0]?.spentAgents).toBe(1);
  });
  it("never treats a different lexical home as compatible with persisted scope authority", async () => {
    const foreign = { ...scope(store.homeId), homeId: `${store.homeId}-moved` };
    await expect(commit([{ kind: "scope", value: foreign }])).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await store.read()).sequence).toBe(0);
  });
  it("rejects recomputed but wrong-home authority metadata", async () => {
    await commit(seed(store.homeId));
    const tip = JSON.parse(await readFile(file(1, "tip"), "utf8")); const { hash: _hash, ...body } = tip;
    const altered = { ...body, homeId: `${store.homeId}-different` }; await writeFile(file(1, "tip"), `${canonical({ ...altered, hash: digest(altered) })}\n`);
    expect((await store.read()).freshness).toBe("held");
  });
  it("retains checked ownership capsules when coordinator authority is corrupt", async () => {
    await commit(seed(store.homeId));
    await writeFile(join(store.root, "coordinators/000000000001.json"), "{corrupt");
    const status = await store.read();
    expect(status.freshness).toBe("held"); expect(status.executable).toBe(false);
    expect(status.retainedOwnership.some(o => o.attempts.some(a => a.id === ids.attempt))).toBe(true);
  });
});
