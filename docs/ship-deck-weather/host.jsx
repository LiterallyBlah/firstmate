/**
 * The weather's host (`docs/ship-deck-atmosphere/host.jsx`: `?working=N`, `window.setWorking`), plus
 * `window.weatherLayers(counts)`: for each count of working crewmates, the intensity the deck draws and every weather
 * layer's opacity at it, from the deck's own functions and `art/ship-deck/extras.json`'s curves.
 */
import "../ship-deck-atmosphere/host.jsx";
import extras from "../../art/ship-deck/extras.json";
import { crewIntensity } from "../../client/deck-atmosphere";
import { curveAt, opacityAt } from "../../client/deck-variants";
import { deckScene } from "../../client/deck-scene";

window.weatherLayers = function weatherLayers(counts) {
  return counts.map(function (count) {
    const sailors = deckScene(window.atmosphereFleet(count).cards, window.fixtureTheme).sailors;
    const intensity = crewIntensity(sailors);
    const round = (value) => Math.round(value * 100) / 100;
    const layers = {};
    for (const variant of extras.variants ?? []) layers[variant.id] = round(opacityAt(variant.opacity, intensity));
    for (const cycle of extras.cycles ?? []) layers[cycle.id] = round(opacityAt(cycle.opacity, intensity));
    for (const overlay of extras.mood?.overlays ?? []) layers[overlay.id] = round(opacityAt(overlay.opacity, intensity));
    for (const flash of extras.flashes ?? []) {
      layers[flash.id] = round(opacityAt(flash.opacity, intensity));
      layers[`${flash.id} a minute`] = round(curveAt(flash.perMinute, intensity));
    }
    return { working: count, onDeck: sailors.length, intensity: round(intensity), layers };
  });
};
