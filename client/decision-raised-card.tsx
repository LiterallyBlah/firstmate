import type { PluginTheme } from "@getpaseo/plugin";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  quarantinesSource,
  type DecisionAnswerOption,
  type NeedsYouRequest,
  type NeedsYouSnapshot,
} from "../shared/needs-you";
import { useOpenDecision, type OpenDecision } from "./decision-action";
import { DecisionSummary } from "./decision-brief";
import { decisionTitle } from "./decision-copy";
import { DecisionButton } from "./decision-drawer";
import { raisedChoices, raisedStatus, raisedWarning } from "./decision-raised";
import { useMateSender } from "./mate-send";
import { useDecisionChanged } from "./needs-you-query";
import { decisionDraftKey, decisionSession } from "./needs-you-state";

function submissionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A decision the first mate raised, once, in its chat: the title, the question,
 * the recommendation, the drawer's answer buttons and Open the decision. All of
 * it is the snapshot's, so the first mate's reply around it can be one line.
 */
export function DecisionRaisedCard({
  theme,
  request,
  snapshot,
  mateId,
  compact,
  offline = false,
  onOpen,
}: {
  theme: PluginTheme;
  request: NeedsYouRequest;
  snapshot: NeedsYouSnapshot;
  mateId: string | null;
  compact: boolean;
  offline?: boolean;
  onOpen?: OpenDecision;
}) {
  const open = useOpenDecision();
  const sender = useMateSender(mateId ?? "none");
  const changed = useDecisionChanged();
  const session = decisionSession(useQueryClient());
  const draftKey = decisionDraftKey(snapshot.homeId, request);
  const submission = useRef<{ text: string; id: string } | null>(null);
  const [notice, setNotice] = useState("");
  const colors = theme.colors;
  const status = raisedStatus(request);
  const warning = raisedWarning(snapshot, request, offline);
  const fresh =
    !offline &&
    snapshot.freshness.status === "fresh" &&
    !quarantinesSource(snapshot.quarantined ?? [], request.source);
  const choices = status.settled ? [] : raisedChoices(snapshot, request);
  const writable = fresh && !status.settled && !!mateId && !sender.sending;
  const openButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open the decision"
      onPress={() => (onOpen ?? open)({ homeId: snapshot.homeId!, requestId: request.id, recordRevision: request.revision })}
      style={{ minHeight: compact ? 44 : 32, justifyContent: "center", alignSelf: "flex-start" }}
    >
      <Text style={{ color: colors.foreground, textDecorationLine: "underline", fontSize: 12 }}>
        {status.settled ? "Open" : "Open the decision"}
      </Text>
    </Pressable>
  );

  if (status.settled) return (
    <View testID="decision-raised" accessibilityLabel={`${status.label}: ${decisionTitle(request.source.title)}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 2,
        borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface1,
        alignSelf: "flex-start", maxWidth: 560, width: "100%" }}>
      <Text numberOfLines={2} style={{ flex: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
        <Text style={{ color: colors.foregroundMuted }}>{status.label}</Text>: {decisionTitle(request.source.title)}
      </Text>
      {openButton}
    </View>
  );

  function choose(option: DecisionAnswerOption) {
    if (!writable) return;
    const text = option.prompt.trim();
    // A failure to confirm keeps the id, so pressing again asks about the same submission.
    if (submission.current?.text !== text) submission.current = { text, id: submissionId() };
    // The drawer's draft, by revision: an uncertain delivery's Send again… there resends these exact words.
    session.drafts.set(draftKey, text);
    setNotice("");
    const started = sender.answer(
      {
        homeId: snapshot.homeId!,
        requestId: request.id,
        recordRevision: request.revision,
        submissionId: submission.current.id,
        text,
        suggestion: { actionId: option.decision.actionId, label: option.label },
      },
      (result) => {
        changed(result.snapshot);
        if (result.outcome === "accepted" && session.drafts.get(draftKey) === text) session.drafts.delete(draftKey);
        setNotice(result.outcome === "failed" ? "The answer was not sent." : "");
      },
      () => {
        setNotice("Could not confirm this answer. Open the decision and check its status before trying again.");
        changed();
      },
    );
    if (!started) setNotice("Another message is being sent. Try again when it finishes.");
  }

  return (
    <View
      testID="decision-raised"
      accessibilityLabel={`${status.label}: ${decisionTitle(request.source.title)}`}
      style={{
        gap: 8,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        borderLeftWidth: 3,
        borderLeftColor: status.settled ? colors.border : colors.statusWarning,
        backgroundColor: colors.surface1,
        alignSelf: "flex-start",
        width: "100%",
        maxWidth: 560,
      }}
    >
      <Text style={{ color: status.settled ? colors.foregroundMuted : colors.statusWarning, fontSize: 12 }}>
        {status.label}
      </Text>
      <Text
        selectable
        style={{
          color: status.settled ? colors.foregroundMuted : colors.foreground,
          fontSize: 14,
          fontWeight: "600",
          lineHeight: 20,
        }}
      >
        {decisionTitle(request.source.title)}
      </Text>
      {warning ? (
        <View
          testID="decision-raised-warning"
          style={{ gap: 4, padding: 10, borderWidth: 1, borderColor: colors.statusWarning, borderRadius: 8 }}
        >
          <Text accessibilityRole="alert" style={{ color: colors.statusWarning, fontSize: 12, fontWeight: "600" }}>
            {warning.headline}
          </Text>
          {warning.details.map((detail, i) => (
            <Text key={i} style={{ color: colors.foreground, fontSize: 12, lineHeight: 18 }}>
              {detail}
            </Text>
          ))}
        </View>
      ) : null}
      <DecisionSummary theme={theme} snapshot={snapshot} request={request} />
      {choices.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {choices.map((choice) => (
            <DecisionButton
              key={choice.decision.actionId}
              theme={theme}
              compact={compact}
              label={choice.decision.actionId.startsWith("brief:") ? `Choose: ${choice.label}` : choice.label}
              onPress={() => choose(choice)}
              disabled={!writable}
            />
          ))}
        </View>
      ) : null}
      {notice ? (
        <Text accessibilityRole="alert" style={{ color: colors.statusWarning, fontSize: 12 }}>
          {notice}
        </Text>
      ) : null}
      {openButton}
    </View>
  );
}
