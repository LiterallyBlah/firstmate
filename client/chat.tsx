import { DecisionAnswerBubble } from "./decision-answer-bubble";
import { DecisionRaisedCard } from "./decision-raised-card";
import { withRaisedDecisions } from "./decision-raised";
import { withPlanReviews } from "./plan-ready";
import { useWorkflowPlans } from "./workflow-plans";
import { planAwaitingReview } from "../shared/workflow-plans";
import { useNeedsYou } from "./needs-you-query";
/**
 * The conversation with the first mate: its transcript, folded to the words,
 * and a composer. The whole session — every tool call and its output — is
 * one press away in Paseo itself, which is what the Open button is for.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Image, Platform, Pressable, SafeAreaView, ScrollView, Text, View, type TextInput } from "react-native";

import { GrowingChatInput } from "./growing-chat-input";

import type { ImagePart } from "../shared/attachments";
import { MAX_FILE_CANDIDATES, findHomeFiles } from "../shared/files";
import type { AgentSummary, MateCommand } from "../shared/fleet";
import {
  admit,
  captainMessage,
  formatBytes,
  hasContent,
  pendingAttachments,
  readEach,
  restoreFailed,
  type PendingAttachment,
} from "./attachments";
import { drafts } from "./draft";
import { discussionRequest, type DecisionDiscussion } from "./decision-discussion";
import { lookupIn, recentCandidates } from "./file-links";
import { useFollowEnd } from "./follow-end";
import { isSendKey, type WebKeyPressEvent } from "./keys";
import { MateControls } from "./mate-controls";
import { MachineNoteDetails } from "./machine-note-details";
import { ChatImage } from "./chat-image";
import { MessageCopy } from "./message-copy";
import { useMateSender } from "./mate-send";
import { Markdown } from "./markdown";
import { PermissionCard, usePendingRequests } from "./permission-card";
import { sentImages } from "./sent-images";
import { ATTACHMENTS_ONLY, transcriptRows, type TranscriptRow } from "./transcript-rows";
import { IconButton, JumpToEnd, MONOSPACE, Spinner, errorText } from "./ui";
import { useKeyboardOverlap } from "./keyboard";
import { useAgentTimeline } from "./use-timeline";
import { ScopeDiscussion } from "./scope-discussion";
import { useScopeSnapshot } from "./scope-query";
import { useWorkspaceFileLink } from "./workspace-file-link";
import { cacheSentImages, canAttachFiles, pickFiles, receiveFiles, type OfferedFile } from "./web";

/** A run of tool calls shows this many before folding the rest behind a count. */
const TOOL_RUN_VISIBLE = 2;

type Group = { key: string; row: TranscriptRow } | { key: string; tools: Extract<TranscriptRow, { kind: "tool" }>[] };

/** Consecutive tool rows become one group, so a supervision pass is a line, not a page. */
function groupRows(rows: readonly TranscriptRow[]): Group[] {
  const groups: Group[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (row.kind === "tool" && last !== undefined && "tools" in last) {
      last.tools.push(row);
    } else if (row.kind === "tool") {
      groups.push({ key: row.key, tools: [row] });
    } else {
      groups.push({ key: row.key, row });
    }
  }
  return groups;
}

/**
 * Which of the paths the first mate's replies name are files in its home — the
 * daemon's say, since only it can see the disk. Asked once for the whole
 * conversation, the most recently mentioned kept past the cap, and again now
 * and then, so a file the first mate writes after naming it becomes a link.
 * Until the answer arrives, and if it fails, the paths are text.
 */
function useHomeFileLinks(rows: readonly TranscriptRow[]) {
  const find = useRpc(findHomeFiles);
  const candidates = useMemo(
    () =>
      recentCandidates(
        rows.flatMap((row) => (row.kind === "mate" ? [row.text] : [])),
        MAX_FILE_CANDIDATES,
        { workspaceAware: true },
      ),
    [rows],
  );
  const found = useQuery({
    queryKey: ["firstmate", "files", "find", candidates],
    queryFn: () => find({ paths: candidates }),
    enabled: candidates.length > 0,
    refetchInterval: 30_000,
    // A new mention asks again; the links already drawn stay while it does.
    placeholderData: (previous) => previous,
  });
  const answer = found.data?.files;
  return useMemo(() => lookupIn(answer ?? {}), [answer]);
}

