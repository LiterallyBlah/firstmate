import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { capabilitiesUsed, settingImageIds, SettingManifestSchema, settingProblems } from "../shared/deck-setting";
import { PACK_BYTES_MAX } from "../server/deck-settings";
import { phaseStripFixture } from "../test/phase-strip-fixture";
import { decodePng } from "../test/png";
import { compileAmbience, type Behaviour } from "./deck-ambience";
import { phaseStripSets, phaseStripWeights } from "./deck-phase-strip";
import { dayBlend } from "./deck-sky";

const fixture = () => {
  const manifest = phaseStripFixture();
  const strip = manifest.ambience[0]!.behaviour as Behaviour<"phase-strip">;
  return { manifest, strip };
};

describe("phase-strip contract", () => {
  it("opts in explicitly, inventories/hashes the fixture and keeps it within the image budget", () => {
    const { manifest } = fixture();
    expect(settingProblems(manifest)).toEqual([]);
    expect(SettingManifestSchema.safeParse(manifest).success).toBe(true);
    expect(capabilitiesUsed(manifest)).toContain("phase-strip@1");
    expect(settingImageIds(manifest)).toContain("phase-test");
    const image = manifest.images["phase-test"]!;
    const bytes = readFileSync(new URL("../test/fixtures/phase-strip/atlas.png", import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(image.sha256);
    const decoded = decodePng(bytes);
    expect([decoded.width, decoded.height]).toEqual(image.size);
    expect(bytes.length).toBeLessThan(PACK_BYTES_MAX);
  });

  it("rejects unknown fields, phases, clocks, non-finite motion and mismatched frame counts/sizes/crops", () => {
    const invalid = [
      (s: Behaviour<"phase-strip">) => Object.assign(s, { route: "script" }),
      (s: Behaviour<"phase-strip">) => { s.byPhase.missing = s.frames.sprites; },
      (s: Behaviour<"phase-strip">) => { s.byPhase.night = []; },
      (s: Behaviour<"phase-strip">) => { s.byPhase.night = [...s.frames.sprites, ...s.frames.sprites]; },
      (s: Behaviour<"phase-strip">) => { s.byPhase.night![0]!.rect![2]--; },
      (s: Behaviour<"phase-strip">) => { s.byPhase.night![0]!.rect![0] = -1; },
      (s: Behaviour<"phase-strip">) => { s.byPhase.night![0]!.image = "missing"; },
      (s: Behaviour<"phase-strip">) => { s.drift.clock = "missing"; },
      (s: Behaviour<"phase-strip">) => { s.frames.clock = "missing"; },
      (s: Behaviour<"phase-strip">) => { s.drift.pxPerSecond = Infinity; },
      (s: Behaviour<"phase-strip">) => { s.span = [4, 4]; },
    ];
    for (const mutate of invalid) {
      const { manifest, strip } = fixture(); mutate(strip);
      expect(SettingManifestSchema.safeParse(manifest).success, String(mutate)).toBe(false);
    }
    const { manifest, strip } = fixture();
    strip.byPhase = {};
    manifest.dayCycle = undefined;
    expect(settingProblems(manifest)).toContain("test-coast phase-strip needs dayCycle");
  });

  it("resolves sparse phases by circular anchor distance, ties in cycle order, or base", () => {
    const { manifest, strip } = fixture();
    const phases = manifest.dayCycle!.phases;
    const night = strip.byPhase.night!, day = strip.byPhase.day!;
    strip.byPhase = { day, night };
    expect(phaseStripSets(strip, phases)).toEqual([day, day, night, night]);
    // Dawn is 9h from night through midnight, but 6h from day. Move it to 1am.
    phases[0]!.localMinute = 60;
    expect(phaseStripSets(strip, phases)[0]).toBe(night);
    phases[0]!.localMinute = 270; // exact circular tie: day precedes night
    expect(phaseStripSets(strip, phases)[0]).toBe(day);
    strip.byPhase = {};
    expect(phaseStripSets(strip, phases)).toEqual(phases.map(() => strip.frames.sprites));
  });

  it("uses the eased day blend, including midnight and invalid-clock fallback; coalesces identical sets", () => {
    const { manifest, strip } = fixture();
    const sets = phaseStripSets(strip, manifest.dayCycle!.phases);
    const blend = dayBlend(19.5 * 60, manifest.dayCycle!);
    expect(blend.t).toBe(0.15625);
    expect([...phaseStripWeights(sets, blend).values()]).toEqual([0.84375, 0.15625]);
    expect([...phaseStripWeights(sets, dayBlend(null, manifest.dayCycle!)).entries()]).toContainEqual([strip.byPhase.day, 1]);
    const same = sets.map(() => sets[0]!);
    expect([...phaseStripWeights(same, blend).values()]).toEqual([1]);
    expect(dayBlend(5 * 60, manifest.dayCycle!).t).toBe(0.5);
  });

  it("drops an unavailable phase atomically, records it, and falls back without losing the strip", () => {
    const { manifest, strip } = fixture();
    manifest.images.night = manifest.images["phase-test"]!;
    strip.byPhase.night = [{ image: "night", rect: [0, 144, 256, 48] }];
    const compiled = compileAmbience(manifest, (id) => id !== "night");
    expect(compiled.missing).toEqual(["night"]);
    const resolved = compiled.elements[0]!.behaviour as Behaviour<"phase-strip">;
    expect(resolved.byPhase.night).toBeUndefined();
    expect(phaseStripSets(resolved, manifest.dayCycle!.phases)[3]).toBe(resolved.byPhase.dusk);
    expect(compileAmbience(manifest, (id) => id !== "phase-test").elements).toHaveLength(0);
  });

  it("keeps the base when all phase sets fail, or selects the element fallback when the base fails", () => {
    const { manifest, strip } = fixture();
    manifest.images.phase = manifest.images["phase-test"]!;
    strip.byPhase = { night: [{ image: "phase", rect: [0, 144, 256, 48] }] };
    manifest.ambience = [manifest.ambience[0]!];
    const baseOnly = compileAmbience(manifest, (id) => id !== "phase").elements[0]!.behaviour as Behaviour<"phase-strip">;
    expect(baseOnly.byPhase).toEqual({});
    expect(phaseStripSets(baseOnly, manifest.dayCycle!.phases).every((set) => set === baseOnly.frames.sprites)).toBe(true);
    manifest.ambience[0]!.fallback = "fallback";
    manifest.ambience.push({ id: "fallback", slot: "back", order: 0, lite: "run", still: "first-frame",
      behaviour: { kind: "strip", frames: { sprites: [{ image: "deck", rect: [0, 0, 8, 8] }], frameMs: 1000 }, top: 0, span: [0, 10], drift: { pxPerSecond: 0 } } });
    expect(compileAmbience(manifest, (id) => id !== "phase-test").elements.map((element) => [element.id, element.place])).toEqual([["fallback", "test-coast"]]);
  });
});
