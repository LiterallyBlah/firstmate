import { randomUUID } from "node:crypto";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupervisionActor, SupervisionEffect, SupervisionStatus } from "../shared/supervision";
import { CleanupSelectors, maintenanceSummary, type MaintenanceJob, type OccurrenceHost } from "../shared/supervision-maintenance";
import { expected, hash } from "../test/supervision-fixture";
import { SupervisionError, SupervisionStore, type SupervisionMutation } from "./supervision-store";
import {
  addDays, dueInstant, JobInputSchema, localDate, maintenanceIncidentNote, planCleanup, planTick, resolveCleanupAliases, retainedEntryValid, RetainedPathError,
  SupervisionJobs, type MaintenanceCandidate, type MaintenanceExecutor,
} from "./supervision-jobs";
import { occurrenceHostId, occurrenceId } from "./supervision-maintenance-state";
import { SupervisionResources } from "./supervision-resources";
import type { z } from "zod";

// Each case drives a real journal through dozens of transactions; under a loaded full-suite run that exceeds 5 s.
vi.setConfig({ testTimeout: 30000 });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const M = id(0x5a), J = id(0x10b), P = id(0x71), PROJECT = id(0xa1);
const captain: SupervisionActor = { kind: "captain-ui", id: "fixture-captain", source: "fixture/button/1" };
const supervisor: SupervisionActor = { kind: "agent", id: "maintenance-supervisor", source: "fixture/maintenance" };
const builder: SupervisionActor = { kind: "agent", id: "plan-owner", source: "fixture/plan" };
const code = (p: Promise<unknown>) => p.then(() => "committed", (e: unknown) => e instanceof SupervisionError ? e.code : String(e));
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const NY = "America/New_York";

class Fleet implements MaintenanceExecutor {
  offline = new Set<string>(); incomplete = new Set<string>(); failing = new Set<string>();
  candidates = new Map<string, MaintenanceCandidate[]>(); retainedWorkspaces = ["ws-live"]; retainedPaths: string[] = [];
  applied: string[] = []; fences: number[] = []; outage: string | null = null; hang = false; calls = 0;
  async probe(host: string) { return this.offline.has(host) ? "offline" as const : "online" as const; }
  async inventory(host: string) {
    if (this.incomplete.has(host)) throw new Error("listing truncated");
    return this.candidates.get(host) ?? [{ id: "a", path: "/cache/a", owner: "known" as const }];
  }
  async retained() { return { workspaces: this.retainedWorkspaces, volumes: [], paths: this.retainedPaths }; }
  async apply(host: string, items: { key: string; candidate: MaintenanceCandidate }[], fences: { key: string; fence: number }[]) {
    this.calls++;
    if (this.hang) return new Promise<never>(() => {});
    if (this.outage === host) throw new Error("connection lost");
    this.applied.push(...items.map(i => `${host}:${i.candidate.path}`)); this.fences.push(...fences.map(f => f.fence));
    return items.map(i => ({ key: i.key, outcome: this.failing.has(i.candidate.path) ? "failed" as const : "done" as const }));
  }
}

let store: SupervisionStore, fleet: Fleet, clock: string, jobs: SupervisionJobs;
const make = (executor: MaintenanceExecutor | undefined = fleet) => new SupervisionJobs(store, { enabled: true, now: () => clock, executor });
const jobInput = (over: Partial<z.input<typeof JobInputSchema>> = {}): z.input<typeof JobInputSchema> => ({ jobId: J, expectedVersion: 0, scopeId: M,
  name: "host-storage", domain: "host-storage", schedule: { kind: "daily", at: "03:15", zone: NY }, hosts: ["light", "mini", "studio"],
  resource: { class: "cleanup", keys: ["host:{host}:cache"] }, selectors: [{ kind: "path-prefix", value: "/cache" }], retained: ["vol-keep"],
  mode: "advisory", legacyTimer: { kind: "none", id: null, disposition: "retired", evidence: [] }, budget: { turns: 5 }, maxPasses: 3, ...over });
const job = async () => (await store.read()).maintenance!.jobs.find(j => j.id === J)!;
async function activate(at = "2026-10-26T12:00:00Z", over: Partial<z.input<typeof JobInputSchema>> = {}) {
  await jobs.defineJob(randomUUID(), captain, jobInput(over));
  clock = at;
  await jobs.setState(randomUUID(), captain, { jobId: J, expectedVersion: (await job()).version, state: "active" });
}
const host = async (date: string, hostId: string, zone = NY) =>
  (await store.read()).maintenance!.hosts.find(h => h.id === occurrenceHostId(occurrenceId(J, zone, date), hostId))!;
const wakes = (status: SupervisionStatus) => status.maintenance!.incidents.filter(i => i.notify.state === "pending").map(i => `${i.kind}:${i.hostId}:${i.generation}`).sort();
async function put(mutations: SupervisionMutation[]) {
  const status = await store.read(), key = (m: SupervisionMutation) => m.kind === "binding" ? m.value.scopeId : (m as { value: { id: string } }).value.id;
  await store.transact(mutations.map(m => ({ kind: m.kind, id: key(m), version: status.versions.find(v => v.kind === m.kind && v.id === key(m))?.version ?? 0 })), randomUUID(), mutations);
}

beforeEach(async () => {
  const home = join(process.env.PASEO_HOME!, randomUUID());
  await mkdir(home, { recursive: true });
  store = new SupervisionStore(join(home, "store"), home, { writable: true, processIdentity: async () => ({ state: "alive", start: "fixture-process" }) });
  await store.initialize(); await store.acquireCoordinator();
  const setup: SupervisionMutation[] = [
    { kind: "scope", value: { id: M, homeId: store.homeId, kind: "maintenance", projectIds: [], sponsorId: null, version: 1, mode: "scoped", state: "active" } },
    { kind: "scope", value: { id: P, homeId: store.homeId, kind: "plan", projectIds: [PROJECT], sponsorId: null, version: 1, mode: "scoped", state: "active" } },
    ...[[M, supervisor.id], [P, builder.id]].map(([scopeId, agentId]) => ({ kind: "binding" as const, value: { scopeId: scopeId!, epoch: 1, hostId: "local", agentId: agentId!,
      workspaceId: `ws-${agentId}`, profileDigest: hash, state: "active" as const, checkpointHash: hash, acknowledgedSeq: 0, heartbeatDue: null } }))];
  await store.transact(expected(setup), randomUUID(), setup);
  fleet = new Fleet(); clock = "2026-10-26T12:00:00Z"; jobs = make();
});

it("is disabled by default and writes nothing; without an executor no pass can run", async () => {
  const before = (await store.read()).sequence, off = new SupervisionJobs(store, { now: () => clock });
  for (const call of [() => off.tick("2026-10-27T07:15:30Z"), () => off.defineJob(randomUUID(), captain, jobInput()), () => off.summary(), () => off.runHost(id(1), "mini")])
    expect(await code(call())).toBe("UNSUPPORTED");
  expect((await store.read()).sequence).toBe(before);
  await activate();
  await jobs.tick("2026-10-27T07:15:30Z");
  expect(await code(new SupervisionJobs(store, { enabled: true, now: () => clock }).runHost(occurrenceId(J, NY, "2026-10-27"), "mini"))).toBe("UNSUPPORTED");
});