/** The new UI is advertised by a separate read-only gate. A retained enabled surface never
 * falls back to a General composer when its scope read fails. */
export function MateChat(props: Parameters<typeof GeneralMateChat>[0]) {
  const scopes = useScopeSnapshot(props.imageContext?.serverId ?? "local", props.imageContext?.home ?? "");
  const enabled = useRef(false);
  if (scopes.data?.uiEnabled) enabled.current = true;
  if (enabled.current || props.scopeRequest) {
    if (!scopes.data) return <Text style={{ color: props.theme.colors.statusDanger }}>Scopes unavailable. Refresh before sending.</Text>;
    if (props.scopeRequest && props.scopeRequest.homeId !== scopes.data.homeId) return <Text style={{ color: props.theme.colors.statusDanger }}>This discussion belongs to a different home. Open its original host and home.</Text>;
    if (!scopes.data.uiEnabled) return <Text style={{ color: props.theme.colors.foregroundMuted }}>Scoped discussion controls are disabled pending activation.</Text>;
    return <ScopeDiscussion key={`${props.imageContext?.serverId}:${scopes.data.homeId}`} snapshot={scopes.data} offline={!!scopes.error}
      hostId={props.imageContext?.serverId ?? "local"} theme={props.theme} compact={props.compact} navigation={props.navigation} initialScope={props.scopeRequest?.scopeId} refresh={() => { void scopes.refetch(); }} />;
  }
  return <GeneralMateChat {...props} />;
}

