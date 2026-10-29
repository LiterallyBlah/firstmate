import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import { useState } from "react";
import type { ScopedCaptainDecision } from "../shared/scoped-captain-decision";
/** B/D use the same presentation, with their own checked answer transport. No fallback sender. */
export function ScopedCaptainDecisionDetails({ decision, theme, selected = "", onSelect, disabled = true, showDetails, showQuestion = true }: {
  decision: ScopedCaptainDecision; theme: PluginTheme; selected?: string; onSelect?: ((id: string) => void) | undefined; disabled?: boolean;
  showDetails?: boolean; showQuestion?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const details = showDetails ?? expanded;
  return <View testID="scoped-captain-decision" style={{ gap: 8 }}>
    {showQuestion ? <Text style={{ color: theme.colors.foreground }}>{decision.question}</Text> : null}
    {decision.options.map(o => <Pressable key={o.id} accessibilityRole="button" accessibilityLabel={`${selected === o.id ? "Selected: " : ""}${o.label}`}
      disabled={disabled || !onSelect} accessibilityState={{ disabled: disabled || !onSelect, selected: selected === o.id }} onPress={() => onSelect?.(o.id)}
      style={{ minHeight: 44, padding: 10, justifyContent: "center", borderWidth: 1, borderColor: selected === o.id ? theme.colors.accent : theme.colors.border,
        borderRadius: 7, opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: theme.colors.foreground }}>{o.number}. {o.label}{decision.recommendation === o.id ? " · Recommended" : ""}</Text>
    </Pressable>)}
    {showDetails === undefined ? <Pressable accessibilityRole="button" accessibilityLabel={`Details: ${decision.title}`} accessibilityState={{ expanded }} onPress={() => setExpanded(v => !v)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: theme.colors.foreground }}>Details</Text></Pressable> : null}
    {details ? <>
      <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{decision.origin.kind} · {decision.origin.id} · {decision.scope.kind} scope · {decision.scope.id}</Text>
      <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Evidence: {decision.evidence.map(e => `${e.ref}${e.digest ? ` (${e.digest})` : ""}`).join(", ")}</Text>
    </> : null}
  </View>;
}
