/**
 * The first mate's suggestions: one button per next step it wrote in
 * `data/suggestions.md`, each showing its label and the start of the words it
 * sends. Pressing one sends them to the first mate straight away; the caller
 * does that and brings the chat into view. Each has a trash button beside it,
 * which takes that one line out of the file without sending anything.
 *
 * A card cuts a long label to one line and its prompt to two. A chevron beside
 * the trash, shown only when something is cut (`./suggestion-fold`), opens the
 * whole suggestion below the card, wrapped and selectable, without sending it.
 *
 * SuggestionStrip occupies one line above either task layout. Overflow uses
 * SuggestionList in a host modal; full prompts and actions remain available.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";

import type { Suggestion } from "../shared/fleet";
import { chevronLabel, isCut, showsChevron } from "./suggestion-fold";
import { suggestionRemovals } from "./suggestion-removals";
import { IconButton } from "./ui";
import { webTitle } from "./web";

export const SUGGESTIONS_TITLE = "Suggestions";
export const SUGGESTIONS_ICON = "Lightbulb";

type SuggestionProps = {
  suggestions: readonly Suggestion[];
  theme: PluginTheme;
  disabled: boolean;
  onPick: (prompt: string) => void;
  onRemove: (suggestion: Suggestion) => Promise<void>;
};

/** A single line above the tasks. Overflow and full prompts open in the host's accessible modal. */
export function SuggestionStrip(props: SuggestionProps) {
  const { suggestions, theme, disabled, onPick, onRemove } = props;
  const [width, setWidth] = useState(0);
  const [more, setMore] = useState(false);
  const [opened, setOpened] = useState<Suggestion | null>(null);
  const gate = suggestionRemovals;
  useSyncExternalStore(gate.subscribe, gate.version);
  const shown = Math.max(1, Math.floor((width - 90) / 260));
  const colors = theme.colors;
  if (suggestions.length === 0) return null;
  const remove = (suggestion: Suggestion) => {
    void gate.run(suggestion, () => onRemove(suggestion));
    setOpened(null);
  };
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name={SUGGESTIONS_ICON} size={14} color={colors.foregroundMuted} />
        {suggestions.slice(0, shown).map((suggestion, index) => {
          const busy = gate.pending(suggestion);
          return (
            <View
              key={`${index}:${suggestion.label}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexShrink: 1,
                minWidth: 0,
                maxWidth: 300,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 8,
                backgroundColor: colors.surface1,
                opacity: busy ? 0.5 : 1,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${suggestion.label}: send "${suggestion.prompt}" to the first mate`}
                disabled={disabled || busy}
                accessibilityState={{ disabled: disabled || busy }}
                {...webTitle(suggestion.label)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  flexShrink: 1,
                  minWidth: 0,
                  padding: 8,
                  opacity: disabled ? 0.5 : 1,
                }}
                onPress={() => onPick(suggestion.prompt)}
              >
                <Text
                  style={{
                    color: colors.foreground,
                    fontSize: 12,
                    flexShrink: 1,
                  }}
                  numberOfLines={1}
                >
                  {suggestion.label}
                </Text>
                <Icon name="Send" size={12} color={colors.foregroundMuted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Expand suggestion: ${suggestion.label}`}
                style={{ padding: 6 }}
                onPress={() => setOpened(suggestion)}
              >
                <Icon name="ChevronDown" size={13} color={colors.foregroundMuted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove suggestion: ${suggestion.label}`}
                disabled={busy}
                accessibilityState={{ disabled: busy }}
                style={{ padding: 6 }}
                onPress={() => remove(suggestion)}
              >
                <Icon name="Trash2" size={13} color={colors.foregroundMuted} />
              </Pressable>
            </View>
          );
        })}
        {suggestions.length <= shown ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`More suggestions (${suggestions.length - shown})`}
            accessibilityState={{ expanded: more }}
            aria-expanded={more}
            onPress={() => setMore(true)}
            style={{ padding: 8, flexShrink: 0 }}
          >
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>More · {suggestions.length - shown}</Text>
          </Pressable>
        )}
      </View>
      <Modal title="More suggestions" open={more} onOpenChange={setMore}>
        <Modal.Content>
          <SuggestionList
            {...props}
            suggestions={suggestions.slice(shown)}
            onPick={(prompt) => {
              setMore(false);
              onPick(prompt);
            }}
          />
        </Modal.Content>
      </Modal>
      <Modal
        title={opened?.label ?? "Suggestion"}
        open={opened !== null}
        onOpenChange={(open) => {
          if (!open) setOpened(null);
        }}
      >
        <Modal.Content>
          <Text selectable style={{ color: colors.foreground, fontSize: 13, lineHeight: 20 }}>
            {opened?.prompt}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <IconButton
              theme={theme}
              icon="Send"
              label="Send to first mate"
              showLabel
              disabled={disabled || (opened !== null && gate.pending(opened))}
              onPress={() => {
                if (opened !== null) {
                  setOpened(null);
                  onPick(opened.prompt);
                }
              }}
            />
            <IconButton
              theme={theme}
              icon="Trash2"
              label="Remove suggestion"
              showLabel
              disabled={opened !== null && gate.pending(opened)}
              onPress={() => {
                if (opened !== null) remove(opened);
              }}
            />
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}

