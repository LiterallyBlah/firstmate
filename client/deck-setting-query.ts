import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { listDeckSettings } from "../shared/deck-rpc";

export const DECK_SETTINGS_QUERY_KEY = ["firstmate", "deck", "settings"] as const;
/** Metadata only; images are fetched only for the active pack. Shared by the pane and settings screen. */
export function useDeckSettings() {
  const list = useRpc(listDeckSettings);
  return useQuery({ queryKey: DECK_SETTINGS_QUERY_KEY, queryFn: () => list({}), staleTime: 60_000 });
}
