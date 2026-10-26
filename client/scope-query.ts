import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { readScopes } from "../shared/supervision-rpc";
import { drafts, scopeUiKey } from "./draft";
export const SCOPE_QUERY_KEY = ["firstmate", "scope-read"] as const;
/** On-demand status. It shares React Query's host/home cache and installs no scope timer. */
export function useScopeSnapshot(hostId: string, home: string) {
  const read = useRpc(readScopes);
  return useQuery({ queryKey: [...SCOPE_QUERY_KEY, hostId, home], queryFn: async () => {
    const snapshot = await read({});
    // Use the same source-home key as this query. The daemon's canonical home may
    // differ in case/separators, and an erased query cache must not erase routing intent.
    if (snapshot.uiEnabled) drafts.set(scopeUiKey(hostId, home), "enabled");
    return snapshot;
  } });
}
