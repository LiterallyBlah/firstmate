/**
 * A setting's ambience, compiled (`client/deck-ambience.ts`): which elements are drawn when every image arrived and
 * when some did not — each left out on its own, with what is drawn in it or under it, a fallback only in place of what
 * it stands in for, a tile with neither filled flat, variants and drifters a sprite at a time — and how each moves under
 * each plan. Against the ship's pack, and small packs made from it.
 */
import { describe, expect, it } from "vitest";

import { compileAmbience, elementMotion, elementsOf } from "./deck-ambience";
import { shipElement, shipManifest } from "../test/ship-pack";
import type { SettingManifest } from "../shared/deck-setting";

const ship = shipManifest();
const all = () => true;
const shipElementBands = (id: string) => shipElement(id, "tile").bands;
/** What is drawn of the sky, the elements before the sea. */
const SKY = ["sky", "overcast", "stars", "lightning", "clouds", "gull"];
const CREATURES = ["weather-serpent", "weather-kraken"];
const WATER = ["sea", "wake", "foam", "spindrift", ...CREATURES];
const ids = (manifest: SettingManifest, has: (image: string) => boolean = all, masked: (image: string) => boolean = all) =>
  compileAmbience(manifest, has, masked).elements.map((element) => element.id);
/** The sky's part of what is drawn. */
const sky = (manifest: SettingManifest, has: (image: string) => boolean = all, masked: (image: string) => boolean = all) =>
  ids(manifest, has, masked).filter((id) => SKY.includes(id));
const without =
  (...gone: string[]) =>
  (image: string) =>
    !gone.includes(image);

describe("the ship's ambience, compiled", () => {
  it("draws the sky, its overcast and stars, the lightning, the clouds, the gull, the sea, wake, foam and spray, in the pack's order, with its day", () => {
    const ambience = compileAmbience(ship, all);
    expect(ambience.elements.map((element) => [element.id, element.slot, element.order])).toEqual([
      ["sky", "back", 0],
      ["overcast", "back", 1],
      ["stars", "back", 2],
      ["lightning", "back", 3],
      ["clouds", "back", 4],
      ["gull", "back", 5],
      ["sea", "back", 6],
      ["wake", "front", 7],
      ["foam", "front", 8],
      ["spindrift", "front", 9],
      ["weather-serpent", "front", 10],
      ["weather-kraken", "front", 10],
    ]);
    expect(ambience.elements.every((element) => element.place === element.id)).toBe(true);
    expect([ambience.flats, ambience.fallbackFill]).toEqual([[], 0x15304a]);
    expect(ambience.dayCycle).toBe(ship.dayCycle);
    expect(ambience.missing).toEqual([]);
    expect(ambience.sizes.get("gull-flap-strip")).toEqual([96, 32]);
    expect(elementsOf(ambience, "drifters").map((element) => element.id)).toEqual(["clouds"]);
  });

  it("leaves out an element whose image did not arrive, and what is drawn in it or under it, naming what it lacked", () => {
    const skyless = compileAmbience(ship, without("sky-dawn"));
    expect(skyless.elements.map((element) => element.id)).toEqual(["gull", ...WATER]);
    expect(skyless.missing).toEqual(["sky-dawn"]);
    expect(sky(ship, without("sky-stars"))).toEqual(["sky", "overcast", "lightning", "clouds", "gull"]);
    expect(sky(ship, without("enrichment-lightning-1"))).toEqual(["sky", "overcast", "stars", "clouds", "gull"]);
    expect(sky(ship, without("gull-flap-strip"))).toEqual(["sky", "overcast", "stars", "lightning", "clouds"]);
  });

  it("draws the clouds from those whose image arrived and cut, and the lightning only while there are any", () => {
    const some = compileAmbience(ship, without("clouds-wisp"), without("clouds-puff"));
    const [clouds] = elementsOf(some, "drifters");
    expect(clouds!.behaviour.sprites.map((sprite) => sprite.id)).toEqual(["cumulus", "long-bank", "twin-bank"]);
    expect(some.missing).toEqual(["clouds-puff", "clouds-wisp"]);
    const none = (image: string) => !image.startsWith("clouds-");
    expect(sky(ship, all, none)).toEqual(["sky", "overcast", "stars", "gull"]);
  });

  it("drops a thunderhead on its own when its frame did not cut or is not its cloud's size", () => {
    const [clouds] = elementsOf(compileAmbience(ship, all, without("storm-clouds-puff")), "drifters");
    expect(clouds!.behaviour.sprites.map((sprite) => [sprite.id, sprite.variants!.length])).toEqual([
      ["wisp", 1],
      ["puff", 0],
      ["cumulus", 1],
      ["long-bank", 1],
      ["twin-bank", 1],
    ]);
    const misfit: SettingManifest = { ...ship, images: { ...ship.images, "storm-clouds-wisp": { ...ship.images["storm-clouds-wisp"]!, size: [40, 12] } } };
    const [resized] = elementsOf(compileAmbience(misfit, all), "drifters");
    expect(resized!.behaviour.sprites[0]!.variants).toEqual([]);
  });

  it("draws no backdrop without a day to cycle through", () => {
    const { dayCycle: _dayCycle, ...dayless } = ship;
    expect(sky(dayless as SettingManifest)).toEqual(["gull"]);
  });
});

