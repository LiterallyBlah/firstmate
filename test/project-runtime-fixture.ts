/** Synthetic service boundary: no live OS process probing. Foreign owners remain unknown,
 * never dead; real process identity/refusal behavior has its own supervision-process suite. */
import { SupervisionRuntime } from "../server/supervision-runtime";
import { SupervisionStore, type SupervisionStoreOptions } from "../server/supervision-store";

export function projectRuntimeFixture(root: string, options: Pick<SupervisionStoreOptions, "boundary"> = {}) {
  return new SupervisionRuntime(root, (data, home) => new SupervisionStore(data, home, {
    writable: true, actor: { kind: "system", id: "scoped-runtime", source: "owned-plugin-runtime" },
    processIdentity: async pid => pid === process.pid ? { state: "alive", start: "project-runtime-fixture" } : { state: "unknown" },
    ...options,
  }));
}
