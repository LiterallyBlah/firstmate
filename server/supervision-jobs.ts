/** Disabled S10 maintenance jobs and durable daily occurrences (D5 option 1). No RPC registration, timer, send or wake.
 *
 * An occurrence is keyed by (job, IANA zone, local date). A late tick, a restart across the due time or several missed
 * days open one occurrence for the latest due date, recording the skipped dates as one missed-day observation. A time
 * that DST repeats runs once (its first instant); a time DST skips runs as far past the gap as it fell inside it.
 * Each covered host has one pass record per occurrence. Items are written as dispatched before they are applied and
 * are never dispatched twice: a pass interrupted mid-batch leaves them uncertain, keeps its reservation, and resumes
 * only the rest. Healthy results and unchanged failures or outages wake nobody; General reads status on demand.
 */
import { randomUUID } from "node:crypto";
import { realpath as fsRealpath } from "node:fs/promises";
import { z } from "zod";
import { SupervisionActorSchema, SupervisionHash, SupervisionUtc, SupervisionUuid, type SupervisionActor, type SupervisionExpected, type SupervisionStatus } from "../shared/supervision";
import {
  absolutePath, cacheLabelValid, CleanupSelectors, HostId, IanaZone, isTerminalHost, normalPath, pathSegmentsValid, maintenanceSummary, ResourceClass, unsettled, type MaintenanceIncident, type MaintenanceJob,
  type MaintenanceRows, type MaintenanceSummary, type Occurrence, type OccurrenceHost, type ResourceReservation,
} from "../shared/supervision-maintenance";
import { digest } from "./submissions";
import type { SupervisionMutation, SupervisionStore } from "./supervision-store";
import { hostReservationId, incidentId, maintenanceRowId, OCCURRENCE_SPACING_MS, occurrenceHostId, occurrenceId } from "./supervision-maintenance-state";
import { emptyResult, grantable, maintenanceAdmission, maintenanceRows, nextFences, refuse, stepRoom } from "./supervision-resources";
export { stepRoom, type Step } from "./supervision-resources";
import type { Step } from "./supervision-resources";
import { boundTo } from "./supervision-projects";
import { message, TEMPLATES } from "./templates";
import type { NativeTimerInventory } from "./archive-inventory";

// ---------------------------------------------------------------------------------------------------------------
// Local dates in an IANA zone. Pure; the runtime's Intl tz database is the only source.

const formats = new Map<string, Intl.DateTimeFormat>();
function wallMs(ms: number, zone: string): number {
  let f = formats.get(zone);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); formats.set(zone, f); }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
}
const offsetAt = (ms: number, zone: string) => wallMs(ms, zone) - Math.floor(ms / 60000) * 60000;
export function localDate(ms: number, zone: string): string { return new Date(wallMs(ms, zone)).toISOString().slice(0, 10); }
export function addDays(date: string, days: number): string { return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }
/** The UTC instant a daily `HH:MM` falls on for a local date. Repeated wall times take the first instant; a skipped
 * wall time is read with the offset in force before the gap (02:30 in a one-hour spring gap runs at 03:30). */
export function dueInstant(date: string, at: string, zone: string): number {
  const [y, m, d] = date.split("-").map(Number), [h, mi] = at.split(":").map(Number);
  const target = Date.UTC(y!, m! - 1, d!, h!, mi!);
  const offsets = new Set([-24, -12, 0, 12, 24].map(k => offsetAt(target + k * 3600000, zone)));
  const valid = [...offsets].map(o => target - o).filter(t => wallMs(t, zone) === target);
  return valid.length ? Math.min(...valid) : target - offsetAt(target - 86400000, zone);
}
const utc = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/** A tick this long after the due minute is still the scheduled run; later, it is a catch-up. */
export const LATE_GRACE_MS = 5 * 60 * 1000;
const MISSED_LOOKBACK_DAYS = 400;

export type TickPlan = { kind: "none"; reason: "inactive" | "before-activation" | "spacing" | "older" } | { kind: "duplicate"; occurrenceId: string }
  | { kind: "open"; occurrence: Omit<Occurrence, "version" | "openedAt"> };
/** D5 option 1, as a pure function of the job, its recorded occurrences and the time now. */
export function planTick(job: MaintenanceJob, occurrences: readonly Occurrence[], nowMs: number): TickPlan {
  if (job.state !== "active" || !job.activeSince) return { kind: "none", reason: "inactive" };
  const { zone, at } = job.schedule, since = Date.parse(job.activeSince);
  let date = localDate(nowMs, zone);
  if (dueInstant(date, at, zone) > nowMs) date = addDays(date, -1);
  const due = dueInstant(date, at, zone);
  if (due < since) return { kind: "none", reason: "before-activation" };
  const id = occurrenceId(job.id, zone, date);
  if (occurrences.some(o => o.id === id)) return { kind: "duplicate", occurrenceId: id };
  const last = occurrences.filter(o => o.jobId === job.id).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).at(-1);
  if (last && Date.parse(last.dueAt) > due) return { kind: "none", reason: "older" };
  if (last && due - Date.parse(last.dueAt) < OCCURRENCE_SPACING_MS) return { kind: "none", reason: "spacing" };
  const dates: string[] = [];
  let count = 0;
  for (let d = addDays(date, -1), i = 0; i < MISSED_LOOKBACK_DAYS && (!last || d > last.localDate) && dueInstant(d, at, zone) >= since; d = addDays(d, -1), i++) {
    count++; dates.unshift(d);
  }
  return { kind: "open", occurrence: { id, jobId: job.id, definitionVersion: job.definitionVersion, zone, localDate: date, dueAt: utc(due),
    trigger: nowMs - due <= LATE_GRACE_MS ? "scheduled" : "catch-up", missed: { dates: dates.slice(-31), count },
    hosts: [...job.hosts], state: "open", closedAt: null } };
}

// ---------------------------------------------------------------------------------------------------------------
// Cleanup planning. Selection never reaches past the job's selectors; retained worktrees/volumes and unknown owners stay.

export interface MaintenanceCandidate { id: string; path: string; cache?: string; workspaceId?: string | null; volumeId?: string | null; owner: "known" | "unknown";
  /** The candidate's resolved path (`resolveCleanupAliases`). When present it must satisfy the same bounds as `path`. */
  realPath?: string }