describe("wall-clock frames, compiled", () => {
  it("requires all frames, uses a fallback in place, and leaves unrelated elements independent", () => {
    const indicator = {
      id: "indicator", slot: "front", order: 2, lite: "run", still: "first-frame", fallback: "backup",
      behaviour: { kind: "phase-frames", by: "local-hour", at: [30, 40], anchor: [2, 3], frames: [{ image: "deck" }, { image: "sky-dawn" }] },
    } satisfies SettingManifest["ambience"][number];
    const backup = { ...indicator, id: "backup", fallback: undefined, behaviour: { ...indicator.behaviour, frames: [{ image: "deck" }] } };
    const manifest: SettingManifest = { ...ship, ambience: [indicator, backup, { ...backup, id: "independent", order: 1 }] };
    expect(ids(manifest)).toEqual(["independent", "indicator"]);
    const partial = compileAmbience(manifest, without("sky-dawn"));
    expect(partial.elements.map((element) => [element.id, element.place])).toEqual([["independent", "independent"], ["backup", "indicator"]]);
    expect(partial.missing).toEqual(["sky-dawn"]);
    expect(compileAmbience(manifest, without("deck")).elements).toEqual([]);
  });
});

describe("the ship's water, compiled", () => {
  it("drops a creature or its surface variant independently when one image fails", () => {
    const missingBody = compileAmbience(ship, without("enrichment-serpent-loom-2"));
    expect(missingBody.elements.map((element) => element.id)).not.toContain("weather-serpent");
    expect(missingBody.elements.map((element) => element.id)).toContain("weather-kraken");
    const missingSurface = compileAmbience(ship, without("enrichment-serpent-2"));
    const serpent = elementsOf(missingSurface, "cycle").find((element) => element.id === "weather-serpent")!;
    expect(serpent.behaviour.variants).toEqual([]);
    expect(missingSurface.elements.map((element) => element.id)).toContain("sea");
  });

  it("draws the still sea and foam only in place of the animated ones, under their names, and the sea flat with neither", () => {
    const stillSea = compileAmbience(ship, without("water-sea-frame-2"));
    expect(stillSea.elements.filter((element) => !SKY.includes(element.id)).map((element) => [element.id, element.place])).toEqual([
      ["sea-still", "sea"],
      ["wake", "wake"],
      ["foam", "foam"],
      ["spindrift", "spindrift"],
      ...CREATURES.map((id) => [id, id]),
    ]);
    expect(stillSea.flats).toEqual([]);
    expect(ids(ship, without("water-foam-frame-1"))).toEqual([...SKY, "sea", "wake", "foam-still", "spindrift", ...CREATURES]);
    const flat = compileAmbience(ship, without("water-sea-frame-2", "sea-water-tile"));
    expect(flat.elements.map((element) => element.id)).toEqual([...SKY, "wake", "foam", "spindrift", ...CREATURES]);
    expect(flat.flats.map((element) => [element.id, element.place, element.behaviour.bands])).toEqual([["sea", "sea", shipElementBands("sea")]]);
    expect(flat.missing).toEqual(["sea-water-tile", "water-sea-frame-2"]);
    // Neither foam: no foam, and nothing filled flat for it; a strip is not ground the stage stands on.
    const foamless = compileAmbience(ship, without("water-foam-frame-1", "sea-foam-strip"));
    expect([foamless.elements.some((element) => element.id.startsWith("foam")), foamless.flats]).toEqual([false, []]);
  });

  it("leaves out a variant whose frame did not arrive or that does not line up, and keeps its element", () => {
    const variantsOf = (id: string, has: (image: string) => boolean = all, manifest: SettingManifest = ship) => {
      const element = compileAmbience(manifest, has).elements.find((each) => each.id === id)!;
      return "variants" in element.behaviour ? (element.behaviour.variants ?? []).map((variant) => variant.id) : [];
    };
    expect([variantsOf("sea"), variantsOf("wake"), variantsOf("foam")]).toEqual([["rough-sea"], ["heavy-wake"], []]);
    expect(variantsOf("sea", without("storm-sea-frame-2"))).toEqual([]);
    expect(ids(ship, without("storm-sea-frame-2"))).toContain("sea");
    // Fewer frames than the wake, or a frame of another size: left out.
    const wake = ship.ambience.find((element) => element.id === "wake")!;
    if (wake.behaviour.kind !== "cycle") throw new Error("the wake is a cycle");
    const short = { ...wake, behaviour: { ...wake.behaviour, variants: wake.behaviour.variants!.map((variant) => ({ ...variant, frames: variant.frames.slice(0, 2) })) } };
    expect(variantsOf("wake", all, { ...ship, ambience: ship.ambience.map((element) => (element.id === "wake" ? short : element)) })).toEqual([]);
    const resized: SettingManifest = { ...ship, images: { ...ship.images, "storm-sea-frame-0": { ...ship.images["storm-sea-frame-0"]!, size: [128, 128] } } };
    expect(variantsOf("sea", all, resized)).toEqual([]);
    // The spray stands alone: without a frame of it, it is not drawn, and nothing else goes with it.
    expect(ids(ship, without("storm-spray-frame-0"))).toEqual([...SKY, "sea", "wake", "foam", ...CREATURES]);
  });
});

