export * from "./header-stubs.jsx";
import { useRpc as baseRpc } from "./header-stubs.jsx";
import { useCallback, useState } from "react";
import { fleet } from "../board-list/fixtures.js";

// One local and one remote item exercise the same plain-tag filter in both views.
for (const card of fleet.cards) if (["work-0", "block-0"].includes(card.key)) card.tags = ["layout"];
const handlers = new Map();
export function useRpc(contract) {
  const base = baseRpc(contract);
  if (!handlers.has(contract.name))
    handlers.set(contract.name, async (input) => {
      if (contract.name === "firstmate.files.list") return { home: fleet.home, path: input.path, entries: [] };
      return base(input);
    });
  return handlers.get(contract.name);
}

// Host settings are persisted here only to exercise reload/remount in the fixture.
export function useSettings(contract) {
  const [values, setValues] = useState(() =>
    contract.schema.parse({
      chatWidthFraction: 0.45,
      ...JSON.parse(localStorage.getItem("firstmate-display") ?? "{}"),
    }),
  );
  const [revision, setRevision] = useState(1);
  const save = useCallback(async (next) => {
    window.fixtureSettings = next;
    localStorage.setItem("firstmate-display", JSON.stringify(next));
    setValues(next);
    setRevision((value) => value + 1);
    return true;
  }, []);
  return { status: "ready", values, revision, save, saveError: null };
}
