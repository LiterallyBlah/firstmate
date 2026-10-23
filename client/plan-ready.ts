import type { WorkflowSnapshot } from "../shared/workflow-rpc";
import { entryTime } from "./decision-raised";
import type { TimelineEntry, TranscriptRow } from "./transcript-rows";

/** A projection of durable plans, not an effect that appends on every poll. */
export function withPlanReviews(rows: readonly TranscriptRow[], entries: readonly TimelineEntry[], snapshot: WorkflowSnapshot | undefined, mateSince: string | null): TranscriptRow[] {
  const since = Date.parse(mateSince ?? ""), first = entries.map(entryTime).find(at => at !== null);
  if (!snapshot || !Number.isFinite(since) || first == null) return [...rows];
  const reviews = snapshot.plans.flatMap(plan => {
    const at = Date.parse(plan.history[0]?.at ?? "");
    const reviewed = plan.status === "review" || plan.posture === "review" || plan.captainEvents?.some(e => ["approve", "edit", "changes"].includes(e.action));
    if (!reviewed || !Number.isFinite(at) || at < since || at < first) return [];
    return [{ at, row: { key: `plan-ready:${snapshot.homeId}:${plan.definition.id}`, kind: "plan-ready" as const, text: plan.definition.title, planId: plan.definition.id } }];
  }).sort((a, b) => a.at - b.at || a.row.key.localeCompare(b.row.key));
  const times = new Map(entries.flatMap(entry => { const at = entryTime(entry); return at === null ? [] : [[String(entry.seqStart), at] as const]; }));
  const keys = new Set(reviews.map(r => r.row.key)), out: TranscriptRow[] = [];
  let next = 0;
  for (const row of rows) {
    if (keys.has(row.key)) continue;
    const at = times.get(row.key);
    while (next < reviews.length && at !== undefined && at > reviews[next]!.at) out.push(reviews[next++]!.row);
    out.push(row);
  }
  while (next < reviews.length) out.push(reviews[next++]!.row);
  return out;
}
