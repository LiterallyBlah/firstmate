import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

/** Copy deadlines only. They never classify a source or retry an effect. */
export function ReadProgress({ theme, pending, pendingSince, quietInitially = false, failed = false, fetching = false, label = "Getting FirstMate ready…", details, onRetry }: {
  theme: PluginTheme; pending: boolean; failed?: boolean; fetching?: boolean;
  pendingSince?: number | undefined; quietInitially?: boolean;
  label?: string; details?: string | undefined; onRetry?: (() => void) | undefined;
}) {
  const [localStart, setLocalStart] = useState(Date.now), [, tick] = useState(0), [expanded, setExpanded] = useState(false);
  const startedAt = pendingSince ?? localStart;
  const elapsed = Date.now() - startedAt;
  const stage = elapsed >= 30000 ? 2 : elapsed >= 8000 ? 1 : 0;
  useEffect(() => { setLocalStart(Date.now()); }, [pending, failed]);
  useEffect(() => {
    if (!pending || failed) return;
    const redraw = () => tick(value => value + 1);
    const slow = Date.now() < startedAt + 8000 ? setTimeout(redraw, startedAt + 8000 - Date.now()) : undefined;
    const delayed = Date.now() < startedAt + 30000 ? setTimeout(redraw, startedAt + 30000 - Date.now()) : undefined;
    return () => { clearTimeout(slow); clearTimeout(delayed); };
  }, [pending, failed, startedAt]);
  if ((!pending && !failed) || (quietInitially && !failed && stage === 0)) return null;
  const color = failed ? theme.colors.statusDanger : theme.colors.foregroundMuted;
  const message = failed ? "Can't connect to FirstMate right now. Try again."
    : stage > 0 ? "FirstMate is taking a little longer to start. We'll keep checking." : label;
  return <View style={{ padding: 12, gap: 8 }}>
    <Text accessibilityLiveRegion="polite" style={{ color, fontSize: 13 }}>{message}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {(failed || stage === 2) && onRetry ? <Pressable accessibilityRole="button" accessibilityLabel="Try again" accessibilityState={{ disabled: failed && fetching }}
        disabled={failed && fetching} onPress={onRetry} style={{ minWidth: 44, minHeight: 44, padding: 8, justifyContent: "center", opacity: failed && fetching ? 0.5 : 1 }}>
        <Text style={{ color: theme.colors.foreground, textDecorationLine: "underline" }}>Try again</Text>
      </Pressable> : null}
      {failed || stage > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Connection details" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}
        style={{ minWidth: 44, minHeight: 44, padding: 8, justifyContent: "center" }}>
        <Text style={{ color: theme.colors.foreground, textDecorationLine: "underline" }}>Connection details</Text>
      </Pressable> : null}
    </View>
    {expanded ? <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{details ?? (failed ? "Could not read FirstMate from the host. Checking again only reads status." : "Waiting for the host to finish reading saved work. Checking again only reads status.")}</Text> : null}
  </View>;
}
