/**
 * Converse: a worker's conversation, or a light item discussion with the first mate.
 *
 * The drawer opens from a card's 💬 on the board and the list, and from the
 * deck's focus panel. On a wide layout it docks beside the surface it was
 * opened from, which stays live; where the pane is too narrow for both it takes
 * the pane, and its back button names where it goes. On a phone it fills the
 * Crew tab. Esc, ✕ or back return exactly where the captain was, focus
 * included — the first-mate chat on the left never moves.
 *
 * Top to bottom: the worker's title, state and glance (status line, the
 * captain's call, an error, its link); ⋯ for its details and actions (the
 * card, `presentation: "drawer"`); the transcript, **Conversation** — the words
 * first, tool runs folded (`conversation-rows.ts`) — or **Activity**, every
 * tool call and its reasoning (`activity-rows.ts`); any question or permission
 * it is waiting on, answered here; and a composer that steers it through the
 * board's own steer RPCs, so the first mate hears what was said — one note per
 * burst (`queueBurstNote` on the daemon).
 *
 * A remote worker has no timeline here: its recent text log, read every ten
 * seconds through the remote request path, and its permissions are answered on
 * its host. Open in Paseo (↗) is kept for what only Paseo has — model and mode,
 * the worktree's files, terminals — and for history past the tail read here.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";

import { interruptCrew, steerCrew, type FleetCard } from "../shared/fleet";
import { interruptRemoteCrew, remoteCrewLogs, steerRemoteCrew } from "../shared/remote-crew";
import { activityRows, type ActivityRow, type PlanStatus } from "./activity-rows";
import { CrewCard } from "./card";
import {
  SPEAKER_LABELS,
  conversationRows,
  logCount,
  planText,
  promptCount,
  toolRunText,
  unseenSends,
  type ConversationRow,
  type SentMessage,
} from "./conversation-rows";
import { converseTarget } from "./converse-layout";
import { watchKey } from "./host-tabs";
import { itemTagKey } from "../shared/item-tags";
import { readItemThread, sendItemThread, type ThreadMessage } from "../shared/item-threads";
import { drafts } from "./draft";
import { useFollowEnd } from "./follow-end";
import { REPORT_STATES, agentStatusLabel, agentStatusTone, cardHeadline, columnTone, relativeTime } from "./format";
import { useKeyboardOverlap } from "./keyboard";
import { isSendKey, type WebKeyPressEvent } from "./keys";
import { Markdown } from "./markdown";
import { PermissionCard, usePendingRequests } from "./permission-card";
import { Chip, IconButton, JumpToEnd, MONOSPACE, Segmented, Spinner, Tag, errorText } from "./ui";
import { useAgentTimeline } from "./use-timeline";
import { bindWebKeys } from "./web";

/** How much of a crewmate's history is read: its tail, this many entries long. */
const TIMELINE_LIMIT = 200;
/** How often a remote worker's log is read again while it is on screen. */
const REMOTE_REFRESH_MS = 10000;
/**
 * A prompt or reasoning longer than this is folded until pressed. Only text
 * that gets the Show all toggle is clamped: a paragraph judged short can still
 * wrap past the fold on a phone, and clamping it would hide the rest for good.
 */
const FOLDED_LINES = 6;

/** Conversation or Activity, kept across drawers like the rest of the surface. */
let transcriptMode: "conversation" | "activity" = "conversation";

function isLong(text: string): boolean {
  return text.split("\n").length > FOLDED_LINES || text.length > 480;
}

interface DrawerProps {
  /** The worker, by `watchKey`. */
  watchKey: string;
  /** Null once the worker has left the board — ended, archived, or its host removed. */
  card: FleetCard | null;
  theme: PluginTheme;
  compact: boolean;
  /** Beside the surface it came from, with ✕; otherwise over it, with a back button named `backLabel`. */
  docked: boolean;
  backLabel: string;
  onClose: () => void;
  /** Opens a local worker in Paseo; absent where the host gives no navigation. */
  onOpen: (() => void) | null;
  onChanged: () => void;
}

export function ConverseDrawer(props: DrawerProps) {
  const target = converseTarget(props.watchKey);
  const [discussion, setDiscussion] = useState(target.kind === "thread");
  const workerKey = props.card === null ? null : watchKey(props.card);
  const worker = target.kind === "thread" ? (workerKey === null ? null : converseTarget(workerKey)) : target;
  const itemKey = target.kind === "thread" ? target.itemKey : props.card === null ? null : itemTagKey(props.card);
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {worker === null || itemKey === null ? null : (
        <View style={{ padding: 8 }}>
          <Segmented theme={props.theme} value={discussion ? "discussion" : "worker"} options={[
            { value: "worker", label: "Worker", tooltip: "Read and steer the worker." },
            { value: "discussion", label: "Item discussion", tooltip: "The saved discussion with the first mate." },
          ]} onChange={(value) => setDiscussion(value === "discussion")} />
        </View>
      )}
      {discussion && itemKey !== null ? (
        <ItemConverse {...props} key={`thread:${itemKey}`} itemKey={itemKey} />
      ) : worker?.kind === "local" ? (
        <LocalConverse {...props} watchKey={workerKey ?? props.watchKey} key={worker.agentId} agentId={worker.agentId} />
      ) : worker?.kind === "remote" ? (
        <RemoteConverse {...props} watchKey={workerKey ?? props.watchKey} key={`${worker.serverId}:${worker.agentId}`} serverId={worker.serverId} agentId={worker.agentId} />
      ) : null}
    </View>
  );
}

