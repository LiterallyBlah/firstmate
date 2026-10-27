/** S10 resources, maintenance jobs and durable daily occurrences. Disabled: nothing here routes, sends, deletes or wakes.
 * Reservations are advisory (cooperative); a receiver that enforces fences is S11's, never assumed here.
 */
import { z } from "zod";
import { SupervisionActorSchema, SupervisionHash, SupervisionUtc, SupervisionUuid, type SupervisionStatus } from "./supervision";

const version = z.number().int().positive();
const count = z.number().int().min(0).max(1_000_000);
const text = (max = 256) => z.string().min(1).max(max).refine(s => !!s.trim() && !/[\x00-\x1f\x7f]/.test(s), "Plain one-line text");
const unique = <T extends z.ZodType>(schema: T, min: number, max: number) => z.array(schema).min(min).max(max)
  .refine(v => new Set(v).size === v.length, "Repeated identity");
const reviewed = SupervisionActorSchema.refine(a => a.kind === "captain-ui" || a.kind === "mate-chat", "Explicit captain or mate-recorded provenance required");
const Evidence = z.array(z.object({ ref: text(1024), digest: SupervisionHash }).strict()).max(32);
const segment = "[A-Za-z0-9._-]{1,80}";
/** The plan's resource key families. A key names one shared thing on one host; the same key is the same resource. */
export const ResourceKey = z.string().max(300).regex(new RegExp(`^(host:${segment}:cache|deploy:${segment}:${segment}|db:${segment}:${segment}|browser:${segment}|` +
  `workspace:${segment}:${segment}|branch:${segment}:${segment}:[A-Za-z0-9._/-]{1,120})$`));
export const HostId = z.string().regex(new RegExp(`^${segment}$`));
/** Build/read share a resource; cleanup, deploy and migrate need it alone. */
export const ResourceClass = z.enum(["build", "read", "cleanup", "deploy", "migrate"]);
export type ResourceClass = z.infer<typeof ResourceClass>;
export const resourceMode = (kind: ResourceClass): "shared" | "exclusive" => kind === "build" || kind === "read" ? "shared" : "exclusive";
export const compatible = (a: ResourceClass, b: ResourceClass) => resourceMode(a) === "shared" && resourceMode(b) === "shared";
export const LocalDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
/** IANA zone accepted by this runtime's Intl. An unknown zone is refused, never silently read as UTC or daemon-local. */
export const IanaZone = z.string().min(1).max(64).refine(zone => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return zone !== "" && !/^[+-]/.test(zone); } catch { return false; }
}, "Unknown IANA time zone");

/** One all-or-none claim on sorted resource keys. Expiry marks it suspect and never releases it; release needs terminal evidence. */
export const ResourceReservationSchema = z.object({
  id: SupervisionUuid, version, scopeId: SupervisionUuid,
  holder: z.discriminatedUnion("kind", [z.object({ kind: z.literal("effect"), id: SupervisionUuid }).strict(),
    z.object({ kind: z.literal("occurrence-host"), id: SupervisionUuid }).strict()]),
  class: ResourceClass, keys: unique(ResourceKey, 1, 32).refine(v => v.every((k, i) => i === 0 || v[i - 1]! < k), "Keys are acquired in sorted order"),
  priority: z.number().int().min(1).max(9),
  /** Journal sequence when first requested: FIFO order within a priority. Immutable. */
  queuedAt: version,
  state: z.enum(["queued", "granted", "suspect", "released", "cancelled"]),
  /** One monotonic fence per key, issued at grant and never reissued. Empty while queued or if never granted. */
  fences: z.array(z.object({ key: ResourceKey, fence: version }).strict()).max(32),
  lease: z.object({ expiresAt: SupervisionUtc }).strict().nullable(),
  /** Cooperative arbitration only. Human/native actors can bypass it; strong mode needs every writer or receiver to enforce fences. */
  enforcement: z.literal("advisory"),
  terminal: z.object({ kind: z.enum(["succeeded", "failed", "not-admitted", "withdrawn"]), evidence: Evidence,
    actor: SupervisionActorSchema, at: SupervisionUtc }).strict().nullable(),
  provenance: SupervisionActorSchema,
}).strict()
  .refine(r => (r.state === "released" || r.state === "cancelled") === (r.terminal !== null), "A released or cancelled reservation records terminal evidence.")
  .refine(r => r.state === "queued" || r.state === "cancelled" ? r.fences.length === 0 : r.fences.length === r.keys.length &&
    r.fences.every((f, i) => f.key === r.keys[i]), "A granted reservation holds exactly one fence per key.");
