/** Art-direction invariants that generic schema/floor lint cannot express. */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { SettingManifestSchema } from "../shared/deck-setting";
import { foamSegments } from "../client/deck-environment";
import { scrollOffset } from "../client/deck-sky";
import { decodePng } from "./png";
import { shipManifest } from "./ship-pack";

const folder = new URL("../art/settings/ship/", import.meta.url);
const ship = SettingManifestSchema.parse(JSON.parse(readFileSync(new URL("setting.json", folder), "utf8")));
const old = shipManifest();
const silhouettes = new Map<string, Buffer>();
function alphaOf(id: string): Buffer {
  let alpha = silhouettes.get(id);
  if (alpha === undefined) {
    const pixels = decodePng(readFileSync(new URL(ship.images[id]!.path, folder)));
    alpha = Buffer.alloc(pixels.width * pixels.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = pixels.rgba[i * 4 + 3]!;
    silhouettes.set(id, alpha);
  }
  return alpha;
}

describe("the remastered voyage", () => {
  it("keeps saved selection, eight looks, state routes and finite departure events", () => {
    expect(ship.id).toBe(old.id);
    expect(ship.cast).toEqual(old.cast);
    expect(ship.zones.byState).toEqual(old.zones.byState);
    expect(ship.portals.byDeparture).toEqual(old.portals.byDeparture);
    expect(ship.effects).toEqual(old.effects);
    expect(ship.dayCycle).toEqual(old.dayCycle);
    expect(ship.requires).toEqual(expect.arrayContaining(["post-transit@1", "carrier-surface@1", "stage-rock@1", "phase-strip@1"]));
  });

  it("sails bow-left while the coast moves right, taking about twenty minutes per repeat", () => {
    const coast = ship.ambience.find(e => e.id === "voyage-coast")!.behaviour;
    const beam = ship.ambience.find(e => e.id === "lighthouse-beam")!.behaviour;
    if (coast.kind !== "phase-strip" || beam.kind !== "phase-strip") throw Error("phase strips required");
    const width = ship.images[coast.frames.sprites[0]!.image]!.size[0];
    const lap = width / coast.drift.pxPerSecond;
    expect(lap).toBeGreaterThan(1200);
    expect(lap).toBeLessThan(1210);
    expect(beam.drift).toEqual(coast.drift);
    const segments = foamSegments({ left: 0, right: 640 }, width, scrollOffset(60, coast.drift.pxPerSecond, width));
    const landmark = segments.find(s => s.from <= 260 && s.from + s.width > 260)!;
    expect(landmark.x + 260 - landmark.from).toBeGreaterThan(260);
    expect(scrollOffset(lap, coast.drift.pxPerSecond, width)).toBe(0);
    for (const row of ship.atmosphere!.table) expect(row[ship.atmosphere!.clocks[coast.drift.clock!]!]).toBe(1);
  });

  it("registers night lighting to identical silhouettes and keeps every daytime beam transparent", () => {
    const coast = ship.ambience.find(e => e.id === "voyage-coast")!.behaviour;
    const beam = ship.ambience.find(e => e.id === "lighthouse-beam")!.behaviour;
    if (coast.kind !== "phase-strip" || beam.kind !== "phase-strip") throw Error("phase strips required");
    const silhouette = alphaOf(coast.frames.sprites[0]!.image);
    for (const sprites of Object.values(coast.byPhase)) {
      expect(alphaOf(sprites[0]!.image).equals(silhouette), sprites[0]!.image).toBe(true);
    }
    for (const [phase, sprites] of Object.entries(beam.byPhase)) {
      const alpha = sprites.map(s => alphaOf(s.image));
      expect(alpha.some(a => a.some(v => v > 0))).toBe(phase === "night");
    }
    expect(new Set(beam.byPhase.night!.map(s => ship.images[s.image]!.sha256)).size).toBe(4);
  });

  it("keeps the access ladder behind all sail layers and deck lanterns behind crew", () => {
    const parts = ship.stage.parts!.map(p => p.id);
    for (const sail of ["sail-main", "sail-fore", "jib"]) expect(parts.indexOf("access-ladder")).toBeLessThan(parts.indexOf(sail));
    for (const light of ship.stage.lights!) expect(light.row).toBeLessThan(260);
    const plank = ship.stage.pieces!.find(p => p.id === "plank")!;
    expect(plank.at[0]).toBeLessThan(30);
    expect(plank.sprite.rect![2]).toBeGreaterThan(90);
    expect(plank.sprite.rect![3]).toBeLessThan(15);
    expect(ship.attentionCarrier!.surface!.row).toBeGreaterThan(0);
    expect(ship.attentionCarrier!.surface!.row).toBeLessThan(ship.attentionCarrier!.size[1]);
  });
});
