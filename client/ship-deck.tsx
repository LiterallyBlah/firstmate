/**
 * The ship deck: the crew as sailors on hull C's deck, drawn from the generated art by PixiJS on a WebGL
 * canvas in the right-hand pane. A standard part of the screen in the desktop app's wide layout
 * (`deckOffered`); a phone or a narrow window is not offered it, and a display without WebGL is told why
 * in words.
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
 * **Attention**: a pack with `attention-carrier@1` replaces per-worker reply markers with one independent
 * target for the selected worker. Blocked workers, pending permissions and linked first-mate suggestions
 * qualify; stale workers never do. The legend selects among them and offers keyboard focus. The carrier
 * focuses that worker in place, just like a sailor click. Packs without it retain the suggestion
 * bubbles (`client/deck-replies.ts`); focused cards still offer their suggestions through `onReply`.
 *
 * The canvas lives in a childless `View` (`client/deck-mount.ts` explains the escape hatch). A renderer
 * that cannot draw — native, no WebGL, Pixi failing to start — gets a plain message in its place.
 */
import type { PluginTheme } from "@getpaseo/plugin";
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
import { DeckAskMarker, ReplyBubble, ReplyOptions } from "./reply-bubble";
import { attentionWorker, needsResponse } from "./deck-attention";
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

/** How long a hovered sailor's bubble stays up once the pointer has left it, for the pointer to reach its chips. */
export const BUBBLE_LINGER_MS = 600;

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
        ? `This display has no WebGL, so ${noun} cannot draw. The Crew board shows everything it would.`
        : `${subject} draws only in the Paseo desktop app. The Crew board shows everything it would.`;
  }
}

/** A changed pack id starts a fresh mount, including focus, hover, pending loads and the engine closure. */
export function ShipDeckView(props: Parameters<typeof DeckView>[0]) {
  return <DeckView key={props.setting ?? DEFAULT_DECK_SETTING} {...props} />;
}

