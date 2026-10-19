import type { PluginTheme } from "@getpaseo/plugin";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useOpenDecision, type OpenDecision } from "./decision-action";
import { decisionTitle } from "./decision-copy";
import type { DecisionAnswerSummary } from "./decision-answer-summary";

export function DecisionAnswerBubble({
  theme,
  answer,
  onOpen,
}: {
  theme: PluginTheme;
  answer: DecisionAnswerSummary;
  onOpen?: OpenDecision;
}) {
  const [original, setOriginal] = useState(false);
  const open = useOpenDecision();
  const colors = theme.colors;
  return (
    <View
      style={{
        gap: 8,
        padding: 12,
        borderRadius: 10,
        backgroundColor: colors.surface2,
        alignSelf: "flex-end",
        maxWidth: "100%",
      }}
    >
      <Text style={{ color: colors.statusWarning, fontSize: 12 }}>
        Your answer to «{decisionTitle(answer.title)}»
      </Text>
      <Text
        selectable
        style={{
          color: colors.foregroundMuted,
          fontSize: 12,
          borderLeftWidth: 2,
          borderColor: colors.border,
          paddingLeft: 8,
        }}
      >
        The first mate asked: {answer.ask}
      </Text>
      <Text
        selectable
        style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}
      >
        {answer.answer}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the decision"
          onPress={() =>
            (onOpen ?? open)({
              homeId: answer.homeId,
              requestId: answer.requestId,
              recordRevision: answer.recordRevision,
            })
          }
          style={{ minHeight: 32, justifyContent: "center" }}
        >
          <Text
            style={{
              color: colors.foreground,
              textDecorationLine: "underline",
              fontSize: 12,
            }}
          >
            Open the decision
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: original }}
          accessibilityLabel={
            original ? "Hide what was sent" : "Show what was sent"
          }
          onPress={() => setOriginal(!original)}
          style={{ minHeight: 32, justifyContent: "center" }}
        >
          <Text
            style={{
              color: colors.foreground,
              textDecorationLine: "underline",
              fontSize: 12,
            }}
          >
            {original ? "Hide what was sent" : "Show what was sent"}
          </Text>
        </Pressable>
      </View>
      {original ? (
        <Text
          selectable
          style={{
            color: colors.foregroundMuted,
            fontSize: 12,
            lineHeight: 18,
          }}
        >
          {answer.original}
        </Text>
      ) : null}
    </View>
  );
}