/** A file-backed discussion with the existing first mate. Opening it sends nothing. */
function ItemConverse({ itemKey, ...props }: DrawerProps & { itemKey: string }) {
  const { card, theme, compact } = props;
  const read = useRpc(readItemThread);
  const send = useRpc(sendItemThread);
  const toast = useToast();
  const follow = useFollowEnd();
  const busy = useRef(false);
  const retry = useRef<{ id: string; kind: ThreadMessage["kind"]; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmWork, setConfirmWork] = useState(false);
  const draftKey = `item-thread:${itemKey}`;
  const [hasDraft, setHasDraft] = useState(() => drafts.get(draftKey).trim() !== "");
  useEffect(() => drafts.subscribe(() => setHasDraft(drafts.get(draftKey).trim() !== "")), [draftKey]);
  const thread = useQuery({ queryKey: ["firstmate", "item-thread", itemKey], queryFn: () => read({ key: itemKey }), refetchInterval: 5000 });
  const messages = thread.data?.messages ?? [];
  const requested = messages.some((entry) => entry.kind === "graduate");
  const hasWorker = card !== null && watchKey(card) !== null;
  const announcement = useAnnouncement(messages.filter((entry) => entry.reply !== null).length, thread.data !== undefined, "The first mate replied.");

  async function submit(text: string, kind: ThreadMessage["kind"] = "discuss"): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setSending(true);
    follow.pin();
    try {
      const request = retry.current?.text === text && retry.current.kind === kind ? retry.current
        : { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, kind, text };
      retry.current = request;
      const result = await send({ key: itemKey, ...request });
      retry.current = null;
      const last = result.messages[result.messages.length - 1];
      if (last?.delivery === "uncertain") toast.error("Delivery is uncertain. Check the first mate in Paseo before sending it again.");
      setConfirmWork(false);
      await thread.refetch();
      props.onChanged();
      return true;
    } catch (error) {
      toast.error(errorText(error));
      // The server may have reserved a send before the connection failed. Re-read before another attempt.
      await thread.refetch();
      return false;
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  return (
    <DrawerShell {...props} onOpen={null} transcriptSwitch={null} composer={
      <Composer draftKey={draftKey} theme={theme} compact={compact}
        recipient="To: first mate · discussion about this item" placeholder="Discuss this item…"
        sendLabel="Send to first mate" sendTooltip="Send this item discussion to the first mate."
        hint={requested ? "Work has been requested. Continue clarifying it here; use Worker once one appears." : "Discuss and clarify here. Start work explicitly when you are ready."}
        announcement={announcement} disabledReason={card === null ? "This item is no longer on the board. Its saved discussion is still readable." : thread.data === undefined ? "Loading the discussion…" : null}
        sending={sending} running={false} onInterrupt={() => {}} onSend={submit} />
    }>
      <ScrollView {...follow.scrollProps} contentContainerStyle={{ padding: compact ? 10 : 14, gap: 12 }} automaticallyAdjustKeyboardInsets>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {hasWorker ? "Saved item discussion with the first mate. Use Worker to read and steer the worker." : "A light thread with the first mate. No crewmate or worktree is created by opening or discussing this item."}
        </Text>
        {thread.error === null ? null : <Text style={{ color: theme.colors.statusDanger }}>{errorText(thread.error)}</Text>}
        {messages.map((entry) => (
          <View key={entry.id} style={{ gap: 6 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>YOU{entry.kind === "graduate" ? " · START WORK" : ""}</Text>
            <Text selectable style={{ color: theme.colors.foreground, fontSize: 13 }}>{entry.text || "Start work from this discussion."}</Text>
            {entry.reply === null ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                {entry.delivery === "uncertain" ? "Delivery uncertain. Check the first mate in Paseo before sending again." : "Sent to the first mate · awaiting its saved reply. If it needs a permission, answer it in the bridge."}
              </Text>
            ) : (
              <>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>FIRST MATE</Text>
                <Markdown source={entry.reply} theme={theme} onOpenLink={(url) => void openExternalUrl(url).catch((error: unknown) => toast.error(errorText(error)))} />
              </>
            )}
          </View>
        ))}
        {requested ? <Text style={{ color: theme.colors.accent, fontSize: 12 }}>{hasWorker ? "A worker is available. Open Worker above to converse with it." : "Work requested · the first mate owns dispatch. A worker has not appeared yet."}</Text> : null}
        {hasWorker || card === null || requested || messages.length === 0 ? null : (
          <View style={{ gap: 8 }}>
            {confirmWork ? <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>Ask the first mate to turn this discussion into a brief and dispatch a crewmate? It will carry the discussion's decisions into the work.</Text> : null}
            <IconButton theme={theme} icon="Play" label={confirmWork ? "Request dispatch" : "Start work…"} showLabel tone="accent"
              disabled={sending || thread.isFetching || hasDraft} onPress={() => confirmWork ? void submit("", "graduate") : setConfirmWork(true)} />
            {hasDraft ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Send your draft before requesting work so it is part of the discussion.</Text> : null}
            {confirmWork ? <IconButton theme={theme} icon="X" label="Keep discussing" showLabel onPress={() => setConfirmWork(false)} /> : null}
          </View>
        )}
      </ScrollView>
      {follow.away ? <JumpToEnd theme={theme} onPress={follow.jumpToEnd} /> : null}
    </DrawerShell>
  );
}

// ---------------------------------------------------------------------------
// What the captain has sent, until the transcript shows it
// ---------------------------------------------------------------------------

type Sent = SentMessage & { seenBefore: number };

/**
 * The captain's messages from the composer: "sending", then "sent" until the
 * transcript has them, or "failed" with the reason and a Retry. `seen` counts
 * how often the transcript already says a text, so a repeat is told apart.
 */
function useSends(deliver: (text: string) => Promise<unknown>, seen: (text: string) => number) {
  const [sends, setSends] = useState<Sent[]>([]);
  const visible = unseenSends(sends, seen);
  const visibleIds = visible.map((send) => send.id).join(" ");
  // Forget a send the transcript has shown, so a tail that later scrolls past it cannot bring it back.
  useEffect(() => {
    const keep = new Set(visibleIds.split(" "));
    setSends((current) => (current.every((send) => keep.has(send.id)) ? current : current.filter((send) => keep.has(send.id))));
  }, [visibleIds]);

  function submit(text: string, retrying?: string): Promise<boolean> {
    const id = retrying ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const entry: Sent = { id, text, state: "sending", seenBefore: seen(text.trim()) };
    setSends((current) => [...current.filter((send) => send.id !== id), entry]);
    return deliver(text).then(
      () => {
        setSends((current) => current.map((send) => (send.id === id ? { ...send, state: "sent" } : send)));
        return true;
      },
      (caught: unknown) => {
        setSends((current) =>
          current.map((send) => (send.id === id ? { ...send, state: "failed", error: errorText(caught) } : send)),
        );
        return false;
      },
    );
  }

  return {
    sends: visible,
    sending: sends.some((send) => send.state === "sending"),
    submit,
    dismiss: (id: string) => setSends((current) => current.filter((send) => send.id !== id)),
  };
}

// ---------------------------------------------------------------------------
// A local crewmate
// ---------------------------------------------------------------------------

function LocalConverse({ agentId, ...props }: DrawerProps & { agentId: string }) {
  const { card, theme, compact, onOpen, onChanged } = props;
  const toast = useToast();
  const steer = useRpc(steerCrew);
  const interrupt = useRpc(interruptCrew);
  const agent = card?.agent ?? null;
  const revision = agent === null ? "" : `${agent.updatedAt}:${agent.pendingPermissions}`;
  const timeline = useAgentTimeline(agentId, revision, TIMELINE_LIMIT);
  const rows = useMemo(() => activityRows(timeline.entries), [timeline.entries]);
  const follow = useFollowEnd();
  const { pending, respond } = usePendingRequests(agentId, timeline.agent?.pendingPermissions, follow.pin);
  const status = timeline.agent?.status ?? agent?.status ?? null;
  const running = status === "running" || status === "initializing";
  const sends = useSends(
    (text) => steer({ agentId, text }).then(() => onChanged()),
    (text) => promptCount(rows, text),
  );
  const [mode, setModeState] = useState(transcriptMode);
  const replies = rows.filter((row) => row.kind === "reply").length;
  const announce = useAnnouncement(replies, timeline.agent !== null,`${card?.title ?? "The worker"} replied.`);

  function setMode(next: typeof mode): void {
    transcriptMode = next;
    setModeState(next);
  }

  function openLink(url: string): void {
    void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));
  }

  const hint =
    card === null
      ? null
      : pending.length > 0
        ? "It is waiting on the request above; answer it there."
        : running
          ? "Joins its running turn where its provider can; otherwise it restarts the turn with your message."
          : "Your message starts a new turn.";

  return (
    <DrawerShell
      {...props}
      transcriptSwitch={<TranscriptSwitch theme={theme} mode={mode} onChange={setMode} />}
      composer={
        card === null ? (
          <ComposerNote theme={theme} text="Ended. Its worktree is kept; ask the first mate to relaunch it." />
        ) : (
          <Composer
            draftKey={`converse:${props.watchKey}`}
            theme={theme}
            compact={compact}
            recipient={`To: ${card.taskId ?? card.title} worker · the first mate hears what you say and its answer`}
            placeholder="Message the worker…"
            hint={hint}
            announcement={announce}
            disabledReason={null}
            sending={sends.sending}
            running={running}
            onInterrupt={() => {
              void interrupt({ agentId }).then(
                () => { toast.show("Interrupted.", { variant: "success" }); onChanged(); },
                (caught: unknown) => toast.error(errorText(caught)),
              );
            }}
            onSend={(text) => {
              follow.pin();
              return sends.submit(text);
            }}
          />
        )
      }
    >
      <ScrollView {...follow.scrollProps} contentContainerStyle={{ padding: compact ? 10 : 14, gap: 8 }} automaticallyAdjustKeyboardInsets>
        {timeline.hasOlder ? (
          <TranscriptLine theme={theme} icon="History">
            Only the latest activity is shown here.{" "}
            {onOpen === null ? null : (
              <Text accessibilityRole="link" style={{ color: theme.colors.accent, textDecorationLine: "underline" }} onPress={onOpen}>
                The rest is in Paseo.
              </Text>
            )}
          </TranscriptLine>
        ) : null}
        {timeline.error === null ? null : <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{timeline.error}</Text>}
        {rows.length === 0 && pending.length === 0 && sends.sends.length === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, textAlign: "center", padding: 16 }}>
            {timeline.loading ? "Loading the worker's conversation…" : "Nothing has happened yet."}
          </Text>
        ) : mode === "conversation" ? (
          <ConversationRows rows={conversationRows(rows)} theme={theme} onOpenLink={openLink} />
        ) : (
          <ActivityRows rows={rows} theme={theme} onOpenLink={openLink} />
        )}
        <SentRows sends={sends.sends} theme={theme} onRetry={(send) => void sends.submit(send.text, send.id)} onDismiss={sends.dismiss} />
        {pending.map((request) => (
          // A direct child of the transcript, so its layout is in the transcript's coordinates.
          <View key={request.id} onLayout={(event) => follow.reveal(request.id, event.nativeEvent.layout)}>
            <PermissionCard
              request={request}
              theme={theme}
              compact={compact}
              onRespond={(response) => respond(request.id, response)}
              onOpenLink={openLink}
            />
          </View>
        ))}
        {running && pending.length === 0 ? (
          <TranscriptLine theme={theme} spinner>
            Working…
          </TranscriptLine>
        ) : null}
      </ScrollView>
      {follow.away ? <JumpToEnd theme={theme} onPress={follow.jumpToEnd} /> : null}
    </DrawerShell>
  );
}

