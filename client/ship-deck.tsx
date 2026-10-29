/**
 * The ship deck: the crew as sailors on hull C's deck, drawn from the generated art by PixiJS on a WebGL
 * canvas in the task pane or standalone Deck tab, on compact and wide web layouts
 * (`deckOffered`). Native and displays without WebGL are told why they cannot draw it in words.
 *
 * It draws from the cards the board already has — `FleetSurface` passes them in from the shared fleet
 * query — so it polls nothing of its own. When that query fails, `stale` greys the whole crew: each
 * sailor keeps its last state and place, and the pane says the feed is lost — nobody turns idle.
 *
 * The deck moves (`client/deck-pixi.ts`): sailors walk to their state's place, climb up through the
 * hatch when they join and down it when they leave, and the ship rides a gentle sea. It is capped at
 * 30 frames a second, paused while the window is hidden, lighter on a software renderer, and still
 * under reduced motion, where every state still shows by place, mark and badge. The canvas makes the crew legible at a glance:
 * each sailor wears its state's badge over its head (`client/deck-badges.ts`), and pointing at one shows
 * who it is — the card's title, its state in the board's words, its project and host, and its card's line
 * at rest — in a label laid over the canvas (`SailorLabel`, placed by `client/deck-hover.ts`). The legend
 * below says what each badge means and where on deck that state stands, with the counts in words, for a
 * screen reader and for a deck that cannot draw.
 *
 * **Clicking a sailor focuses it** (`client/deck-camera.ts`): the camera zooms in until it stands enlarged
 * beside a compact panel, the rest of the deck dims, and the panel is that crewmate's own card, handed in by
 * the screen (`renderFocus`) — the board's data and the board's actions, with their guards and confirmations.
 * Esc, the panel's close button, or a click anywhere but the focused sailor pulls the camera back out. From
 * the keyboard, Tab reaches the deck, an arrow key or Enter focuses a sailor, and Tab stays inside the panel
 * until Esc. Under reduced motion the camera snaps instead of zooming.
 *
 * **Suggestions**: the shark opens the first mate's full list through the board's send handler.
 * The first mate opens Needs you in the same popover; workers keep their focus actions. The legend opens the same list
 * from the keyboard; Escape, an outside click or another shark click closes it.
 *
 * The canvas lives in a childless `View` (`client/deck-mount.ts` explains the escape hatch). A renderer
 * that cannot draw — native, no WebGL, Pixi failing to start — gets a plain message in its place.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { deckDecisionDestination, deckDecisionLabel } from "./deck-decisions";
import type { OpenDecision } from "./decision-action";
import { FIRST_MATE_KEY } from "./deck-first-mate";
import { disconnectedReveals, hiddenWorkersText } from "./deck-offline";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

import type { FleetCard, Suggestion } from "../shared/fleet";
import { DEFAULT_DECK_SETTING, loadDeckEngine, loadDeckSetting } from "../shared/deck-rpc";
import { LOADING_DECK, type DeckPresentation } from "./deck-setting";
import { badgeInk, badgePixels, BADGE_SIZE } from "./deck-badges";
import { focusLayout, nextFocus, stepFocus } from "./deck-camera";
import { labelPlacement, type DeckHover } from "./deck-hover";
import { browserDeckEngine, mountDeck, type DeckEngine, type DeckMount, type DeckStatus } from "./deck-mount";
import { answeredReplies, bubblePlacement, repliesByCard, type DeckRegion } from "./deck-replies";
import { DECK_STATES, deckScene, type DeckSailor, type DeckState } from "./deck-scene";
import { DecisionCountBubble, NeedsYouBubbles, ReplyOptions, SuggestionBubbles } from "./reply-bubble";
import { indicatorState } from "./needs-you-state";
import { useDecisionReadState } from "./decision-read-context";
import { webAttributes } from "./web";


/** A state's badge, drawn as on deck, `pixel` points an art pixel: the legend's key to the sailors' heads. */
export function DeckBadge({ state, colour, pixel = 2 }: { state: DeckState; colour: string; pixel?: number }) {
  const ink = `#${badgeInk(colour).toString(16).padStart(6, "0")}`;
  return (
    <View style={{ width: BADGE_SIZE.width * pixel, height: BADGE_SIZE.height * pixel }}>
      {badgePixels(state).map((dot) => (
        <View
          key={`${dot.kind}:${dot.x}:${dot.y}`}
          style={{
            position: "absolute",
            left: dot.x * pixel,
            top: dot.y * pixel,
            width: pixel,
            height: pixel,
            backgroundColor: dot.kind === "sign" ? colour : ink,
          }}
        />
      ))}
    </View>
  );
}

