import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import { useEffect, useId, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { indicatorState, decisionSession } from "./needs-you-state";
import { webAttributes, webSurfaceVisible } from "./web";
import { useOpenDecision, type OpenDecision } from "./decision-action";
import { decisionSignalInk } from "./decision-copy";

export function NeedsYouIndicator({
  theme,
  snapshot,
  offline = false,
  compact = false,
  onOpen,
}: {
  theme: PluginTheme;
  snapshot?: NeedsYouSnapshot | undefined;
  offline?: boolean;
  compact?: boolean;
  onOpen?: OpenDecision;
}) {
  const action = useOpenDecision();
  const ref = useRef<unknown>(null);
  const session = decisionSession(useQueryClient());
  useEffect(() => {
    const visible = () => webSurfaceVisible(ref.current);
    session.surfaces.add(visible);
    return () => {
      session.surfaces.delete(visible);
    };
  }, [session]);
  const id = `needs-you-${useId()}`;
  const state = indicatorState(snapshot, offline);
  const color = state.unavailable
    ? theme.colors.statusDanger
    : state.amber
      ? theme.colors.statusWarning
      : theme.colors.foregroundMuted;
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
        minHeight: compact ? 44 : 28,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderWidth: 1,
        borderColor: color,
        borderRadius: 18,
        borderStyle: state.stale ? "dashed" : "solid",
        backgroundColor: state.filled
          ? theme.colors.statusWarning
          : theme.colors.surface1,
        justifyContent: "center",
        ...(compact
          ? { alignSelf: "stretch" as const, width: "100%" as const }
          : {}),
      }}
    >
      <Text
        style={{
          color: state.filled
            ? decisionSignalInk(theme.colors.surface0, theme.colors.foreground)
            : color,
          fontSize: 13,
          fontWeight: "600",
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
}: {
  theme: PluginTheme;
  snapshot?: NeedsYouSnapshot | undefined;
  offline?: boolean;
}) {
  const state = indicatorState(snapshot, offline);
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
            ? decisionSignalInk(theme.colors.surface0, theme.colors.foreground)
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
