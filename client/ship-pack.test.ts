/**
 * The ship as a setting pack (`art/settings/ship/`), held to what the deck drew it with before packs, while the engine
 * still holds both: read as the old manifests (`legacyViews`) it is those manifests exactly as last served (kept in
 * `docs/ship-deck-art/legacy/`), and every number in it is the constant in the deck's code it replaces. Each step of
 * the move to a scene engine that deletes a constant deletes its check here; the pack is the source from then on.
 * Step 3 took the stage, floor, zones and portal marks, step 4 the cast, step 5a the sky, its overlays, the lightning,
 * the clouds and the gull, step 5b the sea, foam, wake and spindrift, step 5c the stage's parts, pieces and lights and its
 * bob and sway, step 6 the atmosphere: the engine reads those from the pack now. The atlas's and the extras' records still hold the parts and
 * pieces to what was served, by the arithmetic the deck cut them with.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import { FADE_MS, HATCH_MS, SHARK_MOUTH } from "../test/ship-choreography";
import { extrasImagePaths } from "../test/deck-legacy";
import { DeckArtManifestSchema, DeckExtrasManifestSchema } from "../test/deck-legacy-schema";
import {
  BOB_UP_MS,
  CHOMP_AT,
  CHOMP_MS,
  FIN_AT,
  FIN_MS,
  FIN_RUN,
  HOP_MS,
  IMPACT_AT,
  JUMP_MS,
  PLANK_DEPARTURES,
  PLANK_EXIT_MS,
  PLANK_WALK_MS,
  PLUNGE_MS,
  SPLASH_FRAMES,
  SUBMERGE_MS,
  SURFACE_MS,
  SWIM_ROWS,
  TEETER_MS,
} from "../test/ship-choreography";
import { shipAmbience, shipManifest, shipViews } from "../test/ship-pack";
import type { AmbienceBehaviour } from "../shared/deck-setting";


const legacy = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../docs/ship-deck-art/legacy/${name}`, import.meta.url)), "utf8"));
const ship = shipManifest();
/** Every image an ambience element draws with. */
function imagesOf(behaviour: AmbienceBehaviour): string[] {
  switch (behaviour.kind) {
    case "backdrop-cycle":
      return Object.values(behaviour.phases);
    case "overlay":
      return [behaviour.image];
    case "flash":
      return behaviour.frames.map((frame) => frame.sprite.image);
    case "phase-frames":
      return behaviour.frames.map((frame) => frame.image);
    case "drifters":
      return behaviour.sprites.flatMap((sprite) => [sprite.image, ...(sprite.variants ?? []).flatMap((variant) => variant.frames.map((frame) => frame.image))]);
    case "flyby":
      return Object.values(behaviour.poses).map((sprite) => sprite.image);
    case "tile":
    case "strip":
    case "cycle":
      return [...behaviour.frames.sprites, ...(behaviour.variants ?? []).flatMap((variant) => variant.frames)].map((sprite) => sprite.image);
  }
}

describe("the ship's pack, read as the manifests the deck drew from", () => {
  const deck = DeckArtManifestSchema.parse(legacy("deck.json"));
  const served = DeckExtrasManifestSchema.parse(legacy("extras.json"));
  const pathOf = (image: string) => ship.images[image]!.path;
  const part = (id: string) => ship.stage.parts.find((each) => each.id === id)!;

  it("has the atlas's backdrop and pieces as last served", () => {
    expect(ship.stage.backdrop.sprite).toEqual({ image: "deck", rect: deck.ship.frame });
    const pieces = ship.stage.pieces.filter((piece) => piece.baseline === null || typeof piece.baseline === "number");
    expect(Object.fromEntries(pieces.map((piece) => [piece.id, { frame: piece.sprite.rect, x: piece.at[0], y: piece.at[1], baseline: piece.baseline }]))).toEqual(deck.pieces);
  });

  it("has the extras' shark and splash as last served", () => {
    expect(shipViews().extras).toEqual({ exit: served.exit });
  });

  it("has the extras' sail, plank and tall mast as last served, cut as the deck cut them", () => {
    const sail = part("sail");
    if (sail.behaviour?.kind !== "cycle") throw new Error("the sail is a cycle");
    const [width, height] = served.sail.frameSize;
    expect([pathOf(sail.sprite.image), sail.at, sail.behaviour.frames.frameMs]).toEqual([served.sail.texture, served.sail.position, served.sail.frameMs]);
    expect(sail.behaviour.frames.sprites.map((sprite) => sprite.rect)).toEqual(Array.from({ length: served.sail.frames }, (_, index) => [index * width, 0, width, height]));
    const plank = ship.stage.pieces.find((piece) => piece.id === "plank")!;
    expect([pathOf(plank.sprite.image), plank.at, plank.baseline, plank.optional]).toEqual([served.plank!.texture, served.plank!.position, { over: "near" }, true]);
    // The tall mast: its top `sway` rows the topmast, the rest its shaft, and its rows from the mast piece's top — or below
    // the sail, which hangs over them — the piece it stands in for; what it clears is left out of the hull.
    const mast = served.mast!;
    const [x, y] = mast.position;
    const [mastWidth, mastHeight] = mast.size;
    const piece = deck.pieces[mast.replaces]!;
    const depthTop = Math.max(piece.y, served.sail.position[1] + height, y);
    expect(part("topmast")).toMatchObject({ at: [x, y], sprite: { rect: [0, 0, mastWidth, mast.sway] }, needs: ["tall-mast"], fallback: "masthead" });
    expect(part("tall-mast")).toMatchObject({ at: [x, y + mast.sway], sprite: { rect: [0, mast.sway, mastWidth, mastHeight - mast.sway] }, cutout: mast.clears });
    expect(part("tall-mast").replacesPiece).toMatchObject({ piece: mast.replaces, at: [x, depthTop], sprite: { rect: [0, depthTop - y, mastWidth, y + mastHeight - depthTop] } });
    expect(pathOf(part("tall-mast").sprite.image)).toBe(mast.texture);
    // Its foot on the mast piece's last row, as wide as the piece.
    expect(y + mastHeight).toBe(piece.y + piece.frame[3]);
    expect(x).toBeLessThanOrEqual(piece.x);
    expect(x + mastWidth).toBeGreaterThanOrEqual(piece.x + piece.frame[2]);
  });

  it("names every image at the path it was served at", () => {
    const { extras } = shipViews();
    const looks = ship.cast.looks.map((look) => ship.images[look.image]!.path);
    // The ambience's own: the sky and everything in it, the gull, and the water with its weather. The still sea and
    // foam are drawn only in the animated ones' place, so they are not among what the ambience draws when all arrived.
    const elements = ship.ambience.flatMap((element) => imagesOf(element.behaviour)).map((id) => ship.images[id]!.path);
    expect(new Set(shipAmbience().elements.map((element) => element.id))).toEqual(new Set(ship.ambience.filter((element) => !element.id.endsWith("-still")).map((element) => element.id)));
    const stage = [
      ...ship.stage.parts.flatMap((each) => [each.sprite.image, ...(each.replacesPiece === undefined ? [] : [each.replacesPiece.sprite.image]), ...(each.behaviour?.kind === "cycle" ? each.behaviour.frames.sprites.map((sprite) => sprite.image) : [])]),
      ...ship.stage.pieces.map((piece) => piece.sprite.image),
      ...ship.zones.zones.flatMap((zone) => zone.appearance === undefined ? [] : [zone.appearance.sprite.image]),
      ...(ship.attentionCarrier?.frames.map(sprite => sprite.image) ?? []),
    ].map(pathOf);
    const paths = new Set(["deck.png", ...extrasImagePaths(extras), ...looks, ...elements, ...stage]);
    expect(new Set(Object.values(ship.images).map((image) => image.path))).toEqual(paths);
  });
});

