/** Walking entries on arbitrary geometry, using existing frame metadata only; no new art. */
import { describe, expect, it } from "vitest";
import { SettingManifestSchema, capabilitiesUsed, type SettingManifest } from "../shared/deck-setting";
import { walkingEntryProblems } from "../test/deck-entry";
import { shipManifest } from "../test/ship-pack";
import { compileStage } from "./deck-stage";
import { compileCast } from "./deck-cast";
import { applyCrew, createCrew, crewFigures, portalEffects, stepCrew, stepDepartures } from "./deck-crew";
import type { DeckSailor } from "./deck-scene";

type WalkIn = Extract<SettingManifest["portals"]["entry"], { kind: "walk-in" }>;
const sailor = (key = "a", state: DeckSailor["state"] = "working"): DeckSailor => ({ key, label: key, state, identity: key, stale: false, caption: { title: key, status: state, project: null, host: "local", line: null, stale: null } });
function manifest(): SettingManifest {
  const pack = structuredClone(shipManifest());
  pack.floor = { areas: [{ id: "floor", polygon: [[40, 60], [340, 60], [340, 200], [40, 200]], spill: true }], obstacles: [], grid: { cell: 2, bounds: [40, 60, 300, 140] }, walkSpeed: 20 };
  pack.stage.props = [];
  pack.zones = {
    byState: { working: "working", waiting: "waiting", blocked: "blocked", idle: "idle" },
    zones: (["working", "waiting", "blocked", "idle"] as const).map((id, index) => ({ id, assign: "ordered", posts: [{ id, at: [100 + Math.floor(index / 2) * 60, 100 + index % 2 * 40], facing: "front" }], overflow: { kind: "beside", spacing: [20, 10] } })),
  };
  pack.copy.zones = { working: "Work", waiting: "Wait", blocked: "Help", idle: "Rest" };
  pack.portals = { entry: { kind: "walk-in", from: [20, 100], at: [40, 100] }, exits: { exit: { kind: "sink", at: [100, 100], ms: 800 } }, byDeparture: { done: "exit", failed: "exit", closed: "exit", removed: "exit" }, still: { fadeMs: 250 } };
  pack.effects.panel = { size: [20, 16], points: { anchor: [10, 16] }, frames: { open: { image: pack.stage.backdrop.sprite.image, rect: [0, 0, 20, 16] } } };
  pack.requires = capabilitiesUsed(pack);
  return pack;
}
function entering(pack = manifest()) {
  const crew = createCrew(compileStage(pack), compileCast(pack));
  applyCrew(crew, [], { snap: false });
  applyCrew(crew, [sailor()], { snap: false });
  return crew;
}
function withEffect() {
  const pack = manifest();
  (pack.portals.entry as WalkIn).effects = [{ effect: "panel", order: 3, keys: [{ frame: "open", at: { event: "entered", plusMs: 100 }, ms: 200, place: { mark: "from", alignX: "anchor" } }] }];
  return pack;
}
const figure = (crew: ReturnType<typeof entering>) => crewFigures(crew, 0, { still: false })[0]!;

