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
import { decisionCardSnapshot } from "../shared/plan-decisions";
import { decisionQueue, indicatorState, type DecisionDestination } from "./needs-you-state";
import { deckDecisionDestination } from "./deck-decisions";
import type { DeckHover } from "./deck-hover";
import { useWorkflowPlans } from "./workflow-plans";
import { FIRST_MATE_KEY } from "./deck-first-mate";
import { ASK_PAPER, askPixels, ASK_SIZE, hexColour } from "./deck-badges";
import { answeredReplies, type BubblePlacement } from "./deck-replies";
import { suggestionRemovals } from "./suggestion-removals";
import type { DeckSailor } from "./deck-scene";
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
  const state = indicatorState(snapshot), { colors } = theme;
  if (anchor.key !== FIRST_MATE_KEY || state.count === null || state.count === 0) return null;
  const width = Math.max(32, String(state.count).length * 8 + 18);
  return <Pressable ref={holdRef} accessibilityRole="button" accessibilityLabel={state.accessibilityLabel}
    accessibilityState={{ expanded: open, disabled }} aria-expanded={open} onPress={onPress} disabled={disabled}
    testID="firstmate-deck-decision-tag"
    style={{ position: "absolute", left: Math.max(4, Math.min(anchor.width - width - 4, anchor.x - width / 2)),
      top: Math.max(4, anchor.top - 38), width, alignItems: "center", paddingVertical: 5,
      borderWidth: 1, borderRadius: 8, borderStyle: state.stale ? "dashed" : "solid",
      borderColor: colors.accent, backgroundColor: colors.surface0 }}>
    <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{state.count}</Text>
    <SpeechTail theme={theme} left={width / 2 - 4} above size={8} border={1} />
  </Pressable>;
}

/** All current decisions, including visible workers and due plan decisions, without acknowledging on open. */
export function NeedsYouBubbles({ snapshot, place, theme, holdRef, onClose, onOpen }: {
  snapshot: NeedsYouSnapshot; place: BubblePlacement; theme: PluginTheme; holdRef: Ref<View>;
  onClose(): void; onOpen(destination: DecisionDestination): void;
}) {
  const plans = useWorkflowPlans();
  const projected = decisionCardSnapshot(snapshot);
  const requests = decisionQueue(projected.requests).filter(request => request.state === "new" || request.state === "seen");
  const reviews = snapshot.planNow?.filter(need => !need.node) ?? [];
  const { colors } = theme;
  return <DeckPopover title="Needs you" label="First mate needs you" testID="firstmate-deck-needs-you"
    place={place} theme={theme} holdRef={holdRef} onClose={onClose}>
    {requests.map(request => <Pressable key={request.id} accessibilityRole="button" accessibilityLabel={`Open decision: ${request.source.title}`}
      onPress={() => onOpen(deckDecisionDestination(projected, request.id))}
      style={{ padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface1 }}>
      <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{request.source.title}</Text>
    </Pressable>)}
    {reviews.map(need => <Pressable key={need.plan} accessibilityRole="button" accessibilityLabel={`Review plan: ${need.title}`}
      onPress={() => { onClose(); plans.open(need.plan); }}
      style={{ padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface1 }}>
      <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{need.title}</Text>
    </Pressable>)}
    {requests.length || reviews.length ? null : <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Nothing needs you right now.</Text>}
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

/** The reply marker, drawn as on deck, `pixel` points an art pixel: the legend's key to it. */
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

/** One reply as a chip in the bubble. */
function ReplyChip({ reply, theme, blocked, onReply }: { reply: Suggestion; theme: PluginTheme; blocked: string | null; onReply: (reply: Suggestion) => void }) {
  const { colors } = theme;
  const disabled = blocked !== null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={replyLabel(reply)}
      accessibilityHint={blocked ?? undefined}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onReply(reply)}
      {...webTitle(blocked ?? reply.prompt)}
      style={{
        maxWidth: "100%",
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.accent,
        backgroundColor: colors.surface1,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>
        {reply.label}
      </Text>
    </Pressable>
  );
}

/** The tail's square, turned to a point: its two bordered sides are the bubble's edge, carried out to the tip. */
const TAIL = 12;

function SpeechTail({ theme, left, above, size = TAIL, border = 2 }: {
  theme: PluginTheme; left: number; above: boolean; size?: number; border?: number;
}) {
  return <View style={{ pointerEvents: "none", position: "absolute", left,
    ...(above ? { bottom: -size / 2 + 1 } : { top: -size / 2 + 1 }), width: size, height: size,
    backgroundColor: theme.colors.surface0, borderColor: theme.colors.accent,
    ...(above ? { borderRightWidth: border, borderBottomWidth: border } : { borderLeftWidth: border, borderTopWidth: border }),
    transform: [{ rotate: "45deg" }] }} />;
}

/**
 * A sailor's speech bubble, laid over the canvas at `place`. `holdRef` is the bubble's element, for keeping
 * Tab inside the focused sailor's bubble and panel; `onHover` hears the pointer come and go, so the pane keeps
 * the bubble up while the pointer crosses from the sailor to its chips. The pointer is read with the DOM's own
 * enter and leave, which a child does not interrupt: react-native-web's Pressable ends its own hover when the
 * pointer reaches a Pressable inside it, here a chip, which took the bubble down just as it was used.
 */
export function ReplyBubble({
  sailor,
  replies,
  place,
  theme,
  blocked,
  onReply,
  onHover,
  holdRef,
}: {
  sailor: DeckSailor;
  replies: readonly Suggestion[];
  place: BubblePlacement;
  theme: PluginTheme;
  blocked: string | null;
  onReply: (reply: Suggestion) => void;
  onHover: (over: boolean) => void;
  holdRef?: Ref<View>;
}) {
  if (sailor.key !== FIRST_MATE_KEY) return null;
  const { colors } = theme;
  const above = place.side === "above";
  const line = sailor.caption.line ?? sailor.caption.status;
  return (
    <View
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      testID="firstmate-deck-bubble"
      style={{
        position: "absolute",
        left: place.left,
        width: place.width,
        ...(place.top === undefined ? { bottom: place.bottom } : { top: place.top }),
      }}
    >
      <View
        ref={holdRef}
        role="group"
        aria-label={`${sailor.caption.title} wants your reply`}
        style={{
          maxHeight: place.maxHeight,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: colors.accent,
          backgroundColor: colors.surface0,
          overflow: "hidden",
        }}
      >
        <ScrollView style={{ maxHeight: Math.max(0, place.maxHeight - 4) }} contentContainerStyle={{ padding: 10, gap: 6 }}>
          <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
            {sailor.caption.title}
          </Text>
          <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>
            {line}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {replies.map((reply) => (
              <ReplyChip key={`${reply.label}\u0000${reply.prompt}`} reply={reply} theme={theme} blocked={blocked} onReply={onReply} />
            ))}
          </View>
          {blocked === null ? null : <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{blocked}</Text>}
        </ScrollView>
      </View>
      <SpeechTail theme={theme} left={place.tail - TAIL / 2} above={above} />
    </View>
  );
}

/**
 * The focused sailor's replies in its panel: the roomy, keyboard route to the same sends as the bubble's
 * chips, each with the start of what it says. The card's own `extra`, under its glance.
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
