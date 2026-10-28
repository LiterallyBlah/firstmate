/** Disabled S10 resource arbitration. No RPC registration, executor, send or wake.
 * All-or-none reservations over sorted keys, FIFO within priority, monotonic fences and terminal-evidence release.
 * Advisory only: a human, native tool or full-access session can bypass it, and no receiver here checks a fence.
 */
import { z } from "zod";
import { capacityHeld } from "../shared/supervision-capacity";
import { SupervisionActorSchema, SupervisionHash, SupervisionUtc, SupervisionUuid, type SupervisionActor, type SupervisionStatus } from "../shared/supervision";
import {
  compatible, emptyMaintenanceRows, MAINTENANCE_ADMISSION_CEILING, ResourceClass, ResourceKey, type MaintenanceRows, type ResourceReservation,
} from "../shared/supervision-maintenance";
import { digest } from "./submissions";
import { SupervisionError, SUPERVISION_INDEX_LIMITS, type SupervisionMutation, type SupervisionStore } from "./supervision-store";
import { effectReservationId } from "./supervision-maintenance-state";
import { boundTo, expected } from "./supervision-projects";

type Code = "STALE" | "HELD" | "UNKNOWN_OWNER" | "UNSUPPORTED" | "CONFLICT";
export function refuse(code: Code, message: string): never { throw new SupervisionError(code, message); }
export const maintenanceRows = (status: SupervisionStatus): MaintenanceRows => status.maintenance ?? emptyMaintenanceRows();
export const emptyResult = () => ({ planId: null, planHash: null, decisionId: null, outboxId: null });
const reviewedActor = (actor: SupervisionActor) => actor.kind === "captain-ui" || actor.kind === "mate-chat";
/** New S10 rows are admissions: they stop below S04's effect band. Releases and other closures stay exempt and bounded. */
export function maintenanceAdmission(status: SupervisionStatus): void {
  if (status.freshness !== "current") refuse("HELD", "The supervision journal is not current; maintenance admissions wait for reconciliation.");
  if (capacityHeld(status, "maintenance", MAINTENANCE_ADMISSION_CEILING))
    refuse("HELD", `Maintenance admissions stop at journal sequence ${MAINTENANCE_ADMISSION_CEILING}; the rest is reserved for effects and reconciliation.`);
}
/** How far into the shared 256-transaction journal an S10 write may go.
 * - admission (new occurrence, reservation or grant, job definition or activation): below 160.
 * - relabel (a waiting pass changing between pending, offline and deferred): below 160; past it, nothing is written.
 * - closure (starting a pass that already holds a granted reservation, dispatching under it, an observed outcome,
 *   lease expiry or renewal): below 192, never into the reconciliation tail.
 * - settlement (recording results of dispatched items, uncertain conversion, release, reconciliation, acknowledgement,
 *   stop): always, within the store's own ceiling and S07's release reservation.
 */
export type Step = "admission" | "relabel" | "closure" | "settlement";
export function stepRoom(status: SupervisionStatus, step: Step): "write" | "skip" {
  if (step === "admission") { maintenanceAdmission(status); return "write"; }
  if (step === "relabel") return capacityHeld(status, "maintenance", MAINTENANCE_ADMISSION_CEILING) ? "skip" : "write";
  if (step === "closure" && capacityHeld(status, "admissions", SUPERVISION_INDEX_LIMITS.admissions))
    refuse("HELD", `Maintenance closures stop at journal sequence ${SUPERVISION_INDEX_LIMITS.admissions}; only settlement, release and reconciliation continue.`);
  return "write";
}
const active = (r: ResourceReservation) => r.state === "granted" || r.state === "suspect";
const ahead = (q: ResourceReservation, c: Pick<ResourceReservation, "id" | "priority" | "queuedAt">) =>
  q.priority < c.priority || (q.priority === c.priority && (q.queuedAt < c.queuedAt || (q.queuedAt === c.queuedAt && q.id < c.id)));

/** Whether every key can be taken now: no incompatible holder, and no earlier incompatible waiter (FIFO within priority).
 * Compatible builds on unrelated keys never wait for anything.
 */
export function grantable(rows: readonly ResourceReservation[], candidate: Pick<ResourceReservation, "id" | "class" | "keys" | "priority" | "queuedAt">):
  { ok: true } | { ok: false; blockedBy: string[] } {
  const blockedBy = new Set<string>();
  for (const key of candidate.keys) for (const r of rows) {
    if (r.id === candidate.id || !r.keys.includes(key) || compatible(r.class, candidate.class)) continue;
    if (active(r) || (r.state === "queued" && ahead(r, candidate))) blockedBy.add(r.id);
  }
  return blockedBy.size ? { ok: false, blockedBy: [...blockedBy].sort() } : { ok: true };
}
/** The next fence of every key: one more than any fence ever issued for it. */
export function nextFences(rows: readonly ResourceReservation[], keys: readonly string[]) {
  return keys.map(key => ({ key, fence: 1 + Math.max(0, ...rows.flatMap(r => r.fences.filter(f => f.key === key).map(f => f.fence))) }));
}
/** What a fence-checking receiver would say about a request carrying `fence` for `key`. The plugin has no such receiver:
 * this is the advisory verdict a qualified receiver (S11) must reproduce, never evidence that one did.
 */
