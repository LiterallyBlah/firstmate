import { DecisionAnswerBubble } from "./decision-answer-bubble";
import {
  decisionAnswerSummarySchema,
  DECISION_ANSWER_KIND,
} from "./decision-answer-summary";
import { decisionRoute } from "./needs-you-state";
import type {
  PluginClientContext,
  PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";

import {
  MACHINE_NOTE_KIND,
  nativeChatTransformer,
} from "./native-chat-transform";

export const machineNoteSchema = z.object({
  summary: z.string(),
  original: z.string(),
});

export function MachineNote({
  item,
  theme,
}: PluginTimelineItemProps<z.infer<typeof machineNoteSchema>>) {
  const [expanded, setExpanded] = useState(false);
  const { summary, original } = item.data;
  const colors = theme.colors;
  return (
    <View style={{ paddingVertical: 6, gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Hide" : "Show"} original: ${summary}`}
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => ({
          paddingVertical: 8,
          paddingHorizontal: 10,
          minHeight: 44,
          borderRadius: 6,
          backgroundColor: pressed ? colors.surface2 : colors.surface1,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        })}
      >
        <Text
          numberOfLines={2}
          style={{
            color: colors.foregroundMuted,
            fontSize: 13,
            lineHeight: 18,
            flex: 1,
          }}
        >
          {summary}
        </Text>
        <Text style={{ color: colors.foreground, fontSize: 12 }}>
          {expanded ? "Hide original" : "Show original"}
        </Text>
      </Pressable>
      {expanded ? (
        <Text
          selectable
          style={{
            color: colors.foreground,
            fontSize: 13,
            lineHeight: 20,
            paddingHorizontal: 10,
          }}
        >
          {original}
        </Text>
      ) : null}
    </View>
  );
}

export function registerNativeChat(client: PluginClientContext): () => void {
  const removeAnswer = client.addTimelineRenderer({
    kind: DECISION_ANSWER_KIND,
    version: 1,
    schema: decisionAnswerSummarySchema,
    Component: ({ item, theme }) => (
      <DecisionAnswerBubble
        theme={theme}
        answer={item.data}
        onOpen={(target) => client.openScreen(decisionRoute(target))}
      />
    ),
  });
  const removeRenderer = client.addTimelineRenderer({
    kind: MACHINE_NOTE_KIND,
    version: 1,
    schema: machineNoteSchema,
    Component: MachineNote,
  });
  const removeTransformer = client.addTimelineTransformer(
    nativeChatTransformer,
  );
  return () => {
    removeAnswer();
    removeTransformer();
    removeRenderer();
  };
}
