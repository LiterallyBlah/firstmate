/**
 * The setting format's own rules, on the ship's manifest and copies of it broken one way at a time: everything a
 * manifest names must be there, `requires` must say what it uses, and an engine that lacks a capability or the
 * format says so rather than drawing half of it.
 */
import { describe, expect, it } from "vitest";

import {
  ENGINE_CAPABILITIES,
  ENGINE_FORMAT_VERSION,
  SettingManifestSchema,
  capabilitiesUsed,
  incompatibility,
  settingImageIds,
  settingProblems,
  type SettingManifest,
} from "./deck-setting";
import { loadDeckSetting } from "./deck-rpc";
import { shipImages, shipManifest } from "../test/ship-pack";

/** A copy of the ship's manifest, changed. */
function broken(change: (manifest: SettingManifest) => void): SettingManifest {
  const copy = structuredClone(shipManifest());
  change(copy);
  return copy;
}

describe("a setting manifest", () => {
  it("is whole for the ship: nothing it names is missing, and it needs exactly what it uses", () => {
    expect(settingProblems(shipManifest())).toEqual([]);
    expect(capabilitiesUsed(shipManifest())).toEqual(shipManifest().requires);
    expect(ENGINE_CAPABILITIES.filter((capability) => !capabilitiesUsed(shipManifest()).includes(capability))).toEqual(["stable-posts@1", "pose-fidgets@1", "walk-in@1", "phase-tint@1"]);
  });

  it("names every image it draws with once, the backdrop first", () => {
    const ids = settingImageIds(shipManifest());
    expect(ids[0]).toBe("deck");
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(shipManifest().images).sort());
  });

  it("is refused when it names what it does not have", () => {
    const cases: Array<[string, (manifest: SettingManifest) => void, string]> = [
      ["an image", (manifest) => delete manifest.images["sky-dusk"], 'image "sky-dusk"'],
      ["a pose", (manifest) => (manifest.cast.roles.stand = "cartwheel"), 'pose "cartwheel"'],
      ["a zone", (manifest) => (manifest.zones.byState.idle = "hammock"), 'zone "hammock"'],
      ["an exit", (manifest) => (manifest.portals.byDeparture.done = "lift"), 'exit "lift"'],
      ["a mark", (manifest) => delete (manifest.portals.exits.plank as { marks: Record<string, unknown> }).marks.tip, 'mark "tip"'],
      ["an effect", (manifest) => delete manifest.effects.shark, 'effect "shark"'],
      ["a clock", (manifest) => delete manifest.atmosphere!.clocks.wind, 'clock "wind"'],
      ["a day phase", (manifest) => (manifest.dayCycle!.night = "midnight"), 'day phase "midnight"'],
      ["a fallback", (manifest) => (manifest.ambience.find((element) => element.id === "sea")!.fallback = "puddle"), 'element "puddle"'],
      ["a piece", (manifest) => (manifest.stage.parts[0]!.replacesPiece!.piece = "bowsprit"), 'piece "bowsprit"'],
    ];
    for (const [what, change, says] of cases) {
      const problems = settingProblems(broken(change));
      expect(problems.some((problem) => problem.includes(says)), `${what}: ${problems.join("; ")}`).toBe(true);
      expect(SettingManifestSchema.safeParse(broken(change)).success, what).toBe(false);
    }
  });

  it("is refused when its words leave a zone out, or two things share an id", () => {
    expect(settingProblems(broken((manifest) => delete manifest.copy.zones.rest))).toContain('copy.zones has no words for zone "rest"');
    expect(settingProblems(broken((manifest) => manifest.stage.pieces.push(manifest.stage.pieces[0]!)))).toContain('two pieces are called "near"');
  });

  it("is refused when `requires` does not say what it uses, either way", () => {
    expect(settingProblems(broken((manifest) => manifest.requires.pop()))[0]).toMatch(/^requires says/);
    expect(settingProblems(broken((manifest) => manifest.ambience.splice(manifest.ambience.findIndex((element) => element.id === "gull"), 1)))[0]).toMatch(/flyby@1/);
  });

  it("travels as `firstmate.deck.setting` sends it", () => {
    const payload = { manifest: shipManifest(), images: shipImages() };
    expect(loadDeckSetting.output.parse(payload)).toEqual(payload);
  });

  it("rejects atmosphere tables that cannot interpolate or provide complete calm values", () => {
    const changes: Array<(manifest: SettingManifest) => void> = [
      (manifest) => manifest.atmosphere!.table.reverse(),
      (manifest) => (manifest.atmosphere!.table[1]!.at = manifest.atmosphere!.table[0]!.at),
      (manifest) => delete manifest.atmosphere!.table[1]!.pace,
      (manifest) => delete manifest.atmosphere!.delivered.mood,
      (manifest) => (manifest.atmosphere!.delivered.unknown = 1),
      (manifest) => (manifest.atmosphere!.clocks.wind = "unknown"),
      (manifest) => { for (const row of manifest.atmosphere!.table) row["invalid channel"] = 1; },
      (manifest) => { for (const row of manifest.atmosphere!.table) Object.assign(row, { constructor: 1 }); },
    ];
    for (const change of changes) expect(SettingManifestSchema.safeParse(broken(change)).success).toBe(false);
    const single = broken((manifest) => { manifest.atmosphere!.table = [manifest.atmosphere!.table[0]!]; });
    expect(SettingManifestSchema.safeParse(single).success).toBe(true);
  });

  it("keeps flash caps in the engine, including the interval across the whole setting", () => {
    const changes: Array<(manifest: SettingManifest) => void> = [
      (manifest) => {
        const element = manifest.ambience.find((each) => each.behaviour.kind === "flash")!;
        manifest.ambience.push({ ...element, id: "another-flash" });
      },
      ...["frames", "duration", "opacity"].map((change) => (manifest: SettingManifest) => {
        const flash = manifest.ambience.find((each) => each.behaviour.kind === "flash")!.behaviour;
        if (flash.kind !== "flash") throw new Error("expected flash");
        if (change === "frames") flash.frames.push(flash.frames[0]!);
        if (change === "duration") flash.frames[0]!.ms = 3501;
        if (change === "opacity") flash.opacity = [[0, 0.61]];
      }),
    ];
    for (const change of changes) expect(SettingManifestSchema.safeParse(broken(change)).success).toBe(false);
  });
});

