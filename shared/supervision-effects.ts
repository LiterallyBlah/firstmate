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
  /** Definitive proof that a worker workspace intent created nothing: no registry row, no live creation record,
   * branch (rev-parse exit 1 only), worktree or managed directory. Any doubt is false. */
  workspaceNotCreatedProof: z.boolean(),
  /** Complete persisted descendant inventory, including unloaded providers (archive-inventory). */
  persistedInventory: z.boolean(),
  sendReceiptLookup: z.literal(false),
  conditionalArchive: z.literal(false),
  /** Qualified weaker remote identity: no caller-selected IDs; identity is bound by the reserved scope/attempt labels and reconciled by owner-filtered label discovery. Never an implicit fallback. Absent means not offered. */
  labelBoundIdentity: z.boolean().optional(),
  /** The exact version pair this receiver was qualified against; `daemonVersion` is "" until recorded. */
  remoteVersions: z.object({ cliVersion: z.string().max(64), daemonVersion: z.string().max(64) }).strict().optional(),
}).strict();
export type ReceiverCapabilities = z.infer<typeof ReceiverCapabilitiesSchema>;
/** The one CLI version the remote receiver surface was probed against (slice 0). */
export const QUALIFIED_REMOTE_CLI_VERSION = "0.14.0";
/** Exact `(cliVersion, remoteDaemonVersion)` pairs qualified by evidence for label-bound identity.
 * The slice 0 probe never recorded a remote daemon version, so no pair is qualified yet: this table
 * stays empty and remote reservation fails closed to local-only until a pair earns its place here
 * from recorded probe evidence. A version is never invented to fill it. */
export const QUALIFIED_REMOTE_PAIRS: readonly { cliVersion: string; daemonVersion: string }[] = [];
export type QualifiedRemotePair = { cliVersion: string; daemonVersion: string };
/** A remote `run` prompt travels on a command line; briefs plus appended rules beyond this are refused. */
export const REMOTE_PROMPT_MAX_CHARS = 28000;
/** Label-bound (remote) reservation is admitted only for an exact qualified pair from `pairs`
 * (the production table by default; tests may inject a fixture pair). Anything else fails closed. */
export function qualifiedRemote(capabilities: ReceiverCapabilities, pairs: readonly QualifiedRemotePair[] = QUALIFIED_REMOTE_PAIRS): boolean {
  const versions = capabilities.remoteVersions;
  return capabilities.labelBoundIdentity === true && capabilities.selectedAgentIds === false && !!versions &&
    pairs.some((pair) => pair.cliVersion === versions.cliVersion && pair.daemonVersion === versions.daemonVersion);
}

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
  /** Label-bound remote mode only: the pinned brief, delivered by the create itself (verify-after-create). */
  initialPrompt: z.string().min(1).max(REMOTE_PROMPT_MAX_CHARS).optional(),
}).strict();
export type AgentCreateIntent = z.infer<typeof AgentCreateIntentSchema>;
/** What a receiver reports about one exact agent identity. Never a negative-listing inference. */
export interface AgentObservation {
  id: string; workspaceId: string | null; cwd: string; labels: Record<string, string>;
  provider: string; modeId: string | null; thinkingOptionId: string | null;
  status: "initializing" | "idle" | "running" | "error" | "closed"; pendingPermissions: number; archivedAt: string | null;
  /** Remote verification profile inputs, where the receiver can report them (CLI `inspect`). */
  createdAt?: string | null; parentAgentId?: string | null; clockSkewSeconds?: number | null;
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
  /** True only when the intent provably created nothing (see `workspaceNotCreatedProof`).
   * Read-only: it must never create, resend or repair anything. Absent means no proof. */
  proveWorkspaceNotCreated?(intent: WorkspaceIntent): Promise<boolean>;
  createAgent(intent: AgentCreateIntent): Promise<{ agentId: string }>;
  findAgent(agentId: string): Promise<AgentObservation | null>;
  /** Label-bound reconcile: every agent ID carrying this attempt's owner-filtered labels, archived included. */
  discoverAttemptAgentIds?(attemptId: string): Promise<string[]>;
  /** The local-clock window a label-bound create was submitted in, for CreatedAt verification. */
  creationWindow?(agentId: string): Promise<{ sentAt: number; receivedAt: number } | null>;
  send(agentId: string, text: string, messageId: string): Promise<void>;
  interrupt(agentId: string): Promise<void>;
  archive(agentId: string): Promise<{ archivedAt: string }>;
  /** Must throw unless the inventory is complete; a live-only listing is not an archive inventory. */
  inventory(parentId: string): Promise<InventoryChild[]>;
}

/** New Supervisor sessions carry `firstmate.role=supervisor` and their scope kind in `firstmate.scope-kind`. */
export const SUPERVISOR_ROLE = "supervisor";
export const SCOPE_KIND_LABEL = "firstmate.scope-kind";
/** The roles sessions created before the Supervisor labels carry. Paseo cannot take a label off, so they are
 * read beside the new role indefinitely: a running session keeps its identity. */
export const LEGACY_SUPERVISOR_ROLES = { plan: "plan-supervisor", project: "project-mate", maintenance: "maintenance-mate" } as const;
/** Every role a Supervisor session carries, new and old; none of them can take the first-mate role. */
export const SUPERVISOR_ROLES: readonly string[] = [SUPERVISOR_ROLE, ...Object.values(LEGACY_SUPERVISOR_ROLES)];
export type SupervisorKind = keyof typeof LEGACY_SUPERVISOR_ROLES;
export const supervisorKind = (kind: string | undefined): SupervisorKind => kind === "project" || kind === "maintenance" ? kind : "plan";
/** A Supervisor session's scope kind from its labels, old or new; null for any other session. */
export function supervisorRoleKind(labels: Record<string, string>): SupervisorKind | null {
  const role = labels["firstmate.role"];
  if (role === SUPERVISOR_ROLE) {
    const kind = labels[SCOPE_KIND_LABEL];
    return kind === "plan" || kind === "project" || kind === "maintenance" ? kind : null;
  }
  const legacy = (Object.entries(LEGACY_SUPERVISOR_ROLES) as [SupervisorKind, string][]).find(([, r]) => r === role);
  return legacy && labels[SCOPE_KIND_LABEL] === undefined ? legacy[0] : null;
}
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
