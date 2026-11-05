/** Label-bound remote worker receiver over the plugin's CLI bridge (`RemoteService`).
 * Qualified weaker identity (slice 0 probe, CLI 0.14.0): the CLI cannot take a caller-selected
 * agent ID or create unprompted, so identity is bound by the reserved scope/attempt labels,
 * the prompt is delivered by `run` itself, and verification is verify-after-create. Reconcile is
 * owner-filtered label discovery including archived agents: exactly one match binds, zero stays
 * uncertain, two or more is a held duplicate. Archive and persisted inventory are refused.
 * A failure before submission (connect refused) is a definite `ReceiverRejected`; a failure
 * after submission is a plain error, which the gateway settles uncertain and never resends. */
import {
  REMOTE_PROMPT_MAX_CHARS, type AgentCreateIntent, type AgentObservation, type GatewayReceiver,
  type ReceiverCapabilities, type WorkspaceIntent, type WorkspaceReceipt,
} from "../shared/supervision-effects";
import { runPaseo } from "./cli";
import { ReceiverRejected } from "./supervision-effects";
import { RemoteConnectRefused } from "./remotes";

/** The daemon-side bridge surface this receiver needs; `RemoteService` satisfies it structurally. */
export interface RemoteBridge {
  request(selector: string, args: string[]): Promise<unknown>;
  discoverByAttempt(selector: string, attemptLabel: string): Promise<Record<string, unknown>[]>;
  hostInfo(selector: string): Promise<{ serverId: string; label: string; online: boolean; daemonVersion: string | null; clockSkewSeconds: number | null } | null>;
}
const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
const rows = (value: unknown): Record<string, unknown>[] => {
  const list = Array.isArray(value) ? value : Object.values(record(value)).find(Array.isArray);
  return Array.isArray(list) ? list.filter((row) => typeof row === "object" && row !== null) as Record<string, unknown>[] : [];
};
const text = (...values: unknown[]): string => {
  for (const value of values) if (typeof value === "string" && value) return value;
  return "";
};
/** Definite refusals happen before submission; everything else may have crossed the boundary. */
function definite(error: unknown): never {
  if (error instanceof RemoteConnectRefused) throw new ReceiverRejected(error.message, "refused");
  if (error instanceof Error && /Host is unknown|Reserved ownership|Unsupported remote command|Remote target cannot/.test(error.message))
    throw new ReceiverRejected(error.message, "unsupported");
  throw error;
}
async function defaultCliVersion(): Promise<string> {
  try {
    const result = await runPaseo(["--version"], { ...process.env });
    return result.code === 0 ? result.stdout.trim().split(/\s+/).at(-1) ?? "" : "";
  } catch { return ""; }
}

