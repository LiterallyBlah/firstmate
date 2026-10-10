export * from "../board-list/stubs.jsx";
import { useCallback, useState } from "react";

// Only the host settings adapter is replaced. The real FleetSurface batches
// commits; localStorage lets the fixture verify a fresh mount/page readback.
export function useSettings(contract) {
  const key = `fixture:${contract.id}`;
  const [values, setValues] = useState(() =>
    contract.schema.parse(JSON.parse(localStorage.getItem(key) ?? "{}")),
  );
  const [revision, setRevision] = useState(1);
  const save = useCallback(
    async (next) => {
      (window.fixtureSaves ??= []).push(next);
      localStorage.setItem(key, JSON.stringify(next));
      setValues(next);
      setRevision((r) => r + 1);
      return true;
    },
    [key],
  );
  return { status: "ready", values, revision, save, saveError: null };
}