/** Who the sailor under the pointer is: laid over the canvas, never taking the pointer from it. */
export function SailorLabel({ sailor, hover, theme, colour }: { sailor: DeckSailor; hover: DeckHover; theme: PluginTheme; colour: string }) {
  const { colors } = theme;
  const { caption } = sailor;
  const place = labelPlacement(hover);
  const where = [caption.project, caption.host].filter((part): part is string => part !== null && part !== "").join(" · ");
  return (
    <View
      accessibilityRole="text"
      testID="firstmate-deck-label"
      style={{
        pointerEvents: "none",
        position: "absolute",
        left: place.left,
        width: place.width,
        ...(place.top === undefined ? { bottom: place.bottom } : { top: place.top }),
        padding: 8,
        gap: 3,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colour,
        backgroundColor: colors.surface0,
        opacity: sailor.stale ? 0.9 : 1,
      }}
    >
      <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>
        {caption.title}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <DeckBadge state={sailor.state} colour={colour} />
        <Text style={{ color: colour, fontSize: 12, flexShrink: 1 }}>{caption.status}</Text>
      </View>
      {where === "" ? null : <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{where}</Text>}
      {caption.line === null ? null : (
        <Text numberOfLines={3} style={{ color: colors.foreground, fontSize: 12 }}>
          {caption.line}
        </Text>
      )}
      {caption.stale === null ? null : <Text style={{ color: colors.statusWarning, fontSize: 12 }}>{caption.stale}</Text>}
      {hover.action === "attention" ? <Text style={{ color: colors.foreground, fontSize: 12 }}>Click to focus on deck</Text> : null}
    </View>
  );
}

/** What a key does on the deck: while a sailor is focused, Esc lets it go and Tab stays in its panel; on the canvas, the arrows and Enter focus one. */
export type DeckKeyAction = "close" | "trap" | "next" | "previous" | "open" | null;

export function deckKeyAction(key: string, context: { focused: boolean; onCanvas: boolean }): DeckKeyAction {
  if (context.focused && key === "Escape") return "close";
  if (context.focused && key === "Tab") return "trap";
  if (!context.onCanvas) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return "next";
  if (key === "ArrowLeft" || key === "ArrowUp") return "previous";
  if (!context.focused && (key === "Enter" || key === " ")) return "open";
  return null;
}

/** The keyboard as the deck reads it off the document; the panel's element, for keeping Tab inside it. */
interface DeckKeyEvent {
  key: string;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  preventDefault(): void;
}
interface FocusTarget {
  focus(options?: { preventScroll?: boolean }): void;
  getAttribute?(name: string): string | null;
}
interface PanelElement extends FocusTarget {
  contains(node: unknown): boolean;
  querySelectorAll(selector: string): ArrayLike<FocusTarget>;
}
interface KeyDocument {
  activeElement?: unknown;
  body?: unknown;
  addEventListener(type: "keydown", listener: (event: DeckKeyEvent) => void): void;
  removeEventListener(type: "keydown", listener: (event: DeckKeyEvent) => void): void;
}

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