describe("phase tint in the closed catalogue", () => {
  const tinted = () => {
    const manifest = structuredClone(shipManifest());
    manifest.stage.tintByPhase = { night: "#8C94B0" };
    manifest.requires = capabilitiesUsed(manifest);
    return manifest;
  };

  it("accepts a partial table of known phases and requires phase-tint@1", () => {
    const manifest = tinted();
    expect(SettingManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.requires).toContain("phase-tint@1");
    manifest.requires = manifest.requires.filter((id) => id !== "phase-tint@1");
    expect(SettingManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects unknown phases, absent day cycles, empty tables, expressions and non-RGB colours", () => {
    const changes: Array<(manifest: SettingManifest) => void> = [
      (manifest) => { manifest.stage.tintByPhase = { missing: "#FFFFFF" }; },
      (manifest) => { manifest.dayCycle = undefined; },
      (manifest) => { manifest.stage.tintByPhase = {}; },
      (manifest) => { manifest.stage.tintByPhase = { night: "time * 2" }; },
      (manifest) => { manifest.stage.tintByPhase = { night: "#12345678" }; },
      (manifest) => { Object.assign(manifest.stage, { tintExpression: "clock()" }); },
    ];
    for (const change of changes) {
      const manifest = tinted();
      change(manifest);
      manifest.requires = capabilitiesUsed(manifest);
      expect(SettingManifestSchema.safeParse(manifest).success).toBe(false);
    }
  });
});

describe("whether this engine can draw a setting", () => {
  it("can draw one in its format that needs only what it has", () => {
    expect(incompatibility({ formatVersion: ENGINE_FORMAT_VERSION, requires: [...ENGINE_CAPABILITIES] })).toBeNull();
    expect(incompatibility({ formatVersion: 1, requires: ["stage@1"] })).toBeNull();
  });

  it("says why not for a newer format, or a behaviour it does not have", () => {
    expect(incompatibility({ formatVersion: ENGINE_FORMAT_VERSION + 1, requires: [] })).toBe(`it is format ${ENGINE_FORMAT_VERSION + 1}; this FirstMate draws format ${ENGINE_FORMAT_VERSION}`);
    expect(incompatibility({ formatVersion: 1, requires: ["stage@1", "walkers@1", "drifters@2"] })).toBe("it needs walkers@1, drifters@2, which this FirstMate does not have");
  });
});

it("rejects undeclared fields at every level of the closed catalogue instead of silently stripping them", () => {
  const changes: Array<(manifest: SettingManifest) => void> = [
    (manifest) => { Reflect.set(manifest, "script", "run()"); },
    (manifest) => { Reflect.set(manifest.stage, "onDraw", "hook"); },
    (manifest) => { Reflect.set(manifest.stage.motion!.bob, "expression", "sin(t)"); },
    (manifest) => { Reflect.set(manifest.ambience[0]!.behaviour, "when", "busy"); },
    (manifest) => { Reflect.set(manifest.cast.roles, "choosePose", "callback"); },
    (manifest) => { Reflect.set(manifest.portals.entry, "condition", "ready"); },
    (manifest) => { Reflect.set(manifest.effects.shark!.frames.fin!, "shader", "custom"); },
  ];
  for (const change of changes) expect(SettingManifestSchema.safeParse(broken(change)).success).toBe(false);
});