function GeneralMateChat({
  mate,
  mateSince = null,
  theme,
  compact,
  onChanged,
  onOpenFile,
  navigation,
  imageContext,
  discussion = null,
  onReturnDecision,
  onDismissDiscussion,
}: {
  mate: AgentSummary;
  /** When this first mate took the helm; decisions raised before it are not its own. */
  mateSince?: string | null;
  theme: PluginTheme;
  compact: boolean;
  /** After a compact or a restart, so the board catches up without waiting for its poll. */
  onChanged: () => void;
  /** Opens a home file in the Files view, the same way a watch's name does. */
  onOpenFile: (path: string) => void;
  navigation?: PluginScreenProps["navigation"];
  imageContext?: { serverId?: string; home?: string };
  discussion?: DecisionDiscussion | null;
  onReturnDecision?: () => void;
  onDismissDiscussion?: () => void;
  scopeRequest?: { scopeId: string; homeId: string } | undefined;
}) {
  const toast = useToast();
  const [toolbarWidth, setToolbarWidth] = useState(0);
  useEffect(cacheSentImages, []);
  const workspaceLinks = useWorkspaceFileLink(theme, navigation, imageContext ?? {});
  /** Shared with the surface's suggestion buttons: one message on its way at a time — see `./mate-send`. */
  const { sending, send, command: sendMateCommand } = useMateSender(mate.id);
  const timeline = useAgentTimeline(mate.id, `${mate.updatedAt}:${mate.pendingPermissions}`);
  /** Decisions the first mate raised show once, as cards from the Needs-you snapshot — see `./decision-raised`. */
  const decisions = useNeedsYou();
  const plans = useWorkflowPlans();
  const discussing = discussionRequest(discussion, decisions.data, mate.id, decisions.error !== null);
  const composer = useRef<TextInput>(null);
  useEffect(() => {
    if (discussion?.mateId === mate.id) composer.current?.focus();
  }, [discussion, mate.id]);
  // Stable ledger versions keep derived references in place across polls and reconnects.
  const rows = useMemo(
    () => withPlanReviews(withRaisedDecisions(transcriptRows(timeline.entries), timeline.entries, decisions.data, mateSince), timeline.entries, plans.snapshot, mateSince),
    [timeline.entries, decisions.data?.homeId, decisions.data?.version, plans.snapshot?.homeId, plans.snapshot?.version, mateSince],
  );
  // Redraws a captain's row when the images kept for it change; see `./sent-images`.
  useSyncExternalStore(sentImages.subscribe, sentImages.version);
  const groups = useMemo(() => groupRows(rows), [rows]);
  const files = useHomeFileLinks(rows);
  const follow = useFollowEnd();
  /** What the first mate is waiting on — a question, a permission, a plan. */
  const { pending, respond } = usePendingRequests(mate.id, timeline.agent?.pendingPermissions, follow.pin);

  /**
   * A half-typed message survives the surface unmounting, which it does every
   * time the captain opens a workspace, and the plugin being evaluated afresh
   * after a lost connection — see `./draft`.
   */
  const [draft, setDraftState] = useState(() => drafts.get(mate.id));
  /** What is attached to the draft, kept beside it for the same reasons — see `./attachments`. */
  const [attachments, setAttachmentsState] = useState(() => pendingAttachments.get(mate.id));
  /**
   * The stores are the truth and this chat follows them, so a send that fails
   * after the chat that made it was unmounted — a tab switch mid-send on a
   * phone — puts its text and attachments back in the chat on screen now.
   */
  useEffect(() => {
    function reread(): void {
      setDraftState(drafts.get(mate.id));
      setAttachmentsState(pendingAttachments.get(mate.id));
    }
    const stopDrafts = drafts.subscribe(reread);
    const stopAttachments = pendingAttachments.subscribe(reread);
    reread();
    return () => {
      stopDrafts();
      stopAttachments();
    };
  }, [mate.id]);
  /** A drag carrying files is over the chat. */
  const [dragging, setDragging] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const pane = useRef<View>(null);
  /** The keyboard's cover over this pane; padding it away lifts the composer above the keyboard. */
  const keyboard = useKeyboardOverlap(pane);
  // The transcript shrinks when the keyboard opens; keep its end in view if that is where the captain was.
  useEffect(() => {
    // Not a dependency: `follow` is new every render, and the keyboard opening is the event.
    if (keyboard > 0) follow.keepAtEnd();
  }, [keyboard]);
  // A message going out from anywhere — a suggestion's button too — brings the end, where it will appear, into view.
  useEffect(() => {
    if (sending) follow.pin();
  }, [sending]);
  const submitOnEnter = Platform.OS === "web" && !compact;
  const placeholder = submitOnEnter
    ? "Tell the first mate what you need, captain… (Enter sends, Shift+Enter for a new line)"
    : "Tell the first mate what you need, captain…";
  /** The timeline's snapshot is re-read with every stream event; the board's poll is the fallback. */
  const status = timeline.agent?.status ?? mate.status;
  const usage = timeline.agent?.lastUsage;

  function setDraft(text: string): void {
    drafts.set(mate.id, text);
    setDraftState(text);
  }

  function setAttachments(list: readonly PendingAttachment[]): void {
    pendingAttachments.set(mate.id, list);
    setAttachmentsState(list);
  }

  /**
   * Reads what was picked, pasted or dropped and adds it to the draft's
   * attachments. Nothing past the limits is read at all; a file that cannot be
   * read is reported and the rest still attach. The list is re-read from the
   * store once the bytes are in, and the limits checked again, so two quick
   * drops, or a removal while one is reading, both hold.
   */
  function attach(files: readonly OfferedFile[]): void {
    const first = admit(pendingAttachments.get(mate.id), files);
    first.problems.forEach((problem) => toast.error(problem));
    if (first.accepted.length === 0) return;
    readEach(first.accepted)
      .then(({ read, failures }) => {
        failures.forEach((failure) => toast.error(failure));
        const current = pendingAttachments.get(mate.id);
        const second = admit(current, read);
        second.problems.forEach((problem) => toast.error(problem));
        if (second.accepted.length > 0) setAttachments([...current, ...second.accepted]);
      })
      .catch((caught: unknown) => toast.error(errorText(caught)));
  }

  /** Paste and drop call whichever `attach` the latest render made, so they never hold a stale first mate. */
  const attachRef = useRef(attach);
  attachRef.current = attach;
  useEffect(
    () =>
      receiveFiles(
        pane.current,
        (files) => attachRef.current(files),
        (over) => setDragging(over),
      ),
    [],
  );

  function openPicker(): void {
    pickFiles()
      .then((files) => attach(files))
      .catch((caught: unknown) => toast.error(errorText(caught)));
  }

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      pane: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
      transcript: { flex: 1 },
      scroller: { flex: 1 },
      transcriptBody: { padding: compact ? 10 : 14, gap: 10, width: "100%" as const, maxWidth: 760, alignSelf: "center" as const },
      captain: {
        alignSelf: "flex-end" as const,
        maxWidth: "88%" as const,
        backgroundColor: colors.surface2,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      captainText: { color: colors.foreground, fontSize: 13, lineHeight: 18 },
      mate: { alignSelf: "stretch" as const },
      line: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      lineText: { flex: 1, color: colors.foregroundMuted, fontSize: 11 },
      toolText: { flex: 1, color: colors.foregroundMuted, fontSize: 11, fontFamily: MONOSPACE },
      more: { color: colors.accent, fontSize: 11 },
      error: { color: colors.statusDanger, fontSize: 12 },
      hint: { color: colors.foregroundMuted, fontSize: 12, textAlign: "center" as const, padding: 16 },
      composerFrame: {
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.surface0,
      },
      composer: { padding: compact ? 8 : 10, gap: 8, width: "100%" as const, maxWidth: 760, alignSelf: "center" as const },
      quick: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      prompts: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      dropZone: {
        position: "absolute" as const,
        top: 8,
        right: 8,
        bottom: 8,
        left: 8,
        zIndex: 10,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 6,
        borderWidth: 2,
        borderStyle: "dashed" as const,
        borderColor: colors.accent,
        borderRadius: 10,
        backgroundColor: colors.surface1,
      },
      dropText: { color: colors.foreground, fontSize: 13 },
      inputRow: {
        flexDirection: "row" as const,
        alignItems: "flex-end" as const,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        backgroundColor: colors.surface1,
      },
      inputActions: { flexDirection: "row" as const, gap: 6, padding: 5 },
    };
  }, [theme, compact]);

  /**
   * The draft and its attachments are cleared as the message goes, not when
   * the daemon answers: the box stays editable while it is in flight, and a
   * follow-up typed in that second must not be wiped by the reply. A failed
   * send puts the text back, unless something new has been typed since, and
   * its attachments ahead of any attached since.
   */
  function sendDraft(): void {
    // Another open chat can clear or edit the stores before this render catches up.
    const text = drafts.get(mate.id);
    const attached = pendingAttachments.get(mate.id);
    if (!hasContent(text, attached) || sending) return;
    // Through the stores only: this chat may be gone by the time the send fails, and the one on screen follows them.
    const sent = send(captainMessage(text, attached), () => {
      if (drafts.get(mate.id).trim() === "") drafts.set(mate.id, text);
      pendingAttachments.set(mate.id, restoreFailed(pendingAttachments.get(mate.id), attached));
    });
    if (!sent) return;
    follow.pin();
    setDraft("");
    setAttachments([]);
  }

  /** Bearings or Ahoy: the words are the daemon's, from its templates. */
  function sendCommand(command: MateCommand): void {
    if (sendMateCommand(command)) follow.pin();
  }

  function openLink(url: string): void {
    void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));
  }

  function renderGroup(group: Group) {
    if ("tools" in group) {
      const open = openGroups.has(group.key);
      const shown = open ? group.tools : group.tools.slice(-TOOL_RUN_VISIBLE);
      const hidden = group.tools.length - shown.length;
      return (
        <View key={group.key} style={{ gap: 3 }}>
          {hidden > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show ${hidden} more tool calls`}
              onPress={() => setOpenGroups((current) => new Set([...current, group.key]))}
            >
              <Text style={styles.more}>+ {hidden} more tool calls</Text>
            </Pressable>
          ) : null}
          {shown.map((tool) => (
            <View key={tool.key} style={styles.line}>
              {tool.status === "running" ? (
                <Spinner size={11} color={theme.colors.foregroundMuted} />
              ) : (
                <Icon
                  name={tool.status === "failed" ? "X" : "Wrench"}
                  size={11}
                  color={tool.status === "failed" ? theme.colors.statusDanger : theme.colors.foregroundMuted}
                />
              )}
              <Text style={styles.toolText} numberOfLines={1}>
                {tool.text}
              </Text>
            </View>
          ))}
        </View>
      );
    }
    const row = group.row;
    switch (row.kind) {
      case "plan-ready": {
        const plan = plans.snapshot?.plans.find(p => p.definition.id === row.planId);
        return <View key={row.key} style={{ ...styles.line, flexWrap: "wrap", paddingVertical: 6 }}>
          <Icon name="ListTodo" size={14} color={theme.colors.foregroundMuted} />
          <Text style={{ color: theme.colors.foreground, fontSize: 13, flex: 1 }}>{plan && planAwaitingReview(plan) ? "Plan ready for review" : "Plan"}: {row.text}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${plan && planAwaitingReview(plan) ? "Review" : "Open"} plan: ${row.text}`} onPress={() => plans.open(row.planId)} style={{ minHeight: compact ? 44 : 28, justifyContent: "center", paddingHorizontal: 10 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>{plan && planAwaitingReview(plan) ? "Review" : "Open"}</Text>
          </Pressable>
        </View>;
      }
      case "decision-answer": return <View key={row.key} style={styles.captain}><DecisionAnswerBubble theme={theme} answer={row.answer} /></View>;
      case "decision-raised": {
        const request = decisions.data?.requests.find((entry) => entry.id === row.requestId);
        return request && decisions.data ? (
          <DecisionRaisedCard
            key={row.key}
            theme={theme}
            request={request}
            snapshot={decisions.data}
            mateId={mate.id}
            compact={compact}
            offline={decisions.error !== null}
          />
        ) : null;
      }
      case "captain": {
        const images = sentImages.get(row.messageId);
        return (
          <View key={row.key} style={styles.captain}>
            {images.length > 0 && row.text === ATTACHMENTS_ONLY ? null : (
              <Text selectable style={styles.captainText}>
                {row.text}
              </Text>
            )}
            {row.overview ? <MachineNoteDetails theme={theme} summary="Plan overview" original={row.overview} /> : null}
            {images.length > 0 ? <SentImages images={images} theme={theme} /> : null}
            {row.text === ATTACHMENTS_ONLY ? null : (
              <View style={{ alignItems: "flex-end" }}>
                <MessageCopy text={row.text} theme={theme} />
              </View>
            )}
          </View>
        );
      }
      case "mate":
        return (
          <View key={row.key} style={styles.mate}>
            <Markdown
              source={row.text}
              theme={theme}
              onOpenLink={workspaceLinks.open}
              files={files}
              onOpenFile={onOpenFile}
              workspaceAware
              chatTools
              imageLoader={workspaceLinks.imageLoader}
            />
            <View style={{ alignItems: "flex-start" }}>
              <MessageCopy text={row.text} theme={theme} />
            </View>
          </View>
        );
      case "error":
        return (
          <Text key={row.key} style={styles.error}>
            {row.text}
          </Text>
        );
      default:
        return (
          <View key={row.key} style={styles.line}>
            <Icon name="Bell" size={11} color={theme.colors.foregroundMuted} />
            <Text style={styles.lineText}>{row.text}</Text>
          </View>
        );
    }
  }

  return (
    <View ref={pane} style={[styles.pane, { paddingBottom: keyboard }]}>
      {workspaceLinks.dialog}
      <View style={styles.transcript}>
        <ScrollView {...follow.scrollProps} style={styles.scroller} contentContainerStyle={styles.transcriptBody}>
          {timeline.hasOlder ? (
            <IconButton
              theme={theme}
              icon="History"
              label={timeline.loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}
              showLabel
              disabled={timeline.loadingOlder}
              onPress={() =>
                timeline.loadOlder((prefix, hasOlder) => {
                  // A page containing only hidden reasoning adds no height. Do not leave
                  // an anchor waiting to mistake the next live reply for prepended rows.
                  if (!hasOlder || transcriptRows(prefix).length > 0) follow.preserveOnPrepend();
                })
              }
            />
          ) : null}
          {timeline.error === null ? null : <Text style={styles.error}>{timeline.error}</Text>}
          {groups.length === 0 && pending.length === 0 ? (
            <Text style={styles.hint}>
              {timeline.loading ? "Loading the conversation…" : "Nothing said yet. Ask below."}
            </Text>
          ) : (
            groups.map(renderGroup)
          )}
          {pending.map((request) => (
            // A direct child of the transcript, so its layout is in the transcript's coordinates.
            <View key={request.id} onLayout={(event) => follow.reveal(request.id, event.nativeEvent.layout)}>
              <PermissionCard
                request={request}
                asker="The first mate"
                theme={theme}
                compact={compact}
                onRespond={(response) => respond(request.id, response)}
                onOpenLink={openLink}
              />
            </View>
          ))}
        </ScrollView>
        {follow.away ? <JumpToEnd theme={theme} onPress={follow.jumpToEnd} /> : null}
      </View>
      {/*
        The host pads a surface's top, under its header, but not its bottom, so
        on a phone the composer would sit on the home indicator. React Native's
        own SafeAreaView is the one inset source a plugin can import — the
        safe-area-context library is not among the host's modules. It pads
        only the edges it overlaps, and it replaces any padding in its own
        style, which is why the composer's padding is on the view inside.
        Deprecated in React Native 0.81 but present; the web renderer pads by
        the browser's safe-area insets, which are zero on a desktop.
      */}
      <SafeAreaView style={styles.composerFrame}>
        <View style={styles.composer}>
          {discussion ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {discussing ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Back to the decision: ${discussing.source.title}`}
                  onPress={onReturnDecision} style={{ flex: 1, paddingVertical: 6, minHeight: compact ? 44 : undefined, justifyContent: "center" }}>
                  <Text style={{ color: theme.colors.accent, fontSize: 12 }}>‹ Back to the decision · {discussing.source.title}</Text>
                </Pressable>
              ) : (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, flex: 1 }}>
                  This decision changed or is no longer waiting. Open Needs you to check.
                </Text>
              )}
              <IconButton theme={theme} compact={compact} icon="X" label="Dismiss decision reference" onPress={() => onDismissDiscussion?.()} />
            </View>
          ) : null}
          <View style={styles.quick} onLayout={(event) => setToolbarWidth(event.nativeEvent.layout.width)}>
            <View style={styles.prompts}>
              <IconButton
                icon="Compass"
                label="Bearings"
                compact={compact}
                tooltip="Ask for a fresh fleet overview from saved records and live crew."
                showLabel={toolbarWidth >= 400}
                theme={theme}
                disabled={sending}
                onPress={() => sendCommand("bearings")}
              />
              <IconButton
                icon="Anchor"
                label="Ahoy"
                compact={compact}
                tooltip="Recap this conversation and walk through open decisions. First contact gives Bearings."
                showLabel={toolbarWidth >= 400}
                theme={theme}
                disabled={sending}
                onPress={() => sendCommand("ahoy")}
              />
            </View>
            <MateControls
              theme={theme}
              compact={compact}
              onOpenConversation={
                navigation === undefined ? undefined : () => navigation.openAgent({ agentId: mate.id })
              }
              usedTokens={usage?.contextWindowUsedTokens}
              maxTokens={usage?.contextWindowMaxTokens}
              running={status === "running" || status === "initializing"}
              onChanged={onChanged}
            />
          </View>
          {attachments.length === 0 ? null : (
            <View style={styles.chips}>
              {attachments.map((attachment) => (
                <AttachmentChip
                  key={attachment.id}
                  attachment={attachment}
                  theme={theme}
                  compact={compact}
                  onRemove={() =>
                    setAttachments(pendingAttachments.get(mate.id).filter((kept) => kept.id !== attachment.id))
                  }
                />
              ))}
            </View>
          )}
          <View style={styles.inputRow}>
            <GrowingChatInput
              ref={composer}
              theme={theme}
              compact={compact}
              accessibilityLabel="Message the first mate"
              value={draft}
              onChangeText={setDraft}
              placeholder={placeholder}
              placeholderTextColor={theme.colors.foregroundMuted}
              multiline
              numberOfLines={1}
              onKeyPress={
                submitOnEnter
                  ? (event: WebKeyPressEvent) => {
                      // Nothing to send, or a send in flight: Enter is left alone, as Paseo leaves it.
                      if (!isSendKey(event.nativeEvent) || sending || !hasContent(draft, attachments)) return;
                      event.preventDefault();
                      sendDraft();
                    }
                  : undefined
              }
            />
            <View style={styles.inputActions}>
              {canAttachFiles ? (
                <IconButton icon="Paperclip" label="Attach files or images" compact={compact} theme={theme} onPress={openPicker} />
              ) : null}
              <IconButton
                icon="Send"
                label="Send"
                compact={compact}
                tone="accent"
                theme={theme}
                disabled={sending || !hasContent(draft, attachments)}
                onPress={sendDraft}
              />
            </View>
          </View>
        </View>
      </SafeAreaView>
      {dragging ? (
        /*
          Over the whole chat, transcript through composer, since the whole
          pane takes the drop; it never takes the pointer itself. The pane's
          last child and raised, because on the web renderer every view is
          positioned and a later sibling — the composer — paints over an
          earlier one; opaque, so the transcript's scrollbar does not show
          through its right edge.
        */
        <View pointerEvents="none" style={styles.dropZone}>
          <Icon name="Paperclip" size={18} color={theme.colors.accent} />
          <Text style={styles.dropText}>Drop to attach</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Images carried by the captain's message, shared by Home and Chat. */
function SentImages({ images, theme }: { images: readonly ImagePart[]; theme: PluginTheme }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 3 }}>
      {images.map((image, index) => (
        <ChatImage
          key={index}
          uri={`data:${image.mimeType};base64,${image.data}`}
          theme={theme}
          label={images.length === 1 ? "Image you sent" : `Image ${index + 1} of ${images.length} you sent`}
        />
      ))}
    </View>
  );
}
/** One attachment waiting to go: a thumbnail for an image, an icon for a file; its name, size and a remove button. */
function AttachmentChip({
  attachment,
  theme,
  compact,
  onRemove,
}: {
  attachment: PendingAttachment;
  theme: PluginTheme;
  compact: boolean;
  onRemove: () => void;
}) {
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        maxWidth: 220,
        paddingLeft: 4,
        paddingRight: 2,
        paddingVertical: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      thumb: { width: 28, height: 28, borderRadius: 4, backgroundColor: colors.surface2 },
      icon: {
        width: 28,
        height: 28,
        borderRadius: 4,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: colors.surface2,
      },
      text: { flexShrink: 1 },
      name: { color: colors.foreground, fontSize: 12 },
      size: { color: colors.foregroundMuted, fontSize: 10 },
      remove: { padding: 4, minHeight: compact ? 44 : undefined, minWidth: compact ? 44 : undefined,
        alignItems: "center" as const, justifyContent: "center" as const },
    }),
    [colors, compact],
  );
  return (
    <View style={styles.chip}>
      {attachment.kind === "image" ? (
        <Image
          source={{ uri: `data:${attachment.mimeType};base64,${attachment.data}` }}
          style={styles.thumb}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={styles.icon}>
          <Icon name="File" size={14} color={colors.foregroundMuted} />
        </View>
      )}
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {attachment.fileName}
        </Text>
        <Text style={styles.size}>{formatBytes(attachment.size)}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${attachment.fileName}`}
        hitSlop={6}
        style={styles.remove}
        onPress={onRemove}
      >
        <Icon name="X" size={14} color={colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}