function isFocusTarget(node: unknown): node is FocusTarget {
  return typeof node === "object" && node !== null && typeof Reflect.get(node, "focus") === "function";
}

function isPanelElement(node: unknown): node is PanelElement {
  return isFocusTarget(node) && typeof Reflect.get(node, "querySelectorAll") === "function" && typeof Reflect.get(node, "contains") === "function";
}

/** What can take the keyboard inside the panel, in order: no disabled button. */
function panelStops(panel: PanelElement): FocusTarget[] {
  return Array.from(panel.querySelectorAll(FOCUSABLE)).filter((node) => node.getAttribute?.("aria-disabled") !== "true");
}

const NO_SUGGESTIONS: readonly Suggestion[] = [];

/** Where a bubble may hang: the whole canvas, or with a sailor focused, the room its panel leaves. */
export function bubbleRegion(size: { width: number; height: number }, focused: boolean): DeckRegion {
  if (!focused) return { left: 0, top: 0, right: size.width, bottom: size.height };
  const layout = focusLayout(size);
  return layout.side === "right"
    ? { left: 0, top: 0, right: "left" in layout.panel ? layout.panel.left : size.width, bottom: size.height }
    : { left: 0, top: 0, right: size.width, bottom: layout.room.height };
}

/** What the pane says where the canvas would be, or null while it draws. */
export function deckStatusText(status: DeckStatus, presentation: DeckPresentation = LOADING_DECK): string | null {
  const noun = presentation.copy.noun;
  const subject = noun[0]!.toUpperCase() + noun.slice(1);
  switch (status.kind) {
    case "drawing":
      return null;
    case "starting":
      return presentation.copy.starting;
    case "failed":
      return `${subject} could not start: ${status.message}`;
    case "unsupported":
      return status.reason === "no-webgl"
        ? `This display has no WebGL, so ${noun} cannot draw. List and Board show the tasks.`
        : `${subject} draws only in the Paseo desktop app. List and Board show the tasks.`;
  }
}

/** A changed pack id starts a fresh mount, including focus, hover, pending loads and the engine closure. */
export function ShipDeckView({ hostId = "", ...props }: Omit<Parameters<typeof DeckView>[0], "onShowDisconnected"> & { hostId?: string }) {
  const revealed = useSyncExternalStore(disconnectedReveals.subscribe, () => disconnectedReveals.has(hostId));
  return <DeckView key={props.setting ?? DEFAULT_DECK_SETTING} {...props}
    hideDisconnectedWorkers={props.hideDisconnectedWorkers !== false && !revealed}
    onShowDisconnected={() => disconnectedReveals.show(hostId)} />;
}

