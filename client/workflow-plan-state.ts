import { useSyncExternalStore } from "react";

export type PlanBrowseState = {
  filter: string | null;
  search: string;
  view: "graph" | "list";
  expanded: Readonly<Record<string, boolean>>;
  groups: Readonly<Record<string, boolean>>;
  limits: Readonly<Record<string, number>>;
  scrollY: number;
  graphX: Readonly<Record<string, number>>;
  helpSeen: boolean;
};
const empty: PlanBrowseState = { filter: null, search: "", view: "graph", expanded: {}, groups: {}, limits: {}, scrollY: 0, graphX: {}, helpSeen: false };
const sessions = new Map<string, { value: PlanBrowseState; listeners: Set<() => void> }>();
function session(key: string) {
  let value = sessions.get(key);
  if (!value) { value = { value: empty, listeners: new Set() }; sessions.set(key, value); }
  return value;
}
/** Session only: never saved into home records, and never shared between hosts, homes or mates. */
export function planSessionKey(hostId: string | undefined, home: string | undefined, mateId: string | undefined, homeId: string | undefined) {
  return hostId && home && mateId && homeId ? JSON.stringify([hostId, home, mateId, homeId]) : null;
}
export function updatePlanBrowse(key: string | null, patch: Partial<PlanBrowseState> | ((value: PlanBrowseState) => Partial<PlanBrowseState>)) {
  if (!key) return;
  const store = session(key);
  store.value = { ...store.value, ...(typeof patch === "function" ? patch(store.value) : patch) };
  for (const listener of store.listeners) listener();
}
export function usePlanBrowse<T>(key: string | null, select: (value: PlanBrowseState) => T) {
  return useSyncExternalStore(
    listener => { if (!key) return () => {}; const store = session(key); store.listeners.add(listener); return () => { store.listeners.delete(listener); }; },
    () => select(key ? session(key).value : empty),
  );
}
