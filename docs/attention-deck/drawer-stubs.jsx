export * from "../deck-settings/stubs.jsx";
import { useRpc as deckRpc } from "../deck-settings/stubs.jsx";

const read = async () => structuredClone(window.fixtureFleet.needsYou);
export function useRpc(contract) {
  if (contract.name === "firstmate.needs-you.read") return read;
  if (contract.name.startsWith("firstmate.needs-you.")) return async input => {
    window.fixtureCalls.push({ name: contract.name, input });
    throw new Error("Opening a Deck decision must not mutate the ledger");
  };
  return deckRpc(contract);
}
