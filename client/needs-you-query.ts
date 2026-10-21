import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readNeedsYou, type NeedsYouSnapshot } from "../shared/needs-you";
import { mergeDecisionSnapshot } from "./needs-you-state";
import { FLEET_QUERY_KEY } from "./fleet-query";
export const NEEDS_YOU_QUERY_KEY = ["firstmate", "needs-you"] as const;
export function useNeedsYou() {
  const read = useRpc(readNeedsYou);
  return useQuery({
    queryKey: NEEDS_YOU_QUERY_KEY,
    queryFn: () => read({}),
    refetchInterval: 5000,
    structuralSharing: (old, next) =>
      mergeDecisionSnapshot(
        old as NeedsYouSnapshot | undefined,
        next as NeedsYouSnapshot,
      ),
  });
}
export function useDecisionChanged() {
  const client = useQueryClient();
  return (snapshot?: NeedsYouSnapshot) => {
    const merged = snapshot
      ? client.setQueryData<NeedsYouSnapshot>(NEEDS_YOU_QUERY_KEY, (old) =>
          mergeDecisionSnapshot(old, snapshot),
        )
      : undefined;
    void client.invalidateQueries({ queryKey: NEEDS_YOU_QUERY_KEY });
    void client.invalidateQueries({ queryKey: FLEET_QUERY_KEY });
    // Completion navigation must retain arrivals already observed by a newer poll.
    return merged;
  };
}
