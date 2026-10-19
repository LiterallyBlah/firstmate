/**
 * FirstMate Home (chat, list/board/deck overview, home files and launcher) and its
 * dedicated workspace views. Paseo owns the Deck, Board and Crew tabs.
 *
 * Everything on it comes from one RPC, `firstmate.fleet.load`, polled at the
 * interval in the display settings and refetched right after any action. The
 * chat reads the first mate's timeline directly and streams.
 *
 * Machines, suggestions and tags share one compact toolbar; watches open from Home's header.
 * Crew groups tasks by urgency in one scroll container. Board keeps full-height
 * columns in one horizontal row on wide screens. Deck uses the setting engine.
 *
 * With remote hosts saved, a row of host tabs sits above the columns — All,
 * this machine, then each host — and filters them to that host's cards; a
 * host's tab shows that host's health first. The choice is a display setting.
 *
 * A card's 💬 opens that worker's conversation in the Converse drawer
 * (`client/converse.tsx`): docked beside the list or board where the pane has
 * room for both, over it where it does not, and filling the Crew tab on a
 * phone. The surface underneath stays mounted, so closing the drawer returns
 * to it exactly as it was, and focus goes back to the 💬 that opened it.
 *
 * A surface is unmounted whenever the captain opens a workspace, so the last
 * fleet, the compact tab and the open conversation live in module scope
 * and the board comes back drawn rather than empty.
 */
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

import {
  acknowledgeCharter,
  compareCharter,
  enableAgentTools,
  markMateSeen,
  removeSuggestion,
  type ColumnId,
  type Fleet,
  type Suggestion,
} from "../shared/fleet";
import { displaySettings, type CrewView, type DisplaySettings, type HomePane } from "../shared/settings";
import { Board } from "./board";
import { CrewCard, converseButtonId, watchOpener } from "./card";
import { FilesView, type FilesRequest } from "./files";
import { MateChat } from "./chat";
import { captainMessage } from "./attachments";
import { ConverseDrawer } from "./converse";
import { DRAWER_WIDTH, converseKey, conversingWith, converseTarget, drawerDocks } from "./converse-layout";
import { answeredReplies, replyBlockedText } from "./deck-replies";
import { deckOffered } from "./deck-scene";
import { agentStatusLabel, agentStatusTone, orderedColumns, revealFilesPatch, shortPath } from "./format";
import { LaunchPanel } from "./launch";
import { HeaderActions } from "./header-actions";
import { useMateSender } from "./mate-send";
import { ResizeHandle } from "./resize-handle";
import { clampShare, MIN_SPLIT_WIDTH } from "./resize-layout";
import { hostTabs, onTab, shownHostTab } from "./host-tabs";
import { useRemotes } from "./remotes";
import { SelectedDeckView } from "./deck-setting-view";
import { DeckSceneSwitcher } from "./deck-scene-switcher";
import { TaskList } from "./task-list";
import { TaskToolbar } from "./task-toolbar";
import { matchesTags, tagScopeCards } from "../shared/item-tags";
import { Banner, Chip, IconButton, Segmented, errorText } from "./ui";
import { focusWebElement, webAttributes } from "./web";
import { HubLauncher } from "./hub-launcher";
import { chatIsVisible, FLEET_PANELS, homeWorkspace, type FleetShell, type FleetView } from "./shell";
import { FLEET_QUERY_KEY, useFleet } from "./fleet-query";
import { DecisionSurface } from "./decision-surface";
import { NeedsYouIndicator } from "./needs-you";
import { useNeedsYou } from "./needs-you-query";
import { useOpenDecision } from "./decision-action";
import { activeCrewCount } from "./screen";
import { TaskBoard } from "./task-board";
import { useTaskLayout } from "./task-layout";
import { taskPresentation } from "./task-presentation";
import { DecisionButton } from "./decision-drawer";

export { FLEET_QUERY_KEY, useFleet } from "./fleet-query";

type Tab = "chat" | HomePane;
let cachedTab: Tab = "chat";
/** Home's inline views share the same renderers as the dedicated workspace tabs. */
type RightPane = HomePane;
let cachedRightPane: RightPane = "board";
/** Independent view state survives reopening without carrying a drawer into another tab or host. */
const viewState = new Map<string, { watching: string | null; showDone: boolean }>();

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

