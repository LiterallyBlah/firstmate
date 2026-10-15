/**
 * The ship's wake drawn in code, where the pack's generated one (`art/settings/ship/water/`, its `wake` element) did
 * not load, until step 5c of the migration retires it: disturbed water, so the ship reads as moving through the sea and not sitting on it. Pure —
 * `wakeRuns` says which pixels are foam; `client/deck-environment.ts` draws them in front of the near sea,
 * under the waterline's foam strip, with a plain sea or the generated one.
 *
 * The ship sails left, bow first, so the water streams past it to the right. Three parts, seen from a
 * little above and to the side:
 *
 * - **The churn astern** — a band of broken water from the stern's waterline aft, thickest at the hull
 *   and thinning and spreading towards the viewer as it trails away.
 * - **Two arms** — the near arms of the bow wave and the stern wave, dashed lines angling down and aft
 *   from where each meets the water, fading with distance.
 *
 * **The shape stays with the ship; the foam moves with the water.** Every pixel's place in the pattern
 * is its column less the sea's scroll, so the dashes and flecks slide aft at the sea's own speed through
 * a wake whose outline never moves. Whole pixels throughout, drawn in two foam tones from the
 * environment's palette, and merged into runs along each row so a frame is a few hundred rectangles at most.
 */
import { hashUnit } from "./deck-ambient";

/** The hull's waterline, in deck rows: the ship pack's sea's front band, the code wake's own until step 5c retires it. */
export const WATERLINE = 151;

/** Where the hull meets the water: astern (the stern's foot) and at the bow, in deck pixels. */
export const STERN = { x: 392, y: WATERLINE } as const;
export const BOW = { x: 68, y: WATERLINE } as const;
/** How far aft of the stern the churn runs before it is gone. */
export const CHURN_LENGTH = 150;
/** The arms: where each starts, how steeply it comes towards the viewer, and how far it runs. */
export const WAKE_ARMS = [
  { from: BOW, slope: 0.17, length: 300 },
  { from: STERN, slope: 0.34, length: 190 },
] as const;
/** The two foam tones: broken white water, and the softer foam round it. */
export const WAKE_COLOURS = { crest: 0xd9d4be, foam: 0x8fa8b4 } as const;
/** The wake's scroll on a plain sea, which has no speed of its own: the generated sea's. */
export const WAKE_SPEED = 10;

export type WakeTone = keyof typeof WAKE_COLOURS;

/** A run of foam pixels on one row. */
export interface WakeRun {
  x: number;
  y: number;
  width: number;
  tone: WakeTone;
}

/** A deterministic value 0–1 for a cell of the water's pattern; `lane` keeps the parts' patterns apart. */
function fleck(cell: number, row: number, lane: number): number {
  return hashUnit((((cell * 92821) ^ (row * 68917) ^ (lane * 1299709)) >>> 0) + 1);
}

/**
 * The wake's foam with the sea scrolled `offset` pixels aft, out to `reach` — the right and bottom edges
 * of what the screen shows, in deck pixels — as runs along each row, row by row, left to right. `strength`
 * (the deck's weather, `client/deck-atmosphere.ts`) scales how far the churn and the arms run: 1 is all of it.
 */
export function wakeRuns(offset: number, reach: { right: number; bottom: number }, strength = 1): WakeRun[] {
  const scale = Math.max(0.2, Math.min(1, Number.isFinite(strength) ? strength : 1));
  const churn = Math.round(CHURN_LENGTH * scale);
  const pixels = new Map<number, Map<number, WakeTone>>();
  const put = (x: number, y: number, tone: WakeTone) => {
    if (y > reach.bottom || x > reach.right) return;
    let row = pixels.get(y);
    if (row === undefined) {
      row = new Map();
      pixels.set(y, row);
    }
    // Broken white water wins where the parts overlap.
    if (row.get(x) !== "crest") row.set(x, tone);
  };
  const shift = Math.floor(offset);

  // The churn: from just under the stern's counter aft, spreading down as it goes.
  for (let x = STERN.x - 4; x <= Math.min(reach.right, STERN.x + churn); x += 1) {
    const aft = Math.max(0, x - STERN.x);
    const fade = 1 - aft / churn;
    const bottom = STERN.y + 1 + Math.floor(aft * 0.07);
    const water = x - shift;
    for (let y = STERN.y - 1; y <= bottom; y += 1) {
      // Dashes three pixels long on even rows, two on odd, so the rows do not move as one block.
      const cell = Math.floor(water / (y % 2 === 0 ? 3 : 2));
      const roll = fleck(cell, y, 1);
      const edge = y === bottom || y === STERN.y - 1;
      if (roll < 0.7 * fade * fade * (edge ? 0.5 : 1)) put(x, y, aft < 40 && roll < 0.35 * fade ? "crest" : "foam");
    }
  }

  // The arms: dashed lines angling down and aft, fading as they go.
  WAKE_ARMS.forEach(function (arm, index) {
    const length = Math.round(arm.length * scale);
    for (let x = arm.from.x; x <= Math.min(reach.right, arm.from.x + length); x += 1) {
      const along = x - arm.from.x;
      const fade = 1 - along / length;
      const y = arm.from.y + 1 + Math.round(along * arm.slope);
      const roll = fleck(Math.floor((x - shift) / 4), 0, 2 + index);
      if (roll < 0.85 * fade) put(x, y, roll < 0.45 * fade ? "crest" : "foam");
      if (roll < 0.4 * fade) put(x, y + 1, "foam");
    }
  });

  const runs: WakeRun[] = [];
  for (const y of [...pixels.keys()].sort((a, b) => a - b)) {
    const row = pixels.get(y)!;
    let run: WakeRun | null = null;
    for (const x of [...row.keys()].sort((a, b) => a - b)) {
      const tone = row.get(x)!;
      if (run !== null && run.tone === tone && run.x + run.width === x) run.width += 1;
      else {
        run = { x, y, width: 1, tone };
        runs.push(run);
      }
    }
  }
  return runs;
}
