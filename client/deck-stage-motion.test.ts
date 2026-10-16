import { describe, expect, it } from "vitest";
import { stageMotionAt, stageToWorld, worldToStage, rockedBounds } from "./deck-stage-motion";
import { toCanvas, toDeck } from "./deck-hover";
import { SettingManifestSchema, capabilitiesUsed, settingProblems, type SettingManifest } from "../shared/deck-setting";
import { shipManifest } from "../test/ship-pack";

const weather = { clocks: { roll: 2 }, channels: { angle: 2, drift: 1 }, intensity: 1 };
const rock = { pivot: [200, 100] as [number, number], degrees: { channel: "angle" }, drift: { channel: "drift" }, periodS: 8, clock: "roll" };
const pack = () => {
  const m = structuredClone(shipManifest());
  m.stage.motion = { rock: { pivot: [200, 100], degrees: { curve: [[0, 0.4], [1, 2]] }, periodS: 8 } };
  m.requires = capabilitiesUsed(m);
  return m;
};

describe("stage-rock@1", () => {
  it("accepts rock alone, discovers its capability, and keeps old packs unchanged", () => {
    expect(SettingManifestSchema.safeParse(pack()).success).toBe(true);
    expect(pack().requires).toContain("stage-rock@1");
    expect(pack().requires).not.toContain("bob@1");
    expect(stageMotionAt(undefined, 2, weather, true)).toEqual({ x: 0, y: 0 });
    expect(stageMotionAt({ bob: { periodS: 8, amplitude: 3, clock: "roll" } }, 0, weather, true)).toEqual({ x: 0, y: 3 });
  });
  it("uses the atmosphere clock and channels, keeps the pivot fixed apart from drift/bob, and holds still level", () => {
    const motion = { rock, bob: { periodS: 8, amplitude: 3, clock: "roll" } };
    const t = stageMotionAt(motion, 999, weather, true);
    expect(t.rotation).toBeCloseTo(2 * Math.PI / 180);
    const p = stageToWorld({ x: 200, y: 100 }, t);
    expect(p.x).toBeCloseTo(201); expect(p.y).toBeCloseTo(103);
    expect(stageMotionAt(motion, 999, weather, false)).toEqual({ x: 0, y: 0 });
    expect(stageMotionAt({ rock: { ...rock, clock: undefined } }, 2, weather, true)).toEqual(stageMotionAt({ rock }, 999, weather, true));
    expect(stageMotionAt({ rock: pack().stage.motion!.rock! }, 2, { ...weather, intensity: 0 }, true).rotation).toBeCloseTo(0.4 * Math.PI / 180);
  });
  it("inverts screen points through resize, zoom, both roll directions and drift", () => {
    for (const scale of [0.5, 1.3, 5]) for (const seconds of [0, 2, 5, 6]) {
      const t = stageMotionAt({ rock: { ...rock, clock: undefined } }, seconds, weather, true);
      const fit = { x: -145, y: 87, scale }, p = { x: 321.7, y: -25 };
      const back = toDeck(toCanvas(p, fit, t), fit, t);
      expect(back.x).toBeCloseTo(p.x, 10); expect(back.y).toBeCloseTo(p.y, 10);
      expect(worldToStage(stageToWorld(p, t), t).y).toBeCloseTo(p.y, 10);
    }
  });
  it("bounds intermediate angle extrema, not just endpoints", () => {
    const b = rockedBounds({ left: 100, right: 100, top: 1, bottom: 1 }, [0, 0], 5, 2, 3);
    expect(b.right).toBeCloseTo(Math.hypot(100, 1) + 2);
    for (let i = -500; i <= 500; i++) {
      const p = stageToWorld({ x: 100, y: 1 }, { x: 2, y: 3, rotation: i / 100 * Math.PI / 180 });
      expect(p.x).toBeLessThanOrEqual(b.right + 1e-10); expect(p.y).toBeLessThanOrEqual(b.bottom + 1e-10);
    }
  });
  it("rejects unknown fields, nonfinite values, missing references, unbounded amplitudes and invalid pivots", () => {
    const changes: Array<(m: SettingManifest) => void> = [
      m => { Reflect.set(m.stage.motion!.rock!, "expression", "sin(t)"); },
      m => { m.stage.motion!.rock!.periodS = 0; },
      m => { m.stage.motion!.rock!.periodS = Infinity; },
      m => { m.stage.motion!.rock!.degrees = NaN; },
      m => { m.stage.motion!.rock!.degrees = -1; },
      m => { m.stage.motion!.rock!.degrees = 6; },
      m => { m.stage.motion!.rock!.degrees = { curve: [[0, 0], [1, 6]] }; },
      m => { m.stage.motion!.rock!.degrees = { channel: "heave", scale: 100 }; },
      m => { m.stage.motion!.rock!.drift = 17; },
      m => { m.stage.motion!.rock!.pivot = [-1, 0]; },
      m => { m.stage.motion!.rock!.pivot = [0, Infinity]; },
      m => { m.stage.motion!.rock!.clock = "absent"; },
      m => { m.stage.motion!.rock!.degrees = { channel: "absent" }; },
      m => { m.stage.motion = {}; },
    ];
    for (const change of changes) { const m = pack(); change(m); expect(SettingManifestSchema.safeParse(m).success).toBe(false); }
    const m = pack(); m.stage.motion!.rock!.degrees = 6;
    expect(settingProblems(m)).toContain("stage.motion.rock.degrees must stay between 0 and 5");
  });
});
