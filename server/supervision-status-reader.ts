/** One validated, read-only projection per configured home for the lifetime of the server.
 * A home switch gets a distinct journal namespace and its own cold startup validation.
 */
import { resolve } from "node:path";
import { workflowHomeIdentity } from "./workflow-ownership";
import { SupervisionStore } from "./supervision-store";

export class SupervisionStatusReader {
  private readonly stores = new Map<string, SupervisionStore>();
  private readonly dataRoot: string;
  constructor(dataRoot: string, private readonly create: (root: string, home: string) => SupervisionStore =
    (root, home) => new SupervisionStore(root, home)) {
    this.dataRoot = resolve(dataRoot);
  }
  /** The one store for this home, for read-only uses that need more than a status
   * (`readBlob`, project context). A new instance would re-validate the whole journal.
   */
  storeFor(home: string): SupervisionStore {
    const homeId = workflowHomeIdentity(home);
    let store = this.stores.get(homeId);
    if (!store) { store = this.create(this.dataRoot, home); this.stores.set(homeId, store); }
    return store;
  }
  async read(home: string, options?: { settleAfterMs?: number }) {
    return this.storeFor(home).read(options);
  }
}
