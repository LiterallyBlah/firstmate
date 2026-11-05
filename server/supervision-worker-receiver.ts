/** Local cooperative SDK worker receiver. No parent, archive, release or remote effects. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import type { AgentCreateIntent, WorkspaceIntent, WorkspaceReceipt } from "../shared/supervision-effects";
import type { PaseoApi } from "./host-types";
import { ReceiverRejected, sameDirectory } from "./supervision-effects";
import { SupervisionUiReceiver } from "./supervision-ui-receiver";
import { stopAgent } from "./cli";

const exec = promisify(execFile);
/** A create error the host answered, as opposed to a reply lost in transport: the daemon client
 * marks connection loss with a code and its timeouts say so, while a daemon refusal surfaces as
 * a plain Error carrying the daemon's message. */
function definiteRefusal(error: unknown): boolean {
  if ((error as { code?: unknown } | null)?.code === "DAEMON_CONNECTION_LOST") return false;
  const message = error instanceof Error ? error.message : String(error);
  return !/timed out|Daemon client closed/i.test(message);
}
export class SupervisionWorkerReceiver extends SupervisionUiReceiver {
  constructor(private readonly api: PaseoApi, root: string, private readonly projectDirectory: (name: string) => Promise<string>) {
    super(api, root, { projectMates: true });
  }
  override async capabilities() {
    return { ...await super.capabilities(), receiver: "paseo-sdk/cooperative-local-worker", workspaceIntentLookup: true };
  }
  override async prepareWorkspace(intent: WorkspaceIntent) {
    if (intent.purpose === "supervisor") return super.prepareWorkspace(intent);
    if (intent.hostId !== "local" || !/^ws-[0-9a-f-]{36}$/.test(intent.key) || !/^fm\/[a-z0-9][a-z0-9-]*$/.test(intent.branch))
      throw new ReceiverRejected("Only reserved isolated local worker worktrees are supported.");
    const directory = await realpath(await this.projectDirectory(intent.project));
    return async () => {
      // Paseo assigns workspace ids (`wks_<hex>`): @getpaseo/client refuses a caller-selected
      // `workspaceId` before any daemon call. The intent key travels as the idempotency key and
      // the worktree slug, which is how the created workspace is found again below.
      let workspace;
      try {
        workspace = await this.api.workspaces.create({ idempotencyKey: intent.key,
          source: { kind: "worktree", cwd: directory, action: "branch-off", refName: intent.baseBranch, baseBranch: intent.baseBranch,
            branchName: intent.branch, worktreeSlug: intent.key } });
      } catch (error) {
        // A lost reply may still have created the workspace: reconcile by slug before settling.
        // A clean lookup that finds nothing makes a non-transport error a definite refusal.
        const found = await this.lookupWorkspace(intent, directory).catch(() => undefined);
        if (found) return found;
        if (found === null && definiteRefusal(error))
          throw new ReceiverRejected(`Workspace creation was refused and no workspace was created: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
      const path = workspace.directory ?? (await workspace.refresh())?.workspaceDirectory;
      if (!path) throw new Error("Reserved workspace has no observable worktree; retain uncertainty.");
      await this.verifyWorktree(path, directory, intent.branch);
      return { workspaceId: workspace.id, directory: path };
    };
  }
  override async findWorkspace(intent: WorkspaceIntent) {
    if (intent.purpose === "supervisor") return super.findWorkspace(intent);
    return this.lookupWorkspace(intent, await this.projectDirectory(intent.project));
  }
  /** Positive lookup by the intent's durable marks: worktree slug (or a legacy caller-chosen id),
   * confirmed against the project's git worktree on the reserved branch. Null only when no
   * candidate exists; a present but unverifiable or ambiguous candidate throws, staying uncertain. */
  private async lookupWorkspace(intent: WorkspaceIntent, project: string): Promise<WorkspaceReceipt | null> {
    const matches: { id: string; workspaceDirectory: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.api.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
      for (const entry of page.entries)
        if (entry.workspaceDirectory && (entry.worktreeSlug === intent.key || entry.id === intent.key) && !matches.some(m => m.id === entry.id))
          matches.push({ id: entry.id, workspaceDirectory: entry.workspaceDirectory });
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    if (!matches.length) return null;
    const verified: typeof matches = [];
    let failure: unknown;
    for (const match of matches) {
      try { await this.verifyWorktree(match.workspaceDirectory, project, intent.branch); verified.push(match); }
      catch (error) { failure ??= error; }
    }
    if (verified.length === 1) return { workspaceId: verified[0]!.id, directory: verified[0]!.workspaceDirectory };
    if (verified.length > 1) throw new Error("More than one workspace matches the reserved intent; retain uncertainty.");
    throw failure;
  }
  private async verifyWorktree(path: string, project: string, branch: string) {
    const git = async (cwd: string, args: string[]) => (await exec("git", ["-C", cwd, ...args], { timeout: 15000, maxBuffer: 65536, windowsHide: true })).stdout.trim();
    const root = await realpath(project), directory = await realpath(path);
    if (sameDirectory(root, directory) || !sameDirectory(await git(directory, ["rev-parse", "--show-toplevel"]), directory) ||
      await git(directory, ["branch", "--show-current"]) !== branch ||
      !sameDirectory(await git(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])))
      throw new Error("Workspace isolation or repository/branch identity cannot be verified.");
  }
  override async createAgent(intent: AgentCreateIntent) {
    if (intent.labels["firstmate.role"] !== "crew") return super.createAgent(intent);
    if (!intent.labels["firstmate.scope"] || !intent.labels["firstmate.attempt"] || intent.labels["paseo.parent-agent-id"])
      throw new ReceiverRejected("Worker needs exact scope/attempt and independent ancestry.");
    const agent = await this.api.workspaces.ref(intent.workspaceId).agents.create({ agentId: intent.agentId, idempotencyKey: intent.agentId,
      config: { provider: intent.profile.provider, modeId: intent.profile.modeId,
        ...(intent.profile.thinkingOptionId ? { thinkingOptionId: intent.profile.thinkingOptionId } : {}) }, title: intent.title, labels: intent.labels });
    return { agentId: agent.id };
  }
  override async interrupt(agentId: string): Promise<void> {
    const agent = await this.findAgent(agentId);
    if (!agent || agent.labels["firstmate.role"] !== "crew" || !agent.labels["firstmate.scope"] || !agent.labels["firstmate.attempt"] || agent.labels["paseo.parent-agent-id"])
      throw new ReceiverRejected("Only the exact scoped independent local worker may be interrupted.");
    await stopAgent(agentId);
  }
}