type CardStyles = ReturnType<typeof cardStyles>;

function cardStyles(theme: PluginTheme, disabled: boolean) {
  const { colors } = theme;
  const text = { flex: 1, minWidth: 0, gap: 2 };
  return {
    list: { gap: 8 },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.surface2,
    },
    row: { flexDirection: "row" as const, alignItems: "center" as const },
    button: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingLeft: 10,
      paddingRight: 4,
      paddingVertical: 8,
      opacity: disabled ? 0.5 : 1,
    },
    chevron: {
      alignSelf: "stretch" as const,
      justifyContent: "center" as const,
      paddingHorizontal: 6,
    },
    trash: {
      alignSelf: "stretch" as const,
      justifyContent: "center" as const,
      paddingLeft: 6,
      paddingRight: 10,
    },
    text: { ...text, overflow: "hidden" as const },
    // The same text unclamped, laid out at the same width and never seen, to measure against.
    whole: {
      ...text,
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      opacity: 0,
    },
    label: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: "600" as const,
    },
    prompt: { color: colors.foregroundMuted, fontSize: 12 },
    full: {
      color: colors.foregroundMuted,
      fontSize: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
  };
}

export function SuggestionList({
  suggestions,
  theme,
  disabled,
  onPick,
  onRemove,
}: {
  suggestions: readonly Suggestion[];
  theme: PluginTheme;
  /** A message is already on its way to the first mate. */
  disabled: boolean;
  /** Sends the prompt to the first mate. */
  onPick: (prompt: string) => void;
  /** Takes the suggestion out of the first mate's file; settles once the board has the new list. */
  onRemove: (suggestion: Suggestion) => Promise<void>;
}) {
  /** Suggestions whose removal is on its way, kept across this list's unmounts; see `./suggestion-removals`. */
  const gate = suggestionRemovals;
  useSyncExternalStore(gate.subscribe, gate.version);
  const styles = useMemo(() => cardStyles(theme, disabled), [theme, disabled]);

  function remove(suggestion: Suggestion): void {
    // The board's own handler reports a failure; the gate only needs to reopen once it settles.
    void gate.run(suggestion, () => onRemove(suggestion));
  }

  return (
    <View style={styles.list}>
      {suggestions.map((suggestion, index) => (
        <SuggestionCard
          key={`${index}:${suggestion.label}`}
          suggestion={suggestion}
          theme={theme}
          styles={styles}
          disabled={disabled}
          busy={gate.pending(suggestion)}
          onPick={() => onPick(suggestion.prompt)}
          onRemove={() => remove(suggestion)}
        />
      ))}
    </View>
  );
}

function SuggestionCard({
  suggestion,
  theme,
  styles,
  disabled,
  busy,
  onPick,
  onRemove,
}: {
  suggestion: Suggestion;
  theme: PluginTheme;
  styles: CardStyles;
  disabled: boolean;
  busy: boolean;
  onPick: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Heights of the folded text as shown and laid out whole; both come back with every change of width.
  const [shown, setShown] = useState<number | null>(null);
  const [whole, setWhole] = useState<number | null>(null);
  const muted = theme.colors.foregroundMuted;

  return (
    <View style={[styles.card, busy ? { opacity: 0.5 } : null]}>
      <View style={styles.row}>
        {/* The chevron and the trash are the send button's siblings, not its children, so neither presses it. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${suggestion.label}: send "${suggestion.prompt}" to the first mate`}
          accessibilityState={{ disabled: disabled || busy }}
          disabled={disabled || busy}
          style={styles.button}
          onPress={onPick}
        >
          {expanded ? (
            <View style={styles.text}>
              <Text style={styles.label}>{suggestion.label}</Text>
            </View>
          ) : (
            <View style={styles.text} onLayout={(event) => setShown(event.nativeEvent.layout.height)}>
              <Text style={styles.label} numberOfLines={1}>
                {suggestion.label}
              </Text>
              <Text style={styles.prompt} numberOfLines={2}>
                {suggestion.prompt}
              </Text>
              <View
                style={styles.whole}
                pointerEvents="none"
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                onLayout={(event) => setWhole(event.nativeEvent.layout.height)}
              >
                <Text style={styles.label}>{suggestion.label}</Text>
                <Text style={styles.prompt}>{suggestion.prompt}</Text>
              </View>
            </View>
          )}
          <Icon name="Send" size={14} color={muted} />
        </Pressable>
        {showsChevron(expanded, isCut(shown, whole)) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={chevronLabel(expanded, suggestion.label)}
            accessibilityState={{ expanded }}
            aria-expanded={expanded}
            style={styles.chevron}
            onPress={() => setExpanded(!expanded)}
          >
            <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={14} color={muted} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove suggestion: ${suggestion.label}`}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          hitSlop={6}
          style={styles.trash}
          onPress={onRemove}
        >
          <Icon name="Trash2" size={14} color={muted} />
        </Pressable>
      </View>
      {expanded ? (
        <Text style={styles.full} selectable>
          {suggestion.prompt}
        </Text>
      ) : null}
    </View>
  );
}