function DeckView({
  cards,
  theme,
  stale = false,
  engine,
  os = Platform.OS,
  renderFocus,
  suggestions = NO_SUGGESTIONS,
  onReply,
  replyBlocked = null,
  setting = DEFAULT_DECK_SETTING,
  onFailure,
}: {
  cards: readonly FleetCard[];
  theme: PluginTheme;
  /**
   * The focused sailor's card, compact, with its actions: the screen hands in the board's own card so the deck
   * acts through the same handlers. `close` pulls the camera back out. `replies` is the sailor's replies for the
   * captain to pick, or null, for the card to show under its glance. Without it, a click focuses no one.
   */
  renderFocus?: (card: FleetCard, close: () => void, replies: ReactNode) => ReactNode;
  /** The first mate's suggestions, as the board's strip has them: those that name a crewmate hang over its sailor. */
  suggestions?: readonly Suggestion[];
  /** Sends a reply the way the strip sends a suggestion. Without it, the deck offers no replies. */
  onReply?: (reply: Suggestion) => void;
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
}) {
  const answered = useSyncExternalStore(answeredReplies.subscribe, answeredReplies.version);
  const [carrierMode, setCarrierMode] = useState(false);
  const usesCarrier = carrierMode && renderFocus !== undefined;
  const [selectedAttention, setSelectedAttention] = useState<string | null>(null);
  const offers = onReply !== undefined;
  // `answered` is the store's version: a pick, or a send that failed, changes what is still waiting.
  const replies = useMemo(
    () => (offers ? repliesByCard(cards, suggestions, answeredReplies.has) : new Map<string, Suggestion[]>()),
    [cards, suggestions, offers, answered],
  );
  // A reply the file has dropped is forgotten, so one that comes back later is offered again.
  useEffect(() => answeredReplies.keepOnly(suggestions), [suggestions]);
  const asking = useMemo(() => new Set([...replies.keys(), ...(usesCarrier ? cards.filter(needsResponse).map(card => card.key) : [])]), [replies, usesCarrier, cards]);
  const scene = useMemo(() => ({ ...deckScene(cards, theme, { feedStale: stale, asking }), attentionKey: selectedAttention }), [cards, theme, stale, asking, selectedAttention]);
  const attentionKey = attentionWorker(scene, selectedAttention);
  const attentionKeys = scene.sailors.filter(sailor => sailor.asks).map(sailor => sailor.key).sort();
  const attentionSailor = scene.sailors.find(sailor => sailor.key === attentionKey);
  const stepAttention = (delta: number) => {
    if (attentionKey === null || attentionKeys.length === 0) return;
    setSelectedAttention(attentionKeys[(attentionKeys.indexOf(attentionKey) + attentionKeys.length + delta) % attentionKeys.length]!);
  };
  // Once selected, a new earlier-sorting request must not silently change the shark's worker.
  useEffect(() => { if (usesCarrier) setSelectedAttention(attentionKey); }, [attentionKey, usesCarrier]);
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
  const bubble = useRef<View>(null);
  const [hover, setHover] = useState<DeckHover | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** The sailor the camera is closed in on, by card key. */
  const [focused, setFocused] = useState<string | null>(null);
  const focusable = renderFocus !== undefined;
  const mount = useRef<DeckMount | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const focusableRef = useRef(focusable);
  focusableRef.current = focusable;
  const focusAttention = (key: string) => {
    if (focusableRef.current && sceneRef.current.sailors.some(sailor => sailor.key === key && sailor.asks && !sailor.stale)) setFocused(key);
  };
  /** The sailor focused last, so the arrows go on from it after Esc. */
  const lastFocused = useRef<string | null>(null);

  useEffect(() => {
    if (!web) return;
    const started = mountDeck(host.current, sceneRef.current, used, (next) => {
      setStatus(next);
      setCarrierMode(next.kind === "drawing" && next.presentation?.attentionCarrier === true);
    }, setHover, (key, action) => {
      if (action === "attention") { if (key !== null) focusAttention(key); return; }
      if (focusableRef.current) setFocused((now) => nextFocus(now, key));
    });
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

  /** The sailors with replies waiting, live: those wearing the marker. */
  const speakers = useMemo(() => new Set(scene.sailors.filter((sailor) => sailor.asks === true).map((sailor) => sailor.key)), [scene]);

  /**
   * The hovered sailor whose bubble is up, and where it was: kept `BUBBLE_LINGER_MS` after the pointer leaves the
   * sailor, and as long as it is over the bubble, so it can cross to the chips. Another sailor under the pointer
   * takes it down at once, for its own label; so does focusing one, whose bubble follows the camera instead.
   */
  const [held, setHeld] = useState<DeckHover | null>(null);
  const overBubble = useRef(false);
  const linger = useRef<ReturnType<typeof setTimeout> | null>(null);
  function stopLinger(): void {
    if (linger.current === null) return;
    clearTimeout(linger.current);
    linger.current = null;
  }
  function letGo(): void {
    stopLinger();
    linger.current = setTimeout(() => {
      linger.current = null;
      if (!overBubble.current) setHeld(null);
    }, BUBBLE_LINGER_MS);
  }
  useEffect(() => {
    if (open) {
      stopLinger();
      overBubble.current = false;
      setHeld(null);
    } else if (hover !== null && speakers.has(hover.key)) {
      stopLinger();
      setHeld(hover);
    } else if (hover !== null) {
      stopLinger();
      overBubble.current = false;
      setHeld(null);
    } else letGo();
  }, [hover, open, speakers]);
  // Answered while the pointer was on it, the bubble goes without a pointer leave: let go of it for good.
  useEffect(() => {
    if (held === null || speakers.has(held.key)) return;
    stopLinger();
    overBubble.current = false;
    setHeld(null);
  }, [held, speakers]);
  useEffect(() => stopLinger, []);

  // Opened, the panel takes the keyboard; closed, the deck has it back, unless it went somewhere else meanwhile.
  const wasOpen = useRef(false);
  useEffect(() => {
    const doc = (globalThis as { document?: KeyDocument }).document;
    const panelNode: unknown = panel.current;
    const hostNode: unknown = host.current;
    // The panel itself, not its first button, whose tooltip would open with it.
    if (open && isPanelElement(panelNode) && !panelNode.contains(doc?.activeElement)) panelNode.focus({ preventScroll: true });
    const lost = doc?.activeElement === undefined || doc.activeElement === null || doc.activeElement === doc.body;
    if (!open && wasOpen.current && isFocusTarget(hostNode) && lost) hostNode.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open, focused]);

  useEffect(() => {
    if (!web) return;
    const doc = (globalThis as { document?: KeyDocument }).document;
    if (doc === undefined || typeof doc.addEventListener !== "function") return;
    const keys = doc;
    function onKey(event: DeckKeyEvent): void {
      if (!focusableRef.current) return;
      const current = focusedRef.current;
      const action = deckKeyAction(event.key, { focused: current !== null, onCanvas: keys.activeElement === host.current });
      if (action === null) return;
      if (action === "trap") {
        const panelNode: unknown = panel.current;
        if (!isPanelElement(panelNode)) return;
        // The focused sailor's bubble, when it speaks, and its panel: its chips first, then the card.
        const bubbleNode: unknown = bubble.current;
        const stops = [...(isPanelElement(bubbleNode) ? panelStops(bubbleNode) : []), ...panelStops(panelNode)];
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
        setFocused(last !== null && order.includes(last) ? last : (order[0] ?? null));
        return;
      }
      setFocused(stepFocus(order, current ?? lastFocused.current, action === "next" ? 1 : -1));
    }
    keys.addEventListener("keydown", onKey);
    return () => keys.removeEventListener("keydown", onKey);
  }, [web]);

  useEffect(() => { if (status.kind === "failed") onFailure?.(); }, [status.kind, onFailure]);

  const presentation = status.kind === "drawing" ? status.presentation ?? LOADING_DECK : LOADING_DECK;
  const { copy, places } = presentation;
  const { colors } = theme;
  const crew = scene.sailors.length;
  const lost = scene.stale === 0 ? "" : stale ? ", feed lost: last known" : `, ${scene.stale} out of reach: last known`;
  const asked = speakers.size === 0 ? "" : usesCarrier ? `, ${speakers.size} need your response; use Focus below` : `, ${speakers.size} with ${speakers.size === 1 ? "a reply" : "replies"} for you to pick`;
  const summary = `${DECK_STATES.map((state) => `${scene.counts[state]} ${state}`).join(", ")}${asked}${lost}`;
  const note = deckStatusText(status, presentation);
  // A sailor with replies waiting speaks in its bubble instead of wearing the label.
  const hovered =
    hover === null || status.kind !== "drawing" || open || (!usesCarrier && speakers.has(hover.key))
      ? null
      : (scene.sailors.find((sailor) => sailor.key === hover.key) ?? null);
  const layout = focusLayout(size);
  // While focused, the canvas reports where the focused sailor stands, and only while it has replies waiting.
  const speaking = status.kind !== "drawing" || usesCarrier ? null : open ? (hover !== null && hover.key === focused ? hover : null) : held;
  const speaker = speaking === null || !speakers.has(speaking.key) ? null : (scene.sailors.find((sailor) => sailor.key === speaking.key) ?? null);
  const speakerReplies = speaker === null ? undefined : replies.get(speaker.key);
  const focusedReplies = open && focused !== null && speakers.has(focused) ? replies.get(focused) : undefined;
  const reply = (picked: Suggestion) => onReply?.(picked);

  return (
    <View style={{ flex: 1, minHeight: 0, padding: 12, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{copy.title}</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {status.kind === "drawing"
            ? `Drawn with ${status.renderer === "webgl" ? "WebGL" : status.renderer} · ${crew} ${copy.aboard}`
            : ""}
        </Text>
      </View>
      {scene.stale === 0 ? null : (
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
        {speaking === null || speaker === null || speakerReplies === undefined ? null : (
          <ReplyBubble
            sailor={speaker}
            replies={speakerReplies}
            place={bubblePlacement(speaking, bubbleRegion({ width: speaking.width, height: speaking.height }, open), { focused: open })}
            theme={theme}
            blocked={replyBlocked}
            onReply={reply}
            holdRef={bubble}
            onHover={(over) => {
              overBubble.current = over;
              if (over) stopLinger();
              else if (!open) letGo();
            }}
          />
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
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4 }}>
          {DECK_STATES.map((state) => (
            <View
              key={state}
              {...webAttributes({ title: places[state] })}
              accessibilityHint={places[state]}
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <DeckBadge state={state} colour={scene.palette.states[state]} />
              <Text style={{ color: colors.foreground, fontSize: 12 }}>{`${scene.counts[state]} ${state}`}</Text>
            </View>
          ))}
          {speakers.size === 0 || usesCarrier ? null : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <DeckAskMarker accent={scene.palette.ask} />
              <Text
                style={{ color: colors.foreground, fontSize: 12 }}
              >{`${speakers.size} with ${speakers.size === 1 ? "a reply" : "replies"} for you`}</Text>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>point at one to pick</Text>
            </View>
          )}
          {scene.stale === 0 ? null : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: colors.foregroundMuted }} />
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{`${scene.stale} stale`}</Text>
            </View>
          )}
        </View>
        {status.kind === "drawing" && crew > 0 ? (
          !usesCarrier || attentionSailor === undefined ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
              {focusable
                ? `Point at a ${copy.actor.one} to see who it is; click one to focus it and act on it.`
                : `Point at a ${copy.actor.one} to see who it is and what it is on.`}
            </Text>
          ) : (
            <View
              testID="firstmate-deck-attention"
              style={{ flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}
            >
              <DeckAskMarker accent={scene.palette.ask} />
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{`${speakers.size} need your response`}</Text>
              {attentionKeys.length < 2 ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous worker needing a response"
                  onPress={() => stepAttention(-1)}
                  style={{ padding: 6 }}
                >
                  <Text style={{ color: colors.foreground }}>‹</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Focus on ${attentionSailor.caption.title}`}
                onPress={() => focusAttention(attentionSailor.key)}
                style={{ flexShrink: 1, minWidth: 0, paddingVertical: 4 }}
              >
                <Text
                  numberOfLines={1}
                  style={{ color: colors.foreground, textDecorationLine: "underline", fontSize: 12 }}
                >{`Converse · ${attentionSailor.caption.title}`}</Text>
              </Pressable>
              {attentionKeys.length < 2 ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next worker needing a response"
                  onPress={() => stepAttention(1)}
                  style={{ padding: 6 }}
                >
                  <Text style={{ color: colors.foreground }}>›</Text>
                </Pressable>
              )}
            </View>
          )
        ) : null}
      </View>
    </View>
  );
}
