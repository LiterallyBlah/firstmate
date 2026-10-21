import type { PluginTheme } from "@getpaseo/plugin";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

/** The same collapsed disclosure for native watch notifications and Bearings. */
export function MachineNoteDetails({ summary, original, theme }: { summary: string; original: string; theme: PluginTheme }) {
  const [expanded, setExpanded] = useState(false);
  const colors = theme.colors;
  return (
    <View style={{ paddingVertical: 6, gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Hide" : "Show"} original: ${summary}`}
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => ({
          paddingVertical: 8,
          paddingHorizontal: 10,
          minHeight: 44,
          borderRadius: 6,
          backgroundColor: pressed ? colors.surface2 : colors.surface1,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        })}
      >
        <Text
          numberOfLines={2}
          style={{
            color: colors.foregroundMuted,
            fontSize: 13,
            lineHeight: 18,
            flex: 1,
          }}
        >
          {summary}
        </Text>
        <Text style={{ color: colors.foreground, fontSize: 12 }}>
          {expanded ? "Hide original" : "Show original"}
        </Text>
      </Pressable>
      {expanded ? (
        <Text
          selectable
          style={{
            color: colors.foreground,
            fontSize: 13,
            lineHeight: 20,
            paddingHorizontal: 10,
          }}
        >
          {original}
        </Text>
      ) : null}
    </View>
  );
}
