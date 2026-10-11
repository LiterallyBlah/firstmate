/**
 * The FirstMate surface: the conversation with the first mate beside the
 * board of its crew.
 *
 * Everything on it comes from one RPC, `firstmate.fleet.load`, polled at the
 * interval in the display settings and refetched right after any action. The
 * chat reads the first mate's timeline directly and streams.
 *
 * Suggestions occupy one line above the crew; watches open from the header.
 * The default List groups tasks by urgency in one scroll container. The Board
 * option keeps full-height columns in one horizontal row on wide screens.
 *
 * With remote hosts saved, a row of host tabs sits above the columns — All,
 * this machine, then each host — and filters them to that host's cards; a
 * host's tab shows that host's health first. The choice is a display setting.
 *
 * A surface is unmounted whenever the captain opens a workspace, so the last
 * fleet, the compact tab and the crewmate being watched live in module scope
 * and the board comes back drawn rather than empty.
 */
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import {
  acknowledgeCharter,
  compareCharter,
  enableAgentTools,
  loadFleet,
  markMateSeen,
  removeSuggestion,
  type ColumnId,
  type Fleet,
  type Suggestion,
} from "../shared/fleet";
import { displaySettings, type DisplaySettings } from "../shared/settings";
import { Board } from "./board";
import { FilesView, type FilesRequest } from "./files";
import { MateChat } from "./chat";
import { captainMessage } from "./attachments";
import { CrewmateView } from "./crewmate";
import { agentStatusLabel, agentStatusTone, groupCards, orderedColumns, revealFilesPatch, shortPath } from "./format";
import { LaunchPanel } from "./launch";
import { MigrationControl } from "./migration-control";
import { useMateSender } from "./mate-send";
import { ResizeHandle } from "./resize-handle";
import { clampShare, MIN_SPLIT_WIDTH } from "./resize-layout";
import { hostTabs, onTab, shownHostTab, watchKey } from "./host-tabs";
import { HostTabRow } from "./host-tab-row";
import { RemoteWorkerView } from "./remote-worker";
import { HostHealthCard, useRemotes } from "./remotes";
import { SuggestionStrip } from "./suggestions";
import { TaskList } from "./task-list";
import { WatchButton } from "./watches";
import { Banner, Chip, IconButton, Segmented, errorText } from "./ui";

export const FLEET_QUERY_KEY = ["firstmate", "fleet"] as const;

let cachedFleet: Fleet | null = null;
type Tab = "chat" | "board" | "files";
let cachedTab: Tab = "chat";
/** What the right-hand pane shows on a wide layout: the crew, or the home's files. */
let cachedRightPane: "board" | "files" = "board";
/** The crewmate shown in the board's place — card and transcript — by `watchKey`: its agent id, or `remote:<serverId>:<id>`. */
let cachedWatching: string | null = null;

/**
 * A surface is given no way to open a settings screen, so the entry lends it
 * one; the gear is hidden while nothing is bound. Cleared in the entry's
 * cleanup, since this module outlives a disconnected client's context.
 */
let openSettings: ((id: string) => void) | null = null;
export function bindSettingsOpener(opener: ((id: string) => void) | null): void {
  openSettings = opener;
}

const DEFAULT_DISPLAY: DisplaySettings = displaySettings.schema.parse({});
const SAVE_DELAY_MS = 400;

/**
 * The fleet query, shared by the screen, the workspace panels and the sidebar item so they poll once
 * between them.
 */
export function useFleet(pollSeconds: number) {
  const load = useRpc(loadFleet);
  return useQuery({
    queryKey: FLEET_QUERY_KEY,
    queryFn: function () {
      return load({}).then((fleet) => {
        cachedFleet = fleet;
        return fleet;
      });
    },
    refetchInterval: pollSeconds * 1000,
    ...(cachedFleet === null ? {} : { placeholderData: cachedFleet }),
  });
}

