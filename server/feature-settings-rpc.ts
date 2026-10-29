/** Prepared app transport. Intentionally not registered in index.server.ts in slice 3.
 * Even explicit registration cannot save until fresh runtime effect guards ship in slice 4. */
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { isAbsolute } from "node:path";
import { FeatureReadResultSchema, FeatureSetInputSchema, readFeatureSettings, setFeatureSettings,
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
    const policy = await new FeatureSettingsStore(this.root, current, this.deps.legacy).read();
    let inventory: FeatureInventory;
    try {
      const status = await (this.deps.readInventory?.(current) ?? this.reader.read(current));
      if (status.homeId !== policy.homeId) throw new Error("The saved-work inventory belongs to a different home.");
      inventory = featureInventory(status);
    } catch {
      inventory = { complete: false, coverage: [], sequence: null, active: null, pending: null, uncertain: null,
        problems: ["Saved work couldn't be checked. Keep the existing setup and try reading again.", missingCoverage] };
    }
    await this.guard(current);
    return FeatureReadResultSchema.parse({ ...policy, inventory });
  }
  async set(input: FeatureSetInput): Promise<never> {
    const request = FeatureSetInputSchema.parse(input);
    await this.guard(request.home);
    // Never accept a caller actor/role or expose a boolean bypass for this prerequisite.
    throw new FeatureSettingsError("HELD", "In-app feature changes are not available yet. Your existing setup stays in use.");
  }
}
export function registerFeatureSettingsRpc(server: Pick<PluginServerContext, "handle">, service: FeatureSettingsService) {
  server.handle(readFeatureSettings, input => service.read(input));
  server.handle(setFeatureSettings, input => service.set(input));
}
