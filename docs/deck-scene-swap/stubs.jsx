/** Host settings semantics: revision-bound whole-document saves and explicit rereads.
 * The server stores a real file; external replacement emits no push event. */
export * from "../shell-phase1/stubs.jsx";
import { useRpc as baseRpc } from "../shell-phase1/stubs.jsx";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
window.fixtureSettingsCompleted = 0;

export function useRpc(contract) {
  if (contract.name === "firstmate.needs-you.read") return async () => ({
    homeId: "sample-home", version: 1, actionCount: 0, newCount: 0, snoozedCount: 0,
    pendingAnswerCount: 0, requests: [], parked: [], delivery: "off",
    freshness: { status: "fresh", asOf: Date.now(), checkedAt: Date.now(), problems: [] },
  });
  if (contract.name === "firstmate.scope.read") return async () => ({
    uiEnabled: false, executionEnabled: false, scopes: [], projects: [], homeId: "sample-home",
    sequence: 0, freshness: "uninitialized", asOf: "2026-10-28T12:00:00Z", problems: [],
  });
  return baseRpc(contract);
}

async function request(action, input) {
  const response = await fetch(`/settings/${action}`, { method: "POST", body: JSON.stringify(input) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export function useSettings(contract) {
  const client = useQueryClient(), key = ["fixture-settings", contract.id];
  const [saveError, setSaveError] = useState(null);
  const query = useQuery({ queryKey: key, queryFn: () => request("read", { id: contract.id }),
    staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false, retry: false });
  const actions = {
    saving: false, saveError,
    async save(values, revision) {
      const result = await request("write", { id: contract.id, values, revision });
      if (result.status !== "saved") { setSaveError(result.error); return false; }
      client.setQueryData(key, { ...result, status: "ready" });
      window.fixtureSettingsCompleted++;
      return true;
    },
    async reload() { setSaveError(null); await query.refetch(); },
  };
  if (!query.data) return { ...actions, status: "loading" };
  if (query.isError) return { ...actions, status: "error", error: String(query.error) };
  return { ...actions, ...query.data, values: contract.schema.parse(query.data.values) };
}
