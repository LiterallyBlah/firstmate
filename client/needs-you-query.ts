import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readNeedsYou, type NeedsYouSnapshot } from "../shared/needs-you";
import { mergeDecisionSnapshot } from "./needs-you-state";
import { FLEET_QUERY_KEY } from "./fleet-query";
export const NEEDS_YOU_QUERY_KEY = ["firstmate", "needs-you"] as const;
// Query identity owns the wait, not a view's mount. Weak keys keep cached sources
// isolated and let an evicted query disappear without a separate lifetime.
const initialReadWaits = new WeakMap<object, number>();
export function useNeedsYou() {
  const read = useRpc(readNeedsYou);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: NEEDS_YOU_QUERY_KEY,
    queryFn: () => {
      const source = client.getQueryCache().find({ queryKey: NEEDS_YOU_QUERY_KEY, exact: true });
      if (source && source.state.data === undefined && !initialReadWaits.has(source)) initialReadWaits.set(source, Date.now());
      return read({});
    },
    refetchInterval: 5000,
    structuralSharing: (old, next) =>
      mergeDecisionSnapshot(
        old as NeedsYouSnapshot | undefined,
        next as NeedsYouSnapshot,
      ),
  });
  const source = client.getQueryCache().find({ queryKey: NEEDS_YOU_QUERY_KEY, exact: true });
  if (source) {
    if (!query.isPending) initialReadWaits.delete(source);
    else if (!initialReadWaits.has(source)) initialReadWaits.set(source, Date.now());
  }
  return { ...query, pendingSince: source && query.isPending ? initialReadWaits.get(source) : undefined };
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