/** Complete retained sets: workspace and volume identities, and the paths retained worktrees live at. */
export interface RetainedSet { workspaces: readonly string[]; volumes: readonly string[]; paths: readonly string[] }
export function itemKey(jobId: string, hostId: string, candidate: Pick<MaintenanceCandidate, "id" | "path">) { return digest(["firstmate.maintenance-item/1", jobId, hostId, candidate.id, candidate.path]); }
/** A parent ending in `/` is a filesystem root (`/`, `c:/`): it contains every path on that root (R10 E1). */
const within = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
const overlaps = (a: string, b: string) => within(a, b) || within(b, a);
/** Retained paths come verbatim from other tools (Paseo's session `cwd`, captain-typed entries), so they are
 * canonicalized: `\` read as `/`, duplicate separators and `.` segments dropped, and compared case-insensitively.
 * Over-excluding is safe. A retained path that is relative or has a `..` segment cannot be canonicalized without the
 * filesystem, and the whole pass is refused (`RetainedPathError`) instead of planning around it. Symlink and junction
 * aliases are invisible to string comparison: an executor resolves them first with `resolveCleanupAliases` (S11). */
export class RetainedPathError extends Error {}
const looksLikePath = (v: string) => /^([A-Za-z]:)?[\\/]/.test(v);
export function retainedKey(raw: string): string {
  let path = raw.replaceAll("\\", "/");
  // R10 E2: the Win32 long-path form of a drive path is that drive path; any other `\?\` or `\.\` form
  // (UNC, device, volume GUID) cannot be compared by string and refuses the pass.
  if (/^\/\/[?.]\//.test(path)) {
    if (!/^\/\/[?.]\/[A-Za-z]:\//.test(path)) throw new RetainedPathError(`Retained path ${JSON.stringify(raw)} is a device or UNC long path; nothing is planned on this host.`);
    path = path.slice(4);
  }
  const drive = /^[A-Za-z]:\//.test(path) ? path.slice(0, 2) : null;
  if (!drive && !path.startsWith("/")) throw new RetainedPathError(`Retained path ${JSON.stringify(raw)} is not absolute; nothing is planned on this host.`);
  const segments = path.slice(drive ? 3 : 1).split("/").filter(s => s !== "" && s !== ".");
  if (segments.includes("..")) throw new RetainedPathError(`Retained path ${JSON.stringify(raw)} has a .. segment; nothing is planned on this host.`);
  if (segments.some(s => s === "?" || /^[A-Za-z]:$/.test(s))) throw new RetainedPathError(`Retained path ${JSON.stringify(raw)} has a device or drive segment mid-path; nothing is planned on this host.`);
  return `${drive ?? ""}/${segments.join("/")}`.toLowerCase();
}
/** R10 E3: a `retained` entry is either an identity (no separator, no `~`, no drive prefix) or an absolute path that
 * canonicalizes. `~/keep`, `C:cache\keep` and `cache/keep` are neither and are refused when the job is defined. */
export function retainedEntryValid(entry: string): boolean {
  if (!/[\\/]/.test(entry) && !entry.startsWith("~") && !/^[A-Za-z]:/.test(entry)) return true;
  if (!looksLikePath(entry)) return false;
  try { retainedKey(entry); return true; } catch { return false; }
}
/** Select cleanup items. A candidate is selected only when its absolute, segment-valid path lies strictly below a
 * path-prefix selector (never the selector root; compared exactly, which can only narrow selection), its cache label
 * matches a cache-prefix selector by whole segments when any is given, it neither equals, contains nor lies under any
 * retained path (canonicalized and compared case-insensitively), and its owner is known. Retained paths are the
 * executor's worktree paths, path-shaped `retained` entries, and the paths of candidates tagged with a retained
 * identity. A candidate listed twice is one item. Throws `RetainedPathError` when a retained path cannot be
 * canonicalized; the pass then defers with nothing dispatched. */
export function planCleanup(job: Pick<MaintenanceJob, "id" | "selectors" | "retained">, hostId: string, candidates: readonly MaintenanceCandidate[], retained: RetainedSet) {
  const ids = new Set([...retained.workspaces, ...retained.volumes, ...job.retained]);
  const roots = job.selectors.flatMap(s => s.kind === "path-prefix" ? [normalPath(s.value)] : []);
  const labels = job.selectors.flatMap(s => s.kind === "cache-prefix" ? [s.value.replace(/\/+$/, "")] : []);
  const tagged = (c: MaintenanceCandidate) => [c.workspaceId, c.volumeId, c.id, c.path].some(v => v && ids.has(v));
  const keep = [...retained.paths, ...job.retained.filter(looksLikePath), ...candidates.filter(tagged).flatMap(c => [c.path, ...(c.realPath !== undefined ? [c.realPath] : [])])].map(retainedKey);
  const selected: { key: string; candidate: MaintenanceCandidate }[] = [], seen = new Set<string>();
  let excluded = 0, triage = 0;
  for (const c of candidates) {
    const key = itemKey(job.id, hostId, c);
    if (seen.has(key)) continue;
    seen.add(key);
    // An alias is judged by both names: its literal path and, when resolved, the path it reaches.
    const names = [c.path, ...(c.realPath !== undefined ? [c.realPath] : [])].map(raw => ({ raw, path: normalPath(raw) }));
    const inside = names.every(n => absolutePath(n.path) && pathSegmentsValid(n.raw) && roots.some(r => n.path !== r && within(n.path, r)));
    const labelled = !labels.length || (c.cache !== undefined && cacheLabelValid(c.cache) && labels.some(l => within(c.cache!, l)));
    if (!inside || !labelled || tagged(c) || keep.some(k => names.some(n => overlaps(n.path.toLowerCase(), k)))) { excluded++; continue; }
    if (c.owner !== "known") { triage++; continue; }
    selected.push({ key, candidate: c });
  }
  return { selected, excluded, triage };
}

/** S11 executor-approval requirement (R10 B1-R): symlink and junction aliases resolved before planning. Each retained
 * path is kept under its literal name and its resolved one; a retained path that does not exist keeps its literal name,
 * and one that cannot be resolved for any other reason refuses the pass (`RetainedPathError`). Each candidate carries
 * its resolved path, which `planCleanup` holds to the same selector and retained bounds; a candidate that cannot be
 * resolved is dropped and counted, never planned. */
export async function resolveCleanupAliases(candidates: readonly MaintenanceCandidate[], retained: RetainedSet,
  realpath: (path: string) => Promise<string> = p => fsRealpath(p)) {
  const paths = [...retained.paths];
  for (const p of retained.paths) {
    try { paths.push(await realpath(p)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new RetainedPathError(`Retained path ${JSON.stringify(p)} cannot be resolved (${(error as Error).message}); nothing is planned on this host.`);
    }
  }
  const resolved: MaintenanceCandidate[] = [];
  let unresolved = 0;
  for (const c of candidates) {
    try { resolved.push({ ...c, realPath: await realpath(c.path) }); } catch { unresolved++; }
  }
  return { candidates: resolved, retained: { ...retained, paths: [...new Set(paths)] }, unresolved };
}

/** What runs a pass on a host. None ships: actual shared effects need a qualified receiver (S11). */
export interface MaintenanceExecutor {
  probe(hostId: string): Promise<"online" | "offline">;
  /** Throws when the listing is incomplete; a partial listing is never used. */
  inventory(hostId: string): Promise<MaintenanceCandidate[]>;
  /** Complete retained sets (e.g. `retainedWorkspaces()` from archive-inventory). Throws when incomplete. An approved
   * executor passes its inventory and retained set through `resolveCleanupAliases` first (`executorApproval`, S11). */
  retained(hostId: string): Promise<RetainedSet>;
  apply(hostId: string, items: { key: string; candidate: MaintenanceCandidate }[], fences: { key: string; fence: number }[]): Promise<{ key: string; outcome: "done" | "failed" }[]>;
}

// ---------------------------------------------------------------------------------------------------------------
// One transaction's rows, merged so a row changed twice is written once at its next version.

type Kind = "maintenance-job" | "occurrence" | "occurrence-host" | "maintenance-incident" | "resource-reservation";
type Row = { kind: Kind; value: { id: string; version: number } };
class Draft {
  private rows = new Map<string, Row>();
  constructor(readonly status: SupervisionStatus) {}
  private version(kind: SupervisionExpected["kind"], id: string) { return this.status.versions.find(v => v.kind === kind && v.id === id)?.version ?? 0; }
  private stored(kind: Kind): { id: string }[] {
    const rows = maintenanceRows(this.status);
    return ({ "maintenance-job": rows.jobs, occurrence: rows.occurrences, "occurrence-host": rows.hosts, "maintenance-incident": rows.incidents, "resource-reservation": rows.reservations })[kind];
  }
  get<T>(kind: Kind, id: string): T | undefined {
    const draft = this.rows.get(JSON.stringify([kind, id]));
    return (draft ? draft.value : this.stored(kind).find(r => r.id === id)) as T | undefined;
  }
  put<T extends { id: string; version: number }>(kind: Kind, value: Omit<T, "version">): T {
    const row = { ...value, version: this.version(kind, value.id) + 1 } as unknown as T;
    this.rows.set(JSON.stringify([kind, value.id]), { kind, value: row });
    return row;
  }
  rowsOf(): MaintenanceRows {
    const merge = <T>(kind: Kind): T[] => {
      const out = new Map(this.stored(kind).map(r => [r.id, r as unknown]));
      for (const m of this.rows.values()) if (m.kind === kind) out.set(m.value.id, m.value);
      return [...out.values()] as T[];
    };
    return { jobs: merge("maintenance-job"), occurrences: merge("occurrence"), hosts: merge("occurrence-host"), incidents: merge("maintenance-incident"), reservations: merge("resource-reservation") };
  }
  get size() { return this.rows.size; }
  /** Host passes precede reservations, so a release is checked against the pass's final state in this transaction. */
  mutations(): SupervisionMutation[] {
    const order: Kind[] = ["maintenance-job", "occurrence", "occurrence-host", "maintenance-incident", "resource-reservation"];
    return [...this.rows.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)) as unknown as SupervisionMutation[];
  }
  expected(): SupervisionExpected[] { return [...this.rows.values()].map(m => ({ kind: m.kind, id: m.value.id, version: this.version(m.kind, m.value.id) })); }
}

const strip = <T extends { version: number }>(row: T): Omit<T, "version"> => { const { version: _v, ...rest } = row; return rest; };
/** Open, update or leave unchanged the one incident for a job, host and kind. An unchanged signature writes nothing.
 * A new generation is one wake for the maintenance scope, counted against the job's turn budget; an unknown or spent
 * budget holds the wake and raises one budget incident instead. */
function raise(draft: Draft, jobId: string, hostId: string, kind: MaintenanceIncident["kind"], detail: string, occurrence: string | null): string {
  const rows = draft.rowsOf(), signature = digest([kind, detail]);
  const open = rows.incidents.find(i => i.jobId === jobId && i.hostId === hostId && i.kind === kind && i.state === "open");
  if (open?.signature === signature) return open.id;
  const job = draft.get<MaintenanceJob>("maintenance-job", jobId)!, generation = open ? open.generation + 1 : 1;
  const room = kind === "budget" || (job.budget !== null && job.spentTurns < job.budget.turns);
  if (room && kind !== "budget") draft.put<MaintenanceJob>("maintenance-job", { ...strip(job), spentTurns: job.spentTurns + 1 });
  const id = open?.id ?? incidentId(jobId, hostId, kind, rows.incidents.filter(i => i.jobId === jobId && i.hostId === hostId && i.kind === kind).length);
  draft.put<MaintenanceIncident>("maintenance-incident", { id, jobId, hostId, kind, signature, generation, firstOccurrenceId: open ? open.firstOccurrenceId : occurrence,
    lastOccurrenceId: occurrence, detail: detail.slice(0, 500), state: "open", notify: { state: room ? "pending" : "held-budget", generation } });
  if (!room) raise(draft, jobId, "*", "budget", job.budget === null ? "The maintenance wake budget is unknown; incident wakes are held." :
    `The maintenance wake budget of ${job.budget.turns} turns is spent; incident wakes are held.`, occurrence);
  return id;
}
function resolve(draft: Draft, jobId: string, hostId: string, kinds: readonly MaintenanceIncident["kind"][]) {
  for (const i of draft.rowsOf().incidents) if (i.jobId === jobId && i.hostId === hostId && i.state === "open" && kinds.includes(i.kind))
    draft.put<MaintenanceIncident>("maintenance-incident", { ...strip(i), state: "resolved" });
}
function closeIfDone(draft: Draft, occurrenceIdValue: string, at: string) {
  const occurrence = draft.get<Occurrence>("occurrence", occurrenceIdValue)!;
  if (occurrence.state === "open" && occurrence.hosts.every(h => isTerminalHost(draft.get<OccurrenceHost>("occurrence-host", occurrenceHostId(occurrence.id, h))!)))
    draft.put<Occurrence>("occurrence", { ...strip(occurrence), state: "closed", closedAt: at });
}
function setHost(draft: Draft, host: OccurrenceHost, change: Partial<OccurrenceHost>, at: string): OccurrenceHost {
  const next = { ...host, ...change, updatedAt: at };
  if (digest(strip({ ...host, updatedAt: "" })) === digest(strip({ ...next, updatedAt: "" }))) return host;
  return draft.put<OccurrenceHost>("occurrence-host", strip(next));
}
/** Release a pass's reservation from its state after this transaction: on its terminal outcome, or withdrawn when
 * nothing was ever applied under it. Unsettled items, or applied work in an unfinished pass, keep it held. */
function settleReservation(draft: Draft, hostRow: string, actor: SupervisionActor, at: string) {
  const host = draft.get<OccurrenceHost>("occurrence-host", hostRow)!;
  const r = host.reservationId ? draft.get<ResourceReservation>("resource-reservation", host.reservationId) : undefined;
  if (!r || r.state === "released" || r.state === "cancelled" || unsettled(host)) return;
  const kind = host.items.every(i => i.state === "skipped") ? "withdrawn" as const : !isTerminalHost(host) ? null
    : host.state === "failed" || host.items.some(i => i.state === "failed") ? "failed" as const : "succeeded" as const;
  if (!kind) return;
  draft.put<ResourceReservation>("resource-reservation", { ...strip(r), state: r.state === "queued" ? "cancelled" : "released",
    terminal: { kind, evidence: [{ ref: `occurrence-host:${host.id}`, digest: digest(host.items) }], actor, at } });
}

// ---------------------------------------------------------------------------------------------------------------

const Budget = z.object({ turns: z.number().int().min(0).max(1_000_000) }).strict();
export const JobInputSchema = z.object({ jobId: SupervisionUuid, expectedVersion: z.number().int().min(0), scopeId: SupervisionUuid,
  name: z.string().min(1).max(120), domain: z.enum(["host-storage", "workspace-retention"]),
  schedule: z.object({ kind: z.literal("daily"), at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), zone: IanaZone }).strict(),
  hosts: z.array(HostId).min(1).max(32), resource: z.object({ class: ResourceClass, keys: z.array(z.string().min(1).max(300)).min(1).max(8) }).strict(),
  selectors: CleanupSelectors, retained: z.array(z.string().min(1).max(300).refine(retainedEntryValid,
    "A retained entry is an identity, or an absolute canonical path (not ~, relative or drive-relative)")).max(64), mode: z.enum(["observe", "advisory"]),
  legacyTimer: z.object({ kind: z.enum(["native-schedule", "script-watch", "managed-watch", "none"]), id: z.string().min(1).max(300).nullable(),
    disposition: z.enum(["retained", "retired", "unknown"]), evidence: z.array(z.object({ ref: z.string().min(1).max(1024), digest: SupervisionHash }).strict()).max(32) }).strict(),
  budget: Budget.nullable(), maxPasses: z.number().int().min(1).max(6) }).strict();
