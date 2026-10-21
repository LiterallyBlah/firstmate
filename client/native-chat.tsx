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
import { MachineNoteDetails } from "./machine-note-details";
import { Text, View } from "react-native";
import { z } from "zod";

import {
  MACHINE_NOTE_KIND,
  nativeChatTransformer,
} from "./native-chat-transform";

export const machineNoteSchema = z.object({
  visible: z.string().optional(),
  summary: z.string(),
  original: z.string(),
});

export function MachineNote({ item, theme }: PluginTimelineItemProps<z.infer<typeof machineNoteSchema>>) {
  const details = <MachineNoteDetails theme={theme} summary={item.data.summary} original={item.data.original} />;
  return item.data.visible ? <View style={{ gap: 6 }}><Text selectable style={{ color: theme.colors.foreground, fontSize: 14 }}>{item.data.visible}</Text>{details}</View> : details;
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
