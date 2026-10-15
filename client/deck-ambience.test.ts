/**
 * A setting's ambience, compiled (`client/deck-ambience.ts`): which elements are drawn when every image arrived and
 * when some did not — each left out on its own, with what is drawn in it or under it, a fallback only in place of what
 * it stands in for, drifters a sprite and a variant at a time — and how each moves under each plan. Against the ship's
 * pack, and small packs made from it.
 */
import { describe, expect, it } from "vitest";

import { compileAmbience, elementMotion, elementsOf } from "./deck-ambience";
import { shipManifest } from "../test/ship-pack";
import type { SettingManifest } from "../shared/deck-setting";

const ship = shipManifest();
const all = () => true;
const ids = (manifest: SettingManifest, has: (image: string) => boolean = all, masked: (image: string) => boolean = all) =>
  compileAmbience(manifest, has, masked).elements.map((element) => element.id);
const without =
  (...gone: string[]) =>
  (image: string) =>
    !gone.includes(image);

describe("the ship's ambience, compiled", () => {
  it("draws the sky, its overcast and stars, the lightning, the clouds and the gull, in the pack's order, with its day", () => {
    const ambience = compileAmbience(ship, all);
    expect(ambience.elements.map((element) => [element.id, element.slot, element.order])).toEqual([
      ["sky", "back", 0],
      ["overcast", "back", 1],
      ["stars", "back", 2],
      ["lightning", "back", 3],
      ["clouds", "back", 4],
      ["gull", "back", 5],
    ]);
    expect(ambience.dayCycle).toBe(ship.dayCycle);
    expect(ambience.missing).toEqual([]);
    expect(ambience.sizes.get("gull-flap-strip")).toEqual([96, 32]);
    expect(elementsOf(ambience, "drifters").map((element) => element.id)).toEqual(["clouds"]);
  });

  it("leaves out an element whose image did not arrive, and what is drawn in it or under it, naming what it lacked", () => {
    const skyless = compileAmbience(ship, without("sky-dawn"));
    expect(skyless.elements.map((element) => element.id)).toEqual(["gull"]);
    expect(skyless.missing).toEqual(["sky-dawn"]);
    expect(ids(ship, without("sky-stars"))).toEqual(["sky", "overcast", "lightning", "clouds", "gull"]);
    expect(ids(ship, without("storm-lightning-frame-1"))).toEqual(["sky", "overcast", "stars", "clouds", "gull"]);
    expect(ids(ship, without("gull-flap-strip"))).toEqual(["sky", "overcast", "stars", "lightning", "clouds"]);
  });

  it("draws the clouds from those whose image arrived and cut, and the lightning only while there are any", () => {
    const some = compileAmbience(ship, without("clouds-wisp"), without("clouds-puff"));
    const [clouds] = elementsOf(some, "drifters");
    expect(clouds!.behaviour.sprites.map((sprite) => sprite.id)).toEqual(["cumulus", "long-bank", "twin-bank"]);
    expect(some.missing).toEqual(["clouds-puff", "clouds-wisp"]);
    const none = (image: string) => !image.startsWith("clouds-");
    expect(ids(ship, all, none)).toEqual(["sky", "overcast", "stars", "gull"]);
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
    expect(ids(dayless as SettingManifest)).toEqual(["gull"]);
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