// ---------------------------------------------------------------------------
// A worker on a remote host
// ---------------------------------------------------------------------------

function RemoteConverse({ serverId, agentId, ...props }: DrawerProps & { serverId: string; agentId: string }) {
  const { card, theme, compact, onChanged } = props;
  const toast = useToast();
  const readLogs = useRpc(remoteCrewLogs);
  const steerRemote = useRpc(steerRemoteCrew);
  const interruptRemote = useRpc(interruptRemoteCrew);
  const logs = useQuery({
    queryKey: ["firstmate", "remote-logs", serverId, agentId],
    queryFn: () => readLogs({ serverId, agentId }),
    enabled: card !== null,
    refetchInterval: REMOTE_REFRESH_MS,
  });
  const follow = useFollowEnd();
  const remote = card?.remote ?? null;
  const worker = remote?.worker ?? null;
  const running = worker !== null && (worker.status === "running" || worker.status === "initializing");
  const host = remote?.host ?? "its host";
  const log = logs.data?.text ?? "";
  const sends = useSends(
    (text) =>
      steerRemote({ serverId, agentId, text }).then(() => {
        onChanged();
        void logs.refetch();
      }),
    (text) => logCount(log, text),
  );

  const disabledReason =
    remote === null || worker === null
      ? null
      : remote.serverId === null
        ? `${host} is not a saved host, so nothing can be sent to it from here.`
        : !remote.online
          ? `${host} is unreachable; you can send once it answers.`
          : null;
  const hint =
    worker !== null && worker.pendingPermissions > 0
      ? `It is waiting on a permission; its permissions are answered on ${host}.`
      : running
        ? "Joins its running turn where its provider can; otherwise it restarts the turn with your message."
        : `Its log is read every ${REMOTE_REFRESH_MS / 1000} s; permissions are answered on ${host}.`;

  return (
    <DrawerShell
      {...props}
      onOpen={null}
      transcriptSwitch={null}
      composer={
        card === null || worker === null ? (
          <ComposerNote theme={theme} text="This worker is no longer on the board — ended, archived, or its host removed." />
        ) : (
          <Composer
            draftKey={`converse:${props.watchKey}`}
            theme={theme}
            compact={compact}
            recipient={`To: ${card.taskId ?? worker.name} on ${host} · the first mate hears what you say`}
            placeholder={`Message the worker on ${host}…`}
            hint={hint}
            announcement={null}
            disabledReason={disabledReason}
            sending={sends.sending}
            running={running}
            onInterrupt={() => {
              void interruptRemote({ serverId, agentId }).then(
                () => { toast.show("Interrupted.", { variant: "success" }); onChanged(); },
                (caught: unknown) => toast.error(errorText(caught)),
              );
            }}
            onSend={(text) => {
              follow.pin();
              return sends.submit(text);
            }}
          />
        )
      }
    >
      <ScrollView {...follow.scrollProps} contentContainerStyle={{ padding: compact ? 10 : 14, gap: 8 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {[
            `Recent activity on ${host}, read every ${REMOTE_REFRESH_MS / 1000} s`,
            logs.data === undefined ? null : `last read ${relativeTime(logs.data.readAt)}`,
          ]
            .filter((part): part is string => part !== null)
            .join(" · ")}
        </Text>
        {logs.error === null ? null : <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{errorText(logs.error)}</Text>}
        {logs.data === undefined ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{logs.isFetching ? "Reading the worker's activity…" : ""}</Text>
        ) : (
          <Text selectable style={{ color: theme.colors.foreground, fontSize: 12, lineHeight: 18, fontFamily: MONOSPACE }}>
            {log === "" ? "Nothing has happened yet." : log}
          </Text>
        )}
        <SentRows sends={sends.sends} theme={theme} onRetry={(send) => void sends.submit(send.text, send.id)} onDismiss={sends.dismiss} />
      </ScrollView>
      {follow.away ? <JumpToEnd theme={theme} onPress={follow.jumpToEnd} /> : null}
    </DrawerShell>
  );
}

// ---------------------------------------------------------------------------
// The drawer around either
// ---------------------------------------------------------------------------

function DrawerShell({
  card,
  theme,
  compact,
  docked,
  backLabel,
  onClose,
  onOpen,
  onChanged,
  transcriptSwitch,
  composer,
  children,
}: DrawerProps & { transcriptSwitch: ReactNode; composer: ReactNode; children: ReactNode }) {
  const root = useRef<View>(null);
  const keyboard = useKeyboardOverlap(root);
  const [details, setDetails] = useState(false);
  const toast = useToast();
  const close = useRef(onClose);
  close.current = onClose;
  // Esc goes back to where the drawer was opened from. Capture, because a text box keeps its key presses to itself.
  useEffect(
    () =>
      root.current === null
        ? undefined
        : bindWebKeys(root.current, (key) => {
            if (key !== "Escape") return false;
            close.current();
            return true;
          }, true),
    [],
  );

  const title = card?.title ?? "Item conversation";
  const agent = card?.agent ?? null;
  const remote = card?.remote ?? null;
  const worker = remote?.worker ?? null;
  const status = agent ?? (worker === null ? null : { pendingPermissions: worker.pendingPermissions, status: worker.status });
  const stateChip =
    card?.note !== undefined
      ? { text: card.note, color: columnTone(theme, card.column) }
      : status === null
        ? null
        : { text: agentStatusLabel(status), color: agentStatusTone(theme, status) };
  const hostText =
    remote === null ? null : `${remote.host}${remote.serverId === null ? " · not a saved host" : remote.online ? "" : " · unreachable"}`;
  const headline = card === null ? null : cardHeadline(card);
  /** The records, one line each: its status line, the captain's call, an error; else the card's own headline. */
  const glance: Array<{ key: string; lead: string | null; text: string; danger: boolean }> = [];
  if (card !== null) {
    if (card.report !== null) {
      glance.push({ key: "report", lead: REPORT_STATES[card.report.state] ?? card.report.state, text: card.report.text, danger: false });
    }
    if (card.backlog?.hold !== null && card.backlog?.hold !== undefined) {
      glance.push({ key: "hold", lead: "Captain's call", text: card.backlog.hold, danger: false });
    }
    if (agent?.lastError !== null && agent?.lastError !== undefined && agent.lastError !== "") {
      glance.push({ key: "error", lead: null, text: agent.lastError, danger: true });
    }
    if (glance.length === 0 && headline !== null) {
      glance.push({ key: "headline", lead: headline.lead, text: headline.text, danger: headline.tone === "danger" });
    }
  }

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      screen: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        backgroundColor: colors.surface0,
        ...(docked ? { borderLeftWidth: 1, borderLeftColor: colors.border } : null),
      },
      head: { paddingHorizontal: compact ? 10 : 12, paddingTop: compact ? 4 : 12, paddingBottom: 8, gap: 6 },
      bar: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      title: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14, lineHeight: 19, fontWeight: "600" as const },
      chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: 6 },
      glance: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      lead: { color: card === null ? colors.foregroundMuted : columnTone(theme, card.column), fontWeight: "600" as const },
      link: { color: colors.accent, fontSize: 12, textDecorationLine: "underline" as const },
      details: { flexGrow: 0, maxHeight: "45%" as const, paddingHorizontal: compact ? 10 : 12, paddingBottom: 8 },
      frame: {
        flex: 1,
        minHeight: 0,
        marginHorizontal: compact ? 10 : 12,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: colors.surface1,
        overflow: "hidden" as const,
      },
    };
  }, [theme, compact, docked, card]);

  return (
    <View
      ref={root}
      role="complementary"
      aria-label={`Conversation with ${title}`}
      style={[styles.screen, { paddingBottom: keyboard }]}
    >
      <View style={styles.head}>
        <View style={styles.bar}>
          {docked ? null : (
            <IconButton icon="ChevronLeft" label={backLabel} tooltip={`Back to ${backLabel} (Esc).`} showLabel theme={theme} onPress={onClose} />
          )}
          <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {onOpen === null ? null : (
            <IconButton
              icon="ExternalLink"
              label="Open in Paseo"
              tooltip="Open in Paseo, for what only Paseo has: model and mode, the worktree's files, terminals. What you type there is not relayed to the first mate."
              tooltipAlign="end"
              tooltipSide="bottom"
              theme={theme}
              onPress={onOpen}
            />
          )}
          {card === null ? null : (
            <IconButton
              icon="Ellipsis"
              label={details ? "Hide details and actions" : "Show details and actions"}
              tooltip={details ? "Hide its details and actions." : "Its details, and Interrupt, Relaunch and End."}
              tooltipAlign="end"
              tooltipSide="bottom"
              tone={details ? "accent" : "default"}
              theme={theme}
              onPress={() => setDetails(!details)}
            />
          )}
          {docked ? (
            <IconButton icon="X" label="Close the conversation" tooltip="Close (Esc)." tooltipAlign="end" tooltipSide="bottom" theme={theme} onPress={onClose} />
          ) : null}
        </View>
        <View style={styles.chips}>
          {stateChip === null ? null : <Chip theme={theme} text={stateChip.text} color={stateChip.color} />}
          {card?.project === null || card?.project === undefined || card.project === "" ? null : <Tag theme={theme} text={card.project} />}
          {hostText === null ? (card === null ? null : <Tag theme={theme} text="This machine" />) : (
            <Tag theme={theme} icon="Server" text={hostText} color={remote?.online === true ? undefined : theme.colors.statusWarning} />
          )}
          {worker?.followed === true ? <Tag theme={theme} text="followed, not crew" /> : null}
        </View>
        {card === null ? (
          <Text style={styles.glance}>This worker is no longer on the board — it was ended or archived.</Text>
        ) : (
          <>
            {glance.map((line) => (
              <Text
                key={line.key}
                style={[styles.glance, line.danger ? { color: theme.colors.statusDanger } : null]}
                numberOfLines={1}
              >
                {line.lead === null ? null : <Text style={styles.lead}>{line.lead}: </Text>}
                {line.text}
              </Text>
            ))}
            {card.url === null ? null : (
              <Text
                accessibilityRole="link"
                style={styles.link}
                numberOfLines={1}
                onPress={() => void openExternalUrl(card.url ?? "").catch((caught: unknown) => toast.error(errorText(caught)))}
              >
                {card.url.replace(/^https?:\/\/(www\.)?github\.com\//, "")}
              </Text>
            )}
          </>
        )}
      </View>
      {details && card !== null ? (
        <ScrollView style={styles.details} automaticallyAdjustKeyboardInsets>
          <CrewCard card={card} theme={theme} compact={compact} presentation="drawer" opener={null} onChanged={onChanged} />
        </ScrollView>
      ) : null}
      {transcriptSwitch === null ? null : <View style={{ paddingHorizontal: compact ? 10 : 12, paddingBottom: 8 }}>{transcriptSwitch}</View>}
      <View style={styles.frame}>{children}</View>
      {composer}
    </View>
  );
}

function TranscriptSwitch({
  theme,
  mode,
  onChange,
}: {
  theme: PluginTheme;
  mode: "conversation" | "activity";
  onChange: (mode: "conversation" | "activity") => void;
}) {
  return (
    <View style={{ flexDirection: "row" }}>
      <Segmented
        theme={theme}
        value={mode}
        options={[
          { value: "conversation", label: "Conversation", tooltip: "What was said, tool calls folded." },
          { value: "activity", label: "Activity", tooltip: "Every tool call, its output, and the worker's reasoning." },
        ]}
        onChange={onChange}
      />
    </View>
  );
}

/**
 * Announces something new once, politely, after the first read: a reply that
 * arrives while the drawer is open. Returns the text to put in a live region.
 */
function useAnnouncement(count: number, read: boolean, text: string): string | null {
  const seen = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  useEffect(() => {
    // Nothing counts until the first page is in: what it holds was there before the drawer opened.
    if (!read) return;
    if (seen.current !== null && count > seen.current) setAnnouncement(text);
    seen.current = count;
  }, [count, read, text]);
  return announcement;
}

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

function ComposerNote({ theme, text }: { theme: PluginTheme; text: string }) {
  return (
    <SafeAreaView style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 10 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, padding: 12 }}>{text}</Text>
    </SafeAreaView>
  );
}