describe("D5 local dates and due instants (pure)", () => {
  it("reads a daily time in its IANA zone, across both DST transitions", () => {
    expect(iso(dueInstant("2026-10-27", "03:15", NY))).toBe("2026-10-27T07:15:00Z"); // EDT
    expect(iso(dueInstant("2026-11-02", "03:15", NY))).toBe("2026-11-02T08:15:00Z"); // EST
    // Spring forward: 02:30 does not exist; it runs as far past the gap as it fell inside it (03:30 EDT).
    expect(iso(dueInstant("2026-03-08", "02:30", NY))).toBe("2026-03-08T07:30:00Z");
    // Fall back: 01:30 happens twice; the first instant (EDT) is the due time.
    expect(iso(dueInstant("2026-11-01", "01:30", NY))).toBe("2026-11-01T05:30:00Z");
    expect(iso(dueInstant("2026-10-27", "03:15", "Asia/Kolkata"))).toBe("2026-10-26T21:45:00Z");
    expect(localDate(Date.parse("2026-10-27T03:00:00Z"), NY)).toBe("2026-10-26");
    expect(localDate(Date.parse("2026-10-27T03:00:00Z"), "Europe/London")).toBe("2026-10-27");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
  it("refuses an unknown zone rather than reading it as UTC or daemon-local", async () => {
    await expect(jobs.defineJob(randomUUID(), captain, jobInput({ schedule: { kind: "daily", at: "03:15", zone: "Mars/Olympus" } }))).rejects.toThrow(/IANA/);
  });
});

describe("A17.occurrence: durable daily occurrences under D5 option 1", () => {
  it("a duplicate or concurrent tick opens one occurrence; nothing due writes nothing", async () => {
    await activate();
    const before = (await store.read()).sequence;
    expect((await jobs.tick("2026-10-27T07:00:00Z"))[0]).toMatchObject({ plan: "none", wrote: false }); // before due, yesterday predates activation
    expect((await store.read()).sequence).toBe(before);
    const second = make();
    const [a, b] = await Promise.all([jobs.tick("2026-10-27T07:15:30Z"), second.tick("2026-10-27T07:15:40Z")]);
    expect([a[0]!.wrote, b[0]!.wrote].filter(Boolean)).toHaveLength(1);
    expect((await store.read()).sequence).toBe(before + 1);
    expect(await jobs.tick("2026-10-27T07:16:00Z")).toEqual([{ jobId: J, plan: "duplicate", occurrenceId: occurrenceId(J, NY, "2026-10-27"), wrote: false }]);
    expect((await store.read()).sequence).toBe(before + 1);
    const status = await store.read(), [occurrence] = status.maintenance!.occurrences;
    expect(occurrence).toMatchObject({ localDate: "2026-10-27", zone: NY, dueAt: "2026-10-27T07:15:00Z", trigger: "scheduled", definitionVersion: 1, missed: { count: 0, dates: [] } });
    // One accounted pass per covered host, offline ones included.
    expect(status.maintenance!.hosts.map(h => [h.hostId, h.state]).sort()).toEqual([["light", "pending"], ["mini", "pending"], ["studio", "pending"]]);
  });

  it("a restart across the due time catches up once; missed days are one observation, never separate runs", async () => {
    await activate();
    await jobs.tick("2026-10-27T06:59:00Z");
    // The daemon was down from 06:59 to 09:00: a fresh process sees the due time passed.
    jobs = make();
    await jobs.tick("2026-10-27T09:00:00Z");
    let status = await store.read();
    expect(status.maintenance!.occurrences.map(o => [o.localDate, o.trigger, o.missed.count])).toEqual([["2026-10-27", "catch-up", 0]]);
    // Down again for three whole days.
    await jobs.tick("2026-10-31T10:00:00Z");
    status = await store.read();
    const last = status.maintenance!.occurrences.find(o => o.localDate === "2026-10-31")!;
    expect(last).toMatchObject({ trigger: "catch-up", missed: { count: 3, dates: ["2026-10-28", "2026-10-29", "2026-10-30"] } });
    expect(status.maintenance!.occurrences).toHaveLength(2);
    // The earlier day's untouched passes are covered by the new day, not run twice.
    expect((await host("2026-10-27", "mini")).state).toBe("superseded");
    expect(status.maintenance!.occurrences.find(o => o.localDate === "2026-10-27")!.state).toBe("closed");
  });

  it("DST repeat and skip each give one occurrence at the right instant", async () => {
    await activate("2026-03-01T12:00:00Z", { schedule: { kind: "daily", at: "02:30", zone: NY } });
    expect((await jobs.tick("2026-03-08T07:20:00Z"))[0]!.occurrenceId).toBe(occurrenceId(J, NY, "2026-03-07")); // yesterday's, late
    await jobs.tick("2026-03-08T07:31:00Z");
    expect((await store.read()).maintenance!.occurrences.find(o => o.localDate === "2026-03-08")).toMatchObject({ dueAt: "2026-03-08T07:30:00Z", trigger: "scheduled" });
    const fall = id(0x10c);
    await jobs.defineJob(randomUUID(), captain, jobInput({ jobId: fall, name: "fall-back", schedule: { kind: "daily", at: "01:30", zone: NY } }));
    clock = "2026-10-31T12:00:00Z";
    await jobs.setState(randomUUID(), captain, { jobId: fall, expectedVersion: (await store.read()).maintenance!.jobs.find(j => j.id === fall)!.version, state: "active" });
    await jobs.tick("2026-11-01T05:31:00Z"); // first 01:30 (EDT)
    const before = (await store.read()).sequence;
    const again = await jobs.tick("2026-11-01T06:31:00Z"); // second 01:30 (EST)
    expect(again.find(t => t.jobId === fall)).toMatchObject({ plan: "duplicate", wrote: false });
    expect((await store.read()).sequence).toBe(before);
    expect((await store.read()).maintenance!.occurrences.filter(o => o.jobId === fall).map(o => o.dueAt)).toEqual(["2026-11-01T05:30:00Z"]);
  });

  it("a zone change cannot run the same day twice; the journal refuses two occurrences within twelve hours", async () => {
    await activate();
    await jobs.tick("2026-10-27T07:15:30Z");
    await jobs.defineJob(randomUUID(), captain, jobInput({ expectedVersion: (await job()).version, schedule: { kind: "daily", at: "09:00", zone: "Europe/London" } }));
    expect((await job()).definitionVersion).toBe(2);
    expect((await jobs.tick("2026-10-27T09:05:00Z"))[0]).toMatchObject({ plan: "none", wrote: false });
    await jobs.tick("2026-10-28T09:01:00Z");
    expect((await store.read()).maintenance!.occurrences.map(o => [o.zone, o.localDate, o.definitionVersion])).toEqual([[NY, "2026-10-27", 1], ["Europe/London", "2026-10-28", 2]]);
    const raw = { ...(await store.read()).maintenance!.occurrences[0]!, zone: "Asia/Tokyo", localDate: "2026-10-27", dueAt: "2026-10-27T10:00:00Z", version: 1, state: "open" as const, closedAt: null };
    raw.id = occurrenceId(J, raw.zone, raw.localDate);
    const hosts = raw.hosts.map(h => ({ kind: "occurrence-host" as const, value: { id: occurrenceHostId(raw.id, h), version: 1, occurrenceId: raw.id, jobId: J, hostId: h, state: "pending" as const,
      passes: 0, reservationId: null, items: [], excluded: 0, triage: 0, reason: null, incidentId: null, resultDigest: null, updatedAt: clock } }));
    await expect(put([{ kind: "occurrence", value: raw }, ...hosts])).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("per-host resume after an outage: one offline host never stops the others; an unchanged outage is one incident and no repeated wake", async () => {
    await activate();
    fleet.offline.add("light");
    await jobs.drive("2026-10-27T07:15:30Z");
    let status = await store.read();
    expect(["light", "mini", "studio"].map(h => status.maintenance!.hosts.find(x => x.hostId === h)!.state)).toEqual(["offline", "completed", "completed"]);
    expect(wakes(status)).toEqual(["offline:light:1"]);
    const settled = status.sequence;
    for (const minute of ["07:16", "07:17", "08:00"]) await jobs.drive(`2026-10-27T${minute}:00Z`);
    status = await store.read();
    expect(status.sequence).toBe(settled); // still offline: nothing written, nobody woken again
    expect(maintenanceSummary(status).jobs[0]!.hosts).toMatchObject({ offline: 1, completed: 2 });
    fleet.offline.delete("light");
    await jobs.drive("2026-10-27T09:00:00Z");
    status = await store.read();
    expect((await host("2026-10-27", "light"))).toMatchObject({ state: "completed", passes: 1 });
    expect(status.maintenance!.incidents.map(i => [i.kind, i.state])).toEqual([["offline", "resolved"]]);
    expect(wakes(status)).toEqual(["offline:light:1"]); // the resolution woke nobody
    expect(status.maintenance!.occurrences[0]!.state).toBe("closed");
    expect(fleet.applied.sort()).toEqual(["light:/cache/a", "mini:/cache/a", "studio:/cache/a"]);
    // Supervisor reads it, then the next healthy day adds no wake at all.
    const incident = status.maintenance!.incidents[0]!;
    await jobs.acknowledge(randomUUID(), supervisor, { incidentId: incident.id, generation: 1 });
    await jobs.drive("2026-10-28T07:16:00Z");
    expect(wakes(await store.read())).toEqual([]);
    expect(await maintenanceIncidentNote(await job(), (await store.read()).maintenance!.incidents[0]!)).toBeNull();
  });

  it("an outage mid-pass leaves items uncertain, keeps the reservation and holds the host; the resumed pass never reapplies them", async () => {
    await activate();
    fleet.candidates.set("studio", [{ id: "a", path: "/cache/a", owner: "known" }, { id: "b", path: "/cache/b", owner: "known" }]);
    fleet.outage = "studio";
    await jobs.drive("2026-10-27T07:15:30Z");
    let studio = await host("2026-10-27", "studio");
    expect(studio).toMatchObject({ state: "offline", passes: 1 });
    expect(studio.items.map(i => i.state)).toEqual(["uncertain", "uncertain"]);
    const reservation = (await store.read()).maintenance!.reservations.find(r => r.id === studio.reservationId)!;
    expect(reservation.state).toBe("granted");
    fleet.outage = null;
    fleet.candidates.set("studio", [{ id: "a", path: "/cache/a", owner: "known" }, { id: "b", path: "/cache/b", owner: "known" }, { id: "c", path: "/cache/c", owner: "known" }]);
    // Back online, the host still waits: nothing is applied beside an unknown outcome, and no pass is spent.
    const quiet = (await store.read()).sequence;
    expect((await jobs.drive("2026-10-27T08:00:00Z")).runs.find(r => r.hostId === "studio")).toMatchObject({ state: "blocked" });
    expect((await store.read()).sequence).toBe(quiet);
    expect(fleet.applied.filter(a => a.startsWith("studio"))).toEqual([]);
    // The reservation cannot be released around the uncertain items, by anyone.
    await expect(store.transact([{ kind: "resource-reservation", id: reservation.id, version: reservation.version }], randomUUID(), [{ kind: "resource-reservation",
      value: { ...reservation, version: reservation.version + 1, state: "released", terminal: { kind: "succeeded", evidence: [], actor: captain, at: clock } } }]))
      .rejects.toMatchObject({ code: "HELD" });
    const settle = { occurrenceId: occurrenceId(J, NY, "2026-10-27"), hostId: "studio", expectedVersion: studio.version,
      items: studio.items.map(i => ({ key: i.key, outcome: "done" as const })), evidence: [{ ref: "receiver:studio:log", digest: hash }] };
    expect(await code(jobs.reconcileItems(randomUUID(), supervisor, settle))).toBe("UNSUPPORTED");
    expect(await code(jobs.reconcileItems(randomUUID(), captain, { ...settle, evidence: [] }))).toBe("HELD");
    await jobs.reconcileItems(randomUUID(), captain, settle);
    await jobs.drive("2026-10-27T08:30:00Z");
    studio = await host("2026-10-27", "studio");
    expect(studio).toMatchObject({ state: "completed", passes: 2 });
    expect(fleet.applied.filter(a => a.startsWith("studio"))).toEqual(["studio:/cache/c"]); // only the item never dispatched
    expect((await store.read()).maintenance!.reservations.find(r => r.id === reservation.id)!).toMatchObject({ state: "released", terminal: { kind: "succeeded" } });
    expect((await store.read()).maintenance!.incidents.filter(i => i.kind === "uncertain").map(i => i.state)).toEqual(["resolved"]);
  });

  it("a crashed process's dispatched items become uncertain on restart; nothing is dispatched twice", async () => {
    await activate();
    fleet.hang = true;
    await jobs.tick("2026-10-27T07:15:30Z");
    void jobs.runHost(occurrenceId(J, NY, "2026-10-27"), "mini").catch(() => {});
    await vi.waitFor(async () => expect((await host("2026-10-27", "mini"))?.items.map(i => i.state)).toEqual(["dispatched"]));
    // The process dies here. A new one resumes the pass.
    fleet.hang = false;
    jobs = make();
    await jobs.drive("2026-10-27T08:00:00Z");
    const mini = await host("2026-10-27", "mini");
    expect(mini.items.map(i => i.state)).toEqual(["uncertain"]);
    expect(mini.state).toBe("deferred");
    expect(fleet.applied.filter(a => a.startsWith("mini"))).toEqual([]); // the hung apply is the only attempt
    expect(fleet.calls).toBe(3); // the hung mini call, then light and studio once each
  });

  it("an unchanged failure keeps its incident without a new wake; a changed one is one new generation", async () => {
    await activate();
    fleet.failing.add("/cache/a");
    await jobs.drive("2026-10-27T07:15:30Z");
    let status = await store.read();
    expect(wakes(status)).toEqual(["failure:light:1", "failure:mini:1", "failure:studio:1"]);
    for (const i of status.maintenance!.incidents) await jobs.acknowledge(randomUUID(), supervisor, { incidentId: i.id, generation: i.generation });
    const incidents = (await store.read()).maintenance!.incidents.map(i => i.version);
    await jobs.drive("2026-10-28T07:15:30Z");
    status = await store.read();
    expect(status.maintenance!.incidents.map(i => i.version)).toEqual(incidents);
    expect(wakes(status)).toEqual([]);
    expect((await job()).spentTurns).toBe(3);
    fleet.candidates.set("mini", [{ id: "a", path: "/cache/a", owner: "known" }, { id: "z", path: "/cache/z", owner: "known" }]);
    fleet.failing.add("/cache/z");
    await jobs.drive("2026-10-29T07:15:30Z");
    status = await store.read();
    expect(wakes(status)).toEqual(["failure:mini:2"]);
    expect((await job()).spentTurns).toBe(4);
    const note = await maintenanceIncidentNote(await job(), status.maintenance!.incidents.find(i => i.hostId === "mini")!);
    expect(note).toContain('"incident": "failure"');
    expect(note).not.toContain("<!--");
  });

  it("A20: an unknown or spent wake budget holds wakes and raises one budget decision", async () => {
    await activate("2026-10-26T12:00:00Z", { budget: { turns: 1 } });
    fleet.failing.add("/cache/a");
    await jobs.drive("2026-10-27T07:15:30Z");
    let status = await store.read();
    const notify = status.maintenance!.incidents.map(i => [i.hostId, i.kind, i.notify.state]).sort();
    expect(notify).toEqual([["*", "budget", "pending"], ["light", "failure", "pending"], ["mini", "failure", "held-budget"], ["studio", "failure", "held-budget"]]);
    expect((await job()).spentTurns).toBe(1);
    fleet.failing.clear(); fleet.offline.add("mini");
    await jobs.drive("2026-10-28T07:15:30Z");
    status = await store.read();
    expect(status.maintenance!.incidents.filter(i => i.kind === "budget")).toHaveLength(1);
    expect(status.maintenance!.incidents.find(i => i.kind === "offline")!.notify.state).toBe("held-budget");
    const unknown = id(0x10d);
    await jobs.defineJob(randomUUID(), captain, jobInput({ jobId: unknown, name: "unknown-budget", budget: null, hosts: ["mini"] }));
    clock = "2026-10-28T12:00:00Z";
    await jobs.setState(randomUUID(), captain, { jobId: unknown, expectedVersion: 1, state: "active" });
    await jobs.drive("2026-10-29T07:15:30Z");
    status = await store.read();
    expect(status.maintenance!.incidents.filter(i => i.jobId === unknown).map(i => [i.kind, i.notify.state]).sort())
      .toEqual([["budget", "pending"], ["offline", "held-budget"]]);
    expect(status.maintenance!.jobs.find(j => j.id === unknown)!.spentTurns).toBe(0);
  });

  it("the pass budget fails a host visibly instead of retrying forever; an incomplete inventory dispatches nothing", async () => {
    await activate("2026-10-26T12:00:00Z", { maxPasses: 2 });
    fleet.incomplete.add("mini");
    for (const minute of ["07:16", "07:20", "07:30"]) await jobs.drive(`2026-10-27T${minute}:00Z`);
    const mini = await host("2026-10-27", "mini");
    expect(mini).toMatchObject({ state: "failed", passes: 2, items: [] });
    expect(fleet.applied.some(a => a.startsWith("mini"))).toBe(false);
    expect((await store.read()).maintenance!.reservations.filter(r => r.holder.id === mini.id).map(r => r.state)).toEqual(["released", "released"]);
  });
});

describe("A04 in maintenance: shared caches, selectors and retained worktrees", () => {
  it("a running build defers only its own host's prune; the prune resumes once the build releases", async () => {
    await activate();
    const build: SupervisionEffect = { id: id(0x201), logicalKey: "build/1", requestId: id(0x202), requestHash: hash, scopeId: P, epoch: 1, attemptId: null, operation: "build",
      planRevision: null, subjectHash: hash, policyVector: [], evidenceVector: [], approvalId: null, resourceIds: ["host:mini:cache"], state: "dispatching", receiverKey: null, receiptRef: null, version: 1 };
    await put([{ kind: "effect", value: build }]);
    const resources = new SupervisionResources(store, { enabled: true, now: () => clock });
    const held = await resources.reserveForEffect(randomUUID(), builder, { effectId: build.id, class: "build", keys: ["host:mini:cache"], priority: 5, leaseMs: null });
    await jobs.drive("2026-10-27T07:15:30Z");
    expect((await host("2026-10-27", "mini"))).toMatchObject({ state: "deferred", passes: 0, reason: "Waiting for resources held by conflicting work." });
    expect((await host("2026-10-27", "studio")).state).toBe("completed");
    const quiet = (await store.read()).sequence;
    await jobs.drive("2026-10-27T07:30:00Z");
    expect((await store.read()).sequence).toBe(quiet);
    // A later build on the mini cache now waits behind the queued prune instead of starving it.
    const late: SupervisionEffect = { ...build, id: id(0x203), logicalKey: "build/2", requestId: id(0x204) };
    await put([{ kind: "effect", value: late }]);
    expect((await resources.reserveForEffect(randomUUID(), builder, { effectId: late.id, class: "build", keys: ["host:mini:cache"], priority: 5, leaseMs: null })).state).toBe("queued");
    await put([{ kind: "effect", value: { ...(await store.read()).effects.find(e => e.id === build.id)!, state: "succeeded", version: 2 } }]);
    await resources.release(randomUUID(), builder, { reservationId: held.id, expectedVersion: held.version, kind: "succeeded", evidence: [] });
    await jobs.drive("2026-10-27T08:00:00Z");
    expect((await host("2026-10-27", "mini"))).toMatchObject({ state: "completed", passes: 1 });
    expect(fleet.fences).toContain(2); // the prune took the next fence after the build's
  });

  it("R10 B2 (P4): a running prune's reservation cannot be withdrawn, so a build is never granted beside it", async () => {
    await activate();
    let open!: () => void;
    const gate = new Promise<void>(r => { open = r; });
    const inventory = fleet.inventory.bind(fleet);
    fleet.inventory = async h => { if (h === "mini") await gate; return inventory(h); };
    await jobs.tick("2026-10-27T07:15:30Z");
    const run = jobs.runHost(occurrenceId(J, NY, "2026-10-27"), "mini");
    await vi.waitFor(async () => expect((await host("2026-10-27", "mini")).state).toBe("running"));
    const pass = await host("2026-10-27", "mini");
    const resources = new SupervisionResources(store, { enabled: true, now: () => clock });
    const r = (await resources.read()).reservations.find(x => x.id === pass.reservationId)!;
    for (const actor of [supervisor, captain])
      expect(await code(resources.release(randomUUID(), actor, { reservationId: r.id, expectedVersion: r.version, kind: "withdrawn", evidence: [] }))).toBe("HELD");
    const build: SupervisionEffect = { id: id(0x301), logicalKey: "build/x", requestId: id(0x302), requestHash: hash, scopeId: P, epoch: 1, attemptId: null, operation: "build",
      planRevision: null, subjectHash: hash, policyVector: [], evidenceVector: [], approvalId: null, resourceIds: ["host:mini:cache"], state: "dispatching", receiverKey: null, receiptRef: null, version: 1 };
    await put([{ kind: "effect", value: build }]);
    const b = await resources.reserveForEffect(randomUUID(), builder, { effectId: build.id, class: "build", keys: ["host:mini:cache"], priority: 5, leaseMs: null });
    expect(b.state).toBe("queued");
    open();
    expect((await run).state).toBe("completed");
    expect(fleet.applied).toContain("mini:/cache/a");
    // Only once the prune has finished and released does the build take the cache.
    expect((await resources.promote(randomUUID(), builder, { reservationId: b.id, leaseMs: null })).state).toBe("granted");
  });

  it("R10 B2: a pass whose reservation was released by another process dispatches nothing", async () => {
    await activate();
    let open!: () => void;
    const gate = new Promise<void>(r => { open = r; });
    const slow = new Fleet(), inventory = slow.inventory.bind(slow);
    slow.inventory = async h => { if (h === "mini") await gate; return inventory(h); };
    await jobs.tick("2026-10-27T07:15:30Z");
    const run = new SupervisionJobs(store, { enabled: true, now: () => clock, executor: slow }).runHost(occurrenceId(J, NY, "2026-10-27"), "mini");
    await vi.waitFor(async () => expect((await host("2026-10-27", "mini")).state).toBe("running"));
    // A second process, not running this pass, opens the next day and covers the pass it sees stranded.
    await jobs.tick("2026-10-28T07:15:30Z");
    const day1 = await host("2026-10-27", "mini");
    expect(day1.state).toBe("superseded");
    open();
    expect(await run).toMatchObject({ state: "blocked", reason: expect.stringMatching(/no longer holds its reservation/) });
    expect(slow.applied).toEqual([]);
    expect((await host("2026-10-27", "mini")).items).toEqual([]);
  });

  it("R10 B1-R (Q1/Q2): retained paths are canonicalized and compared case-insensitively; an unclean one defers the pass", async () => {
    const none = { workspaces: [], volumes: [] };
    // Q1, the reviewer's Windows probe: a lower-case selector and candidate, the live worktree as Paseo reports it.
    const q1 = planCleanup({ id: J, selectors: [{ kind: "path-prefix", value: "c:/users/micha/.paseo/worktrees" }], retained: [] }, "mini",
      [{ id: "parent", path: "c:/users/micha/.paseo/worktrees/23z5sbxl", owner: "known" }, { id: "other", path: "c:/users/micha/.paseo/worktrees/old", owner: "known" }],
      { ...none, paths: ["C:\\Users\\micha\\.paseo\\worktrees\\23z5sbxl\\fm-ss-r10"] });
    expect(q1.selected.map(s => s.candidate.id)).toEqual(["other"]);
    // And the other way round: an upper-case candidate around a lower-case retained path.
    expect(planCleanup({ id: J, selectors: [{ kind: "path-prefix", value: "C:/Users/micha/.paseo/worktrees" }], retained: [] }, "mini",
      [{ id: "parent", path: "C:/Users/micha/.paseo/worktrees/23z5sbxl", owner: "known" }],
      { ...none, paths: ["c:/users/micha/.paseo/worktrees/23z5sbxl/fm-ss-r10"] }).selected).toEqual([]);
    // Q2: dot segments and doubled separators in a retained path still protect its parent.
    for (const retainedPath of ["/cache/./sessions/s1", "/cache//sessions/s1", "/CACHE/Sessions/S1/"])
      expect(planCleanup({ id: J, selectors: [{ kind: "path-prefix", value: "/cache" }], retained: [] }, "mini",
        [{ id: "parent", path: "/cache/sessions", owner: "known" }, { id: "ok", path: "/cache/tmp", owner: "known" }], { ...none, paths: [retainedPath] })
        .selected.map(s => s.candidate.id)).toEqual(["ok"]);
    // A retained entry in the job definition is canonicalized the same way.
    expect(planCleanup({ id: J, selectors: [{ kind: "path-prefix", value: "/cache" }], retained: ["\\CACHE\\Keep"] }, "mini",
      [{ id: "keep-child", path: "/cache/keep/x", owner: "known" }], { ...none, paths: [] }).selected).toEqual([]);
    // A retained path that cannot be canonicalized refuses the whole plan...
    for (const bad of ["relative/worktree", "/cache/../cache/sessions"])
      expect(() => planCleanup({ id: J, selectors: [{ kind: "path-prefix", value: "/cache" }], retained: [] }, "mini",
        [{ id: "ok", path: "/cache/tmp", owner: "known" }], { ...none, paths: [bad] })).toThrow(RetainedPathError);
    // ...and the pass defers with nothing dispatched, releasing the reservation it took.
    await activate();
    fleet.retainedPaths = ["worktrees/relative"];
    await jobs.drive("2026-10-27T07:15:30Z");
    const mini = await host("2026-10-27", "mini");
    expect(mini).toMatchObject({ state: "deferred", items: [] });
    expect(mini.reason).toMatch(/not absolute/);
    expect(fleet.applied).toEqual([]);
    expect((await store.read()).maintenance!.reservations.filter(r => r.holder.id === mini.id).map(r => r.state)).toEqual(["released"]);
  });

  it("S11 / R10 E1: a retained filesystem root contains every path on that root", () => {
    const none = { workspaces: [], volumes: [] };
    for (const [root, selector, path] of [["/", "/cache", "/cache/x"], ["C:\\", "C:/cache", "C:/cache/x"], ["c:/", "C:/cache", "C:/CACHE/x"]] as const)
      expect(planCleanup({ id: J, selectors: [{ kind: "path-prefix", value: selector }], retained: [] }, "mini",
        [{ id: "x", path, owner: "known" }], { ...none, paths: [root] }).selected).toEqual([]);
    // Another drive's root protects nothing here; over-exclusion stays per root.
    expect(planCleanup({ id: J, selectors: [{ kind: "path-prefix", value: "C:/cache" }], retained: [] }, "mini",
      [{ id: "x", path: "C:/cache/x", owner: "known" }], { ...none, paths: ["D:\\"] }).selected.map(s => s.candidate.id)).toEqual(["x"]);
  });

  // Windows paths written with "|" for "\" so the separators are unmistakable.
  const win = (s: string) => s.replaceAll("|", "\\");
  it("S11 / R10 E2: a long-path drive form is canonicalized; device, UNC long paths and mid-path drives refuse the pass", () => {
    const none = { workspaces: [], volumes: [] };
    for (const long of [win("||?|C:|cache|sessions|s1"), win("||.|C:|cache|sessions|s1"), "//?/c:/CACHE/sessions/s1"])
      expect(planCleanup({ id: J, selectors: [{ kind: "path-prefix", value: "C:/cache" }], retained: [] }, "mini",
        [{ id: "parent", path: "C:/cache/sessions", owner: "known" }, { id: "ok", path: "C:/cache/tmp", owner: "known" }], { ...none, paths: [long] })
        .selected.map(s => s.candidate.id)).toEqual(["ok"]);
    for (const bad of [win("||?|UNC|server|share|wt"), win("||?|Volume{0b1c}|wt"), win("||.|pipe|x"), "/x/?/C:/cache", "/mnt/C:/cache"])
      expect(() => planCleanup({ id: J, selectors: [{ kind: "path-prefix", value: "C:/cache" }], retained: [] }, "mini",
        [{ id: "ok", path: "C:/cache/tmp", owner: "known" }], { ...none, paths: [bad] })).toThrow(RetainedPathError);
  });

  it("S11 / R10 E3: path-like retained entries that are not absolute and canonical are refused when the job is defined", async () => {
    for (const bad of ["~/keep", "~", win("C:cache|keep"), "C:keep", "cache/keep", win("cache|keep"), "./keep", "/cache/../keep", win("||?|UNC|s|x")]) {
      expect(retainedEntryValid(bad)).toBe(false);
      await expect(jobs.defineJob(randomUUID(), captain, jobInput({ retained: [bad] }))).rejects.toThrow(/identity, or an absolute canonical path/);
    }
    for (const ok of ["vol-keep", "ws-123", "/cache/keep", win("C:|cache|keep"), win("||?|C:|cache|keep")]) expect(retainedEntryValid(ok)).toBe(true);
  });

  it("S11 / R10 B1-R realpath: symlink and junction aliases are resolved before planning, on real directories", async () => {
    const root = join(process.env.PASEO_HOME!, `alias-${randomUUID()}`), cache = join(root, "cache"), live = join(cache, "sessions", "s1");
    await mkdir(live, { recursive: true }); await mkdir(join(cache, "tmp"), { recursive: true }); await mkdir(join(root, "elsewhere"), { recursive: true });
    // A worktree reported through an alias outside the selector, and a candidate that is an alias leading out of it.
    await symlink(join(cache, "sessions"), join(root, "link"), "junction");
    await symlink(join(root, "elsewhere"), join(cache, "escape"), "junction");
    const selectors = [{ kind: "path-prefix" as const, value: cache.replaceAll("\\", "/") }];
    const candidates: MaintenanceCandidate[] = [{ id: "sessions", path: join(cache, "sessions"), owner: "known" }, { id: "tmp", path: join(cache, "tmp"), owner: "known" },
      { id: "escape", path: join(cache, "escape"), owner: "known" }, { id: "gone", path: join(cache, "gone"), owner: "known" }];
    const retained = { workspaces: [], volumes: [], paths: [join(root, "link", "s1"), join(root, "missing")] };
    // String comparison alone selects the directory holding the live worktree.
    expect(planCleanup({ id: J, selectors, retained: [] }, "mini", candidates, retained).selected.map(s => s.candidate.id)).toEqual(["sessions", "tmp", "escape", "gone"]);
    const resolved = await resolveCleanupAliases(candidates, retained);
    expect(resolved.unresolved).toBe(1); // "gone" does not exist: dropped, never planned.
    expect(planCleanup({ id: J, selectors, retained: [] }, "mini", resolved.candidates, resolved.retained).selected.map(s => s.candidate.id)).toEqual(["tmp"]);
    // A retained path that cannot be resolved for any reason but absence refuses the pass.
    await expect(resolveCleanupAliases(candidates, retained, async () => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); })).rejects.toThrow(RetainedPathError);
  });

  it("cleanup stays inside its selectors and never touches retained worktrees, volumes or unknown owners", async () => {
    await activate();
    const candidates: MaintenanceCandidate[] = [
      { id: "1", path: "/cache/old-build", owner: "known" },
      { id: "2", path: "/cache/keep", volumeId: "vol-keep", owner: "known" },
      { id: "3", path: "/cache/worktree", workspaceId: "ws-live", owner: "known" },
      { id: "4", path: "/data/database", owner: "known" },
      { id: "5", path: "/cache/../etc", owner: "known" },
      { id: "6", path: "/cachet/near-miss", owner: "known" },
      { id: "7", path: "/cache/orphan", owner: "unknown" }];
    for (const h of ["light", "mini", "studio"]) fleet.candidates.set(h, candidates);
    await jobs.drive("2026-10-27T07:15:30Z");
    expect(fleet.applied.sort()).toEqual(["light:/cache/old-build", "mini:/cache/old-build", "studio:/cache/old-build"]);
    const mini = await host("2026-10-27", "mini");
    expect(mini).toMatchObject({ state: "completed", excluded: 5, triage: 1 });
    expect((await store.read()).maintenance!.incidents.filter(i => i.kind === "triage").map(i => [i.hostId, i.state])).toHaveLength(3);
    const plan = planCleanup({ id: J, selectors: [{ kind: "path-prefix", value: "/home/u/.npm" }, { kind: "cache-prefix", value: "npm/" }], retained: [] }, "mini",
      [{ id: "x", path: "/home/u/.npm/_cacache", cache: "npm/_cacache", owner: "known" }, { id: "y", path: "/home/u/.npm/pip", cache: "pip/x", owner: "known" }],
      { workspaces: [], volumes: [], paths: [] });
    expect(plan.selected.map(s => s.candidate.id)).toEqual(["x"]);
  });

  it("R10 B1: retained paths exclude by containment, the selector root is never selected, and cache labels are bounded", () => {
    const none = { workspaces: [], volumes: [], paths: [] };
    const plan = planCleanup({ id: J, selectors: [{ kind: "path-prefix", value: "/cache" }], retained: ["/cache/keep"] }, "mini", [
      { id: "root", path: "/cache", owner: "known" },
      { id: "child", path: "/cache/keep/sub", owner: "known" },
      { id: "exact", path: "/cache/keep", owner: "known" },
      { id: "wt-dir", path: "/cache/worktrees", owner: "known" },
      { id: "wt", path: "/cache/worktrees/ws-live", workspaceId: "ws-live", owner: "known" },
      { id: "session-parent", path: "/cache/sessions", owner: "known" },
      { id: "ok", path: "/cache/tmp/old", owner: "known" },
      { id: "ok", path: "/cache/tmp/old", owner: "known" }, // listed twice: one item
      { id: "relative", path: "cache/tmp/x", owner: "known" },
      { id: "dot", path: "/cache/./tmp", owner: "known" }],
      { workspaces: ["ws-live"], volumes: [], paths: ["/cache/sessions/s1"] });
    expect(plan.selected.map(s => s.candidate.id)).toEqual(["ok"]);
    expect(plan.excluded).toBe(8); // the duplicate listing is one candidate, not counted twice
    const cache = planCleanup({ id: J, selectors: [{ kind: "path-prefix", value: "/home/u/.cache" }, { kind: "cache-prefix", value: "npm" }], retained: [] }, "mini", [
      { id: "sibling", path: "/home/u/.cache/npmrc-secrets", cache: "npmrc", owner: "known" },
      { id: "elsewhere", path: "/srv/database", cache: "npm/_cacache", owner: "known" },
      { id: "dots", path: "/home/u/.cache/x", cache: "npm/../../etc", owner: "known" },
      { id: "unlabelled", path: "/home/u/.cache/y", owner: "known" },
      { id: "good", path: "/home/u/.cache/npm/_cacache", cache: "npm/_cacache", owner: "known" }], none);
    expect(cache.selected.map(s => s.candidate.id)).toEqual(["good"]);
    // With nothing retained, the selector root itself is still never an item.
    expect(planCleanup({ id: J, selectors: [{ kind: "path-prefix", value: "/cache/" }], retained: [] }, "mini",
      [{ id: "root", path: "/cache", owner: "known" }, { id: "below", path: "/cache/x", owner: "known" }], none).selected.map(x => x.candidate.id)).toEqual(["below"]);
    // The schema bounds the selectors themselves: no root, no dot segments, and never a cache label alone.
    for (const selectors of [[{ kind: "path-prefix", value: "/" }], [{ kind: "path-prefix", value: "/cache/../etc" }], [{ kind: "path-prefix", value: "relative/dir" }],
      [{ kind: "cache-prefix", value: "npm" }], [{ kind: "path-prefix", value: "/cache" }, { kind: "cache-prefix", value: "npm/.." }]] as const)
      expect([JobInputSchema.safeParse(jobInput({ selectors: selectors as never })).success, CleanupSelectors.safeParse(selectors).success]).toEqual([false, false]);
  });
});

describe("rollout, rollback and the journal's own guards", () => {
  it("an advisory job cannot run beside a retained or unknown legacy timer; observe mode records its runs", async () => {
    const legacy = { kind: "native-schedule" as const, id: "storage-0315", disposition: "retained" as const, evidence: [] };
    await jobs.defineJob(randomUUID(), captain, jobInput({ legacyTimer: legacy }));
    expect(await code(jobs.setState(randomUUID(), captain, { jobId: J, expectedVersion: 1, state: "active" }))).toBe("HELD");
    await jobs.defineJob(randomUUID(), captain, jobInput({ expectedVersion: 1, mode: "observe", legacyTimer: legacy }));
    expect((await job()).definitionVersion).toBe(1); // mode is not a definition change
    await jobs.setState(randomUUID(), captain, { jobId: J, expectedVersion: 2, state: "active" });
    await jobs.tick("2026-10-27T07:15:30Z");
    const occ = occurrenceId(J, NY, "2026-10-27");
    await expect(jobs.runHost(occ, "mini")).resolves.toMatchObject({ state: "blocked" });
    await jobs.observe(randomUUID(), supervisor, { occurrenceId: occ, hostId: "mini", outcome: "completed", detail: "legacy run finished", resultDigest: hash });
    await jobs.observe(randomUUID(), supervisor, { occurrenceId: occ, hostId: "light", outcome: "offline", detail: "no route to light", resultDigest: hash });
    const before = (await store.read()).sequence;
    await jobs.observe(randomUUID(), supervisor, { occurrenceId: occ, hostId: "light", outcome: "offline", detail: "no route to light", resultDigest: hash });
    expect((await store.read()).sequence).toBe(before);
    expect(await code(jobs.observe(randomUUID(), builder, { occurrenceId: occ, hostId: "studio", outcome: "completed", detail: "x", resultDigest: hash }))).toBe("UNKNOWN_OWNER");
    expect(fleet.calls).toBe(0);
    expect(maintenanceSummary(await store.read()).jobs[0]!.hosts).toMatchObject({ completed: 1, offline: 1, pending: 1 });
  });

  it("stop is rollback: no new occurrences; unfinished passes keep their reservations and receipts; settled ones release", async () => {
    await activate();
    fleet.outage = "mini";
    await jobs.drive("2026-10-27T07:15:30Z");
    const mini = await host("2026-10-27", "mini");
    await jobs.setState(randomUUID(), supervisor, { jobId: J, expectedVersion: (await job()).version, state: "stopped" });
    expect(await jobs.tick("2026-10-28T07:15:30Z")).toEqual([{ jobId: J, plan: "none", occurrenceId: null, wrote: false }]);
    const status = await store.read();
    expect(status.maintenance!.reservations.find(r => r.id === mini.reservationId)!.state).toBe("granted");
    expect((await host("2026-10-27", "mini")).items.map(i => i.state)).toEqual(["uncertain"]);
    expect(await code(jobs.setState(randomUUID(), supervisor, { jobId: J, expectedVersion: (await job()).version, state: "active" }))).toBe("UNSUPPORTED");
  });

  it("R10 N2: a pass settled by reconciliation releases its exclusive reservation when the job is stopped", async () => {
    await activate();
    fleet.outage = "mini";
    await jobs.drive("2026-10-27T07:15:30Z");
    let mini = await host("2026-10-27", "mini");
    await jobs.reconcileItems(randomUUID(), captain, { occurrenceId: occurrenceId(J, NY, "2026-10-27"), hostId: "mini", expectedVersion: mini.version,
      items: mini.items.map(i => ({ key: i.key, outcome: "done" as const })), evidence: [{ ref: "receiver:mini:log", digest: hash }] });
    await jobs.setState(randomUUID(), captain, { jobId: J, expectedVersion: (await job()).version, state: "stopped" });
    mini = await host("2026-10-27", "mini");
    expect(mini.state).toBe("superseded");
    expect((await store.read()).maintenance!.reservations.find(r => r.id === mini.reservationId)!).toMatchObject({ state: "released", terminal: { kind: "succeeded" } });
    expect((await store.read()).maintenance!.occurrences[0]!.state).toBe("closed");
    const build: SupervisionEffect = { id: id(0x221), logicalKey: "build/n2", requestId: id(0x222), requestHash: hash, scopeId: P, epoch: 1, attemptId: null, operation: "build",
      planRevision: null, subjectHash: hash, policyVector: [], evidenceVector: [], approvalId: null, resourceIds: ["host:mini:cache"], state: "dispatching", receiverKey: null, receiptRef: null, version: 1 };
    await put([{ kind: "effect", value: build }]);
    const resources = new SupervisionResources(store, { enabled: true, now: () => clock });
    expect((await resources.reserveForEffect(randomUUID(), builder, { effectId: build.id, class: "build", keys: ["host:mini:cache"], priority: 1, leaseMs: null })).state).toBe("granted");
  });

  it("R10 N1: at the S10 ceiling the scheduler keeps going: refused opens and hosts are reported, and passes allowed to finish still run", async () => {
    await activate();
    fleet.outage = "mini";
    await jobs.drive("2026-10-27T07:15:30Z");
    const mini = await host("2026-10-27", "mini");
    await jobs.reconcileItems(randomUUID(), captain, { occurrenceId: occurrenceId(J, NY, "2026-10-27"), hostId: "mini", expectedVersion: mini.version,
      items: mini.items.map(i => ({ key: i.key, outcome: "done" as const })), evidence: [{ ref: "receiver:mini:log", digest: hash }] });
    fleet.outage = null; fleet.candidates.set("mini", [{ id: "a", path: "/cache/a", owner: "known" }, { id: "n", path: "/cache/new", owner: "known" }]);
    const second = id(0x10e);
    await jobs.defineJob(randomUUID(), captain, jobInput({ jobId: second, name: "second", hosts: ["studio"] }));
    await jobs.setState(randomUUID(), captain, { jobId: second, expectedVersion: 1, state: "active" });
    const original = store.transactCommand.bind(store);
    const spy = vi.spyOn(store, "transactCommand").mockImplementation((requestId, inputHash, actor, prepare) =>
      original(requestId, inputHash, actor, status => prepare({ ...status, sequence: 160 })));
    const { ticks, runs } = await jobs.drive("2026-10-28T07:15:30Z");
    spy.mockRestore();
    expect(ticks.map(t => t.plan)).toEqual(["refused", "refused"]); // no new day for either job
    // The day-1 mini pass holds its granted reservation, so it resumes and finishes the item it never dispatched.
    expect(runs.find(r => r.hostId === "mini")).toMatchObject({ state: "completed" });
    expect(fleet.applied.filter(a => a.startsWith("mini"))).toEqual(["mini:/cache/new"]);
    expect((await store.read()).maintenance!.occurrences).toHaveLength(1);
  });

  it("R10 N3: past 160 waiting relabels and admissions write nothing; past 192 only settlement continues", async () => {
    await activate();
    fleet.outage = "mini";
    await jobs.drive("2026-10-27T07:15:30Z");
    fleet.outage = null;
    await jobs.tick("2026-10-28T07:15:30Z"); // day 2 opens below the ceiling: every host pending
    const original = store.transactCommand.bind(store);
    let at = 160;
    const spy = vi.spyOn(store, "transactCommand").mockImplementation((requestId, inputHash, actor, prepare) =>
      original(requestId, inputHash, actor, status => prepare({ ...status, sequence: at })));
    fleet.offline.add("light");
    let before = (await store.read()).sequence;
    const { runs } = await jobs.drive("2026-10-28T08:00:00Z");
    // light: pending -> offline is a relabel, not written. studio: a new reservation is an admission, refused.
    // mini: day 1 holds uncertain items, so both mini passes wait.
    expect(runs.map(r => [r.hostId, r.state])).toEqual([["light", "completed"], ["mini", "blocked"], ["studio", "completed"], ["light", "offline"], ["mini", "blocked"], ["studio", "refused"]]);
    expect((await store.read()).sequence).toBe(before);
    expect((await host("2026-10-28", "light")).state).toBe("pending");
    at = 192;
    const mini = await host("2026-10-27", "mini");
    // Settlement still writes in the reconciliation tail...
    await jobs.reconcileItems(randomUUID(), captain, { occurrenceId: occurrenceId(J, NY, "2026-10-27"), hostId: "mini", expectedVersion: mini.version,
      items: mini.items.map(i => ({ key: i.key, outcome: "done" as const })), evidence: [{ ref: "receiver:mini:log", digest: hash }] });
    expect((await store.read()).sequence).toBe(before + 1);
    // ...but restarting a pass (a closure) does not, even with its reservation held.
    before = (await store.read()).sequence;
    expect((await jobs.drive("2026-10-28T09:00:00Z")).runs.find(r => r.hostId === "mini")!.state).toBe("refused");
    expect((await store.read()).sequence).toBe(before);
    spy.mockRestore();
  });

  it("R10 N9: dispatch is a closure (refused at 192 even after its pass started below it); observe is a closure in an observe-mode job", async () => {
    await activate();
    await jobs.tick("2026-10-27T07:15:30Z");
    const original = store.transactCommand.bind(store);
    let at: number | null = null;
    const spy = vi.spyOn(store, "transactCommand").mockImplementation((requestId, inputHash, actor, prepare) =>
      original(requestId, inputHash, actor, status => prepare(at === null ? status : { ...status, sequence: at })));
    const inventory = fleet.inventory.bind(fleet);
    fleet.inventory = async h => { at = 192; return inventory(h); }; // the journal fills while the pass lists its host
    expect(await code(jobs.runHost(occurrenceId(J, NY, "2026-10-27"), "mini"))).toBe("HELD");
    expect((await host("2026-10-27", "mini")).items).toEqual([]);
    expect(fleet.calls).toBe(0);
    spy.mockRestore();
  });

  it("R10 N9: an observe-mode observation is refused at 192 and recorded between 160 and 192", async () => {
    await activate("2026-10-26T12:00:00Z", { mode: "observe" });
    await jobs.tick("2026-10-27T07:15:30Z");
    const occ = occurrenceId(J, NY, "2026-10-27"), original = store.transactCommand.bind(store);
    let at = 192;
    const spy = vi.spyOn(store, "transactCommand").mockImplementation((requestId, inputHash, actor, prepare) =>
      original(requestId, inputHash, actor, status => prepare({ ...status, sequence: at })));
    expect(await code(jobs.observe(randomUUID(), supervisor, { occurrenceId: occ, hostId: "mini", outcome: "completed", detail: "ran", resultDigest: hash }))).toBe("HELD");
    at = 175;
    expect(await code(jobs.observe(randomUUID(), supervisor, { occurrenceId: occ, hostId: "mini", outcome: "completed", detail: "ran", resultDigest: hash }))).toBe("committed");
    spy.mockRestore();
    expect((await host("2026-10-27", "mini")).state).toBe("completed");
  });

  it("R10 N8: past 160 the summary says the maintenance observation budget is exhausted and reads as a lower bound", async () => {
    await activate();
    await jobs.tick("2026-10-27T07:15:30Z");
    const status = await store.read();
    expect(maintenanceSummary(status)).toMatchObject({ lowerBound: false, problems: [] });
    const late = maintenanceSummary({ ...status, sequence: 160 });
    expect(late.lowerBound).toBe(true);
    expect(late.problems).toEqual([expect.stringMatching(/^Maintenance observation budget exhausted \(journal sequence 160 of 160\): waiting states and new outages are no longer recorded/)]);
  });

  it("R10 N3: observe mode writes once per state per host, however often the digest changes", async () => {
    await activate("2026-10-26T12:00:00Z", { mode: "observe" });
    await jobs.tick("2026-10-27T07:15:30Z");
    const occ = occurrenceId(J, NY, "2026-10-27"), before = (await store.read()).sequence;
    for (let n = 0; n < 6; n++) await jobs.observe(randomUUID(), supervisor, { occurrenceId: occ, hostId: "light", outcome: "offline", detail: `no route ${n}`, resultDigest: String(n).repeat(64) });
    expect((await store.read()).sequence).toBe(before + 1);
    await jobs.observe(randomUUID(), supervisor, { occurrenceId: occ, hostId: "light", outcome: "completed", detail: "back", resultDigest: hash });
    expect((await store.read()).sequence).toBe(before + 2);
  });

  it("R10 N5: a pass stranded running by a crash with nothing dispatched is superseded by the next day, not run late", async () => {
    await activate();
    await jobs.tick("2026-10-27T07:15:30Z");
    const gate = new Promise<never>(() => {});
    const stuck = new Fleet(); stuck.inventory = async () => gate;
    void new SupervisionJobs(store, { enabled: true, now: () => clock, executor: stuck }).runHost(occurrenceId(J, NY, "2026-10-27"), "mini").catch(() => {});
    await vi.waitFor(async () => expect((await host("2026-10-27", "mini")).state).toBe("running"));
    jobs = make(); // the process died; a fresh one drives the next day
    await jobs.drive("2026-10-28T07:15:30Z");
    const day1 = await host("2026-10-27", "mini");
    expect(day1.state).toBe("superseded");
    expect((await store.read()).maintenance!.reservations.find(r => r.id === day1.reservationId)!.state).toBe("released");
    expect((await host("2026-10-28", "mini")).state).toBe("completed");
    expect(fleet.applied.filter(a => a.startsWith("mini"))).toEqual(["mini:/cache/a"]); // one run for mini, the new day's
  });

  it("A13.store: a tick interrupted mid-publication recovers to the same single occurrence", async () => {
    await activate();
    let armed = true;
    // The store's own crash-injection boundary (as in supervision-crash.test.ts), armed for this one publication.
    const boundaryStore = store as unknown as { options: { boundary?: (name: string) => Promise<void> } };
    boundaryStore.options.boundary = async name => { if (armed && name === "publication:written") { armed = false; throw new Error("power lost"); } };
    expect((await jobs.tick("2026-10-27T07:15:30Z"))[0]).toMatchObject({ plan: "refused", wrote: false, reason: expect.stringMatching(/Publication interrupted/) });
    expect((await store.read()).freshness).toBe("held");
    await store.recoverPublication();
    expect(await jobs.tick("2026-10-27T07:16:00Z")).toEqual([{ jobId: J, plan: "duplicate", occurrenceId: occurrenceId(J, NY, "2026-10-27"), wrote: false }]);
    expect((await store.read()).maintenance!.occurrences).toHaveLength(1);
  });

  it("R10 N6: the journal refuses a finished pass with unsettled items, dispatched items outside a running pass, a spent pass budget and a second open incident", async () => {
    await activate("2026-10-26T12:00:00Z", { maxPasses: 1 });
    await jobs.tick("2026-10-27T07:15:30Z");
    const mini = await host("2026-10-27", "mini");
    const running: OccurrenceHost = { ...mini, state: "running", passes: 1, version: mini.version + 1, items: [{ key: hash, state: "dispatched" }] };
    await put([{ kind: "occurrence-host", value: running }]);
    const next = { ...running, version: running.version + 1 };
    await expect(put([{ kind: "occurrence-host", value: { ...next, state: "failed", items: [{ key: hash, state: "uncertain" }] } }])).rejects.toMatchObject({ code: "HELD" });
    await expect(put([{ kind: "occurrence-host", value: { ...next, state: "deferred" } }])).rejects.toMatchObject({ code: "HELD" });
    await expect(put([{ kind: "occurrence-host", value: { ...next, state: "deferred", items: [{ key: hash, state: "uncertain" }], passes: 2 } }])).rejects.toMatchObject({ code: "HELD" });
    const incident = { id: id(0x401), version: 1, jobId: J, hostId: "mini", kind: "failure" as const, signature: hash, generation: 1, firstOccurrenceId: null,
      lastOccurrenceId: null, detail: "fixture", state: "open" as const, notify: { state: "handled" as const, generation: 1 } };
    await put([{ kind: "maintenance-incident", value: incident }]);
    await expect(put([{ kind: "maintenance-incident", value: { ...incident, id: id(0x402) } }])).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("the journal refuses a second running pass, a redispatched item and a forged occurrence identity", async () => {
    await activate();
    await jobs.tick("2026-10-27T07:15:30Z");
    const mini = await host("2026-10-27", "mini");
    const running: OccurrenceHost = { ...mini, state: "running", passes: 1, version: mini.version + 1, items: [{ key: hash, state: "dispatched" }] };
    await put([{ kind: "occurrence-host", value: running }]);
    await expect(put([{ kind: "occurrence-host", value: { ...running, version: running.version + 1, items: [] } }])).rejects.toMatchObject({ code: "HELD" });
    await expect(put([{ kind: "occurrence-host", value: { ...running, version: running.version + 1, state: "completed", items: [{ key: hash, state: "dispatched" }] } }])).rejects.toMatchObject({ code: "HELD" });
    await jobs.tick("2026-10-28T07:15:30Z");
    const next = (await store.read()).maintenance!.hosts.find(h => h.id === occurrenceHostId(occurrenceId(J, NY, "2026-10-28"), "mini"))!;
    await expect(put([{ kind: "occurrence-host", value: { ...next, state: "running", passes: 1, version: next.version + 1 } }])).rejects.toMatchObject({ code: "CONFLICT" });
    const occ = (await store.read()).maintenance!.occurrences[0]!;
    await expect(put([{ kind: "occurrence", value: { ...occ, localDate: "2026-10-26", version: occ.version + 1 } }])).rejects.toMatchObject({ code: "CONFLICT" });
    // The earlier mini pass kept running with unsettled items, so the new day's mini pass waits for it.
    await expect(jobs.runHost(occurrenceId(J, NY, "2026-10-28"), "mini")).resolves.toMatchObject({ state: "blocked" });
  });
});

it("planTick is pure: no occurrence before activation, and catch-up never reaches past the activation instant", () => {
  const j = { id: J, state: "active", activeSince: "2026-10-26T12:00:00Z", definitionVersion: 1, hosts: ["mini"],
    schedule: { kind: "daily", at: "03:15", zone: NY } } as unknown as MaintenanceJob;
  expect(planTick(j, [], Date.parse("2026-10-27T07:00:00Z"))).toEqual({ kind: "none", reason: "before-activation" });
  const open = planTick(j, [], Date.parse("2026-10-30T12:00:00Z"));
  expect(open).toMatchObject({ kind: "open", occurrence: { localDate: "2026-10-30", trigger: "catch-up", missed: { count: 3, dates: ["2026-10-27", "2026-10-28", "2026-10-29"] } } });
  expect(planTick({ ...j, state: "stopped" }, [], Date.parse("2026-10-30T12:00:00Z"))).toEqual({ kind: "none", reason: "inactive" });
});
