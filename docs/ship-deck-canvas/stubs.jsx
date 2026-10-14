/**
 * The board-list harness's host stubs, with the two RPCs this check needs answered by the page: the fleet
 * load (the fixture, with or without the switch) and the deck engine (the build the daemon would send).
 */
import { useRpc as boardListRpc } from "../board-list/stubs.jsx";

export * from "../board-list/stubs.jsx";

window.deckEngineCalls = 0;

function loadFleet() {
  return Promise.resolve(structuredClone(window.fixtureFleet));
}

function loadDeckEngine() {
  window.deckEngineCalls += 1;
  return fetch("/deck-engine.json").then((response) => response.json());
}

export function useRpc(contract) {
  if (contract.name === "firstmate.fleet.load") return loadFleet;
  if (contract.name === "firstmate.deck.engine") return loadDeckEngine;
  return boardListRpc(contract);
}
