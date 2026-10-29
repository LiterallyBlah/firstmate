/** Build D cooperative transport. No provisioning, Attach, timer creation or cleanup command. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { SupervisionHash, SupervisionUuid } from "./supervision";
import { MaintenanceJobSchema, MaintenanceIncidentSchema, OccurrenceSchema, OccurrenceHostSchema, ResourceReservationSchema, ResourceClass, ResourceKey, HostId } from "./supervision-maintenance";

const count = z.number().int().min(0).max(1_000_000);
const lease = z.number().int().min(1000).max(7 * 24 * 3600 * 1000);
const Evidence = z.array(z.object({ ref: z.string().min(1).max(1024), digest: SupervisionHash }).strict()).min(1).max(32);
const fields = MaintenanceJobSchema.shape;
// The daemon additionally applies S10's retained-path validator before accepting this input.
export const MaintenanceJobInputSchema = z.object({ jobId: SupervisionUuid, expectedVersion: count, scopeId: SupervisionUuid,
  name: fields.name, domain: fields.domain, schedule: fields.schedule, hosts: fields.hosts, resource: fields.resource,
  selectors: fields.selectors, retained: fields.retained, mode: z.literal("observe"), legacyTimer: fields.legacyTimer,
  budget: fields.budget, maxPasses: fields.maxPasses }).strict();
export const MaintenanceObservationSchema = z.object({ occurrenceId: SupervisionUuid, hostId: HostId,
  outcome: z.enum(["completed", "failed", "offline"]), detail: z.string().min(1).max(500).refine(s => !/[\x00-\x1f\x7f]/.test(s)), resultDigest: SupervisionHash }).strict();
export const MaintenanceCommandSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("job"), input: MaintenanceJobInputSchema }).strict(),
  z.object({ op: z.literal("state"), jobId: SupervisionUuid, expectedVersion: count.min(1), state: z.enum(["active", "stopped"]) }).strict(),
  z.object({ op: z.literal("observe"), input: MaintenanceObservationSchema }).strict(),
  z.object({ op: z.literal("ack"), incidentId: SupervisionUuid, generation: count.min(1), epoch: count.min(1) }).strict(),
  // The existing owner retires a timer. This command records only a fresh disabled census plus evidence.
  z.object({ op: z.literal("retired"), jobId: SupervisionUuid, expectedVersion: count.min(1), inventoryHash: SupervisionHash,
    timerId: z.string().min(1).max(320), evidence: Evidence }).strict(),
  z.object({ op: z.literal("reconcile-items"), occurrenceId: SupervisionUuid, hostId: HostId, expectedVersion: count.min(1),
    items: z.array(z.object({ key: SupervisionHash, outcome: z.enum(["done", "failed"]) }).strict()).min(1).max(256), evidence: Evidence }).strict(),
  z.object({ op: z.literal("resource-release"), reservationId: SupervisionUuid, expectedVersion: count.min(1),
    kind: z.enum(["succeeded", "failed", "not-admitted", "withdrawn"]), evidence: Evidence }).strict(),
  z.object({ op: z.literal("resource-reserve"), effectId: SupervisionUuid, class: ResourceClass, keys: z.array(ResourceKey).min(1).max(32),
    priority: count.min(1).max(9), leaseMs: lease.nullable() }).strict(),
  z.object({ op: z.literal("resource-promote"), reservationId: SupervisionUuid, leaseMs: lease.nullable() }).strict(),
  z.object({ op: z.literal("resource-renew"), reservationId: SupervisionUuid, leaseMs: lease }).strict(),
  z.object({ op: z.literal("resource-expire") }).strict(),
]);
export type MaintenanceCommand = z.infer<typeof MaintenanceCommandSchema>;
export const MaintenanceTimerSchema = z.object({ id: z.string(), kind: z.enum(["script-watch", "managed-watch", "native-schedule", "native-heartbeat", "plugin-interval"]),
  name: z.string(), schedule: z.string(), zone: z.string(), enabled: z.boolean(), owner: z.enum(["plugin", "first-mate", "unknown"]),
  disposition: z.string(), jobId: SupervisionUuid.nullable() }).strict();
export const MaintenanceCensusSchema = z.object({ homeId: z.string(), capturedAt: z.string(), fingerprint: SupervisionHash,
  complete: z.boolean(), problems: z.array(z.string()), rows: z.array(MaintenanceTimerSchema),
  hashes: z.object({ config: SupervisionHash, timers: SupervisionHash, coverage: SupervisionHash }).strict(),
  initiative: z.object({ managed: z.array(z.string()), nativeReminders: z.array(z.string()), disposition: z.string() }).strict(),
}).strict();
export type MaintenanceCensus = z.infer<typeof MaintenanceCensusSchema>;
export const MaintenanceSummarySchema = z.object({ format: z.literal("firstmate.maintenance/1"), homeId: z.string(), sequence: count,
  freshness: z.enum(["current", "held", "uninitialized"]), lowerBound: z.boolean(), problems: z.array(z.string()), enforcement: z.literal("advisory"),
  jobs: z.array(z.object({ id: SupervisionUuid, name: z.string(), state: fields.state, mode: fields.mode, zone: z.string(), at: z.string(),
    lastDate: z.string().nullable(), hosts: z.record(z.enum(["pending", "running", "deferred", "offline", "completed", "failed", "superseded", "uncovered"]), count),
    openIncidents: count }).strict()),
  incidents: z.array(z.object({ id: SupervisionUuid, jobId: SupervisionUuid, hostId: z.string(), kind: MaintenanceIncidentSchema.shape.kind,
    detail: z.string(), generation: count.min(1) }).strict()),
  resources: z.object({ held: count, queued: count, suspect: count, starving: z.array(z.object({ id: SupervisionUuid, keys: z.array(z.string()), waitingSince: count }).strict()) }).strict(),
}).strict();
export const MaintenanceRuntimeSnapshotSchema = z.object({ enabled: z.boolean(), homeId: z.string(), sequence: count,
  freshness: z.string(), lowerBound: z.boolean(), problems: z.array(z.string()),
  cleanup: z.object({ state: z.literal("held"), reason: z.string(), conditions: z.array(z.object({ id: z.string(), satisfied: z.boolean(), reasons: z.array(z.string()) }).strict()) }).strict(),
  jobs: z.array(MaintenanceJobSchema), occurrences: z.array(OccurrenceSchema), hosts: z.array(OccurrenceHostSchema),
  incidents: z.array(MaintenanceIncidentSchema), reservations: z.array(ResourceReservationSchema),
  owners: z.array(z.object({ scopeId: SupervisionUuid, state: z.string(), agentId: z.string().nullable(), epoch: count,
    sessions: count, turns: count, uncertain: count }).strict()),
  deliveries: z.array(z.object({ incidentId: SupervisionUuid, generation: count.min(1), effectId: SupervisionUuid.nullable(), state: z.string() }).strict()),
}).strict();
export type MaintenanceRuntimeSnapshot = z.infer<typeof MaintenanceRuntimeSnapshotSchema>;
export const readMaintenance = defineRpc({ name: "firstmate.maintenance.read", input: z.object({}).strict(), output: MaintenanceRuntimeSnapshotSchema });
export const readMaintenanceTimers = defineRpc({ name: "firstmate.maintenance.timers", input: z.object({}).strict(), output: MaintenanceCensusSchema });
export const readMaintenanceSummary = defineRpc({ name: "firstmate.maintenance.summary", input: z.object({}).strict(), output: MaintenanceSummarySchema });
/** Same-user recorded role convention, not authenticated RPC identity. */
export const administerMaintenance = defineRpc({ name: "firstmate.maintenance.admin", input: z.object({ homeId: z.string(), requestId: SupervisionUuid,
  actorId: z.string().min(1).max(256), command: MaintenanceCommandSchema }).strict(), output: MaintenanceRuntimeSnapshotSchema });
