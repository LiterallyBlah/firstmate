import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { readRemotes, type RemoteHost } from "../shared/remotes";

/** A host clock this far off gets a line, as the helper warns from the same distance. */
const SKEW_WARNING_SECONDS = 180;

/** The remote snapshot, shared by the board's host tabs and compact host health. */
export function useRemotes() {
  const read = useRpc(readRemotes);
  return useQuery({
    queryKey: ["firstmate", "remotes"],
    queryFn: () => read({}),
    refetchInterval: 10000,
  });
}

/** One line on a selected host; extra connection details expand in place, without repeating workers. */
export function HostHealthCard({ host, theme }: { host: RemoteHost; theme: PluginTheme }) {
  const [expanded, setExpanded] = useState(false);
  const skew = host.clockSkew?.seconds ?? 0;
  const warning =
    Math.abs(skew) >= SKEW_WARNING_SECONDS
      ? `Clock about ${Math.round(Math.abs(skew) / 60)} minutes ${skew < 0 ? "behind" : "ahead"}; card times corrected`
      : null;
  const summary = `${host.label} · ${host.online ? "online" : host.checkedAt ? "unreachable" : "connecting"} · ${host.workers.length} workers`;
  return (
    <View style={{ marginHorizontal: 12, marginTop: 8, gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[summary, warning, expanded ? "Hide host details" : "Show host details"]
          .filter(Boolean)
          .join(". ")}
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={() => setExpanded(!expanded)}
        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
      >
        <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={12} color={theme.colors.foregroundMuted} />
        <Text
          style={{
            color: theme.colors.foregroundMuted,
            fontSize: 12,
            flexShrink: 1,
          }}
          numberOfLines={1}
        >
          {summary}
          {warning === null ? "" : " · "}
          <Text style={{ color: theme.colors.statusWarning }}>
            {warning === null ? null : `Clock ${Math.round(Math.abs(skew) / 60)}m ${skew < 0 ? "behind" : "ahead"}`}
          </Text>
        </Text>
      </Pressable>
      {expanded ? (
        <>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            {host.projects.length} projects · {host.workspaces.length} workspaces · {host.providers.length} providers
          </Text>
          {host.error ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>{host.error}</Text> : null}
          {warning === null ? null : <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>{warning}</Text>}
        </>
      ) : null}
    </View>
  );
}
