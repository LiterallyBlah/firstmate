/** Engine contracts with arbitrary portal/effect/pose names and reused test frames; no second setting's art. */
import { describe, expect, it } from "vitest";
import { compileChoreography, choreographyAt } from "./deck-choreography";
import { applyCrew, createCrew, crewFigures, departureEffects, exitFree, stepCrew, stepDepartures } from "./deck-crew";
import { compileCast } from "./deck-cast";
import { compileStage } from "./deck-stage";
import { SettingManifestSchema, settingProblems, type SettingManifest } from "../shared/deck-setting";
import { shipCast, shipManifest, shipStage } from "../test/ship-pack";
import type { DeckSailor } from "./deck-scene";

type Definition = Extract<SettingManifest["portals"]["exits"][string], { kind: "choreography" }>;
const effect: SettingManifest["effects"][string] = { size: [20, 16], points: { anchor: [10, 12], target: [14, 5] }, frames: { open: { image: "frame", rect: [5, 8, 20, 16] } } };
const definition = (): Definition => ({
  kind: "choreography", marks: { wait: [10, 20], end: [20, 20] }, queue: { at: "wait", release: "clear", spacing: [6, 3] },
  alternate: { side: [1, -1], drift: [0, 10] },
  actor: [
    { ms: "walk", to: { mark: "end", drift: true }, pose: { cycle: "walkSide" }, layer: { front: "panel" }, layerAt: 0.5, moving: true, event: "clear" },
    { ms: 200, pose: "rest", reveal: [0, { rows: 5 }], layer: "effects", moving: false, event: "gone" },
  ],
  effects: [
    { effect: "doors", mirror: "side", order: 4, keys: [{ frame: "open", at: { event: "clear", plusMs: 0 }, ms: 300, place: { mark: "end", drift: true, alignX: "target" }, approach: { px: 12 } }] },
    { effect: "doors", order: 2, keys: [{ frame: "open", at: { event: "gone", plusMs: 100 }, ms: 100, place: { mark: "wait" } }] },
  ],
});
const cast = {
  ...shipCast(), stand: "rest", walkFront: ["step", "rest"], walkSide: ["step", "rest"], stepMs: 100, rise: 2,
  looks: [{ id: "worker", image: "frame", lane: "figure", optional: false }],
  lanes: new Map([["figure", new Map([["rest", { frame: [0, 0, 10, 20] as const, feet: [5, 19] as const }], ["step", { frame: [0, 0, 10, 20] as const, feet: [5, 19] as const }]])]]),
};
const sailor = (key: string): DeckSailor => ({ key, label: key, state: "working", identity: key, stale: false, caption: { title: key, status: "working", project: null, host: "local", line: null, stale: null } });

describe("finite choreography primitives", () => {
  it("compiles each drift's walking duration and resolves events, layers and cast cycles", () => {
    const compiled = compileChoreography(definition(), 20, { doors: effect });
    expect(compiled.timelines.get(0)!.releaseMs).toBe(500);
    expect(compiled.timelines.get(10)!.releaseMs).toBe(1000);
    const at = (t: number) => choreographyAt(compiled, t, { side: 1, drift: 10, cast, lane: "figure" });
    expect(at(100).actor).toMatchObject({ x: 12, y: 18, pose: "rest", layer: "floor" });
    expect(at(500).actor!.layer).toEqual({ front: "panel" });
    expect(at(1100).actor).toMatchObject({ x: 30, y: 20, pose: "rest", reveal: 3 / 20, layer: "effects" });
    expect(at(1200).actor).toBeNull();
    expect(at(1300).effects).toEqual([{ effect: "doors", track: 1, order: 2, frame: "open", x: 10, y: 20, flip: false }]);
    expect(at(1400)).toEqual({ actor: null, effects: [], done: true });
  });

  it("aligns named points about the anchor, mirrors by side and approaches from either side", () => {
    const compiled = compileChoreography(definition(), 20, { doors: effect });
    const at = (side: -1 | 1, t: number) => choreographyAt(compiled, t, { side, drift: 0, cast, lane: "figure" }).effects[0]!;
    expect(at(1, 500)).toMatchObject({ x: 36, y: 20, flip: true, order: 4 });
    expect(at(-1, 500)).toMatchObject({ x: 4, y: 20, flip: false });
    expect(at(1, 650).x).toBe(30);
    expect(at(-1, 650).x).toBe(10);
  });

  it("mirrors a side walk to the left and uses the selected lane's pose height for row reveal", () => {
    const def = definition();
    def.marks.end = [0, 20];
    const compiled = compileChoreography(def, 20, { doors: effect });
    expect(choreographyAt(compiled, 100, { side: -1, drift: 0, cast, lane: "figure" }).actor!.flip).toBe(true);
    const taller = { ...cast, lanes: new Map([["tall", new Map([["rest", { frame: [0, 0, 10, 40] as const, feet: [5, 39] as const }]])]]) };
    expect(choreographyAt(compiled, 600, { side: -1, drift: 0, cast: taller, lane: "tall" }).actor!.reveal).toBe(3 / 40);
  });
});

