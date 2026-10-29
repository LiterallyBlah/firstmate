import type { PluginTheme } from "@getpaseo/plugin";
import { useState } from "react";
import { Pressable, Text } from "react-native";

/** Native focus and large wrapping targets for setup/review actions. */
export function SetupButton({ theme, label, disabled = false, onPress }: { theme: PluginTheme; label: string; disabled?: boolean; onPress(): void }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onPress}
    style={{ minHeight: 44, maxWidth: "100%", minWidth: 0, flexShrink: 1, paddingHorizontal: 12, paddingVertical: 10, justifyContent: "center",
      borderWidth: 2, borderColor: focused ? theme.colors.accent : theme.colors.border, borderRadius: 8, backgroundColor: theme.colors.surface1, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 14, flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}
