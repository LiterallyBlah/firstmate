/**
 * One card on the board: a crewmate, a backlog item, or both.
 *
 * Pressing the card opens its actions. The first one is the caller's: the
 * board watches the crewmate without leaving FirstMate, a panel beside a
 * workspace opens it in Paseo. Steering, interrupting and ending go to the
 * crewmate directly; relaunching goes through the first mate, because it
 * owns the brief the new crewmate starts from. Ending archives the agent and
 * leaves its workspace and worktree exactly as they are.
 *
 * A worker on a remote host has the same card, with its host named. Steer,
 * Interrupt and End go to it through the plugin's remote request path
 * (`shared/remote-crew.ts`); Relaunch is shown but off, since a new worker
 * there needs a brief only the first mate can write. While its host is
 * unreachable, only Watch is on. A session the first mate only follows — the
 * captain's own, not crew — is marked so and is never offered End.
 *
 * The ship deck shows the same card beside a focused sailor (`presentation:
 * "focus"`): always open, with a close button where the chevron was, and only
 * what a glance needs — its state, where it works, its status line, the
 * captain's call, an error or a waiting permission, its link, and any replies the first mate has offered for
 * it (`replies`, from the deck) — over the same
 * actions, with the same handlers, guards and End confirmation. The tags, the
 * plumbing facts and the report's path stay on the board.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { exitCrew, interruptCrew, relaunchCrew, steerCrew, type ColumnId, type FleetCard } from "../shared/fleet";
import { exitRemoteCrew, interruptRemoteCrew, steerRemoteCrew } from "../shared/remote-crew";
import type { BoardDensity } from "../shared/settings";
import {
  REPORT_STATES,
  COLUMNS,
  agentStatusLabel,
  agentStatusTone,
  cardHeadline,
  columnTone,
  modelLabel,
  opensAsLeft,
  orphanText,
  relativeTime,
} from "./format";
import { watchKey } from "./host-tabs";
import { Chip, IconButton, Tag, errorText } from "./ui";
import { webTitle } from "./web";
import { cardTags } from "../shared/item-tags";
import { ItemTagEditor } from "./item-tags";

/** A time a remote host reported, moved onto this machine's clock by the host's measured skew. */
function hostTime(iso: string, skewSeconds: number | null): string {
  const at = Date.parse(iso);
  return skewSeconds === null || Number.isNaN(at) ? iso : new Date(at - skewSeconds * 1000).toISOString();
}

/** The card's first action, which opens the crewmate somewhere. */
export interface CardOpener {
  icon: string;
  label: string;
  tooltip: string;
  onPress: () => void;
}

/** The board's, the list's and the deck's first action: Watch the crewmate within FirstMate, by `watchKey`; null for a card with no worker to watch. */
export function watchOpener(card: FleetCard, onWatch: (key: string) => void): CardOpener | null {
  const key = watchKey(card);
  if (key === null) return null;
  return {
    icon: "Eye",
    label: "Watch",
    tooltip:
      card.remote === undefined
        ? "View this worker's live activity within FirstMate."
        : "View this remote worker's recent log within FirstMate.",
    onPress: () => onWatch(key),
  };
}

type Draft = { kind: "steer" | "relaunch"; text: string } | { kind: "end" } | null;

/**
 * Whether each card is open, what is half-typed in it, and the column it was
 * in, by card key.
 *
 * A card changes column exactly when the captain is most likely to act on it
 * — its crewmate just stopped — and a card in another column is a different
 * element to React, so it remounts. Kept here, a draft survives the move, and
 * the surface unmounting too. An open card with nothing in progress does not:
 * it goes back to rest in its new column (`opensAsLeft`), or every card the
 * captain had looked into would arrive in Done still showing its actions.
 */
const cardMemory = new Map<string, { expanded: boolean; draft: Draft; column: ColumnId }>();

