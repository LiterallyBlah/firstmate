import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useId, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { FleetCard } from "../shared/fleet";
import type { NeedsYouRequest, NeedsYouSnapshot } from "../shared/needs-you";
import { CrewCard, watchOpener } from "./card";
import { useOpenDecision } from "./decision-action";
import { taskSourceKey } from "./task-presentation";
import { decisionSignalInk, decisionTitle, relativeDecisionTime } from "./decision-copy";
import { Tag } from "./ui";

/** One ledger request, even when several workers represent the same task. */
export function DecisionTask({
  request,
  snapshot,
  cards,
  theme,
  compact,
  onConverse,
  onChanged,
  presentation = "row",
  onAnswer,
}: {
  presentation?: "row" | "card";
  onAnswer?: (() => void) | undefined;
  request: NeedsYouRequest;
  snapshot: NeedsYouSnapshot;
  cards?: readonly FleetCard[];
  theme: PluginTheme;
  compact: boolean;
  onConverse(key: string): void;
  onChanged(): void;
}) {
  const open = useOpenDecision(),
    id = `decision-task-${useId()}`;
  const [details, setDetails] = useState(false);
  const matchingCards = (cards ?? []).filter((card) => taskSourceKey(card) === request.source.key);
  const colors = theme.colors, isNew = request.state === "new", row = presentation === "row";
  const title = decisionTitle(request.source.title);
  const waiting = relativeDecisionTime(request.detectedAt);
  const openAnswer = onAnswer ?? (() => open({ homeId: snapshot.homeId!, requestId: request.id, recordRevision: request.revision }, id));
  const metadata = <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
    {request.source.project ? <Tag theme={theme} text={request.source.project} /> : null}
    <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{`waiting ${waiting}`}</Text>
  </View>;
  const answer = <Pressable nativeID={id} accessibilityRole="button" accessibilityLabel={`Answer: ${title}. ${request.source.ask}`}
    onPress={openAnswer} style={{ minHeight: compact ? 44 : 28, flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 5, paddingHorizontal: 10, borderWidth: 1, borderRadius: 7, borderColor: isNew ? colors.accent : colors.border,
      backgroundColor: isNew ? colors.accent : colors.surface1 }}>
    <Icon name="Reply" size={14} color={isNew ? colors.accentForeground : colors.foreground} />
    <Text style={{ color: isNew ? colors.accentForeground : colors.foreground, fontSize: 12, fontWeight: "600" }}>Answer</Text>
  </Pressable>;
  const detailToggle = <Pressable accessibilityRole="button" accessibilityLabel={`Details for decision ${request.source.title}`}
    accessibilityState={{ expanded: details }} aria-expanded={details} onPress={() => setDetails(!details)}
    style={{ minHeight: compact ? 44 : 28, minWidth: compact ? 44 : 22, alignItems: "center", justifyContent: "center" }}>
    <Icon name={details ? "ChevronUp" : "ChevronDown"} size={12} color={colors.foregroundMuted} />
  </Pressable>;
  return (
    <View testID="decision-task" style={{ borderWidth: row ? 0 : 1, borderColor: isNew ? colors.statusWarning : colors.border,
      borderRadius: 8, padding: row ? 5 : 12, gap: row ? 4 : 8, backgroundColor: isNew ? colors.surface2 : row ? undefined : colors.surface1 }}>
      {!row ? metadata : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {row ? <Icon name={isNew ? "Circle" : "Hand"} size={isNew ? 9 : 14} color={colors.statusWarning} /> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`Answer: ${request.source.title}. ${request.source.ask}`}
          onPress={openAnswer} style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {isNew ? <Text style={{ color: decisionSignalInk(colors.surface0, colors.foreground), backgroundColor: colors.statusWarning, borderRadius: 3,
              paddingHorizontal: 4, paddingVertical: 1, fontSize: 10, fontWeight: "700" }}>NEW</Text> : null}
            <Text numberOfLines={row ? 1 : 2} style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{title}</Text>
          </View>
          <Text numberOfLines={row ? 1 : 3} style={{ color: colors.foreground, fontSize: 12, lineHeight: 17 }}>
            <Text style={{ color: colors.statusWarning }}>Your call: </Text>{request.source.ask}
          </Text>
          {row && compact ? metadata : null}
        </Pressable>
        {row && !compact ? metadata : null}
        {row ? answer : null}
        {row ? detailToggle : null}
      </View>
      {!row ? <View style={{ flexDirection: "row", justifyContent: "space-between" }}>{answer}{detailToggle}</View> : null}
      {details ? (
        <>
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{request.source.title}</Text>
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
          ) : cards ? (
            <Text style={{ color: theme.colors.foregroundMuted }}>No worker card is attached to this decision.</Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
export function DecisionQueueNote({
  theme,
  snapshot,
  offline = false,
  filtered = false,
}: {
  theme: PluginTheme;
  snapshot?: NeedsYouSnapshot | undefined;
  offline?: boolean | undefined;
  filtered?: boolean | undefined;
}) {
  if (!filtered && !offline && snapshot?.freshness.status === "fresh") return null;
  return (
    <View style={{ gap: 4, paddingBottom: 4 }}>
      {filtered ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        Filters don't hide decisions
      </Text> : null}
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