export const ObserveSchema = z.object({ occurrenceId: SupervisionUuid, hostId: HostId, outcome: z.enum(["completed", "failed", "offline"]),
  detail: z.string().min(1).max(500).refine(s => !/[\x00-\x1f\x7f]/.test(s), "Plain one-line text"), resultDigest: SupervisionHash }).strict();
const SYSTEM: SupervisionActor = { kind: "system", id: "s10-maintenance", source: "supervision-jobs" };
const reviewedActor = (actor: SupervisionActor) => actor.kind === "captain-ui" || actor.kind === "mate-chat";
const commandId = (...parts: unknown[]) => maintenanceRowId("command", ...parts);

export type HostRun = { hostId: string; state: OccurrenceHost["state"] | "blocked" | "unchanged" | "refused"; reason: string | null };
export type TickResult = { jobId: string; plan: TickPlan["kind"] | "refused"; occurrenceId: string | null; wrote: boolean; reason?: string };


export class SupervisionJobs {
  private readonly active = new Set<string>();
  constructor(readonly store: SupervisionStore, private readonly options: { enabled?: boolean; now?: () => string; executor?: MaintenanceExecutor; leaseMs?: number } = {}) {}
  private now() { return this.options.now?.() ?? utc(Date.now()); }
  private enabled() { if (!this.options.enabled) refuse("UNSUPPORTED", "S10 maintenance jobs are disabled."); }
  private async command(requestId: string, input: unknown, actorInput: SupervisionActor, step: Step, prepare: (draft: Draft, actor: SupervisionActor) => void | Promise<void>) {
    this.enabled();
    const actor = structuredClone(SupervisionActorSchema.parse(actorInput));
    let wrote = false;
    try {
      await this.store.transactCommand(requestId, digest(input), actor, async status => {
        const draft = new Draft(status);
        wrote = true;
        if (stepRoom(status, step) === "skip") { wrote = false; throw new Unchanged(); }
        await prepare(draft, actor);
        if (!draft.size) { wrote = false; throw new Unchanged(); }
        return { expectedVersions: draft.expected(), mutations: draft.mutations(), result: emptyResult() };
      });
    } catch (error) { if (!(error instanceof Unchanged)) throw error; }
    return wrote;
  }
  private owner(status: SupervisionStatus, actor: SupervisionActor, scopeId: string) {
    if (!reviewedActor(actor) && !boundTo(status, actor, [scopeId])) refuse("UNKNOWN_OWNER", "Only the maintenance scope's bound owner or the captain acts on this job.");
  }

