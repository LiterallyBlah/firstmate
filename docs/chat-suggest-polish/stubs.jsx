export * from "../shell-phase1/stubs.jsx";
import { useRpc as baseRpc } from "../shell-phase1/stubs.jsx";
import { useSettings as baseSettings } from "../board-list/stubs.jsx";
import { fleet } from "../board-list/fixtures.js";
export function useSettings(contract) {
  const settings = baseSettings(contract);
  return {
    ...settings,
    values: { ...settings.values, chatWidthFraction: 0.25 },
  };
}
const remove = async (input) => {
  window.fixtureCalls.push({ name: "firstmate.suggestion.remove", input });
  if (window.delayRemoval)
    await new Promise((resolve) => {
      window.finishRemoval = resolve;
    });
  if (window.failRemoval) throw new Error("Fixture removal failed");
  fleet.suggestions = fleet.suggestions.filter(
    (s) => s.label !== input.label || s.prompt !== input.prompt,
  );
  return { suggestions: fleet.suggestions };
};
export function useRpc(contract) {
  return contract.name === "firstmate.suggestion.remove"
    ? remove
    : baseRpc(contract);
}
