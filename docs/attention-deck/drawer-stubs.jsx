export * from "../deck-settings/stubs.jsx";
import { useRpc as deckRpc } from "../deck-settings/stubs.jsx";

const read = async () => structuredClone(window.fixtureFleet.needsYou);
export function useRpc(contract) {
  if (contract.name === "firstmate.needs-you.read") return read;
  if (contract.name.startsWith("firstmate.needs-you.")) return async input => {
    window.fixtureCalls.push({ name: contract.name, input });
    if (contract.name !== "firstmate.needs-you.seen") throw new Error("Opening a Deck decision must only mark it Seen");
    const snapshot = window.fixtureFleet.needsYou;
    const request = snapshot.requests.find(row => row.id === input.id);
    if (!request || request.revision !== input.revision || snapshot.homeId !== input.homeId) throw new Error("Stale Seen target");
    request.state = "seen";
    request.seenAt = Date.now();
    request.seenRevision = request.revision;
    snapshot.newCount = snapshot.requests.filter(row => row.state === "new").length;
    snapshot.version++;
    snapshot.freshness.checkedAt++;
    return structuredClone(snapshot);
  };
  return deckRpc(contract);
}
