import type { PluginTheme } from "@getpaseo/plugin";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import type { ComponentProps } from "react";
import { Platform, Text, View } from "react-native";

/** Shared chat measurement: one line at rest, wraps and shrinks with the draft, capped at 160. */
export function GrowingChatInput({ theme, ...props }: ComponentProps<typeof TextInput> & { theme: PluginTheme }) {
  const text = {
    color: theme.colors.foreground,
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    fontSize: 14, lineHeight: 20, paddingHorizontal: 10, paddingVertical: 10,
  };
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 40, maxHeight: 160, overflow: "hidden" }}>
      <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        aria-hidden pointerEvents="none" style={[text, { opacity: 0 }]}>
        {(props.value || props.placeholder || "") + "\u200b"}
      </Text>
      <TextInput {...props} multiline numberOfLines={1} placeholderTextColor={theme.colors.foregroundMuted}
        style={[text, { position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
          borderWidth: 0, backgroundColor: "transparent", textAlignVertical: "top" }]} />
    </View>
  );
}
