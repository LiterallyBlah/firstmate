export * from "../toolbar-help/stubs";
import { useRpc as baseRpc } from "../toolbar-help/stubs";
const handlers = new Map();
const mode = new URLSearchParams(location.search).get("state") ?? "available";
const initial =
  mode === "current"
    ? {
        state: "current",
        explanation:
          "The running FirstMate revision matches the latest revision from its configured source.",
      }
    : mode === "unavailable"
      ? {
          state: "unavailable",
          explanation:
            "FirstMate's configured source or running revision could not be verified. The next check will retry.",
        }
      : {
          state: "available",
          latest: "bbbbbbbb",
          token: "b".repeat(64),
          requested: false,
          explanation:
            "FirstMate bbbbbbbb is available from its configured source. Ask the first mate to install this revision.",
        };
export function useRpc(contract) {
  const base = baseRpc(contract);
  if (!handlers.has(contract.name))
    handlers.set(contract.name, async (input) => {
      if (contract.name === "firstmate.mate.candidates")
        return { home: "C:/Sample/FirstMate", agents: [] };
      if (contract.name === "firstmate.update.check") {
        if (mode === "checking")
          await new Promise((resolve) => {
            window.releaseCheck = resolve;
          });
        return structuredClone(initial);
      }
      if (contract.name === "firstmate.update.request") {
        window.fixtureCalls.push({ name: contract.name, input });
        await new Promise((resolve) => {
          window.releaseRequest = resolve;
        });
        if (window.fixtureStale)
          return {
            status: {
              state: "current",
              explanation:
                "The running FirstMate revision matches its configured source.",
            },
            agentId: null,
          };
        window.fixtureMessages = (window.fixtureMessages ?? 0) + 1;
        return {
          status: {
            ...initial,
            requested: true,
            explanation:
              "Installation of FirstMate bbbbbbbb was requested. The running revision has not changed yet.",
          },
          agentId: "mate",
        };
      }
      const output = await base(input);
      if (contract.name === "firstmate.config.read")
        Object.assign(output.config, { mateProvider: "", mateModeId: "" });
      if (contract.name === "firstmate.fleet.load" && mode === "no-mate")
        output.mate = null;
      return output;
    });
  return handlers.get(contract.name);
}