export type ResourceReservation = z.infer<typeof ResourceReservationSchema>;

/** Path helpers shared by the selector schema and `planCleanup`. Paths are compared by whole segment, `\` read as `/`. */
export const normalPath = (p: string) => p.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
export const absolutePath = (p: string) => /^(\/|[A-Za-z]:\/)/.test(p);
const badSegment = (s: string) => s === "" || s === "." || s === "..";
export const pathSegmentsValid = (p: string) => normalPath(p).split("/").slice(1).every(s => !badSegment(s));
export const cacheLabelValid = (c: string) => c.split("/").every(s => !badSegment(s));
/** A path-prefix selector is an absolute directory below a root. A cache-prefix selector only narrows path selectors by
 * whole cache-label segments; it never admits a path on its own. */
export const CleanupSelector = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("path-prefix"), value: text(512).refine(v => absolutePath(normalPath(v)) && pathSegmentsValid(v) && normalPath(v).split("/").filter(Boolean).length >= (/^[A-Za-z]:/.test(v) ? 2 : 1),
    "An absolute directory below the root, without empty, . or .. segments") }).strict(),
  z.object({ kind: z.literal("cache-prefix"), value: text(512).refine(v => cacheLabelValid(v.replace(/\/+$/, "")), "Whole cache-label segments, without . or ..") }).strict(),
]);
export const CleanupSelectors = z.array(CleanupSelector).min(1).max(16).refine(v => v.some(x => x.kind === "path-prefix"), "At least one path-prefix selector bounds every cleanup.");
/** A deterministic maintenance job. Its occurrences are keyed by (job, IANA zone, local date) under D5 option 1. */
export const MaintenanceJobSchema = z.object({
  id: SupervisionUuid, version, scopeId: SupervisionUuid, name: text(120), domain: z.enum(["host-storage", "workspace-retention"]),
  /** Bumps on any schedule, coverage, resource or selector change; occurrences record the version they ran. */
  definitionVersion: version,
  schedule: z.object({ kind: z.literal("daily"), at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), zone: IanaZone }).strict(),
  /** The covered host set, offline hosts included. Coverage is never narrowed by an outage. */
  hosts: unique(HostId, 1, 32),
  resource: z.object({ class: ResourceClass, keys: unique(z.string().min(1).max(300), 1, 8) }).strict()
    .refine(r => r.keys.every(k => ResourceKey.safeParse(k.replaceAll("{host}", "h")).success), "Resource templates expand to resource keys."),
  /** Cleanup never reaches past these selectors; retained volumes/worktrees are excluded even inside them. */
  selectors: CleanupSelectors,
  retained: unique(text(300), 0, 64),
  catchUp: z.literal("one-missed-day"),
  /** observe: records the existing timer's reported runs. advisory: the job drives passes through an executor. */
  mode: z.enum(["observe", "advisory"]), state: z.enum(["dormant", "active", "stopped"]),
  /** First activation instant. Due times before it are never caught up. */
  activeSince: SupervisionUtc.nullable(),
  legacyTimer: z.object({ kind: z.enum(["native-schedule", "script-watch", "managed-watch", "none"]), id: text(300).nullable(),
    disposition: z.enum(["retained", "retired", "unknown"]), evidence: Evidence }).strict(),
  /** Maintenance-supervisor wakes. Null is unknown: no wake is ever admitted against it, and it never reads as zero. */
  budget: z.object({ turns: count }).strict().nullable(), spentTurns: count,
  maxPasses: z.number().int().min(1).max(6), provenance: reviewed,
}).strict()
  .refine(j => (j.state === "dormant") === (j.activeSince === null) || j.state === "stopped", "An active job records when it was first activated.")
  .refine(j => j.legacyTimer.kind === "none" ? j.legacyTimer.id === null : j.legacyTimer.id !== null, "A legacy timer link names its timer.");
