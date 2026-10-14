/**
 * The board-list harness's host stubs, with the three RPCs this check needs answered by the page: the fleet
 * load (the fixture, with or without the switch), the deck engine (the build the daemon would send) and
 * the deck's art (the atlas and manifest it would send) — and the generated environment, for a page that
 * serves `/deck-environment.json` (`docs/ship-deck-environment/render.mjs`); elsewhere it fails to load and
 * the deck draws its plain sea.
 */
import { useRpc as boardListRpc } from "../board-list/stubs.jsx";

export * from "../board-list/stubs.jsx";

window.deckEngineCalls = 0;
window.deckArtCalls = 0;
window.deckEnvironmentCalls = 0;

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

function loadDeckEnvironment() {
  window.deckEnvironmentCalls += 1;
  return fetch("/deck-environment.json").then((response) => {
    if (!response.ok || !response.headers.get("Content-Type")?.includes("json")) throw new Error("no environment served");
    return response.json();
  });
}

export function useRpc(contract) {
  if (contract.name === "firstmate.fleet.load") return loadFleet;
  if (contract.name === "firstmate.deck.engine") return loadDeckEngine;
  if (contract.name === "firstmate.deck.art") return loadDeckArt;
  if (contract.name === "firstmate.deck.environment") return loadDeckEnvironment;
  return boardListRpc(contract);
}
