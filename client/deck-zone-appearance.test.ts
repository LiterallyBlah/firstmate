import { describe, expect, it } from "vitest";
import { capabilitiesUsed, SettingManifestSchema, settingImageIds } from "../shared/deck-setting";
import { shipManifest } from "../test/ship-pack";
import { compileCast } from "./deck-cast";
import { applyCrew, createCrew, crewFigures, stepCrew, stepDepartures } from "./deck-crew";
import { badgeTop, figureBox, sailorAt, showsAsk } from "./deck-hover";
import { compileParts } from "./deck-parts";
import { compileStage } from "./deck-stage";
import type { DeckSailor, DeckState } from "./deck-scene";

// Deliberately use a different state, zone and pack name: this is not an idle/ship runtime rule.
function fixture() {
  const manifest = structuredClone(shipManifest());
  manifest.id = "workshop";
  for (const zone of manifest.zones.zones) delete zone.appearance;
  manifest.zones.zones.find((zone) => zone.id === manifest.zones.byState.waiting)!.appearance = {
    sprite: { image: "deck", rect: [0, 0, 16, 16] }, feet: [8, 16], front: "near",
  };
  manifest.requires = capabilitiesUsed(manifest);
  return manifest;
}
const worker = (state: DeckState, stale = false): DeckSailor => ({
  key: "worker", identity: "one-agent", label: "One task", state, stale, asks: true,
  caption: { title: "One task", status: state, project: null, host: "local", line: null, stale: null },
});
function world() {
  const manifest = fixture(), stage = compileStage(manifest), cast = compileCast(manifest);
  return { manifest, stage, cast, crew: createCrew(stage, cast) };
}
describe("zone-appearance@1", () => {
  it("requires the capability, validates its references/anchor and refuses executable or unknown fields", () => {
    const m = fixture();
    expect(SettingManifestSchema.safeParse(m).success).toBe(true);
    expect(m.requires).toContain("zone-appearance@1");
    expect(settingImageIds(m)).toContain("deck");
    for (const mutation of [
      (a: Record<string, unknown>) => { a.front = "missing"; },
      (a: Record<string, unknown>) => { a.sprite = { image: "missing" }; },
      (a: Record<string, unknown>) => { a.feet = [-1, 8]; },
      (a: Record<string, unknown>) => { a.feet = [8, 17]; },
      (a: Record<string, unknown>) => { a.script = "return worker"; },
      (a: Record<string, unknown>) => { a.expression = "state === idle"; },
    ]) {
      const broken = structuredClone(m);
      mutation(broken.zones.zones.find((zone) => zone.appearance !== undefined)!.appearance!);
      expect(SettingManifestSchema.safeParse(broken).success).toBe(false);
    }
    m.requires = m.requires.filter((name) => name !== "zone-appearance@1");
    expect(SettingManifestSchema.safeParse(m).success).toBe(false);
  });

  it("uses the visible handle's geometry and depth for the same worker, badge, hover and reply", () => {
    const { manifest, stage, cast, crew } = world();
    applyCrew(crew, [worker("waiting")], { snap: true });
    const figure = crewFigures(crew, 0, { still: true })[0]!;
    expect(figure).toMatchObject({ key: "worker", label: "One task", state: "waiting", asks: true, flip: false, sink: 0 });
    expect(figure.appearance).toBe(stage.zoneOf("waiting").appearance);
    expect(figure.appearance!.depth).toBe(compileParts(manifest, () => true).pieceDepths.get("near")! + 1);
    expect(figureBox(figure, cast)).toMatchObject({ left: figure.x - 8, right: figure.x + 8, bottom: figure.y, top: badgeTop(figure, cast) });
    const { appearance: _appearance, ...body } = figure;
    const behind = { ...body, key: "behind", row: 999 };
    expect(sailorAt([figure, behind], cast, { x: figure.x, y: figure.y - 8 })?.key).toBe("worker");
    for (const at of [100, 800, 2000, 5000]) expect(crewFigures(crew, at, { still: false })[0]).toEqual(figure);
    expect(showsAsk(figure)).toBe(true);
    applyCrew(crew, [worker("waiting", true)], { snap: false });
    const stale = crewFigures(crew, 5000, { still: false })[0]!;
    expect(stale.appearance).toBe(figure.appearance);
    expect(showsAsk(stale)).toBe(false);
    expect(sailorAt([stale], cast, { x: stale.x, y: stale.y - 8 })?.key).toBe("worker");
  });

  it("restores the cast while walking and adopts the handle only after settling, preserving identity and look", () => {
    const { crew } = world();
    applyCrew(crew, [worker("waiting")], { snap: true });
    const look = crewFigures(crew, 0, { still: true })[0]!.look;
    for (const state of ["working", "waiting"] as const) {
      applyCrew(crew, [worker(state)], { snap: false });
      expect(crewFigures(crew, 0, { still: false })[0]!.appearance).toBeUndefined();
      for (let at = 0; at < 20_000; at += 33) stepCrew(crew, 33);
      const figure = crewFigures(crew, 20_000, { still: false })[0]!;
      expect(figure.look).toBe(look);
      expect(figure.appearance !== undefined).toBe(state === "waiting");
      expect(figure.moving).toBe(false);
    }
  });

  it("keeps reduced motion calm and fades the handle on removal without leaving a clickable ghost", () => {
    const { crew, cast } = world();
    applyCrew(crew, [worker("working")], { snap: true });
    applyCrew(crew, [worker("waiting")], { snap: true });
    const before = crewFigures(crew, 0, { still: true })[0]!;
    applyCrew(crew, [], { snap: true });
    const gone = crewFigures(crew, 0, { still: true })[0]!;
    expect(gone.appearance).toBe(before.appearance);
    expect(gone.layer).toEqual(before.layer);
    expect(gone.departing).toBe(true);
    expect(sailorAt([gone], cast, { x: gone.x, y: gone.y - 8 })).toBeNull();
    stepDepartures(crew, 10000);
    expect(crewFigures(crew, 10000, { still: true })).toEqual([]);
  });
});