/**
 * Enter sends and Shift+Enter starts a new line, on the web in a wide layout,
 * as the chat's composer does; a phone's return key makes new lines and the
 * button sends. The draft is kept per worker beside the chat's (`draft.ts`),
 * so it outlives closing the drawer, a column change and a reload.
 */
function Composer({
  draftKey,
  theme,
  compact,
  recipient,
  placeholder,
  hint,
  announcement,
  disabledReason,
  sending,
  running,
  onInterrupt,
  onSend,
  sendLabel = "Send to worker",
  sendTooltip = "Send to the worker. The first mate hears of it.",
}: {
  draftKey: string;
  theme: PluginTheme;
  compact: boolean;
  recipient: string;
  placeholder: string;
  hint: string | null;
  announcement: string | null;
  /** Why nothing can be sent now, or null. */
  disabledReason: string | null;
  sending: boolean;
  running: boolean;
  onInterrupt: () => void;
  /** Resolves false when the send failed, so the words can come back to the box. */
  onSend: (text: string) => Promise<boolean>;
  sendLabel?: string;
  sendTooltip?: string;
}) {
  const [draft, setDraftState] = useState(() => drafts.get(draftKey));
  useEffect(() => drafts.subscribe(() => setDraftState(drafts.get(draftKey))), [draftKey]);
  const submitOnEnter = Platform.OS === "web" && !compact;
  const blocked = disabledReason !== null || sending;
  const colors = theme.colors;

  function setDraft(text: string): void {
    drafts.set(draftKey, text);
    setDraftState(text);
  }

  function send(): void {
    const text = draft.trim();
    if (text === "" || blocked) return;
    setDraft("");
    void onSend(text).then((ok) => {
      // A failed send puts its words back, unless something new has been typed since.
      if (!ok && drafts.get(draftKey).trim() === "") setDraft(text);
    });
  }

  return (
    <SafeAreaView style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10 }}>
      <View style={{ padding: compact ? 8 : 10, gap: 6 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }} numberOfLines={2}>
          {recipient}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={submitOnEnter ? `${placeholder} (Enter sends, Shift+Enter for a new line)` : placeholder}
            placeholderTextColor={colors.foregroundMuted}
            accessibilityLabel={recipient}
            multiline
            editable={disabledReason === null}
            // On the web the composer takes focus as the drawer opens; on a phone nothing does, so no keyboard pops up.
            autoFocus={submitOnEnter}
            onKeyPress={
              submitOnEnter
                ? (event: WebKeyPressEvent) => {
                    if (!isSendKey(event.nativeEvent) || blocked || draft.trim() === "") return;
                    event.preventDefault();
                    send();
                  }
                : undefined
            }
            style={{
              flex: 1,
              color: colors.foreground,
              fontSize: 13,
              minHeight: 44,
              maxHeight: 160,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              backgroundColor: colors.surface1,
              textAlignVertical: "top",
            }}
          />
          <View style={{ gap: 6 }}>
            {running ? (
              <IconButton icon="Square" label="Interrupt" tooltip="Stop this worker's current turn." tooltipAlign="end" theme={theme} onPress={onInterrupt} />
            ) : null}
            <IconButton
              icon="Send"
              label={sendLabel}
              tooltip={disabledReason ?? (sending ? "Wait for the message on its way." : sendTooltip)}
              tooltipAlign="end"
              tone="accent"
              theme={theme}
              disabled={blocked || draft.trim() === ""}
              onPress={send}
            />
          </View>
        </View>
        {disabledReason !== null || hint !== null || announcement !== null ? (
          <Text
            accessibilityLiveRegion="polite"
            aria-live="polite"
            style={{ color: disabledReason === null ? colors.foregroundMuted : colors.statusWarning, fontSize: 11 }}
          >
            {[announcement, disabledReason ?? hint].filter((part): part is string => part !== null).join(" ")}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Transcript rows
// ---------------------------------------------------------------------------

function TranscriptLine({ theme, icon, spinner = false, children }: { theme: PluginTheme; icon?: string; spinner?: boolean; children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {spinner ? <Spinner size={11} color={theme.colors.accent} /> : <Icon name={icon ?? "Bell"} size={11} color={theme.colors.foregroundMuted} />}
      <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 11 }}>{children}</Text>
    </View>
  );
}