export function receiverVerdict(status: SupervisionStatus, key: string, fence: number): "current" | "stale" | "unknown" {
  const rows = maintenanceRows(status).reservations;
  const issued = rows.flatMap(r => r.fences.filter(f => f.key === key).map(f => ({ r, fence: f.fence })));
  const latest = Math.max(0, ...issued.map(i => i.fence));
  if (fence < latest) return "stale";
  const holder = issued.find(i => i.fence === fence);
  return holder && active(holder.r) && fence === latest ? "current" : holder ? "stale" : "unknown";
}
export function leaseExpiry(now: string, leaseMs: number | null) { return leaseMs === null ? null : { expiresAt: new Date(Date.parse(now) + leaseMs).toISOString().replace(/\.\d{3}Z$/, "Z") }; }

/** The reservation for a new request, granted all-or-none or queued. Never borrows, never grants part of the keys. */
export function reservationFor(status: SupervisionStatus, input: { id: string; scopeId: string; holder: ResourceReservation["holder"]; class: ResourceReservation["class"];
  keys: string[]; priority: number; lease: ResourceReservation["lease"]; provenance: SupervisionActor }): ResourceReservation {
  const rows = maintenanceRows(status).reservations, keys = [...new Set(input.keys)].sort();
  const base = { id: input.id, version: 1, scopeId: input.scopeId, holder: input.holder, class: input.class, keys, priority: input.priority,
    queuedAt: status.sequence + 1, lease: input.lease, enforcement: "advisory" as const, terminal: null, provenance: input.provenance };
  return grantable(rows, base).ok ? { ...base, state: "granted", fences: nextFences(rows, keys) } : { ...base, state: "queued", fences: [] };
}
export function promotion(status: SupervisionStatus, row: ResourceReservation, lease: ResourceReservation["lease"]): ResourceReservation | null {
  const rows = maintenanceRows(status).reservations;
  return row.state === "queued" && grantable(rows, row).ok ? { ...row, version: row.version + 1, state: "granted", fences: nextFences(rows, row.keys), lease } : null;
}

const Evidence = z.array(z.object({ ref: z.string().min(1).max(1024), digest: SupervisionHash }).strict()).max(32);
export const EffectReserveSchema = z.object({ effectId: SupervisionUuid, class: ResourceClass, keys: z.array(ResourceKey).min(1).max(32),
  priority: z.number().int().min(1).max(9), leaseMs: z.number().int().min(1000).max(7 * 24 * 3600 * 1000).nullable() }).strict();
/** One lease length for reserve, promote and renew: 1 s to 7 days, or none. A zero or negative lease is refused, so a
 * bound owner cannot cycle renew and expire. */
export const LeaseMs = z.number().int().min(1000).max(7 * 24 * 3600 * 1000);
export const ReleaseSchema = z.object({ reservationId: SupervisionUuid, expectedVersion: z.number().int().positive(),
  kind: z.enum(["succeeded", "failed", "not-admitted", "withdrawn"]), evidence: Evidence }).strict();

