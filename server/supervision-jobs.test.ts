import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupervisionActor, SupervisionEffect, SupervisionStatus } from "../shared/supervision";
import { maintenanceSummary, type MaintenanceJob, type OccurrenceHost } from "../shared/supervision-maintenance";
import { expected, hash } from "../test/supervision-fixture";
import { SupervisionError, SupervisionStore, type SupervisionMutation } from "./supervision-store";
import {
  addDays, dueInstant, localDate, maintenanceIncidentNote, planCleanup, planTick, SupervisionJobs, type JobInputSchema, type MaintenanceCandidate, type MaintenanceExecutor,
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
  candidates = new Map<string, MaintenanceCandidate[]>(); retainedWorkspaces = ["ws-live"];
  applied: string[] = []; fences: number[] = []; outage: string | null = null; hang = false; calls = 0;
  async probe(host: string) { return this.offline.has(host) ? "offline" as const : "online" as const; }
  async inventory(host: string) {
    if (this.incomplete.has(host)) throw new Error("listing truncated");
    return this.candidates.get(host) ?? [{ id: "a", path: "/cache/a", owner: "known" as const }];
  }
  async retained() { return { workspaces: this.retainedWorkspaces, volumes: [] }; }
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
    const plan = planCleanup({ id: J, selectors: [{ kind: "cache-prefix", value: "npm/" }], retained: [] }, "mini",
      [{ id: "x", path: "/home/u/.npm/_cacache", cache: "npm/_cacache", owner: "known" }, { id: "y", path: "/srv/x", cache: "pip/x", owner: "known" }], { workspaces: [], volumes: [] });
    expect(plan.selected.map(s => s.candidate.id)).toEqual(["x"]);
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

  it("stop is rollback: no new occurrences, and unfinished passes keep their reservations and receipts", async () => {
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

  it("new occurrences stop at the S10 ceiling while existing passes still finish", async () => {
    await activate();
    await jobs.tick("2026-10-27T07:15:30Z");
    const original = store.transactCommand.bind(store);
    const spy = vi.spyOn(store, "transactCommand").mockImplementation((requestId, inputHash, actor, prepare) =>
      original(requestId, inputHash, actor, status => prepare({ ...status, sequence: 160 })));
    // Finishing today's passes with their reservations already taken would need new reservations: held.
    await jobs.runHost(occurrenceId(J, NY, "2026-10-27"), "mini").catch(() => {});
    expect(await code(jobs.tick("2026-10-28T07:15:30Z"))).toBe("HELD");
    spy.mockRestore();
    expect((await store.read()).maintenance!.occurrences).toHaveLength(1);
  });

  it("A13.store: a tick interrupted mid-publication recovers to the same single occurrence", async () => {
    await activate();
    let armed = true;
    // The store's own crash-injection boundary (as in supervision-crash.test.ts), armed for this one publication.
    const boundaryStore = store as unknown as { options: { boundary?: (name: string) => Promise<void> } };
    boundaryStore.options.boundary = async name => { if (armed && name === "publication:written") { armed = false; throw new Error("power lost"); } };
    expect(await code(jobs.tick("2026-10-27T07:15:30Z"))).toBe("HELD");
    expect((await store.read()).freshness).toBe("held");
    await store.recoverPublication();
    expect(await jobs.tick("2026-10-27T07:16:00Z")).toEqual([{ jobId: J, plan: "duplicate", occurrenceId: occurrenceId(J, NY, "2026-10-27"), wrote: false }]);
    expect((await store.read()).maintenance!.occurrences).toHaveLength(1);
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