function useRowStyles(theme: PluginTheme) {
  return useMemo(() => {
    const { colors } = theme;
    return {
      label: { color: colors.foregroundMuted, fontSize: 10, fontWeight: "600" as const, letterSpacing: 0.6, marginTop: 4 },
      captain: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: 10 },
      prompt: { borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: 10 },
      promptText: { color: colors.foreground, fontSize: 13, lineHeight: 19 },
      reasoning: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontStyle: "italic" as const },
      more: { color: colors.accent, fontSize: 11, marginTop: 2 },
      tool: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        backgroundColor: colors.surface0,
        paddingHorizontal: 10,
        paddingVertical: 7,
        gap: 8,
      },
      toolHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      toolLabel: { color: colors.foreground, fontSize: 12, fontWeight: "600" as const },
      toolSummary: { flex: 1, color: colors.foregroundMuted, fontSize: 11, fontFamily: MONOSPACE },
      detail: {
        color: colors.foreground,
        fontSize: 11,
        lineHeight: 16,
        fontFamily: MONOSPACE,
        backgroundColor: colors.surface2,
        borderRadius: 6,
        padding: 8,
      },
      planRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8 },
      planText: { flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 18 },
      planDone: { color: colors.foregroundMuted, textDecorationLine: "line-through" as const },
      planActive: { fontWeight: "600" as const },
      error: { color: colors.statusDanger, fontSize: 12 },
      sentState: { color: colors.foregroundMuted, fontSize: 11 },
    };
  }, [theme]);
}

