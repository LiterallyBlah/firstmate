import type { NeedsYouSnapshot } from "../shared/needs-you";

/** Display names only. Identity and transport still come from the captured decision. */
export function scopeDecisionContext(snapshot: NeedsYouSnapshot, scopeId: string, maintenance = false) {
  const directory = snapshot.scopeDirectory ?? [], scope = directory.find(s => s.id === scopeId);
  const projects = scope ? directory.filter(s => s.kind === "project" && s.projectIds.some(id => scope.projectIds.includes(id))).map(s => s.title) : [];
  const fallback = maintenance ? "Routine checks" : "Plan conversation";
  const recipient = scope?.title ?? fallback;
  return { recipient, breadcrumb: [...new Set([...projects, recipient])].join(" · ") };
}