describe("the ship's pack, against the deck's constants", () => {
  it("goes up and down the hatch, and fades out under reduced motion, on the deck's timing", () => {
    expect(ship.portals.entry).toMatchObject({ kind: "rise", ms: HATCH_MS });
    expect(ship.portals.exits.hatch).toMatchObject({ kind: "sink", ms: HATCH_MS });
    expect(ship.portals.still.fadeMs).toBe(FADE_MS);
  });

  it("walks the plank on the deck's own timeline, to the shark at its mouth", () => {
    const plank = ship.portals.exits.plank!;
    if (plank.kind !== "choreography") throw new Error("the plank is a choreography");
    // The walk out along the board, at the floor's pace between its marks, is still a constant of the timeline.
    expect(Math.round(((plank.marks.tip![1] - plank.marks.rail![1]) / ship.floor.walkSpeed) * 1000)).toBe(PLANK_WALK_MS);
    const lengths = plank.actor.map((segment) => (segment.ms === "walk" ? PLANK_WALK_MS : segment.ms));
    const ends = (event: string) => lengths.slice(0, plank.actor.findIndex((segment) => segment.event === event) + 1).reduce((sum, ms) => sum + ms, 0);
    expect(lengths.slice(0, 4)).toEqual([HOP_MS, PLANK_WALK_MS, TEETER_MS, JUMP_MS]);
    expect(lengths.slice(4, 6)).toEqual([PLUNGE_MS, BOB_UP_MS]);
    expect(ends("impact")).toBe(IMPACT_AT);
    expect(ends("chomp")).toBe(CHOMP_AT);
    expect(lengths.reduce((sum, ms) => sum + ms, 0)).toBe(PLANK_EXIT_MS);
    expect(plank.actor[5]!.reveal).toEqual([0, { rows: SWIM_ROWS }]);
    const keys = Object.fromEntries(plank.effects.flatMap((effect) => effect.keys.map((key) => [`${effect.effect}:${key.frame}:${key.at.event}`, key])));
    const at = (key: { at: { event: string; plusMs: number } }) => (key.at.event === "impact" ? IMPACT_AT : CHOMP_AT) + key.at.plusMs;
    expect(at(keys["shark:fin:impact"]!)).toBe(FIN_AT);
    expect(keys["shark:fin:impact"]).toMatchObject({ ms: FIN_MS, approach: { px: FIN_RUN } });
    expect(at(keys["shark:surface:impact"]!)).toBe(FIN_AT + FIN_MS);
    expect(keys["shark:surface:impact"]!.ms).toBe(SURFACE_MS);
    expect(keys["shark:chomp:chomp"]!.ms).toBe(CHOMP_MS);
    expect(at(keys["shark:submerge:chomp"]!) + keys["shark:submerge:chomp"]!.ms).toBe(PLANK_EXIT_MS);
    expect(keys["shark:submerge:chomp"]!.ms).toBe(SUBMERGE_MS);
    expect([keys["splash:impact:impact"]!.ms, keys["splash:burst:impact"]!.ms]).toEqual(SPLASH_FRAMES.map((frame) => frame.ms));
    const shark = ship.effects.shark!;
    expect([shark.points.mouth![0] - shark.points.anchor![0], shark.points.mouth![1] - shark.points.anchor![1]]).toEqual(SHARK_MOUTH);
    for (const why of ["done", "failed", "closed", "removed"] as const) expect(ship.portals.byDeparture[why] === "plank", why).toBe(PLANK_DEPARTURES.has(why));
  });

});