describe("portals without ship-specific names", () => {
  it("runs a sink-only pack, using its arrival, departure and fade durations", () => {
    const manifest = structuredClone(shipManifest());
    manifest.portals = { entry: { kind: "rise", at: [140, 104], ms: 300 }, exits: { lift: { kind: "sink", at: [140, 104], ms: 900 } }, byDeparture: { done: "lift", failed: "lift", closed: "lift", removed: "lift" }, still: { fadeMs: 250 } };
    const stage = compileStage(manifest);
    const crew = createCrew(stage, compileCast(manifest));
    applyCrew(crew, [], { snap: false });
    applyCrew(crew, [sailor("a")], { snap: false });
    stepCrew(crew, 150);
    expect(crewFigures(crew, 0, { still: false })[0]!.reveal).toBe(0.5);
    applyCrew(crew, [], { snap: false });
    expect(crew.walkers.get("a")).toMatchObject({ phase: "sinking", phaseDuration: 300, phaseMs: 150 });
    applyCrew(crew, [sailor("a")], { snap: false });
    expect(crewFigures(crew, 0, { still: false })[0]!.reveal).toBe(0.5);
    stepCrew(crew, 20_000);
    applyCrew(crew, [], { snap: false, departures: { a: "failed" } });
    stepCrew(crew, 20_000);
    expect(crew.walkers.get("a")).toMatchObject({ phase: "sinking", phaseDuration: 900, target: stage.entry });
    stepCrew(crew, 450);
    expect(crewFigures(crew, 0, { still: false })[0]!.reveal).toBe(0.5);
    applyCrew(crew, [sailor("a")], { snap: false });
    expect(crew.walkers.get("a")).toMatchObject({ phase: "arriving", phaseDuration: 900, phaseMs: 450 });
    applyCrew(crew, [sailor("a")], { snap: true });
    applyCrew(crew, [], { snap: true });
    stepDepartures(crew, 125);
    expect(crewFigures(crew, 0, { still: true })[0]!.alpha).toBe(0.5);
    expect(departureEffects(crew)).toEqual([]);
    stepDepartures(crew, 125);
    expect(crew.departures).toEqual([]);
  });

  it("releases each exit's own queue on its own event with its declared side/drift alternation", () => {
    const manifest = structuredClone(shipManifest());
    const make = (at: [number, number]): Definition => ({
      kind: "choreography", marks: { wait: at }, queue: { at: "wait", release: "clear", spacing: [6, 3] }, alternate: { side: [1], drift: [4] }, effects: [],
      actor: [{ ms: 200, event: "clear", pose: manifest.cast.roles.stand, layer: "floor", moving: false }, { ms: 500, gone: true, pose: manifest.cast.roles.stand, layer: "effects", moving: false }],
    });
    manifest.portals.exits = { west: make([140, 104]), east: make([250, 118]) };
    manifest.portals.byDeparture = { done: "west", failed: "east", closed: "west", removed: "east" };
    const crew = createCrew(compileStage(manifest), shipCast());
    applyCrew(crew, [sailor("a"), sailor("b")], { snap: false });
    applyCrew(crew, [], { snap: false, departures: { a: "done", b: "failed" } });
    stepCrew(crew, 20_000);
    expect(crew.departures).toHaveLength(2);
    expect(crew.departures.map(({ side, drift }) => [side, drift])).toEqual([[1, 4], [1, 4]]);
    expect(exitFree(crew, "west")).toBe(false);
    expect(exitFree(crew, "east")).toBe(false);
    crew.departures[0]!.ms = 200;
    expect(exitFree(crew, "west")).toBe(true);
    expect(exitFree(crew, "east")).toBe(false);
    expect(crew.queue).toEqual([]);
  });
});

describe("choreography validation", () => {
  it("rejects duplicate/reserved events, future bob references, zero-length walks and overlapping effect keys", () => {
    const changes: Array<(exit: Definition) => void> = [
      (exit) => { exit.actor[0]!.event = "impact"; },
      (exit) => { exit.actor[0]!.event = "start"; },
      (exit) => { exit.actor[0]!.bob = { dy: 1, everyMs: 300, since: "impact" }; },
      (exit) => { exit.actor[1]!.to = { mark: "rail" }; },
      (exit) => { exit.effects[0]!.keys.push(exit.effects[0]!.keys[0]!); },
    ];
    for (const change of changes) {
      const manifest = structuredClone(shipManifest());
      change(manifest.portals.exits.plank as Definition);
      expect(settingProblems(manifest).length).toBeGreaterThan(0);
      expect(SettingManifestSchema.safeParse(manifest).success).toBe(false);
    }
  });

  it("supports the implicit start event for effect keys and queue release", () => {
    const manifest = structuredClone(shipManifest());
    const exit = manifest.portals.exits.plank as Definition;
    exit.queue.release = "start";
    exit.effects[0]!.keys[0]!.at.event = "start";
    expect(SettingManifestSchema.safeParse(manifest).success).toBe(true);
    expect(shipStage().entryMs).toBe(700);
  });
});
