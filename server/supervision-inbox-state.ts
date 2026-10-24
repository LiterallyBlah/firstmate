/** Pure S02 projection checks, used at append AND replay by the S01 journal. */
import type { SupervisionStatus, SupervisionExpected, SupervisionCode } from "../shared/supervision";
import type { InboxAssignment, InboxEvent, InboxOffer, InboxProjection, InboxSource } from "../shared/supervision-inbox";
import { INBOX_LIMITS } from "../shared/supervision-inbox";
import { digest } from "./submissions";

export type InboxFrame = { kind: SupervisionExpected["kind"]; id: string; version: number; value: unknown };
type Fail = (code: SupervisionCode, message: string) => never;
export const inboxKey = (kind: string, id: string) => JSON.stringify([kind, id]);
export const terminal = (a: InboxAssignment) => a.state === "handled" || a.state === "superseded" || a.state === "observed";
export function inboxProjection(frames: Map<string, InboxFrame>): InboxProjection {
  const values = <T>(kind: string) => [...frames.values()].filter(f => f.kind === kind).map(f => f.value as T);
  return { events: values("inbox-event"), assignments: values("inbox-assignment"), sources: values("inbox-source"),
    mailboxes: values("inbox-mailbox"), offers: values("inbox-offer"), requests: values("inbox-request") };
}
/** Historical attempts are deliberately included: reusing a session makes unbound late turns ambiguous. */
export function eventOwners(event: InboxEvent, tasks: SupervisionStatus["tasks"], attempts: SupervisionStatus["attempts"]) {
  const subject = event.envelope.subject;
  return attempts.filter(a => a.worker?.hostId.trim().toLowerCase() === event.envelope.source.hostId &&
    a.worker.agentId === subject.agentId && (!subject.attemptId || a.id === subject.attemptId))
    .flatMap(attempt => {
      const task = tasks.find(t => t.id === attempt.taskId);
      return task && (!subject.taskId || subject.taskId === task.id) && (!subject.planId || subject.planId === task.planId)
        ? [{ attempt, task, scopeId: task.ownerScopeId }] : [];
    });
}
export function validateInboxChange(kind: string, value: unknown, prior: unknown, frames: Map<string, InboxFrame>, fail: Fail) {
  if (!kind.startsWith("inbox-")) return;
  if (kind === "inbox-event" || kind === "inbox-request") {
    if (prior) fail("CONFLICT", "Ingress events and accepted inbox requests are immutable.");
  }
  if (kind === "inbox-assignment" && !prior && !["received", "assigned", "quarantined", "superseded", "observed"].includes((value as InboxAssignment).state)) fail("HELD", "Admission cannot fabricate an offer, acknowledgement or handled result.");
  if (kind === "inbox-source" && prior) {
    const row = value as InboxSource, old = prior as InboxSource;
    if (["id", "kind", "hostId", "agentId"].some(k => row[k as keyof InboxSource] !== old[k as keyof InboxSource])) fail("CONFLICT", "Source identity is immutable.");
    if (row.epoch === old.epoch && ((row.maxSeq ?? 0) < (old.maxSeq ?? 0) || (row.cursor?.seq ?? 0) < (old.cursor?.seq ?? 0))) fail("STALE", "Source baseline cannot regress in an epoch.");
    if (row.epoch !== old.epoch && !row.gaps.includes("epoch-changed")) fail("HELD", "Changed source epoch needs an explicit gap.");
  }
  if (kind === "inbox-source") {
    const row = value as InboxSource;
    if ((row.cursor && (row.cursor.epoch !== row.epoch || (row.maxSeq ?? -1) < row.cursor.seq)) ||
      (row.coverage === "bounded" && row.gaps.length) || (row.kind === "hook" && (row.cursor || row.maxSeq !== null || row.coverage === "bounded"))) fail("HELD", "Source cursor, epoch and claimed coverage disagree.");
  }
  if (kind === "inbox-assignment" && prior) {
    const row = value as InboxAssignment, old = prior as InboxAssignment;
    const resolving = !old.scopeId && old.ordinal === null && old.state === "received" && ["unknown-owner", "ambiguous-owner"].includes(old.reason) && row.scopeId && row.attemptId && row.reason === "attempt-owner" && ["assigned", "observed"].includes(row.state);
    if (["id", "consequenceKey", "primaryEventId", "resolverVersion", ...(!resolving ? ["ordinal", "scopeId", "attemptId"] : [])].some(k => row[k as keyof InboxAssignment] !== old[k as keyof InboxAssignment])) fail("CONFLICT", "An assignment cannot silently change owner or consequence.");
    const transitions: Record<string, string[]> = { received: ["received", "assigned", "quarantined"], assigned: ["assigned", "offered"],
      offered: ["offered", "acknowledged", "assigned"], acknowledged: ["acknowledged", "handled", "offered", "assigned"],
      handled: ["handled"], superseded: ["superseded"], quarantined: ["quarantined"], observed: ["observed"] };
    if ((!resolving && !transitions[old.state]?.includes(row.state)) || (old.result && digest(old.result) !== digest(row.result))) fail("HELD", "Disposition cannot lose a result or regress.");
    if ((row.offerId !== old.offerId || (old.state === "acknowledged" && row.state === "offered")) && old.offerId) {
      const offer = frames.get(inboxKey("inbox-offer", old.offerId))?.value as InboxOffer | undefined;
      if (offer?.state !== "retired") fail("HELD", "Reoffer requires reconciled/retired prior offer.");
    }
    if (!resolving && row.state === "assigned" && old.state !== "assigned") {
      const offer = old.offerId ? frames.get(inboxKey("inbox-offer", old.offerId))?.value as InboxOffer | undefined : undefined;
      const current = row.scopeId ? frames.get(inboxKey("binding", row.scopeId))?.value as SupervisionStatus["bindings"][number] | undefined : undefined;
      if (offer?.state !== "retired" || !current || current.epoch <= (old.epoch ?? 0)) fail("STALE", "Reoffer requires a higher current epoch and retained retired offer.");
    }
    if (["offered", "acknowledged", "handled"].includes(row.state)) {
      const current = row.scopeId ? frames.get(inboxKey("binding", row.scopeId))?.value as SupervisionStatus["bindings"][number] | undefined : undefined;
      if (current?.epoch !== row.epoch || current.state !== "active") fail("STALE", "Old epoch cannot acknowledge or handle an event.");
    }
  }
  if (kind === "inbox-offer") {
    const row = value as InboxOffer, old = prior as InboxOffer | undefined;
    if (!old && (row.state !== "prepared" || row.sends !== 0 || row.lastAttemptAt || row.nextAttemptAt || row.reconciliationIds.length)) fail("HELD", "New offers must start prepared and unsent.");
    const binding = frames.get(inboxKey("binding", row.scopeId))?.value as SupervisionStatus["bindings"][number] | undefined;
    const scope = frames.get(inboxKey("scope", row.scopeId))?.value as SupervisionStatus["scopes"][number] | undefined;
    if ((!old || row.state !== "retired") && (binding?.epoch !== row.epoch || binding.state !== "active" || scope?.state !== "active" || scope.mode !== "scoped")) fail("STALE", "Offer/ack requires this scope's active binding epoch.");
    if (old) {
      const transitions: Record<string, string[]> = { prepared: ["prepared", "accepted", "uncertain", "retired"],
        accepted: ["accepted", "acknowledged", "retired"], uncertain: ["uncertain", "accepted", "acknowledged", "prepared", "retired"],
        acknowledged: ["acknowledged", "retired"], retired: ["retired"] };
      if (row.scopeId !== old.scopeId || row.epoch !== old.epoch || row.createdAt !== old.createdAt || digest(row.eventIds) !== digest(old.eventIds) ||
        row.sends < old.sends || row.sends > old.sends + 1 || !transitions[old.state]?.includes(row.state)) fail("HELD", "Offer identity, uncertainty and retry budget must be retained.");
      if (old.reconciliationIds.some(id => !row.reconciliationIds.includes(id))) fail("HELD", "Reconciliation evidence cannot be removed.");
      const claiming = old.state === "prepared" && row.state === "uncertain";
      if ((claiming && (row.sends !== old.sends + 1 || !row.lastAttemptAt || (old.nextAttemptAt && row.lastAttemptAt < old.nextAttemptAt))) ||
        (!claiming && (row.sends !== old.sends || row.lastAttemptAt !== old.lastAttemptAt)) ||
        (old.state === "prepared" && row.state === "accepted") ||
        (["accepted", "uncertain", "acknowledged"].includes(row.state) && row.sends < 1)) fail("HELD", "Offer admission and acknowledgement require an accounted send boundary.");
      if (old.state === "uncertain" && row.state === "prepared" && (row.reconciliationIds.length <= old.reconciliationIds.length || !row.nextAttemptAt || Date.parse(row.nextAttemptAt) < Date.parse(old.lastAttemptAt!) + 1000 * 2 ** old.sends)) fail("HELD", "Unknown send requires explicit non-admission evidence and backoff before retry.");
    }
  }
}
export function validateInbox(frames: Map<string, InboxFrame>, fail: Fail) {
  const inbox = inboxProjection(frames);
  if (!inbox.events.length && !inbox.sources.length && !inbox.offers.length && !inbox.mailboxes.length && !inbox.assignments.length) return;
  const values = <T>(kind: string) => [...frames.values()].filter(f => f.kind === kind).map(f => f.value as T);
  const get = (kind: string, id: string) => frames.get(inboxKey(kind, id))?.value;
  const sources = new Set<string>(), consequences = new Map<string, string>(), ordinals = new Set<string>(), inflight = new Set<string>();
  for (const event of inbox.events) {
    const source = event.envelope.source, k = digest([source.kind, source.hostId, source.key, source.epoch]);
    if (event.id !== event.envelope.eventId || source.hostId !== "local" || sources.has(k)) fail("CONFLICT", "Duplicate or non-local source event identity.");
    sources.add(k);
    const blob = get("blob", event.envelope.payloadRef.slice(5)) as { bytes: number } | undefined;
    if (!/^blob:[0-9a-f]{64}$/.test(event.envelope.payloadRef) || !blob || blob.bytes > INBOX_LIMITS.payloadBytes || Buffer.byteLength(JSON.stringify(event)) > INBOX_LIMITS.payloadBytes) fail("HELD", "Ingress payload must reference committed bounded evidence.");
    const assignment = get("inbox-assignment", event.id) as InboxAssignment | undefined;
    if (!assignment || assignment.consequenceKey !== event.consequenceKey) fail("HELD", "Every admitted event needs its disposition in the same transaction.");
  }
  for (const row of inbox.assignments) {
    const event = get("inbox-event", row.id) as InboxEvent | undefined, primary = get("inbox-assignment", row.primaryEventId) as InboxAssignment | undefined;
    if (!event || !primary || primary.primaryEventId !== primary.id || primary.consequenceKey !== row.consequenceKey || (primary.scopeId !== row.scopeId && !(row.id !== row.primaryEventId && row.scopeId === null))) fail("CONFLICT", "Disposition lost its primary consequence/provenance.");
    if (row.id !== row.primaryEventId) {
      if (row.state !== "superseded" || row.reason !== "duplicate" || row.ordinal !== null || row.result) fail("CONFLICT", "Duplicate observations cannot create a second actionable consequence.");
    } else {
      if (consequences.has(row.consequenceKey)) fail("CONFLICT", "Semantic consequence already has a primary event.");
      consequences.set(row.consequenceKey, row.id);
      if (row.state === "superseded") fail("CONFLICT", "Primary event needs a real result, not self-supersession.");
    }
    if (row.scopeId) {
      if ((get("scope", row.scopeId) as SupervisionStatus["scopes"][number] | undefined)?.mode !== "scoped") fail("UNKNOWN_OWNER", "Inbox owner is not a registered scoped owner.");
      const boundEvent = row.attemptId ? { ...event, envelope: { ...event.envelope, subject: { ...event.envelope.subject, attemptId: row.attemptId } } } : event;
      const owners = eventOwners(boundEvent, values("task"), values("attempt"));
      if (!row.attemptId || (event.envelope.subject.attemptId && event.envelope.subject.attemptId !== row.attemptId) || owners.length !== 1 || owners[0]!.scopeId !== row.scopeId) fail("UNKNOWN_OWNER", "Event assignment requires an exact unambiguous registered attempt.");
    } else if (!["received", "quarantined", "superseded"].includes(row.state) || row.ordinal !== null) fail("UNKNOWN_OWNER", "Unknown ownership stays in triage.");
    if (row.ordinal !== null) {
      const k = inboxKey(row.scopeId!, String(row.ordinal));
      if (!row.scopeId || row.primaryEventId !== row.id || ordinals.has(k)) fail("CONFLICT", "Mailbox ordinal is not unique.");
      ordinals.add(k);
    }
    if (["offered", "acknowledged", "handled"].includes(row.state)) {
      const offer = row.offerId ? get("inbox-offer", row.offerId) as InboxOffer | undefined : undefined;
      if (!offer || offer.scopeId !== row.scopeId || offer.epoch !== row.epoch || !offer.eventIds.includes(row.id)) fail("CONFLICT", "Disposition must name its exact offer and epoch.");
      if (["acknowledged", "handled"].includes(row.state) && !["acknowledged", "retired"].includes(offer.state)) fail("HELD", "Transport acceptance is not owner acknowledgement.");
    }
    if ((["handled", "observed"].includes(row.state)) !== (row.result !== null)) fail("HELD", "Handled requires durable result or evidenced no-action reason.");
    if (row.state === "observed" && (event.critical || row.result?.kind !== "no-action")) fail("HELD", "Only noncritical evidence metadata may be observed without a model acknowledgement.");
    if (row.result) {
      for (const id of row.result.evidenceIds) if (!get("blob", id)) fail("HELD", "Handling evidence is not committed.");
      if (row.result.kind === "result") for (const id of row.result.effectIds) {
        const effect = get("effect", id) as SupervisionStatus["effects"][number] | undefined;
        if (!effect || effect.scopeId !== row.scopeId || !["succeeded", "failed", "cancelled"].includes(effect.state)) fail("HELD", "Accepted/uncertain delivery is not a terminal result.");
      }
    }
  }
  for (const box of inbox.mailboxes) {
    if (!get("scope", box.id)) fail("UNKNOWN_OWNER", "Mailbox has no scope.");
    const rows = inbox.assignments.filter(a => a.scopeId === box.id && a.ordinal !== null).sort((a, b) => a.ordinal! - b.ordinal!);
    if (box.nextOrdinal !== rows.length + 1 || rows.some((a, i) => a.ordinal !== i + 1)) fail("HELD", "Mailbox ordering cannot skip an admitted event.");
    let watermark = 0;
    for (const row of rows) { if (!terminal(row)) break; watermark = row.ordinal!; }
    if (box.watermark !== watermark) fail("HELD", "Contiguous watermark cannot skip unhandled events.");
  }
  for (const row of inbox.assignments) if (row.ordinal && !get("inbox-mailbox", row.scopeId!)) fail("HELD", "Assigned event has no mailbox.");
  for (const offer of inbox.offers) {
    for (const id of offer.reconciliationIds) if (!get("blob", id)) fail("HELD", "Offer reconciliation evidence is not committed.");
    if (offer.state !== "retired" && offer.state !== "acknowledged") {
      if (inflight.has(offer.scopeId)) fail("CONFLICT", "Only one offer may be in flight per scope.");
      inflight.add(offer.scopeId);
    }
    for (const id of offer.eventIds) {
      const row = get("inbox-assignment", id) as InboxAssignment | undefined;
      if (!row || row.scopeId !== offer.scopeId || row.primaryEventId !== id) fail("UNKNOWN_OWNER", "Offer cannot borrow another scope's event.");
    }
    const bytes = Buffer.byteLength(JSON.stringify(offer.eventIds.map(id => get("inbox-event", id))));
    if (bytes > INBOX_LIMITS.pageBytes) fail("HELD", "Offer exceeds bounded page budget.");
  }
}
