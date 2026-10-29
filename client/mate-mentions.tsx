import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Pressable, ScrollView, Text, View, type TextInput } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { mentionAt, type MateConversation } from "./conversation-list";
import { useConversations } from "./conversation-context";

export function useMateMentions({ draft, attached, composer, theme, active }: {
  draft: string; attached: boolean; composer: RefObject<TextInput | null>; theme: PluginTheme; active: boolean;
}) {
  const controls = useConversations();
  const [caret, setCaret] = useState<number | undefined>();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [chosen, setChosen] = useState<MateConversation | null>(null);
  const [highlight, setHighlight] = useState(0);
  const choice = useRef<View>(null);
  const token = mentionAt(draft, caret);
  const tokenKey = token ? JSON.stringify([token.start, token.query]) : null;
  const open = active && !!controls && !!token && dismissed !== tokenKey;
  useEffect(() => { if (open) controls?.refresh(); }, [open]);
  const needle = token?.query.toLocaleLowerCase() ?? "";
  const matches = controls?.mates.filter(m => `${m.name} ${m.context}`.toLocaleLowerCase().includes(needle)).slice(0, 5) ?? [];
  const body = token ? (draft.slice(0, token.start) + draft.slice(token.end)).trim() : "";
  useEffect(() => { setChosen(null); setHighlight(0); }, [draft]);
  useEffect(() => { if (chosen) choice.current?.focus(); }, [chosen]);
  const close = () => { setDismissed(tokenKey); setChosen(null); composer.current?.focus(); };
  const pick = (mate: MateConversation) => { setChosen(mate); };
  // The destination owns the host-qualified key; ask it to prepare the draft.
  const carry = (mate: MateConversation) => {
    if (!controls || attached) return;
    controls.open(mate, body);
    setDismissed(tokenKey); setChosen(null);
  };
  const button = (label: string, onPress: () => void, disabled = false, ref?: RefObject<View | null>) => <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={{ minHeight: 44, padding: 10, justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, backgroundColor: theme.colors.surface1, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{label}</Text>
  </Pressable>;
  return {
    resetCaret: () => setCaret(undefined),
    onSelectionChange: (event: { nativeEvent: { selection: { start: number; end: number } } }) => setCaret(event.nativeEvent.selection.start),
    keyPress(event: { nativeEvent: { key: string; isComposing?: boolean }; preventDefault(): void }) {
      if (!open || event.nativeEvent.isComposing) return false;
      const key = event.nativeEvent.key;
      if (key === "Escape") { event.preventDefault(); close(); return true; }
      if (!chosen && (key === "ArrowDown" || key === "ArrowUp")) { event.preventDefault(); setHighlight(i => (i + (key === "ArrowDown" ? 1 : -1) + Math.max(matches.length, 1)) % Math.max(matches.length, 1)); return true; }
      if (!chosen && (key === "Enter" || key === "Tab") && matches[highlight]) { event.preventDefault(); pick(matches[highlight]!); return true; }
      return false;
    },
    panel: open ? <View testID="mate-mentions" style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, backgroundColor: theme.colors.surface1 }}>
      {chosen ? <View style={{ padding: 8, gap: 4 }}>
        <Text accessibilityRole="header" style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{chosen.name}</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{chosen.context}</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Review your message in this conversation before sending. Your FirstMate draft stays here.</Text>
        {attached ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Attachments stay with FirstMate. Open the conversation to write a separate message.</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {button(`Message ${chosen.name}`, () => carry(chosen), attached || controls.failed || !controls.snapshot?.uiEnabled, choice)}
          {button(`Open ${chosen.name} conversation`, () => { controls.open(chosen); close(); })}
          {button("Cancel mention", close)}
        </View>
      </View> : !controls.snapshot || controls.failed ? <View style={{ padding: 10 }}>
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{controls.failed ? "Conversations couldn't be checked. Try again." : "Loading conversations…"}</Text>
        {controls.failed ? button("Try conversations again", controls.refresh) : null}
        {button("Close mentions", close)}
      </View> : controls.mates.length === 0 && controls.snapshot.freshness !== "held" && !controls.snapshot.problems.length ? button("No project mates yet. Set one up", () => { controls.setup(); close(); }) : <>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 224 }}>
          {matches.map((mate, i) => <Pressable key={mate.scope.id} accessibilityRole="button" accessibilityLabel={`${mate.name}. ${mate.context}`} accessibilityState={{ selected: i === highlight }} onPress={() => pick(mate)}
            style={{ minHeight: 44, padding: 10, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: i === highlight ? theme.colors.surface2 : undefined }}>
            <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{mate.name}</Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{mate.context}</Text>
            </View>
            <Icon name="ChevronRight" size={16} color={theme.colors.foregroundMuted} />
          </Pressable>)}
          {!matches.length ? <Text style={{ padding: 10, color: theme.colors.foregroundMuted, fontSize: 13 }}>{controls.snapshot.freshness === "held" || controls.snapshot.problems.length ? "Some conversations couldn't be checked. Try again." : "No matching mates. Try a project or plan name."}</Text> : null}
        </ScrollView>
        {button("Close mentions", close)}
      </>}
    </View> : null,
  };
}
