import { describe, expect, it } from "vitest";
import {
  clampShare,
  HANDLE_WIDTH,
  keyboardShare,
  MIN_CHAT_WIDTH,
  MIN_CREW_WIDTH,
  MIN_SPLIT_WIDTH,
  shareLimits,
} from "./resize-layout";

describe("chat split constraints", () => {
  it.each([638, 640, 768, 800, 1024, 1280, 1600])(
    "keeps both panes useful at %i points",
    (width) => {
      const small = clampShare(0.2, width),
        large = clampShare(0.8, width);
      expect(Math.round(small * width)).toBeGreaterThanOrEqual(MIN_CHAT_WIDTH);
      expect(
        width - Math.round(large * width) - HANDLE_WIDTH,
      ).toBeGreaterThanOrEqual(MIN_CREW_WIDTH);
      expect(small).toBeGreaterThanOrEqual(0.2);
      expect(large).toBeLessThanOrEqual(0.8);
    },
  );
  it("has one feasible split at the compact boundary", () => {
    const limits = shareLimits(MIN_SPLIT_WIDTH);
    expect(limits.min).toBe(limits.max);
    expect(clampShare(0.36, MIN_SPLIT_WIDTH) * MIN_SPLIT_WIDTH).toBeCloseTo(
      MIN_CHAT_WIDTH,
    );
  });
  it("preserves a preference when only the viewport narrows", () => {
    const saved = 0.7;
    expect(clampShare(saved, 800)).toBeLessThan(saved);
    expect(clampShare(saved, 1600)).toBe(saved);
  });
  it("adjusts with arrows, accelerated arrows and useful endpoints", () => {
    expect(keyboardShare("ArrowRight", 0.5, 800)).toBe(0.52);
    expect(keyboardShare("ArrowLeft", 0.5, 800, true)).toBe(0.44);
    expect(keyboardShare("Home", 0.5, 800)).toBe(shareLimits(800).min);
    expect(keyboardShare("End", 0.5, 800)).toBe(shareLimits(800).max);
    expect(keyboardShare("ArrowLeft", 0.4, 800)).toBe(0.4);
    expect(keyboardShare("Enter", 0.5, 800)).toBeNull();
    expect(keyboardShare("ArrowRight", 0.5, 0)).toBeNull();
  });
});
