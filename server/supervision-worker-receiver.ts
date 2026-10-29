/** Local cooperative SDK worker receiver. No parent, archive, release or remote effects. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import type { AgentCreateIntent, WorkspaceIntent } from "../shared/supervision-effects";
import type { PaseoApi } from "./host-types";
import { ReceiverRejected, sameDirectory } from "./supervision-effects";
import { SupervisionUiReceiver } from "./supervision-ui-receiver";
import { stopAgent } from "./cli";

const exec = promisify(execFile);
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
      const workspace = await this.api.workspaces.create({ workspaceId: intent.key, idempotencyKey: intent.key,
        source: { kind: "worktree", cwd: directory, action: "branch-off", refName: intent.baseBranch, baseBranch: intent.baseBranch,
          branchName: intent.branch, worktreeSlug: intent.key } });
      if (workspace.id !== intent.key) throw new Error("Receiver returned another workspace identity; retain uncertainty.");
      const path = workspace.directory ?? (await workspace.refresh())?.workspaceDirectory;
      if (!path) throw new Error("Reserved workspace has no observable worktree; retain uncertainty.");
      await this.verifyWorktree(path, directory, intent.branch);
      return { workspaceId: workspace.id, directory: path };
    };
  }
  override async findWorkspace(intent: WorkspaceIntent) {
    if (intent.purpose === "supervisor") return super.findWorkspace(intent);
    const workspace = await this.api.workspaces.ref(intent.key).refresh();
    if (!workspace?.workspaceDirectory || workspace.id !== intent.key) return null;
    await this.verifyWorktree(workspace.workspaceDirectory, await this.projectDirectory(intent.project), intent.branch);
    return { workspaceId: workspace.id, directory: workspace.workspaceDirectory };
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