  /** Define or redefine a job (captain/mate only). A changed schedule, coverage, resource or selector takes the next
   * definition version; already open occurrences keep the version they opened with. */
  async defineJob(requestId: string, actor: SupervisionActor, raw: z.input<typeof JobInputSchema>) {
    const input = JobInputSchema.parse(raw);
    return this.command(requestId, { op: "job", input }, actor, "admission", (draft, a) => {
      if (!reviewedActor(a)) refuse("UNSUPPORTED", "A maintenance job definition is the captain's, recorded through the UI or chat.");
      maintenanceAdmission(draft.status);
      const old = draft.get<MaintenanceJob>("maintenance-job", input.jobId);
      if ((old?.version ?? 0) !== input.expectedVersion) refuse("STALE", "The job changed; reread it.");
      if (draft.status.scopes.find(s => s.id === input.scopeId)?.kind !== "maintenance") refuse("UNKNOWN_OWNER", "A job belongs to a registered maintenance scope.");
      const body = { schedule: input.schedule, hosts: [...input.hosts].sort(), resource: input.resource, selectors: input.selectors, retained: [...input.retained].sort(), catchUp: "one-missed-day" as const, domain: input.domain };
      const changed = !old || digest([old.schedule, old.hosts, old.resource, old.selectors, old.retained, old.catchUp, old.domain]) !==
        digest([body.schedule, body.hosts, body.resource, body.selectors, body.retained, body.catchUp, body.domain]);
      const next = { id: input.jobId, scopeId: input.scopeId, name: input.name.trim(), ...body, definitionVersion: (old?.definitionVersion ?? 0) + (changed ? 1 : 0),
        mode: input.mode, state: old?.state ?? "dormant" as const, activeSince: old?.activeSince ?? null, legacyTimer: input.legacyTimer, budget: input.budget,
        spentTurns: old?.spentTurns ?? 0, maxPasses: input.maxPasses, provenance: a };
      if (old && digest({ ...strip(old), provenance: null }) === digest({ ...next, provenance: null })) refuse("CONFLICT", "The job is unchanged.");
      draft.put<MaintenanceJob>("maintenance-job", next);
    });
  }
  /** Activate or stop a job. Stopping is always allowed and exempt: no new occurrences; open passes keep their
   * reservations, items and receipts. Restarting an old timer is never part of this; it needs its own reconciliation. */
  async setState(requestId: string, actor: SupervisionActor, raw: { jobId: string; expectedVersion: number; state: "active" | "stopped" }) {
    return this.command(requestId, { op: "job-state", raw }, actor, raw.state === "active" ? "admission" : "settlement", (draft, a) => {
      const job = draft.get<MaintenanceJob>("maintenance-job", raw.jobId);
      if (!job) refuse("UNKNOWN_OWNER", "Unknown job.");
      this.owner(draft.status, a, job.scopeId);
      if (job.version !== raw.expectedVersion) refuse("STALE", "The job changed; reread it.");
      if (raw.state === "active" && !reviewedActor(a)) refuse("UNSUPPORTED", "Activating a maintenance job is the captain's.");
      if (raw.state === "active") maintenanceAdmission(draft.status);
      if (job.state === raw.state) refuse("CONFLICT", `The job is already ${raw.state}.`);
      draft.put<MaintenanceJob>("maintenance-job", { ...strip(job), state: raw.state, activeSince: job.activeSince ?? (raw.state === "active" ? this.now() : null) });
      // Rollback: passes with nothing unsettled are covered by the stop and release what they hold. A pass this
      // process is running, or one with dispatched or uncertain items, keeps its reservation and receipts.
      if (raw.state === "stopped") for (const o of maintenanceRows(draft.status).occurrences.filter(x => x.jobId === job.id && x.state === "open")) {
        for (const hostId of o.hosts) {
          const h = draft.get<OccurrenceHost>("occurrence-host", occurrenceHostId(o.id, hostId))!;
          if (isTerminalHost(h) || unsettled(h) || this.active.has(h.id)) continue;
          setHost(draft, h, { state: "superseded", reason: "The job was stopped." }, this.now());
          settleReservation(draft, h.id, a, this.now());
        }
        closeIfDone(draft, o.id, this.now());
      }
    });
  }

