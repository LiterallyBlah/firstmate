import type { SupervisionStatus } from "../shared/supervision";
import type { SupervisionInboxStatus } from "../shared/supervision-rpc";
import { INBOX_LIMITS } from "../shared/supervision-inbox";
import { terminal } from "./supervision-inbox-state";

/** Pure stored projection. Source coverage is separate from journal freshness. No timeline/model reads. */
export function supervisionInboxStatus(status: SupervisionStatus, input: { scopeId?: string | undefined; pageKind?: "events" | "sources" | "offers"; after?: number; limit?: number } = {}, now = new Date()): SupervisionInboxStatus {
  const scopeId = input.scopeId ?? null, { inbox } = status;
  const scoped = inbox.assignments.filter(a => !scopeId || (a.scopeId ?? inbox.assignments.find(p => p.id === a.primaryEventId)?.scopeId) === scopeId);
  const all = scoped.filter(a => a.id === a.primaryEventId);
  // Late triage resolution appends an ordinal without changing journal insertion order.
  if (scopeId) all.sort((a, b) => a.ordinal! - b.ordinal!);
  const quarantined = scoped.filter(a => a.state === "quarantined");
  const pending = scoped.filter(a => !terminal(a)), triage = pending.filter(a => !a.scopeId && !inbox.assignments.find(p => p.id === a.primaryEventId)?.scopeId);
  const oldestPendingAt = pending.map(a => inbox.events.find(e => e.id === a.id)!.envelope.observedAt).sort()[0] ?? null;
  const after = input.after ?? 0, pageKind = input.pageKind ?? "events";
  const ids = new Set(status.tasks.filter(t => t.ownerScopeId === scopeId).map(t => t.id));
  const agents = new Set(status.attempts.filter(a => ids.has(a.taskId)).map(a => a.worker?.agentId));
  const offers = inbox.offers.filter(o => (!scopeId || o.scopeId === scopeId) && o.state !== "retired" && o.state !== "acknowledged");
  // S08: an agentless source (a bound pull request, a remote host) belongs to a scope only by its recorded owner.
  const sources = inbox.sources.filter(s => !scopeId || (s.agentId !== null ? agents.has(s.agentId) : s.scopeId === scopeId));
  const rows = pageKind === "events" ? all.filter((a, i) => (scopeId ? a.ordinal! : i + 1) > after).map(a => ({ event: inbox.events.find(e => e.id === a.id)!, disposition: a }))
    : (pageKind === "sources" ? sources : offers).slice(after);
  const output: SupervisionInboxStatus = { format: "firstmate.supervision-inbox/1", homeId: status.homeId, scopeId, sequence: status.sequence, hash: status.hash, pageKind,
    freshness: status.freshness, observedAt: now.toISOString(), offersEnabled: false, deliverySupported: false,
    problems: [...status.problems, ...quarantined.map(a => `Unresolved malformed observation ${a.id}; retained in quarantine under consequence ${a.primaryEventId}.`)].slice(0, 8).map(p => p.slice(0, 1024)),
    counts: { pending: pending.length, triage: triage.length, quarantined: quarantined.length,
      acknowledgedUnhandled: pending.filter(a => a.state === "acknowledged").length, uncertainOffers: offers.filter(o => o.state === "uncertain").length,
      sourcesWithGaps: sources.filter(s => s.coverage === "gap" || s.coverage === "unknown").length, lowerBound: status.freshness === "held" },
    oldestPendingAt, oldestPendingAgeMs: oldestPendingAt ? Math.max(0, now.getTime() - Date.parse(oldestPendingAt)) : null,
    admissionsHeld: status.storage.admissionsHeld || status.freshness !== "current" || inbox.assignments.filter(a => a.id === a.primaryEventId && !terminal(a)).length >= INBOX_LIMITS.pending || inbox.sources.some(s => s.gaps.includes("queue-pressure")),
    watermark: scopeId ? inbox.mailboxes.find(b => b.id === scopeId)?.watermark ?? 0 : null,
    nextAfter: null, hasMore: rows.length > 0, sources: [], offers: [], entries: [] };
  let selected = 0;
  for (const row of rows.slice(0, Math.min(input.limit ?? 32, INBOX_LIMITS.pageItems))) {
    const bytes = Buffer.byteLength(JSON.stringify(row));
    if (Buffer.byteLength(JSON.stringify(output)) + bytes + 128 > INBOX_LIMITS.pageBytes) break;
    if (pageKind === "events") output.entries.push(row as SupervisionInboxStatus["entries"][number]);
    else if (pageKind === "sources") output.sources.push(row as SupervisionInboxStatus["sources"][number]);
    else output.offers.push(row as SupervisionInboxStatus["offers"][number]);
    selected++;
  }
  output.nextAfter = selected ? pageKind === "events" && scopeId ? output.entries.at(-1)!.disposition.ordinal : after + selected : null;
  output.hasMore = rows.length > selected;
  return output;
}
/** General's completed turn cannot stand in for a scoped owner's explicit mailbox acknowledgement. */
export function hasScopedWorker(status: SupervisionStatus, agentId: string): boolean {
  const inventories = [{ attempts: status.attempts, tasks: status.tasks }, ...status.retainedOwnership];
  return inventories.some(s => s.attempts.some(a => a.worker?.hostId.trim().toLowerCase() === "local" && a.worker.agentId === agentId &&
    s.tasks.some(t => t.id === a.taskId && (status.scopes.find(scope => scope.id === t.ownerScopeId)?.mode === "scoped" || status.freshness === "held"))));
}
