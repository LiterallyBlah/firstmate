/** Deterministic synthetic receiver for S04 gateway tests. No provider, model, network or daemon. */
import { join } from "node:path";
import { ReceiverRejected } from "../server/supervision-effects";
import {
  type AgentCreateIntent, type AgentObservation, type GatewayReceiver, type InventoryChild,
  type ReceiverCapabilities, type WorkspaceIntent, type WorkspaceReceipt,
} from "../shared/supervision-effects";

/** lose: the receiver admits and performs the request, then the reply is lost (ambiguous).
 * reject: definite refusal before admission. hide: performed, but invisible to lookups until revealed. */
export type Fault = "lose" | "reject" | "capacity" | "hide";
export type Operation = "openWorkspace" | "createAgent" | "send" | "interrupt" | "archive";
export const fullCapabilities: ReceiverCapabilities = { version: 1, receiver: "synthetic/1", qualification: "synthetic-fixture",
  selectedAgentIds: true, createReceiptLookup: true, workspaceIntentLookup: false, persistedInventory: true,
  sendReceiptLookup: false, conditionalArchive: false };

export class SyntheticReceiver implements GatewayReceiver {
  calls: { op: Operation; target: string }[] = [];
  workspaces = new Map<string, WorkspaceReceipt>();
  agents = new Map<string, AgentObservation>();
  hidden = new Set<string>();
  sends: { agentId: string; text: string; messageId: string }[] = [];
  children = new Map<string, InventoryChild[]>();
  incompleteInventory = false;
  faults: Partial<Record<Operation, Fault[]>> = {};
  /** Applied to created agents, to model a receiver that ignored part of the request. */
  tamper: ((agent: AgentObservation) => void) | null = null;
  /** Runs after the receiver admitted a request and before its reply returns. */
  afterAdmission: (() => void) | null = null;
  /** When set, an admitted request waits here before replying (models a slow reply in flight). */
  gate: Promise<void> | null = null;
  capabilityValue: unknown;
  constructor(capabilities: Partial<ReceiverCapabilities> = {}, private readonly root = "C:/synthetic") {
    this.capabilityValue = { ...fullCapabilities, ...capabilities };
  }
  async capabilities() { return this.capabilityValue as ReceiverCapabilities; }
  private fault(op: Operation) { return this.faults[op]?.shift(); }
  private async perform<T>(op: Operation, target: string, act: () => T): Promise<T> {
    this.calls.push({ op, target });
    const fault = this.fault(op);
    if (fault === "reject") throw new ReceiverRejected(`${op} refused`, "invalid");
    if (fault === "capacity") throw new ReceiverRejected(`${op}: provider capacity unavailable`, "capacity");
    const result = act();
    if (fault === "hide") this.hidden.add(target);
    this.afterAdmission?.();
    if (this.gate) await this.gate;
    if (fault === "lose" || fault === "hide") throw new Error(`${op} reply lost after admission`);
    return result;
  }
  openWorkspace(intent: WorkspaceIntent) {
    return this.perform("openWorkspace", intent.key, () => {
      const existing = this.workspaces.get(intent.key);
      if (existing) return existing;
      const receipt = { workspaceId: `ws-${this.workspaces.size + 1}`, directory: join(this.root, intent.purpose, intent.key) };
      this.workspaces.set(intent.key, receipt); return receipt;
    });
  }
  async findWorkspace(intent: WorkspaceIntent) { return this.hidden.has(intent.key) ? null : this.workspaces.get(intent.key) ?? null; }
  createAgent(intent: AgentCreateIntent) {
    return this.perform("createAgent", intent.agentId, () => {
      if (this.agents.has(intent.agentId)) return { agentId: intent.agentId }; // Exact-intent receipt, never a duplicate.
      const agent: AgentObservation = { id: intent.agentId, workspaceId: intent.workspaceId, cwd: intent.cwd, labels: { ...intent.labels },
        provider: intent.profile.provider, modeId: intent.profile.modeId || null, thinkingOptionId: intent.profile.thinkingOptionId ?? null,
        status: "idle", pendingPermissions: 0, archivedAt: null };
      this.tamper?.(agent);
      this.agents.set(intent.agentId, agent); return { agentId: intent.agentId };
    });
  }
  async findAgent(agentId: string) { return this.hidden.has(agentId) ? null : structuredClone(this.agents.get(agentId) ?? null); }
  reveal(target: string) { this.hidden.delete(target); }
  send(agentId: string, text: string, messageId: string) {
    return this.perform("send", agentId, () => {
      const agent = this.agents.get(agentId);
      if (!agent) throw new ReceiverRejected("No such agent", "invalid");
      this.sends.push({ agentId, text, messageId }); agent.status = "running";
    });
  }
  interrupt(agentId: string) { return this.perform("interrupt", agentId, () => { const a = this.agents.get(agentId); if (a) a.status = "idle"; }); }
  archive(agentId: string) {
    return this.perform("archive", agentId, () => { const a = this.agents.get(agentId)!; a.archivedAt = "2026-10-26T12:00:00.000Z"; a.status = "closed"; return { archivedAt: a.archivedAt }; });
  }
  async inventory(parentId: string) {
    if (this.incompleteInventory) throw new Error("History did not provide a progressing continuation.");
    return this.children.get(parentId) ?? [];
  }
  finish(agentId: string) { const a = this.agents.get(agentId); if (a) a.status = "idle"; }
}
