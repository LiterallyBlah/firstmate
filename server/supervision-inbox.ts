/** Scope-local mailbox commands. No send, provider, timer or General conversation dependency. */
import { randomUUID } from "node:crypto";
import type { InboxAssignment, InboxOffer, InboxResult } from "../shared/supervision-inbox";
import { INBOX_LIMITS, InboxResultSchema } from "../shared/supervision-inbox";
import { SupervisionUtc, SupervisionUuid, type SupervisionExpected, type SupervisionReceipt, type SupervisionStatus } from "../shared/supervision";
import { SupervisionError, SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { terminal } from "./supervision-inbox-state";
import { digest } from "./submissions";
import { serialized } from "./serialize";

export type InboxCommit = { receipt: SupervisionReceipt; resultIds: string[]; replayed: boolean };
export const inboxRef = (s: SupervisionStatus, kind: SupervisionExpected["kind"], id: string): SupervisionExpected =>
  ({ kind, id, version: s.versions.find(v => v.kind === kind && v.id === id)?.version ?? 0 });
const target = (m: SupervisionMutation) => {
  if (m.kind === "workflow") return m.event.plan;
  if (m.kind === "retirement") return m.receipt.plan;
  if (m.kind === "binding") return m.value.scopeId;
  if (m.kind === "backend") return m.value.planId;
  return m.value.id;
};
/** Read/derive outside the journal's publication lock. CAS pins include exact resolver dependencies. */
export async function inboxTransaction(store: SupervisionStore, requestId: string, input: unknown,
  build: (status: SupervisionStatus) => Promise<{ mutations: SupervisionMutation[]; resultIds: string[]; pins?: SupervisionExpected[] }> | { mutations: SupervisionMutation[]; resultIds: string[]; pins?: SupervisionExpected[] },
): Promise<InboxCommit> {
  SupervisionUuid.parse(requestId);
  const inputHash = digest(input), status = await store.read();
  if (status.freshness !== "current") throw new SupervisionError("HELD", "Inbox requires a current initialized journal.");
  const old = status.inbox.requests.find(r => r.id === requestId);
  if (old) {
    if (old.inputHash !== inputHash) throw new SupervisionError("CONFLICT", "Inbox request ID has different content.");
    const receipt = await store.requestReceipt(requestId);
    if (!receipt) throw new SupervisionError("HELD", "Inbox replay receipt is missing.");
    return { receipt, resultIds: old.resultIds, replayed: true };
  }
  const built = await build(status);
  const mutations: SupervisionMutation[] = [...built.mutations, { kind: "inbox-request", value: { id: requestId, inputHash, resultIds: built.resultIds, version: 1 } }];
  const refs = new Map<string, SupervisionExpected>();
  for (const ref of [...(built.pins ?? []), ...mutations.map(m => inboxRef(status, m.kind, target(m)))]) refs.set(JSON.stringify([ref.kind, ref.id]), ref);
  const receipt = await store.transact([...refs.values()], requestId, mutations);
  return { receipt, resultIds: built.resultIds, replayed: false };
}
function binding(status: SupervisionStatus, scopeId: string, epoch: number) {
  const scope = status.scopes.find(s => s.id === scopeId), current = status.bindings.find(b => b.scopeId === scopeId);
  if (scope?.mode !== "scoped" || scope.state !== "active" || current?.state !== "active" || current.epoch !== epoch)
    throw new SupervisionError("STALE", "Reread this scope's active binding before offering or acknowledging.");
  return [inboxRef(status, "scope", scopeId), inboxRef(status, "binding", scopeId)];
}
export class SupervisionInbox {
  constructor(readonly store: SupervisionStore, private readonly options: { offers?: boolean; now?: () => Date } = {}) {}
  private now() { return SupervisionUtc.parse((this.options.now?.() ?? new Date()).toISOString()); }
  private command(scopeId: string, requestId: string, input: unknown, build: Parameters<typeof inboxTransaction>[3]) {
    SupervisionUuid.parse(scopeId);
    return serialized(`${this.store.root}:inbox:${scopeId}`, () => inboxTransaction(this.store, requestId, input, build));
  }
  async prepare(scopeId: string, epoch: number, ownerIdle: boolean, requestId = randomUUID()): Promise<InboxCommit> {
    // Internal fixture gate only. No env/config/RPC can enable offers in S02.
    return this.command(scopeId, requestId, { op: "prepare", scopeId, epoch, ownerIdle }, s => {
      if (!this.options.offers) throw new SupervisionError("UNSUPPORTED", "Mailbox offers are disabled; S06 activation is separate.");
      const pins = binding(s, scopeId, epoch);
      if (!ownerIdle) throw new SupervisionError("HELD", "Wait for this owner to be idle; General's state is irrelevant.");
      if (s.inbox.offers.some(o => o.scopeId === scopeId && !["retired", "acknowledged"].includes(o.state))) throw new SupervisionError("HELD", "Reconcile the current in-flight offer before preparing another.");
      const waiting = s.inbox.assignments.filter(a => a.scopeId === scopeId && a.state === "assigned").sort((a, b) => a.ordinal! - b.ordinal!);
      const selected: InboxAssignment[] = [];
      for (const row of waiting.slice(0, INBOX_LIMITS.pageItems)) {
        const events = [...selected, row].map(a => s.inbox.events.find(e => e.id === a.id)!);
        if (Buffer.byteLength(JSON.stringify(events)) > INBOX_LIMITS.pageBytes - 2048) break;
        selected.push(row);
      }
      if (!selected.length) throw new SupervisionError("HELD", "No bounded assigned page is ready for this scope.");
      const id = randomUUID(), offer: InboxOffer = { id, scopeId, epoch, eventIds: selected.map(a => a.id), state: "prepared",
        sends: 0, createdAt: this.now(), lastAttemptAt: null, nextAttemptAt: null, reconciliationIds: [], version: 1 };
      return { pins, resultIds: [id], mutations: [{ kind: "inbox-offer", value: offer }, ...selected.map(a => ({ kind: "inbox-assignment" as const,
        value: { ...a, state: "offered" as const, offerId: id, epoch, version: a.version + 1 } }))] };
    });
  }
  private offerCommand(scopeId: string, epoch: number, offerId: string, requestId: string, op: unknown,
    build: (s: SupervisionStatus, offer: InboxOffer) => SupervisionMutation[]) {
    return this.command(scopeId, requestId, op, s => {
      const pins = binding(s, scopeId, epoch), offer = s.inbox.offers.find(o => o.id === offerId);
      if (!offer || offer.scopeId !== scopeId || offer.epoch !== epoch || offer.state === "retired") throw new SupervisionError("STALE", "Offer does not belong to this current scope/epoch.");
      return { pins, mutations: build(s, offer), resultIds: [offerId] };
    });
  }
  /** Commit uncertainty BEFORE the external boundary; S04 must recheck idle just before its send. */
  beginSend(scopeId: string, epoch: number, offerId: string, ownerIdle: boolean, requestId = randomUUID()) {
    return this.offerCommand(scopeId, epoch, offerId, requestId, { op: "begin-send", scopeId, epoch, offerId, ownerIdle }, (_s, o) => {
      if (!this.options.offers) throw new SupervisionError("UNSUPPORTED", "Mailbox offers are disabled.");
      const now = this.now();
      if (!ownerIdle || o.state !== "prepared" || o.sends >= INBOX_LIMITS.sends || (o.nextAttemptAt && now < o.nextAttemptAt)) throw new SupervisionError("HELD", "Offer is busy, uncertain, capped or backing off; no send admitted.");
      return [{ kind: "inbox-offer", value: { ...o, state: "uncertain", sends: o.sends + 1, lastAttemptAt: now, nextAttemptAt: null, version: o.version + 1 } }];
    });
  }
  accepted(scopeId: string, epoch: number, offerId: string, requestId: string = randomUUID()) {
    return this.offerCommand(scopeId, epoch, offerId, requestId, { op: "accepted", scopeId, epoch, offerId }, (_s, o) => {
      if (o.state !== "uncertain") throw new SupervisionError("HELD", "Only a claimed send can be accepted.");
      return [{ kind: "inbox-offer", value: { ...o, state: "accepted", version: o.version + 1 } }];
    });
  }
  /** Explicit non-admission evidence only; an unknown response must stay uncertain, without resend. */
  reconcileNotAccepted(scopeId: string, epoch: number, offerId: string, evidenceId: string, requestId = randomUUID()) {
    return this.offerCommand(scopeId, epoch, offerId, requestId, { op: "reconcile-not-accepted", scopeId, epoch, offerId, evidenceId }, (_s, o) => {
      if (o.state !== "uncertain" || o.sends >= INBOX_LIMITS.sends) throw new SupervisionError("HELD", "This offer cannot be retried.");
      return [{ kind: "inbox-offer", value: { ...o, state: "prepared", reconciliationIds: [...o.reconciliationIds, evidenceId],
        nextAttemptAt: new Date(Date.parse(o.lastAttemptAt!) + 1000 * 2 ** o.sends).toISOString(), version: o.version + 1 } }];
    });
  }
  acknowledge(scopeId: string, epoch: number, offerId: string, eventIds: string[], requestId: string = randomUUID(), actorId?: string) {
    eventIds = [...eventIds]; // Capture the submitted page before the first asynchronous read.
    return this.offerCommand(scopeId, epoch, offerId, requestId, { op: "ack", scopeId, epoch, offerId, eventIds, ...(actorId ? { actorId } : {}) }, (s, o) => {
      if (actorId !== undefined && s.bindings.find(b => b.scopeId === scopeId)?.agentId !== actorId) throw new SupervisionError("UNKNOWN_OWNER", "Only this scope's bound owner can acknowledge its page.");
      if (!["accepted", "uncertain"].includes(o.state) || digest(eventIds) !== digest(o.eventIds)) throw new SupervisionError("CONFLICT", "Acknowledge the exact offered page; acceptance alone handles nothing.");
      return [{ kind: "inbox-offer", value: { ...o, state: "acknowledged", version: o.version + 1 } }, ...o.eventIds.map(id => {
        const row = s.inbox.assignments.find(a => a.id === id)!;
        return { kind: "inbox-assignment" as const, value: { ...row, state: "acknowledged" as const, version: row.version + 1 } };
      })];
    });
  }
  handle(scopeId: string, epoch: number, offerId: string, results: { eventId: string; result: InboxResult }[], requestId: string = randomUUID(), actorId?: string) {
    const parsed = results.map(r => ({ eventId: SupervisionUuid.parse(r.eventId), result: InboxResultSchema.parse(r.result) }));
    return this.offerCommand(scopeId, epoch, offerId, requestId, { op: "handle", scopeId, epoch, offerId, results: parsed, ...(actorId ? { actorId } : {}) }, (s, o) => {
      if (actorId !== undefined && s.bindings.find(b => b.scopeId === scopeId)?.agentId !== actorId) throw new SupervisionError("UNKNOWN_OWNER", "Only this scope's bound owner can handle its page.");
      if (o.state !== "acknowledged" || !parsed.length || parsed.length > 32 || new Set(parsed.map(r => r.eventId)).size !== parsed.length) throw new SupervisionError("CONFLICT", "Handling needs an acknowledged offer and distinct explicit results.");
      const changed = parsed.map(({ eventId, result }) => {
        const row = s.inbox.assignments.find(a => a.id === eventId);
        if (!row || row.offerId !== offerId || !o.eventIds.includes(eventId) || row.state !== "acknowledged") throw new SupervisionError("CONFLICT", "Result is outside this unhandled acknowledged page.");
        return { ...row, state: "handled" as const, result, version: row.version + 1 };
      });
      const box = s.inbox.mailboxes.find(b => b.id === scopeId)!;
      const ordered = s.inbox.assignments.filter(a => a.scopeId === scopeId && a.ordinal !== null).map(a => changed.find(c => c.id === a.id) ?? a).sort((a, b) => a.ordinal! - b.ordinal!);
      let watermark = 0;
      for (const row of ordered) { if (!terminal(row)) break; watermark = row.ordinal!; }
      return [...changed.map(value => ({ kind: "inbox-assignment" as const, value })), { kind: "inbox-mailbox", value: { ...box, watermark, version: box.version + 1 } }];
    });
  }
  /** After a separately checked binding replacement, retain old offers and reoffer remaining facts. */
  reoffer(scopeId: string, epoch: number, requestId = randomUUID()) {
    return this.command(scopeId, requestId, { op: "reoffer", scopeId, epoch }, s => {
      if (!this.options.offers) throw new SupervisionError("UNSUPPORTED", "Mailbox offers are disabled.");
      const pins = binding(s, scopeId, epoch), old = s.inbox.offers.filter(o => o.scopeId === scopeId && o.epoch < epoch && o.state !== "retired" &&
        (o.state !== "acknowledged" || s.inbox.assignments.some(a => a.offerId === o.id && !terminal(a)))).slice(0, 7);
      const ids = new Set(old.map(o => o.id));
      const assignments = s.inbox.assignments.filter(a => a.scopeId === scopeId && a.offerId && ids.has(a.offerId) && !terminal(a));
      // Assignments keep the previous offer until prepare binds a new one; state is retained.
      return { pins, resultIds: old.map(o => o.id), mutations: [...old.map(o => ({ kind: "inbox-offer" as const, value: { ...o, state: "retired" as const, version: o.version + 1 } })),
        ...assignments.map(a => ({ kind: "inbox-assignment" as const, value: { ...a, state: "assigned" as const, version: a.version + 1 } }))] };
    });
  }
}
