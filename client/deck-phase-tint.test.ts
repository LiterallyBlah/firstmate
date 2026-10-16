import { describe, expect, it } from "vitest";
import { shipManifest } from "../test/ship-pack";
import { compilePhaseTint, phaseTintAt } from "./deck-phase-tint";

function definition() {
  const pack = structuredClone(shipManifest());
  pack.dayCycle = { phases: [{ id: "open", localMinute: 120 }, { id: "late", localMinute: 720 }, { id: "closed", localMinute: 1260 }], fadeMinutes: 60, night: "closed", fallback: "late" };
  pack.stage.tintByPhase = { late: "#D8C0B0", closed: "#8C94B0" };
  return compilePhaseTint(pack)!;
}

describe("phase-tint@1", () => {
  it("holds authored colours at arbitrary phase anchors and uses white for omitted phases", () => {
    const tint = definition();
    expect(phaseTintAt(tint, 120)).toBe(0xffffff);
    expect(phaseTintAt(tint, 720)).toBe(0xd8c0b0);
    expect(phaseTintAt(tint, 1260)).toBe(0x8c94b0);
    expect(phaseTintAt(tint, 1440)).toBe(0x8c94b0);
  });

  it("blends channels with the day's easing, rounding to RGB bytes, including the midnight wrap", () => {
    const tint = definition();
    expect(phaseTintAt(tint, 1200)).toBe(0xd8c0b0);
    expect(phaseTintAt(tint, 1215)).toBe(0xccb9b0); // smoothstep(1/4) = 0.15625
    expect(phaseTintAt(tint, 1230)).toBe(0xb2aab0);
    expect(phaseTintAt(tint, 90)).toBe(0xc6cad8);
    expect(phaseTintAt(tint, -1350)).toBe(0xc6cad8);
    expect(phaseTintAt(tint, 1530)).toBe(0xc6cad8);
  });

  it("uses the authored fallback when the clock cannot say and leaves untinted packs unchanged", () => {
    const tint = definition();
    for (const minute of [null, Number.NaN, Infinity]) expect(phaseTintAt(tint, minute)).toBe(0xd8c0b0);
    const plain = structuredClone(shipManifest());
    delete plain.stage.tintByPhase;
    expect(compilePhaseTint(plain)).toBeNull();
    for (const minute of [null, 0, 720, 1260]) expect(phaseTintAt(null, minute)).toBe(0xffffff);
  });

  it("holds a single phase and keeps different packs independent", () => {
    const tint = definition();
    const single = { cycle: { phases: [{ id: "only", localMinute: 600 }], fadeMinutes: 90, night: "only", fallback: "only" }, colours: [0x123456] };
    for (const minute of [null, 0, 300, 600, 1200, 1439]) expect(phaseTintAt(single, minute)).toBe(0x123456);
    expect(phaseTintAt(tint, 1260)).toBe(0x8c94b0);
  });
});
