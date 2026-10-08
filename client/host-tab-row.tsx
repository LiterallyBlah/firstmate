/**
 * The row of host tabs above the board (`host-tabs.ts` says what each holds). One horizontal,
 * scrollable row on every layout, so a phone with several hosts swipes along it instead of
 * wrapping into the columns' space. Each tab carries a quiet online or unreachable mark for a remote
 * host, and its working and needs-attention counts.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { HostTab } from "./host-tabs";

export function HostTabRow({
  tabs,
  selected,
  theme,
  compact,
  onSelect,
}: {
  tabs: readonly HostTab[];
  selected: string;
  theme: PluginTheme;
  compact: boolean;
  onSelect: (id: string) => void;
}) {
  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      row: { flexGrow: 0, flexShrink: 0 },
      content: { gap: 6, paddingHorizontal: compact ? 10 : 12, paddingTop: compact ? 8 : 10 },
      tab: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: compact ? 5 : 4,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
      },
      tabActive: { backgroundColor: colors.surface2, borderColor: colors.foregroundMuted },
      label: { color: colors.foregroundMuted, fontSize: 12 },
      labelActive: { color: colors.foreground, fontWeight: "600" as const },
      mark: { color: colors.foregroundMuted, fontSize: 11 },
      working: { color: colors.accent, fontSize: 11, fontWeight: "600" as const },
      attention: { color: colors.statusWarning, fontSize: 11, fontWeight: "600" as const },
    };
  }, [theme, compact]);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row} contentContainerStyle={styles.content}>
      {tabs.map((tab) => {
        const active = tab.id === selected;
        const reach = tab.online === null ? null : tab.online ? "online" : "unreachable";
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={[
              tab.label,
              reach,
              `${tab.working} working`,
              `${tab.attention} ${tab.attention === 1 ? "needs" : "need"} attention`,
            ]
              .filter((part): part is string => part !== null)
              .join(", ")}
            style={[styles.tab, active ? styles.tabActive : null]}
            onPress={() => onSelect(tab.id)}
          >
            <Text style={[styles.label, active ? styles.labelActive : null]} numberOfLines={1}>
              {tab.label}
            </Text>
            {reach === null ? null : <Text style={styles.mark}>{tab.online ? "●" : "○"}</Text>}
            <View style={{ flexDirection: "row", gap: 4 }}>
              <Text style={styles.working}>{tab.working}</Text>
              {tab.attention === 0 ? null : <Text style={styles.attention}>· {tab.attention}!</Text>}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
