/**
 * The deck's camera closing in on a focused sailor: where the panel goes and the sailor stands, the shot at
 * every step of the zoom, a resize mid-focus, what a click and an arrow key do to the focus, and every sailor
 * — the crew resting off the working deck included — still found by the pointer through the zoomed camera.
 * The camera driving Pixi's scene graph is `deck-environment.test.ts`; the panel is `ship-deck.test.ts`.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import { DeckArtManifestSchema } from "../shared/ship-deck";
import {
  boxMiddle,
  cameraFit,
  easeFocus,
  FOCUS_PANEL_MARGIN,
  FOCUS_PANEL_WIDTH,
  FOCUS_SIDE_MIN,
  FOCUS_ZOOM_MAX,
  FOCUS_ZOOM_MIN,
  focusLayout,
  focusScale,
  nextFocus,
  shotBetween,
  stepFocus,
  visibleWorld,
  WHOLE_DECK,
} from "./deck-camera";
import { applyCrew, createCrew, crewFigures } from "./deck-crew";
import { inRestArea } from "./deck-geometry";
import { figureBox, sailorAt, toCanvas, toDeck } from "./deck-hover";
import { fitDeck } from "./deck-pixi";
import { DECK_HEIGHT, DECK_WIDTH, type DeckSailor, type DeckState } from "./deck-scene";

const manifest = DeckArtManifestSchema.parse(JSON.parse(readFileSync(new URL("../art/ship-deck/deck.json", import.meta.url), "utf8")));
const deck = { width: DECK_WIDTH, height: DECK_HEIGHT };
const still = { x: 0, y: 0 };

function sailor(key: string, state: DeckState): DeckSailor {
  return {
    key,
    label: key,
    state,
    identity: `agent-${key}`,
    stale: false,
    caption: { title: key, status: state, project: null, host: "This machine", line: null, stale: null },
  };
}

describe("where the focus panel goes", () => {
  it("stands beside the sailor on a wide canvas, the sailor in the middle of the room it leaves", () => {
    const layout = focusLayout({ width: 900, height: 500 });
    expect(layout.side).toBe("right");
    expect(layout.panel).toEqual({ left: 900 - FOCUS_PANEL_WIDTH - FOCUS_PANEL_MARGIN, top: FOCUS_PANEL_MARGIN, width: FOCUS_PANEL_WIDTH, maxHeight: 500 - 2 * FOCUS_PANEL_MARGIN });
    expect(layout.anchor.x + layout.room.width / 2).toBeLessThanOrEqual(900 - FOCUS_PANEL_WIDTH - FOCUS_PANEL_MARGIN);
    expect(layout.anchor.y).toBe(250);
  });

  it("docks under the sailor on a narrow canvas, the sailor above it", () => {
    const layout = focusLayout({ width: FOCUS_SIDE_MIN - 1, height: 500 });
    expect(layout.side).toBe("bottom");
    expect(layout.panel).toMatchObject({ left: FOCUS_PANEL_MARGIN, right: FOCUS_PANEL_MARGIN, bottom: FOCUS_PANEL_MARGIN });
    expect(layout.anchor.x).toBe((FOCUS_SIDE_MIN - 1) / 2);
    expect(layout.anchor.y + layout.room.height / 2).toBeLessThanOrEqual(500 - layout.panel.maxHeight - FOCUS_PANEL_MARGIN);
  });
});

describe("the camera's shot", () => {
  const screen = { width: 900, height: 500 };
  const base = fitDeck(screen, deck, 2);
  const layout = focusLayout(screen);
  const point = { x: 60, y: 90 };

  it("is the exact fit on the whole deck, wherever it last looked", () => {
    expect(cameraFit(base, WHOLE_DECK, layout, 2)).toEqual(base);
    expect(cameraFit(base, { amount: 0, point: { x: 300, y: 10 } }, layout, 2)).toEqual(base);
  });

  it("closes in on the sailor: enlarged within the zoom's bounds, at the layout's anchor", () => {
    const fit = cameraFit(base, { amount: 1, point }, layout, 2);
    expect(fit.scale).toBe(focusScale(base, layout));
    expect(fit.scale).toBeGreaterThanOrEqual(base.scale * FOCUS_ZOOM_MIN);
    expect(fit.scale).toBeLessThanOrEqual(base.scale * FOCUS_ZOOM_MAX);
    const at = toCanvas(point, fit, still);
    expect(Math.abs(at.x - layout.anchor.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(at.y - layout.anchor.y)).toBeLessThanOrEqual(0.5);
    // Offsets on whole device pixels, as the exact fit's are.
    expect(Number.isInteger(fit.x * 2) && Number.isInteger(fit.y * 2)).toBe(true);
  });

  it("zooms as one move: the scale only grows, and the sailor travels straight to the anchor", () => {
    const from = toCanvas(point, base, still);
    let scale = 0;
    for (let step = 0; step <= 20; step += 1) {
      const fit = cameraFit(base, shotBetween(WHOLE_DECK, { amount: 1, point }, step / 20), layout, 2);
      expect(fit.scale).toBeGreaterThanOrEqual(scale);
      scale = fit.scale;
      const at = toCanvas(point, fit, still);
      // On the line from where the whole deck drew it to the anchor, give or take the device-pixel snap.
      const t = (at.x - from.x) / (layout.anchor.x - from.x);
      expect(Math.abs(from.y + (layout.anchor.y - from.y) * t - at.y)).toBeLessThanOrEqual(1);
    }
  });

  it("eases in and out, starting and settling still", () => {
    expect(easeFocus(0)).toBe(0);
    expect(easeFocus(1)).toBe(1);
    expect(easeFocus(0.5)).toBeCloseTo(0.5);
    expect(easeFocus(0.05)).toBeLessThan(0.05);
    expect(easeFocus(0.95)).toBeGreaterThan(0.95);
    expect(easeFocus(-1)).toBe(0);
    expect(easeFocus(2)).toBe(1);
  });

  it("pulls back out on the sailor it leaves, and pans from one sailor to the next at full zoom", () => {
    const out = shotBetween({ amount: 1, point }, { amount: 0, point: { x: 0, y: 0 } }, 0.5);
    expect(out.point).toEqual(point);
    expect(out.amount).toBeCloseTo(0.5);
    const across = shotBetween({ amount: 1, point }, { amount: 1, point: { x: 260, y: 70 } }, 0.5);
    expect(across.amount).toBe(1);
    expect(across.point.x).toBeCloseTo(160);
    // From mid-zoom out, a change of mind turns back from where the camera is.
    expect(shotBetween({ amount: 0.4, point }, { amount: 1, point }, 0)).toEqual({ amount: 0.4, point });
  });

  it("survives a resize: the focused sailor goes to the new canvas's anchor at the new fit's zoom", () => {
    for (const size of [
      { width: 1400, height: 700 },
      { width: 700, height: 420 },
      { width: 480, height: 600 },
      { width: 333.5, height: 260.25 },
    ]) {
      const resized = fitDeck(size, deck, 1.5);
      const laid = focusLayout(size);
      const fit = cameraFit(resized, { amount: 1, point }, laid, 1.5);
      const at = toCanvas(point, fit, still);
      expect(Math.abs(at.x - laid.anchor.x), JSON.stringify(size)).toBeLessThanOrEqual(1);
      expect(Math.abs(at.y - laid.anchor.y), JSON.stringify(size)).toBeLessThanOrEqual(1);
      expect(fit.scale / resized.scale).toBeGreaterThanOrEqual(FOCUS_ZOOM_MIN - 1e-9);
      expect(fit.scale / resized.scale).toBeLessThanOrEqual(FOCUS_ZOOM_MAX + 1e-9);
    }
  });

  it("knows what part of the world shows, for laying the sea, sky and veil over it", () => {
    const fit = cameraFit(base, { amount: 1, point }, layout, 2);
    const visible = visibleWorld(fit, screen);
    expect(visible.left).toBeLessThan(point.x);
    expect(visible.right).toBeGreaterThan(point.x);
    expect(visible.right - visible.left).toBeCloseTo(screen.width / fit.scale);
    expect(visibleWorld({ scale: 0, x: 0, y: 0 }, screen)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

describe("what a click and the keyboard do to the focus", () => {
  it("focuses the sailor clicked on the whole deck; then keeps it on its own click and lets it go on any other", () => {
    expect(nextFocus(null, "a")).toBe("a");
    expect(nextFocus(null, null)).toBeNull();
    expect(nextFocus("a", "a")).toBe("a");
    expect(nextFocus("a", null)).toBeNull();
    expect(nextFocus("a", "b")).toBeNull();
  });

  it("steps through the crew in the deck's order, round the ends, from the one focused or last focused", () => {
    const keys = ["a", "b", "c"];
    expect(stepFocus(keys, null, 1)).toBe("a");
    expect(stepFocus(keys, null, -1)).toBe("c");
    expect(stepFocus(keys, "a", 1)).toBe("b");
    expect(stepFocus(keys, "c", 1)).toBe("a");
    expect(stepFocus(keys, "a", -1)).toBe("c");
    expect(stepFocus(keys, "gone", 1)).toBe("a");
    expect(stepFocus([], "a", 1)).toBeNull();
  });
});

describe("the sailor under the pointer, through the zoomed camera", () => {
  it("finds every sailor — two dozen resting off the working deck among them — focused on any one, and closes in on its middle", () => {
    const crew = createCrew();
    const states: DeckState[] = [
      "working", "working", "working", "waiting", "waiting", "blocked", "blocked",
      ...Array.from({ length: 24 }, () => "idle" as const),
    ];
    applyCrew(crew, states.map((state, index) => sailor(`s${index}`, state)), { snap: true });
    const figures = crewFigures(crew, 0, { still: true });
    expect(figures.filter((figure) => figure.state === "idle").every((figure) => inRestArea({ x: figure.x, y: figure.row }))).toBe(true);
    const screen = { width: 760, height: 460 };
    const base = fitDeck(screen, deck, 2);
    const layout = focusLayout(screen);
    const bob = { x: 0, y: 1 };
    for (const focused of figures) {
      const point = boxMiddle(figureBox(focused, manifest)!);
      const fit = cameraFit(base, { amount: 1, point }, layout, 2);
      // The focused sailor stands at the anchor: a click there is on it.
      const onIt = sailorAt(figures, manifest, toDeck(toCanvas(point, fit, bob), fit, bob));
      expect(onIt, focused.key).not.toBeNull();
      expect(onIt!.row, focused.key).toBeGreaterThanOrEqual(focused.row);
      // Every sailor on screen is still found by pointing at its middle on the canvas.
      for (const other of figures) {
        const middle = toCanvas(boxMiddle(figureBox(other, manifest)!), fit, bob);
        if (middle.x < 0 || middle.y < 0 || middle.x >= screen.width || middle.y >= screen.height) continue;
        const hit = sailorAt(figures, manifest, toDeck(middle, fit, bob));
        expect(hit, `${focused.key} → ${other.key}`).not.toBeNull();
        expect(hit!.row).toBeGreaterThanOrEqual(other.row);
      }
    }
  });
});
