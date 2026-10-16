/**
 * The board-list harness's host stubs, with the fleet answered by the page's fixture and every deck RPC
 * (`firstmate.deck.*`) forwarded, by its name and input, to the gate's server, which answers it from the
 * checkout the page was opened for (`?tree=main` or `?tree=branch`). Nothing here knows which deck RPCs a
 * checkout has, so main's bundle and the branch's are served alike whatever their contracts are.
 */
import { useSyncExternalStore } from "react";
import { useSettings as boardListSettings, useRpc as boardListRpc } from "../board-list/stubs.jsx";

export * from "../board-list/stubs.jsx";

window.deckRpcCalls = {};

window.fleetLoads = 0;

/** The fleet load; `window.fixtureFleetError` makes it fail, as a lost daemon would. */
function loadFleet() {
  window.fleetLoads += 1;
  if (window.fixtureFleetError) return Promise.reject(new Error("Request failed: the daemon is unreachable"));
  return Promise.resolve(structuredClone(window.fixtureFleet));
}

function deckRpc(name) {
  return function (input) {
    window.deckRpcCalls[name] = (window.deckRpcCalls[name] ?? 0) + 1;
    const tree = new URLSearchParams(location.search).get("tree");
    return fetch(`/rpc/${tree}/${name}`, { method: "POST", body: JSON.stringify(input ?? {}) }).then(function (response) {
      if (!response.ok) return response.text().then((text) => Promise.reject(new Error(`Request failed: ${text}`)));
      return response.json();
    });
  };
}

export function useRpc(contract) {
  if (contract.name === "firstmate.fleet.load") return loadFleet;
  if (contract.name.startsWith("firstmate.deck.")) return deckRpc(contract.name);
  if (contract.name === "firstmate.mate.ask" && window.fixtureSharkSend) return input => {
    window.fixtureCalls.push({ name: contract.name, input });
    return new Promise((resolve, reject) => { window.finishSharkSend = error => error ? reject(new Error(error)) : resolve({ agentId: "mate" }); });
  };
  return boardListRpc(contract);
}

// The render/overlay harness selects the same global display field as the app, from ?setting=.
const params = new URLSearchParams(location.search);
// Opt-in browser storage stands in for the host's persisted document during the switcher reload check.
const persistScene = params.get("persistScene") === "1";
let selectedSetting = (persistScene ? localStorage.getItem("firstmate-deck-setting") : null) ?? params.get("setting") ?? "ship";
const settingListeners = new Set();
window.selectDeckSetting = (id) => { selectedSetting = id; for (const listener of settingListeners) listener(); };
export function useSettings(contract) {
  const settings = boardListSettings(contract);
  const deckSetting = useSyncExternalStore((listener) => { settingListeners.add(listener); return () => settingListeners.delete(listener); }, () => selectedSetting);
  return { ...settings, values: { ...settings.values, deckSetting }, save: async (next) => {
    if (window.failSceneSave) return false;
    if (persistScene) localStorage.setItem("firstmate-deck-setting", next.deckSetting ?? "ship");
    window.selectDeckSetting(next.deckSetting ?? "ship");
    return settings.save(next);
  } };
}