export class SupervisionRemoteReceiver implements GatewayReceiver {
  private readonly workspaces = new Map<string, WorkspaceReceipt>();
  private readonly agentWorkspaces = new Map<string, string>();
  private readonly windows = new Map<string, { sentAt: number; receivedAt: number }>();
  constructor(
    private readonly bridge: RemoteBridge,
    readonly hostId: string,
    private readonly projectDirectory: (name: string) => Promise<string>,
    private readonly options: { cliVersion?: () => Promise<string>; now?: () => number } = {},
  ) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  async capabilities(): Promise<ReceiverCapabilities> {
    const [info, cliVersion] = await Promise.all([
      this.bridge.hostInfo(this.hostId).catch(() => null),
      (this.options.cliVersion ?? defaultCliVersion)().catch(() => ""),
    ]);
    return { version: 1, receiver: "paseo-cli/remote-worker", qualification: "cooperative-paseo",
      selectedAgentIds: false, createReceiptLookup: false, workspaceIntentLookup: true, workspaceNotCreatedProof: false,
      persistedInventory: false, sendReceiptLookup: false, conditionalArchive: false,
      labelBoundIdentity: true, remoteVersions: { cliVersion, daemonVersion: info?.daemonVersion ?? "" } };
  }
  private async call(args: string[]): Promise<unknown> {
    try { return await this.bridge.request(this.hostId, args); }
    catch (error) { return definite(error); }
  }
  async openWorkspace(intent: WorkspaceIntent): Promise<WorkspaceReceipt> {
    if (intent.purpose !== "worker" || intent.hostId !== this.hostId)
      throw new ReceiverRejected("The remote receiver opens only its own host's worker worktrees.", "unsupported");
    const directory = await this.projectDirectory(intent.project);
    const result = record(await this.call(["workspace", "create", "--isolation", "worktree", "--path", directory,
      "--worktree-slug", intent.key, "--new-branch", intent.branch, "--base", intent.baseBranch, "--title", intent.branch]));
    const workspaceId = text(result.workspaceId, result.id, record(result.workspace).workspaceId, record(result.workspace).id);
    const cwd = text(result.cwd, result.path, result.directory, record(result.workspace).cwd, record(result.workspace).path);
    if (!workspaceId || !cwd) throw new Error("Remote workspace creation returned no observable workspace; retain uncertainty.");
    const receipt = { workspaceId, directory: cwd };
    this.workspaces.set(intent.key, receipt);
    return receipt;
  }
  async findWorkspace(intent: WorkspaceIntent): Promise<WorkspaceReceipt | null> {
    const known = this.workspaces.get(intent.key);
    if (known) return known;
    const matches = rows(await this.call(["workspace", "ls"])).filter((row) =>
      text(row.branch) === intent.branch && (text(row.cwd, row.path).split(/[\\/]/).includes(intent.key) || text(row.name) === intent.branch))
      .map((row) => ({ workspaceId: text(row.workspaceId, row.id), directory: text(row.cwd, row.path) }))
      .filter((row) => row.workspaceId && row.directory);
    const unique = [...new Map(matches.map((row) => [row.workspaceId, row])).values()];
    if (unique.length > 1) throw new Error("More than one remote workspace matches the reserved intent; retain uncertainty.");
    if (unique[0]) this.workspaces.set(intent.key, unique[0]);
    return unique[0] ?? null;
  }
  async createAgent(intent: AgentCreateIntent): Promise<{ agentId: string }> {
    if (intent.labels["paseo.parent-agent-id"] || !intent.labels["firstmate.scope"] || !intent.labels["firstmate.attempt"])
      throw new ReceiverRejected("Remote worker needs exact scope/attempt labels and independent ancestry.", "invalid");
    const prompt = intent.initialPrompt;
    if (!prompt) throw new ReceiverRejected("The remote CLI cannot create an unprompted agent; the pinned brief is required at create.", "unsupported");
    if (prompt.length > REMOTE_PROMPT_MAX_CHARS)
      throw new ReceiverRejected(`Remote brief exceeds ${REMOTE_PROMPT_MAX_CHARS} characters; refused, never truncated.`, "invalid");
    const args = ["run", "--workspace", intent.workspaceId, "--provider", intent.profile.provider,
      ...(intent.profile.modeId ? ["--mode", intent.profile.modeId] : []),
      ...(intent.profile.thinkingOptionId ? ["--thinking", intent.profile.thinkingOptionId] : []),
      "--title", intent.title,
      ...Object.entries(intent.labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
      "--", prompt];
    const sentAt = this.now();
    const result = record(await this.call(args));
    const agentId = text(result.agentId, result.id);
    if (!agentId) throw new Error("Remote run returned no agent identity; reconcile by attempt label, never resend.");
    this.windows.set(agentId, { sentAt, receivedAt: this.now() });
    this.agentWorkspaces.set(agentId, intent.workspaceId);
    return { agentId };
  }
  async findAgent(agentId: string): Promise<AgentObservation | null> {
    let detail: Record<string, unknown>;
    try { detail = record(await this.bridge.request(this.hostId, ["inspect", agentId])); }
    catch (error) {
      if (error instanceof Error && /not found|unknown agent|no agent/i.test(error.message)) return null;
      return definite(error);
    }
    const id = text(detail.Id, detail.id);
    if (!id) return null;
    const status = text(detail.Status, detail.status).toLowerCase();
    const archivedAt = typeof detail.ArchivedAt === "string" && detail.ArchivedAt ? detail.ArchivedAt : detail.Archived === true ? text(detail.UpdatedAt) || "archived" : null;
    const info = await this.bridge.hostInfo(this.hostId).catch(() => null);
    return {
      id, workspaceId: this.agentWorkspaces.get(id) ?? null, cwd: text(detail.Cwd, detail.cwd), labels: {},
      provider: text(detail.Model) ? `${text(detail.Provider)}/${text(detail.Model)}` : text(detail.Provider, detail.provider),
      modeId: text(detail.Mode, detail.mode) || null, thinkingOptionId: text(detail.Thinking, detail.thinking) || null,
      status: archivedAt ? "closed" : status === "running" || status === "initializing" || status === "error" || status === "closed" ? status : "idle",
      pendingPermissions: Array.isArray(detail.PendingPermissions) ? detail.PendingPermissions.length : 0, archivedAt,
      createdAt: text(detail.CreatedAt, detail.createdAt) || null,
      parentAgentId: typeof detail.ParentAgentId === "string" ? detail.ParentAgentId : null,
      clockSkewSeconds: info?.clockSkewSeconds ?? null,
    };
  }
  async discoverAttemptAgentIds(attemptId: string): Promise<string[]> {
    const found = await this.bridge.discoverByAttempt(this.hostId, `firstmate.attempt=${attemptId}`).catch((error: unknown) => definite(error));
    return [...new Set(found.map((row) => text(row.id, row.Id)).filter(Boolean))];
  }
  async creationWindow(agentId: string) { return this.windows.get(agentId) ?? null; }
  async send(agentId: string, prompt: string, _messageId: string): Promise<void> {
    if (prompt.length > REMOTE_PROMPT_MAX_CHARS)
      throw new ReceiverRejected(`Remote send exceeds ${REMOTE_PROMPT_MAX_CHARS} characters; refused, never truncated.`, "invalid");
    await this.call(["send", agentId, "--", prompt]);
  }
  async interrupt(agentId: string): Promise<void> { await this.call(["stop", agentId]); }
  async archive(_agentId: string): Promise<never> {
    throw new ReceiverRejected("No persisted remote inventory exists through the CLI bridge; archive is refused.", "unsupported");
  }
  async inventory(_parentId: string): Promise<never> {
    throw new ReceiverRejected("No persisted remote inventory exists through the CLI bridge; archive is refused.", "unsupported");
  }
}