/** Which rows are open — tool details, folded text shown whole, tool runs unfolded — by row key. */
function useOpenRows() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  return {
    has: (key: string) => open.has(key),
    toggle: (key: string) =>
      setOpen((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
  };
}

function FoldedText({
  rowKey,
  text,
  style,
  open,
  theme,
}: {
  rowKey: string;
  text: string;
  style: object;
  open: ReturnType<typeof useOpenRows>;
  theme: PluginTheme;
}) {
  const long = isLong(text);
  const shown = open.has(rowKey);
  return (
    <>
      <Text selectable style={style} numberOfLines={long && !shown ? FOLDED_LINES : undefined}>
        {text}
      </Text>
      {long ? (
        <Pressable accessibilityRole="button" onPress={() => open.toggle(rowKey)}>
          <Text style={{ color: theme.colors.accent, fontSize: 11, marginTop: 2 }}>
            {shown ? "Show less" : "Show all"}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

function toolStatusIcon(theme: PluginTheme, status: Extract<ActivityRow, { kind: "tool" }>["status"]) {
  const { colors } = theme;
  if (status === "running") return <Spinner size={12} color={colors.accent} />;
  if (status === "failed") return <Icon name="CircleX" size={12} color={colors.statusDanger} />;
  if (status === "canceled") return <Icon name="Ban" size={12} color={colors.foregroundMuted} />;
  return null;
}

function ToolRow({
  row,
  theme,
  open,
  onOpenLink,
}: {
  row: Extract<ActivityRow, { kind: "tool" }>;
  theme: PluginTheme;
  open: ReturnType<typeof useOpenRows>;
  onOpenLink: (url: string) => void;
}) {
  const styles = useRowStyles(theme);
  const expanded = open.has(row.key) && row.detail !== null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.label} ${row.summary}`}
      accessibilityState={{ expanded, disabled: row.detail === null }}
      disabled={row.detail === null}
      onPress={() => open.toggle(row.key)}
      style={styles.tool}
    >
      <View style={styles.toolHead}>
        <Icon name={row.icon} size={13} color={theme.colors.foregroundMuted} />
        <Text style={styles.toolLabel}>{row.label}</Text>
        <Text style={styles.toolSummary} numberOfLines={1}>
          {row.summary}
        </Text>
        {toolStatusIcon(theme, row.status)}
        {row.detail === null ? null : (
          <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={13} color={theme.colors.foregroundMuted} />
        )}
      </View>
      {!expanded || row.detail === null ? null : row.markdown ? (
        <Markdown source={row.detail} theme={theme} fontSize={12} onOpenLink={onOpenLink} />
      ) : (
        <Text selectable style={styles.detail}>
          {row.detail}
        </Text>
      )}
    </Pressable>
  );
}

function ConversationRows({ rows, theme, onOpenLink }: { rows: readonly ConversationRow[]; theme: PluginTheme; onOpenLink: (url: string) => void }) {
  const styles = useRowStyles(theme);
  const open = useOpenRows();

  function render(row: ConversationRow) {
    switch (row.kind) {
      case "said":
        return row.speaker === "worker" ? (
          <Markdown source={row.text} theme={theme} onOpenLink={onOpenLink} />
        ) : (
          <View style={row.speaker === "you" ? styles.captain : styles.prompt}>
            <FoldedText rowKey={row.key} text={row.text} style={styles.promptText} open={open} theme={theme} />
          </View>
        );
      case "tools": {
        const unfolded = open.has(row.key);
        return (
          <View style={{ gap: 6 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${toolRunText(row)}. ${unfolded ? "Fold them" : "Show them"}`}
              accessibilityState={{ expanded: unfolded }}
              aria-expanded={unfolded}
              onPress={() => open.toggle(row.key)}
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Icon name={unfolded ? "ChevronDown" : "ChevronRight"} size={12} color={theme.colors.foregroundMuted} />
              <Text style={{ color: row.failed > 0 ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 11 }}>
                {toolRunText(row)}
              </Text>
              {row.running ? <Spinner size={11} color={theme.colors.accent} /> : null}
            </Pressable>
            {unfolded ? row.tools.map((tool) => <ToolRow key={tool.key} row={tool} theme={theme} open={open} onOpenLink={onOpenLink} />) : null}
          </View>
        );
      }
      case "plan":
        return (
          <TranscriptLine theme={theme} icon="ListChecks">
            {planText(row)}
          </TranscriptLine>
        );
      case "error":
        return <Text style={styles.error}>{row.text}</Text>;
      default:
        return <TranscriptLine theme={theme}>{row.text}</TranscriptLine>;
    }
  }

  return (
    <>
      {rows.map((row, index) => {
        const previous = rows[index - 1];
        const label =
          row.kind === "said" && !(previous?.kind === "said" && previous.speaker === row.speaker) ? SPEAKER_LABELS[row.speaker] : null;
        return (
          <View key={row.key} style={{ gap: 4 }}>
            {label === null ? null : <Text style={styles.label}>{label}</Text>}
            {render(row)}
          </View>
        );
      })}
    </>
  );
}

