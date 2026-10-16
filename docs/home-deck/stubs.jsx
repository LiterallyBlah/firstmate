export * from "../shell-phase1/stubs.jsx";
import { useCallback, useState } from "react";
import { useRpc as shellRpc } from "../shell-phase1/stubs.jsx";

const listFiles = async ({ path }) => ({ home: "C:/Sample/FirstMate", path, entries: [] });
export function useRpc(contract) {
  return contract.name === "firstmate.files.list" ? listFiles : shellRpc(contract);
}

// The host settings document survives remounts and browser restarts in this fixture.
export function useSettings(contract) {
  const [values, setValues] = useState(() =>
    contract.schema.parse({
      chatWidthFraction: 0.55,
      pollSeconds: 120,
      ...JSON.parse(localStorage.getItem(contract.id) ?? "{}"),
    }),
  );
  const [revision, setRevision] = useState(1);
  const save = useCallback(
    async (next) => {
      localStorage.setItem(contract.id, JSON.stringify(next));
      window.fixtureSettings = next;
      setValues(next);
      setRevision((r) => r + 1);
      return true;
    },
    [contract.id],
  );
  return { status: "ready", values, revision, save, saveError: null };
}
