/** S04 gateway vocabulary. Disabled and unwired: no RPC, timer, executor or live receiver adapter.
 * Cooperative accounting only; it does not fence native/CLI/shell access by full-access sessions.
 */
import { z } from "zod";
import { SupervisionUuid } from "./supervision";

/** Local, bounded effects only. Release operations have no adapter (A03-C04). */
export const GatewayOperation = z.enum(["workspace.open", "agent.create", "agent.send", "agent.interrupt", "agent.archive"]);
export type GatewayOperation = z.infer<typeof GatewayOperation>;
export const RELEASE_OPERATIONS = ["merge", "deploy", "discard", "publish", "release", "install"] as const;

/** What the receiving host has been shown to support. Nothing is assumed from a newer document:
 * absent features are false. Send receipts (U1) and conditional archive (U3) are not installed
 * capabilities, so they cannot be declared true here. Live qualification is a separate gate.
 */
export const ReceiverCapabilitiesSchema = z.object({
  version: z.literal(1),
  receiver: z.string().min(1).max(256),
  /** Cooperative SDK support is not a strong qualification or a U1–U3 receiver. */
  qualification: z.enum(["synthetic-fixture", "cooperative-paseo"]),
  /** creationLifecycle: a caller-selected agent ID is honoured exactly, unprompted. */
  selectedAgentIds: z.boolean(),
  /** Exact lookup of that reserved agent ID after a lost reply. */
  createReceiptLookup: z.boolean(),
  /** Exact lookup of a workspace by its deterministic intent key after a lost reply. */
  workspaceIntentLookup: z.boolean(),
  /** Complete persisted descendant inventory, including unloaded providers (archive-inventory). */
  persistedInventory: z.boolean(),
  sendReceiptLookup: z.literal(false),
  conditionalArchive: z.literal(false),
}).strict();
export type ReceiverCapabilities = z.infer<typeof ReceiverCapabilitiesSchema>;

export const WorkspaceIntentSchema = z.object({
  key: z.string().min(1).max(256), hostId: z.string().min(1).max(256), project: z.string().min(1).max(200),
  baseBranch: z.string().min(1).max(200), branch: z.string().min(1).max(200), purpose: z.enum(["worker", "supervisor"]),
}).strict();
export type WorkspaceIntent = z.infer<typeof WorkspaceIntentSchema>;
export const WorkspaceReceiptSchema = z.object({ workspaceId: z.string().min(1).max(256), directory: z.string().min(1).max(700) }).strict();
export type WorkspaceReceipt = z.infer<typeof WorkspaceReceiptSchema>;
export const AgentProfileSchema = z.object({ provider: z.string().min(1).max(256), modeId: z.string().max(100), thinkingOptionId: z.string().max(100).optional() }).strict();
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
/** Always unprompted and parentless: no native callback to General or any creator is requested. */
export const AgentCreateIntentSchema = z.object({
  agentId: SupervisionUuid, workspaceId: z.string().min(1).max(256), cwd: z.string().min(1).max(700),
  profile: AgentProfileSchema, title: z.string().min(1).max(120), labels: z.record(z.string().max(128), z.string().max(256)),
}).strict();
export type AgentCreateIntent = z.infer<typeof AgentCreateIntentSchema>;
/** What a receiver reports about one exact agent identity. Never a negative-listing inference. */
export interface AgentObservation {
  id: string; workspaceId: string | null; cwd: string; labels: Record<string, string>;
  provider: string; modeId: string | null; thinkingOptionId: string | null;
  status: "initializing" | "idle" | "running" | "error" | "closed"; pendingPermissions: number; archivedAt: string | null;
}
export interface InventoryChild { id: string; labels: Record<string, string>; workspaceId: string | null }

/** New-work mutators initiate the native API before their first await; replies/verification may await.
 * Workspace adapters with async preparation expose it separately, before the final claim. */
export interface GatewayReceiver {
  capabilities(): Promise<ReceiverCapabilities>;
  /** Filesystem/project preparation happens before the claim/fence. The returned function
   * must invoke the native workspace API synchronously, before its first await. */
  prepareWorkspace?(intent: WorkspaceIntent): Promise<() => Promise<WorkspaceReceipt>>;
  openWorkspace(intent: WorkspaceIntent): Promise<WorkspaceReceipt>;
  findWorkspace(intent: WorkspaceIntent): Promise<WorkspaceReceipt | null>;
  createAgent(intent: AgentCreateIntent): Promise<{ agentId: string }>;
  findAgent(agentId: string): Promise<AgentObservation | null>;
  send(agentId: string, text: string, messageId: string): Promise<void>;
  interrupt(agentId: string): Promise<void>;
  archive(agentId: string): Promise<{ archivedAt: string }>;
  /** Must throw unless the inventory is complete; a live-only listing is not an archive inventory. */
  inventory(parentId: string): Promise<InventoryChild[]>;
}

export const SUPERVISOR_ROLE = "plan-supervisor";
export const SCOPE_LABELS = { scope: "firstmate.scope", attempt: "firstmate.attempt", epoch: "firstmate.epoch" } as const;

/** Effects derive identity from the next step, never from a request ID (A01-C04). */
export const EffectCauseSchema = z.object({
  scopeId: SupervisionUuid, subject: z.string().min(1).max(256), operation: GatewayOperation,
  causation: z.string().min(1).max(512), objectiveRevision: z.number().int().min(0),
}).strict();
export type EffectCause = z.infer<typeof EffectCauseSchema>;

export const GatewayLimitsSchema = z.object({
  /** Supervisor sessions/turns are counted separately from worker attempts and never refunded. */
  supervisorSessions: z.number().int().min(0).max(1000), supervisorTurns: z.number().int().min(0).max(100000),
}).strict();
export type GatewayLimits = z.infer<typeof GatewayLimitsSchema>;
