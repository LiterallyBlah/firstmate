/**
 * The ship deck: the crew as sailors on hull C's deck, drawn from the generated art by PixiJS on a WebGL
 * canvas in the right-hand pane. Behind `FIRSTMATE_SHIP_DECK` (`server/ship-deck.ts`), off by default;
 * the screen offers it only while the fleet load says the switch is on, and only in the desktop app's
 * wide layout.
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
 * at rest — in a label laid over the canvas (`SailorLabel`, placed by `client/deck-hover.ts`). Every
 * action stays on the Crew board. The legend below says what each badge means and where on deck that
 * state stands, with the counts in words, for a screen reader and for a deck that cannot draw.
 *
 * The canvas lives in a childless `View` (`client/deck-mount.ts` explains the escape hatch). A renderer
 * that cannot draw — native, no WebGL, Pixi failing to start — gets a plain message in its place.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";

import type { FleetCard } from "../shared/fleet";
import { loadDeckArt, loadDeckEngine } from "../shared/ship-deck";
import { badgeInk, badgePixels, BADGE_SIZE } from "./deck-badges";
import { labelPlacement, type DeckHover } from "./deck-hover";
import { browserDeckEngine, mountDeck, type DeckEngine, type DeckMount, type DeckStatus } from "./deck-mount";
import { DECK_STATES, deckScene, type DeckSailor, type DeckState } from "./deck-scene";

/** Where each state stands on deck, for the legend. */
export const DECK_PLACES: Record<DeckState, string> = {
  working: "hauling amidships",
  waiting: "by the helm",
  blocked: "in the bow",
  idle: "at the rail",
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
}: {
  cards: readonly FleetCard[];
  theme: PluginTheme;
  /** The fleet load is failing: the deck shows the last crew it saw, greyed. */
  stale?: boolean;
  /** Stood in for by the tests; the browser's WebGL, and Pixi and the art from the daemon, otherwise. */
  engine?: DeckEngine;
  os?: string;
}) {
  const scene = useMemo(() => deckScene(cards, theme, { feedStale: stale }), [cards, theme, stale]);
  // One engine for the view's life, so a new `useRpc` function on a re-render never restarts the canvas.
  const loadEngine = useRpc(loadDeckEngine);
  const loadArt = useRpc(loadDeckArt);
  const loadRef = useRef({ loadEngine, loadArt });
  loadRef.current = { loadEngine, loadArt };
  const [browser] = useState(() =>
    browserDeckEngine(
      () => loadRef.current.loadEngine({}),
      () => loadRef.current.loadArt({}),
    ),
  );
  const used = engine ?? browser;
  const web = os === "web";
  const [status, setStatus] = useState<DeckStatus>(
    web ? { kind: "starting" } : { kind: "unsupported", reason: "native" },
  );
  const host = useRef<View>(null);
  const [hover, setHover] = useState<DeckHover | null>(null);
  const mount = useRef<DeckMount | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  useEffect(() => {
    if (!web) return;
    const started = mountDeck(host.current, sceneRef.current, used, setStatus, setHover);
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

  const { colors } = theme;
  const crew = scene.sailors.length;
  const lost = scene.stale === 0 ? "" : stale ? ", feed lost: last known" : `, ${scene.stale} out of reach: last known`;
  const summary = `${DECK_STATES.map((state) => `${scene.counts[state]} ${state}`).join(", ")}${lost}`;
  const note = deckStatusText(status);
  const hovered = hover === null || status.kind !== "drawing" ? null : (scene.sailors.find((sailor) => sailor.key === hover.key) ?? null);

  return (
    <View style={{ flex: 1, minHeight: 0, padding: 12, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>Ship deck</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {status.kind === "drawing"
            ? `Preview · drawn with ${status.renderer === "webgl" ? "WebGL" : status.renderer} · ${crew} on deck`
            : "Preview"}
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
            accessibilityLabel={`Ship deck: ${summary}`}
            style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
          />
        ) : null}
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
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Point at a sailor to see who it is and what it is on.</Text>
      ) : null}
    </View>
  );
}