  /** One scheduler tick. A due date opens exactly one occurrence with every covered host pending; ticking again, or
   * from a second process, replays the same command and writes nothing. Nothing due writes nothing. */
  async tick(now = this.now()): Promise<TickResult[]> {
    this.enabled(); SupervisionUtc.parse(now);
    const status = await this.store.read(), out: TickResult[] = [];
    for (const job of maintenanceRows(status).jobs) {
      const plan = planTick(job, maintenanceRows(status).occurrences, Date.parse(now));
      if (plan.kind !== "open") { out.push({ jobId: job.id, plan: plan.kind, occurrenceId: plan.kind === "duplicate" ? plan.occurrenceId : null, wrote: false }); continue; }
      // The command ID is the occurrence identity: a duplicate or concurrent tick replays it, never a second open.
      // One job's refusal (the admission ceiling, a changed schedule) never stops another job's tick.
      let wrote: boolean;
      try { wrote = await this.command(commandId("open", plan.occurrence.id), { op: "open", id: plan.occurrence.id }, SYSTEM, "admission", draft => {
        maintenanceAdmission(draft.status);
        const current = draft.get<MaintenanceJob>("maintenance-job", job.id)!, again = planTick(current, maintenanceRows(draft.status).occurrences, Date.parse(now));
        if (again.kind !== "open" || again.occurrence.id !== plan.occurrence.id) refuse("STALE", "The schedule changed while ticking; tick again.");
        // An earlier pass with nothing in flight is covered by the new day; one with unsettled items stays open.
        for (const prior of maintenanceRows(draft.status).occurrences.filter(o => o.jobId === job.id && o.state === "open")) {
          for (const hostId of prior.hosts) {
            const host = draft.get<OccurrenceHost>("occurrence-host", occurrenceHostId(prior.id, hostId))!;
            // A pass left running by a crash with nothing unsettled is covered too, unless this process is running it.
            if ((["pending", "deferred", "offline"].includes(host.state) || (host.state === "running" && !this.active.has(host.id))) && !unsettled(host)) {
              setHost(draft, host, { state: "superseded", reason: `Covered by the ${again.occurrence.localDate} occurrence.` }, now);
              settleReservation(draft, host.id, SYSTEM, now);
            }
          }
          closeIfDone(draft, prior.id, now);
        }
        draft.put<Occurrence>("occurrence", { ...again.occurrence, openedAt: now });
        for (const hostId of again.occurrence.hosts) draft.put<OccurrenceHost>("occurrence-host", { id: occurrenceHostId(again.occurrence.id, hostId), occurrenceId: again.occurrence.id,
          jobId: job.id, hostId, state: "pending", passes: 0, reservationId: null, items: [], excluded: 0, triage: 0, reason: null, incidentId: null, resultDigest: null, updatedAt: now });
      }); } catch (error) {
        out.push({ jobId: job.id, plan: "refused", occurrenceId: plan.occurrence.id, wrote: false, reason: String(error instanceof Error ? error.message : error).slice(0, 500) });
        continue;
      }
      out.push({ jobId: job.id, plan: "open", occurrenceId: plan.occurrence.id, wrote });
    }
    return out;
  }

  /** Observe mode: record what the existing timer reported for one host. Unchanged failures and outages write no incident. */
  async observe(requestId: string, actor: SupervisionActor, raw: z.input<typeof ObserveSchema>) {
    const input = ObserveSchema.parse(raw), at = this.now();
    return this.command(requestId, { op: "observe", input }, actor, "closure", (draft, a) => {
      const host = draft.get<OccurrenceHost>("occurrence-host", occurrenceHostId(input.occurrenceId, input.hostId));
      if (!host) refuse("UNKNOWN_OWNER", "That host is not covered by this occurrence.");
      const job = draft.get<MaintenanceJob>("maintenance-job", host.jobId)!;
      this.owner(draft.status, a, job.scopeId);
      if (job.mode !== "observe") refuse("CONFLICT", "An advisory job records its own passes.");
      if (isTerminalHost(host)) refuse("CONFLICT", "This host pass is finished.");
      // A repeated report of the same state writes nothing, whatever its digest: at most two writes per host per day.
      if (host.state === input.outcome) return;
      let incident: string | null = null;
      if (input.outcome === "completed") resolve(draft, job.id, input.hostId, ["failure", "offline"]);
      else incident = raise(draft, job.id, input.hostId, input.outcome === "offline" ? "offline" : "failure", input.detail, input.occurrenceId);
      if (input.outcome === "failed") resolve(draft, job.id, input.hostId, ["offline"]);
      setHost(draft, host, { state: input.outcome, passes: input.outcome === "offline" ? host.passes : host.passes + 1, reason: input.detail, incidentId: incident, resultDigest: input.resultDigest }, at);
      closeIfDone(draft, input.occurrenceId, at);
    });
  }

