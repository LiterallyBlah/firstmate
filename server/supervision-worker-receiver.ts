/** Local cooperative SDK worker receiver. No parent, archive, release or remote effects. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { AgentCreateIntent, WorkspaceIntent, WorkspaceReceipt } from "../shared/supervision-effects";
import type { PaseoApi } from "./host-types";
import { paseoHome } from "./data-dir";
import { ReceiverRejected, sameDirectory } from "./supervision-effects";
import { SupervisionUiReceiver } from "./supervision-ui-receiver";
import { stopAgent } from "./cli";

const exec = promisify(execFile);
/** The durable slug mark: the intent key itself, or the daemon's `-1`, `-2` path-collision suffix. */
const slugFor = (key: string, slug: string | undefined) =>
  slug === key || (slug?.startsWith(`${key}-`) === true && /^\d+$/.test(slug.slice(key.length + 1)));
/** Errors known to be raised before the daemon admits a creation, so nothing was provisioned:
 * the client's own schema parse and in-flight key conflict, and the daemon's pre-admission codes. */
function preAdmissionRefusal(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ZodError" && Array.isArray((error as { issues?: unknown }).issues)) return true;
  if (error.message === "workspace_request_key_conflict") return true;
  return error.message.split(/[^a-z_]+/).some(token => token === "directory_not_found" || token === "source_required");
}
/** Errors after which creation may still be running or may already have landed: connection loss,
 * the client's request timeout, and the daemon's own outcome-unknown marker. Always uncertain. */
function transportLoss(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "DAEMON_CONNECTION_LOST" || code === "DAEMON_REQUEST_TIMEOUT") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /outcome_unknown|Timeout waiting|timed out|Daemon client closed/i.test(message);
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
      // No caller-chosen workspace id: on creationLifecycle hosts the protocol only accepts
      // `wks_[a-f0-9]{16}` (our `ws-<uuid>` key died in the client's schema parse), and on older
      // hosts the client refuses a caller id outright. The daemon assigns the id; the intent key
      // travels as idempotency key and worktree slug, the marks the lookup below finds it by.
      let workspace;
      try {
        workspace = await this.api.workspaces.create({ idempotencyKey: intent.key,
          source: { kind: "worktree", cwd: directory, action: "branch-off", refName: intent.baseBranch, baseBranch: intent.baseBranch,
            branchName: intent.branch, worktreeSlug: intent.key } });
      } catch (error) {
        // A lost reply may still have created the workspace: reconcile by the intent's marks
        // before settling. Default is uncertain; "not created" must be proven — a known
        // pre-admission refusal, or an empty registry plus git-level absence (proveNotCreated).
        const found = await this.lookupWorkspace(intent, directory).catch(() => undefined);
        if (found) return found;
        if (found === null && !transportLoss(error) && (preAdmissionRefusal(error) || await this.proveNotCreated(intent, directory)))
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
  /** Positive lookup by the intent's durable marks: worktree slug (with any collision suffix, or a
   * legacy caller-chosen id), or the reserved branch's worktree inside the project's repository —
   * each confirmed by git verification. Null only when no candidate exists; a present but
   * unverifiable or ambiguous candidate throws, staying uncertain. */
  private async lookupWorkspace(intent: WorkspaceIntent, project: string): Promise<WorkspaceReceipt | null> {
    const entries: { id: string; workspaceDirectory: string; worktreeSlug: string | undefined }[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.api.workspaces.list({ sort: [{ key: "name", direction: "asc" }], page: { limit: 200, ...(cursor ? { cursor } : {}) } });
      for (const entry of page.entries)
        if (entry.workspaceDirectory && !entries.some(e => e.id === entry.id))
          entries.push({ id: entry.id, workspaceDirectory: entry.workspaceDirectory, worktreeSlug: entry.worktreeSlug });
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    const branchPath = await this.branchWorktreePath(project, intent.branch).catch(() => null);
    let matches = entries.filter(e => slugFor(intent.key, e.worktreeSlug) || e.id === intent.key ||
      (branchPath !== null && sameDirectory(e.workspaceDirectory, branchPath)));
    if (!matches.length && branchPath) {
      // Git and the daemon may spell the same directory differently (Windows 8.3 short names,
      // junctions): compare canonical paths before giving up on the branch mark.
      const realBranch = await realpath(branchPath).catch(() => null);
      if (realBranch) for (const entry of entries) {
        const real = await realpath(entry.workspaceDirectory).catch(() => null);
        if (real && sameDirectory(real, realBranch)) matches.push(entry);
      }
    }
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
  /** Git-level proof that a failed create left nothing behind: no branch ref, no worktree for it,
   * and no managed worktree directory named for the intent. Any doubt returns false (uncertain). */
  private async proveNotCreated(intent: WorkspaceIntent, project: string): Promise<boolean> {
    try {
      await this.git(project, ["rev-parse", "--path-format=absolute", "--git-common-dir"]); // git reads this repo at all
      if (await this.git(project, ["rev-parse", "--verify", "--quiet", `refs/heads/${intent.branch}`]).then(() => true, () => false)) return false;
      if (await this.branchWorktreePath(project, intent.branch)) return false;
      const root = join(paseoHome(), "worktrees");
      let hashes;
      try { hashes = await readdir(root, { withFileTypes: true }); }
      catch (error) { return (error as { code?: unknown }).code === "ENOENT"; }
      for (const hash of hashes) {
        if (!hash.isDirectory()) continue;
        const names = await readdir(join(root, hash.name)).catch(() => null);
        if (names === null || names.some(name => slugFor(intent.key, name))) return false;
      }
      return true;
    } catch { return false; }
  }
  private async branchWorktreePath(project: string, branch: string): Promise<string | null> {
    const out = await this.git(project, ["worktree", "list", "--porcelain"], false);
    let path: string | null = null;
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line === `branch refs/heads/${branch}` && path) return path;
      else if (!line) path = null;
    }
    return null;
  }
  private async git(cwd: string, args: string[], trim = true): Promise<string> {
    const out = (await exec("git", ["-C", cwd, ...args], { timeout: 15000, maxBuffer: 65536, windowsHide: true })).stdout;
    return trim ? out.trim() : out;
  }
  private async verifyWorktree(path: string, project: string, branch: string) {
    const root = await realpath(project), directory = await realpath(path);
    if (sameDirectory(root, directory) || !sameDirectory(await this.git(directory, ["rev-parse", "--show-toplevel"]), directory) ||
      await this.git(directory, ["branch", "--show-current"]) !== branch ||
      !sameDirectory(await this.git(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), await this.git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])))
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