const ACTIVITY_LABELS: Partial<Record<ActivityRow["kind"], string>> = {
  reasoning: "REASONING",
  reply: "WORKER",
  plan: "PLAN",
};

function activityLabel(row: ActivityRow): string | undefined {
  return row.kind === "prompt" ? (row.captain ? SPEAKER_LABELS.you : SPEAKER_LABELS.prompt) : ACTIVITY_LABELS[row.kind];
}

function ActivityRows({ rows, theme, onOpenLink }: { rows: readonly ActivityRow[]; theme: PluginTheme; onOpenLink: (url: string) => void }) {
  const styles = useRowStyles(theme);
  const open = useOpenRows();

  function planIcon(status: PlanStatus) {
    const { colors } = theme;
    if (status === "completed") return <Icon name="SquareCheck" size={14} color={colors.statusSuccess} />;
    if (status === "in_progress") return <Icon name="CircleDot" size={14} color={colors.accent} />;
    return <Icon name="Square" size={14} color={colors.foregroundMuted} />;
  }

  function render(row: ActivityRow) {
    switch (row.kind) {
      case "prompt":
        return (
          <View style={row.captain ? styles.captain : styles.prompt}>
            <FoldedText rowKey={row.key} text={row.text} style={styles.promptText} open={open} theme={theme} />
          </View>
        );
      case "reasoning":
        return (
          <View>
            <FoldedText rowKey={row.key} text={row.text.trim()} style={styles.reasoning} open={open} theme={theme} />
          </View>
        );
      case "reply":
        return <Markdown source={row.text} theme={theme} onOpenLink={onOpenLink} />;
      case "tool":
        return <ToolRow row={row} theme={theme} open={open} onOpenLink={onOpenLink} />;
      case "plan":
        return (
          <View style={{ gap: 4 }}>
            {row.items.map((item, index) => (
              <View key={index} style={styles.planRow}>
                {planIcon(item.status)}
                <Text
                  style={[
                    styles.planText,
                    item.status === "completed" ? styles.planDone : null,
                    item.status === "in_progress" ? styles.planActive : null,
                  ]}
                >
                  {item.text}
                </Text>
              </View>
            ))}
          </View>
        );
      case "error":
        return <Text style={styles.error}>{row.text}</Text>;
      default:
        return <TranscriptLine theme={theme}>{row.text}</TranscriptLine>;
    }
  }

  return (
    <>
      {rows.map((row, index) => {
        const label = activityLabel(row);
        const previous = rows[index - 1];
        return (
          <View key={row.key} style={{ gap: 4 }}>
            {label === undefined || (previous !== undefined && activityLabel(previous) === label) ? null : (
              <Text style={styles.label}>{label}</Text>
            )}
            {render(row)}
          </View>
        );
      })}
    </>
  );
}

