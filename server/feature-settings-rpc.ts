/** App transport. Saves require the installed live policy/fence, never a caller actor or bypass. */
import { FeaturePolicyRuntime } from "./feature-policy-runtime";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { isAbsolute } from "node:path";
import { featurePause, FeatureReadResultSchema, FeatureSetInputSchema, readFeatureSettings, setFeatureSettings,
  type FeatureInventory, type FeatureSetInput } from "../shared/feature-settings";
import type { SupervisionStatus } from "../shared/supervision";
import { FeatureSettingsError, FeatureSettingsStore, type LegacyFeatureSettings } from "./feature-settings";
import { SupervisionStatusReader } from "./supervision-status-reader";
import { workflowHomeIdentity } from "./workflow-ownership";
import { activationEffects } from "./supervisor-sessions";

const missingCoverage = "Saved-work coverage is incomplete: legacy deliveries and native session reconciliation have not been checked.";
/** No aggregate complete/zero claim until all retained delivery sources are integrated. */
export function featureInventory(status: SupervisionStatus): FeatureInventory {
  const known = status.freshness !== "held" && !status.problems.length;
  return { complete: false, coverage: ["scoped-bindings", "scoped-effects"], sequence: status.sequence,
    active: known ? status.bindings.filter(b => b.state === "active" && b.workspaceId !== null &&
      status.bindings.filter(other => other.scopeId === b.scopeId).length === 1 &&
      activationEffects(status, b.scopeId, b.epoch).send?.state === "succeeded").length : null,
    pending: known ? status.effects.filter(e => ["reserved", "dispatching", "accepted"].includes(e.state)).length : null,
    uncertain: known ? status.effects.filter(e => ["dispatching", "accepted", "uncertain"].includes(e.state)).length : null,
    problems: [...status.problems, missingCoverage] };
}
export interface FeatureSettingsDependencies {
  home(): Promise<string>;
  legacy?: LegacyFeatureSettings;
  runtime?: FeaturePolicyRuntime;
  changed?(home: string): Promise<void>;
  readInventory?(home: string): Promise<SupervisionStatus>;
}
export class FeatureSettingsService {
  private readonly reader: SupervisionStatusReader;
  constructor(private readonly root: string, private readonly deps: FeatureSettingsDependencies) {
    this.reader = new SupervisionStatusReader(root);
  }
  private async guard(home: string) {
    const current = await this.deps.home();
    if (!isAbsolute(home) || workflowHomeIdentity(home) !== workflowHomeIdentity(current))
      throw new FeatureSettingsError("STALE", "FirstMate's home changed. Refresh before reading or changing settings.");
    return current;
  }
  async read(input: { home: string }) {
    const current = await this.guard(input.home);
    const policy = await (this.deps.runtime?.read(current) ?? new FeatureSettingsStore(this.root, current, this.deps.legacy).read());
    let inventory: FeatureInventory, pause: string | null = null;
    try {
      const status = await (this.deps.readInventory?.(current) ?? this.reader.read(current));
      if (status.homeId !== policy.homeId) throw new Error("The saved-work inventory belongs to a different home.");
      inventory = featureInventory(status);
      pause = featurePause(status, policy.effective);
    } catch {
      inventory = { complete: false, coverage: [], sequence: null, active: null, pending: null, uncertain: null,
        problems: ["Saved work couldn't be checked. Keep the existing setup and try reading again.", missingCoverage] };
    }
    await this.guard(current);
    return FeatureReadResultSchema.parse({ ...policy, inventory, pause });
  }
  async set(input: FeatureSetInput) {
    const request = FeatureSetInputSchema.parse(input);
    await this.guard(request.home);
    if (this.deps.runtime) {
      const result = await this.deps.runtime.set(request, () => this.guard(request.home));
      await this.deps.changed?.(request.home).catch(error => console.error("[firstmate] helper availability:", error));
      return result;
    }
    // No caller boolean bypass: only the installed server-owned policy can unlock saves.
    throw new FeatureSettingsError("HELD", "In-app feature changes are not available yet. Your existing setup stays in use.");
  }
}
export function registerFeatureSettingsRpc(server: Pick<PluginServerContext, "handle">, service: FeatureSettingsService) {
  server.handle(readFeatureSettings, input => service.read(input));
  server.handle(setFeatureSettings, input => service.set(input));
}