export class SupervisionResources {
  constructor(readonly store: SupervisionStore, private readonly options: { enabled?: boolean; now?: () => string } = {}) {}
  private now() { return this.options.now?.() ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); }
  private enabled() { if (!this.options.enabled) refuse("UNSUPPORTED", "S10 resource arbitration is disabled."); }
  private command(requestId: string, input: unknown, actorInput: SupervisionActor, step: Step,
    prepare: (status: SupervisionStatus, actor: SupervisionActor) => SupervisionMutation[]) {
    this.enabled();
    const actor = structuredClone(SupervisionActorSchema.parse(actorInput));
    return this.store.transactCommand(requestId, digest(input), actor, async status => {
      if (stepRoom(status, step) === "skip") refuse("HELD", "Past the admission ceiling this change is not recorded.");
      const mutations = prepare(status, actor);
      return { expectedVersions: expected(status, mutations), mutations, result: emptyResult() };
    });
  }
  private authorize(status: SupervisionStatus, actor: SupervisionActor, scopeId: string) {
    if (!reviewedActor(actor) && !boundTo(status, actor, [scopeId])) refuse("UNKNOWN_OWNER", "Only the holder scope's bound owner or the captain changes its reservation.");
  }

  /** Reserve every resource an admitted effect names, all at once. A queued request keeps its place; it is never partly granted. */
  async reserveForEffect(requestId: string, actor: SupervisionActor, raw: z.input<typeof EffectReserveSchema>) {
    const input = EffectReserveSchema.parse(raw), id = effectReservationId(input.effectId);
    await this.command(requestId, { op: "reserve", input }, actor, "admission", (status, a) => {
      maintenanceAdmission(status);
      const effect = status.effects.find(e => e.id === input.effectId);
      if (!effect) refuse("UNKNOWN_OWNER", "Reserve for a recorded effect.");
      this.authorize(status, a, effect.scopeId);
      if (["succeeded", "failed", "cancelled"].includes(effect.state)) refuse("CONFLICT", "A finished effect needs no reservation.");
      if (maintenanceRows(status).reservations.some(r => r.id === id)) refuse("CONFLICT", "This effect already has its reservation.");
      if (input.keys.some(k => !effect.resourceIds.includes(k))) refuse("CONFLICT", "An effect reserves only the resources it names.");
      return [{ kind: "resource-reservation", value: reservationFor(status, { id, scopeId: effect.scopeId, holder: { kind: "effect", id: effect.id }, class: input.class,
        keys: input.keys, priority: input.priority, lease: leaseExpiry(this.now(), input.leaseMs), provenance: a }) }];
    });
    return (await this.read()).reservations.find(r => r.id === id)!;
  }
  /** Grant a queued reservation once it is first in line and every key is free. */
  async promote(requestId: string, actor: SupervisionActor, input: { reservationId: string; leaseMs: number | null }) {
    const raw = z.object({ reservationId: SupervisionUuid, leaseMs: LeaseMs.nullable() }).strict().parse(input);
    await this.command(requestId, { op: "promote", raw }, actor, "admission", (status, a) => {
      maintenanceAdmission(status);
      const row = maintenanceRows(status).reservations.find(r => r.id === raw.reservationId);
      if (!row) refuse("UNKNOWN_OWNER", "Unknown reservation.");
      this.authorize(status, a, row.scopeId);
      const next = promotion(status, row, leaseExpiry(this.now(), raw.leaseMs));
      if (!next) refuse("HELD", `Reservation waits: ${JSON.stringify(grantable(maintenanceRows(status).reservations, row))}`);
      return [{ kind: "resource-reservation", value: next }];
    });
    return (await this.read()).reservations.find(r => r.id === raw.reservationId)!;
  }
  /** Lease expiry marks a holder suspect. It still holds every key: expiry is never takeover. Exempt from the admission bound. */
  /** The instant is this process's clock, never the caller's. Only the captain/mate, or a scope's bound owner for its own
   * reservations, marks leases suspect. */
  async expire(requestId: string, actor: SupervisionActor) {
    const at = this.now();
    SupervisionUtc.parse(at);
    return this.command(requestId, { op: "expire", at }, actor, "closure", (status, a) => {
      const mine = (r: ResourceReservation) => reviewedActor(a) || boundTo(status, a, [r.scopeId]);
      const due = maintenanceRows(status).reservations.filter(r => r.state === "granted" && r.lease && r.lease.expiresAt <= at);
      if (due.length && !due.some(mine)) refuse("UNKNOWN_OWNER", "Only the holder scope's bound owner or the captain marks its lease suspect.");
      if (!due.length) refuse("CONFLICT", "No lease has expired.");
      return due.filter(mine).map(r => ({ kind: "resource-reservation" as const, value: { ...r, version: r.version + 1, state: "suspect" as const } }));
    });
  }
  /** A suspect holder seen alive again keeps its fences. */
  async renew(requestId: string, actor: SupervisionActor, input: { reservationId: string; leaseMs: number }) {
    const raw = z.object({ reservationId: SupervisionUuid, leaseMs: LeaseMs }).strict().parse(input);
    return this.command(requestId, { op: "renew", raw }, actor, "closure", (status, a) => {
      const row = maintenanceRows(status).reservations.find(r => r.id === raw.reservationId);
      if (!row || !active(row)) refuse("CONFLICT", "Only a held reservation is renewed.");
      this.authorize(status, a, row.scopeId);
      return [{ kind: "resource-reservation", value: { ...row, version: row.version + 1, state: "granted", lease: leaseExpiry(this.now(), raw.leaseMs) } }];
    });
  }
  /** Release on terminal evidence. An uncertain effect is released only by recorded proof it was never admitted. Exempt. */
  async release(requestId: string, actor: SupervisionActor, raw: z.input<typeof ReleaseSchema>) {
    const input = ReleaseSchema.parse(raw);
    return this.command(requestId, { op: "release", input }, actor, "settlement", (status, a) => {
      const row = maintenanceRows(status).reservations.find(r => r.id === input.reservationId);
      if (!row) refuse("UNKNOWN_OWNER", "Unknown reservation.");
      if (row.version !== input.expectedVersion) refuse("STALE", "The reservation changed; reread it.");
      this.authorize(status, a, row.scopeId);
      const terminal = { kind: input.kind, evidence: input.evidence, actor: a, at: this.now() };
      if (row.state === "queued") return [{ kind: "resource-reservation", value: { ...row, version: row.version + 1, state: "cancelled", terminal } }];
      return [{ kind: "resource-reservation", value: { ...row, version: row.version + 1, state: "released", terminal } }];
    });
  }
  async read() { return maintenanceRows(await this.store.read()); }
}
