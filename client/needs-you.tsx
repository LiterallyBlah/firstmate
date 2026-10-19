import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import { useEffect, useId, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { indicatorState, decisionSession } from "./needs-you-state";
import { webSurfaceVisible } from "./web";
import { useOpenDecision, type OpenDecision } from "./decision-action";

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
  const color = state.amber
    ? theme.colors.statusWarning
    : theme.colors.foregroundMuted;
  return (
    <Pressable
      ref={ref as never}
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
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderWidth: 1,
        borderColor: color,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
        justifyContent: "center",
        ...(compact
          ? { alignSelf: "stretch" as const, width: "100%" as const }
          : {}),
      }}
    >
      <Text style={{ color, fontSize: 14, fontWeight: "600" }}>
        {state.label}
      </Text>
      {state.extra ? (
        <Text style={{ color, fontSize: 11 }}>{state.extra}</Text>
      ) : null}
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
  if (state.count === 0 && state.fresh) return null;
  return (
    <View
      accessibilityLabel={state.accessibilityLabel}
      style={{
        minWidth: 22,
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: state.amber
          ? theme.colors.statusWarning
          : theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Text
        style={{
          color: state.amber
            ? theme.colors.statusWarning
            : theme.colors.foregroundMuted,
          fontSize: 12,
        }}
      >
        {state.count ?? "?"}
        {state.fresh ? "" : " ·"}
      </Text>
    </View>
  );
}