  /** Advisory mode: run or resume one host's pass. Reserves the job's resources all-or-none, plans within selectors,
   * writes items as dispatched before applying them, and never dispatches an item twice. */
  async runHost(occurrence: string, hostId: string): Promise<HostRun> {
    this.enabled();
    const executor = this.options.executor;
    if (!executor) refuse("UNSUPPORTED", "No maintenance executor is installed; shared effects need a qualified receiver (S11).");
    const rowId = occurrenceHostId(occurrence, hostId);
    if (this.active.has(rowId)) return { hostId, state: "blocked", reason: "This pass is already running in this process." };
    this.active.add(rowId);
    try { return await this.pass(executor, occurrence, hostId, rowId); } finally { this.active.delete(rowId); }
  }
  private async pass(executor: MaintenanceExecutor, occurrence: string, hostId: string, rowId: string): Promise<HostRun> {
    const read = async () => maintenanceRows(await this.store.read()).hosts.find(h => h.id === rowId);
    let host = await read();
    if (!host) refuse("UNKNOWN_OWNER", "That host is not covered by this occurrence.");
    if (isTerminalHost(host)) return { hostId, state: host.state, reason: host.reason };
    const status = await this.store.read(), job = maintenanceRows(status).jobs.find(j => j.id === host!.jobId)!;
    if (job.mode !== "advisory" || job.state !== "active") return { hostId, state: "blocked", reason: `The job is ${job.state} in ${job.mode} mode.` };
    const older = maintenanceRows(status).hosts.find(h => h.jobId === job.id && h.hostId === hostId && h.id !== rowId && !isTerminalHost(h) &&
      maintenanceRows(status).occurrences.find(o => o.id === h.occurrenceId)!.dueAt < maintenanceRows(status).occurrences.find(o => o.id === occurrence)!.dueAt);
    if (older) return { hostId, state: "blocked", reason: "An earlier pass on this host is unfinished; it resumes first." };
    const at = () => this.now();
    // A pass found running with dispatched items was interrupted (this process holds no run for it): never reapply them.
    if (host.state === "running") await this.command(randomUUID(), { op: "interrupted", rowId, version: host.version }, SYSTEM, "settlement", draft => {
      const h = draft.get<OccurrenceHost>("occurrence-host", rowId)!;
      const items = h.items.map(i => i.state === "dispatched" ? { ...i, state: "uncertain" as const } : i);
      const incident = items.some(i => i.state === "uncertain") ? raise(draft, job.id, hostId, "uncertain", `${unsettled({ items })} items were dispatched without a recorded result.`, occurrence) : h.incidentId;
      setHost(draft, h, { state: "deferred", items, reason: "Interrupted pass; dispatched items are uncertain.", incidentId: incident }, at());
    });
    // Uncertain items hold the host (and its reservation) until receiver evidence settles them: no pass is spent
    // retrying, and nothing new is applied beside an effect whose outcome is unknown.
    host = await read();
    if (unsettled(host!)) return { hostId, state: "blocked", reason: "Uncertain items await reconciliation with receiver evidence." };
    let probe: "online" | "offline";
    try { probe = await executor.probe(hostId); } catch { probe = "offline"; }
    if (probe === "offline") {
      await this.command(randomUUID(), { op: "offline", rowId }, SYSTEM, "relabel", draft => {
        const h = draft.get<OccurrenceHost>("occurrence-host", rowId)!;
        const incident = raise(draft, job.id, hostId, "offline", "The host did not answer; its pass waits and coverage stays.", occurrence);
        setHost(draft, h, { state: "offline", reason: "Host unreachable.", incidentId: incident }, at());
      });
      return { hostId, state: "offline", reason: "Host unreachable." };
    }
    // Start the pass: one counted pass, holding the job's resources for this host, or deferred while they are busy.
    let started = false;
    await this.command(randomUUID(), { op: "start", rowId }, SYSTEM, "closure", draft => {
      const h = draft.get<OccurrenceHost>("occurrence-host", rowId)!;
      if (h.passes >= job.maxPasses) {
        const incident = raise(draft, job.id, hostId, "failure", `The pass budget of ${job.maxPasses} passes is spent.`, occurrence);
        setHost(draft, h, { state: "failed", reason: "Pass budget spent.", incidentId: incident }, at());
        settleReservation(draft, rowId, SYSTEM, at());
        closeIfDone(draft, occurrence, at()); return;
      }
      const rows = draft.rowsOf().reservations, held = h.reservationId ? rows.find(r => r.id === h.reservationId) : undefined;
      let reservation = held && !["released", "cancelled"].includes(held.state) ? held : undefined;
      if (!reservation) {
        maintenanceAdmission(draft.status);
        const keys = [...new Set(job.resource.keys.map(k => k.replaceAll("{host}", hostId)))].sort();
        const id = hostReservationId(`${rowId}:${h.passes + 1}`);
        const base = { id, scopeId: job.scopeId, holder: { kind: "occurrence-host" as const, id: rowId }, class: job.resource.class, keys, priority: 5,
          queuedAt: draft.status.sequence + 1, lease: null, enforcement: "advisory" as const, terminal: null, provenance: SYSTEM };
        reservation = draft.put<ResourceReservation>("resource-reservation", grantable(rows, base).ok ? { ...base, state: "granted", fences: nextFences(rows, keys) } : { ...base, state: "queued", fences: [] });
      } else if (reservation.state === "queued" && grantable(rows, reservation).ok) {
        maintenanceAdmission(draft.status);
        reservation = draft.put<ResourceReservation>("resource-reservation", { ...strip(reservation), state: "granted", fences: nextFences(rows, reservation.keys) });
      }
      if (reservation.state === "queued") {
        // Waiting is a relabel: past the admission ceiling it writes nothing.
        if (stepRoom(draft.status, "relabel") === "write")
          setHost(draft, h, { state: "deferred", reservationId: reservation.id, reason: "Waiting for resources held by conflicting work." }, at());
        return;
      }
      started = true;
      setHost(draft, h, { state: "running", passes: h.passes + 1, reservationId: reservation.id, reason: null }, at());
    });
    host = await read();
    if (!started) return { hostId, state: host!.state === "deferred" ? "deferred" : host!.state, reason: host!.reason };
    const fences = maintenanceRows(await this.store.read()).reservations.find(r => r.id === host!.reservationId)!.fences;
    // Plan. An incomplete listing or retained set defers the pass with nothing dispatched.
    let plan: ReturnType<typeof planCleanup>;
    try { plan = planCleanup(job, hostId, await executor.inventory(hostId), await executor.retained(hostId)); }
    catch (error) {
      await this.command(randomUUID(), { op: "incomplete", rowId }, SYSTEM, "closure", draft => {
        const h = draft.get<OccurrenceHost>("occurrence-host", rowId)!;
        setHost(draft, h, { state: "deferred", reason: `Inventory incomplete; nothing dispatched. ${String(error).slice(0, 300)}` }, at());
        settleReservation(draft, rowId, SYSTEM, at());
      });
      return { hostId, state: "deferred", reason: "Inventory incomplete." };
    }
    const seen = new Set(host!.items.map(i => i.key)), pending = plan.selected.filter(s => !seen.has(s.key)).slice(0, 64);
    let held = true;
    if (pending.length) await this.command(randomUUID(), { op: "dispatch", rowId, keys: pending.map(p => p.key) }, SYSTEM, "closure", draft => {
      const h = draft.get<OccurrenceHost>("occurrence-host", rowId)!;
      // Reread under the journal lock: dispatch only while this pass still runs under the same held reservation.
      const r = h.reservationId ? draft.get<ResourceReservation>("resource-reservation", h.reservationId) : undefined;
      if (h.state !== "running" || !r || !["granted", "suspect"].includes(r.state) || digest(r.fences) !== digest(fences)) { held = false; return; }
      setHost(draft, h, { items: [...h.items, ...pending.map(p => ({ key: p.key, state: "dispatched" as const }))], excluded: plan.excluded, triage: plan.triage }, at());
    });
    if (!held) return { hostId, state: "blocked", reason: "The pass no longer holds its reservation; nothing was dispatched." };
    let results: { key: string; outcome: "done" | "failed" }[] | null = [];
    try { if (pending.length) results = await executor.apply(hostId, pending, fences); } catch { results = null; }
    // Finish: settle every item, then complete, fail or wait on the uncertain ones (which keep the reservation).
    await this.command(randomUUID(), { op: "finish", rowId }, SYSTEM, "settlement", draft => {
      const h = draft.get<OccurrenceHost>("occurrence-host", rowId)!;
      const outcome = new Map((results ?? []).map(r => [r.key, r.outcome]));
      const items = h.items.map(i => i.state === "dispatched" ? { ...i, state: outcome.get(i.key) ?? "uncertain" as const } : i);
      const uncertain = items.filter(i => i.state === "uncertain").length, failed = items.filter(i => i.state === "failed").length;
      const triage = plan.triage ? raise(draft, job.id, hostId, "triage", `${plan.triage} candidates have no known owner and were left for triage.`, occurrence) : null;
      if (!plan.triage) resolve(draft, job.id, hostId, ["triage"]);
      const base = { items, excluded: plan.excluded, triage: plan.triage, resultDigest: digest(items) };
      if (results === null || uncertain) {
        const incident = raise(draft, job.id, hostId, "uncertain", `${uncertain} items were dispatched without a recorded result.`, occurrence);
        setHost(draft, h, { ...base, state: results === null ? "offline" : "deferred", reason: "Uncertain items keep the reservation until reconciled.", incidentId: incident }, at());
        return;
      }
      if (failed) {
        const incident = raise(draft, job.id, hostId, "failure", `${failed} items failed.`, occurrence);
        setHost(draft, h, { ...base, state: "failed", reason: `${failed} items failed.`, incidentId: incident }, at());
        settleReservation(draft, rowId, SYSTEM, at());
      } else {
        resolve(draft, job.id, hostId, ["failure", "offline", "uncertain"]);
        setHost(draft, h, { ...base, state: "completed", reason: null, incidentId: triage }, at());
        settleReservation(draft, rowId, SYSTEM, at());
      }
      closeIfDone(draft, occurrence, at());
    });
    host = await read();
    return { hostId, state: host!.state, reason: host!.reason };
  }