function DeckView({
  cards,
  theme,
  stale = false,
  engine,
  os = Platform.OS,
  renderFocus,
  captionActions,
  suggestions = NO_SUGGESTIONS,
  onReply,
  onRemove,
  replyBlocked = null,
  setting = DEFAULT_DECK_SETTING,
  onFailure,
  conversationOpen = false,
  needsYou,
  onOpenDecision,
  hideDisconnectedWorkers = true,
  onShowDisconnected,
}: {
  hideDisconnectedWorkers?: boolean;
  onShowDisconnected?: () => void;
  needsYou?: NeedsYouSnapshot | undefined;
  onOpenDecision?: OpenDecision | undefined;
  cards: readonly FleetCard[];
  theme: PluginTheme;
  /**
   * The focused sailor's card, compact, with its actions: the screen hands in the board's own card so the deck
   * acts through the same handlers. `close` pulls the camera back out. `replies` is the sailor's replies for the
   * captain to pick, or null, for the card to show under its glance. Without it, a click focuses no one.
   */
  renderFocus?: (card: FleetCard, close: () => void, replies: ReactNode) => ReactNode;
  /** Optional controls alongside the caption; Home uses this for its scene picker. */
  captionActions?: ReactNode;
  /** The first mate's suggestions; those naming a crewmate also appear in its focus panel. */
  suggestions?: readonly Suggestion[];
  /** Sends a reply the way the strip sends a suggestion. Without it, the deck offers no replies. */
  onReply?: (reply: Suggestion) => void;
  /** Removes a suggestion through the same file/RPC path as the strip. */
  onRemove?: (suggestion: Suggestion) => Promise<void>;
  /** Why a reply cannot be sent just now (`replyBlockedText`), or null. */
  replyBlocked?: string | null;
  /** The fleet load is failing: the deck shows the last crew it saw, greyed. */
  stale?: boolean;
  /** Stood in for by the tests; the browser's WebGL, and Pixi and the setting's pack from the daemon, otherwise. */
  engine?: DeckEngine;
  os?: string;
  /** The setting pack drawn, by id (`shared/deck-setting.ts`). */
  setting?: string;
  /** Selection may fall back when a non-default pack fails to load. */
  onFailure?: () => void;
  /** A sibling conversation owns keyboard focus while the scene stays live. */
  conversationOpen?: boolean;
}) {
  const answered = useSyncExternalStore(answeredReplies.subscribe, answeredReplies.version);
  const [carrierMode, setCarrierMode] = useState(false);
  const [popover, setPopover] = useState<"suggestions" | "decisions" | null>(null);
  const suggestionsOpen = popover === "suggestions";
  const decisionsOpen = popover === "decisions";
  const offers = onReply !== undefined;
  // `answered` is the store's version: a pick, or a send that failed, changes what is still waiting.
  const replies = useMemo(
    () => (offers ? repliesByCard(cards, suggestions, answeredReplies.has) : new Map<string, Suggestion[]>()),
    [cards, suggestions, offers, answered],
  );
  // A reply the file has dropped is forgotten, so one that comes back later is offered again.
  useEffect(() => answeredReplies.keepOnly(suggestions), [suggestions]);
  const scene = useMemo(() => ({ ...deckScene(cards, theme, { feedStale: stale, needsYou, hideDisconnectedWorkers }), hasSuggestions: suggestions.length > 0, suggestionsOpen }), [cards, theme, stale, suggestions, suggestionsOpen, needsYou, hideDisconnectedWorkers]);
  // One engine for the view's life, so a new `useRpc` function on a re-render never restarts the canvas.
  const loadEngine = useRpc(loadDeckEngine);
  const loadSetting = useRpc(loadDeckSetting);
  const loadRef = useRef({ loadEngine, loadSetting });
  loadRef.current = { loadEngine, loadSetting };
  const [browser] = useState(() =>
    browserDeckEngine(
      () => loadRef.current.loadEngine({}),
      (id) => loadRef.current.loadSetting({ id }),
      setting,
    ),
  );
  const used = engine ?? browser;
  const web = os === "web";
  const [status, setStatus] = useState<DeckStatus>(
    web ? { kind: "starting" } : { kind: "unsupported", reason: "native" },
  );
  const host = useRef<View>(null);
  const panel = useRef<View>(null);
  const suggestionPanel = useRef<View>(null);
  const suggestionTrigger = useRef<View>(null);
  const decisionTrigger = useRef<View>(null);
  const [hover, setHover] = useState<DeckHover | null>(null);
  const [mateAnchor, setMateAnchor] = useState<DeckHover | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** The sailor the camera is closed in on, by card key. */
  const [focused, setFocused] = useState<string | null>(null);
  const focusable = renderFocus !== undefined;
  const mount = useRef<DeckMount | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const decisionOpener = useRef(onOpenDecision);
  decisionOpener.current = onOpenDecision;
  const openDecisionFor = (key: string | null): boolean => {
    const decisions = sceneRef.current.decisions;
    if (key === FIRST_MATE_KEY) {
      setFocused(null);
      if (decisionOpener.current !== undefined && (indicatorState(decisions?.snapshot).count ?? 0) > 0) {
        setPopover(now => now === "decisions" ? null : "decisions");
      } else setPopover(null);
      return true;
    }
    const decision = key === null ? undefined : decisions?.byCard.get(key);
    if (decisionOpener.current === undefined || decision === undefined) return false;
    setFocused(null);
    setPopover(null);
    decisionOpener.current(deckDecisionDestination(decisions?.snapshot, decision?.id ?? "next"));
    return true;
  };
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const focusableRef = useRef(focusable);
  focusableRef.current = focusable;
  /** The sailor focused last, so the arrows go on from it after Esc. */
  const lastFocused = useRef<string | null>(null);

  useEffect(() => {
    if (!web) return;
    const started = mountDeck(host.current, sceneRef.current, used, (next) => {
      setStatus(next);
      setCarrierMode(next.kind === "drawing" && next.presentation?.attentionCarrier === true);
    }, setHover, (key, action) => {
      if (action === "attention") {
        setFocused(null);
        setPopover(now => now === "suggestions" ? null : "suggestions");
        return;
      }
      if (openDecisionFor(key)) return;
      setPopover(null);
      if (focusableRef.current) setFocused((now) => nextFocus(now, key));
    }, setMateAnchor);
    started.focus(focusedRef.current);
    mount.current = started;
    return () => {
      mount.current = null;
      started.destroy();
      setHover(null);
    };
  }, [web, used]);

  useEffect(() => {
    mount.current?.update(scene);
  }, [scene]);

  const focusedSailor = focused === null ? null : (scene.sailors.find((sailor) => sailor.key === focused) ?? null);
  const focusedCard = focused === null ? null : (cards.find((card) => card.key === focused) ?? null);
  const open = focusable && focusedSailor !== null && focusedCard !== null && status.kind === "drawing";

  // A sailor that leaves the deck (ended, done) takes the focus with it; so does a deck that stops drawing.
  useEffect(() => {
    if (focused !== null && !open) setFocused(null);
  }, [focused, open]);

  useEffect(() => {
    mount.current?.focus(open ? focused : null);
    if (open) lastFocused.current = focused;
  }, [focused, open]);

  // Opened, the panel takes the keyboard; closed, the deck has it back, unless it went somewhere else meanwhile.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (conversationOpen) return;
    const doc = (globalThis as { document?: KeyDocument }).document;
    const panelNode: unknown = panel.current;
    const hostNode: unknown = host.current;
    // The panel itself, not its first button, whose tooltip would open with it.
    if (open && isPanelElement(panelNode) && !panelNode.contains(doc?.activeElement)) panelNode.focus({ preventScroll: true });
    const lost = doc?.activeElement === undefined || doc.activeElement === null || doc.activeElement === doc.body;
    if (!open && wasOpen.current && isFocusTarget(hostNode) && lost) hostNode.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open, focused, conversationOpen]);

  useEffect(() => {
    if (!web || conversationOpen) return;
    const doc = (globalThis as { document?: KeyDocument }).document;
    if (doc === undefined || typeof doc.addEventListener !== "function") return;
    const keys = doc;
    function onKey(event: DeckKeyEvent): void {
      // Closing a sibling drawer can reattach this listener before that same Escape bubbles here.
      if (event.defaultPrevented) return;
      if (!focusableRef.current) return;
      const current = focusedRef.current;
      const action = deckKeyAction(event.key, { focused: current !== null, onCanvas: keys.activeElement === host.current });
      if (action === null) return;
      if (action === "trap") {
        const panelNode: unknown = panel.current;
        if (!isPanelElement(panelNode)) return;
        const stops = panelStops(panelNode);
        if (stops.length === 0) return;
        const at = stops.findIndex((stop) => stop === keys.activeElement);
        const last = stops.length - 1;
        const next = at === -1 ? (event.shiftKey ? last : 0) : (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
        event.preventDefault();
        stops[next]?.focus({ preventScroll: true });
        return;
      }
      event.preventDefault();
      if (action === "close") {
        setFocused(null);
        return;
      }
      const order = sceneRef.current.sailors.map((sailor) => sailor.key);
      if (action === "open") {
        const last = lastFocused.current;
        const key = last !== null && order.includes(last) ? last : (order[0] ?? null);
        if (!openDecisionFor(key)) setFocused(key);
        return;
      }
      setFocused(stepFocus(order, current ?? lastFocused.current, action === "next" ? 1 : -1));
    }
    keys.addEventListener("keydown", onKey);
    return () => keys.removeEventListener("keydown", onKey);
  }, [web, conversationOpen]);

  // Wait for the carrier's live anchor before taking focus, including keyboard opening.
  useEffect(() => {
    if (popover === null || !web) return;
    const node: unknown = suggestionPanel.current;
    if (isFocusTarget(node)) node.focus({ preventScroll: true });
  }, [popover, hover?.action, mateAnchor !== null, web]);
  useEffect(() => {
    if (decisionsOpen && (status.kind !== "drawing" || (indicatorState(scene.decisions?.snapshot).count ?? 0) === 0)) setPopover(null);
  }, [decisionsOpen, status.kind, scene.decisions?.snapshot]);
  useEffect(() => {
    if (popover === null || !web) return;
    const doc = (globalThis as { document?: {
      addEventListener(type: string, listener: (event: { key?: string; target?: unknown; preventDefault(): void }) => void): void;
      removeEventListener(type: string, listener: (event: { key?: string; target?: unknown; preventDefault(): void }) => void): void;
    } }).document;
    const close = (event: { key?: string; target?: unknown; preventDefault(): void }) => {
      if (event.key !== undefined && event.key !== "Escape") return;
      if (event.key === undefined && [suggestionPanel.current, popover === "decisions" ? decisionTrigger.current : suggestionTrigger.current, host.current].some(node => isPanelElement(node) && node.contains(event.target))) return;
      if (event.key === "Escape") {
        event.preventDefault();
        const trigger: unknown = popover === "decisions" ? decisionTrigger.current ?? host.current : suggestionTrigger.current;
        if (isFocusTarget(trigger)) trigger.focus({ preventScroll: true });
      }
      setPopover(null);
    };
    doc?.addEventListener("keydown", close);
    doc?.addEventListener("pointerdown", close);
    return () => { doc?.removeEventListener("keydown", close); doc?.removeEventListener("pointerdown", close); };
  }, [popover, web]);

  useEffect(() => { if (status.kind === "failed") onFailure?.(); }, [status.kind, onFailure]);

  const presentation = status.kind === "drawing" ? status.presentation ?? LOADING_DECK : LOADING_DECK;
  const { copy, places } = presentation;
  const { colors } = theme;
  const decisionSnapshot = scene.decisions?.snapshot;
  const decisionStale = decisionSnapshot?.freshness.status === "stale";
  const legendStates = needsYou === undefined ? DECK_STATES : (["waiting", "working", "idle"] as const);
  const crew = scene.sailors.length;
  const hidden = scene.hidden?.workers ? hiddenWorkersText(scene.hidden.workers, scene.hidden.hosts) : null;
  const lost = scene.stale === 0 ? "" : decisionStale ? ", decisions from the last good read" : stale ? ", feed lost: last known" : `, ${scene.stale} out of reach: last known`;
  const words = (state: (typeof DECK_STATES)[number]) => needsYou === undefined ? state : places[state] || state;
  const decisionRead = useDecisionReadState();
  const decisionLabel = deckDecisionLabel(needsYou, stale, true, decisionRead);
  const hasDecisionRead = needsYou !== undefined || decisionRead.pending || decisionRead.fetching || decisionRead.error || decisionRead.readiness !== undefined;
  const total = hasDecisionRead ? `${decisionLabel}. ` : "";
  const summary = `${total}${legendStates.map((state) => `${scene.counts[state]} ${words(state)}`).join(", ")}${lost}${hidden === null ? "" : `. ${hidden}`}`;
  const note = deckStatusText(status, presentation);
  const hovered = hover === null || status.kind !== "drawing" || open || popover !== null
    ? null : (scene.sailors.find(sailor => sailor.key === hover.key) ?? null);
  const layout = focusLayout(size);
  const focusedReplies = open && focused !== null ? replies.get(focused) : undefined;
  const reply = (picked: Suggestion) => onReply?.(picked);

  return (
    <View style={{ flex: 1, minHeight: 0, padding: 12, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, ...(captionActions ? { flexWrap: "wrap" as const } : {}) }}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{copy.title}</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {status.kind === "drawing"
            ? `Drawn with ${status.renderer === "webgl" ? "WebGL" : status.renderer} · ${crew} ${copy.aboard}`
            : ""}
        </Text>
        {captionActions ? <View style={{ marginLeft: "auto" }}>{captionActions}</View> : null}
      </View>
      {hidden === null ? null : (
        <View testID="firstmate-deck-hidden-workers" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 4 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{hidden} ·</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Show workers on disconnected hosts for this session"
            onPress={onShowDisconnected} style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.foreground, fontSize: 12, textDecorationLine: "underline" }}>Show</Text>
          </Pressable>
        </View>
      )}
      {scene.stale === 0 || decisionStale ? null : (
        <Text style={{ color: colors.statusWarning, fontSize: 12 }}>
          {stale
            ? "The crew's feed is lost: the deck shows where everyone last stood, greyed."
            : `${scene.stale === 1 ? `One ${copy.actor.one}'s host is` : `${scene.stale} ${copy.actor.many}' hosts are`} out of reach: greyed where last seen.`}
        </Text>
      )}
      <View
        style={{
          flex: 1,
          minHeight: 160,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface1,
          overflow: "hidden",
        }}
      >
        {web ? (
          <View
            ref={host}
            accessibilityRole="image"
            accessibilityLabel={`${copy.title}: ${summary}${focusable && crew > 0 ? `. Arrow keys focus a ${copy.actor.one}.` : ""}`}
            focusable={focusable && status.kind === "drawing" && crew > 0}
            onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
            style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
          />
        ) : null}
        {status.kind !== "drawing" || open || mateAnchor === null || decisionSnapshot === undefined ? null : (
          <DecisionCountBubble snapshot={decisionSnapshot} anchor={mateAnchor} theme={theme} holdRef={decisionTrigger}
            open={decisionsOpen} disabled={onOpenDecision === undefined} onPress={() => openDecisionFor(FIRST_MATE_KEY)} />
        )}
        {!decisionsOpen || status.kind !== "drawing" || mateAnchor === null || decisionSnapshot === undefined ? null : (
          <NeedsYouBubbles snapshot={decisionSnapshot} theme={theme} holdRef={suggestionPanel}
            place={bubblePlacement({ ...mateAnchor, top: mateAnchor.top - 38 }, bubbleRegion(size, false), { focused: false })}
            onClose={() => {
              setPopover(null);
              const trigger: unknown = decisionTrigger.current ?? host.current;
              if (isFocusTarget(trigger)) trigger.focus({ preventScroll: true });
            }}
            onOpen={destination => { setPopover(null); onOpenDecision?.(destination); }} />
        )}
        {!open || focusedCard === null || renderFocus === undefined ? null : (
          <View
            ref={panel}
            role="dialog"
            tabIndex={-1}
            aria-label={`${focusedCard.title}: details and actions`}
            testID="firstmate-deck-focus"
            style={{ position: "absolute", ...layout.panel }}
          >
            <ScrollView style={{ maxHeight: layout.panel.maxHeight }}>
              {focused === null || !scene.decisions?.byCard.has(focused) ? null : (
                <Pressable accessibilityRole="button" onPress={() => openDecisionFor(focused)} style={{ padding: 12, backgroundColor: colors.surface1 }}>
                  <Text style={{ color: colors.statusWarning, fontSize: 13 }}>{`Your call: ${scene.decisions.byCard.get(focused)!.source.ask}`}</Text>
                  <Text style={{ color: colors.foreground, fontSize: 13, textDecorationLine: "underline" }}>Answer the first mate</Text>
                </Pressable>
              )}
              {renderFocus(
                focusedCard,
                () => setFocused(null),
                focusedReplies === undefined ? null : (
                  <ReplyOptions replies={focusedReplies} theme={theme} blocked={replyBlocked} onReply={reply} />
                ),
              )}
            </ScrollView>
          </View>
        )}
        {!suggestionsOpen || status.kind !== "drawing" || hover?.action !== "attention" ? null : (
          <SuggestionBubbles suggestions={suggestions}
            place={bubblePlacement(hover, bubbleRegion(size, false), { focused: false })}
            theme={theme} blocked={onReply === undefined ? "There is no first mate aboard to send it to." : replyBlocked}
            onReply={reply} onRemove={onRemove} holdRef={suggestionPanel} onClose={() => {
              setPopover(null);
              const trigger: unknown = suggestionTrigger.current;
              if (isFocusTarget(trigger)) trigger.focus({ preventScroll: true });
            }} />
        )}
        {hovered === null || hover === null ? null : (
          <SailorLabel sailor={hovered} hover={hover} theme={theme} colour={scene.palette.states[hovered.state]} />
        )}
        {note === null ? null : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 13, textAlign: "center" }}>{note}</Text>
          </View>
        )}
      </View>
      <View style={{ gap: 4 }}>
        {hasDecisionRead ? <View testID="firstmate-deck-decision-legend" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingVertical: 4 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{decisionLabel} ·</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={needsYou?.actionCount ? "Answer the next" : "Open decisions"} onPress={() => onOpenDecision?.(deckDecisionDestination(needsYou, "next"))} disabled={onOpenDecision === undefined}
            style={{ paddingVertical: 6, minHeight: 44, minWidth: 44, justifyContent: "center" }}>
            <Text style={{ color: colors.foreground, fontSize: 12 }}>{needsYou?.actionCount ? "Answer the next" : "Open decisions"}</Text>
          </Pressable>
        </View> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4 }}>
          {legendStates.map((state) => (
            <View
              key={state}
              {...webAttributes({ title: places[state] })}
              accessibilityHint={places[state]}
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <DeckBadge state={state} colour={scene.palette.states[state]} />
              <Text style={{ color: colors.foreground, fontSize: 12 }}>{`${scene.counts[state]} ${words(state)}`}</Text>
            </View>
          ))}
          {scene.stale === 0 || decisionStale ? null : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: colors.foregroundMuted }} />
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{`${scene.stale} stale`}</Text>
            </View>
          )}
        </View>
        {status.kind !== "drawing" ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            {carrierMode ? (
              <Pressable ref={suggestionTrigger} accessibilityRole="button" accessibilityLabel="Shark suggestions"
                accessibilityState={{ expanded: suggestionsOpen }}
                onPress={() => { setFocused(null); setPopover(now => now === "suggestions" ? null : "suggestions"); }} style={{ paddingVertical: 6 }}>
                <Text style={{ color: colors.foreground, textDecorationLine: "underline", fontSize: 14 }}>
                  {"Suggestions (" + suggestions.length + ")"}
                </Text>
              </Pressable>
            ) : null}
            {crew === 0 ? null : <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
              {focusable
                ? "Point at a " + copy.actor.one + " to see who it is; click one to focus it and act on it."
                : "Point at a " + copy.actor.one + " to see who it is and what it is on."}
            </Text>}
          </View>
        )}
      </View>
    </View>
  );
}
