/** Pure S10 row checks, used at append AND replay by the S01 journal (beside the S08 source and S09 project checks). */
import type { SupervisionCode, SupervisionEffect, SupervisionScope } from "../shared/supervision";
import {
  compatible, isTerminalHost, MAINTENANCE_KINDS, MaintenanceIncidentSchema, MaintenanceJobSchema, OccurrenceHostSchema, OccurrenceSchema,
  ResourceReservationSchema, unsettled, type MaintenanceIncident, type MaintenanceJob, type Occurrence, type OccurrenceHost, type ResourceReservation,
} from "../shared/supervision-maintenance";
import { digest } from "./submissions";

type Frame = { kind: string; id: string; version: number; value: unknown };
type Fail = (code: SupervisionCode, message: string) => never;
const KINDS = new Set(MAINTENANCE_KINDS);
const frameKey = (kind: string, id: string) => JSON.stringify([kind, id]);
/** Deterministic v4-shaped identity, so the same logical record is one row however often it is proposed. */
export function maintenanceRowId(...parts: unknown[]): string {
  const h = digest(["firstmate.supervision-maintenance/1", ...parts]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** D5 option 1: one occurrence per job, IANA zone and local date. The definition version is recorded, not keyed. */
export const occurrenceId = (jobId: string, zone: string, localDate: string) => maintenanceRowId("occurrence", jobId, zone, localDate);
export const occurrenceHostId = (occurrence: string, hostId: string) => maintenanceRowId("occurrence-host", occurrence, hostId);
/** One reservation per host pass, reused by every resumed pass. */
export const hostReservationId = (hostRow: string) => maintenanceRowId("reservation", "occurrence-host", hostRow);
export const effectReservationId = (effectId: string) => maintenanceRowId("reservation", "effect", effectId);
export const incidentId = (jobId: string, hostId: string, kind: string, ordinal: number) => maintenanceRowId("incident", jobId, hostId, kind, ordinal);
/** Occurrences of one job are never closer than this, so a zone change or DST shift cannot yield a second run for one day. */
export const OCCURRENCE_SPACING_MS = 12 * 60 * 60 * 1000;
const without = <T extends object>(value: T, ...keys: string[]) => Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k)));
const reviewed = (actor: { kind: string }) => actor.kind === "captain-ui" || actor.kind === "mate-chat";
const definition = (j: MaintenanceJob) => [j.schedule, j.hosts, j.resource, j.selectors, j.retained, j.catchUp, j.domain];

function maxFence(frames: Map<string, Frame>, key: string, self: string): number {
  let max = 0;
  for (const f of frames.values()) if (f.kind === "resource-reservation" && f.id !== self)
    for (const fence of (f.value as ResourceReservation).fences) if (fence.key === key && fence.fence > max) max = fence.fence;
  return max;
}

