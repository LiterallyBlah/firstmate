/**
 * Watch for a worker on a remote host: its card, with the board's actions, beside its recent
 * activity. The local view (`crewmate.tsx`) streams a timeline from this daemon; a remote worker's
 * timeline is on another one, so this reads `paseo logs --filter text` through the plugin's remote
 * request path every few seconds instead — what it said, what it was told, its reasoning; no tool
 * calls, and questions or permissions are answered on that host, not here.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import type { FleetCard } from "../shared/fleet";
import { remoteCrewLogs } from "../shared/remote-crew";
import { CrewCard } from "./card";
import { useFollowEnd } from "./follow-end";
import { agentStatusLabel, agentStatusTone, relativeTime } from "./format";
import { Chip, IconButton, JumpToEnd, MONOSPACE, errorText } from "./ui";

/** How often the log is read again while it is on screen. */
const REFRESH_MS = 10000;
const SIDE_BY_SIDE_WIDTH = 680;
const CARD_COLUMN_WIDTH = 300;

export function RemoteWorkerView({
  serverId,
  agentId,
  card,
  theme,
  compact,
  onBack,
  onChanged,
}: {
  serverId: string;
  agentId: string;
  /** Null once the worker has left the board — ended, archived, or its host removed. */
  card: FleetCard | null;
  theme: PluginTheme;
  compact: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [width, setWidth] = useState(0);
  const sideBySide = !compact && width >= SIDE_BY_SIDE_WIDTH;
  const worker = card?.remote?.worker ?? null;
  const readLogs = useRpc(remoteCrewLogs);
  const logs = useQuery({
    queryKey: ["firstmate", "remote-logs", serverId, agentId],
    queryFn: () => readLogs({ serverId, agentId }),
    enabled: card !== null,
    refetchInterval: REFRESH_MS,
  });
  const follow = useFollowEnd();

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      screen: { flex: 1, minHeight: 0 },
      bar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: compact ? 10 : 12,
        paddingTop: compact ? 0 : 12,
        paddingBottom: 8,
      },
      title: { flex: 1, color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
      body: { flex: 1, minHeight: 0, paddingHorizontal: compact ? 10 : 12, paddingBottom: compact ? 10 : 12, gap: 10 },
      bodySide: { flexDirection: "row" as const },
      cardColumn: { width: CARD_COLUMN_WIDTH, flexGrow: 0, flexShrink: 0 },
      cardStacked: { flexGrow: 0, maxHeight: "45%" as const },
      gone: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      frame: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: colors.surface1,
        overflow: "hidden" as const,
      },
      log: { padding: compact ? 10 : 14, gap: 8 },
      note: { color: colors.foregroundMuted, fontSize: 11 },
      text: { color: colors.foreground, fontSize: 12, lineHeight: 18, fontFamily: MONOSPACE },
      error: { color: colors.statusDanger, fontSize: 12 },
    };
  }, [theme, compact]);

  const status = worker === null ? null : { pendingPermissions: worker.pendingPermissions, status: worker.status };

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <IconButton icon="ChevronLeft" label="Crew" showLabel theme={theme} onPress={onBack} />
        <Text style={styles.title} numberOfLines={1}>
          {card?.title ?? "Worker"}
        </Text>
        {status === null ? null : <Chip theme={theme} text={agentStatusLabel(status)} color={agentStatusTone(theme, status)} />}
      </View>
      <View style={[styles.body, sideBySide ? styles.bodySide : null]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <ScrollView style={sideBySide ? styles.cardColumn : styles.cardStacked} automaticallyAdjustKeyboardInsets>
          {card === null ? (
            <Text style={styles.gone}>This worker is no longer on the board — it was ended or archived, or its host was removed.</Text>
          ) : (
            <CrewCard card={card} theme={theme} compact={compact} opener={null} onChanged={onChanged} startExpanded={!compact} />
          )}
        </ScrollView>
        <View style={styles.frame}>
          <ScrollView {...follow.scrollProps} contentContainerStyle={styles.log}>
            <Text style={styles.note}>
              {[
                `Recent activity on ${card?.remote?.host ?? "its host"}, read every ${REFRESH_MS / 1000} s`,
                logs.data === undefined ? null : `last read ${relativeTime(logs.data.readAt)}`,
                worker !== null && worker.pendingPermissions > 0 ? "answer its permission on that host" : null,
              ]
                .filter((part): part is string => part !== null)
                .join(" · ")}
            </Text>
            {logs.error === null ? null : <Text style={styles.error}>{errorText(logs.error)}</Text>}
            {logs.data === undefined ? (
              <Text style={styles.note}>{logs.isFetching ? "Reading the worker's activity…" : ""}</Text>
            ) : (
              <Text selectable style={styles.text}>
                {logs.data.text === "" ? "Nothing has happened yet." : logs.data.text}
              </Text>
            )}
          </ScrollView>
          {follow.away ? <JumpToEnd theme={theme} onPress={follow.jumpToEnd} /> : null}
        </View>
      </View>
    </View>
  );
}