describe("fallbacks and needs", () => {
  // The ship's sky, and an overlay on it; a second overlay stands in for the first.
  const sky = ship.ambience.find((element) => element.id === "sky")!;
  const stars = ship.ambience.find((element) => element.id === "stars")!;
  const gull = ship.ambience.find((element) => element.id === "gull")!;
  const pack = (ambience: SettingManifest["ambience"]): SettingManifest => ({ ...ship, ambience });
  const spare = { ...stars, id: "spare-stars", behaviour: { ...stars.behaviour, image: "storm-sky-overcast" } } as SettingManifest["ambience"][number];
  const withFallback = pack([sky, { ...stars, fallback: "spare-stars" }, spare]);

  it("draws a fallback only in place of what it stands in for", () => {
    expect(ids(withFallback)).toEqual(["sky", "stars"]);
    expect(ids(withFallback, without("sky-stars"))).toEqual(["sky", "spare-stars"]);
    expect(ids(withFallback, without("sky-stars", "storm-sky-overcast"))).toEqual(["sky"]);
  });

  it("draws what needs another only with it, and a fallback for what goes without", () => {
    const needy = pack([sky, { ...gull, needs: ["stars"] }, stars]);
    expect(ids(needy)).toEqual(["sky", "stars", "gull"]);
    expect(ids(needy, without("sky-stars"))).toEqual(["sky"]);
    const chained = pack([sky, { ...stars, needs: ["gull"], fallback: "spare-stars" }, spare, gull]);
    expect(ids(chained, without("gull-flap-strip"))).toEqual(["sky", "spare-stars"]);
  });
});

describe("how an element moves", () => {
  const plan = (level: "full" | "lite" | "still") => ({ level });

  it("runs in full motion, and does as it says on a software renderer and under reduced motion", () => {
    expect(elementMotion({ lite: "hide", still: "hide" }, plan("full"))).toBe("run");
    expect(elementMotion({ lite: "run", still: "first-frame" }, plan("lite"))).toBe("run");
    expect(elementMotion({ lite: "freeze", still: "first-frame" }, plan("lite"))).toBe("hold");
    expect(elementMotion({ lite: "hide", still: "first-frame" }, plan("lite"))).toBe("hide");
    expect(elementMotion({ lite: "run", still: "first-frame" }, plan("still"))).toBe("hold");
    expect(elementMotion({ lite: "run", still: "hide" }, plan("still"))).toBe("hide");
  });

  it("is the ship's: the clouds held and the gull and lightning gone on a software renderer, the overcast gone when still", () => {
    const of = (id: string) => ship.ambience.find((element) => element.id === id)!;
    expect(["clouds", "gull", "lightning", "overcast"].map((id) => elementMotion(of(id), plan("lite")))).toEqual(["hold", "hide", "hide", "run"]);
    expect(["sky", "stars", "clouds", "overcast"].map((id) => elementMotion(of(id), plan("still")))).toEqual(["hold", "hold", "hold", "hide"]);
  });
});
