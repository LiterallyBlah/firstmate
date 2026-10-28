/** One owner per home for every scoped service. Reads never initialize or acquire. */
import { SupervisionStore } from "./supervision-store";
import { SupervisionStatusReader } from "./supervision-status-reader";
import { workflowHomeIdentity } from "./workflow-ownership";
import { serialized } from "./serialize";

export class SupervisionRuntime {
  private readonly writers = new Map<string, SupervisionStore>();
  private readonly reader: SupervisionStatusReader;
  private closed = false;
  private readonly active = new Set<Promise<void>>();
  private readonly lock: string;
  constructor(readonly root: string, private readonly create = (root: string, home: string) =>
    new SupervisionStore(root, home, { writable: true, actor: { kind: "system", id: "scoped-runtime", source: "owned-plugin-runtime" } })) {
    this.reader = new SupervisionStatusReader(root); this.lock = `firstmate.runtime:${root}`;
  }
  read(home: string, options?: { settleAfterMs?: number }) {
    return this.writers.get(workflowHomeIdentity(home))?.read(options) ?? this.reader.read(home, options);
  }
  /** Caller owns its role/config guard; all services share acquisition and shutdown serialization. */
  async mutate<T>(home: string, run: (store: SupervisionStore) => Promise<T>, recoverIndex: boolean | { homeId: string; sequence: number; hash: string | null } = false): Promise<T> {
    const owned = await serialized(this.lock, async () => {
      if (this.closed) throw new Error("Scoped runtime has stopped.");
      const id = workflowHomeIdentity(home);
      let store = this.writers.get(id);
      if (!store) {
        store = this.create(this.root, home); await store.initialize();
        if (recoverIndex) {
          const status = await store.read();
          if (status.problems.some(p => p.startsWith("Checkpoint validation failed;")))
            await store.recoverIndex(typeof recoverIndex === "object" ? recoverIndex : { homeId: status.homeId, sequence: status.sequence, hash: status.hash });
        }
        await store.acquireCoordinator(); this.writers.set(id, store);
      } else if (recoverIndex) {
        const status = await store.read();
        if (status.problems.some(p => p.startsWith("Checkpoint validation failed;")))
          await store.recoverIndex(typeof recoverIndex === "object" ? recoverIndex : { homeId: status.homeId, sequence: status.sequence, hash: status.hash });
      }
      let release!: () => void;
      const pending = new Promise<void>(done => { release = done; }); this.active.add(pending);
      return { store, pending, release };
    });
    // The store serializes journal transactions. Network callbacks never hold a fleet-wide runtime lock.
    try { return await run(owned.store); }
    finally { this.active.delete(owned.pending); owned.release(); }
  }
  async stop() {
    const pending = await serialized(this.lock, async () => { this.closed = true; return [...this.active]; });
    await Promise.all(pending);
    await serialized(this.lock, async () => {
      for (const store of this.writers.values()) await store.releaseCoordinator();
      this.writers.clear();
    });
  }
}
