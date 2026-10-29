import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import type { ScopedCaptainDecision } from "../shared/scoped-captain-decision";
/** B/D use the same presentation, with their own checked answer transport. No fallback sender. */
export function ScopedCaptainDecisionDetails({ decision, theme, selected = "", onSelect, disabled = true }: {
  decision: ScopedCaptainDecision; theme: PluginTheme; selected?: string; onSelect?: ((id: string) => void) | undefined; disabled?: boolean;
}) {
  return <View testID="scoped-captain-decision" style={{ gap: 8 }}>
    <Text style={{ color: theme.colors.foreground }}>{decision.question}</Text>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{decision.origin.kind} · {decision.origin.id} · {decision.scope.kind} scope</Text>
    {decision.options.map(o => <Pressable key={o.id} accessibilityRole="button" accessibilityLabel={`${selected === o.id ? "Selected: " : ""}${o.label}`}
      disabled={disabled || !onSelect} accessibilityState={{ disabled: disabled || !onSelect, selected: selected === o.id }} onPress={() => onSelect?.(o.id)}
      style={{ minHeight: 44, padding: 10, justifyContent: "center", borderWidth: 1, borderColor: selected === o.id ? theme.colors.accent : theme.colors.border,
        borderRadius: 7, opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: theme.colors.foreground }}>{o.number}. {o.label}{decision.recommendation === o.id ? " · Recommended" : ""}</Text>
    </Pressable>)}
    <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Evidence: {decision.evidence.map(e => `${e.ref}${e.digest ? ` (${e.digest.slice(0, 12)})` : ""}`).join(", ")}</Text>
  </View>;
}
