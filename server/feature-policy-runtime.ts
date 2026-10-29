/** Live policy resolution. No timers, cached authority, writers or model effects. */
import type { SupervisionEffect, SupervisionStatus } from "../shared/supervision";
import type { FeatureCapability, FeaturePolicySnapshot, FeatureSetInput } from "../shared/feature-settings";
import { FeatureSettingsStore, legacyFeatureSettings, type LegacyFeatureSettings } from "./feature-settings";
import { serialized } from "./serialize";
import { digest } from "./submissions";
import { SupervisionError } from "./supervision-store";
function refuse(code: "UNSUPPORTED" | "HELD" | "STALE", message: string): never { throw new SupervisionError(code, message); }
import { pluginDir } from "./data-dir";

export class FeaturePolicyRuntime {
  constructor(readonly root: string, private readonly legacy?: LegacyFeatureSettings | Promise<LegacyFeatureSettings>) {}
  private async store(home: string) { return new FeatureSettingsStore(this.root, home, await this.legacy); }
  private key(home: string) { return `${new FeatureSettingsStore(this.root, home).directory}:effect-boundary`; }
  async read(home: string): Promise<FeaturePolicySnapshot> {
    const snapshot = await (await this.store(home)).read();
    const effective = { ...snapshot.effective }, dependencyRefusals = snapshot.dependencyRefusals.filter(r => r.code === "POLICY_HELD");
    if (effective.scopeExecution && !effective.scopeUi) {
      effective.scopeExecution = false;
      dependencyRefusals.push({ capability: "scopeExecution", code: "DEPENDENCY_DISABLED", reason: "Enable conversation controls before sending contextual messages." });
    }
    return { ...snapshot, effective, dependencyRefusals, runtimeEnforced: true, writesAvailable: snapshot.state === "ready" };
  }
  async check(home: string, capability: FeatureCapability) {
    const snapshot = await this.read(home);
    if (!snapshot.effective[capability]) refuse("UNSUPPORTED", snapshot.problems[0] ??
      snapshot.dependencyRefusals.find(r => r.capability === capability)?.reason ?? "This help is paused for new work. Saved work and delivery records are retained.");
    return snapshot;
  }
  async capacity(home: string) {
    const snapshot = await this.read(home);
    if (!snapshot.capacity || snapshot.state !== "ready") refuse("HELD", "Capacity settings could not be checked. Saved work is retained.");
    return snapshot.capacity;
  }
  /** Settings save and final claim/native-call initiation share this short queue. The returned
   * network promise is boxed, so it never holds the queue or delays an off transition. */
  boundary<T>(home: string, run: () => Promise<T>) { return serialized(this.key(home), run); }
  async set(input: FeatureSetInput, guard?: () => Promise<unknown>) { return this.boundary(input.home, async () => { await guard?.(); return (await this.store(input.home)).set(input); }); }
  async reservation(home: string, capability: FeatureCapability) {
    return { capability, revision: (await this.check(home, capability)).revision! };
  }
  gateway(home: string, capability: FeatureCapability | ((effect: SupervisionEffect) => Promise<FeatureCapability>), readStatus?: () => Promise<SupervisionStatus>) {
    return {
      capture: async (effect: SupervisionEffect) => {
        const cap = typeof capability === "function" ? await capability(effect) : capability;
        const status = await readStatus?.(), receipt = status?.commands.find(c => c.id === effect.requestId);
        const origin = effect.featurePolicy?.capability ?? (receipt?.result.attachmentAudit ? "scopedActivation" :
          receipt?.actor.source === "scope Send (unverified)" ? "scopeExecution" : undefined);
        const capabilities = [...new Set([cap, ...(origin ? [origin] : [])])];
        let snapshot!: FeaturePolicySnapshot;
        for (const required of capabilities) snapshot = await this.check(home, required);
        return JSON.stringify({ capabilities, hash: digest(snapshot) });
      },
      run: <T>(fence: string, run: () => Promise<T>) => this.boundary(home, async () => {
        const captured = JSON.parse(fence) as { capabilities: FeatureCapability[]; hash: string };
        let snapshot!: FeaturePolicySnapshot;
        for (const capability of captured.capabilities) snapshot = await this.check(home, capability);
        if (digest(snapshot) !== captured.hash) refuse("STALE", "Help settings changed before sending. Refresh and check the saved operation.");
        return run();
      }),
    };
  }
}

let installed: FeaturePolicyRuntime | undefined;
export function installFeaturePolicy(policy: FeaturePolicyRuntime) { installed = policy; return () => { if (installed === policy) installed = undefined; }; }
/** Transport/retained-history readers also use the same home-bound compatibility bridge. */
export function currentFeaturePolicy(home: string) {
  return (installed ?? new FeaturePolicyRuntime(pluginDir(), legacyFeatureSettings(home, process.env))).read(home);
}
