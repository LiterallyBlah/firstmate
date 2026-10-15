/**
 * The board-list harness's host stubs, with the fleet answered by the page's fixture and every deck RPC
 * (`firstmate.deck.*`) forwarded, by its name and input, to the gate's server, which answers it from the
 * checkout the page was opened for (`?tree=main` or `?tree=branch`). Nothing here knows which deck RPCs a
 * checkout has, so main's bundle and the branch's are served alike whatever their contracts are.
 */
import { useRpc as boardListRpc } from "../board-list/stubs.jsx";

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
  return boardListRpc(contract);
}