export function validateMaintenanceChange(kind: string, value: unknown, prior: unknown, frames: Map<string, Frame>, fail: Fail): void {
  if (!KINDS.has(kind)) return;
  const get = <T>(k: string, id: string) => frames.get(frameKey(k, id))?.value as T | undefined;
  if (kind === "resource-reservation") {
    const row = value as ResourceReservation, old = prior as ResourceReservation | undefined;
    if (!old && !["queued", "granted"].includes(row.state)) fail("CONFLICT", "A reservation starts queued or granted.");
    if (old) {
      if (digest(without(old, "version", "state", "fences", "lease", "terminal")) !== digest(without(row, "version", "state", "fences", "lease", "terminal")))
        fail("CONFLICT", "A reservation keeps its holder, class, sorted keys, priority and queue position.");
      const allowed: Record<string, string[]> = { queued: ["queued", "granted", "cancelled"], granted: ["granted", "suspect", "released"],
        suspect: ["suspect", "granted", "released"], released: [], cancelled: [] };
      if (!allowed[old.state]!.includes(row.state)) fail("HELD", "Expiry marks a reservation suspect; only terminal evidence releases it, and a release is final.");
      if (old.fences.length && digest(old.fences) !== digest(row.fences)) fail("HELD", "Issued fences are never reissued.");
    }
    if (row.state === "granted" && (!old || old.state === "queued"))
      for (const fence of row.fences) if (fence.fence <= maxFence(frames, fence.key, row.id)) fail("STALE", "A new grant takes the next fence of every key.");
    if (row.state === "released" && old?.state !== "released") {
      const terminal = row.terminal!;
      if (row.holder.kind === "effect") {
        const effect = get<SupervisionEffect>("effect", row.holder.id);
        const ok = !!effect && ({ succeeded: ["succeeded"], failed: ["failed", "cancelled"], withdrawn: ["reserved", "cancelled"],
          "not-admitted": ["uncertain"] } as Record<string, string[]>)[terminal.kind]!.includes(effect.state) &&
          (terminal.kind !== "not-admitted" || (terminal.evidence.length > 0 && reviewed(terminal.actor)));
        if (!ok) fail("HELD", "An unknown or unfinished effect keeps its reservation; release needs its terminal state or recorded proof it was never admitted.");
      } else {
        const host = get<OccurrenceHost>("occurrence-host", row.holder.id);
        const ok = !!host && unsettled(host) === 0 && (terminal.kind === "withdrawn" ? host.items.every(i => i.state === "skipped")
          : terminal.kind !== "not-admitted" && isTerminalHost(host));
        if (!ok) fail("HELD", "A host pass keeps its reservation until it is finished and every dispatched item is settled.");
      }
    }
  }
  if (kind === "maintenance-job") {
    const row = value as MaintenanceJob, old = prior as MaintenanceJob | undefined;
    if (old) {
      if (old.scopeId !== row.scopeId || old.name !== row.name || old.domain !== row.domain) fail("CONFLICT", "A job keeps its scope, name and domain.");
      if (row.spentTurns < old.spentTurns || (old.activeSince && old.activeSince !== row.activeSince)) fail("HELD", "Job spend and first activation are retained.");
      const changed = digest(definition(old)) !== digest(definition(row));
      if (row.definitionVersion !== old.definitionVersion + (changed ? 1 : 0)) fail("CONFLICT", "A definition change takes the next definition version; anything else keeps it.");
    } else if (row.definitionVersion !== 1 || row.spentTurns !== 0) fail("CONFLICT", "A new job starts at definition version 1 with nothing spent.");
    if (row.state === "active" && row.mode === "advisory" && row.legacyTimer.kind !== "none" &&
      (row.legacyTimer.disposition !== "retired" || !row.legacyTimer.evidence.length))
      fail("HELD", "An advisory job cannot run beside its legacy timer: retire the timer with evidence first (no duplicate cleaner).");
  }
  if (kind === "occurrence") {
    const row = value as Occurrence, old = prior as Occurrence | undefined;
    if (row.id !== occurrenceId(row.jobId, row.zone, row.localDate)) fail("CONFLICT", "An occurrence is identified by its job, zone and local date.");
    if (!old && row.state !== "open") fail("CONFLICT", "An occurrence opens before it closes.");
    if (old && (old.state === "closed" || digest(without(old, "version", "state", "closedAt")) !== digest(without(row, "version", "state", "closedAt"))))
      fail("HELD", "An occurrence keeps its identity, coverage and missed-day observation; a closed one is final.");
  }
  if (kind === "occurrence-host") {
    const row = value as OccurrenceHost, old = prior as OccurrenceHost | undefined;
    if (row.id !== occurrenceHostId(row.occurrenceId, row.hostId)) fail("CONFLICT", "A host pass is identified by its occurrence and host.");
    if (!old && row.state !== "pending") fail("CONFLICT", "A host pass starts pending.");
    if (row.items.some(i => i.state === "dispatched") && row.state !== "running") fail("HELD", "Dispatched items without a result become uncertain; they are never left dispatched.");
    if (["completed", "superseded"].includes(row.state) && unsettled(row)) fail("HELD", "A host pass with unsettled items stays open.");
    if (old) {
      if (old.occurrenceId !== row.occurrenceId || old.jobId !== row.jobId || old.hostId !== row.hostId || row.passes < old.passes ||
        (old.reservationId && !row.reservationId)) fail("CONFLICT", "A host pass keeps its identity, pass count and reservation.");
      // Observe mode records a legacy timer's reported outcome directly, so an unstarted pass may finish too.
      const open = ["running", "deferred", "offline", "completed", "failed", "superseded"];
      const allowed: Record<string, string[]> = { pending: open, running: ["running", "completed", "failed", "deferred", "offline"], deferred: open, offline: open,
        completed: [], failed: [], superseded: [] };
      if (!allowed[old.state]!.includes(row.state)) fail("HELD", "A finished host pass is final, and a running one finishes before it is superseded.");
      if (row.state === "running" && old.state !== "running" && row.passes !== old.passes + 1) fail("CONFLICT", "Each resumed pass is counted once.");
      const moves: Record<string, string[]> = { dispatched: ["dispatched", "done", "failed", "uncertain"], uncertain: ["uncertain", "done", "failed"],
        done: ["done"], failed: ["failed"], skipped: ["skipped"] };
      for (const item of old.items) {
        const now = row.items.find(i => i.key === item.key);
        if (!now || !moves[item.state]!.includes(now.state)) fail("HELD", "The item ledger is append-only: an item is never redispatched or forgotten.");
      }
    }
    const job = get<MaintenanceJob>("maintenance-job", row.jobId);
    if (job && row.passes > job.maxPasses) fail("HELD", "The host pass budget is spent; this pass fails visibly instead of retrying.");
  }
  if (kind === "maintenance-incident") {
    const row = value as MaintenanceIncident, old = prior as MaintenanceIncident | undefined;
    if (!old && (row.state !== "open" || row.generation !== 1)) fail("CONFLICT", "An incident opens at generation 1.");
    if (old) {
      // A resolved incident is final; its last wake may still be acknowledged.
      const ack = old.state === "resolved" && old.notify.state === "pending" && row.notify.state === "handled" &&
        digest(without(old, "version", "notify")) === digest(without(row, "version", "notify")) && row.notify.generation === old.notify.generation;
      if ((old.state === "resolved" && !ack) || old.jobId !== row.jobId || old.hostId !== row.hostId || old.kind !== row.kind || old.firstOccurrenceId !== row.firstOccurrenceId)
        fail("HELD", "An incident keeps its job, host and kind; a resolved incident is final.");
      if (row.generation !== old.generation + (old.signature !== row.signature ? 1 : 0)) fail("CONFLICT", "Only a changed signature is a new incident generation.");
      if (row.notify.generation < old.notify.generation) fail("HELD", "Wake accounting never regresses.");
    }
  }
}

