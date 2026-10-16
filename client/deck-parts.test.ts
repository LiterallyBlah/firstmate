/**
 * A setting's stage furniture, compiled (`client/deck-parts.ts`): which parts are drawn — the ship's tall mast, its
 * topmast or the hull's own masthead in its place, the sail — what the backdrop is cut round, which pieces stand over
 * the crew and what stands in for one, the lights, and the arithmetic of how they move. Against the ship's pack, and
 * small packs made from it.
 */
import { describe, expect, it } from "vitest";

import { bobAt, compileParts, flickerAt, glassTint, glyphRects, swayAt } from "./deck-parts";
import { depthOf } from "./deck-scene";
import { shipManifest } from "../test/ship-pack";
import type { SettingManifest } from "../shared/deck-setting";

const ship = shipManifest();
const all = () => true;
const without =
  (...gone: string[]) =>
  (image: string) =>
    !gone.includes(image);

describe("the ship's stage, compiled", () => {
  it("draws the tall mast, its topmast and the sail, the hull cut round the short rig, and reaches above the stage", () => {
    const parts = compileParts(ship, all);
    expect(parts.parts.map((part) => [part.id, part.place, part.at])).toEqual([
      ["tall-mast", "tall-mast", [187, -60]],
      ["topmast", "topmast", [187, -80]],
      ["sail", "sail", [154, -15]],
      ["access-ladder", "access-ladder", [215, -38]],
    ]);
    expect(parts.backdrop).toEqual({ image: "deck", rect: [0, 0, 426, 161] });
    expect(parts.cutout).toEqual([117, 0, 149, 71]);
    expect(parts.top).toBe(-80);
    expect(parts.parts[2]!.frames.map((frame) => frame.rect)).toEqual([
      [0, 0, 114, 84],
      [114, 0, 114, 84],
    ]);
    expect(parts.bob).toEqual({ periodS: 6.2, amplitude: { channel: "heave" }, clock: "swell" });
    expect([parts.missing, parts.required]).toEqual([[], []]);
  });

  it("stands the tall mast's own rows in for the mast piece at its row, and the plank just in front of the near rail", () => {
    const { pieces, pieceDepths } = compileParts(ship, all);
    const byId = new Map(pieces.map((piece) => [piece.id, piece]));
    expect(byId.get("mast")).toEqual({ id: "mast", cut: { image: "mast-tall-mast", rect: [0, 149, 48, 43] }, at: [187, 69], depth: depthOf(110, 1), by: "tall-mast" });
    expect(byId.get("near")!.depth).toBe(depthOf(null, 1));
    expect(byId.get("plank")).toMatchObject({ cut: { image: "plank-plank", rect: [0, 0, 18, 22] }, at: [241, 120], depth: depthOf(null, 1) + 1, by: null });
    expect(pieceDepths.get("plank")).toBe(depthOf(null, 1) + 1);
  });

  it("without the tall mast, has the hull's own masthead sway in the topmast's place, cut round it alone, and no sail", () => {
    const bare = compileParts(ship, without("mast-tall-mast"));
    expect(bare.parts.map((part) => [part.id, part.place, part.cut])).toEqual([["masthead", "topmast", { image: "deck", rect: [188, 0, 54, 48] }]]);
    expect(bare.cutout).toEqual([188, 0, 54, 48]);
    expect(bare.top).toBe(0);
    expect(bare.pieces.find((piece) => piece.id === "mast")).toMatchObject({ cut: { image: "deck", rect: [405, 162, 19, 64] }, at: [202, 48], by: null });
    expect(bare.missing).toEqual(["mast-tall-mast"]);
  });

  it("leaves out an optional piece whose image did not arrive, and says when one that is not optional did not", () => {
    const boardless = compileParts(ship, without("plank-plank"));
    expect(boardless.pieces.map((piece) => piece.id)).not.toContain("plank");
    expect(boardless.pieceDepths.get("plank")).toBe(depthOf(null, 1) + 1);
    expect(boardless.required).toEqual([]);
    expect(compileParts(ship, without("deck")).required).toEqual(["deck"]);
  });

  it("cuts the backdrop round the bounds of every cutout drawn, and not at all with none", () => {
    const parts = ship.stage.parts.map((part) => (part.id === "sail" ? { ...part, cutout: [300, 10, 20, 20] as [number, number, number, number] } : part));
    expect(compileParts({ ...ship, stage: { ...ship.stage, parts } }, all).cutout).toEqual([117, 0, 203, 71]);
    const none: SettingManifest = { ...ship, stage: { ...ship.stage, parts: [] } };
    expect(compileParts(none, all).cutout).toBeNull();
  });

  it("has the three lanterns where they hang, each just over its row", () => {
    const { lights } = compileParts(ship, all);
    expect(lights.map((light) => [light.id, light.at, light.depth, light.seed])).toEqual([
      ["stern", [410, 50], depthOf(80, 1) + 0.5, 0],
      ["quarterdeck", [344, 48], depthOf(80, 1) + 0.5, 2.3],
      ["mast", [211, 70], depthOf(110, 1) + 0.5, 4.9],
    ]);
  });
});

