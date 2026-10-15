/**
 * The water's host (`docs/ship-deck-water/host.jsx`), plus what the weather's checks need:
 *
 * - `?working=N` on the page puts the first N live crewmates of the fixture fleet to work and the rest to rest
 *   (Idle) before the first fleet load; `window.setWorking(N)` does the same for the next poll;
 * - `window.atmosphereTable(counts)` is the weather the deck draws for each count of working crewmates, from the
 *   deck's own `crewIntensity` and `atmosphereAt`.
 */
import "../ship-deck-water/host.jsx";
import { atmosphereAt, crewIntensity } from "../../client/deck-atmosphere";
import { deckScene, hasLiveWorker } from "../../client/deck-scene";

function withWorking(fleet, count) {
  let put = 0;
  const cards = fleet.cards.map(function (card) {
    if (!hasLiveWorker(card) || card.column === "done" || card.column === "queued") return card;
    put += 1;
    return { ...card, column: put <= count ? "working" : "idle", note: null };
  });
  return { ...fleet, cards };
}

const mount = window.mountPlugin;
window.mountPlugin = function mountPlugin(source, params) {
  mount(source, params);
  const working = params.get("working");
  if (working !== null) window.fixtureFleet = withWorking(window.fixtureFleet, Number(working));
};

window.setWorking = function setWorking(count) {
  window.fixtureFleet = withWorking(window.fixtureFleet, count);
};

/** The fixture fleet with `count` of its live crewmates working, for hosts built on this one. */
window.atmosphereFleet = (count) => withWorking(window.fixtureFleet, count);

window.atmosphereTable = function atmosphereTable(counts) {
  return counts.map(function (count) {
    const sailors = deckScene(withWorking(window.fixtureFleet, count).cards, window.fixtureTheme).sailors;
    const intensity = crewIntensity(sailors);
    return { working: count, onDeck: sailors.length, intensity, weather: atmosphereAt(intensity) };
  });
};
