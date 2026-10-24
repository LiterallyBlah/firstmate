/** Local, explicit observe-only ingress. Exported adapters are NOT started by the plugin in S02. */
import { randomUUID } from "node:crypto";
import type { PluginLifecycleEvents, PluginLifecycleRegistration } from "@getpaseo/plugin/server";
import { z } from "zod";
import { SupervisionEventSchema, SupervisionUtc } from "../shared/supervision";
import { INBOX_LIMITS, InboxSourceSchema, type InboxAssignment, type InboxEvent, type InboxSource } from "../shared/supervision-inbox";
import type { PaseoAgent, PaseoApi, TimelinePage } from "./host-types";
import { eventOwners, terminal } from "./supervision-inbox-state";
import { inboxRef, inboxTransaction } from "./supervision-inbox";
import { SupervisionError, SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { canonical, digest } from "./submissions";
import { serialized } from "./serialize";
import { listAgents } from "./fleet";

const ObservationSchema = z.object({ agentId: z.string().min(1).max(256), kind: z.enum(["turn-ended", "permission", "permission-resolved", "catalog", "timeline"]),
  turnId: z.string().min(1).max(256).nullable(), outcome: z.enum(["completed", "failed", "canceled"]).nullable(),
  permissionId: z.string().min(1).max(256).nullable(), sourceKind: z.enum(["hook", "catalog", "timeline"]),
  sourceKey: z.string().min(1).max(1024), epoch: z.string().min(1).max(256).nullable(),
  cursor: InboxSourceSchema.shape.cursor, maxSeq: InboxSourceSchema.shape.maxSeq,
  gaps: InboxSourceSchema.shape.gaps, coverage: InboxSourceSchema.shape.coverage, payload: z.unknown(),
  expectedSourceVersion: z.number().int().nonnegative().optional(),
}).strict();
export type LocalObservation = z.infer<typeof ObservationSchema>;
export const sourceId = (kind: InboxSource["kind"], agentId: string | null) => digest([kind, "local", agentId]);
function jsonObservation(value: unknown): { wire: string; valid: boolean } {
  try {
    const wire = canonical(value);
    JSON.parse(wire); // Undefined, cycles, BigInt and non-JSON details must not escape quarantine.
    return { wire, valid: true };
  } catch { return { wire: canonical({ nonJson: true, type: typeof value }), valid: false }; }
}
/** No title, status-line, label, arbitrary scope tag or prose is an authority input. */
export function localConsequence(o: Pick<LocalObservation, "kind" | "agentId" | "turnId" | "outcome" | "permissionId" | "sourceKey" | "epoch">) {
  return digest(["local", o.agentId, o.kind, o.permissionId ?? o.turnId ?? [o.epoch, o.sourceKey], o.kind === "turn-ended" ? o.outcome : null]);
}
export class SupervisionEvents {
  private readonly bootId = randomUUID();
  constructor(readonly store: SupervisionStore, private readonly options: { now?: () => Date; maxPending?: number } = {}) {}
  private now() { return SupervisionUtc.parse((this.options.now?.() ?? new Date()).toISOString()); }
  async admit(raw: unknown, requestId = randomUUID()) {
    // Only hashes and bounded metadata survive malformed/oversized input. Never retain its prose.
    const encoded = jsonObservation(raw), parsed = ObservationSchema.safeParse(raw), inputHash = digest(encoded.wire);
    const fallback: LocalObservation = { agentId: "unknown", kind: "catalog", turnId: null, outcome: null, permissionId: null,
      sourceKind: "catalog", sourceKey: `malformed:${inputHash}`, epoch: null, cursor: null, maxSeq: null, gaps: ["malformed"], coverage: "gap", payload: { inputHash } };
    const o = parsed.success && encoded.valid ? parsed.data : fallback;
    let payload = canonical(o.payload ?? null), malformed = !parsed.success || !encoded.valid;
    if (Buffer.byteLength(payload) > INBOX_LIMITS.payloadBytes) { payload = canonical({ digest: digest(o.payload), bytes: Buffer.byteLength(payload), omitted: "oversized" }); malformed = true; }
    return serialized(`${this.store.root}:ingress`, () => inboxTransaction(this.store, requestId, { op: "ingress", inputHash }, async s => {
      const id = sourceId(o.sourceKind, o.agentId), prior = s.inbox.sources.find(c => c.id === id);
      if (o.expectedSourceVersion !== undefined && o.expectedSourceVersion !== (prior?.version ?? 0)) throw new SupervisionError("STALE", "Source changed while fetching; retain the current baseline and refetch explicitly.");
      const gaps = [...new Set([...o.gaps, ...(malformed ? ["malformed" as const] : []), ...(prior && prior.epoch !== o.epoch ? ["epoch-changed" as const] : [])])];
      const reordered = prior?.epoch === o.epoch && (o.maxSeq ?? 0) < (prior.maxSeq ?? 0);
      if (reordered) gaps.push("reordered");
      const source: InboxSource = { id, kind: o.sourceKind, hostId: "local", agentId: o.agentId, epoch: o.epoch,
        cursor: reordered ? prior!.cursor : o.cursor, maxSeq: reordered ? prior!.maxSeq : o.maxSeq,
        coverage: gaps.length ? "gap" : o.coverage, gaps: [...new Set(gaps)], observedAt: this.now(), version: (prior?.version ?? 0) + 1 };
      let sourceKey = digest([o.agentId, o.sourceKey]);
      const observationHash = digest([o.kind, o.agentId, o.turnId, o.outcome, o.permissionId, digest(payload)]);
      const known = s.inbox.events.find(e => e.envelope.source.kind === o.sourceKind && e.envelope.source.key === sourceKey && e.envelope.source.epoch === o.epoch);
      if (known?.observationHash === observationHash) return { mutations: [{ kind: "inbox-source", value: source }], resultIds: [known.id] };
      if (known) {
        malformed = true; sourceKey = digest([sourceKey, observationHash]);
        source.coverage = "gap"; source.gaps = [...new Set([...source.gaps, "malformed" as const])];
        const conflict = s.inbox.events.find(e => e.envelope.source.kind === o.sourceKind && e.envelope.source.key === sourceKey && e.envelope.source.epoch === o.epoch);
        if (conflict) return { mutations: [{ kind: "inbox-source", value: source }], resultIds: [conflict.id] };
      }
      const consequenceKey = localConsequence(o), primary = s.inbox.assignments.find(a => a.consequenceKey === consequenceKey && a.id === a.primaryEventId);
      const pending = s.inbox.assignments.filter(a => a.id === a.primaryEventId && !terminal(a)).length;
      if (!primary && pending >= (this.options.maxPending ?? INBOX_LIMITS.pending)) {
        // Refuse admission, preserve cursor, and durably expose pressure. No source baseline moves.
        return { mutations: [{ kind: "inbox-source", value: { ...source, epoch: prior?.epoch ?? null, cursor: prior?.cursor ?? null, maxSeq: prior?.maxSeq ?? null,
          coverage: "gap", gaps: [...new Set([...source.gaps, "queue-pressure" as const])] } }], resultIds: [] };
      }
      const blob = await this.store.putBlob(Buffer.from(payload)), eventId = randomUUID();
      const meta = JSON.parse(payload) as { status?: string; requiresAttention?: boolean } | null;
      const critical = malformed || !["catalog", "timeline"].includes(o.kind) || (o.kind === "catalog" && (meta?.status === "error" || meta?.requiresAttention === true));
      const event: InboxEvent = { id: eventId, version: 1, critical, consequenceKey, observationHash,
        envelope: SupervisionEventSchema.parse({ version: 1, eventId, source: { kind: o.sourceKind, hostId: "local", key: sourceKey, epoch: o.epoch, cursor: o.cursor ? canonical(o.cursor) : null },
          observedAt: this.now(), subject: { agentId: o.agentId, ...(o.turnId ? { turnId: o.turnId } : {}), ...(o.permissionId ? { permissionId: o.permissionId } : {}) },
          evidence: [{ ref: `blob:${blob.id}`, digest: blob.id, freshness: this.now() }], certainty: malformed ? "unknown" : o.sourceKind === "hook" ? "reported" : "inferred", payloadRef: `blob:${blob.id}` }) };
      const owners = eventOwners(event, s.tasks, s.attempts), owner = owners.length === 1 && !malformed && s.scopes.find(scope => scope.id === owners[0]!.scopeId)?.mode === "scoped" ? owners[0]! : null;
      if (owner) Object.assign(event.envelope.subject, { taskId: owner.task.id, attemptId: owner.attempt.id, planId: owner.task.planId });
      const scopeId = primary ? primary.scopeId : owner?.scopeId ?? null;
      const box = scopeId ? s.inbox.mailboxes.find(b => b.id === scopeId) : undefined;
      const assignment: InboxAssignment = { id: eventId, scopeId, primaryEventId: primary?.id ?? eventId, consequenceKey,
        attemptId: primary?.attemptId ?? owner?.attempt.id ?? null,
        resolverVersion: 1, reason: primary ? "duplicate" : malformed ? "malformed" : owner ? "attempt-owner" : owners.length > 1 ? "ambiguous-owner" : "unknown-owner",
        candidates: [...new Set(owners.map(o => o.scopeId))].slice(0, 64), ordinal: !primary && scopeId ? box?.nextOrdinal ?? 1 : null,
        state: primary ? "superseded" : malformed ? "quarantined" : owner ? critical ? "assigned" : "observed" : "received", offerId: null, epoch: null,
        result: !primary && owner && !critical ? { kind: "no-action", reason: "Bounded evidence metadata only; no lifecycle outcome or model wake.", evidenceIds: [blob.id] } : null, version: 1 };
      // A duplicate of unresolved triage retains the original unresolved owner, even after registration.
      if (primary && primary.scopeId !== owner?.scopeId) {
        delete event.envelope.subject.taskId; delete event.envelope.subject.attemptId; delete event.envelope.subject.planId;
      }
      const mutations: SupervisionMutation[] = [];
      if (!s.versions.some(v => v.kind === "blob" && v.id === blob.id)) mutations.push({ kind: "blob", value: blob });
      mutations.push({ kind: "inbox-source", value: source }, { kind: "inbox-event", value: event }, { kind: "inbox-assignment", value: assignment });
      if (assignment.ordinal !== null) mutations.push({ kind: "inbox-mailbox", value: { id: scopeId!, nextOrdinal: assignment.ordinal + 1,
        watermark: assignment.state === "observed" && (box?.watermark ?? 0) === assignment.ordinal - 1 ? assignment.ordinal : box?.watermark ?? 0, version: (box?.version ?? 0) + 1 } });
      return { mutations, resultIds: [eventId], pins: owners.flatMap(o => [inboxRef(s, "task", o.task.id), inboxRef(s, "attempt", o.attempt.id)]) };
    }));
  }
  /** Explicit checked triage resolution after registry recovery. No guessed owner or history rewrite. */
  resolve(eventId: string, requestId = randomUUID()) {
    return serialized(`${this.store.root}:ingress`, () => inboxTransaction(this.store, requestId, { op: "resolve", eventId }, s => {
      const event = s.inbox.events.find(e => e.id === eventId), row = s.inbox.assignments.find(a => a.id === eventId);
      if (!event || !row || row.id !== row.primaryEventId || row.reason === "malformed") throw new SupervisionError("HELD", "Only a retained well-formed primary observation can be resolved.");
      if (row.scopeId) return { mutations: [], resultIds: [eventId] };
      const owners = eventOwners(event, s.tasks, s.attempts), owner = owners.length === 1 ? owners[0]! : null;
      if (!owner || s.scopes.find(scope => scope.id === owner.scopeId)?.mode !== "scoped") throw new SupervisionError("UNKNOWN_OWNER", "Triage still has no exact unambiguous scoped attempt.");
      const box = s.inbox.mailboxes.find(b => b.id === owner.scopeId), ordinal = box?.nextOrdinal ?? 1;
      const assignment: InboxAssignment = { ...row, scopeId: owner.scopeId, attemptId: owner.attempt.id, ordinal, reason: "attempt-owner", candidates: [owner.scopeId],
        state: event.critical ? "assigned" : "observed", result: event.critical ? null : { kind: "no-action", reason: "Bounded evidence metadata only; no lifecycle outcome or model wake.", evidenceIds: [event.envelope.payloadRef.slice(5)] }, version: row.version + 1 };
      return { resultIds: [eventId], pins: [inboxRef(s, "task", owner.task.id), inboxRef(s, "attempt", owner.attempt.id)], mutations: [
        { kind: "inbox-assignment", value: assignment }, { kind: "inbox-mailbox", value: { id: owner.scopeId, nextOrdinal: ordinal + 1,
          watermark: assignment.state === "observed" && (box?.watermark ?? 0) === ordinal - 1 ? ordinal : box?.watermark ?? 0, version: (box?.version ?? 0) + 1 } },
      ] };
    }));
  }
  /** Explicit boot receipt; no timers, session creation, sends or source reads. Hook absence stays unknown. */
  async boot() {
    const s = await this.store.read();
    const agents = [...new Set(s.attempts.filter(a => a.worker?.hostId.trim().toLowerCase() === "local").map(a => a.worker!.agentId))];
    for (const agentId of agents) await this.recordGap("hook", agentId, this.bootId, ["boot", "hook-not-durable"]);
  }
  async recordGap(kind: InboxSource["kind"], agentId: string, epoch: string | null, gaps: InboxSource["gaps"], expectedVersion?: number) {
    return serialized(`${this.store.root}:ingress`, () => inboxTransaction(this.store, randomUUID(), { op: "gap", kind, agentId, epoch, gaps, expectedVersion: expectedVersion ?? null }, s => {
      const id = sourceId(kind, agentId), old = s.inbox.sources.find(c => c.id === id);
      if (expectedVersion !== undefined && expectedVersion !== (old?.version ?? 0)) return { mutations: [], resultIds: [id] };
      const value: InboxSource = { id, kind, hostId: "local", agentId, epoch, cursor: epoch === old?.epoch ? old.cursor : null,
        maxSeq: epoch === old?.epoch ? old.maxSeq : null, coverage: "gap", gaps: [...new Set([...gaps, ...(old && old.epoch !== epoch ? ["epoch-changed" as const] : [])])],
        observedAt: this.now(), version: (old?.version ?? 0) + 1 };
      return { mutations: [{ kind: "inbox-source", value }], resultIds: [id] };
    }));
  }
  /** Supported public typed refetch. A page is bounded coverage, never proof of worker completion. */
  async timeline(paseo: PaseoApi, agentId: string, turnId: string | null = null): Promise<TimelinePage | null> {
    const snapshot = await this.store.read(), old = snapshot.inbox.sources.find(s => s.id === sourceId("timeline", agentId));
    let page: TimelinePage;
    try { page = await paseo.agents.ref(agentId).timeline.refetch({ direction: old?.cursor ? "after" : "tail", ...(old?.cursor ? { cursor: old.cursor } : {}), limit: 32, projection: "canonical" }); }
    catch { await this.recordGap("timeline", agentId, old?.epoch ?? null, ["fetch-failed"], old?.version ?? 0); return null; }
    const relevant = turnId ? page.entries.filter(e => e.turnId === turnId) : page.entries;
    const gaps: InboxSource["gaps"] = [];
    if (page.error) gaps.push("fetch-failed");
    if (page.entries.length > 32 || (page.endCursor && page.endCursor.epoch !== page.epoch) ||
      (page.startCursor && page.startCursor.epoch !== page.epoch) || page.entries.some((e, i) => !Number.isSafeInteger(e.seqStart) || !Number.isSafeInteger(e.seqEnd) || e.seqStart < 0 || e.seqEnd < e.seqStart || (i > 0 && e.seqStart !== page.entries[i - 1]!.seqEnd + 1))) gaps.push("malformed");
    if (page.gap || page.staleCursor || page.reset || (old?.cursor && page.startCursor && page.startCursor.seq > old.cursor.seq + 1)) gaps.push("page-gap");
    if (!relevant.length) gaps.push("empty-timeline");
    if (old?.epoch && old.epoch !== page.epoch) gaps.push("epoch-changed");
    const unsafe = gaps.length > 0;
    if (page.hasNewer) gaps.push("page-gap"); // A complete bounded page can advance while later pages remain visible.
    await this.admit({ agentId, kind: "timeline", turnId, outcome: null, permissionId: null, sourceKind: "timeline",
      sourceKey: digest([agentId, page.epoch, page.startCursor, page.endCursor, turnId, relevant.map(e => [e.seqStart, e.seqEnd, e.turnId ?? null, digest(e.item)])]),
      epoch: page.epoch, cursor: unsafe ? old?.epoch === page.epoch ? old.cursor : null : page.endCursor,
      maxSeq: unsafe ? old?.epoch === page.epoch ? old.maxSeq : null : Math.max(old?.epoch === page.epoch ? old.maxSeq ?? 0 : 0, ...page.entries.map(e => e.seqEnd), 0),
      gaps, coverage: "bounded", expectedSourceVersion: old?.version ?? 0,
      payload: { epoch: page.epoch, start: page.startCursor, end: page.endCursor, relevant: relevant.slice(0, 32).map(e => ({ start: e.seqStart, end: e.seqEnd, turnId: e.turnId ?? null, type: e.item.type, digest: digest(e.item) })),
        hasOlder: page.hasOlder, hasNewer: page.hasNewer, error: Boolean(page.error) } } satisfies LocalObservation);
    return page;
  }
  async ended(event: PluginLifecycleEvents["agent.turn_ended"], paseo: PaseoApi) {
    const turnId = event.turnId, key = turnId ? digest([event.agent.id, turnId, event.outcome.kind]) : `${this.bootId}:${randomUUID()}`;
    const empty = event.timeline.length === 0;
    await this.admit({ agentId: event.agent.id, kind: "turn-ended", turnId, outcome: event.outcome.kind, permissionId: null,
      sourceKind: "hook", sourceKey: key, epoch: this.bootId, cursor: null, maxSeq: null, coverage: "unknown",
      gaps: ["hook-not-durable", ...(!turnId ? ["missing-turn" as const] : []), ...(empty ? ["empty-timeline" as const] : [])],
      payload: { kind: event.outcome.kind, timelineItems: event.timeline.length, timelineDigests: event.timeline.slice(-32).map(item => ({ type: item.type, digest: digest(item) })) } });
    if (empty) await this.timeline(paseo, event.agent.id, turnId);
  }
  async permission(agentId: string, permissionId: string, resolved = false) {
    return this.admit({ agentId, kind: resolved ? "permission-resolved" : "permission", turnId: null, outcome: null, permissionId,
      sourceKind: "hook", sourceKey: digest([agentId, permissionId, resolved]), epoch: this.bootId, cursor: null, maxSeq: null,
      gaps: ["hook-not-durable"], coverage: "unknown", payload: { permissionId, resolved } });
  }
  /** Call with an already-supported local catalog read, never a remote host or label-based owner. */
  async catalog(agents: readonly PaseoAgent[], paseo: PaseoApi) {
    const s = await this.store.read(), registered = new Set(s.attempts.filter(a => a.worker?.hostId.trim().toLowerCase() === "local").map(a => a.worker!.agentId));
    const results = await Promise.allSettled(agents.filter(a => registered.has(a.id)).map(async agent => {
      try {
        for (const permission of agent.pendingPermissions) await this.admit({ agentId: agent.id, kind: "permission", turnId: null, outcome: null, permissionId: permission.id,
          sourceKind: "catalog", sourceKey: digest([agent.id, permission.id]), epoch: null, cursor: null, maxSeq: null, gaps: [], coverage: "unknown", payload: { permissionId: permission.id } });
        await this.admit({ agentId: agent.id, kind: "catalog", turnId: null, outcome: null, permissionId: null,
          sourceKind: "catalog", sourceKey: digest([agent.id, agent.updatedAt, agent.status]), epoch: null, cursor: null, maxSeq: null,
          gaps: [], coverage: "unknown", payload: { status: agent.status, updatedAt: agent.updatedAt, requiresAttention: agent.requiresAttention, permissions: agent.pendingPermissions.map(p => p.id).slice(0, 32) } });
        if (agent.status !== "running") await this.timeline(paseo, agent.id);
      } catch {
        // Persist this subject's failure before waiting for unrelated slow source requests.
        await this.recordGap("catalog", agent.id, null, ["fetch-failed"]);
      }
    }));
    if (results.some(result => result.status === "rejected")) throw new SupervisionError("HELD", "Catalog recovery could not persist a subject's source gap.");
  }
  /** Explicit recovery after attachment/restart. No subscription, poll or model is implicitly created. */
  async reconcile(paseo: PaseoApi) {
    await this.boot();
    const agents = await listAgents(paseo);
    const status = await this.store.read();
    const local = status.attempts.filter(a => a.worker?.hostId.trim().toLowerCase() === "local");
    for (const attempt of local) if (!agents.some(a => a.id === attempt.worker!.agentId))
      await this.recordGap("catalog", attempt.worker!.agentId, null, ["fetch-failed"]);
    await this.catalog(agents, paseo);
  }
}

/** Explicit future attachment seam. S02's index.server registers only read-only RPCs, never this. */
export function registerLocalSupervisionIngress(server: PluginLifecycleRegistration, ingress: SupervisionEvents) {
  const disposers = [server.on("agent.turn_ended", (e, { paseo }) => ingress.ended(e, paseo)),
    server.on("agent.permission_requested", e => ingress.permission(e.agent.id, e.request.id).then(() => {})),
    server.on("agent.permission_resolved", e => ingress.permission(e.agent.id, e.requestId, true).then(() => {}))];
  return () => disposers.forEach(dispose => dispose());
}
