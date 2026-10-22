import type { NeedsYouRequest, NeedsYouSnapshot } from "./needs-you";
import type { PlanNeed } from "./workflow-rpc";

export const planDecisionId = (need: Pick<PlanNeed, "plan" | "node">) => `plan-decision:${need.plan}:${need.node}`;

/** Presentation adapter only: these requests never enter the backlog ledger or its answer RPC. */
export function planDecisionRequest(need: PlanNeed): NeedsYouRequest | null {
  if (!need.node || !need.decision) return null;
  const at = Date.parse(need.decision.at);
  return {
    id: planDecisionId(need), revision: need.decision.revision, generation: 1, state: "seen",
    detectedAt: Number.isFinite(at) ? at : 0, updatedAt: Number.isFinite(at) ? at : 0,
    baseline: true, seenAt: null, seenRevision: null, snoozedUntil: null, submissions: [], resolution: null,
    originalAsk: need.decision.ask,
    source: { key: JSON.stringify([["local"], "", need.node]), taskId: need.node, hostId: "local", project: null,
      title: need.question, ask: need.decision.ask, url: null, reportPath: null, gateToken: null,
      section: "queued", disposition: "open", blockedBy: null },
  };
}

export function planDecisionFor(snapshot: NeedsYouSnapshot | undefined, id: string) {
  return snapshot?.planNow?.find(n => !!n.decision && planDecisionId(n) === id);
}

/** One common queue for the drawer, List and Board; server counts stay untouched. */
export function decisionCardSnapshot(snapshot: NeedsYouSnapshot): NeedsYouSnapshot {
  const plans = (snapshot.planNow ?? []).flatMap(need => {
    const request = planDecisionRequest(need);
    return request ? [{ need, request }] : [];
  });
  const ids = new Set(plans.map(p => p.request.id));
  return { ...snapshot, requests: [...snapshot.requests.filter(r => !ids.has(r.id)), ...plans.map(p => p.request)],
    briefs: [...(snapshot.briefs ?? []).filter(b => !ids.has(b.requestId)), ...plans.flatMap(({ need, request }) => need.decision?.brief
      ? [{ requestId: request.id, recordRevision: request.revision, ...need.decision.brief }] : [])] };
}
