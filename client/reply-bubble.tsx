/**
 * Shared Deck popovers and speech-bubble chrome. Only the reserved first mate wears a count bubble;
 * workers retain linked replies in their focus panels. Suggestions still send through the board's own
 * handler, gate and failure toast. Opening a popover never sends or acknowledges anything.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useSyncExternalStore, type ReactNode, type Ref } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { Suggestion } from "../shared/fleet";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { decisionCardSnapshot, planReviewFor } from "../shared/plan-decisions";
import { decisionQueue, indicatorState, type DecisionDestination } from "./needs-you-state";
import { useDecisionReadState } from "./decision-read-context";
import { deckDecisionDestination } from "./deck-decisions";
import type { DeckHover } from "./deck-hover";
import { useWorkflowPlans } from "./workflow-plans";
import { FIRST_MATE_KEY } from "./deck-first-mate";
import { ASK_PAPER, askPixels, ASK_SIZE, hexColour } from "./deck-badges";
import { answeredReplies, type BubblePlacement } from "./deck-replies";
import { suggestionRemovals } from "./suggestion-removals";
import { webTitle } from "./web";

/** The same anchored, scrollable dialog for the shark and the first mate. */
function DeckPopover({ title, label, testID, place, theme, holdRef, onClose, children }: {
  title: string; label: string; testID: string; place: BubblePlacement; theme: PluginTheme;
  holdRef: Ref<View>; onClose(): void; children: ReactNode;
}) {
  const { colors } = theme;
  return <View ref={holdRef} role="dialog" aria-label={label} tabIndex={-1} testID={testID}
    style={{ position: "absolute", left: place.left, width: place.width,
      ...(place.top === undefined ? { bottom: place.bottom } : { top: place.top }),
      maxHeight: place.maxHeight, padding: 8, gap: 8, borderRadius: 12,
      borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface0 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title.toLowerCase()}`} onPress={onClose} style={{ padding: 4 }}>
        <Text style={{ color: colors.foreground }}>×</Text>
      </Pressable>
    </View>
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 5 }}>{children}</ScrollView>
  </View>;
}

/** Only the reserved first mate gets this count; workers keep their state badges. */
export function DecisionCountBubble({ snapshot, anchor, theme, holdRef, open, disabled, onPress }: {
  snapshot: NeedsYouSnapshot; anchor: DeckHover; theme: PluginTheme; holdRef: Ref<View>;
  open: boolean; disabled: boolean; onPress(): void;
}) {
  const read = useDecisionReadState();
  const state = indicatorState(snapshot, false, read), { colors } = theme;
  if (anchor.key !== FIRST_MATE_KEY || state.count === null || state.count === 0) return null;
  const width = Math.max(32, String(state.count).length * 8 + 18);
  return <Pressable ref={holdRef} accessibilityRole="button" accessibilityLabel={state.accessibilityLabel}
    accessibilityState={{ expanded: open, disabled }} aria-expanded={open} onPress={onPress} disabled={disabled}
    testID="firstmate-deck-decision-tag"
    style={{ position: "absolute", left: Math.max(4, Math.min(anchor.width - width - 4, anchor.x - width / 2)),
      top: Math.max(4, anchor.top - 38), width, alignItems: "center", paddingVertical: 5,
      borderWidth: 1, borderRadius: 8, borderStyle: state.stale ? "dashed" : "solid",
      borderColor: colors.accent, backgroundColor: colors.surface0 }}>
    <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{state.badge}</Text>
    <SpeechTail theme={theme} left={width / 2 - 4} />
  </Pressable>;
}

/** All current decisions, including visible workers and due plan decisions, without acknowledging on open. */
export function NeedsYouBubbles({ snapshot, place, theme, holdRef, onClose, onOpen }: {
  snapshot: NeedsYouSnapshot; place: BubblePlacement; theme: PluginTheme; holdRef: Ref<View>;
  onClose(): void; onOpen(destination: DecisionDestination): void;
}) {
  const plans = useWorkflowPlans();
  const read = useDecisionReadState();
  const state = indicatorState(snapshot, false, read);
  const projected = decisionCardSnapshot(snapshot);
  const requests = decisionQueue(projected.requests).filter(request => request.state === "new" || request.state === "seen");
  // The server also counts unreadable held tasks that cannot become ordinary decision rows.
  const remaining = Math.max(0, (snapshot.actionCount ?? 0) - requests.length);
  const { colors } = theme;
  return <DeckPopover title="Needs you" label="First mate needs you" testID="firstmate-deck-needs-you"
    place={place} theme={theme} holdRef={holdRef} onClose={onClose}>
    {requests.map(request => <Pressable key={request.id} accessibilityRole="button" accessibilityLabel={`${planReviewFor(snapshot, request.id) ? "Review plan" : "Open decision"}: ${request.source.title}`}
      onPress={() => { const review = planReviewFor(snapshot, request.id); if (review) { onClose(); plans.open(review.plan); } else onOpen(deckDecisionDestination(projected, request.id)); }}
      style={{ padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface1 }}>
      <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{request.source.title}</Text>
    </Pressable>)}
    {remaining === 0 ? null : <Pressable accessibilityRole="button" accessibilityLabel={`Open Needs you: ${remaining} more item${remaining === 1 ? "" : "s"}`}
      onPress={() => onOpen(deckDecisionDestination(snapshot, "all"))}
      style={{ padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface1 }}>
      <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{remaining} more {remaining === 1 ? "item" : "items"} · open Needs you</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Open Needs you for the rest.</Text>
    </Pressable>}
    {requests.length || remaining ? null : <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{state.count === 0 && state.fresh ? "Nothing needs you right now." : state.label}</Text>}
  </DeckPopover>;
}

/** The shark's full list, in strip order. Picked entries stay visible until the file changes. */
export function SuggestionBubbles({ suggestions, place, theme, blocked, onReply, onRemove, holdRef, onClose }: {
  suggestions: readonly Suggestion[];
  place: BubblePlacement;
  theme: PluginTheme;
  blocked: string | null;
  onReply: (reply: Suggestion) => void;
  onRemove?: ((suggestion: Suggestion) => Promise<void>) | undefined;
  holdRef: Ref<View>;
  onClose: () => void;
}) {
  useSyncExternalStore(answeredReplies.subscribe, answeredReplies.version);
  useSyncExternalStore(suggestionRemovals.subscribe, suggestionRemovals.version);
  const { colors } = theme;
  return (
    <DeckPopover title="Suggestions" label="Shark suggestions" testID="firstmate-deck-suggestions"
      place={place} theme={theme} holdRef={holdRef} onClose={onClose}>
        {suggestions.length === 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Nothing to suggest right now.</Text> : suggestions.map((suggestion, index) => {
          const reason = blocked ?? (suggestionRemovals.pending(suggestion) ? "This suggestion is being removed." : answeredReplies.has(suggestion) ? "Sent to the first mate." : null);
          const removing = suggestionRemovals.pending(suggestion);
          return <View key={`${index}:${suggestion.label}`} style={{ paddingBottom: 4, flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={replyLabel(suggestion)}
              disabled={reason !== null} accessibilityState={{ disabled: reason !== null }} accessibilityHint={reason ?? undefined}
              onPress={() => onReply(suggestion)} {...webTitle(reason ?? suggestion.prompt)}
              style={{ flex: 1, minWidth: 0, padding: 10, gap: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.accent,
                backgroundColor: colors.surface1, opacity: reason === null ? 1 : 0.6 }}>
              <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{suggestion.label}</Text>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{suggestion.prompt}</Text>
              {reason === null ? null : <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{reason}</Text>}
            </Pressable>
            {onRemove === undefined ? null : <Pressable
              accessibilityRole="button" accessibilityLabel="Dismiss suggestion"
              accessibilityHint={suggestion.label}
              disabled={removing} accessibilityState={{ disabled: removing }}
              onPress={() => { void suggestionRemovals.run(suggestion, () => onRemove(suggestion)); }}
              {...webTitle(`Dismiss suggestion: ${suggestion.label}`)}
              style={{ padding: 8, opacity: removing ? 0.5 : 1 }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 16 }}>×</Text>
            </Pressable>}
            <View style={{ pointerEvents: "none", position: "absolute", bottom: 0, left: 18, width: 8, height: 8,
              transform: [{ rotate: "45deg" }], backgroundColor: colors.surface1,
              borderColor: colors.accent, borderRightWidth: 1, borderBottomWidth: 1 }} />
          </View>;
        })}
    </DeckPopover>
  );
}

/** Reply icon inside the worker focus panel; never mounted over a worker sprite. */
export function DeckAskMarker({ accent, pixel = 2 }: { accent: string; pixel?: number }) {
  const paper = `#${ASK_PAPER.toString(16).padStart(6, "0")}`;
  const dot = `#${hexColour(accent).toString(16).padStart(6, "0")}`;
  return (
    <View style={{ width: ASK_SIZE.width * pixel, height: ASK_SIZE.height * pixel }}>
      {askPixels().map((each) => (
        <View
          key={`${each.x}:${each.y}`}
          style={{
            position: "absolute",
            left: each.x * pixel,
            top: each.y * pixel,
            width: pixel,
            height: pixel,
            backgroundColor: each.kind === "bubble" ? paper : dot,
          }}
        />
      ))}
    </View>
  );
}

/** What a reply's button is called for a screen reader: the strip's own words. */
export function replyLabel(reply: Suggestion): string {
  return `${reply.label}: send "${reply.prompt}" to the first mate`;
}

/** The count bubble's tail, in the same theme surface and accent as its outline. */
function SpeechTail({ theme, left }: { theme: PluginTheme; left: number }) {
  return <View style={{ pointerEvents: "none", position: "absolute", left, bottom: -3, width: 8, height: 8,
    backgroundColor: theme.colors.surface0, borderColor: theme.colors.accent,
    borderRightWidth: 1, borderBottomWidth: 1, transform: [{ rotate: "45deg" }] }} />;
}

/**
 * The focused sailor's replies in its panel, each with the start of what it says.
 * These use the board's existing send handler and disabled reason.
 */
export function ReplyOptions({
  replies,
  theme,
  blocked,
  onReply,
}: {
  replies: readonly Suggestion[];
  theme: PluginTheme;
  blocked: string | null;
  onReply: (reply: Suggestion) => void;
}): ReactNode {
  const { colors } = theme;
  if (replies.length === 0) return null;
  const disabled = blocked !== null;
  return (
    <View testID="firstmate-deck-replies" style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <DeckAskMarker accent={colors.accent} pixel={2} />
        <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>
          {replies.length === 1 ? "A reply for the first mate" : "Replies for the first mate"}
        </Text>
      </View>
      {replies.map((reply) => (
        <Pressable
          key={`${reply.label}\u0000${reply.prompt}`}
          accessibilityRole="button"
          accessibilityLabel={replyLabel(reply)}
          accessibilityHint={blocked ?? undefined}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => onReply(reply)}
          {...webTitle(blocked ?? reply.prompt)}
          style={{
            gap: 2,
            padding: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.accent,
            backgroundColor: colors.surface1,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>
            {reply.label}
          </Text>
          <Text numberOfLines={2} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
            {reply.prompt}
          </Text>
        </Pressable>
      ))}
      {blocked === null ? null : <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{blocked}</Text>}
    </View>
  );
}
