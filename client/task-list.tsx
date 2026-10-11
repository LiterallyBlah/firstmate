/** A single scrolling list, grouped by what needs attention rather than saved column order. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { FleetCard } from "../shared/fleet";
import type { BoardDensity } from "../shared/settings";
import { CrewCard } from "./card";
import { doneCards, LIST_GROUPS, listGroups } from "./format";
import { watchKey } from "./host-tabs";

let doneExpanded = false;

export function TaskList({
  cards,
  theme,
  compact,
  density,
  onWatch,
  onChanged,
}: {
  cards: readonly FleetCard[];
  theme: PluginTheme;
  compact: boolean;
  density: BoardDensity;
  onWatch: (key: string) => void;
  onChanged: () => void;
}) {
  const groups = useMemo(() => listGroups(cards), [cards]);
  const [showDone, setShowDone] = useState(doneExpanded);
  const colors = theme.colors;
  const heading = {
    color: colors.foregroundMuted,
    fontSize: 12,
    fontWeight: "600" as const,
  };

  return (
    <ScrollView
      testID="firstmate-task-list"
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: compact ? 10 : 16, paddingBottom: 24 }}
      automaticallyAdjustKeyboardInsets
    >
      {cards.length === 0 ? <Text style={heading}>No crew on this host.</Text> : null}
      {LIST_GROUPS.map(({ id, title }) => {
        const entries = groups.get(id) ?? [];
        if (entries.length === 0) return null;
        return (
          <View key={id} style={{ marginBottom: 18 }}>
            {id === "done" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${entries.length} done. ${showDone ? "Hide" : "Show"} completed tasks`}
                accessibilityState={{ expanded: showDone }}
                aria-expanded={showDone}
                onPress={() => {
                  doneExpanded = !showDone;
                  setShowDone(!showDone);
                }}
                style={{ paddingVertical: 8 }}
              >
                <Text style={heading}>
                  {entries.length} done · {showDone ? "Hide" : "Show"}
                </Text>
              </Pressable>
            ) : (
              <Text accessibilityRole="header" style={[heading, { paddingVertical: 8 }]}>
                {title} · {entries.length}
              </Text>
            )}
            {id === "done" && !showDone
              ? null
              : (id === "done" ? doneCards(entries, true).shown : entries).map((card) => {
                  const key = watchKey(card);
                  return (
                    <CrewCard
                      key={card.key}
                      card={card}
                      theme={theme}
                      compact={compact}
                      density={density}
                      presentation="row"
                      opener={
                        key === null
                          ? null
                          : {
                              icon: "Eye",
                              label: "Watch",
                              tooltip: card.remote === undefined
                                ? "View this worker's live activity within FirstMate."
                                : "View this remote worker's recent log within FirstMate.",
                              onPress: () => onWatch(key),
                            }
                      }
                      onChanged={onChanged}
                    />
                  );
                })}
          </View>
        );
      })}
    </ScrollView>
  );
}
