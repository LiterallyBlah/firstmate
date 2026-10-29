/** Filtering is a view over the single combined snapshot. Never adjust its global totals. */
import type { NeedsYouSnapshot } from "./needs-you";
export type ScopeInboxFilter = { kind: "all" | "general" | "project" | "plan" | "maintenance"; id?: string };
export function filterScopeInbox(snapshot: NeedsYouSnapshot, filter: ScopeInboxFilter): NeedsYouSnapshot {
  if (filter.kind === "all") return snapshot;
  const directory = snapshot.scopeDirectory ?? [];
  const selected = directory.find(s => s.id === filter.id);
  const projectIds = filter.kind === "project" && selected ? selected.projectIds : [];
  const scopes = directory.filter(s => filter.kind === "project" ? filter.id ? s.id === filter.id || s.projectIds.some(p => projectIds.includes(p)) : s.kind === "project" || s.projectIds.length > 0 :
    s.kind === filter.kind && (!filter.id || s.id === filter.id));
  const scopeIds = new Set(scopes.map(s => s.id)), planIds = new Set(scopes.flatMap(s => s.planId ? [s.planId] : []));
  // Descendant plans may span other projects; they cannot lend those projects' legacy identities.
  const legacyProjects = directory.filter(s => s.kind === "project" && s.id === filter.id);
  const includeLegacy = (source: { project: string | null; hostId: string }) => filter.kind === "general" ? true : filter.kind === "project" &&
    (!filter.id ? !!source.project : !!source.project && legacyProjects.some(s => s.hostId !== null && (s.hostId ?? "local").trim().toLowerCase() === source.hostId.trim().toLowerCase() &&
      s.projectNames.some(n => n.trim().toLowerCase() === source.project!.trim().toLowerCase())));
  return { ...snapshot, requests: snapshot.requests.filter(r => includeLegacy(r.source)), parked: snapshot.parked.filter(includeLegacy),
    // Quarantined rows may have no trustworthy scope. Keep every such warning visible.
    quarantined: snapshot.quarantined,
    planNow: snapshot.planNow?.filter(n => filter.kind === "general" || planIds.has(n.plan)), comingUp: snapshot.comingUp?.filter(n => filter.kind === "general" || planIds.has(n.plan)),
    scopedDecisions: snapshot.scopedDecisions?.filter(r => scopeIds.has(r.decision.ownerScopeId)),
    scopedHolds: snapshot.scopedHolds?.filter(h => scopeIds.has(h.scopeId)),
  };
}
