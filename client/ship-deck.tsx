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
 * The canvas lives in a childless `View` (`client/deck-mount.ts` explains the escape hatch). A renderer
 * that cannot draw — native, no WebGL, Pixi failing to start — gets a plain message in its place.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, ScrollView, Text, View } from "react-native";

import type { FleetCard } from "../shared/fleet";
import { loadDeckArt, loadDeckEngine, loadDeckEnvironment, loadDeckExtras } from "../shared/ship-deck";
import { badgeInk, badgePixels, BADGE_SIZE } from "./deck-badges";
import { focusLayout, nextFocus, stepFocus } from "./deck-camera";
import { labelPlacement, type DeckHover } from "./deck-hover";
import { browserDeckEngine, mountDeck, type DeckEngine, type DeckMount, type DeckStatus } from "./deck-mount";
import { DECK_STATES, deckScene, type DeckSailor, type DeckState } from "./deck-scene";

/** Where each state stands on deck, for the legend. */
export const DECK_PLACES: Record<DeckState, string> = {
  working: "hauling amidships",
  waiting: "by the helm",
  blocked: "in the bow",
  idle: "resting off watch",
};

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

/** What the pane says where the canvas would be, or null while it draws. */
export function deckStatusText(status: DeckStatus): string | null {
  switch (status.kind) {
    case "drawing":
      return null;
    case "starting":
      return "Raising the deck…";
    case "failed":
      return `The ship deck could not start: ${status.message}`;
    case "unsupported":
      return status.reason === "no-webgl"
        ? "This display has no WebGL, so the ship deck cannot draw. The Crew board shows everything it would."
        : "The ship deck draws only in the Paseo desktop app. The Crew board shows everything it would.";
  }
}

export function ShipDeckView({
  cards,
  theme,
  stale = false,
  engine,
  os = Platform.OS,
  renderFocus,
}: {
  cards: readonly FleetCard[];
  theme: PluginTheme;
  /**
   * The focused sailor's card, compact, with its actions: the screen hands in the board's own card so the deck
   * acts through the same handlers. `close` pulls the camera back out. Without it, a click focuses no one.
   */
  renderFocus?: (card: FleetCard, close: () => void) => ReactNode;
  /** The fleet load is failing: the deck shows the last crew it saw, greyed. */
  stale?: boolean;
  /** Stood in for by the tests; the browser's WebGL, and Pixi, the art, the environment and the extras from the daemon, otherwise. */
  engine?: DeckEngine;
  os?: string;
}) {
  const scene = useMemo(() => deckScene(cards, theme, { feedStale: stale }), [cards, theme, stale]);
  // One engine for the view's life, so a new `useRpc` function on a re-render never restarts the canvas.
  const loadEngine = useRpc(loadDeckEngine);
  const loadArt = useRpc(loadDeckArt);
  const loadEnvironment = useRpc(loadDeckEnvironment);
  const loadExtras = useRpc(loadDeckExtras);
  const loadRef = useRef({ loadEngine, loadArt, loadEnvironment, loadExtras });
  loadRef.current = { loadEngine, loadArt, loadEnvironment, loadExtras };
  const [browser] = useState(() =>
    browserDeckEngine(
      () => loadRef.current.loadEngine({}),
      () => loadRef.current.loadArt({}),
      () => loadRef.current.loadEnvironment({}),
      () => loadRef.current.loadExtras({}),
    ),
  );
  const used = engine ?? browser;
  const web = os === "web";
  const [status, setStatus] = useState<DeckStatus>(
    web ? { kind: "starting" } : { kind: "unsupported", reason: "native" },
  );
  const host = useRef<View>(null);
  const panel = useRef<View>(null);
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
  /** The sailor focused last, so the arrows go on from it after Esc. */
  const lastFocused = useRef<string | null>(null);

  useEffect(() => {
    if (!web) return;
    const started = mountDeck(host.current, sceneRef.current, used, setStatus, setHover, (key) => {
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
        const stops = panelStops(panelNode);
        const at = stops.findIndex((stop) => stop === keys.activeElement);
        const last = stops.length - 1;
        const wrap = at === -1 ? (event.shiftKey ? last : 0) : event.shiftKey && at === 0 ? last : !event.shiftKey && at === last ? 0 : null;
        if (wrap === null) return;
        event.preventDefault();
        stops[wrap]?.focus({ preventScroll: true });
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

  const { colors } = theme;
  const crew = scene.sailors.length;
  const lost = scene.stale === 0 ? "" : stale ? ", feed lost: last known" : `, ${scene.stale} out of reach: last known`;
  const summary = `${DECK_STATES.map((state) => `${scene.counts[state]} ${state}`).join(", ")}${lost}`;
  const note = deckStatusText(status);
  const hovered =
    hover === null || status.kind !== "drawing" || open ? null : (scene.sailors.find((sailor) => sailor.key === hover.key) ?? null);
  const layout = focusLayout(size);

  return (
    <View style={{ flex: 1, minHeight: 0, padding: 12, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>Ship deck</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {status.kind === "drawing"
            ? `Drawn with ${status.renderer === "webgl" ? "WebGL" : status.renderer} · ${crew} on deck`
            : ""}
        </Text>
      </View>
      {scene.stale === 0 ? null : (
        <Text style={{ color: colors.statusWarning, fontSize: 12 }}>
          {stale
            ? "The crew's feed is lost: the deck shows where everyone last stood, greyed."
            : `${scene.stale === 1 ? "One sailor's host is" : `${scene.stale} sailors' hosts are`} out of reach: greyed where last seen.`}
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
            accessibilityLabel={`Ship deck: ${summary}${focusable && crew > 0 ? ". Arrow keys focus a sailor." : ""}`}
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
            <ScrollView style={{ maxHeight: layout.panel.maxHeight }}>{renderFocus(focusedCard, () => setFocused(null))}</ScrollView>
          </View>
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {DECK_STATES.map((state) => (
          <View key={state} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <DeckBadge state={state} colour={scene.palette.states[state]} />
            <Text style={{ color: colors.foreground, fontSize: 12 }}>{`${scene.counts[state]} ${state}`}</Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{DECK_PLACES[state]}</Text>
          </View>
        ))}
        {scene.stale === 0 ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: colors.foregroundMuted }} />
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{`${scene.stale} stale`}</Text>
          </View>
        )}
      </View>
      {status.kind === "drawing" && crew > 0 ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {focusable
            ? "Point at a sailor to see who it is; click one to focus it and act on it."
            : "Point at a sailor to see who it is and what it is on."}
        </Text>
      ) : null}
    </View>
  );
}