export type MaintenanceJob = z.infer<typeof MaintenanceJobSchema>;

export const OccurrenceSchema = z.object({
  id: SupervisionUuid, version, jobId: SupervisionUuid, definitionVersion: version, zone: IanaZone, localDate: LocalDate,
  dueAt: SupervisionUtc, openedAt: SupervisionUtc, trigger: z.enum(["scheduled", "catch-up"]),
  /** The single missed-day observation: earlier due dates that were not run and are never run separately. */
  missed: z.object({ dates: z.array(LocalDate).max(31), count }).strict(),
  hosts: unique(HostId, 1, 32), state: z.enum(["open", "closed"]), closedAt: SupervisionUtc.nullable(),
}).strict().refine(o => (o.state === "closed") === (o.closedAt !== null), "A closed occurrence records when.")
  .refine(o => o.missed.dates.length <= o.missed.count && o.missed.dates.every(d => d < o.localDate), "Missed dates precede the occurrence.");
export type Occurrence = z.infer<typeof OccurrenceSchema>;

export const HostItemSchema = z.object({ key: SupervisionHash, state: z.enum(["dispatched", "done", "failed", "uncertain", "skipped"]) }).strict();
export const OccurrenceHostSchema = z.object({
  id: SupervisionUuid, version, occurrenceId: SupervisionUuid, jobId: SupervisionUuid, hostId: HostId,
  state: z.enum(["pending", "running", "deferred", "offline", "completed", "failed", "superseded"]),
  passes: count, reservationId: SupervisionUuid.nullable(),
  /** Write-ahead item ledger: an item is dispatched before it is applied, and never dispatched twice. */
  items: z.array(HostItemSchema).max(256).refine(v => new Set(v.map(i => i.key)).size === v.length, "Repeated item"),
  excluded: count, triage: count, reason: text(500).nullable(), incidentId: SupervisionUuid.nullable(),
  resultDigest: SupervisionHash.nullable(), updatedAt: SupervisionUtc,
}).strict();
export type OccurrenceHost = z.infer<typeof OccurrenceHostSchema>;
export const TERMINAL_HOST = ["completed", "failed", "superseded"] as const;
export const isTerminalHost = (h: Pick<OccurrenceHost, "state">) => (TERMINAL_HOST as readonly string[]).includes(h.state);
export const unsettled = (h: Pick<OccurrenceHost, "items">) => h.items.filter(i => i.state === "dispatched" || i.state === "uncertain").length;

/** One open incident per job, host and kind. An unchanged signature writes nothing and wakes nobody. */
export const MaintenanceIncidentSchema = z.object({
  id: SupervisionUuid, version, jobId: SupervisionUuid, hostId: z.union([HostId, z.literal("*")]),
  kind: z.enum(["failure", "offline", "uncertain", "triage", "budget"]), signature: SupervisionHash, generation: version,
  firstOccurrenceId: SupervisionUuid.nullable(), lastOccurrenceId: SupervisionUuid.nullable(), detail: text(500),
  state: z.enum(["open", "resolved"]),
  /** The maintenance scope's wake for this generation. General is never woken; it reads status on demand. */
  notify: z.object({ state: z.enum(["pending", "handled", "held-budget"]), generation: version }).strict(),
}).strict();
export type MaintenanceIncident = z.infer<typeof MaintenanceIncidentSchema>;

