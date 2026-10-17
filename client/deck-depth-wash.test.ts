import { describe, expect, it } from "vitest";
import { depthWashAlpha, depthWashAt, type DepthWash } from "./deck-depth-wash";

const wash: DepthWash = { rows: [448, 1250], byPhase: {
  midday: { colour: "#36696B", alpha: [.34, .14] },
  night: { colour: "#173B44", alpha: [.12, .02] },
} };
const phases = [{ id: "midday", localMinute: 720 }, { id: "night", localMinute: 1260 }];

describe("tiled surface depth colour", () => {
  it("follows the eased day blend, including still decks", () => {
    expect(depthWashAt(wash, phases, { from: 0, to: 1, t: 0, night: 0 })).toEqual({ colour: 0x36696b, top: .34, bottom: .14 });
    expect(depthWashAt(wash, phases, { from: 0, to: 1, t: 1, night: 1 })).toEqual({ colour: 0x173b44, top: .12, bottom: .02 });
    const middle = depthWashAt(wash, phases, { from: 0, to: 1, t: .5, night: .5 });
    expect(middle.colour).toBe(0x275258);
    expect(middle.top).toBeCloseTo(.23);
    expect(middle.bottom).toBeCloseTo(.08);
  });

  it("darkens smoothly in world depth without restarting at tile boundaries", () => {
    const alpha = (y: number) => depthWashAlpha(y, wash.rows, .34, .14);
    expect(alpha(265)).toBe(.34);
    expect(alpha(448)).toBe(.34);
    expect(alpha(1250)).toBeCloseTo(.14);
    expect(alpha(4000)).toBeCloseTo(.14);
    for (let y = 449; y <= 1600; y++) {
      expect(alpha(y)).toBeLessThanOrEqual(alpha(y - 1));
      expect(Math.abs(alpha(y) - alpha(y - 1))).toBeLessThan(.0004);
    }
    expect(alpha(265 + 512)).toBeGreaterThan(alpha(265 + 1024));
  });
});
