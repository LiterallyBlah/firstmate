export * from "../board-list/stubs.jsx";
import { useRpc as baseRpc, useSettings as baseSettings } from "../board-list/stubs.jsx";
import { fleet } from "../board-list/fixtures.js";

fleet.mate.requiresAttention = true;
if (new URLSearchParams(location.search).has("adopted")) fleet.mateInHome = false;
const remoteRpc = new Map();
export function useRpc(contract) {
  if (!contract.name.startsWith("firstmate.deck.")) return baseRpc(contract);
  if (!remoteRpc.has(contract.name))
    remoteRpc.set(contract.name, async (input) => {
      const result = await fetch(`/rpc/${contract.name}`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!result.ok) throw new Error(await result.text());
      return result.json();
    });
  return remoteRpc.get(contract.name);
}
export function useSettings(contract) {
  const settings = baseSettings(contract);
  return { ...settings, values: { ...settings.values, deckSetting: "office" } };
}
