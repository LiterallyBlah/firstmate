import { expect, it } from "vitest";
import type { Behaviour } from "./deck-ambience";
import { phaseFrameAt } from "./deck-phase-frames";

const hours: Behaviour<"phase-frames"> = {
  kind: "phase-frames", by: "local-hour", at: [90, 40], anchor: [3, 4],
  frames: Array.from({ length: 12 }, (_, i) => ({ image: `dial-${i}` })),
};

it("uses discrete local hours, wrapping at noon and midnight without following elapsed simulation time", () => {
  for (const [minute, index] of [[0, 0], [59.999, 0], [60, 1], [719.999, 11], [720, 0], [1439.999, 11], [1440, 0], [-1, 11], [1500, 1]]) {
    expect(phaseFrameAt(hours, minute!)).toBe(index);
  }
});

it("uses minute of the hour and the authored count, with independent single-frame and 24-hour lists", () => {
  const minutes = { ...hours, by: "local-minute" as const, frames: hours.frames.slice(0, 7) };
  for (const [minute, index] of [[6.999, 6], [7, 0], [59.999, 3], [60, 0], [61, 1], [1439, 3], [-1, 3]]) {
    expect(phaseFrameAt(minutes, minute!)).toBe(index);
  }
  expect(phaseFrameAt({ ...hours, frames: [...hours.frames, ...hours.frames] }, 1380)).toBe(23);
  expect(phaseFrameAt({ ...minutes, frames: [hours.frames[0]!] }, 1439)).toBe(0);
});

it("uses the first frame for unavailable clocks or held motion", () => {
  for (const minute of [null, NaN, Infinity, -Infinity]) expect(phaseFrameAt(hours, minute)).toBe(0);
  expect(phaseFrameAt(hours, 630, false)).toBe(0);
});