function useCardMemory(key: string, startExpanded: boolean, column: ColumnId) {
  const remembered = cardMemory.get(key);
  const kept =
    remembered !== undefined &&
    opensAsLeft({ column: remembered.column, inProgress: remembered.draft !== null }, column)
      ? remembered
      : undefined;
  const [expanded, setExpandedState] = useState(kept?.expanded ?? startExpanded);
  const [draft, setDraftState] = useState<Draft>(kept?.draft ?? null);

  function remember(next: { expanded: boolean; draft: Draft }): void {
    if (!next.expanded && next.draft === null) cardMemory.delete(key);
    else cardMemory.set(key, { ...next, column });
  }
  function setExpanded(next: boolean): void {
    remember({ expanded: next, draft });
    setExpandedState(next);
  }
  function setDraft(next: Draft): void {
    remember({ expanded, draft: next });
    setDraftState(next);
  }
  return { expanded, setExpanded, draft, setDraft };
}

export function CrewCard({
  card,
  theme,
  compact,
  density = "comfortable",
  opener,
  onChanged,
  startExpanded = false,
  presentation = "card",
  onClose,
  replies = null,
}: {
  card: FleetCard;
  theme: PluginTheme;
  compact: boolean;
  /** The board's spacing setting; views beside a single card leave it comfortable. */
  density?: BoardDensity;
  /** Null where the crewmate is already in view, or there is nowhere to open it. */
  opener: CardOpener | null;
  /** Called after an action lands, so the board refreshes without waiting for its poll. */
  onChanged: () => void;
  startExpanded?: boolean;
  /** The list and the deck's focus panel share this card's memory, details and actions. */
  presentation?: "card" | "row" | "focus";
  /** The focus panel's close button. */
  onClose?: () => void;
  /** The focus panel's replies for the captain to pick (`client/reply-bubble.tsx`), under its glance. */
  replies?: ReactNode;
}) {
  const steer = useRpc(steerCrew);
  const interrupt = useRpc(interruptCrew);
  const exit = useRpc(exitCrew);
  const relaunch = useRpc(relaunchCrew);
  const steerRemote = useRpc(steerRemoteCrew);
  const interruptRemote = useRpc(interruptRemoteCrew);
  const exitRemote = useRpc(exitRemoteCrew);
  const toast = useToast();

  const memory = useCardMemory(card.key, startExpanded, card.column);
  const { setExpanded, draft, setDraft } = memory;
  const focus = presentation === "focus";
  /** The focus panel is always open, without telling the board's card to open too. */
  const expanded = memory.expanded || focus;
  const [busy, setBusy] = useState(false);

  const agent = card.agent;
  const remote = card.remote ?? null;
  const worker = remote?.worker ?? null;
  /** The remote worker the actions go to: on a saved host, by serverId. */
  const target =
    remote !== null && remote.serverId !== null && worker !== null
      ? { serverId: remote.serverId, agentId: worker.id }
      : null;
  const status =
    agent ??
    (worker === null
      ? null
      : {
          pendingPermissions: worker.pendingPermissions,
          status: worker.status,
        });
  const followed = worker?.followed === true;
  const running = status !== null && (status.status === "running" || status.status === "initializing");
  const actionPending = "Wait for the current action to finish.";
  const unreachable = `${remote?.host ?? "The remote host"} is unreachable; wait until it answers.`;
  const tone = columnTone(theme, card.column);
  const dense = density === "compact";
  const row = presentation === "row";
  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      card: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        backgroundColor: colors.surface0,
        padding: dense ? 10 : compact ? 12 : 14,
        gap: dense ? 6 : 8,
      },
      row: {
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        paddingVertical: dense ? 8 : 10,
        paddingHorizontal: 4,
        gap: 8,
      },
      rowHead: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        minWidth: 0,
      },
      rowText: { flex: 1, minWidth: 0, gap: 3 },
      rowTitle: {
        color: colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
        lineHeight: 19,
      },
      rowTags: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        maxWidth: compact ? ("100%" as const) : ("35%" as const),
        minWidth: 0,
      },
      titleRow: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 8,
      },
      title: {
        flex: 1,
        color: colors.foreground,
        fontSize: dense ? 13 : 14,
        lineHeight: dense ? 18 : 20,
        fontWeight: "600" as const,
      },
      chevron: { paddingTop: dense ? 2 : 3 },
      chips: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      time: {
        marginLeft: "auto" as const,
        color: colors.foregroundMuted,
        fontSize: 11,
      },
      headline: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      details: { gap: 6 },
      meta: { color: colors.foregroundMuted, fontSize: 11 },
      report: { color: colors.foreground, fontSize: 12, lineHeight: 17 },
      reportState: { color: tone, fontWeight: "600" as const },
      link: {
        color: colors.accent,
        fontSize: 12,
        textDecorationLine: "underline" as const,
      },
      actions: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 6,
        marginTop: 2,
      },
      input: {
        color: colors.foreground,
        fontSize: 13,
        minHeight: 60,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: colors.surface1,
        textAlignVertical: "top" as const,
      },
      prompt: { color: colors.foreground, fontSize: 12 },
    };
  }, [theme, compact, dense, tone]);

  function run(label: string, action: () => Promise<unknown>): void {
    setBusy(true);
    action()
      .then(() => {
        toast.show(label, { variant: "success" });
        setDraft(null);
        onChanged();
      })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setBusy(false));
  }

  function submitDraft(): void {
    if (draft === null) return;
    if (target !== null) {
      if (draft.kind === "end") {
        run(`The worker on ${remote?.host ?? "its host"} was ended; its workspace there is untouched.`, () =>
          exitRemote(target),
        );
        return;
      }
      const text = draft.text.trim();
      if (text !== "" && draft.kind === "steer") run("Sent to the worker.", () => steerRemote({ ...target, text }));
      return;
    }
    if (agent === null) return;
    if (draft.kind === "end") {
      run("The worker was ended; its local copy is untouched.", () => exit({ agentId: agent.id }));
      return;
    }
    const text = draft.text.trim();
    if (text === "") return;
    if (draft.kind === "steer") run("Sent to the worker.", () => steer({ agentId: agent.id, text }));
    else run("Asked the first mate to relaunch it.", () => relaunch({ agentId: agent.id, note: text }));
  }

  const backlog = card.backlog;
  const headline = cardHeadline(card);
  /** When it last moved: the agent's last update, on this machine's clock; for an item alone, its outcome. */
  const when =
    agent !== null
      ? relativeTime(agent.updatedAt)
      : worker !== null && worker.updatedAt !== ""
        ? relativeTime(hostTime(worker.updatedAt, remote?.clockSkewSeconds ?? null))
        : row
          ? relativeTime(/\d{4}-\d{2}-\d{2}/.exec(backlog?.outcome ?? backlog?.since ?? "")?.[0] ?? "")
          : (backlog?.outcome ?? null);
  /** What only the open card shows: the plumbing behind the work, for the captain who goes looking. */
  const facts = [
    card.kind,
    card.taskId,
    backlog?.blockedBy === null || backlog?.blockedBy === undefined ? null : `after ${backlog.blockedBy}`,
    backlog?.mode ?? null,
    backlog?.since === null || backlog?.since === undefined ? null : `since ${backlog.since}`,
    agent === null ? null : modelLabel(agent),
    agent?.id.slice(0, 8) ?? worker?.id.slice(0, 8) ?? null,
  ].filter((fact): fact is string => fact !== null && fact !== "");
  const hostText =
    remote === null
      ? null
      : `${remote.host}${remote.serverId === null ? " · not a saved host" : remote.online ? "" : " · unreachable"}`;
  /**
   * The state chip: why the board filed the card where its live status alone would not — "waiting",
   * "stalled", "no worker seen" — in the column's colour, or else the agent's own status.
   */
  const stateChip =
    card.note !== undefined
      ? { text: card.note, color: tone }
      : status === null
        ? null
        : {
            text: agentStatusLabel(status),
            color: agentStatusTone(theme, status),
          };

  /** Long lines are cut in the focus panel; the board's card has them whole. */
  const lines = focus ? 3 : undefined;
  const tags = (
    <>
      {card.project === null || card.project === "" ? null : <Tag theme={theme} text={card.project} />}
      {hostText === null ? (
        row ? (
          <Tag theme={theme} text="This machine" />
        ) : null
      ) : (
        <Tag
          theme={theme}
          icon="Server"
          text={hostText}
          color={remote?.online === true ? undefined : theme.colors.statusWarning}
        />
      )}
      {followed ? <Tag theme={theme} text="followed, not crew" /> : null}
    </>
  );
  const statusLine =
    headline === null ? null : (
      <Text
        style={[styles.headline, headline.tone === "danger" ? { color: theme.colors.statusDanger } : null]}
        numberOfLines={1}
      >
        {headline.lead === null ? null : <Text style={styles.reportState}>{headline.lead}: </Text>}
        {headline.text}
      </Text>
    );

  const glance = (
    <View style={styles.chips}>
      {stateChip === null ? null : <Chip theme={theme} text={stateChip.text} color={stateChip.color} />}
      {tags}
      {when === null || when === "" ? null : <Text style={styles.time}>{when}</Text>}
    </View>
  );

  return (
    <View style={row ? styles.row : styles.card}>
      {focus ? (
        <View style={{ gap: 8 }}>
          <View style={styles.titleRow}>
            <Text accessibilityRole="header" style={styles.title} numberOfLines={2} {...webTitle(card.title)}>
              {card.title}
            </Text>
            {onClose === undefined ? null : (
              <IconButton icon="X" label="Close" tooltip="Back to the whole deck (Esc)." tooltipAlign="end" theme={theme} onPress={onClose} />
            )}
          </View>
          {glance}
          {replies}
        </View>
      ) : (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[
          card.title,
          row ? COLUMNS[card.column].title : null,
          stateChip?.text ?? COLUMNS[card.column].title,
          card.project,
          cardTags(card).length === 0 ? null : `Tags: ${cardTags(card).join(", ")}`,
          hostText === null ? (row ? "on this machine" : null) : `on ${hostText}`,
          headline === null ? null : headline.lead === null ? headline.text : `${headline.lead}: ${headline.text}`,
          `${expanded ? "Hide" : "Show"} details and actions`,
        ]
          .filter((part): part is string => part !== null && part !== "")
          .join(". ")}
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={() => setExpanded(!expanded)}
        {...webTitle(card.title)}
        style={{ gap: 8 }}
      >
        {row ? (
          <>
            <View style={styles.rowHead}>
              <Icon name={COLUMNS[card.column].icon} size={15} color={tone} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={expanded ? undefined : 1}>
                  {card.title}
                </Text>
                {statusLine}
              </View>
              {compact ? null : <View style={styles.rowTags}>{tags}</View>}
              {when === null || when === "" ? null : (
                <Text style={[styles.time, { marginLeft: 0, flexShrink: 0 }]} numberOfLines={1}>
                  {when}
                </Text>
              )}
              <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={14} color={theme.colors.foregroundMuted} />
            </View>
            {compact ? <View style={styles.rowTags}>{tags}</View> : null}
          </>
        ) : (
          <>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={expanded ? undefined : 2}>
                {card.title}
              </Text>
              <View style={styles.chevron}>
                <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={14} color={theme.colors.foregroundMuted} />
              </View>
            </View>

            {glance}

            {expanded ? null : statusLine}
          </>
        )}
      </Pressable>
      )}

      {focus || cardTags(card).length === 0 ? null : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {cardTags(card).map((tag) => <Tag key={tag} theme={theme} icon="Tag" text={tag} />)}
        </View>
      )}
      {expanded ? (
        <View style={styles.details}>
          {focus ? null : <ItemTagEditor card={card} theme={theme} onChanged={onChanged} />}
          {focus || facts.length === 0 ? null : <Text style={styles.meta}>{facts.join(" · ")}</Text>}
          {card.report === null ? null : (
            <Text style={styles.report} numberOfLines={lines}>
              <Text style={styles.reportState}>{REPORT_STATES[card.report.state] ?? card.report.state}: </Text>
              {card.report.text}
            </Text>
          )}
          {backlog?.hold === null || backlog?.hold === undefined ? null : (
            <Text style={styles.report} numberOfLines={lines}>
              <Text style={styles.reportState}>Captain's call: </Text>
              {backlog.hold}
            </Text>
          )}
          {agent?.lastError === null || agent?.lastError === undefined ? null : (
            <Text style={[styles.report, { color: theme.colors.statusDanger }]} numberOfLines={lines}>
              {agent.lastError}
            </Text>
          )}
          {worker === null
            ? null
            : worker.permissionDetails.map((permission) => (
                <Text key={permission.id} style={styles.report}>
                  <Text style={styles.reportState}>Waiting on {permission.tool}: </Text>
                  {permission.description ?? `answer it on ${remote?.host ?? "its host"}`}
                </Text>
              ))}
          {worker === null || worker.recentTools.length === 0 ? null : (
            <Text style={styles.meta}>Latest tool calls: {worker.recentTools.join(" · ")}</Text>
          )}
          {agent === null && worker === null && backlog?.section === "in-flight" ? (
            <Text style={styles.meta}>{orphanText(remote)}</Text>
          ) : null}
          {card.url === null ? null : (
            <Text
              accessibilityRole="link"
              style={styles.link}
              numberOfLines={1}
              onPress={() => {
                void openExternalUrl(card.url ?? "").catch((caught: unknown) => toast.error(errorText(caught)));
              }}
            >
              {card.url.replace(/^https?:\/\/(www\.)?github\.com\//, "")}
            </Text>
          )}
          {focus || backlog?.reportPath === null || backlog?.reportPath === undefined ? null : (
            <Text style={styles.meta}>Report: {backlog.reportPath}</Text>
          )}
        </View>
      ) : null}

      {expanded && target !== null && remote !== null ? (
        <View style={{ gap: 4 }}>
          <View style={styles.actions}>
            {opener === null ? null : (
              <IconButton
                icon={opener.icon}
                label={opener.label}
                tooltip={opener.tooltip}
                showLabel
                theme={theme}
                onPress={opener.onPress}
              />
            )}
            <IconButton
              icon="MessageSquare"
              label="Steer"
              tooltip={
                busy
                  ? actionPending
                  : !remote.online
                    ? unreachable
                    : "Send instructions directly to this worker; the first mate is told about them."
              }
              showLabel
              theme={theme}
              disabled={busy || !remote.online}
              onPress={() => setDraft({ kind: "steer", text: "" })}
            />
            <IconButton
              icon="Square"
              label="Interrupt"
              tooltip={
                busy
                  ? actionPending
                  : !remote.online
                    ? unreachable
                    : !running
                      ? "This worker has no running turn to interrupt."
                      : "Stop this worker's current turn."
              }
              showLabel
              theme={theme}
              disabled={busy || !remote.online || !running}
              onPress={() => run("Interrupted.", () => interruptRemote(target))}
            />
            {focus ? null : (
              <IconButton
                icon="RotateCcw"
                label="Relaunch"
                tooltip="Remote Relaunch is unavailable here. Ask the first mate to write the new brief and launch a worker on that host."
                showLabel
                theme={theme}
                disabled
                onPress={() => undefined}
              />
            )}
            <IconButton
              icon="Power"
              label="End"
              tooltip={
                followed
                  ? "This is a followed session, not crew. End it on its own host."
                  : busy
                    ? actionPending
                    : !remote.online
                      ? unreachable
                      : "Confirm archiving this worker on its host. Its workspace is kept."
              }
              showLabel
              tone="danger"
              theme={theme}
              disabled={busy || !remote.online || followed}
              onPress={() => setDraft({ kind: "end" })}
            />
          </View>
          {followed ? (
            <Text style={styles.meta}>
              End is off: this is one of the captain's own sessions the first mate follows, not crew.
            </Text>
          ) : null}
          {remote.online ? null : (
            <Text style={styles.meta}>
              {remote.host} is unreachable; Steer, Interrupt and End wait until it answers.
            </Text>
          )}
          {focus ? null : (
            <Text style={styles.meta}>Relaunch is the first mate's on a remote host: it writes the new brief there.</Text>
          )}
        </View>
      ) : null}

      {expanded && agent !== null ? (
        <View style={styles.actions}>
          {opener === null ? null : (
            <IconButton
              icon={opener.icon}
              label={opener.label}
              tooltip={opener.tooltip}
              showLabel
              theme={theme}
              onPress={opener.onPress}
            />
          )}
          <IconButton
            icon="MessageSquare"
            label="Steer"
            tooltip={
              busy
                ? actionPending
                : "Send instructions directly to this worker; the first mate is told about them."
            }
            showLabel
            theme={theme}
            disabled={busy}
            onPress={() => setDraft({ kind: "steer", text: "" })}
          />
          <IconButton
            icon="Square"
            label="Interrupt"
            tooltip={
              busy
                ? actionPending
                : !running
                  ? "This worker has no running turn to interrupt."
                  : "Stop this worker's current turn."
            }
            showLabel
            theme={theme}
            disabled={busy || (agent.status !== "running" && agent.status !== "initializing")}
            onPress={() => run("Interrupted.", () => interrupt({ agentId: agent.id }))}
          />
          <IconButton
            icon="RotateCcw"
            label="Relaunch"
            tooltip={
              busy
                ? actionPending
                : "Give the first mate a note and ask for a replacement worker in the same local copy."
            }
            showLabel
            theme={theme}
            disabled={busy}
            onPress={() => setDraft({ kind: "relaunch", text: "" })}
          />
          <IconButton
            icon="Power"
            label="End"
            tooltip={
              busy
                ? actionPending
                : "Confirm archiving this worker. Its workspace and local copy are kept."
            }
            showLabel
            tone="danger"
            theme={theme}
            disabled={busy}
            onPress={() => setDraft({ kind: "end" })}
          />
        </View>
      ) : null}

      {expanded && draft !== null ? (
        <View style={{ gap: 6 }}>
          {draft.kind === "end" ? (
            <Text style={styles.prompt}>
              {remote === null
                ? "End this worker? The agent is archived; its workspace and local copy stay exactly as they are."
                : `End this worker on ${remote.host}? The agent there is archived; its workspace stays exactly as it is.`}
            </Text>
          ) : (
            <TextInput
              value={draft.text}
              onChangeText={(text) => setDraft({ kind: draft.kind, text })}
              placeholder={
                draft.kind === "steer"
                  ? remote === null
                    ? "Tell the worker… (the first mate hears about it)"
                    : `Tell the worker on ${remote.host}… (the first mate hears about it)`
                  : "What the new worker should know — progress so far, what to avoid"
              }
              placeholderTextColor={theme.colors.foregroundMuted}
              multiline
              autoFocus={!compact}
              style={styles.input}
            />
          )}
          <View style={styles.actions}>
            <IconButton
              icon={draft.kind === "end" ? "Power" : "Send"}
              label={draft.kind === "end" ? "End it" : draft.kind === "steer" ? "Send" : "Relaunch"}
              showLabel
              tone={draft.kind === "end" ? "danger" : "accent"}
              theme={theme}
              disabled={busy || (draft.kind !== "end" && draft.text.trim() === "")}
              onPress={submitDraft}
            />
            <IconButton icon="X" label="Cancel" showLabel theme={theme} onPress={() => setDraft(null)} />
          </View>
        </View>
      ) : null}

      {expanded && agent === null && target === null ? (
        <View style={styles.actions}>
          <Icon name="Info" size={12} color={theme.colors.foregroundMuted} />
          <Text style={styles.meta}>Ask the first mate to act on backlog items.</Text>
        </View>
      ) : null}
    </View>
  );
}
