import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import type { SupervisionActor, SupervisionEffect } from "../shared/supervision";
import { maintenanceSummary, type ResourceReservation } from "../shared/supervision-maintenance";
import { expected, hash } from "../test/supervision-fixture";
import { SupervisionError, SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { grantable, receiverVerdict, SupervisionResources } from "./supervision-resources";
import { effectReservationId } from "./supervision-maintenance-state";
import { checkPolicy, type PolicyAdmission } from "./supervision-policy";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = id(0x71), Q = id(0x72), R = id(0x73), PROJECT = id(0xa1);
const captain: SupervisionActor = { kind: "captain-ui", id: "fixture-captain", source: "fixture/button/1" };
const owner = (scope: string): SupervisionActor => ({ kind: "agent", id: `owner-${scope.slice(-2)}`, source: "fixture/owner" });
const stranger: SupervisionActor = { kind: "agent", id: "worker-9", source: "fixture/worker-report" };
const code = (p: Promise<unknown>) => p.then(() => "committed", (e: unknown) => e instanceof SupervisionError ? e.code : String(e));
let store: SupervisionStore, resources: SupervisionResources, clock = "2026-10-27T12:00:00Z";

function effect(n: number, scopeId: string, resourceIds: string[], state: SupervisionEffect["state"] = "dispatching"): SupervisionEffect {
  return { id: id(n), logicalKey: `fixture/${n}`, requestId: id(n + 0x1000), requestHash: hash, scopeId, epoch: 1, attemptId: null, operation: "fixture.op",
    planRevision: null, subjectHash: hash, policyVector: [], evidenceVector: [], approvalId: null, resourceIds, state, receiverKey: null, receiptRef: null, version: 1 };
}
async function put(mutations: SupervisionMutation[]) {
  const status = await store.read();
  await store.transact(mutations.map(m => ({ kind: m.kind, id: (m as { value: { id?: string; scopeId?: string } }).value.id ?? (m as { value: { scopeId: string } }).value.scopeId,
    version: status.versions.find(v => v.kind === m.kind && v.id === ((m as { value: { id?: string; scopeId?: string } }).value.id ?? (m as { value: { scopeId: string } }).value.scopeId))?.version ?? 0 })), randomUUID(), mutations);
}
const setEffect = async (e: SupervisionEffect, state: SupervisionEffect["state"]) => {
  const current = (await store.read()).effects.find(x => x.id === e.id)!;
  await put([{ kind: "effect", value: { ...current, state, version: current.version + 1 } }]);
};

beforeEach(async () => {
  const home = join(process.env.PASEO_HOME!, randomUUID());
  await mkdir(home, { recursive: true });
  store = new SupervisionStore(join(home, "store"), home, { writable: true, processIdentity: async () => ({ state: "alive", start: "fixture-process" }) });
  await store.initialize(); await store.acquireCoordinator();
  const scope = (scopeId: string) => ({ kind: "scope" as const, value: { id: scopeId, homeId: store.homeId, kind: "plan" as const, projectIds: [PROJECT], sponsorId: null,
    version: 1, mode: "scoped" as const, state: "active" as const } });
  const binding = (scopeId: string) => ({ kind: "binding" as const, value: { scopeId, epoch: 1, hostId: "local", agentId: owner(scopeId).id, workspaceId: `ws-${scopeId}`,
    profileDigest: hash, state: "active" as const, checkpointHash: hash, acknowledgedSeq: 0, heartbeatDue: null } });
  const setup: SupervisionMutation[] = [scope(P), scope(Q), scope(R), binding(P), binding(Q), binding(R)];
  await store.transact(expected(setup), randomUUID(), setup);
  resources = new SupervisionResources(store, { enabled: true, now: () => clock });
});

it("is disabled by default and writes nothing", async () => {
  const before = (await store.read()).sequence;
  const off = new SupervisionResources(store);
  await expect(off.reserveForEffect(randomUUID(), captain, { effectId: id(1), class: "build", keys: ["host:mini:cache"], priority: 5, leaseMs: null })).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect((await store.read()).sequence).toBe(before);
});

it("A04: a cache prune waits for running builds without blocking unrelated builds, and later builds queue behind it", async () => {
  const builds = [effect(1, P, ["host:mini:cache"]), effect(2, Q, ["host:mini:cache"]), effect(3, R, ["host:mini:cache", "host:studio:cache"]),
    effect(4, R, ["host:studio:cache"]), effect(5, P, ["host:mini:cache"])];
  await put(builds.map(value => ({ kind: "effect" as const, value })));
  const b1 = await resources.reserveForEffect(randomUUID(), owner(P), { effectId: id(1), class: "build", keys: ["host:mini:cache"], priority: 5, leaseMs: null });
  const b2 = await resources.reserveForEffect(randomUUID(), owner(Q), { effectId: id(2), class: "build", keys: ["host:mini:cache"], priority: 5, leaseMs: null });
  expect([b1.state, b2.state]).toEqual(["granted", "granted"]); // Shared builds share the cache.
  // The prune needs both caches at once. It is never granted part of them.
  const prune = await resources.reserveForEffect(randomUUID(), owner(R), { effectId: id(3), class: "cleanup", keys: ["host:studio:cache", "host:mini:cache"], priority: 5, leaseMs: null });
  expect(prune).toMatchObject({ state: "queued", fences: [], keys: ["host:mini:cache", "host:studio:cache"] });
  // A build on the studio cache alone waits behind the earlier prune (FIFO), so the prune cannot starve...
  const studio = await resources.reserveForEffect(randomUUID(), owner(R), { effectId: id(4), class: "build", keys: ["host:studio:cache"], priority: 5, leaseMs: null });
  expect(studio.state).toBe("queued");
  // ...and a later build on the mini cache waits behind it too, though the builds holding it are compatible.
  const late = await resources.reserveForEffect(randomUUID(), owner(P), { effectId: id(5), class: "build", keys: ["host:mini:cache"], priority: 5, leaseMs: null });
  expect(late.state).toBe("queued");
  expect(await code(resources.promote(randomUUID(), owner(R), { reservationId: prune.id, leaseMs: null }))).toBe("HELD");
  for (const [e, r, actor] of [[builds[0]!, b1, owner(P)], [builds[1]!, b2, owner(Q)]] as const) {
    await setEffect(e, "succeeded");
    await resources.release(randomUUID(), actor, { reservationId: r.id, expectedVersion: r.version, kind: "succeeded", evidence: [{ ref: `receipt:${e.id}`, digest: hash }] });
  }
  const granted = await resources.promote(randomUUID(), owner(R), { reservationId: prune.id, leaseMs: null });
  // New fences: one more than any fence ever issued for each key.
  expect(granted).toMatchObject({ state: "granted", fences: [{ key: "host:mini:cache", fence: 3 }, { key: "host:studio:cache", fence: 1 }] });
  expect(await code(resources.promote(randomUUID(), owner(P), { reservationId: late.id, leaseMs: null }))).toBe("HELD");
  const summary = maintenanceSummary(await store.read());
  expect(summary.resources).toMatchObject({ held: 1, queued: 2, suspect: 0 });
  expect(maintenanceSummary(await store.read(), 0).resources.starving.map(r => r.id).sort()).toEqual([studio.id, late.id].sort());
  expect(summary.enforcement).toBe("advisory");
});

it("A04/A10: an expired lease with a lost submission keeps the deploy key; the delayed request is stale after proved non-admission", async () => {
  const p = effect(11, P, ["deploy:mini:api"], "dispatching"), q = effect(12, Q, ["deploy:mini:api"], "reserved");
  await put([{ kind: "effect", value: p }, { kind: "effect", value: q }]);
  const held = await resources.reserveForEffect(randomUUID(), owner(P), { effectId: p.id, class: "deploy", keys: ["deploy:mini:api"], priority: 5, leaseMs: 60_000 });
  expect(held.fences).toEqual([{ key: "deploy:mini:api", fence: 1 }]);
  await setEffect(p, "uncertain"); // P lost its connection after submitting.
  clock = "2026-10-27T12:05:00Z";
  await resources.expire(randomUUID(), captain);
  const waiting = await resources.reserveForEffect(randomUUID(), owner(Q), { effectId: q.id, class: "deploy", keys: ["deploy:mini:api"], priority: 1, leaseMs: 60_000 });
  // Expiry is suspicion, never takeover: Q waits even at a higher priority.
  expect(waiting.state).toBe("queued");
  expect((await resources.read()).reservations.find(r => r.id === held.id)?.state).toBe("suspect");
  let status = await store.read();
  expect(receiverVerdict(status, "deploy:mini:api", 1)).toBe("current");
  const suspect = (await resources.read()).reservations.find(r => r.id === held.id)!;
  const release = (actor: SupervisionActor, kind: "succeeded" | "not-admitted", evidence = [{ ref: "receiver:log", digest: hash }]) =>
    code(resources.release(randomUUID(), actor, { reservationId: held.id, expectedVersion: suspect.version, kind, evidence }));
  expect(await release(owner(P), "succeeded")).toBe("HELD"); // The effect is uncertain, not succeeded.
  expect(await release(owner(P), "not-admitted")).toBe("HELD"); // The holder cannot attest its own non-admission.
  expect(await release(captain, "not-admitted", [])).toBe("HELD"); // Proof needs evidence.
  expect(await release(stranger, "not-admitted")).toBe("UNKNOWN_OWNER");
  expect(await release(captain, "not-admitted")).toBe("committed");
  const q2 = await resources.promote(randomUUID(), owner(Q), { reservationId: waiting.id, leaseMs: 60_000 });
  expect(q2.fences).toEqual([{ key: "deploy:mini:api", fence: 2 }]);
  status = await store.read();
  // The delayed request from P carries fence 1. A fence-checking receiver must reject it; the plugin is not one.
  expect(receiverVerdict(status, "deploy:mini:api", 1)).toBe("stale");
  expect(receiverVerdict(status, "deploy:mini:api", 2)).toBe("current");
  expect(receiverVerdict(status, "deploy:mini:api", 3)).toBe("unknown");
  expect(status.maintenance!.reservations.every(r => r.enforcement === "advisory")).toBe(true);
});

it("unknown effects keep their reservation; finished ones release on matching evidence only", async () => {
  const e = effect(21, P, ["db:mini:main"], "accepted");
  await put([{ kind: "effect", value: e }]);
  const r = await resources.reserveForEffect(randomUUID(), owner(P), { effectId: e.id, class: "migrate", keys: ["db:mini:main"], priority: 5, leaseMs: null });
  for (const kind of ["succeeded", "failed", "withdrawn", "not-admitted"] as const)
    expect(await code(resources.release(randomUUID(), captain, { reservationId: r.id, expectedVersion: r.version, kind, evidence: [{ ref: "x", digest: hash }] }))).toBe("HELD");
  await setEffect(e, "failed");
  expect(await code(resources.release(randomUUID(), owner(P), { reservationId: r.id, expectedVersion: r.version, kind: "succeeded", evidence: [] }))).toBe("HELD");
  expect(await code(resources.release(randomUUID(), owner(P), { reservationId: r.id, expectedVersion: r.version, kind: "failed", evidence: [] }))).toBe("committed");
  // A release is final; the fence is never reissued.
  const released = (await resources.read()).reservations.find(x => x.id === r.id)!;
  expect(await code(resources.renew(randomUUID(), captain, { reservationId: r.id, leaseMs: 60_000 }))).toBe("CONFLICT");
  expect(released.terminal).toMatchObject({ kind: "failed" });
});

it("the journal refuses incompatible holders, reissued fences and resources the effect does not name", async () => {
  const a = effect(31, P, ["host:mini:cache"]), b = effect(32, Q, ["host:mini:cache"]);
  await put([{ kind: "effect", value: a }, { kind: "effect", value: b }]);
  const row = (e: SupervisionEffect, cls: ResourceReservation["class"], fence: number, keys = ["host:mini:cache"]): ResourceReservation => ({ id: effectReservationId(e.id), version: 1,
    scopeId: e.scopeId, holder: { kind: "effect", id: e.id }, class: cls, keys, priority: 5, queuedAt: 3, state: "granted",
    fences: keys.map(key => ({ key, fence })), lease: null, enforcement: "advisory", terminal: null, provenance: captain });
  await put([{ kind: "resource-reservation", value: row(a, "build", 1) }]);
  await expect(put([{ kind: "resource-reservation", value: row(b, "cleanup", 2) }])).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(put([{ kind: "resource-reservation", value: row(b, "build", 1) }])).rejects.toMatchObject({ code: "STALE" });
  await expect(put([{ kind: "resource-reservation", value: row(b, "build", 2, ["host:mini:cache", "host:other:cache"]) }])).rejects.toMatchObject({ code: "CONFLICT" });
  await put([{ kind: "resource-reservation", value: row(b, "build", 2) }]);
  expect(grantable((await resources.read()).reservations, { id: id(99), class: "cleanup", keys: ["host:mini:cache"], priority: 1, queuedAt: 99 }))
    .toEqual({ ok: false, blockedBy: [effectReservationId(a.id), effectReservationId(b.id)].sort() });
});

it("new reservations stop at the S10 admission ceiling (160); releases stay possible", async () => {
  const e = effect(41, P, ["browser:desk"], "succeeded"), f = effect(42, P, ["browser:desk"], "reserved");
  await put([{ kind: "effect", value: { ...e, state: "dispatching" } }, { kind: "effect", value: f }]);
  const r = await resources.reserveForEffect(randomUUID(), owner(P), { effectId: e.id, class: "read", keys: ["browser:desk"], priority: 5, leaseMs: null });
  await setEffect(e, "succeeded");
  const original = store.transactCommand.bind(store);
  vi.spyOn(store, "transactCommand").mockImplementation((requestId, inputHash, actor, prepare) =>
    original(requestId, inputHash, actor, status => prepare({ ...status, sequence: 160 })));
  expect(await code(resources.reserveForEffect(randomUUID(), owner(P), { effectId: f.id, class: "read", keys: ["browser:desk"], priority: 5, leaseMs: null }))).toBe("HELD");
  expect(await code(resources.release(randomUUID(), owner(P), { reservationId: r.id, expectedVersion: r.version, kind: "succeeded", evidence: [] }))).toBe("committed");
});

it("holding a reservation is never authority: policy vectors citing S10 records are refused", async () => {
  const e = effect(51, P, ["host:mini:cache"]);
  await put([{ kind: "effect", value: e }]);
  const r = await resources.reserveForEffect(randomUUID(), owner(P), { effectId: e.id, class: "build", keys: ["host:mini:cache"], priority: 5, leaseMs: null });
  const status = await store.read();
  const cite = { kind: "resource-reservation", id: r.id, version: r.version, digest: hash };
  for (const vector of ["policyVector", "approvalPolicyVector", "modelPolicyVector"] as const)
    await expect(checkPolicy("unused-home", status, { policyVector: [], evidenceVector: [], [vector]: [cite] } as unknown as PolicyAdmission, clock)).rejects.toMatchObject({ code: "HELD" });
});

it("R10 B2 (P5): an effect the S04 gateway can still dispatch cannot be withdrawn; once cancelled it can", async () => {
  const build = effect(61, P, ["host:mini:cache"], "reserved"), prune = effect(62, Q, ["host:mini:cache"], "reserved");
  await put([{ kind: "effect", value: build }, { kind: "effect", value: prune }]);
  const b = await resources.reserveForEffect(randomUUID(), owner(P), { effectId: build.id, class: "build", keys: ["host:mini:cache"], priority: 5, leaseMs: null });
  expect(await code(resources.release(randomUUID(), owner(P), { reservationId: b.id, expectedVersion: b.version, kind: "withdrawn", evidence: [] }))).toBe("HELD");
  expect((await resources.reserveForEffect(randomUUID(), owner(Q), { effectId: prune.id, class: "cleanup", keys: ["host:mini:cache"], priority: 5, leaseMs: null })).state).toBe("queued");
  await setEffect(build, "cancelled");
  expect(await code(resources.release(randomUUID(), owner(P), { reservationId: b.id, expectedVersion: b.version, kind: "withdrawn", evidence: [] }))).toBe("committed");
});

it("R10 N4: lease expiry uses this process's clock and needs the holder's bound owner or the captain", async () => {
  const e = effect(71, P, ["deploy:mini:api"]);
  await put([{ kind: "effect", value: e }]);
  await resources.reserveForEffect(randomUUID(), owner(P), { effectId: e.id, class: "deploy", keys: ["deploy:mini:api"], priority: 5, leaseMs: 3_600_000 });
  // A caller cannot name a future instant: the API has no time argument, and nothing has expired yet.
  expect(await code((resources.expire as (r: string, a: SupervisionActor, at?: string) => Promise<unknown>)(randomUUID(), owner(P), "2099-01-01T00:00:00Z"))).toBe("CONFLICT");
  clock = "2026-10-27T14:00:00Z";
  expect(await code(resources.expire(randomUUID(), stranger))).toBe("UNKNOWN_OWNER");
  expect(await code(resources.expire(randomUUID(), owner(Q)))).toBe("UNKNOWN_OWNER");
  expect(await code(resources.expire(randomUUID(), owner(P)))).toBe("committed");
  expect((await resources.read()).reservations[0]!.state).toBe("suspect");
});

it("R10 N11: promote and renew take the same bounded lease as reserve", async () => {
  const a = effect(81, P, ["deploy:mini:web"]), b = effect(82, Q, ["deploy:mini:web"]);
  await put([{ kind: "effect", value: a }, { kind: "effect", value: b }]);
  const held = await resources.reserveForEffect(randomUUID(), owner(P), { effectId: a.id, class: "deploy", keys: ["deploy:mini:web"], priority: 5, leaseMs: 60_000 });
  const waiting = await resources.reserveForEffect(randomUUID(), owner(Q), { effectId: b.id, class: "deploy", keys: ["deploy:mini:web"], priority: 5, leaseMs: null });
  for (const leaseMs of [0, -1, 999, 8 * 24 * 3600 * 1000, 1.5])
    await expect(resources.renew(randomUUID(), owner(P), { reservationId: held.id, leaseMs })).rejects.toThrow();
  const renewed = await resources.renew(randomUUID(), owner(P), { reservationId: held.id, leaseMs: 120_000 });
  void renewed;
  await setEffect(a, "succeeded");
  const current = (await resources.read()).reservations.find(r => r.id === held.id)!;
  await resources.release(randomUUID(), owner(P), { reservationId: held.id, expectedVersion: current.version, kind: "succeeded", evidence: [] });
  // The deploy key is free now, so only the lease bound refuses these.
  for (const leaseMs of [0, -60_000, 999])
    await expect(resources.promote(randomUUID(), owner(Q), { reservationId: waiting.id, leaseMs })).rejects.toThrow();
  expect((await resources.read()).reservations.find(r => r.id === waiting.id)!.state).toBe("queued");
  expect((await resources.promote(randomUUID(), owner(Q), { reservationId: waiting.id, leaseMs: 60_000 })).state).toBe("granted");
});
