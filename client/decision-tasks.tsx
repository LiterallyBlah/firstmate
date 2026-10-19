import type { PluginTheme } from "@getpaseo/plugin";
import { useId, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { FleetCard } from "../shared/fleet";
import type { NeedsYouRequest, NeedsYouSnapshot } from "../shared/needs-you";
import { CrewCard, watchOpener } from "./card";
import { useOpenDecision } from "./decision-action";
import { taskSourceKey } from "./task-presentation";

/** One ledger request, even when several workers represent the same task. */
export function DecisionTask({
  request,
  snapshot,
  cards,
  theme,
  compact,
  onConverse,
  onChanged,
}: {
  request: NeedsYouRequest;
  snapshot: NeedsYouSnapshot;
  cards: readonly FleetCard[];
  theme: PluginTheme;
  compact: boolean;
  onConverse(key: string): void;
  onChanged(): void;
}) {
  const open = useOpenDecision(),
    id = `decision-task-${useId()}`;
  const [details, setDetails] = useState(false);
  const matchingCards = cards.filter((card) => taskSourceKey(card) === request.source.key);
  const card = matchingCards[0];
  const color = request.state === "new" ? theme.colors.statusWarning : theme.colors.foregroundMuted;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: color,
        borderRadius: 8,
        padding: 12,
        gap: 8,
        backgroundColor: theme.colors.surface0,
      }}
    >
      <Pressable
        nativeID={id}
        accessibilityRole="button"
        accessibilityLabel={`Open decision: ${request.source.title}. Needs you. ${request.state === "new" ? "New. " : ""}${request.source.ask}`}
        onPress={() => open({ homeId: snapshot.homeId!, requestId: request.id, recordRevision: request.revision }, id)}
        style={{ minHeight: 44, gap: 6 }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{request.source.title}</Text>
        <Text style={{ color, fontSize: 12 }}>Needs you{request.state === "new" ? " · New" : ""}</Text>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 19 }} numberOfLines={3}>
          {request.source.ask}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {request.source.project ?? ""}
          {request.source.project ? " · " : ""}
          {request.source.hostId === "local" ? "This machine" : (card?.remote?.host ?? request.source.hostId)}
        </Text>
        <Text style={{ color, fontSize: 13, fontWeight: "600" }}>Open decision</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Details for decision ${request.source.title}`}
        accessibilityState={{ expanded: details }}
        aria-expanded={details}
        onPress={() => setDetails(!details)}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: theme.colors.foregroundMuted }}>Details · {details ? "Hide" : "Show"}</Text>
      </Pressable>
      {details ? (
        <>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            Waiting since {new Date(request.detectedAt).toLocaleString()} · Question revision {request.revision}
          </Text>
          {matchingCards.length ? (
            matchingCards.map((matched) => (
              <View key={matched.key} style={{ gap: 6 }}>
                {matchingCards.length > 1 ? (
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                    {matched.agent?.title ?? matched.remote?.worker?.name ?? matched.title}
                  </Text>
                ) : null}
                <CrewCard
                  card={matched}
                  theme={theme}
                  compact={compact}
                  presentation="drawer"
                  opener={watchOpener(matched, onConverse)}
                  onChanged={onChanged}
                />
              </View>
            ))
          ) : (
            <Text style={{ color: theme.colors.foregroundMuted }}>No worker card is attached to this decision.</Text>
          )}
        </>
      ) : null}
    </View>
  );
}
export function DecisionQueueNote({
  theme,
  snapshot,
  offline = false,
}: {
  theme: PluginTheme;
  snapshot?: NeedsYouSnapshot | undefined;
  offline?: boolean | undefined;
}) {
  return (
    <View style={{ gap: 4, paddingBottom: 8 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        Across all machines · task filters do not hide decisions
      </Text>
      {offline || snapshot?.freshness.status !== "fresh" ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {snapshot?.actionCount === null || !snapshot
            ? "Decision data unavailable"
            : "Last confirmed decisions; source is stale"}
        </Text>
      ) : null}
    </View>
  );
}