export function validateMaintenanceRows(frames: Map<string, Frame>, fail: Fail): void {
  const byKind = new Map<string, unknown[]>();
  for (const f of frames.values()) if (KINDS.has(f.kind)) { const list = byKind.get(f.kind); if (list) list.push(f.value); else byKind.set(f.kind, [f.value]); }
  // Pre-S10 journals pay one pass and nothing else.
  if (!byKind.size) return;
  const get = <T>(k: string, id: string) => frames.get(frameKey(k, id))?.value as T | undefined;
  const rows = <T>(k: string) => (byKind.get(k) ?? []) as T[];
  const jobs = rows<MaintenanceJob>("maintenance-job"), occurrences = rows<Occurrence>("occurrence"), hosts = rows<OccurrenceHost>("occurrence-host");
  for (const job of jobs) {
    MaintenanceJobSchema.parse(job);
    if (get<SupervisionScope>("scope", job.scopeId)?.kind !== "maintenance") fail("UNKNOWN_OWNER", "A maintenance job belongs to a registered maintenance scope.");
  }
  const byJob = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    OccurrenceSchema.parse(occurrence);
    const job = get<MaintenanceJob>("maintenance-job", occurrence.jobId);
    if (!job) fail("UNKNOWN_OWNER", "An occurrence belongs to a registered job.");
    byJob.set(occurrence.jobId, [...(byJob.get(occurrence.jobId) ?? []), occurrence]);
    for (const hostId of occurrence.hosts) {
      const host = get<OccurrenceHost>("occurrence-host", occurrenceHostId(occurrence.id, hostId));
      if (!host) fail("CONFLICT", "Every covered host of an occurrence is accounted, offline ones included.");
      if (occurrence.state === "closed" && !isTerminalHost(host)) fail("HELD", "An occurrence closes only when every covered host pass is finished.");
    }
  }
  for (const list of byJob.values()) {
    const sorted = [...list].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    for (let i = 1; i < sorted.length; i++) if (Date.parse(sorted[i]!.dueAt) - Date.parse(sorted[i - 1]!.dueAt) < OCCURRENCE_SPACING_MS)
      fail("CONFLICT", "One job has one occurrence per day; two occurrences are never closer than twelve hours.");
  }
  const running = new Set<string>();
  for (const host of hosts) {
    OccurrenceHostSchema.parse(host);
    const occurrence = get<Occurrence>("occurrence", host.occurrenceId);
    if (!occurrence || occurrence.jobId !== host.jobId || !occurrence.hosts.includes(host.hostId)) fail("UNKNOWN_OWNER", "A host pass belongs to its occurrence's coverage.");
    if (host.state === "running") {
      const k = JSON.stringify([host.jobId, host.hostId]);
      if (running.has(k)) fail("CONFLICT", "One job runs at most one pass per host at a time."); running.add(k);
    }
    if (host.reservationId) {
      const reservation = get<ResourceReservation>("resource-reservation", host.reservationId);
      if (!reservation || reservation.holder.kind !== "occurrence-host" || reservation.holder.id !== host.id) fail("CONFLICT", "A host pass names its own reservation.");
    }
  }
  // A pass moves to a new reservation only once every earlier one of its own is finished.
  for (const r of rows<ResourceReservation>("resource-reservation")) if (r.holder.kind === "occurrence-host" && !["released", "cancelled"].includes(r.state) &&
    get<OccurrenceHost>("occurrence-host", r.holder.id)?.reservationId !== r.id) fail("HELD", "A host pass keeps an unfinished reservation until it is released.");
  const active = new Map<string, ResourceReservation[]>(), fences = new Set<string>();
  for (const r of rows<ResourceReservation>("resource-reservation")) {
    ResourceReservationSchema.parse(r);
    const scope = get<SupervisionScope>("scope", r.scopeId);
    if (!scope) fail("UNKNOWN_OWNER", "A reservation belongs to a registered scope.");
    if (r.holder.kind === "effect") {
      const effect = get<SupervisionEffect>("effect", r.holder.id);
      if (!effect || effect.scopeId !== r.scopeId || r.keys.some(k => !effect.resourceIds.includes(k))) fail("CONFLICT", "An effect reservation covers only resources its effect names.");
    } else {
      const host = get<OccurrenceHost>("occurrence-host", r.holder.id), job = host && get<MaintenanceJob>("maintenance-job", host.jobId);
      if (!host || job?.scopeId !== r.scopeId) fail("CONFLICT", "A host pass reservation belongs to its job's maintenance scope.");
    }
    for (const f of r.fences) { const k = JSON.stringify([f.key, f.fence]); if (fences.has(k)) fail("CONFLICT", "A fence is issued once."); fences.add(k); }
    if (r.state === "granted" || r.state === "suspect") for (const key of r.keys) active.set(key, [...(active.get(key) ?? []), r]);
  }
  for (const holders of active.values()) for (let i = 0; i < holders.length; i++) for (let j = i + 1; j < holders.length; j++)
    if (!compatible(holders[i]!.class, holders[j]!.class)) fail("CONFLICT", "Only shared build/read holders may hold one resource together.");
  const openIncidents = new Set<string>();
  for (const incident of rows<MaintenanceIncident>("maintenance-incident")) {
    MaintenanceIncidentSchema.parse(incident);
    if (!get<MaintenanceJob>("maintenance-job", incident.jobId)) fail("UNKNOWN_OWNER", "An incident belongs to a registered job.");
    if (incident.state !== "open") continue;
    const k = JSON.stringify([incident.jobId, incident.hostId, incident.kind]);
    if (openIncidents.has(k)) fail("CONFLICT", "One open incident per job, host and kind."); openIncidents.add(k);
  }
}
