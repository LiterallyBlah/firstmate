import { decisionTitle } from "./decision-copy";
/** Server-owned captain count. The sidebar also owns the single quiet in-app batch toast. */
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { FLEET_SCREEN_ID } from "./screen";
import { NeedsYouBadge } from "./needs-you";
import { useNeedsYou } from "./needs-you-query";
import {
  decisionRoute,
  decisionSession,
  newDecisionBatch,
} from "./needs-you-state";

export function FleetSidebarItem({
  theme,
  currentScreen,
  openScreen,
}: PluginSidebarItemProps) {
  const query = useNeedsYou();
  const session = decisionSession(useQueryClient());
  const toast = useToast();
  useEffect(() => {
    if (query.error) return;
    const batch = newDecisionBatch(session, query.data);
    if (batch.length)
      toast.show(
        `FirstMate needs your call — ${batch.length} new: ${batch
          .slice(0, 2)
          .map((r) => decisionTitle(r.source.title))
          .join("; ")}`,
        { variant: "info" },
      );
  }, [query.data, query.error, session, toast]);
  return (
    <SidebarRow
      icon="Ship"
      active={currentScreen?.screenId === FLEET_SCREEN_ID}
      trailing={
        <NeedsYouBadge
          theme={theme}
          snapshot={query.data}
          offline={query.error !== null}
        />
      }
      onPress={() =>
        openScreen(
          !(query.data?.newCount && query.data.freshness.status === "fresh" && !query.error)
            ? { screenId: FLEET_SCREEN_ID }
            : decisionRoute({
                requestId: "next",
                ...(query.data?.homeId ? { homeId: query.data.homeId } : {}),
              }),
        )
      }
    />
  );
}
