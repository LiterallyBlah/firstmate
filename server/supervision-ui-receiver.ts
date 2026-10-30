/** Narrow cooperative SDK adapter for the explicit Attach button. No worker dispatch, archive,
 * interrupt, takeover or strong receiver. Unknown create/send outcomes stay in S04's effect ledger. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { GatewayReceiver, AgentCreateIntent, AgentObservation, WorkspaceIntent, WorkspaceReceipt } from "../shared/supervision-effects";
import type { PaseoApi } from "./host-types";
import { refuse } from "./supervision-effects";
import { sendWithoutInterrupting } from "./send";

export class SupervisionUiReceiver implements GatewayReceiver {
  constructor(private readonly paseo: PaseoApi, private readonly root: string, private readonly options: { projectMates?: boolean; maintenanceMates?: boolean; beforeSend?: (agentId: string) => Promise<void> } = {}) {}
  async capabilities() { return { version: 1 as const, receiver: "paseo-sdk/cooperative-attach", qualification: "cooperative-paseo" as const,
    selectedAgentIds: true, createReceiptLookup: true, workspaceIntentLookup: false, persistedInventory: false,
    sendReceiptLookup: false as const, conditionalArchive: false as const }; }
  async openWorkspace(intent: WorkspaceIntent) {
    return (await this.prepareWorkspace(intent))();
  }
  async prepareWorkspace(intent: WorkspaceIntent) {
    if (intent.purpose !== "supervisor" || intent.hostId !== "local" || !/^ws-[0-9a-f-]{36}$/.test(intent.key))
      refuse("UNSUPPORTED", "Only a reserved local supervisor workspace is supported.");
    const directory = join(this.root, "supervisor-workspaces", intent.key);
    await mkdir(directory, { recursive: true });
    return async () => {
      const workspace = await this.paseo.workspaces.open(directory);
      return { workspaceId: workspace.id, directory };
    };
  }
  async findWorkspace(_intent: WorkspaceIntent): Promise<WorkspaceReceipt | null> { return null; } // No negative lookup or automatic replay.
  async createAgent(intent: AgentCreateIntent) {
    if (!(intent.labels["firstmate.role"] === "plan-supervisor" || this.options.projectMates && intent.labels["firstmate.role"] === "project-mate" ||
      this.options.maintenanceMates && intent.labels["firstmate.role"] === "maintenance-mate") || intent.labels["paseo.parent-agent-id"])
      refuse("UNSUPPORTED", "This adapter creates only explicitly enabled independent scope owners.");
    const agent = await this.paseo.workspaces.ref(intent.workspaceId).agents.create({ agentId: intent.agentId,
      idempotencyKey: intent.agentId, config: { provider: intent.profile.provider,
        ...(intent.profile.modeId ? { modeId: intent.profile.modeId } : {}),
        ...(intent.profile.thinkingOptionId ? { thinkingOptionId: intent.profile.thinkingOptionId } : {}) },
      title: intent.title, labels: intent.labels });
    return { agentId: agent.id };
  }
  async findAgent(agentId: string): Promise<AgentObservation | null> {
    // A transport error is never evidence of absence; only Paseo's exact unknown-ID response is.
    let agent;
    try { agent = (await this.paseo.agents.ref(agentId).refresh())?.agent; }
    catch (error) { if (error instanceof Error && /not found|unknown agent|no agent/i.test(error.message)) return null; throw error; }
    if (!agent) return null;
    return { id: agent.id, workspaceId: agent.workspaceId ?? null, cwd: agent.cwd, labels: agent.labels ?? {}, provider: `${agent.provider}/${agent.model}`,
      modeId: agent.currentModeId ?? null, thinkingOptionId: agent.thinkingOptionId ?? null, status: agent.status,
      pendingPermissions: agent.pendingPermissions.length, archivedAt: agent.archivedAt ?? null };
  }
  async send(agentId: string, text: string, messageId: string) {
    await this.options.beforeSend?.(agentId);
    await sendWithoutInterrupting(this.paseo, agentId, text, { messageId });
  }
  async interrupt(_id: string): Promise<void> { return refuse("UNSUPPORTED", "No interrupt adapter is installed."); }
  async archive(_id: string): Promise<never> { return refuse("UNSUPPORTED", "Conditional archive is gated on U3."); }
  async inventory(_id: string): Promise<never> { return refuse("UNSUPPORTED", "No archive inventory adapter is installed."); }
}