export function FleetSurface({ theme, layout, navigation }: PluginScreenProps) {
  const [width, setWidth] = useState(0);
  const compact = layout.compact || (width > 0 && width < MIN_SPLIT_WIDTH);
  const enable = useRpc(enableAgentTools);
  const compareCharters = useRpc(compareCharter);
  const acknowledgeCharters = useRpc(acknowledgeCharter);
  const removeSuggestions = useRpc(removeSuggestion);
  const toast = useToast();
  const queryClient = useQueryClient();
  const display = useSettings(displaySettings);
  const saved = display.status === "ready" ? display.values : DEFAULT_DISPLAY;

  /** Drawn at once and saved behind, so a fold or a drag never waits on a round trip. */
  const [override, setOverride] = useState<Partial<DisplaySettings>>({});
  const values: DisplaySettings = { ...saved, ...override };
  const [share, setShare] = useState<number | null>(null);
  const [tab, setTabState] = useState<Tab>(cachedTab);
  const [rightPane, setRightPaneState] = useState(cachedRightPane);
  const [watching, setWatchingState] = useState(cachedWatching);
  const [enabling, setEnabling] = useState(false);
  const [charterBusy, setCharterBusy] = useState(false);
  /** A file the Files view should open; not kept across a remount, or it would open again on return. */
  const [filesRequest, setFilesRequest] = useState<FilesRequest | null>(null);

  const fleet = useFleet(values.pollSeconds);
  const data = fleet.data ?? null;
  const remoteHosts = useRemotes().data?.hosts ?? [];
  const hostTab = shownHostTab(values.hostTab, remoteHosts);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: FLEET_QUERY_KEY });
  }, [queryClient]);

  const shownTab = tab;

  /**
   * Layout changes are drawn at once and saved behind, batched: a save is
   * checked against the document revision it was made from, so a second fold
   * sent before the first came back would be refused as stale. Changes inside
   * `SAVE_DELAY_MS` become one save, made from whatever revision is current
   * when it goes out, and a refused one is tried once more from the next.
   */
  const displayRef = useRef(display);
  displayRef.current = display;
  const pending = useRef<Partial<DisplaySettings>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    // Opening another screen can unmount this one before the batching delay.
    // A completed drag must still reach the existing host settings document.
    if (Object.keys(pending.current).length > 0) flush(0);
  }, []);

  function flush(attempt: number): void {
    const current = displayRef.current;
    if (current.status !== "ready") return;
    const patch = pending.current;
    pending.current = {};
    void current.save({ ...current.values, ...patch }, current.revision).then((ok) => {
      if (ok) return;
      if (attempt === 0) {
        pending.current = { ...patch, ...pending.current };
        saveTimer.current = setTimeout(() => flush(1), SAVE_DELAY_MS);
      } else {
        console.warn("[firstmate] could not save the board layout:", displayRef.current.saveError);
      }
    });
  }

  function save(patch: Partial<DisplaySettings>): void {
    setOverride((current) => ({ ...current, ...patch }));
    pending.current = { ...pending.current, ...patch };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flush(0), SAVE_DELAY_MS);
  }

  // Once the stored document says what was drawn, the local copy has done its
  // job; dropping it lets a change made on another device show here.
  useEffect(() => {
    if (display.status !== "ready") return;
    setOverride((current) => {
      const entries = Object.entries(current).filter(
        ([key, value]) => JSON.stringify(display.values[key as keyof DisplaySettings]) !== JSON.stringify(value),
      );
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
    });
  }, [display]);

  function setTab(next: Tab): void {
    // As with the wide layout's Crew switch: pressing Crew again goes back to the board.
    if (next === "board" && tab === "board") setWatching(null);
    cachedTab = next;
    setTabState(next);
  }

  function setRightPane(next: "board" | "files"): void {
    // Choosing Crew while it is already showing is the way back from a watched crewmate to the board.
    if (next === "board" && rightPane === "board") setWatching(null);
    cachedRightPane = next;
    setRightPaneState(next);
  }

  function setWatching(next: string | null): void {
    cachedWatching = next;
    setWatchingState(next);
  }

  const order = orderedColumns(values.columnOrder);
  const counts = useMemo(() => {
    const groups = groupCards(data?.cards ?? []);
    return {
      working: groups.get("working")?.length ?? 0,
      blocked: groups.get("blocked")?.length ?? 0,
      queued: groups.get("queued")?.length ?? 0,
      done: groups.get("done")?.length ?? 0,
    };
  }, [data]);

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      screen: { flex: 1, backgroundColor: colors.surface0 },
      header: {
        zIndex: 1,
        paddingHorizontal: compact ? 12 : 16,
        paddingTop: compact ? 10 : 14,
        paddingBottom: 8,
        gap: 4,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      headerRow: {
        zIndex: 1,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        flexWrap: "wrap" as const,
      },
      title: {
        color: colors.foreground,
        fontSize: compact ? 17 : 20,
        fontWeight: "600" as const,
      },
      spacer: { flex: 1 },
      meta: { color: colors.foregroundMuted, fontSize: 12 },
      banners: { paddingHorizontal: compact ? 12 : 16, paddingTop: 8, gap: 6 },
      split: { flex: 1, minHeight: 0, flexDirection: "row" as const },
      rail: {
        width: 40,
        alignItems: "center" as const,
        paddingTop: 10,
        backgroundColor: colors.surface1,
        borderColor: colors.border,
      },
      tabs: {
        flexDirection: "row" as const,
        margin: 10,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        overflow: "hidden" as const,
      },
      tab: { flex: 1, paddingVertical: 7, alignItems: "center" as const },
      tabActive: { backgroundColor: colors.accent },
      tabText: { color: colors.foreground, fontSize: 13 },
      tabTextActive: {
        color: colors.accentForeground,
        fontWeight: "600" as const,
      },
      loading: { color: colors.foregroundMuted, fontSize: 13, padding: 20 },
    };
  }, [theme, compact]);

  const mate = data?.mate ?? null;
  /** The chat's own sender, so a suggestion goes out exactly as a typed message does. */
  const mateSender = useMateSender(mate?.id ?? "");

  /**
   * While this surface is open the captain is looking at the first mate, so
   * its "finished" flag is cleared the way opening it in Paseo would clear it,
   * and its workspace reads as done in the sidebar. Keyed by `updatedAt`, so a
   * turn that ends while the panel is open is cleared too, and a clear that
   * failed is not retried until something changes. A pending permission is
   * left flagged; the server checks that again.
   */
  const markSeen = useRpc(markMateSeen);
  const unseen =
    mate !== null && mate.requiresAttention && mate.pendingPermissions === 0 ? `${mate.id}:${mate.updatedAt}` : null;
  useEffect(() => {
    if (unseen === null) return;
    markSeen({})
      .then((result) => {
        if (result.cleared) refresh();
      })
      .catch((caught: unknown) => {
        console.warn("[firstmate] could not mark the first mate as seen:", caught);
      });
  }, [unseen, markSeen, refresh]);

  const openMate = mate === null || navigation === undefined ? null : () => navigation.openAgent({ agentId: mate.id });

  /**
   * A suggestion is sent to the first mate at once, through the chat's own
   * path, and the chat comes into view to show it going out. The draft the
   * captain was typing is left as it was. While a message is on its way the
   * buttons are disabled, and a press that still gets through is refused by
   * the sender, so a double press sends once.
   */
  function suggest(prompt: string): void {
    if (mate === null || !mateSender.send(captainMessage(prompt, []))) return;
    if (compact) setTab("chat");
    else if (values.chatCollapsed) save({ chatCollapsed: false });
  }

  /**
   * A suggestion's trash: its line leaves the first mate's file, and the board takes the list the
   * daemon answers with at once rather than waiting for the next load.
   */
  function dismissSuggestion(suggestion: Suggestion): Promise<void> {
    return removeSuggestions(suggestion)
      .then((result) => {
        queryClient.setQueryData<Fleet>(FLEET_QUERY_KEY, (current) =>
          current === undefined ? current : { ...current, suggestions: result.suggestions },
        );
        refresh();
      })
      .catch((caught: unknown) => {
        toast.error(errorText(caught));
        refresh();
      });
  }

  function turnOnTools(): void {
    setEnabling(true);
    enable({})
      .then((result) => {
        toast.show(
          result.agentTools
            ? mate === null
              ? "Agent tools are on."
              : "Agent tools are on. The first mate gets them the next time its session starts — reload it from its tab."
            : "The daemon did not keep the change.",
          { variant: result.agentTools ? "success" : "warning" },
        );
        refresh();
      })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setEnabling(false));
  }

  /** Shows the Files view — the tab on a phone, the right-hand pane on a wide layout, unhidden — with `path` open. */
  function openFile(path: string): void {
    if (compact) setTab("files");
    else setRightPane("files");
    const reveal = revealFilesPatch(compact, values.boardCollapsed);
    if (reveal !== null) save(reveal);
    setFilesRequest({ path, at: Date.now() });
  }

  /** Puts the plugin's current charter beside the captain's and opens it in the Files view. */
  function compareCharterFiles(): void {
    setCharterBusy(true);
    compareCharters({})
      .then(({ path }) => {
        if (path === null) {
          refresh();
          return;
        }
        openFile(path);
      })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setCharterBusy(false));
  }

  function acknowledgeCharterChange(): void {
    setCharterBusy(true);
    acknowledgeCharters({})
      .then(() => {
        toast.show("Your charter is now taken as up to date.", {
          variant: "success",
        });
        refresh();
      })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setCharterBusy(false));
  }

  const banners: ReactNode[] = [];
  if (fleet.error !== null) {
    banners.push(<Banner key="error" theme={theme} tone="danger" text={errorText(fleet.error)} />);
  }
  if (data?.agentTools === false) {
    banners.push(
      <Banner
        key="tools"
        theme={theme}
        tone="warning"
        text="The first mate starts its crew and hears back from it through Paseo's agent tools, and this daemon does not give agents those tools."
        action={{
          label: enabling ? "Turning on…" : "Turn them on",
          icon: "Wrench",
          onPress: turnOnTools,
          disabled: enabling,
        }}
      />,
    );
  }
  if (data?.mateMissing === true) {
    banners.push(
      <Banner
        key="missing"
        theme={theme}
        tone="info"
        text="The first mate you had is gone — archived or deleted. Launch a new one; its records are still in its home."
      />,
    );
  }
  if (mate !== null && data !== null && !data.mateInHome) {
    banners.push(
      <Banner
        key="cwd"
        theme={theme}
        tone="warning"
        text={`The first mate works in ${shortPath(mate.cwd, 60)}, not in its home, so it has not read its charter there.`}
      />,
    );
  }
  // The question itself is in the chat; the banner is for when the chat is
  // out of sight — folded away, or behind the Crew tab on a phone.
  const chatHidden = compact ? shownTab !== "chat" : values.chatCollapsed;
  if (mate !== null && mate.pendingPermissions > 0 && chatHidden) {
    banners.push(
      <Banner
        key="permission"
        theme={theme}
        tone="warning"
        text="The first mate is waiting for your answer."
        action={{
          label: "Show",
          icon: "MessageSquare",
          onPress: () => (compact ? setTab("chat") : save({ chatCollapsed: false })),
        }}
      />,
    );
  }
  if (data?.charterOutdated === true) {
    banners.push(
      <Banner
        key="charter"
        theme={theme}
        tone="info"
        text="FirstMate's own charter has changed since you edited yours in data/charter.md. Compare them, bring over what you want, then press Done."
        actions={[
          {
            label: "Compare",
            icon: "FileDiff",
            onPress: compareCharterFiles,
            disabled: charterBusy,
          },
          {
            label: "Done",
            icon: "Check",
            onPress: acknowledgeCharterChange,
            disabled: charterBusy,
          },
        ]}
      />,
    );
  }
  for (const warning of data?.warnings ?? []) {
    banners.push(<Banner key={warning} theme={theme} tone="warning" text={warning} />);
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <Icon name="Ship" size={compact ? 16 : 18} color={theme.colors.foreground} />
        <Text style={styles.title}>FirstMate</Text>
        {mate === null ? null : (
          <Chip theme={theme} text={`First mate · ${agentStatusLabel(mate)}`} color={agentStatusTone(theme, mate)} />
        )}
        <View style={styles.spacer} />
        <MigrationControl
          theme={theme}
          compact={compact}
          mate={mate}
          onChanged={refresh}
          onOpenFile={openFile}
          onOpenAgent={navigation === undefined ? null : (agentId) => navigation.openAgent({ agentId })}
        />
        {mate !== null &&
        (compact ? shownTab === "board" : rightPane === "board" && !values.boardCollapsed) &&
        watching === null ? (
          <Segmented
            theme={theme}
            value={values.crewView}
            options={[
              {
                value: "list",
                label: "List",
                tooltip: "Show tasks in a grouped list.",
              },
              {
                value: "board",
                label: "Board",
                tooltip: "Show tasks in columns by status.",
              },
            ]}
            onChange={(crewView) => save({ crewView })}
          />
        ) : null}
        {data === null ? null : (
          <WatchButton watches={data.watches} theme={theme} onChanged={refresh} onOpenFile={openFile} />
        )}
        {!compact && mate !== null && data !== null && !values.boardCollapsed ? (
          <Segmented
            theme={theme}
            value={rightPane}
            options={[
              {
                value: "board",
                label: `Crew (${data.cards.length})`,
                tooltip:
                  watching === null
                    ? "Show crew and backlog tasks."
                    : "Return to crew tasks from the worker's activity.",
              },
              {
                value: "files",
                label: "Files",
                tooltip: "Browse and edit files in the FirstMate home.",
              },
            ]}
            onChange={setRightPane}
          />
        ) : null}
        {!compact && mate !== null ? (
          <>
            <IconButton
              icon={values.chatCollapsed ? "PanelLeftOpen" : "PanelLeftClose"}
              label={values.chatCollapsed ? "Show the chat" : "Hide the chat"}
              tooltip={
                values.chatCollapsed
                  ? "Show the first-mate chat beside the other pane."
                  : "Hide the first-mate chat to give the other pane more room."
              }
              tooltipSide="bottom"
              tooltipAlign="end"
              theme={theme}
              onPress={() =>
                save({
                  chatCollapsed: !values.chatCollapsed,
                  boardCollapsed: false,
                })
              }
            />
            <IconButton
              icon={values.boardCollapsed ? "PanelRightOpen" : "PanelRightClose"}
              label={values.boardCollapsed ? "Show the board" : "Hide the board"}
              tooltip={
                values.boardCollapsed
                  ? `Show ${rightPane === "files" ? "Files" : "Crew"} beside the first-mate chat.`
                  : `Hide the ${rightPane === "files" ? "Files" : "Crew"} pane to give the chat more room.`
              }
              tooltipSide="bottom"
              tooltipAlign="end"
              theme={theme}
              onPress={() =>
                save({
                  boardCollapsed: !values.boardCollapsed,
                  chatCollapsed: false,
                })
              }
            />
          </>
        ) : null}
        {openMate === null ? null : (
          <IconButton
            icon="ExternalLink"
            label="Open the first mate in Paseo"
            tooltip="Open the first mate's full conversation in Paseo."
            tooltipSide="bottom"
            tooltipAlign="end"
            theme={theme}
            onPress={openMate}
          />
        )}
        <IconButton
          icon="RefreshCw"
          label={fleet.isFetching ? "Refreshing" : "Refresh"}
          tooltip={
            fleet.isFetching
              ? "FirstMate status is refreshing."
              : "Refresh the task board and first mate's status."
          }
          tooltipSide="bottom"
          tooltipAlign="end"
          theme={theme}
          disabled={fleet.isFetching}
          onPress={refresh}
        />
        {openSettings === null ? null : (
          <IconButton
            icon="Settings"
            label="FirstMate settings"
            tooltip="Open FirstMate settings for the home, models and display."
            tooltipSide="bottom"
            tooltipAlign="end"
            theme={theme}
            onPress={() => openSettings?.("firstmate")}
          />
        )}
      </View>
      {data === null ? null : (
        <Text style={styles.meta} numberOfLines={1}>
          {[
            `${counts.working} working`,
            `${counts.blocked} blocked`,
            `${counts.queued} queued`,
            `${counts.done} done`,
            shortPath(data.home, compact ? 28 : 56),
          ].join(" · ")}
        </Text>
      )}
    </View>
  );

  if (data === null) {
    return (
      <View style={styles.screen} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {header}
        {banners.length === 0 ? null : <View style={styles.banners}>{banners}</View>}
        <Text style={styles.loading}>{fleet.error === null ? "Mustering the crew…" : ""}</Text>
      </View>
    );
  }

  if (mate === null) {
    return (
      <View style={styles.screen}>
        {header}
        <ScrollView automaticallyAdjustKeyboardInsets>
          {banners.length === 0 ? null : <View style={styles.banners}>{banners}</View>}
          <LaunchPanel theme={theme} compact={compact} home={data.home} onLaunched={refresh} />
        </ScrollView>
      </View>
    );
  }

  const tabs = hostTabs(data.cards, remoteHosts);
  const tabHost = remoteHosts.find((host) => host.serverId === hostTab) ?? null;
  const board = (
    <View style={{ flex: 1, minHeight: 0 }}>
      {tabs.length === 0 ? null : (
        <HostTabRow
          tabs={tabs}
          selected={hostTab}
          theme={theme}
          compact={compact}
          onSelect={(id) => save({ hostTab: id })}
        />
      )}
      {tabHost === null ? null : <HostHealthCard key={tabHost.serverId} host={tabHost} theme={theme} />}
      <SuggestionStrip
        suggestions={data.suggestions}
        theme={theme}
        disabled={mateSender.sending}
        onPick={suggest}
        onRemove={dismissSuggestion}
      />
      {values.crewView === "list" ? (
        <TaskList
          cards={data.cards.filter((card) => onTab(card, hostTab))}
          theme={theme}
          compact={compact}
          density={values.density}
          onWatch={setWatching}
          onChanged={refresh}
        />
      ) : (
        <Board
          cards={data.cards.filter((card) => onTab(card, hostTab))}
          order={order}
          collapsed={values.collapsedColumns}
          theme={theme}
          compact={compact}
          density={values.density}
          onWatch={setWatching}
          onChanged={refresh}
          onToggleColumn={(id: ColumnId) =>
            save({
              collapsedColumns: values.collapsedColumns.includes(id)
                ? values.collapsedColumns.filter((column) => column !== id)
                : [...values.collapsedColumns, id],
            })
          }
          onReorder={(next: ColumnId[]) => save({ columnOrder: next })}
        />
      )}
    </View>
  );
  const chat = (
    <MateChat key={mate.id} mate={mate} theme={theme} compact={compact} onChanged={refresh} onOpenFile={openFile} />
  );
  const watchedCard = watching === null ? null : (data.cards.find((card) => watchKey(card) === watching) ?? null);
  const watchedRemote = watching === null ? null : /^remote:(.+):([^:]+)$/.exec(watching);
  const crew =
    watching === null ? (
      board
    ) : watchedRemote !== null ? (
      <RemoteWorkerView
        key={watching}
        serverId={watchedRemote[1] ?? ""}
        agentId={watchedRemote[2] ?? ""}
        card={watchedCard}
        theme={theme}
        compact={compact}
        onBack={() => setWatching(null)}
        onChanged={refresh}
      />
    ) : (
      <CrewmateView
        key={watching}
        agentId={watching}
        card={watchedCard}
        theme={theme}
        compact={compact}
        onBack={() => setWatching(null)}
        onOpen={navigation === undefined ? null : () => navigation.openAgent({ agentId: watching })}
        onChanged={refresh}
      />
    );

  if (compact) {
    const tabs: readonly Tab[] = ["chat", "board", "files"];
    return (
      <View style={styles.screen} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {header}
        {banners.length === 0 ? null : <View style={styles.banners}>{banners}</View>}
        <View style={styles.tabs}>
          {tabs.map((id) => (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected: shownTab === id }}
              aria-selected={shownTab === id}
              style={[styles.tab, shownTab === id ? styles.tabActive : null]}
              onPress={() => setTab(id)}
            >
              <Text style={[styles.tabText, shownTab === id ? styles.tabTextActive : null]} numberOfLines={1}>
                {id === "chat" ? "First mate" : id === "board" ? `Crew (${data.cards.length})` : "Files"}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flex: 1, minHeight: 0 }}>
          {shownTab === "chat" ? (
            chat
          ) : shownTab === "board" ? (
            crew
          ) : (
            <FilesView theme={theme} compact request={filesRequest} />
          )}
        </View>
      </View>
    );
  }

  // Window narrowing constrains the drawn split without overwriting the saved preference.
  const chatShare = clampShare(share ?? values.chatWidthFraction, width);
  return (
    <View style={styles.screen} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {header}
      {banners.length === 0 ? null : <View style={styles.banners}>{banners}</View>}
      <View style={styles.split}>
        {values.chatCollapsed ? (
          <View style={[styles.rail, { borderRightWidth: 1 }]}>
            <IconButton
              icon="PanelLeftOpen"
              label="Show the chat"
              theme={theme}
              onPress={() => save({ chatCollapsed: false })}
            />
          </View>
        ) : (
          <View nativeID="firstmate-chat-pane" style={values.boardCollapsed ? { flex: 1 } : { width: Math.round(chatShare * width), flexShrink: 0 }}>{chat}</View>
        )}
        {values.chatCollapsed || values.boardCollapsed ? null : (
          <ResizeHandle
            theme={theme}
            share={chatShare}
            totalWidth={width}
            onChange={setShare}
            onCommit={(next) => {
              save({ chatWidthFraction: next });
              setShare(null);
            }}
          />
        )}
        {values.boardCollapsed ? (
          <View style={[styles.rail, { borderLeftWidth: 1 }]}>
            <IconButton
              icon="PanelRightOpen"
              label="Show the board"
              theme={theme}
              onPress={() => save({ boardCollapsed: false })}
            />
          </View>
        ) : (
          <View style={{ flex: 1, minWidth: 0 }}>
            {rightPane === "board" ? crew : <FilesView theme={theme} compact={false} request={filesRequest} />}
          </View>
        )}
      </View>
    </View>
  );
}
