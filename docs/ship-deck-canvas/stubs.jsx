/**
 * The board-list harness's host stubs, with the three RPCs this check needs answered by the page: the fleet
 * load (the fixture, with or without the switch), the deck engine (the build the daemon would send) and
 * the deck's art (the atlas and manifest it would send).
 */
import { useRpc as boardListRpc } from "../board-list/stubs.jsx";

export * from "../board-list/stubs.jsx";

window.deckEngineCalls = 0;
window.deckArtCalls = 0;

/** The fleet load; `window.fixtureFleetError` makes it fail, as a lost daemon would. */
function loadFleet() {
  if (window.fixtureFleetError) return Promise.reject(new Error("Request failed: the daemon is unreachable"));
  return Promise.resolve(structuredClone(window.fixtureFleet));
}

function loadDeckEngine() {
  window.deckEngineCalls += 1;
  return fetch("/deck-engine.json").then((response) => response.json());
}

function loadDeckArt() {
  window.deckArtCalls += 1;
  return fetch("/deck-art.json").then((response) => response.json());
}

export function useRpc(contract) {
  if (contract.name === "firstmate.fleet.load") return loadFleet;
  if (contract.name === "firstmate.deck.engine") return loadDeckEngine;
  if (contract.name === "firstmate.deck.art") return loadDeckArt;
  return boardListRpc(contract);
}