  /** Settle uncertain items from recorded receiver evidence (captain/mate only). Nothing is reapplied automatically. */
  async reconcileItems(requestId: string, actor: SupervisionActor, raw: { occurrenceId: string; hostId: string; expectedVersion: number;
    items: { key: string; outcome: "done" | "failed" }[]; evidence: { ref: string; digest: string }[] }) {
    return this.command(requestId, { op: "reconcile", raw }, actor, "settlement", (draft, a) => {
      if (!reviewedActor(a)) refuse("UNSUPPORTED", "Settling an uncertain effect needs recorded captain or mate evidence.");
      if (!raw.evidence.length) refuse("HELD", "Settling an uncertain item needs evidence.");
      const h = draft.get<OccurrenceHost>("occurrence-host", occurrenceHostId(raw.occurrenceId, raw.hostId));
      if (!h || h.version !== raw.expectedVersion) refuse("STALE", "The host pass changed; reread it.");
      const settle = new Map(raw.items.map(i => [i.key, i.outcome]));
      if ([...settle.keys()].some(k => h.items.find(i => i.key === k)?.state !== "uncertain")) refuse("CONFLICT", "Only uncertain items are reconciled.");
      setHost(draft, h, { items: h.items.map(i => settle.has(i.key) ? { ...i, state: settle.get(i.key)! } : i) }, this.now());
    });
  }
  /** The maintenance scope's owner has read this incident generation. */
  async acknowledge(requestId: string, actor: SupervisionActor, raw: { incidentId: string; generation: number }) {
    return this.command(requestId, { op: "ack", raw }, actor, "settlement", (draft, a) => {
      const i = draft.get<MaintenanceIncident>("maintenance-incident", raw.incidentId);
      if (!i) refuse("UNKNOWN_OWNER", "Unknown incident.");
      this.owner(draft.status, a, draft.get<MaintenanceJob>("maintenance-job", i.jobId)!.scopeId);
      if (i.notify.generation !== raw.generation || i.notify.state !== "pending") refuse("STALE", "That wake is not pending at this generation.");
      draft.put<MaintenanceIncident>("maintenance-incident", { ...strip(i), notify: { state: "handled", generation: i.notify.generation } });
    });
  }
  /** Tick, then run or resume every unfinished host pass of open occurrences (advisory jobs). One offline host never
   * stops the others. A pass that is still offline or still waiting writes nothing. */
  async drive(now = this.now()) {
    const ticks = await this.tick(now), runs: HostRun[] = [];
    const rows = maintenanceRows(await this.store.read());
    for (const o of rows.occurrences.filter(x => x.state === "open").sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
      const job = rows.jobs.find(j => j.id === o.jobId)!;
      if (job.mode !== "advisory" || job.state !== "active") continue;
      // One refused host (a store refusal, the admission ceiling) never stops the others.
      for (const hostId of o.hosts) runs.push(await this.runHost(o.id, hostId).catch((error: unknown) =>
        ({ hostId, state: "refused" as const, reason: String(error instanceof Error ? error.message : error).slice(0, 500) })));
    }
    return { ticks, runs };
  }
  async summary(): Promise<MaintenanceSummary> { this.enabled(); return maintenanceSummary(await this.store.read()); }
}
class Unchanged extends Error {}