describe("walk-in@1", () => {
  it("walks from off-floor without a navigation clamp, at floor pace, fully revealed and at its feet's depth", () => {
    const crew = entering();
    expect(crew.stage.entryMs).toBe(1000);
    expect(figure(crew)).toMatchObject({ x: 20, row: 100, moving: true, reveal: 1, layer: "floor" });
    stepCrew(crew, 500);
    expect(figure(crew)).toMatchObject({ x: 30, row: 100, moving: true, reveal: 1, flip: false });
    // Only the remaining 250 ms may be used for the floor path after the entry finishes.
    stepCrew(crew, 750);
    expect(crew.walkers.get("a")).toMatchObject({ phase: "walking", x: 45, y: 100, walkedMs: 1250 });
    stepCrew(crew, 2750);
    expect(crew.walkers.get("a")).toMatchObject({ phase: "settled", x: 100, y: 100 });
  });

  it("keeps the corridor when a state change retargets the floor path mid-entry", () => {
    const crew = entering();
    stepCrew(crew, 500);
    applyCrew(crew, [sailor("a", "waiting")], { snap: false });
    expect(crew.walkers.get("a")).toMatchObject({ x: 30, y: 100, phase: "arriving", phaseMs: 500, target: { x: 100, y: 140 } });
    stepCrew(crew, 500);
    expect(crew.walkers.get("a")).toMatchObject({ x: 40, y: 100, phase: "walking" });
    stepCrew(crew, 5000);
    expect(crew.walkers.get("a")).toMatchObject({ x: 100, y: 140, phase: "settled" });
  });

  it("uses the same elapsed distance across full/lite frame sizes and does not advance on a paused clock", () => {
    for (const frameMs of [16, 40, 1000]) {
      const crew = entering();
      for (let time = 0; time < 1500; time += frameMs) stepCrew(crew, Math.min(frameMs, 1500 - time));
      expect(crew.walkers.get("a")!.x).toBeCloseTo(50, 8);
      expect(crew.walkers.get("a")!.walkedMs).toBe(1500);
      const frozen = figure(crew);
      stepCrew(crew, 0);
      expect(figure(crew)).toEqual(frozen);
    }
  });

  it("reverses and returns mid-corridor without teleporting or cropping, then removes a fully reversed arrival", () => {
    const crew = entering();
    stepCrew(crew, 500);
    applyCrew(crew, [], { snap: false });
    expect(figure(crew)).toMatchObject({ x: 30, reveal: 1, departing: true, flip: true });
    stepCrew(crew, 250);
    expect(figure(crew).x).toBe(25);
    applyCrew(crew, [sailor()], { snap: false });
    expect(figure(crew)).toMatchObject({ x: 25, reveal: 1, departing: false, flip: false });
    stepCrew(crew, 250);
    applyCrew(crew, [], { snap: false });
    stepCrew(crew, 500);
    expect(crew.walkers.size).toBe(0);
    expect(portalEffects(crew)).toEqual([]);
  });

  it("uses front walks for vertical corridors and mirrors leftward walks", () => {
    for (const from of [[60, 100], [40, 80]] as [number, number][]) {
      const pack = manifest();
      (pack.portals.entry as WalkIn).from = from;
      const crew = entering(pack);
      stepCrew(crew, 200);
      expect(crew.walkers.get("a")!.facing).toBe(from[0] === 60 ? "left" : "front");
      expect(figure(crew).flip).toBe(from[0] === 60);
      expect(figure(crew).row).toBe(from[0] === 60 ? 100 : 84);
    }
  });

  it("snaps the first scene and reduced motion to posts; interrupted walking entries fade calmly", () => {
    const pack = withEffect();
    const fresh = createCrew(compileStage(pack), compileCast(pack));
    applyCrew(fresh, [sailor()], { snap: false });
    expect(fresh.walkers.get("a")).toMatchObject({ phase: "settled", x: 100, y: 100 });
    const crew = entering(pack);
    stepCrew(crew, 500);
    applyCrew(crew, [], { snap: true });
    expect(portalEffects(crew)).toEqual([]);
    expect(figure(crew)).toMatchObject({ x: 30, reveal: 1, moving: false, alpha: 1 });
    stepDepartures(crew, 125);
    expect(figure(crew).alpha).toBe(0.5);
    stepDepartures(crew, 125);
    expect(crewFigures(crew, 0, { still: true })).toEqual([]);
    const snap = entering(pack);
    stepCrew(snap, 1150);
    applyCrew(snap, [sailor()], { snap: true });
    expect(snap.walkers.get("a")).toMatchObject({ phase: "settled", x: 100, y: 100 });
    expect(portalEffects(snap)).toEqual([]);
  });

  it("keeps sink exits and their reversals cropped even when entry is a walk", () => {
    const crew = entering();
    stepCrew(crew, 4000);
    applyCrew(crew, [], { snap: false });
    stepCrew(crew, 1);
    stepCrew(crew, 400);
    expect(figure(crew)).toMatchObject({ x: 100, reveal: 0.5 });
    applyCrew(crew, [sailor()], { snap: false });
    expect(figure(crew)).toMatchObject({ x: 100, reveal: 0.5 });
    applyCrew(crew, [], { snap: false });
    expect(figure(crew)).toMatchObject({ x: 100, reveal: 0.5 });
    stepCrew(crew, 200);
    expect(figure(crew)).toMatchObject({ x: 100, reveal: 0.25 });
  });

  it("finishes optional effects before floor walking and reverses the same finite clock", () => {
    const crew = entering(withEffect());
    expect(crew.stage.entryMs).toBe(1300);
    stepCrew(crew, 1150);
    expect(figure(crew)).toMatchObject({ x: 40, moving: false, reveal: 1 });
    const shown = portalEffects(crew);
    expect(shown).toEqual([{ effect: "panel", track: 0, order: 3, frame: "open", x: 20, y: 100, flip: false, key: "entry:a:0" }]);
    applyCrew(crew, [], { snap: false });
    expect(portalEffects(crew)).toEqual(shown);
    stepCrew(crew, 100);
    expect(portalEffects(crew)).toEqual([]);
    expect(figure(crew).x).toBe(40);
    stepCrew(crew, 550);
    expect(figure(crew).x).toBe(30);
    applyCrew(crew, [sailor()], { snap: false });
    stepCrew(crew, 1050);
    expect(crew.walkers.get("a")).toMatchObject({ x: 45, phase: "walking" });
  });

  it("gives concurrent entries separate effect keys", () => {
    const crew = entering(withEffect());
    applyCrew(crew, [sailor(), sailor("b")], { snap: false });
    stepCrew(crew, 1150);
    expect(portalEffects(crew).map(({ key }) => key)).toEqual(["entry:a:0", "entry:b:0"]);
  });

  it("declares the capability and rejects zero-length walks, hooks and unknown effect references", () => {
    expect(SettingManifestSchema.safeParse(withEffect()).success).toBe(true);
    expect(manifest().requires).toContain("walk-in@1");
    const changes: Array<(pack: SettingManifest, entry: WalkIn) => void> = [
      (pack) => { pack.requires = pack.requires.filter((id) => id !== "walk-in@1"); },
      (_, entry) => { entry.at = entry.from; },
      (_, entry) => { Object.assign(entry, { expression: "time * 20" }); },
      (_, entry) => { entry.effects![0]!.effect = "missing"; },
      (_, entry) => { entry.effects![0]!.keys[0]!.frame = "missing"; },
      (_, entry) => { entry.effects![0]!.keys[0]!.at.event = "missing"; },
      (_, entry) => { entry.effects![0]!.keys[0]!.place.mark = "missing"; },
      (_, entry) => { entry.effects![0]!.keys[0]!.place.alignX = "missing"; },
      (_, entry) => { entry.effects![0]!.keys.push(entry.effects![0]!.keys[0]!); },
    ];
    for (const change of changes) {
      const pack = withEffect();
      change(pack, pack.portals.entry as WalkIn);
      expect(SettingManifestSchema.safeParse(pack).success).toBe(false);
    }
  });

  it("lints the off-floor corridor's obstacles, endpoint and whole actor fit", () => {
    expect(walkingEntryProblems(manifest())).toEqual([]);
    const blocked = manifest();
    blocked.floor.obstacles.push({ id: "wall", rect: [24, 99, 2, 2] });
    expect(walkingEntryProblems(blocked)).toContain("entry corridor crosses an obstacle");
    const offFloor = manifest();
    (offFloor.portals.entry as WalkIn).at = [39, 100];
    expect(walkingEntryProblems(offFloor)).toContain("entry.at must be on open floor");
    const clipped = manifest();
    (clipped.portals.entry as WalkIn).from = [0, 100];
    expect(walkingEntryProblems(clipped).some((problem) => problem.includes("clips pose"))).toBe(true);
  });
});
