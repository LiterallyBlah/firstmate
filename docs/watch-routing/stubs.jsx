import { useRpc as hostRpc } from "../board-list/stubs";
export * from "../board-list/stubs";
import { ManagedWatchSchema, WatchRoutingSchema, watchRouting } from "../../shared/watch-routing";
const calls = (window.watchCalls = []);
const handlers = new Map();
export function useRpc(contract) {
  if (!contract.name.startsWith("firstmate.watch.")) return hostRpc(contract);
  if (!handlers.has(contract.name)) handlers.set(contract.name, async (input) => {
    calls.push({ name: contract.name, input });
    if (contract.name === "firstmate.watch.options") return {
      available: !window.watchUnavailable, reason: window.watchUnavailable ? "The current provider has no read-only mode; isolated inspection is unavailable." : null,
      thinking: [{ id: "medium", label: "Medium" }, { id: "high", label: "High" }, { id: "xhigh", label: "Extra high" }],
      boardReview: { name: "board-review", schedule: "*/10 * * * *", prompt: "Inspect fleet/board discrepancies, stalled work and pending decisions. Recommend actions for the main first mate; do not change records or manage crew.", enabled: true,
        executionSession: "new", newSessionReasoning: "medium", notificationPolicy: "actionable" },
    };
    if (contract.name === "firstmate.watch.history") return { runs: [{
      runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", at: "2026-10-10T12:00:00Z", status: "completed", delivery: "suppressed", cleanup: "archived",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", report: JSON.stringify({ version: 1, outcome: "no-change", summary: "No actionable changes", findings: [], error: null }, null, 2),
    }] };
    if (contract.name === "firstmate.watch.create") {
      const parsed = ManagedWatchSchema.parse(input);
      if (window.watchRows.some((watch) => watch.name === parsed.name)) throw new Error("A watch already has that name.");
      window.watchRows.push({ ...window.watchRows[0], ...parsed, routing: watchRouting(parsed), managed: true, lastResult: "never", lastOutput: null });
    }
    if (contract.name === "firstmate.watch.configure") {
      const routing = WatchRoutingSchema.parse({ executionSession: input.executionSession, newSessionReasoning: input.newSessionReasoning, notificationPolicy: input.notificationPolicy });
      const watch = window.watchRows.find((watch) => watch.name === input.name); Object.assign(watch, input, { routing });
    }
    if (contract.name === "firstmate.watch.toggle") window.watchRows.find((watch) => watch.name === input.name).enabled = input.enabled;
    return {};
  });
  return handlers.get(contract.name);
}
