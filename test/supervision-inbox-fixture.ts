import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SupervisionStore, type SupervisionMutation, type SupervisionStoreOptions } from "../server/supervision-store";
import { SupervisionEvents, type LocalObservation } from "../server/supervision-events";
import { SupervisionInbox } from "../server/supervision-inbox";
import { seed, expected, ids } from "./supervision-fixture";
import type { PaseoApi, TimelinePage } from "../server/host-types";

export { ids };
export const second = Object.fromEntries(Object.entries(ids).map(([name, value]) => [name, value.replace(/0([1-5])$/, "1$1")])) as typeof ids;
export const now = new Date("2026-10-24T20:00:00.000Z");
export async function inboxFixture(options: SupervisionStoreOptions = {}) {
  const directory = join(process.env.PASEO_HOME!, randomUUID()), dataRoot = join(directory, "data"), home = join(directory, "home");
  const store = new SupervisionStore(dataRoot, home, { writable: true, processIdentity: async () => ({ state: "alive", start: "inbox-fixture" }), ...options });
  await store.initialize(); await store.acquireCoordinator();
  const a = seed(store.homeId), b: SupervisionMutation[] = JSON.parse(JSON.stringify(a, (key, value) => {
    if (key === "kind") return value;
    if (typeof value !== "string") return value;
    const index = Object.values(ids).indexOf(value);
    if (index >= 0) return Object.values(second)[index];
    return value === "plan" ? "plan-b" : value === "build" ? "build-b" : value.replace("plan/build", "plan-b/build-b");
  }));
  for (const [batch, agent] of [[a, "worker-a"], [b, "worker-b"]] as const) for (const m of batch) {
    if (m.kind === "attempt") m.value.worker = { hostId: "local", agentId: agent, workspaceId: `workspace-${agent}` };
    if (m.kind === "binding") { m.value.state = "active"; m.value.agentId = `supervisor-${agent}`; }
  }
  await store.transact(expected([...a, ...b]), randomUUID(), [...a, ...b]);
  const events = new SupervisionEvents(store, { now: () => now, ...(options.maxPendingEvents !== undefined ? { maxPending: options.maxPendingEvents } : {}) });
  const inbox = new SupervisionInbox(store, { offers: true, now: () => now });
  return { store, events, inbox, dataRoot, home };
}
export function observation(extra: Partial<LocalObservation> = {}): LocalObservation {
  return { agentId: "worker-a", kind: "turn-ended", turnId: "turn-1", outcome: "completed", permissionId: null,
    sourceKind: "hook", sourceKey: "worker-a:turn-1:completed", epoch: "boot-1", cursor: null, maxSeq: null,
    gaps: ["hook-not-durable"], coverage: "unknown", payload: { outcome: "completed" }, ...extra };
}
export function timelinePage(extra: Partial<TimelinePage> = {}): TimelinePage {
  return { agentId: "worker-a", epoch: "timeline-1", reset: false, staleCursor: false, gap: false, hasOlder: false, hasNewer: false,
    startCursor: { epoch: "timeline-1", seq: 1 }, endCursor: { epoch: "timeline-1", seq: 1 }, window: { minSeq: 1, maxSeq: 1, nextSeq: 2 },
    entries: [{ seqStart: 1, seqEnd: 1, turnId: "turn-1", timestamp: now.toISOString(), item: { type: "assistant_message", text: "done: a reported status, never verified completion" } }],
    direction: "tail", projection: "canonical", error: null, ...extra } as TimelinePage;
}
export function api(refetch: (input: unknown, agentId: string) => Promise<TimelinePage>) {
  return { agents: { ref: (id: string) => ({ timeline: { refetch: (input: unknown) => refetch(input, id) } }) } } as unknown as PaseoApi;
}
