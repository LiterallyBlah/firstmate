import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import { useEffect, useId, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { indicatorState, decisionSession } from "./needs-you-state";
import { webAttributes, webSurfaceVisible } from "./web";
import { useOpenDecision, type OpenDecision } from "./decision-action";
import { decisionSignalInk } from "./decision-copy";
import { useDecisionReadState } from "./decision-read-context";
import type { DecisionReadState } from "./decision-read-state";

/** Keep visible decision surfaces quiet even when they have no header indicator. */
export function useDecisionVisibility(enabled = true) {
  const ref = useRef<unknown>(null);
  const session = decisionSession(useQueryClient());
  useEffect(() => {
    if (!enabled) return;
    const visible = () => webSurfaceVisible(ref.current);
    session.surfaces.add(visible);
    return () => {
      session.surfaces.delete(visible);
    };
  }, [session, enabled]);
  return ref;
}

export function NeedsYouIndicator({
  theme,
  snapshot,
  offline = false,
  compact = false,
  onOpen,
  readState,
}: {
  theme: PluginTheme;
  snapshot?: NeedsYouSnapshot | undefined;
  offline?: boolean;
  compact?: boolean;
  onOpen?: OpenDecision;
  readState?: DecisionReadState;
}) {
  const action = useOpenDecision();
  const ref = useDecisionVisibility();
  const id = `needs-you-${useId()}`;
  const read = useDecisionReadState();
  const state = indicatorState(snapshot, offline, readState ?? read);
  // Drawn like the header's buttons (`IconButton`): 8-point corners, a 12-point label. The
  // signal is the outline, the fill and the icon; the words keep the foreground colour.
  const signal = state.unavailable
    ? theme.colors.statusDanger
    : state.amber
      ? theme.colors.statusWarning
      : null;
  const ink = state.filled
    ? decisionSignalInk(theme.colors.surface0, theme.colors.foreground, theme.colors.statusWarning)
    : theme.colors.foreground;
  return (
    <Pressable
      ref={(node) => {
        ref.current = node;
        webAttributes({ title: state.accessibilityLabel }).ref?.(node);
      }}
      nativeID={id}
      accessibilityRole="button"
      accessibilityLabel={state.accessibilityLabel}
      onPress={() =>
        (onOpen ?? action)(
          {
            requestId: "next",
            ...(snapshot?.homeId ? { homeId: snapshot.homeId } : {}),
          },
          id,
        )
      }
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        minHeight: 44,
        paddingHorizontal: compact ? 12 : 10,
        paddingVertical: 5,
        borderWidth: 1,
        borderColor: signal ?? theme.colors.border,
        borderRadius: 8,
        borderStyle: state.stale ? "dashed" : "solid",
        backgroundColor: state.filled
          ? theme.colors.statusWarning
          : theme.colors.surface1,
        ...(compact
          ? { alignSelf: "stretch" as const, width: "100%" as const }
          : {}),
      }}
    >
      <Icon
        name={state.loading || state.updating ? "Clock" : state.unavailable ? "TriangleAlert" : state.amber ? "Bell" : "Check"}
        size={14}
        color={state.filled ? ink : (signal ?? theme.colors.foregroundMuted)}
      />
      <Text
        numberOfLines={compact ? 2 : 1}
        style={{
          flexShrink: 1,
          color: ink,
          fontSize: compact ? 13 : 12,
          fontWeight: signal === null ? "500" : "600",
        }}
      >
        {state.label}
        {state.fresh && state.newCount > 0 ? ` · ${state.newCount} new` : ""}
      </Text>
    </Pressable>
  );
}
export function NeedsYouBadge({
  theme,
  snapshot,
  offline = false,
  readState,
}: {
  theme: PluginTheme;
  snapshot?: NeedsYouSnapshot | undefined;
  offline?: boolean;
  readState?: DecisionReadState;
}) {
  const read = useDecisionReadState();
  const state = indicatorState(snapshot, offline, readState ?? read);
  if (state.count === 0 && state.fresh && !snapshot?.freshness.problems.length)
    return null;
  return (
    <View
      accessibilityLabel={state.accessibilityLabel}
      style={{
        minWidth: 22,
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 9,
        borderWidth: 1,
        borderStyle: state.stale ? "dashed" : "solid",
        borderColor: state.unavailable
          ? theme.colors.statusDanger
          : state.amber
            ? theme.colors.statusWarning
            : theme.colors.border,
        backgroundColor: state.filled
          ? theme.colors.statusWarning
          : theme.colors.surface1,
      }}
    >
      <Text
        style={{
          color: state.filled
            ? decisionSignalInk(theme.colors.surface0, theme.colors.foreground, theme.colors.statusWarning)
            : state.unavailable
              ? theme.colors.statusDanger
              : state.amber
                ? theme.colors.statusWarning
                : theme.colors.foregroundMuted,
          fontSize: 12,
        }}
      >
        {state.badge}
      </Text>
    </View>
  );
}
