/** Full-height columns in one horizontal row; on phones they stack in one scroll view. */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { ColumnId, FleetCard } from "../shared/fleet";
import type { BoardDensity } from "../shared/settings";
import { CrewCard, watchOpener } from "./card";
import { COLUMNS, columnTone, DONE_SHOWN, doneCards, groupCards, moveColumn } from "./format";

let allDoneShown = false;
const COLUMN_WIDTH = 300;
const COLLAPSED_WIDTH = 44;

export interface BoardProps {
  cards: readonly FleetCard[];
  order: readonly ColumnId[];
  collapsed: readonly string[];
  theme: PluginTheme;
  compact: boolean;
  density: BoardDensity;
  onWatch: (key: string) => void;
  onToggleColumn: (id: ColumnId) => void;
  onReorder: (order: ColumnId[]) => void;
  onChanged: () => void;
}

export function Board(props: BoardProps) {
  const { cards, order, collapsed, theme, compact, density } = props;
  const [allDone, setAllDone] = useState(allDoneShown);
  const groups = useMemo(() => groupCards(cards), [cards]);
  const shown = order.filter((id) => (groups.get(id)?.length ?? 0) > 0);
  const dense = density === "compact";
  const colors = theme.colors;
  const styles = {
    content: { padding: 12, gap: dense ? 10 : 14, flexGrow: 1 },
    column: { padding: dense ? 8 : 10, gap: 10 },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      minHeight: 28,
      flexShrink: 0,
    },
    title: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: "600" as const,
      flexShrink: 0,
    },
    count: {
      color: colors.foregroundMuted,
      backgroundColor: colors.surface2,
      borderRadius: 999,
      fontSize: 11,
      paddingHorizontal: 7,
      paddingVertical: 2,
      minWidth: 26,
      textAlign: "center" as const,
      flexShrink: 0,
    },
    arrow: { padding: 4 },
    body: { gap: dense ? 6 : 10, paddingBottom: 4 },
    more: { padding: 6, color: colors.foregroundMuted, fontSize: 12 },
  };

  function renderCard(card: FleetCard) {
    return (
      <CrewCard
        key={card.key}
        card={card}
        theme={theme}
        compact={compact}
        density={density}
        opener={watchOpener(card, props.onWatch)}
        onChanged={props.onChanged}
      />
    );
  }

  function renderColumn(id: ColumnId) {
    const entries = groups.get(id) ?? [];
    const folded = collapsed.includes(id);
    const meta = COLUMNS[id];
    const index = shown.indexOf(id);
    const body = (
      <>
        {(id === "done" ? doneCards(entries, allDone).shown : entries).map(renderCard)}
        {id === "done" && entries.length > DONE_SHOWN ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={allDone ? "Show only the latest Done cards" : `Show all ${entries.length} Done cards`}
            onPress={() => {
              allDoneShown = !allDone;
              setAllDone(!allDone);
            }}
          >
            <Text style={styles.more}>{allDone ? `Show the latest ${DONE_SHOWN}` : `Show all ${entries.length}`}</Text>
          </Pressable>
        ) : null}
      </>
    );
    return (
      <View
        key={id}
        style={[
          styles.column,
          folded
            ? {
                backgroundColor: colors.surface1,
                borderRadius: 8,
                paddingHorizontal: 6,
              }
            : null,
          compact
            ? null
            : {
                width: folded ? COLLAPSED_WIDTH : COLUMN_WIDTH,
                flexGrow: folded ? 0 : 1,
                flexShrink: 0,
              },
        ]}
      >
        <View style={folded && !compact ? { alignItems: "center", gap: 8 } : styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${folded ? "Unfold" : "Fold"} ${meta.title}`}
            accessibilityState={{ expanded: !folded }}
            aria-expanded={!folded}
            style={styles.arrow}
            onPress={() => props.onToggleColumn(id)}
          >
            <Icon name={folded ? "ChevronRight" : "ChevronDown"} size={14} color={colors.foregroundMuted} />
          </Pressable>
          <Icon name={meta.icon} size={14} color={columnTone(theme, id)} />
          {folded && !compact ? null : (
            <Text style={styles.title} numberOfLines={1}>
              {meta.title}
            </Text>
          )}
          <Text style={styles.count} numberOfLines={1}>
            {entries.length}
          </Text>
          {folded ? null : (
            <>
              <View style={{ flex: 1 }} />
              {([-1, 1] as const).map((delta) => {
                const disabled = delta === -1 ? index === 0 : index === shown.length - 1;
                const direction = compact ? (delta === -1 ? "up" : "down") : delta === -1 ? "left" : "right";
                return (
                  <Pressable
                    key={delta}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${meta.title} ${direction}`}
                    accessibilityState={{ disabled }}
                    disabled={disabled}
                    style={[styles.arrow, { opacity: disabled ? 0.3 : 0.7 }]}
                    onPress={() => props.onReorder(moveColumn(order, id, delta, shown))}
                  >
                    <Icon
                      name={
                        compact
                          ? delta === -1
                            ? "ChevronUp"
                            : "ChevronDown"
                          : delta === -1
                            ? "ChevronLeft"
                            : "ChevronRight"
                      }
                      size={13}
                      color={colors.foregroundMuted}
                    />
                  </Pressable>
                );
              })}
            </>
          )}
        </View>
        {folded ? (
          !compact ? (
            <Text
              style={{
                color: colors.foregroundMuted,
                fontSize: 11,
                width: 120,
                marginTop: 56,
                textAlign: "center",
                transform: [{ rotate: "90deg" }],
              }}
              numberOfLines={1}
            >
              {meta.title}
            </Text>
          ) : null
        ) : compact ? (
          <View style={styles.body}>{body}</View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} automaticallyAdjustKeyboardInsets>
            {body}
          </ScrollView>
        )}
      </View>
    );
  }

  if (shown.length === 0) return <Text style={styles.more}>No crew on this host.</Text>;
  return (
    <ScrollView
      testID="firstmate-board"
      horizontal={!compact}
      style={{ flex: 1 }}
      contentContainerStyle={[
        styles.content,
        compact ? { paddingBottom: 24 } : { flexDirection: "row", alignItems: "stretch" },
      ]}
      automaticallyAdjustKeyboardInsets={compact}
    >
      {shown.map(renderColumn)}
    </ScrollView>
  );
}