/** The maintenance scope's wake for one incident generation, rendered from `templates/messages/maintenance-incident.md`.
 * Only pending notifications render; General is never a recipient. */
export async function maintenanceIncidentNote(job: MaintenanceJob, incident: MaintenanceIncident): Promise<string | null> {
  if (incident.notify.state !== "pending" || incident.state !== "open") return null;
  return message(TEMPLATES.maintenanceIncident, { contextJson: JSON.stringify({ kind: "maintenance-incident", jobId: job.id, job: job.name, scopeId: job.scopeId,
    incidentId: incident.id, hostId: incident.hostId, incident: incident.kind, generation: incident.generation, detail: incident.detail,
    lastOccurrenceId: incident.lastOccurrenceId }, null, 2) });
}

// ---------------------------------------------------------------------------------------------------------------
// Timer disposition inventory. Pure and read-only: it creates, pauses, enables or replaces nothing.

export interface TimerInventoryInput {
  scripts: readonly { name: string; scheduleText: string | null; invalid: string | null }[];
  disabledWatches: readonly string[];
  managed: readonly { name: string; schedule: string; enabled: boolean }[];
  native: NativeTimerInventory;
  mateAgentId: string;
  jobs: readonly MaintenanceJob[];
  /** SHA-256 of watch-config.json's bytes (null when absent). */
  configFingerprint: string | null;
}
export interface TimerRow {
  id: string; kind: "script-watch" | "managed-watch" | "native-schedule" | "native-heartbeat" | "plugin-interval";
  name: string; schedule: string; zone: string; enabled: boolean; owner: "plugin" | "first-mate" | "unknown";
  disposition: "legacy-retained" | "disabled-retained" | "invalid-retained" | "held-unknown-owner" | "observed-by-job" | "retired-by-job" | "plugin-internal";
  jobId: string | null;
}
export interface TimerInventory {
  format: "firstmate.timer-inventory/1"; complete: boolean; rows: TimerRow[]; problems: string[];
  /** Before/after comparison (A17.preserve): unchanged hashes mean unchanged enabled state, schedules and coverage. */
  hashes: { config: string; timers: string; coverage: string };
}
/** The plugin's own clocks. They deliver nothing by themselves and are never maintenance jobs. */
export const PLUGIN_TIMERS: readonly Omit<TimerRow, "disposition" | "jobId">[] = [
  { id: "plugin:watch-runner", kind: "plugin-interval", name: "watch-runner", schedule: "every minute boundary", zone: "daemon-local", enabled: true, owner: "plugin" },
  { id: "plugin:watch-prompts", kind: "plugin-interval", name: "watch-prompts", schedule: "every 15 s", zone: "interval", enabled: true, owner: "plugin" },
  { id: "plugin:mate-notes", kind: "plugin-interval", name: "mate-notes", schedule: "every 15 s", zone: "interval", enabled: true, owner: "plugin" },
];
export function timerInventory(input: TimerInventoryInput): TimerInventory {
  const off = new Set(input.disabledWatches), rows: TimerRow[] = [], problems: string[] = [];
  const legacy = (kind: MaintenanceJob["legacyTimer"]["kind"], id: string) => input.jobs.find(j => j.legacyTimer.kind === kind && j.legacyTimer.id === id && j.state !== "stopped");
  const linked = (row: Omit<TimerRow, "disposition" | "jobId">, kind: MaintenanceJob["legacyTimer"]["kind"], id: string, otherwise: TimerRow["disposition"]): TimerRow => {
    const job = legacy(kind, id);
    if (!job) return { ...row, disposition: otherwise, jobId: null };
    if (job.mode === "advisory" && job.state === "active" && row.enabled) problems.push(`Duplicate cleaner: job ${JSON.stringify(job.name)} runs beside its enabled legacy timer ${JSON.stringify(row.name)}.`);
    return { ...row, disposition: job.legacyTimer.disposition === "retired" ? "retired-by-job" : "observed-by-job", jobId: job.id };
  };
  for (const s of input.scripts) {
    const enabled = !off.has(s.name);
    rows.push(linked({ id: `script:${s.name}`, kind: "script-watch", name: s.name, schedule: s.scheduleText ?? "(none)", zone: "daemon-local", enabled, owner: "plugin" },
      "script-watch", s.name, s.invalid !== null ? "invalid-retained" : enabled ? "legacy-retained" : "disabled-retained"));
  }
  for (const w of input.managed) rows.push(linked({ id: `managed:${w.name}`, kind: "managed-watch", name: w.name, schedule: w.schedule, zone: "daemon-local",
    enabled: w.enabled, owner: "plugin" }, "managed-watch", w.name, w.enabled ? "legacy-retained" : "disabled-retained"));
  if (input.native.complete) for (const n of input.native.schedules) {
    const heartbeat = n.cadence.type === "every" && n.target.type === "agent";
    const owner = n.target.type === "agent" && n.target.agentId === input.mateAgentId && input.mateAgentId !== "" ? "first-mate" as const : "unknown" as const;
    const enabled = n.status === "active";
    rows.push(linked({ id: `native:${n.id}`, kind: heartbeat ? "native-heartbeat" : "native-schedule", name: n.name ?? n.id,
      schedule: n.cadence.type === "cron" ? n.cadence.expression : `every ${n.cadence.everyMs} ms`, zone: n.cadence.type === "cron" ? n.cadence.timezone ?? "daemon-local" : "interval",
      enabled, owner }, "native-schedule", n.id, owner === "unknown" ? "held-unknown-owner" : enabled ? "legacy-retained" : "disabled-retained"));
  } else problems.push(input.native.reason);
  for (const t of PLUGIN_TIMERS) rows.push({ ...t, disposition: "plugin-internal", jobId: null });
  for (const job of input.jobs) if (job.legacyTimer.kind !== "none" && job.state !== "stopped" &&
    !rows.some(r => r.jobId === job.id) && (job.legacyTimer.kind !== "native-schedule" || input.native.complete))
    problems.push(`Job ${JSON.stringify(job.name)} names legacy timer ${JSON.stringify(job.legacyTimer.id)}, which the inventory does not contain.`);
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return { format: "firstmate.timer-inventory/1", complete: input.native.complete, rows, problems,
    hashes: { config: digest([[...input.disabledWatches].sort(), input.managed, input.configFingerprint]),
      timers: digest(rows.map(r => [r.id, r.schedule, r.zone, r.enabled, r.owner])),
      coverage: digest([rows.map(r => [r.id, r.enabled]), [...input.jobs].sort((a, b) => a.id.localeCompare(b.id)).map(j => [j.id, j.hosts, j.state])]) } };
}
