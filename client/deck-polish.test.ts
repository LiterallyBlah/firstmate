/**
 * The deck's polish: it follows a resize smoothly, a sailor under the pointer is found and labelled, and
 * every state wears a badge. The labels' words are in `ship-deck.test.ts`, with the view.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import { DeckArtManifestSchema } from "../shared/ship-deck";
import { BADGE_GLYPHS, BADGE_SIZE, badgeInk, badgePixels, dozeAt, DOZE_PERIOD_MS, DOZE_RISE_MS, INK_DARK, INK_LIGHT } from "./deck-badges";
import { applyCrew, createCrew, crewFigures, type Figure } from "./deck-crew";
import { walkable } from "./deck-geometry";
import { figureBox, hoverChanged, hoverOf, labelPlacement, LABEL_GAP, LABEL_MARGIN, LABEL_ROOM, REST_LABEL_ROW, sailorAt, toCanvas, toDeck, type DeckHover } from "./deck-hover";
import { fitDeck } from "./deck-pixi";
import { DECK_HEIGHT, DECK_STATES, DECK_WIDTH, type DeckSailor, type DeckState } from "./deck-scene";

const manifest = DeckArtManifestSchema.parse(JSON.parse(readFileSync(new URL("../art/ship-deck/deck.json", import.meta.url), "utf8")));
const deck = { width: DECK_WIDTH, height: DECK_HEIGHT };

describe("resizing the pane", () => {
  const resolutions = [1, 1.25, 1.5, 2, 3];

  it("scales the ship smoothly at every width: it never shrinks as the pane widens, and never jumps", () => {
    for (const resolution of resolutions) {
      let previous: number | null = null;
      for (let width = 200; width <= 2400; width += 1) {
        const { scale } = fitDeck({ width, height: 900 }, deck, resolution);
        if (previous !== null) {
          expect(scale, `${width} px at ${resolution}×`).toBeGreaterThanOrEqual(previous);
          // One CSS pixel more of pane is never more than a fraction of a pixel more of ship.
          expect((scale - previous) * DECK_WIDTH, `${width} px at ${resolution}×`).toBeLessThan(1);
        }
        previous = scale;
      }
    }
  });

  it("fills the same share of the pane at any width", () => {
    for (const resolution of resolutions) {
      for (const width of [320, 480, 665, 666, 750, 999, 1000, 1064, 1065, 1440, 2200]) {
        const { scale, x } = fitDeck({ width, height: 2000 }, deck, resolution);
        expect((DECK_WIDTH * scale) / width, `${width} px at ${resolution}×`).toBeCloseTo(0.96, 5);
        // Centred, to a device pixel.
        expect(Math.abs(x - (width - DECK_WIDTH * scale) / 2)).toBeLessThanOrEqual(0.5 / resolution + 1e-9);
      }
    }
  });

  it("no longer drops a third of the ship's size a pixel past each whole-device-pixel step", () => {
    // The old fit held 1.5 CSS px an art pixel from 666 to 1000 px of pane at 2×, then 1.0 at 665.
    const wide = fitDeck({ width: 666, height: 900 }, deck, 2).scale;
    const narrow = fitDeck({ width: 665, height: 900 }, deck, 2).scale;
    expect(narrow / wide).toBeGreaterThan(0.99);
    // And at 125 %, from 2.4 at 1065 px to 1.6 at 1064 px.
    expect(fitDeck({ width: 1064, height: 900 }, deck, 1.25).scale / fitDeck({ width: 1065, height: 900 }, deck, 1.25).scale).toBeGreaterThan(0.99);
  });

  it("follows a short pane by its height, just as smoothly", () => {
    let previous = fitDeck({ width: 4000, height: 79 }, deck, 2).scale;
    for (let height = 80; height <= 900; height += 1) {
      const { scale } = fitDeck({ width: 4000, height }, deck, 2);
      expect(scale).toBeGreaterThanOrEqual(previous);
      expect((scale - previous) * DECK_HEIGHT).toBeLessThan(1.01);
      previous = scale;
    }
  });
});

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

function figure(key: string, x: number, row: number, overrides: Partial<Figure> = {}): Figure {
  return { key, label: key, state: "idle", stale: false, look: "base", outfit: "base", x, y: row, row, pose: "leaning", flip: false, reveal: 1, moving: false, seed: 0, sink: 0, ...overrides };
}

describe("the sailor under the pointer", () => {
  it("is found by the box its sprite is drawn in, its badge over its head included", () => {
    const one = figure("a", 150, 100);
    const box = figureBox(one, manifest)!;
    const standing = manifest.crew.base.leaning;
    expect(box.bottom).toBe(100 - standing.feet[1] + standing.frame[3]);
    expect(box.top).toBe(100 - standing.feet[1] - 1 - BADGE_SIZE.height);
    expect(sailorAt([one], manifest, { x: 150, y: 95 })?.key).toBe("a");
    // The badge over its head counts.
    expect(sailorAt([one], manifest, { x: 150, y: box.top + 1 })?.key).toBe("a");
    expect(sailorAt([one], manifest, { x: 150, y: box.top - 1 })).toBeNull();
    expect(sailorAt([one], manifest, { x: box.right + 1, y: 95 })).toBeNull();
  });

  it("mirrors with the sprite", () => {
    const right = figureBox(figure("a", 150, 100, { pose: "hauling" }), manifest)!;
    const left = figureBox(figure("a", 150, 100, { pose: "hauling", flip: true }), manifest)!;
    const [, , width] = manifest.crew.base.hauling.frame;
    const feet = manifest.crew.base.hauling.feet[0];
    expect(Math.min(right.left, 146)).toBe(Math.min(150 - feet, 146));
    expect(Math.max(left.right, 154)).toBe(Math.max(150 - (width - feet) + width, 154));
  });

  it("is the frontmost of two that overlap: the one standing further forward", () => {
    const back = figure("back", 150, 99);
    const front = figure("front", 152, 101);
    expect(sailorAt([front, back], manifest, { x: 151, y: 92 })?.key).toBe("front");
    expect(sailorAt([back, front], manifest, { x: 151, y: 92 })?.key).toBe("front");
  });

  it("is never one still under the hatch, and on the ladder only by what shows of it", () => {
    expect(figureBox(figure("a", 140, 104, { reveal: 0 }), manifest)).toBeNull();
    const half = figureBox(figure("a", 140, 104, { reveal: 0.5 }), manifest)!;
    expect(half.bottom).toBe(104);
    expect(half.bottom - half.top).toBe(Math.round(manifest.crew.base.leaning.frame[3] * 0.5));
  });

  it("is found through the same fit and bob the frame was drawn with, both ways", () => {
    const fit = fitDeck({ width: 777, height: 500 }, deck, 1.25);
    const bob = { x: 0, y: -1 };
    const point = { x: 123, y: 98 };
    const back = toDeck(toCanvas(point, fit, bob), fit, bob);
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
    const one = figure("a", 123, 98);
    const hover = hoverOf(one, manifest, fit, bob, { width: 777, height: 500 });
    expect(hover).toMatchObject({ key: "a", width: 777, height: 500 });
    expect(hover.x).toBeCloseTo(fit.x + (123 + bob.x) * fit.scale);
    expect(hover.bottom).toBeCloseTo(fit.y + (98 + bob.y) * fit.scale);
    expect(hover.top).toBeLessThan(hover.bottom);
    // A pointer anywhere on the sailor on screen finds it.
    expect(sailorAt([one], manifest, toDeck({ x: hover.x, y: (hover.top + hover.bottom) / 2 }, fit, bob))?.key).toBe("a");
  });

  it("finds every sailor of a crew as the deck places it, by pointing at its middle", () => {
    const crew = createCrew();
    const states: DeckState[] = ["working", "working", "waiting", "waiting", "blocked", "blocked", "idle", "idle"];
    applyCrew(crew, states.map((state, index) => sailor(`s${index}`, state)), { snap: true });
    const figures = crewFigures(crew, 0, { still: true });
    for (const one of figures) {
      const box = figureBox(one, manifest)!;
      const hit = sailorAt(figures, manifest, { x: one.x, y: (box.top + box.bottom) / 2 });
      expect(hit, one.key).not.toBeNull();
      // Neighbours may overlap; the one found is one standing at least as far forward.
      expect(hit!.row, one.key).toBeGreaterThanOrEqual(one.row);
    }
  });

  it("is reported again only when it changes, or moves by more than idle motion", () => {
    const at: DeckHover = { key: "a", x: 100, top: 50, bottom: 90, width: 600, height: 300, floor: null };
    expect(hoverChanged(null, null)).toBe(false);
    expect(hoverChanged(null, at)).toBe(true);
    expect(hoverChanged(at, null)).toBe(true);
    expect(hoverChanged(at, { ...at, x: 101.5, top: 51 })).toBe(false);
    expect(hoverChanged(at, { ...at, x: 103 })).toBe(true);
    expect(hoverChanged(at, { ...at, key: "b" })).toBe(true);
    expect(hoverChanged(at, { ...at, width: 601 })).toBe(true);
    // A sailor that wakes, or nods off, under the pointer moves its label.
    expect(hoverChanged(at, { ...at, floor: 280 })).toBe(true);
    expect(hoverChanged({ ...at, floor: 280 }, { ...at, floor: 281.5 })).toBe(false);
    expect(hoverChanged({ ...at, floor: 280 }, { ...at, floor: 283 })).toBe(true);
  });

  it("gives a sleeper a floor under the near rail to hang its label from, and the crew at work none", () => {
    const fit = fitDeck({ width: 1200, height: 900 }, deck, 1);
    const bob = { x: 0, y: 1 };
    const canvas = { width: 1200, height: 900 };
    const asleep = hoverOf(figure("a", 132, 117, { pose: "side-idle" }), manifest, fit, bob, canvas);
    expect(asleep.floor).toBeCloseTo(toCanvas({ x: 132, y: REST_LABEL_ROW }, fit, bob).y);
    expect(asleep.floor!).toBeGreaterThan(asleep.bottom);
    expect(hoverOf(figure("w", 194, 106, { state: "working", pose: "hauling" }), manifest, fit, bob, canvas).floor).toBeNull();
  });

  it("hangs a sleeper's label under every sailor on deck: no sailor stands, or is drawn, that low", () => {
    for (let y = REST_LABEL_ROW - 2; y < DECK_HEIGHT; y += 1) {
      for (let x = 0; x < DECK_WIDTH; x += 1) expect(walkable(x, y), `${x},${y}`).toBe(false);
    }
    const crew = createCrew();
    const states: DeckState[] = ["working", "waiting", "blocked"];
    applyCrew(
      crew,
      [...states.flatMap((state) => Array.from({ length: 8 }, (_, index) => sailor(`${state}${index}`, state))), ...Array.from({ length: 20 }, (_, index) => sailor(`i${index}`, "idle"))],
      { snap: true },
    );
    for (const one of crewFigures(crew, 0, { still: false })) expect(figureBox(one, manifest)!.bottom, one.key).toBeLessThanOrEqual(REST_LABEL_ROW);
  });
});

describe("where the label goes", () => {
  it("above the sailor with room, else below its feet, and always inside the canvas", () => {
    expect(labelPlacement({ key: "a", x: 300, top: 200, bottom: 260, width: 640, height: 300, floor: null })).toEqual({ left: 170, width: 260, bottom: 106 });
    expect(labelPlacement({ key: "a", x: 300, top: 60, bottom: 120, width: 640, height: 300, floor: null })).toEqual({ left: 170, width: 260, top: 126 });
    // At the edges, held inside.
    expect(labelPlacement({ key: "a", x: 5, top: 200, bottom: 260, width: 640, height: 300, floor: null }).left).toBe(LABEL_MARGIN);
    expect(labelPlacement({ key: "a", x: 635, top: 200, bottom: 260, width: 640, height: 300, floor: null }).left).toBe(640 - 260 - LABEL_MARGIN);
    // A narrow canvas narrows the label.
    expect(labelPlacement({ key: "a", x: 100, top: 200, bottom: 260, width: 200, height: 300, floor: null })).toMatchObject({ left: LABEL_MARGIN, width: 200 - LABEL_MARGIN * 2 });
  });

  it("for a sleeper, under the near rail when there is room, over nobody; else where any label goes", () => {
    const asleep: DeckHover = { key: "a", x: 300, top: 200, bottom: 260, width: 640, height: 500, floor: 280 };
    expect(labelPlacement(asleep)).toEqual({ left: 170, width: 260, top: 280 + LABEL_GAP });
    // Held inside the canvas across, at either edge.
    expect(labelPlacement({ ...asleep, x: 5 }).left).toBe(LABEL_MARGIN);
    expect(labelPlacement({ ...asleep, x: 635 }).left).toBe(640 - 260 - LABEL_MARGIN);
    // A short canvas, with no room under the rail: above the sailor, as for any.
    expect(labelPlacement({ ...asleep, height: 300 })).toEqual({ left: 170, width: 260, bottom: 106 });
    expect(labelPlacement({ ...asleep, height: 280 + LABEL_GAP + LABEL_MARGIN + LABEL_ROOM })).toMatchObject({ top: 280 + LABEL_GAP });
    expect(labelPlacement({ ...asleep, height: 280 + LABEL_GAP + LABEL_MARGIN + LABEL_ROOM - 1 })).toMatchObject({ bottom: expect.any(Number) });
  });
});

describe("each state's badge", () => {
  it("is a different 5 × 5 glyph for every state", () => {
    const shapes = DECK_STATES.map((state) => BADGE_GLYPHS[state].join("/"));
    expect(new Set(shapes).size).toBe(DECK_STATES.length);
    for (const state of DECK_STATES) {
      expect(BADGE_GLYPHS[state]).toHaveLength(5);
      for (const row of BADGE_GLYPHS[state]) expect(row).toMatch(/^[#.]{5}$/);
    }
  });

  it("stays inside its sign, ink over the sign, with a tail pointing at the head", () => {
    for (const state of DECK_STATES) {
      const pixels = badgePixels(state);
      for (const pixel of pixels) {
        expect(pixel.x).toBeGreaterThanOrEqual(0);
        expect(pixel.x).toBeLessThan(BADGE_SIZE.width);
        expect(pixel.y).toBeGreaterThanOrEqual(0);
        expect(pixel.y).toBeLessThan(BADGE_SIZE.height);
      }
      const sign = new Set(pixels.filter((p) => p.kind === "sign").map((p) => `${p.x},${p.y}`));
      for (const ink of pixels.filter((p) => p.kind === "ink")) expect(sign.has(`${ink.x},${ink.y}`), state).toBe(true);
      expect(sign.has("3,7")).toBe(true);
      expect(sign.has("0,0")).toBe(false);
    }
  });

  it("inks dark on a light sign and light on a dark one, in both themes' colours", () => {
    expect(badgeInk("#6cb17b")).toBe(INK_DARK);
    expect(badgeInk("#A1A5A4")).toBe(INK_DARK);
    expect(badgeInk("#d8847b")).toBe(INK_DARK);
    expect(badgeInk("#1f6f3a")).toBe(INK_LIGHT);
    expect(badgeInk("#5a5f5e")).toBe(INK_LIGHT);
    expect(badgeInk("not a colour")).toBe(INK_DARK);
  });

  it("lets an idle sailor doze: a z that rises and fades, then a pause, out of step per sailor", () => {
    const first = dozeAt(0, 0)!;
    expect(first).toEqual({ dx: 0, dy: -0, alpha: 1 });
    const late = dozeAt(0, DOZE_RISE_MS - 1)!;
    expect(late.dy).toBe(-6);
    expect(late.alpha).toBeLessThan(0.05);
    expect(dozeAt(0, DOZE_RISE_MS + 10)).toBeNull();
    expect(dozeAt(0, DOZE_PERIOD_MS)).toEqual(first);
    expect(dozeAt(7, 0)).not.toEqual(dozeAt(0, 0));
  });
});

describe("the figures the renderer draws", () => {
  it("carry each sailor's seed, so idle sailors doze out of step", () => {
    const crew = createCrew();
    applyCrew(crew, [sailor("a", "idle"), sailor("b", "idle")], { snap: true });
    const seeds = crewFigures(crew, 0, { still: true }).map((one) => one.seed);
    expect(seeds[0]).not.toBe(seeds[1]);
  });
});

describe("with the switch off", () => {
  it("adds no class syntax to the client bundle a phone parses whole", () => {
    // Hermes refuses `class` with its default flags (AGENTS.md); these modules are in the bundle even off.
    for (const file of ["./deck-badges.ts", "./deck-hover.ts", "./ship-deck.tsx", "./deck-scene.ts", "./deck-pixi.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/(^|[^\w.])class\s+[A-Za-z_$]/m);
    }
  });
});