function paneName(pane: RightPane, crewView: CrewView): string {
  return pane === "files" ? "Home files" : pane === "deck" ? "Deck" : crewView === "list" ? "List" : "Board";
}

type FleetSurfaceProps = PluginScreenProps & {
  view?: FleetView;
  workspaceId?: string;
  shell?: FleetShell;
};

/** A key makes even host/workspace prop changes start from that destination's own view state. */
export function FleetSurface(props: FleetSurfaceProps) {
  const key = JSON.stringify([props.host?.id, props.workspaceId, props.view ?? "home"]);
  return (
    <DecisionSurface shell={props.shell} key={key} theme={props.theme} compact={props.layout.compact} params={props.params ?? {}}>
      <FleetViewBody {...props} stateKey={key} />
    </DecisionSurface>
  );
}

function FleetViewBody({
  theme,
  host,
  layout,
  navigation,
  params,
  view,
  workspaceId,
  shell,
  stateKey,
}: FleetSurfaceProps & { stateKey: string }) {
  const home = view === undefined;
  const remembered = viewState.get(stateKey);
  const [width, setWidth] = useState(0);
  const compact = layout.compact || (width > 0 && width < MIN_SPLIT_WIDTH);
  const enable = useRpc(enableAgentTools);
  const compareCharters = useRpc(compareCharter);
  const acknowledgeCharters = useRpc(acknowledgeCharter);
  const removeSuggestions = useRpc(removeSuggestion);
  const toast = useToast();
  const queryClient = useQueryClient();
  const display = useSettings(displaySettings);
  const taskLayout = useTaskLayout();
  const saved = display.status === "ready" ? display.values : DEFAULT_DISPLAY;

  /** Drawn at once and saved behind, so a fold or a drag never waits on a round trip. */
  const [override, setOverride] = useState<Partial<DisplaySettings>>({});
  const values: DisplaySettings = { ...saved, ...override };
  const [share, setShare] = useState<number | null>(null);
  const [tab, setTabState] = useState<Tab>(cachedTab);
  const [rightPane, setRightPaneState] = useState(display.status === "ready" ? saved.homePane : cachedRightPane);
  const [watching, setWatchingState] = useState(remembered?.watching ?? null);
  /** The right-hand pane's width, which decides whether the drawer docks beside the crew or covers it. */
  const [paneWidth, setPaneWidth] = useState(0);
  const [showDone, setShowDone] = useState(remembered?.showDone ?? false);
  const [enabling, setEnabling] = useState(false);
  const [charterBusy, setCharterBusy] = useState(false);
  /** A file the Files view should open; not kept across a remount, or it would open again on return. */
  const [filesRequest, setFilesRequest] = useState<FilesRequest | null>(null);

  const fleet = useFleet(values.pollSeconds);
  const decisions = useNeedsYou();
  const openDecision = useOpenDecision();
  const attention = (
    <NeedsYouIndicator theme={theme} snapshot={decisions.data} offline={decisions.error !== null} compact={compact} />
  );
  const data = fleet.data ?? null;
  const homeWorkspaceId = homeWorkspace(data);
  const crewView = home ? values.crewView : view === "crew" ? "list" : "board";
  const remoteHosts = useRemotes().data?.hosts ?? [];
  const hostTab = shownHostTab(values.hostTab, remoteHosts);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: FLEET_QUERY_KEY });
  }, [queryClient]);

  const shownTab = tab;
  /** Keep the standalone Deck tab's availability policy; inline Deck measures its narrower container. */
  const deck = deckOffered(Platform.OS, compact);
  const pane: RightPane = rightPane;
  /** The drawer sits beside the list or board, rather than over it, on a wide pane with room for both. */
  const onDeck = view === "deck" || (home && (compact ? shownTab : pane) === "deck");
  const docked = !compact && drawerDocks(paneWidth);

  useEffect(() => {
    if (!home || display.status !== "ready") return;
    cachedRightPane = values.homePane;
    setRightPaneState(values.homePane);
    setTabState((current) => (current === "chat" ? current : values.homePane));
  }, [home, display.status, values.homePane]);

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
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      // Opening another screen can unmount this one before the batching delay.
      // A completed drag must still reach the existing host settings document.
      if (Object.keys(pending.current).length > 0) flush(0);
    },
    [],
  );

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

  useEffect(() => {
    if (!home || params?.chat !== "show" || display.status !== "ready") return;
    setTab("chat");
    if (values.chatCollapsed) save({ chatCollapsed: false });
  }, [home, params?.chat, display.status]);

  function setTab(next: Tab, keepConversation = false): void {
    if (next === "board" && tab === "board" && !keepConversation) setWatching(null);
    cachedTab = next;
    setTabState(next);
  }

  function setRightPane(next: RightPane, keepConversation = false): void {
    if (next === "board" && pane === "board" && !keepConversation) setWatching(null);
    cachedRightPane = next;
    setRightPaneState(next);
    save({ homePane: next });
  }

  /** List and Board are presentations of the same tasks, filters and open conversation. */
  function selectHomePane(next: CrewView | "files" | "deck"): void {
    const changingView = (next === "list" || next === "board") && next !== crewView;
    if (changingView) save({ crewView: next });
    const destination = next === "files" || next === "deck" ? next : "board";
    setRightPane(destination, changingView);
    if (compact) setTab(destination, changingView);
  }

  /** Opens a worker's conversation, or closes it (`null`) and gives focus back to the 💬 that opened it. */
  function setWatching(next: string | null): void {
    const previous = watching;
    viewState.set(stateKey, { watching: next, showDone });
    setWatchingState(next);
    if (next === null && previous !== null) {
      const card = data?.cards.find((entry) => conversingWith(entry, previous));
      focusWebElement(converseButtonId(card === undefined ? previous : converseKey(card)));
    }
  }

  const order = orderedColumns(values.columnOrder);
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
   * While Home's chat is visible the captain is looking at the first mate, so
   * its "finished" flag is cleared the way opening it in Paseo would clear it,
   * and its workspace reads as done in the sidebar. Keyed by `updatedAt`, so a
   * turn that ends while the panel is open is cleared too, and a clear that
   * failed is not retried until something changes. A pending permission is
   * left flagged; the server checks that again.
   */
  const markSeen = useRpc(markMateSeen);
  const unseen =
    chatIsVisible(view ?? "home", compact, tab, values.chatCollapsed) &&
    mate !== null &&
    mate.requiresAttention &&
    mate.pendingPermissions === 0
      ? `${mate.id}:${mate.updatedAt}`
      : null;
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

  /**
   * A suggestion is sent to the first mate at once, through the chat's own
   * path, and the chat comes into view to show it going out. The draft the
   * captain was typing is left as it was. While a message is on its way the
   * buttons are disabled, and a press that still gets through is refused by
   * the sender, so a double press sends once.
   *
   * The ship deck's reply chips are these same suggestions, sent through here.
   * A pick is marked answered, so the deck stops offering it at once, and
   * offered again if the send fails. Says whether it went.
   */
  function suggest(prompt: string): boolean {
    if (mate === null || !mateSender.send(captainMessage(prompt, []), () => answeredReplies.unmark(prompt)))
      return false;
    answeredReplies.mark(prompt);
    if (!home) shell?.openHome();
    else if (compact) setTab("chat");
    else if (values.chatCollapsed) save({ chatCollapsed: false });
    return true;
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
    if (view === "chat") {
      setFilesRequest({ path, at: Date.now() });
      return;
    }
    if (compact) setTab("files");
    setRightPane("files");
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
  if (mate !== null && (mate.status === "error" || mate.status === "closed")) {
    banners.push(
      <Banner
        key="mate-unavailable"
        theme={theme}
        tone="info"
        text="The first mate is unavailable; its reviews and recovery work are waiting."
      />,
    );
  }
  if ((data?.homeGuests?.length ?? 0) > 0) {
    const guests = data!.homeGuests!;
    banners.push(
      <Banner
        key="home-guests"
        theme={theme}
        tone="warning"
        text={`${guests.length} other ${guests.length === 1 ? "chat is" : "chats are"} open in the FirstMate home. They are guests, not the configured first mate. Older chats may still remember the previous charter; the role guard does not revoke tool access.`}
        actions={
          navigation === undefined
            ? []
            : guests.slice(0, 3).map((guest, index) => ({
                label: `${index + 1}: ${(guest.title ?? guest.id).slice(0, 24)}${(guest.title ?? guest.id).length > 24 ? "…" : ""}`,
                icon: "ExternalLink" as const,
                onPress: () => navigation.openAgent({ agentId: guest.id }),
              }))
        }
      />,
    );
  }
  // The question itself is in the chat; the banner is for when the chat is
  // out of sight — folded away, or behind the Crew tab on a phone.
  const chatHidden = !chatIsVisible(view ?? "home", compact, shownTab, values.chatCollapsed);
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
          onPress: () => (!home ? shell?.openHome() : compact ? setTab("chat") : save({ chatCollapsed: false })),
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

  if (!home && view !== "chat" && (data === null || homeWorkspaceId === null || workspaceId !== homeWorkspaceId)) {
    return (
      <View
        style={[styles.screen, { padding: 16, gap: 12 }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        <Text accessibilityRole="header" style={styles.title}>
          {FLEET_PANELS[view].title}
        </Text>
        {attention}
        <Text style={styles.meta}>
          {data === null
            ? fleet.error === null
              ? "Loading FirstMate…"
              : errorText(fleet.error)
            : homeWorkspaceId === null
              ? "Launch a first mate in its home to use this view."
              : "This fleet view belongs to the FirstMate home workspace."}
        </Text>
        {shell === undefined ? null : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <IconButton theme={theme} icon="Ship" label="FirstMate Home" showLabel onPress={shell.openHome} />
            {homeWorkspaceId === null ? null : (
              <IconButton
                theme={theme}
                icon="ExternalLink"
                label={"Open " + FLEET_PANELS[view].title + " in FirstMate"}
                showLabel
                onPress={() => shell.openView(view, homeWorkspaceId)}
              />
            )}
          </View>
        )}
      </View>
    );
  }

  const mateStatus =
    mate === null ? null : <Chip theme={theme} text={agentStatusLabel(mate)} color={agentStatusTone(theme, mate)} />;
  const taskCounts =
    data === null ? null : (
      <Text style={[styles.meta, { flexShrink: 1, fontSize: compact ? 11 : 12 }]} numberOfLines={1}>
        {[
          activeCrewCount(data.cards) + " in hand",
          data.cards.filter((card) => taskPresentation(card, decisions.data).group === "later").length + " later",
          data.cards.filter((card) => taskPresentation(card, decisions.data).group === "done").length + " done",
        ].join(" · ")}
      </Text>
    );
  const header = (
    <View style={[styles.header, { paddingTop: 8, gap: 6 }]} nativeID="firstmate-home-header">
      <View style={[styles.headerRow, { flexWrap: "nowrap" }]}>
        <Icon name="Ship" size={16} color={theme.colors.foreground} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Text style={[styles.title, { fontSize: 17 }]}>FirstMate</Text>
          {compact ? null : attention}
          {compact ? null : mateStatus}
          {compact ? null : taskCounts}
        </View>
        {home && !compact && mate !== null && data !== null && !values.boardCollapsed ? (
          <Segmented
            theme={theme}
            value={pane === "board" ? crewView : pane}
            options={[
              {
                value: "list",
                label: "List",
                tooltip: "Show the tasks as a list grouped by urgency.",
              },
              {
                value: "board",
                label: "Board",
                tooltip: "Show the same tasks in status columns.",
              },
              { value: "files", label: "Home files", tooltip: "Browse and edit files in the FirstMate home." },
              { value: "deck", label: "Deck", tooltip: "Show the crew on deck beside the first mate." },
            ]}
            onChange={selectHomePane}
          />
        ) : null}
        {compact && shell !== undefined ? (
          <HubLauncher theme={theme} navigation={navigation} shell={shell} workspaceId={homeWorkspaceId} compact />
        ) : null}
        <HeaderActions
          theme={theme}
          navigation={navigation}
          compact={compact}
          data={data}
          values={values}
          paneName={paneName(pane, crewView)}
          sender={mateSender}
          refreshing={fleet.isFetching}
          onSave={save}
          onRefresh={refresh}
          onOpenFile={openFile}
          onOpenSettings={openSettings === null ? null : () => openSettings?.("firstmate")}
          onUpdateSent={() => {
            if (compact) setTab("chat");
            else if (values.chatCollapsed) save({ chatCollapsed: false });
          }}
        />
      </View>
      {compact ? attention : null}
      {compact && (mate !== null || data !== null) ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {mateStatus}
          {taskCounts}
        </View>
      ) : null}
      {compact || shell === undefined ? null : (
        <HubLauncher theme={theme} navigation={navigation} shell={shell} workspaceId={homeWorkspaceId} />
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
      <View style={styles.screen} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {header}
        <ScrollView automaticallyAdjustKeyboardInsets>
          {banners.length === 0 ? null : <View style={styles.banners}>{banners}</View>}
          <LaunchPanel theme={theme} compact={compact} home={data.home} onLaunched={refresh} />
        </ScrollView>
      </View>
    );
  }

  const tabs = hostTabs(data.cards, remoteHosts);
  const hostCards = data.cards.filter((card) => onTab(card, hostTab));
  const tagCards = tagScopeCards(
    hostCards,
    crewView === "list"
      ? showDone
      : taskLayout.values.mode === "detailed"
        ? !values.collapsedColumns.includes("done")
        : !taskLayout.values.collapsed.includes("done"),
  );
  const filteredCards = hostCards.filter((card) => matchesTags(card, values.tagFilter));
  const board = (
    <View style={{ flex: 1, minHeight: 0 }}>
      <TaskToolbar
        theme={theme}
        tabs={tabs}
        hosts={remoteHosts}
        hostTab={hostTab}
        onHostChange={(id) => save({ hostTab: id })}
        suggestions={data.suggestions.filter((suggestion) => suggestion.decision === undefined)}
        sending={mateSender.sending}
        onPick={suggest}
        onRemove={dismissSuggestion}
        tagCards={tagCards}
        selectedTags={values.tagFilter}
        onTagsChange={(tagFilter) => save({ tagFilter })}
      />
      {taskLayout.invalid ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.foregroundMuted, padding: 12 }}>
          Task layout settings could not be read. Saved settings have not been changed.
        </Text>
      ) : null}
      {crewView === "board" ? (
        <View style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
          <DecisionButton
            theme={theme}
            label={taskLayout.values.mode === "summary" ? "Detailed columns" : "Summary columns"}
            disabled={taskLayout.disabled}
            onPress={() => taskLayout.save({ mode: taskLayout.values.mode === "summary" ? "detailed" : "summary" })}
          />
        </View>
      ) : null}
      {hostCards.length > 0 && filteredCards.length === 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted, padding: 12 }}>
          No items match the selected tags on this host.
        </Text>
      ) : null}
      {crewView === "list" ? (
        <TaskList
          cards={filteredCards}
          allCards={data.cards}
          snapshot={decisions.data}
          offline={decisions.error !== null}
          showLater={!taskLayout.values.laterCollapsed}
          onShowLater={(show) => taskLayout.save({ laterCollapsed: !show })}
          layoutDisabled={taskLayout.disabled}
          theme={theme}
          compact={compact}
          density={values.density}
          conversing={watching}
          onConverse={setWatching}
          onChanged={refresh}
          showDone={showDone}
          onShowDone={(next) => {
            viewState.set(stateKey, { watching, showDone: next });
            setShowDone(next);
          }}
        />
      ) : taskLayout.values.mode === "summary" ? (
        <TaskBoard
          cards={filteredCards}
          allCards={data.cards}
          snapshot={decisions.data}
          offline={decisions.error !== null}
          theme={theme}
          compact={compact}
          density={values.density}
          conversing={watching}
          onConverse={setWatching}
          onChanged={refresh}
          layout={taskLayout.values}
          onLayout={taskLayout.save}
          layoutDisabled={taskLayout.disabled}
        />
      ) : (
        <Board
          cards={filteredCards}
          snapshot={decisions.data}
          order={order}
          collapsed={values.collapsedColumns}
          theme={theme}
          compact={compact}
          density={values.density}
          conversing={watching}
          onConverse={setWatching}
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
    <MateChat
      key={mate.id}
      imageContext={{ serverId: host?.id, home: data.home }}
      mate={mate}
      theme={theme}
      compact={compact}
      onChanged={refresh}
      onOpenFile={openFile}
      navigation={navigation}
    />
  );
  // Chat always follows the configured mate, even in another project's workspace.
  // Its transcript, composer and launch state are the same ones Home uses.
  if (view === "chat") {
    return (
      <View style={styles.screen} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text accessibilityRole="header" style={styles.title}>
              FirstMate · Chat
            </Text>
            {compact ? null : attention}
            {mateStatus}
            <View style={styles.spacer} />
            {shell === undefined ? null : (
              <IconButton theme={theme} icon="Ship" label="FirstMate Home" showLabel onPress={shell.openHome} />
            )}
            <IconButton theme={theme} icon="RefreshCw" label="Refresh" onPress={refresh} disabled={fleet.isFetching} />
          </View>
          {compact ? attention : null}
        </View>
        {banners.length === 0 ? null : <View style={styles.banners}>{banners}</View>}
        {chat}
        <Modal
          title="Home files"
          open={filesRequest !== null}
          onOpenChange={(open) => {
            if (!open) setFilesRequest(null);
          }}
        >
          <Modal.Content scrollable={false}>
            <View style={{ height: compact ? 400 : 600, maxHeight: "100%" }}>
              <FilesView theme={theme} compact={compact} request={filesRequest} />
            </View>
          </Modal.Content>
        </Modal>
      </View>
    );
  }
  const watchedCard = watching === null ? null : (data.cards.find((card) => conversingWith(card, watching)) ?? null);
  const watchedTarget = watching === null ? null : converseTarget(watching);
  const watchedLocalId = watchedCard?.agent?.id ?? (watchedTarget?.kind === "local" ? watchedTarget.agentId : null);
  /** Over the crew rather than beside it: a phone, or a pane too narrow for both. */
  const covered = watching !== null && !docked;
  // The list or board stays mounted under a drawer that covers it, so closing the drawer finds it scrolled where it was.
  const conversation =
    watching === null || watchedTarget === null ? null : (
      <View
        style={
          docked
            ? { width: DRAWER_WIDTH, flexShrink: 0 }
            : onDeck
              ? { position: "absolute", inset: 0, zIndex: 2, backgroundColor: theme.colors.surface0 }
              : { flex: 1, minWidth: 0 }
        }
      >
        <ConverseDrawer
          key={watching}
          watchKey={watching}
          card={watchedCard}
          theme={theme}
          compact={compact}
          docked={docked}
          backLabel={onDeck ? "Deck" : crewView === "list" ? (home ? "List" : "Crew") : "Board"}
          onClose={() => setWatching(null)}
          onOpen={
            navigation === undefined || watchedLocalId === null
              ? null
              : () => navigation.openAgent({ agentId: watchedLocalId })
          }
          onChanged={refresh}
          serverId={host?.id}
        />
      </View>
    );
  const crew = (
    <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
      <View style={[{ flex: 1, minWidth: 0 }, covered ? { display: "none" } : null]}>{board}</View>
      {conversation}
    </View>
  );

  const deckScene = (
    <SelectedDeckView
      needsYou={decisions.error && decisions.data
        ? { ...decisions.data, freshness: { ...decisions.data.freshness, status: "stale" } }
        : decisions.data ?? data.needsYou}
      onOpenDecision={openDecision}
      conversationOpen={watching !== null}
      captionActions={home ? <DeckSceneSwitcher theme={theme} compact={compact || paneWidth < 638} /> : null}
      setting={values.deckSetting}
      cards={data.cards}
      theme={theme}
      stale={fleet.error !== null}
      suggestions={data.suggestions.filter((suggestion) => suggestion.decision === undefined)}
      onRemove={dismissSuggestion}
      replyBlocked={replyBlockedText({
        mate: mate !== null,
        sending: mateSender.sending,
      })}
      onReply={(reply) => {
        if (suggest(reply.prompt))
          toast.show(`Sending to the first mate: ${reply.label}`, {
            variant: "success",
          });
      }}
      renderFocus={(card, close, replies) => (
        <CrewCard
          card={card}
          theme={theme}
          compact={compact}
          presentation="focus"
          onClose={close}
          replies={replies}
          // Both actions open the same worker composer, keeping this scene mounted.
          onSteer={() => setWatching(converseKey(card))}
          opener={watchOpener(card, (key) => {
            setWatching(key);
          })}
          onChanged={refresh}
        />
      )}
    />
  );
  const inlineDeck = (
    <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
      <View
        aria-hidden={covered}
        // A covered canvas keeps its dimensions, scene and focus; it cannot receive pointer or keyboard input.
        {...webAttributes({ inert: covered ? "" : null })}
        pointerEvents={covered ? "none" : "auto"}
        style={{ flex: 1, minWidth: 0 }}
      >
        {deckScene}
      </View>
      {conversation}
    </View>
  );

  if (!home) {
    return (
      <View style={styles.screen} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text accessibilityRole="header" style={styles.title}>
              {FLEET_PANELS[view].title}
            </Text>
            {compact ? null : attention}
            <View style={styles.spacer} />
            {view === "deck" && deck ? <DeckSceneSwitcher theme={theme} compact={compact || width < 900} /> : null}
            {shell === undefined ? null : (
              <IconButton theme={theme} icon="Ship" label="FirstMate Home" showLabel onPress={shell.openHome} />
            )}
            <IconButton theme={theme} icon="RefreshCw" label="Refresh" onPress={refresh} disabled={fleet.isFetching} />
          </View>
          {compact ? attention : null}
        </View>
        {fleet.error === null ? null : <Banner theme={theme} tone="danger" text={errorText(fleet.error)} />}
        {mate.status === "error" || mate.status === "closed" ? (
          <Banner
            theme={theme}
            tone="info"
            text="The first mate is unavailable; its reviews and recovery work are waiting."
          />
        ) : null}
        {mate.pendingPermissions === 0 ? null : (
          <Banner
            theme={theme}
            tone="warning"
            text="The first mate is waiting for your answer."
            action={{
              label: "Open Home",
              icon: "MessageSquare",
              onPress: () => shell?.openHome(),
            }}
          />
        )}
        <View style={{ flex: 1, minHeight: 0 }} onLayout={(event) => setPaneWidth(event.nativeEvent.layout.width)}>
          {view !== "deck" ? (
            crew
          ) : !deck ? (
            <Text style={styles.loading}>
              Deck needs a wide web or desktop window. Open Crew or Board from FirstMate Home on this device.
            </Text>
          ) : (
            inlineDeck
          )}
        </View>
      </View>
    );
  }

  if (compact) {
    const tabs = [
      { id: "chat", label: "First mate" },
      { id: "list", label: "List" },
      { id: "board", label: "Board" },
      { id: "files", label: "Files" },
      { id: "deck", label: "Deck" },
    ] as const;
    const selected = shownTab === "board" ? crewView : shownTab;
    return (
      <View style={styles.screen} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {header}
        {banners.length === 0 ? null : <View style={styles.banners}>{banners}</View>}
        <View style={styles.tabs}>
          {tabs.map(({ id, label }) => (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected: selected === id }}
              aria-selected={selected === id}
              style={[styles.tab, selected === id ? styles.tabActive : null]}
              onPress={() => (id === "chat" ? setTab("chat") : selectHomePane(id))}
            >
              <Text style={[styles.tabText, selected === id ? styles.tabTextActive : null]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flex: 1, minHeight: 0 }}>
          {shownTab === "chat" ? (
            chat
          ) : shownTab === "board" ? (
            crew
          ) : shownTab === "deck" ? (
            inlineDeck
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
          <View
            nativeID="firstmate-chat-pane"
            style={values.boardCollapsed ? { flex: 1 } : { width: Math.round(chatShare * width), flexShrink: 0 }}
          >
            {chat}
          </View>
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
              label={`Show ${paneName(pane, crewView)}`}
              theme={theme}
              onPress={() => save({ boardCollapsed: false })}
            />
          </View>
        ) : (
          <View style={{ flex: 1, minWidth: 0 }} onLayout={(event) => setPaneWidth(event.nativeEvent.layout.width)}>
            {pane === "board" ? (
              crew
            ) : pane === "deck" ? (
              inlineDeck
            ) : (
              <FilesView theme={theme} compact={false} request={filesRequest} />
            )}
          </View>
        )}
      </View>
    </View>
  );
}
