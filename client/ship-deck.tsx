/**
 * The ship deck: the crew as sailors on one deck, drawn by PixiJS on a WebGL canvas in the right-hand
 * pane. Behind `FIRSTMATE_SHIP_DECK` (`server/ship-deck.ts`), off by default; the screen offers it only
 * while the fleet load says the switch is on, and only in the desktop app's wide layout.
 *
 * It draws from the cards the board already has — `FleetSurface` passes them in from the shared fleet
 * query — so it polls nothing of its own. The canvas makes the crew legible at a glance; names, tasks and
 * every action stay on the Crew board. The counts below it say the same in words, for a screen reader
 * and for a deck that cannot draw.
 *
 * The canvas lives in a childless `View` (`client/deck-mount.ts` explains the escape hatch). A renderer
 * that cannot draw — native, no WebGL, Pixi failing to start — gets a plain message in its place.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";

import type { FleetCard } from "../shared/fleet";
import { loadDeckEngine } from "../shared/ship-deck";
import { browserDeckEngine, mountDeck, type DeckEngine, type DeckMount, type DeckStatus } from "./deck-mount";
import { DECK_STATES, deckScene } from "./deck-scene";

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
  engine,
  os = Platform.OS,
}: {
  cards: readonly FleetCard[];
  theme: PluginTheme;
  /** Stood in for by the tests; the browser's WebGL, and Pixi from the daemon, otherwise. */
  engine?: DeckEngine;
  os?: string;
}) {
  const scene = useMemo(() => deckScene(cards, theme), [cards, theme]);
  // One engine for the view's life, so a new `useRpc` function on a re-render never restarts the canvas.
  const loadEngine = useRpc(loadDeckEngine);
  const loadRef = useRef(loadEngine);
  loadRef.current = loadEngine;
  const [browser] = useState(() => browserDeckEngine(() => loadRef.current({})));
  const used = engine ?? browser;
  const web = os === "web";
  const [status, setStatus] = useState<DeckStatus>(
    web ? { kind: "starting" } : { kind: "unsupported", reason: "native" },
  );
  const host = useRef<View>(null);
  const mount = useRef<DeckMount | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  useEffect(() => {
    if (!web) return;
    const started = mountDeck(host.current, sceneRef.current, used, setStatus);
    mount.current = started;
    return () => {
      mount.current = null;
      started.destroy();
    };
  }, [web, used]);

  useEffect(() => {
    mount.current?.update(scene);
  }, [scene]);

  const { colors } = theme;
  const crew = scene.sailors.length;
  const summary = DECK_STATES.map((state) => `${scene.counts[state]} ${state}`).join(", ");
  const note = deckStatusText(status);

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
        {note === null ? null : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 13, textAlign: "center" }}>{note}</Text>
          </View>
        )}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {DECK_STATES.map((state) => (
          <View key={state} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: scene.palette.states[state] }} />
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
              {`${scene.counts[state]} ${state}`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
