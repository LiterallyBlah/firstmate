import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { MateConversation } from "./conversation-list";
import { bindWebKeys } from "./web";

export function ConversationSwitcher({ theme, mates, current, counts, failed, onSelect, onBack, onExpand }: {
  theme: PluginTheme; mates: MateConversation[]; current: string; counts: Record<string, number | null>;
  failed: boolean; onSelect(mate: MateConversation): void; onBack(): void; onExpand(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<View>(null), first = useRef<View>(null), root = useRef<View>(null);
  useEffect(() => { if (expanded) first.current?.focus(); }, [expanded]);
  const label = mates.find(m => m.scope.id === current)?.name ?? (current === "general" ? "FirstMate" : "Selected conversation");
  const close = () => { setExpanded(false); trigger.current?.focus(); };
  useEffect(() => expanded ? bindWebKeys(root.current, key => { if (key !== "Escape") return false; close(); return true; }) : undefined, [expanded]);
  const unread = Object.values(counts).reduce<number>((sum, count) => sum + (count ?? 0), 0);
  return <View ref={root} onAccessibilityEscape={close} testID="conversation-switcher" style={{ paddingHorizontal: 10, borderBottomWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface0 }}>
    <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={`Conversations: ${label}${unread ? `, ${unread} unread` : ""}`} accessibilityState={{ expanded }} onPress={() => { if (!expanded) onExpand(); setExpanded(v => !v); }}
      style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name="MessagesSquare" size={16} color={theme.colors.foregroundMuted} />
      <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }}>{label}{unread ? ` · ${unread} unread` : ""}</Text>
      <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={14} color={theme.colors.foregroundMuted} />
    </Pressable>
    {expanded ? <View>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 264 }}>
        {[{ id: "general", name: "FirstMate", context: "Your main conversation", mate: null }, ...mates.map(m => ({ id: m.scope.id, name: m.name, context: m.context, mate: m }))].map((item, i) => {
          const count = counts[item.id];
          const detail = count == null ? "Unread unavailable" : `${count} unread`;
          return <Pressable ref={i === 0 ? first : undefined} key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name}, ${detail}`} accessibilityState={{ selected: current === item.id }}
            onPress={() => { close(); if (item.mate) onSelect(item.mate); else onBack(); }}
            style={{ minHeight: 44, padding: 10, gap: 2, backgroundColor: current === item.id ? theme.colors.surface2 : undefined }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{item.name}{count ? ` · ${count} unread` : ""}</Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{item.context}{count == null ? " · Unread unavailable" : ""}</Text>
          </Pressable>;
        })}
      </ScrollView>
      {failed ? <Text style={{ padding: 10, color: theme.colors.foregroundMuted, fontSize: 12 }}>Some conversations couldn't be checked.</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Close conversations" onPress={close} style={{ minHeight: 44, padding: 10, justifyContent: "center" }}><Text style={{ color: theme.colors.foreground }}>Close conversations</Text></Pressable>
    </View> : null}
  </View>;
}
