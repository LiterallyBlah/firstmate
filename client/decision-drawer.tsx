import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, openExternalUrl } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  markNeedsYouSeen,
  snoozeNeedsYou,
  unsnoozeNeedsYou,
  type NeedsYouSnapshot,
  type NeedsYouRequest,
  quarantinesSource,
} from "../shared/needs-you";
import type { Suggestion } from "../shared/fleet";
import { useMateSender } from "./mate-send";
import { useDecisionChanged } from "./needs-you-query";
import {
  boundAnswers,
  chosenWake,
  decisionQueue,
  decisionProblems,
  decisionSession,
  tomorrowNine,
  type DecisionDestination,
} from "./needs-you-state";
import { Markdown } from "./markdown";
import { FilesView } from "./files";
import { bindWebKeys, focusWebElement, cycleWebFocus } from "./web";
import { errorText } from "./format";

export function DecisionButton({
  theme,
  label,
  onPress,
  disabled = false,
  nativeID,
}: {
  theme: PluginTheme;
  label: string;
  onPress(): void;
  disabled?: boolean;
  nativeID?: string;
}) {
  return (
    <Pressable
      nativeID={nativeID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        minWidth: 44,
        padding: 10,
        borderWidth: 1,
        borderRadius: 7,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function DecisionDrawer({
  theme,
  snapshot,
  offline,
  destination,
  onSelect,
  onClose,
  mateId,
  suggestions,
  compact,
  onOpenBoard,
}: {
  onOpenBoard?: (() => void) | undefined;
  theme: PluginTheme;
  snapshot?: NeedsYouSnapshot | undefined;
  offline: boolean;
  destination: DecisionDestination;
  onSelect(destination: DecisionDestination): void;
  onClose(): void;
  mateId: string | null;
  suggestions: readonly Suggestion[];
  compact: boolean;
}) {
  const queue = decisionQueue(snapshot?.requests ?? []);
  const sameHome =
    !destination.homeId || destination.homeId === snapshot?.homeId;
  const request = sameHome
    ? snapshot?.requests.find((r) => r.id === destination.requestId)
    : undefined;
  const index = queue.findIndex((r) => r.id === request?.id);
  const [all, setAll] = useState(false);
  const root = useRef<unknown>(null);
  const closeId = `close-decision-${useId()}`;
  useEffect(() => {
    focusWebElement(closeId);
  }, [closeId]);
  useEffect(
    () =>
      bindWebKeys(root.current, (key, shift) => {
        if (key === "Tab" && compact) return cycleWebFocus(root.current, shift);
        if (key !== "Escape") return false;
        onClose();
        return true;
      }),
    [onClose, compact],
  );
  function select(request: NeedsYouRequest) {
    onSelect({
      homeId: snapshot!.homeId!,
      requestId: request.id,
      recordRevision: request.revision,
    });
    setAll(false);
  }
  const colors = theme.colors;
  return (
    <View
      ref={root as never}
      accessibilityLabel="FirstMate decisions"
      accessibilityViewIsModal={compact}
      style={{
        flex: 1,
        minHeight: 0,
        backgroundColor: colors.surface0,
        borderLeftWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          padding: 12,
          gap: 6,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{
            flex: 1,
            color: colors.foreground,
            fontSize: 18,
            fontWeight: "600",
          }}
        >
          Needs you
        </Text>
        <DecisionButton
          theme={theme}
          label="Close decisions"
          nativeID={closeId}
          onPress={onClose}
        />
      </View>
      <View
        style={{
          paddingHorizontal: 12,
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <DecisionButton
          theme={theme}
          label="Previous decision"
          disabled={index <= 0}
          onPress={() => select(queue[index - 1]!)}
        />
        <DecisionButton
          theme={theme}
          label="Next decision"
          disabled={queue.length === 0 || index >= queue.length - 1}
          onPress={() => select(queue[index + 1]!)}
        />
        <DecisionButton
          theme={theme}
          label={all ? "Current decision" : "All decisions"}
          onPress={() => setAll(!all)}
        />
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}
        automaticallyAdjustKeyboardInsets
      >
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          Across all machines and filters
        </Text>
        {offline || snapshot?.freshness.status !== "fresh" ? (
          <Text
            accessibilityRole="alert"
            style={{ color: colors.statusWarning }}
          >
            {snapshot?.freshness.status === "disabled"
              ? "Decision observation is disabled."
              : "Decision data is unavailable or stale. Actions are disabled."}
            {snapshot?.freshness.asOf
              ? ` Last confirmed ${new Date(snapshot.freshness.asOf).toLocaleString()}.`
              : ""}
          </Text>
        ) : null}
        {decisionProblems(snapshot, offline).map((problem, index) => (
          <Text key={index} accessibilityRole="alert" style={{ color: colors.statusWarning }}>{problem}</Text>
        ))}
        {(snapshot?.quarantined ?? []).filter(row => row.hasHold).map((row, index) => (
          <View key={index} style={{ gap: 6 }}>
            <Text style={{ color: colors.foreground }}>
              {"Couldn't read this task" + (row.taskId ? ": " + row.taskId : "") + ". Check the Board and data/backlog.md, line " + row.line + "."}
            </Text>
            {onOpenBoard ? <DecisionButton theme={theme} label="Open Board" onPress={onOpenBoard} /> : null}
          </View>
        ))}
        {all ? (
          <>
            {[
              ...queue,
              ...(snapshot?.requests.filter((r) => r.state === "resolved") ??
                []),
            ].map((r) => (
              <DecisionButton
                key={r.id}
                theme={theme}
                label={`${r.source.title} · ${r.state}`}
                onPress={() => select(r)}
              />
            ))}
            {(snapshot?.parked ?? []).map((r) => (
              <Text key={r.key} style={{ color: colors.foregroundMuted }}>
                Later: {r.title} — {r.blockedBy ?? "No question recorded"}
              </Text>
            ))}
          </>
        ) : !sameHome ? (
          <Text style={{ color: colors.foreground }}>
            This decision belongs to another FirstMate home. Open its original
            host and home.
          </Text>
        ) : !request ? (
          <Text style={{ color: colors.foreground }}>
            {destination.requestId === "next" ||
            destination.requestId === "empty"
              ? snapshot?.actionCount === 0 && snapshot.freshness.status === "fresh" && !offline
                ? "Nothing needs a decision now. Pending, snoozed and past decisions are in All decisions."
                : snapshot?.quarantined?.some(row => row.hasHold)
                  ? "Unreadable tasks need review on the Board."
                  : "Waiting for decision data…"
              : "This decision is no longer available. Its answer has not been replayed."}
          </Text>
        ) : (
          <DecisionDetails
            key={`${snapshot!.homeId}:${request.id}:${request.revision}`}
            theme={theme}
            request={request}
            snapshot={snapshot!}
            offline={offline}
            openedRevision={destination.recordRevision}
            mateId={mateId}
            suggestions={suggestions}
            compact={compact}
          />
        )}
      </ScrollView>
    </View>
  );
}

function DecisionDetails({
  theme,
  request,
  snapshot,
  offline,
  openedRevision,
  mateId,
  suggestions,
  compact,
}: {
  theme: PluginTheme;
  request: NeedsYouRequest;
  snapshot: NeedsYouSnapshot;
  offline: boolean;
  openedRevision?: number | undefined;
  mateId: string | null;
  suggestions: readonly Suggestion[];
  compact: boolean;
}) {
  const session = decisionSession(useQueryClient());
  const draftKey = JSON.stringify([
    snapshot.homeId,
    request.id,
    request.revision,
  ]);
  const [draft, setDraft] = useState(() => session.drafts.get(draftKey) ?? "");
  const [wake, setWake] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const submission = useRef<{ text: string; id: string } | null>(null);
  const sender = useMateSender(mateId ?? "none");
  const seen = useRpc(markNeedsYouSeen),
    snooze = useRpc(snoozeNeedsYou),
    unsnooze = useRpc(unsnoozeNeedsYou);
  const changed = useDecisionChanged();
  const target = {
    homeId: snapshot.homeId!,
    id: request.id,
    revision: request.revision,
  };
  const pending =
    request.state === "answer-sent" || request.state === "delivery-uncertain";
  const writable =
    !offline &&
    snapshot.freshness.status === "fresh" &&
    !quarantinesSource(snapshot.quarantined ?? [], request.source) &&
    !pending &&
    request.state !== "resolved" &&
    !busy;
  const colors = theme.colors;
  const textStyle = { color: colors.foreground, fontSize: 14 };
  const inputStyle = {
    color: colors.foreground,
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 44,
    padding: 12,
  };
  async function mutate(task: () => Promise<NeedsYouSnapshot>) {
    if (!writable) return;
    setBusy(true);
    setNotice("");
    try {
      changed(await task());
    } catch (error) {
      setNotice(errorText(error));
      changed();
    } finally {
      setBusy(false);
    }
  }
  function send(option?: Suggestion) {
    if (!writable || !mateId || sender.sending) return;
    const text = (option?.prompt ?? draft).trim();
    if (!text || (!option && (session.drafts.get(draftKey) ?? "") !== draft)) {
      setNotice(
        "The draft changed in another view. Reopen this decision before sending.",
      );
      return;
    }
    if (!submission.current || submission.current.text !== text)
      submission.current = {
        text,
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
      };
    setNotice("");
    sender.answer(
      {
        homeId: snapshot.homeId!,
        requestId: request.id,
        recordRevision: request.revision,
        submissionId: submission.current.id,
        text,
        ...(option
          ? {
              suggestion: {
                actionId: option.decision!.actionId,
                label: option.label,
              },
            }
          : {}),
      },
      (result) => {
        changed(result.snapshot);
        setNotice(
          result.outcome === "accepted"
            ? "Answer sent. Waiting for the first mate to record the outcome."
            : result.outcome === "uncertain"
              ? "Delivery uncertain. Check the first mate's conversation before taking further action. No automatic retry."
              : "The answer was not sent. The draft is retained.",
        );
        if (
          result.outcome === "accepted" &&
          !option &&
          session.drafts.get(draftKey) === draft
        ) {
          session.drafts.delete(draftKey);
          setDraft("");
        }
      },
      () => {
        setNotice(
          "Could not confirm this submission. The draft is retained. Refresh and check its status before trying again.",
        );
        changed();
      },
    );
  }
  function link(url: string) {
    if (/^https?:\/\//i.test(url))
      void openExternalUrl(url).catch((e) => setNotice(errorText(e)));
    else setFile(url);
  }
  const choices = boundAnswers(suggestions, snapshot.homeId!, request);
  const pendingSince =
    request.submissions.at(-1)?.recordedAt ?? request.updatedAt;
  return (
    <>
      <Text
        accessibilityRole="header"
        style={{ ...textStyle, fontSize: 18, fontWeight: "600" }}
      >
        {request.source.title}
      </Text>
      <Text style={{ color: colors.foregroundMuted }}>
        {request.source.hostId} ·{" "}
        {request.source.project ?? request.source.taskId} · Waiting since{" "}
        {new Date(request.detectedAt).toLocaleString()}
      </Text>
      {openedRevision !== undefined && openedRevision !== request.revision ? (
        <Text accessibilityRole="alert" style={{ color: colors.statusWarning }}>
          The question changed since this link was opened. This is the current
          question; earlier drafts are retained separately.
        </Text>
      ) : null}
      <Markdown
        source={request.source.ask}
        theme={theme}
        fontSize={15}
        onOpenLink={link}
      />
      {request.source.url ? (
        <DecisionButton
          theme={theme}
          label={`Review current material: ${request.source.url}`}
          onPress={() => link(request.source.url!)}
        />
      ) : null}
      {request.source.reportPath ? (
        <DecisionButton
          theme={theme}
          label={`Open report: ${request.source.reportPath}`}
          onPress={() => link(request.source.reportPath!)}
        />
      ) : null}
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
        Answers apply to this recorded question. The current PR head or report
        contents have not been verified by this drawer.
      </Text>
      {request.state === "resolved" ? (
        <Text style={textStyle}>Resolved: {request.resolution?.reason}.</Text>
      ) : request.state === "snoozed" ? (
        <Text style={textStyle}>
          Snoozed until {new Date(request.snoozedUntil!).toLocaleString()}.
        </Text>
      ) : pending ? (
        <Text accessibilityRole="alert" style={textStyle}>
          {request.state === "answer-sent"
            ? "Answer sent; waiting for the first mate to record the outcome."
            : "Delivery uncertain; inspect the first mate's conversation. No automatic retry."}
          {snapshot.freshness.checkedAt - pendingSince >= 120000
            ? " The hold has not changed for at least two minutes."
            : ""}
        </Text>
      ) : (
        <Text style={textStyle}>
          {request.state === "new" ? "New decision" : "Seen"}
        </Text>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <DecisionButton
          theme={theme}
          label="Mark seen"
          disabled={!writable}
          onPress={() => void mutate(() => seen(target))}
        />
        {request.state === "snoozed" ? (
          <DecisionButton
            theme={theme}
            label="Unsnooze"
            disabled={!writable}
            onPress={() => void mutate(() => unsnooze(target))}
          />
        ) : null}
        <DecisionButton
          theme={theme}
          label="Snooze 1 hour"
          disabled={!writable}
          onPress={() =>
            void mutate(() =>
              snooze({ ...target, until: Date.now() + 3600000 }),
            )
          }
        />
        <DecisionButton
          theme={theme}
          label="Snooze tomorrow 09:00"
          disabled={!writable}
          onPress={() =>
            void mutate(() =>
              snooze({ ...target, until: tomorrowNine(Date.now()) }),
            )
          }
        />
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
        Snooze times use this device's local time zone.
      </Text>
      <TextInput
        accessibilityLabel="Chosen snooze time, YYYY-MM-DD HH:mm"
        placeholder="YYYY-MM-DD HH:mm"
        placeholderTextColor={colors.foregroundMuted}
        value={wake}
        onChangeText={setWake}
        style={inputStyle}
      />
      <DecisionButton
        theme={theme}
        label="Snooze until chosen time"
        disabled={!writable || chosenWake(wake, Date.now()) === null}
        onPress={() => {
          const until = chosenWake(wake, Date.now());
          if (until !== null) void mutate(() => snooze({ ...target, until }));
        }}
      />
      <Text style={{ ...textStyle, fontWeight: "600" }}>
        Answer the first mate
      </Text>
      {!mateId ? (
        <Text style={{ color: colors.statusWarning }}>
          No first mate is available to receive an answer.
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel="Answer the first mate"
        multiline
        value={draft}
        onChangeText={(value) => {
          session.drafts.set(draftKey, value);
          setDraft(value);
        }}
        editable={!pending && request.state !== "resolved"}
        placeholder="Write the decision in your own words…"
        placeholderTextColor={colors.foregroundMuted}
        style={[
          inputStyle,
          { minHeight: compact ? 130 : 110, textAlignVertical: "top" },
        ]}
      />
      <DecisionButton
        theme={theme}
        label={
          sender.sending ? "Sending answer…" : "Send answer to the first mate"
        }
        disabled={!writable || !mateId || sender.sending || !draft.trim()}
        onPress={() => send()}
      />
      {choices.map((choice) => (
        <DecisionButton
          key={choice.decision!.actionId}
          theme={theme}
          label={`Answer: ${choice.label}`}
          disabled={!writable || !mateId || sender.sending}
          onPress={() => send(choice)}
        />
      ))}
      {notice ? (
        <Text accessibilityRole="alert" style={textStyle}>
          {notice}
        </Text>
      ) : null}
      <Modal
        title="Decision source file"
        open={file !== null}
        onOpenChange={(open) => {
          if (!open) setFile(null);
        }}
      >
        <Modal.Content scrollable={false}>
          <View style={{ height: compact ? 400 : 600 }}>
            <FilesView
              theme={theme}
              compact={compact}
              request={file ? { path: file, at: 0 } : null}
            />
          </View>
        </Modal.Content>
      </Modal>
    </>
  );
}
