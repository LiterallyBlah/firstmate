import { SupervisionGateway } from "./supervision-effects";
import { SupervisionCommands } from "./supervision-commands";
import type { GatewayReceiver } from "../shared/supervision-effects";
import type { FeaturePolicyRuntime } from "./feature-policy-runtime";
/** One owner per home for every scoped service. Reads never initialize or acquire. */
import { SupervisionError, SupervisionStore } from "./supervision-store";
import { SupervisionStatusReader } from "./supervision-status-reader";
import { workflowHomeIdentity } from "./workflow-ownership";
import { serialized } from "./serialize";
import { primeSupervisionSelfIdentity } from "./supervision-process";

/** Read-only face over the runtime's one shared store: reads delegate to the warm instance
 * (one cache, always current), every write entry point refuses exactly like a never-writable
 * store. For views that must not initialize, acquire or write on open (project memory,
 * General's discussion composition), where commands/sessions are built over the store but
 * the read-only refusal must stop any accidental write outside runtime.mutate. */
class ReadOnlySupervisionStore extends SupervisionStore {
  constructor(root: string, home: string, private readonly delegate: () => SupervisionStore) { super(root, home); }
  private refuse(): never { throw new SupervisionError("UNSUPPORTED", "Scoped supervision writes are disabled."); }
  override read(...args: Parameters<SupervisionStore["read"]>) { return this.delegate().read(...args); }
  override readBlob(...args: Parameters<SupervisionStore["readBlob"]>) { return this.delegate().readBlob(...args); }
  override historyPage(...args: Parameters<SupervisionStore["historyPage"]>) { return this.delegate().historyPage(...args); }
  override requestReceipt(...args: Parameters<SupervisionStore["requestReceipt"]>) { return this.delegate().requestReceipt(...args); }
  override workflowRequest(...args: Parameters<SupervisionStore["workflowRequest"]>) { return this.delegate().workflowRequest(...args); }
  override backend(...args: Parameters<SupervisionStore["backend"]>) { return this.delegate().backend(...args); }
  override validate(...args: Parameters<SupervisionStore["validate"]>) { return this.delegate().validate(...args); }
  override audit(...args: Parameters<SupervisionStore["audit"]>) { return this.delegate().audit(...args); }
  override adoptValidatedCacheFrom() { return false; }
  override async enableLongLived(..._args: Parameters<SupervisionStore["enableLongLived"]>): Promise<never> { this.refuse(); }
  override async initialize(..._args: Parameters<SupervisionStore["initialize"]>): Promise<never> { this.refuse(); }
  override async acquireCoordinator(..._args: Parameters<SupervisionStore["acquireCoordinator"]>): Promise<never> { this.refuse(); }
  override async releaseCoordinator(..._args: Parameters<SupervisionStore["releaseCoordinator"]>): Promise<never> { this.refuse(); }
  override async recoverIndex(..._args: Parameters<SupervisionStore["recoverIndex"]>): Promise<never> { this.refuse(); }
  override async transact(..._args: Parameters<SupervisionStore["transact"]>): Promise<never> { this.refuse(); }
  override async transactCommand(..._args: Parameters<SupervisionStore["transactCommand"]>): Promise<never> { this.refuse(); }
  override async recoverPublication(..._args: Parameters<SupervisionStore["recoverPublication"]>): Promise<never> { this.refuse(); }
  override async putBlob(..._args: Parameters<SupervisionStore["putBlob"]>): Promise<never> { this.refuse(); }
}

export class SupervisionRuntime {
  private readonly writers = new Map<string, SupervisionStore>();
  private readonly inertWrappers = new Map<string, SupervisionStore>();
  private readonly reader: SupervisionStatusReader;
  private closed = false;
  private readonly active = new Set<Promise<void>>();
  private readonly lock: string;
  constructor(readonly root: string, private readonly create = (root: string, home: string) =>
    new SupervisionStore(root, home, { writable: true, actor: { kind: "system", id: "scoped-runtime", source: "owned-plugin-runtime" } }), readonly features?: FeaturePolicyRuntime) {
    this.reader = new SupervisionStatusReader(root); this.lock = `firstmate.runtime:${root}`;
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
  /** A read-only face over the same current store as readStore (one warm cache), for views
   * write on open (project memory, General's discussion composition - both only ever read
   * through it), with the never-writable refusal restored on every write entry point.
   */
  inertStore(home: string): SupervisionStore {
    const id = workflowHomeIdentity(home);
    let wrapper = this.inertWrappers.get(id);
    if (!wrapper) { wrapper = new ReadOnlySupervisionStore(this.root, home, () => this.readStore(home)); this.inertWrappers.set(id, wrapper); }
    return wrapper;
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
