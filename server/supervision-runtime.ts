import { SupervisionGateway } from "./supervision-effects";
import { SupervisionCommands } from "./supervision-commands";
import type { GatewayReceiver } from "../shared/supervision-effects";
import type { FeaturePolicyRuntime } from "./feature-policy-runtime";
/** One owner per home for every scoped service. Reads never initialize or acquire. */
import { SupervisionStore } from "./supervision-store";
import { SupervisionStatusReader } from "./supervision-status-reader";
import { workflowHomeIdentity } from "./workflow-ownership";
import { serialized } from "./serialize";
import { primeSupervisionSelfIdentity } from "./supervision-process";

export class SupervisionRuntime {
  private readonly writers = new Map<string, SupervisionStore>();
  private readonly reader: SupervisionStatusReader;
  private readonly inert: SupervisionStatusReader;
  private closed = false;
  private readonly active = new Set<Promise<void>>();
  private readonly lock: string;
  constructor(readonly root: string, private readonly create = (root: string, home: string) =>
    new SupervisionStore(root, home, { writable: true, actor: { kind: "system", id: "scoped-runtime", source: "owned-plugin-runtime" } }), readonly features?: FeaturePolicyRuntime) {
    this.reader = new SupervisionStatusReader(root); this.inert = new SupervisionStatusReader(root); this.lock = `firstmate.runtime:${root}`;
    // Verify this process's identity now, outside every lock, so the first coordinator claim finds it
    // cached instead of paying a cold OS probe while holding the runtime serialization. Never rejects.
    void primeSupervisionSelfIdentity().catch(() => {});
  }
  read(home: string, options?: { settleAfterMs?: number }) {
    return this.writers.get(workflowHomeIdentity(home))?.read(options) ?? this.reader.read(home, options);
  }
  /** The runtime's one warm store for this home, for pure reads a status cannot serve
   * (`readBlob`). Never initializes or acquires; a new instance would re-validate the journal.
   */
  readStore(home: string): SupervisionStore {
    return this.writers.get(workflowHomeIdentity(home)) ?? this.reader.storeFor(home);
  }
  /** One warm, never-writable store per home for views that must not borrow the writer
   * (project memory, General's discussion composition). Reused for the process lifetime:
   * a fresh inert store per view re-validated the whole journal on every open.
   */
  inertStore(home: string): SupervisionStore {
    return this.inert.storeFor(home);
  }
  /** Caller owns its role/config guard; all services share acquisition and shutdown serialization. */
  async mutate<T>(home: string, run: (store: SupervisionStore) => Promise<T>, recoverIndex: boolean | { homeId: string; sequence: number; hash: string | null } = false): Promise<T> {
    const owned = await serialized(this.lock, async () => {
      if (this.closed) throw new Error("Scoped runtime has stopped.");
      const id = workflowHomeIdentity(home);
      let store = this.writers.get(id);
      if (!store) {
        store = this.create(this.root, home);
        // Adopt the reader's already-validated projection instead of paying a second full
        // cold journal validation for the writer (the two raced for tens of seconds after a
        // restart). Reads still never create a writer; adoption only hands over a completed
        // validation from this runtime's own reader, and every later read still checks the
        // checkpoint anchor before trusting it.
        store.adoptValidatedCacheFrom(this.reader.storeFor(home));
        await store.initialize();
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
  /** Account for prior effects even while new work is off. No dispatch or inferred absence. */
  async reconcile(home: string, receiver: GatewayReceiver, kinds: string[], receiverFor?: (hostId: string) => GatewayReceiver | undefined) {
    const status = await this.read(home);
    const selected = status.effects.filter(e => ["dispatching", "accepted", "uncertain"].includes(e.state) &&
      status.scopes.some(s => s.id === e.scopeId && kinds.includes(s.kind))).slice(0, 32);
    if (status.freshness !== "current" || !selected.length) return;
    await this.mutate(home, async store => {
      const gateway = new SupervisionGateway(store, new SupervisionCommands(store, home, { enabled: true }), home, receiver, { enabled: true, ...(receiverFor ? { receiverFor } : {}) });
      await Promise.allSettled(selected.map(e => serialized(`${store.root}:reconcile:${e.id}`, () => gateway.reconcile(e.id))));
    });
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