function SentRows({
  sends,
  theme,
  onRetry,
  onDismiss,
}: {
  sends: readonly SentMessage[];
  theme: PluginTheme;
  onRetry: (send: SentMessage) => void;
  onDismiss: (id: string) => void;
}) {
  const styles = useRowStyles(theme);
  return (
    <>
      {sends.map((send) => (
        <View key={send.id} style={{ gap: 4 }}>
          <Text style={styles.label}>{SPEAKER_LABELS.you}</Text>
          <View style={[styles.captain, send.state === "failed" ? { borderLeftColor: theme.colors.statusDanger } : null]}>
            <Text selectable style={styles.promptText}>
              {send.text}
            </Text>
          </View>
          {send.state === "failed" ? (
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <Text style={[styles.error, { flexShrink: 1 }]}>Not sent: {send.error}</Text>
              <IconButton icon="RotateCcw" label="Retry" showLabel theme={theme} onPress={() => onRetry(send)} />
              <IconButton icon="X" label="Dismiss" theme={theme} onPress={() => onDismiss(send.id)} />
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {send.state === "sending" ? <Spinner size={10} color={theme.colors.accent} /> : <Icon name="Check" size={11} color={theme.colors.foregroundMuted} />}
              <Text style={styles.sentState}>{send.state === "sending" ? "sending…" : "sent"}</Text>
            </View>
          )}
        </View>
      ))}
    </>
  );
}
