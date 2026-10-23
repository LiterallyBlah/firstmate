import { expect, it } from "vitest";
import { contrastRatio } from "./contrast";
import { decisionSignalInk } from "./decision-copy";

it("uses WCAG linearized sRGB luminance, including short hex tokens", () => {
  expect(contrastRatio("#000", "#fff")).toBe(21);
  expect(contrastRatio("#ffffff", "#000000")).toBe(21);
  expect(contrastRatio("#777", "#ffffff")).toBeCloseTo(4.478, 3);
  expect(contrastRatio("#272A29", "#272A29")).toBe(1);
});

it.each([
  ["#ffffff", "#1a1a1e", "#7b5d39"],
  ["#181B1A", "#fafafa", "#c09664"],
])("keeps the warning ink above 4.5:1 in the Paseo palette %s", (surface, foreground, warning) => {
  expect(contrastRatio(decisionSignalInk(surface, foreground, warning), warning)).toBeGreaterThanOrEqual(4.5);
});
