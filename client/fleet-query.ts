import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { loadFleet, type Fleet } from "../shared/fleet";

export const FLEET_QUERY_KEY = ["firstmate", "fleet"] as const;
let cachedFleet: Fleet | null = null;

/** All fleet surfaces use the installation's query cache and the same request key. */
export function useFleet(pollSeconds: number, enabled = true) {
  const load = useRpc(loadFleet);
  return useQuery({
    queryKey: FLEET_QUERY_KEY,
    enabled,
    queryFn: function () {
      return load({}).then((fleet) => {
        cachedFleet = fleet;
        return fleet;
      });
    },
    refetchInterval: pollSeconds * 1000,
    ...(cachedFleet === null ? {} : { placeholderData: cachedFleet }),
  });
}
