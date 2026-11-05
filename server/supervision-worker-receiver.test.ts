import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { PaseoApi } from "./host-types";
import { ReceiverRejected } from "./supervision-effects";
import { SupervisionWorkerReceiver } from "./supervision-worker-receiver";
import type { WorkspaceIntent } from "../shared/supervision-effects";
const execute = promisify(execFile);
/** The fake models @getpaseo/client's real contract: its CreationClient refuses a caller-selected
 * workspace id outright ("Update the host to use caller-selected creation IDs.") and the daemon
 * assigns `wks_<hex>` ids. The intent key survives only as idempotency key and worktree slug. */
async function fixture(behavior: "ok" | "lose-reply" | "refuse" | "lose-before-create" = "ok") {
  const root = join(process.env.PASEO_HOME!, randomUUID()), project = join(root, "project"), worktree = join(root, "isolated");
  await mkdir(project, { recursive: true });
  const git = async (...args: string[]) => execute("git", ["-C", project, ...args], { windowsHide: true });
  await git("init", "-b", "main"); await writeFile(join(project, "source.txt"), "baseline\n"); await git("add", ".");
  await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "baseline");
  const intent: WorkspaceIntent = { key: `ws-${randomUUID()}`, purpose: "worker", project: "fixture", hostId: "local", branch: `fm/${randomUUID()}`, baseBranch: "main" };
  const paseoId = `wks_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const entries: { id: string; workspaceDirectory: string; worktreeSlug: string }[] = [];
  const agentCreate = vi.fn(async (i: { agentId: string }) => ({ id: i.agentId }));
  const handle = { id: paseoId, directory: worktree, refresh: async () => ({ id: paseoId, workspaceDirectory: worktree, worktreeSlug: intent.key }), agents: { create: agentCreate } };
  const lost = () => Object.assign(new Error("Daemon connection lost"), { code: "DAEMON_CONNECTION_LOST" });
  const create = vi.fn(async (options: { workspaceId?: string; idempotencyKey?: string; source: { worktreeSlug?: string } }) => {
    if (options.workspaceId !== undefined) throw new Error("Update the host to use caller-selected creation IDs.");
    if (behavior === "refuse") throw new Error("invalid ref: main");
    if (behavior === "lose-before-create") throw lost();
    await git("worktree", "add", "-b", intent.branch, worktree, "main");
    entries.push({ id: paseoId, workspaceDirectory: worktree, worktreeSlug: options.source.worktreeSlug! });
    if (behavior === "lose-reply") throw lost();
    return handle;
  });
  const list = vi.fn(async () => ({ entries: [...entries], pageInfo: { nextCursor: null }, requestId: "fixture" }));
  const api = { workspaces: { create, list, ref: () => handle } } as unknown as PaseoApi;
  return { project, worktree, intent, paseoId, create, list, agentCreate, receiver: new SupervisionWorkerReceiver(api, root, async () => project) };
}
it("opens and positively looks up the exact isolated branch without prompting or parent ancestry", async () => {
  const f = await fixture(), workspace = await f.receiver.openWorkspace(f.intent);
  expect(workspace).toEqual({ workspaceId: f.paseoId, directory: f.worktree });
  expect(workspace.workspaceId).not.toBe(f.intent.key);
  expect(await f.receiver.findWorkspace(f.intent)).toEqual(workspace);
  expect(f.create.mock.calls).toHaveLength(1);
  expect(f.create.mock.calls[0]![0]).not.toHaveProperty("workspaceId");
  expect(f.create.mock.calls[0]![0]).toMatchObject({ idempotencyKey: f.intent.key, source: { worktreeSlug: f.intent.key } });
  await f.receiver.createAgent({ agentId: randomUUID(), workspaceId: workspace.workspaceId, cwd: workspace.directory, title: "builder",
    profile: { provider: "codex/test", modeId: "full-access", thinkingOptionId: "xhigh" }, labels: { "firstmate.role": "crew", "firstmate.scope": randomUUID(), "firstmate.attempt": randomUUID() } });
  expect(f.agentCreate.mock.calls[0]![0]).not.toHaveProperty("prompt");
  expect(await f.receiver.capabilities()).toMatchObject({ qualification: "cooperative-paseo", workspaceIntentLookup: true, conditionalArchive: false, sendReceiptLookup: false });
}, 30000);
it("refuses a root checkout, wrong branch, foreign repository and remote work", async () => {
  const f = await fixture();
  await expect(f.receiver.openWorkspace({ ...f.intent, hostId: "remote" })).rejects.toThrow("local");
  await f.receiver.openWorkspace(f.intent);
  await expect(f.receiver.findWorkspace({ ...f.intent, branch: "fm/other" })).rejects.toThrow("isolation");
  f.create.mockResolvedValueOnce({ id: f.paseoId, directory: f.project } as never);
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("isolation");
  const foreign = await fixture(); await foreign.receiver.openWorkspace(foreign.intent);
  f.create.mockResolvedValueOnce({ id: f.paseoId, directory: foreign.worktree } as never);
  await expect(f.receiver.openWorkspace({ ...f.intent, branch: foreign.intent.branch })).rejects.toThrow("isolation");
  await expect(f.receiver.archive("worker")).rejects.toThrow("U3");
}, 30000);
it("reconciles a lost create reply to the one created workspace, never a second", async () => {
  const f = await fixture("lose-reply"), workspace = await f.receiver.openWorkspace(f.intent);
  expect(workspace).toEqual({ workspaceId: f.paseoId, directory: f.worktree });
  expect(f.create.mock.calls).toHaveLength(1);
  expect(await f.receiver.findWorkspace(f.intent)).toEqual(workspace);
  expect(f.create.mock.calls).toHaveLength(1);
}, 30000);
it("settles a definite host refusal as rejected, with nothing created", async () => {
  const f = await fixture("refuse");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toBeInstanceOf(ReceiverRejected);
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("invalid ref");
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("keeps a connection lost before creation uncertain, not rejected", async () => {
  const f = await fixture("lose-before-create");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("connection lost");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.not.toBeInstanceOf(ReceiverRejected);
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
