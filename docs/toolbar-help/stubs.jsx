export * from "../controls-resize/stubs";
import { useRpc as baseRpc } from "../board-list/stubs";
const handlers = new Map();
export function useRpc(contract) {
  const base = baseRpc(contract);
  if (!handlers.has(contract.name))
    handlers.set(contract.name, async (input) => {
      if (window.fixtureFreezePolling && /(?:fleet.load|config.read|remotes.read)$/.test(contract.name)) await new Promise(() => {});
      if (contract.name === "firstmate.files.list") return { home: "C:/Sample/FirstMate", path: "", entries: [] };
      if (
        contract.name === "firstmate.fleet.load" &&
        window.fixtureHoldRefresh
      ) {
        await new Promise((resolve) => {
          window.fixtureReleaseRefresh = resolve;
        });
      }
      if (
        contract.name === "firstmate.crew.interrupt" &&
        window.fixtureHoldAction
      ) {
        await new Promise((resolve) => {
          window.fixtureReleaseAction = resolve;
        });
      }
      if (contract.name === "firstmate.watch.options")
        return {
          available: false,
          reason: "Fixture only",
          thinking: [],
          boardReview: null,
        };
      if (contract.name === "firstmate.watch.history") return { runs: [] };
      return base(input);
    });
  return handlers.get(contract.name);
}