describe("how the stage moves", () => {
  it("bobs and sways in whole pixels, the sway held to its limit", () => {
    for (let t = 0; t < 13; t += 0.05) {
      expect(Number.isInteger(bobAt(t, 6.2, 1.6))).toBe(true);
      expect(Math.abs(swayAt(t, { periodS: 6.2, phase: -1, limit: 1 }, 5))).toBeLessThanOrEqual(1);
    }
    expect(bobAt(6.2 / 4, 6.2, 1.2)).toBe(1);
    expect(swayAt((6.2 / 4) * (1 + 1 / (Math.PI / 2)), { periodS: 6.2, phase: -1, limit: 2 }, 2)).toBe(2);
  });

  it("flickers a light about its base, out of step by its seed, within 0 to 1; its glass by the first tint it is over", () => {
    const { flicker, tints } = ship.stage.lightStyles.lantern!;
    expect(flickerAt(0, 0, { base: 0.8, waves: [] })).toBe(0.8);
    expect(flickerAt(0, 0, { base: 2, waves: [] })).toBe(1);
    expect(flickerAt(1, 0, flicker)).not.toBe(flickerAt(1, 2.3, flicker));
    expect([0.95, 0.88, 0.8, 0.74, 0].map((level) => glassTint(level, tints))).toEqual(["#FFFFFF", "#F2DCB8", "#F2DCB8", "#D8B890", "#D8B890"]);
  });

  it("draws a light's glyph as runs by ink, the same run in the rows below made one taller", () => {
    const { glyph, origin } = ship.stage.lightStyles.lantern!;
    expect(Object.fromEntries(glyphRects(glyph, origin))).toEqual({
      a: [
        [0, 0, 1, 1],
        [-1, 1, 3, 1],
        [-2, 2, 1, 3],
        [2, 2, 1, 3],
        [-2, 5, 5, 1],
      ],
      b: [[-1, 2, 3, 3]],
    });
  });
});

it("resolves named piece depths independently of manifest order, including missing images, and refuses cycles", () => {
  const manifest = structuredClone(ship);
  manifest.stage.pieces.push({ ...manifest.stage.pieces[0]!, id: "extra", baseline: { over: "plank" }, optional: true, sprite: { image: "plank-plank" } });
  manifest.stage.pieces.reverse();
  const compiled = compileParts(manifest, all);
  expect(compiled.pieceDepths.get("extra")).toBe(depthOf(null, 1) + 2);
  expect(compiled.pieces.find((piece) => piece.id === "extra")!.depth).toBe(compiled.pieceDepths.get("extra"));
  expect(compileParts(manifest, without("plank-plank")).pieceDepths.get("extra")).toBe(depthOf(null, 1) + 2);
  manifest.stage.pieces.find((piece) => piece.id === "near")!.baseline = { over: "extra" };
  expect(() => compileParts(manifest, all)).toThrow("cyclic piece depth");
});
