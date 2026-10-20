/** A Show override lasts for this app session, across Deck tabs, scene changes and bundle reloads. */
const SLOT = Symbol.for("paseo.firstmate.deck.disconnected-reveals");

export function createDisconnectedReveals(root: object) {
  type State = { hosts: Set<string>; listeners: Set<() => void> };
  let state = Reflect.get(root, SLOT) as State | undefined;
  if (state === undefined) {
    state = { hosts: new Set(), listeners: new Set() };
    Reflect.set(root, SLOT, state);
  }
  const store = state;
  return {
    has: (hostId: string) => store.hosts.has(hostId),
    show: (hostId: string) => {
      store.hosts.add(hostId);
      store.listeners.forEach(listener => listener());
    },
    subscribe: (listener: () => void) => {
      store.listeners.add(listener);
      return () => { store.listeners.delete(listener); };
    },
  };
}

export const disconnectedReveals = createDisconnectedReveals(globalThis);

export function hiddenWorkersText(workers: number, hosts: number): string {
  return `${workers} ${workers === 1 ? "worker" : "workers"} hidden on ${hosts} offline ${hosts === 1 ? "host" : "hosts"}`;
}
