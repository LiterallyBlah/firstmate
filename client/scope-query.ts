import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { readScopes } from "../shared/supervision-rpc";
export const SCOPE_QUERY_KEY = ["firstmate", "scope-read"] as const;
/** On-demand status. It shares React Query's host/home cache and installs no scope timer. */
export function useScopeSnapshot(hostId: string, home: string) {
  const read = useRpc(readScopes);
  return useQuery({ queryKey: [...SCOPE_QUERY_KEY, hostId, home], queryFn: () => read({}) });
}