export interface MaintenanceRows {
  reservations: ResourceReservation[]; jobs: MaintenanceJob[]; occurrences: Occurrence[]; hosts: OccurrenceHost[]; incidents: MaintenanceIncident[];
}
export const MAINTENANCE_KINDS: readonly string[] = ["resource-reservation", "maintenance-job", "occurrence", "occurrence-host", "maintenance-incident"];
export const emptyMaintenanceRows = (): MaintenanceRows => ({ reservations: [], jobs: [], occurrences: [], hosts: [], incidents: [] });
/** S10 admissions (new occurrences, reservations and job changes) stop here, leaving 160–192 to S04 effects and the
 * rest of the shared 256-transaction pilot journal to reconciliation. Bounded closures stay exempt. */
export const MAINTENANCE_ADMISSION_CEILING = 160;

export interface MaintenanceSummary {
  format: "firstmate.maintenance/1"; homeId: string; sequence: number; freshness: SupervisionStatus["freshness"];
  lowerBound: boolean; problems: string[]; enforcement: "advisory";
  jobs: { id: string; name: string; state: MaintenanceJob["state"]; mode: MaintenanceJob["mode"]; zone: string; at: string;
    lastDate: string | null; hosts: Record<OccurrenceHost["state"] | "uncovered", number>; openIncidents: number }[];
  /** Exceptions only: open incidents. Healthy completions and unchanged outages add nothing here. */
  incidents: { id: string; jobId: string; hostId: string; kind: MaintenanceIncident["kind"]; detail: string; generation: number }[];
  resources: { held: number; queued: number; suspect: number; starving: { id: string; keys: string[]; waitingSince: number }[] };
}
const HOST_STATES = ["pending", "running", "deferred", "offline", "completed", "failed", "superseded", "uncovered"] as const;
/** Pure on-demand read of the stored projection; no timer, timeline, model or resource is read or created. */
export function maintenanceSummary(status: SupervisionStatus, starvationAfter = 32): MaintenanceSummary {
  const rows = status.maintenance ?? emptyMaintenanceRows();
  const open = rows.incidents.filter(i => i.state === "open");
  return {
    format: "firstmate.maintenance/1", homeId: status.homeId, sequence: status.sequence, freshness: status.freshness,
    lowerBound: status.freshness !== "current", problems: [...status.problems], enforcement: "advisory",
    jobs: rows.jobs.map(job => {
      const latest = rows.occurrences.filter(o => o.jobId === job.id).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).at(-1);
      const hosts = Object.fromEntries(HOST_STATES.map(s => [s, 0])) as MaintenanceSummary["jobs"][number]["hosts"];
      if (latest) for (const host of latest.hosts) {
        const row = rows.hosts.find(h => h.occurrenceId === latest.id && h.hostId === host);
        hosts[row?.state ?? "uncovered"] += 1;
      }
      return { id: job.id, name: job.name, state: job.state, mode: job.mode, zone: job.schedule.zone, at: job.schedule.at,
        lastDate: latest?.localDate ?? null, hosts, openIncidents: open.filter(i => i.jobId === job.id).length };
    }),
    incidents: open.map(i => ({ id: i.id, jobId: i.jobId, hostId: i.hostId, kind: i.kind, detail: i.detail, generation: i.generation })),
    resources: { held: rows.reservations.filter(r => r.state === "granted").length, queued: rows.reservations.filter(r => r.state === "queued").length,
      suspect: rows.reservations.filter(r => r.state === "suspect").length,
      starving: rows.reservations.filter(r => r.state === "queued" && status.sequence - r.queuedAt >= starvationAfter)
        .map(r => ({ id: r.id, keys: [...r.keys], waitingSince: r.queuedAt })) },
  };
}
