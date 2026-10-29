import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { PaseoApi } from "./host-types";
import { SupervisionWorkerReceiver } from "./supervision-worker-receiver";
import type { WorkspaceIntent } from "../shared/supervision-effects";
const execute = promisify(execFile);
async function fixture() {
  const root = join(process.env.PASEO_HOME!, randomUUID()), project = join(root, "project"), worktree = join(root, "isolated");
  await mkdir(project, { recursive: true });
  const git = async (...args: string[]) => execute("git", ["-C", project, ...args], { windowsHide: true });
  await git("init", "-b", "main"); await writeFile(join(project, "source.txt"), "baseline\n"); await git("add", ".");
  await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "baseline");
  const intent: WorkspaceIntent = { key: `ws-${randomUUID()}`, purpose: "worker", project: "fixture", hostId: "local", branch: `fm/${randomUUID()}`, baseBranch: "main" };
  const agentCreate = vi.fn(async (i: { agentId: string }) => ({ id: i.agentId }));
  const handle = { id: intent.key, directory: worktree, refresh: async () => ({ id: intent.key, workspaceDirectory: worktree }), agents: { create: agentCreate } };
  const create = vi.fn(async () => { await git("worktree", "add", "-b", intent.branch, worktree, "main"); return handle; });
  const api = { workspaces: { create, ref: () => handle } } as unknown as PaseoApi;
  return { project, worktree, intent, create, agentCreate, receiver: new SupervisionWorkerReceiver(api, root, async () => project) };
}
it("opens and positively looks up the exact isolated branch without prompting or parent ancestry", async () => {
  const f = await fixture(), workspace = await f.receiver.openWorkspace(f.intent);
  expect(workspace.directory).toBe(f.worktree); expect(await f.receiver.findWorkspace(f.intent)).toEqual(workspace);
  expect(f.create.mock.calls).toHaveLength(1);
  await f.receiver.createAgent({ agentId: randomUUID(), workspaceId: workspace.workspaceId, cwd: workspace.directory, title: "builder",
    profile: { provider: "codex/test", modeId: "full-access", thinkingOptionId: "xhigh" }, labels: { "firstmate.role": "crew", "firstmate.scope": randomUUID(), "firstmate.attempt": randomUUID() } });
  expect(f.agentCreate.mock.calls[0]![0]).not.toHaveProperty("prompt");
  expect(await f.receiver.capabilities()).toMatchObject({ qualification: "cooperative-paseo", workspaceIntentLookup: true, conditionalArchive: false, sendReceiptLookup: false });
});
it("refuses a root checkout, wrong branch, foreign repository and remote work", async () => {
  const f = await fixture();
  await expect(f.receiver.openWorkspace({ ...f.intent, hostId: "remote" })).rejects.toThrow("local");
  await f.receiver.openWorkspace(f.intent);
  await expect(f.receiver.findWorkspace({ ...f.intent, branch: "fm/other" })).rejects.toThrow("isolation");
  f.create.mockResolvedValueOnce({ id: f.intent.key, directory: f.project } as never);
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("isolation");
  const foreign = await fixture(); await foreign.receiver.openWorkspace(foreign.intent);
  f.create.mockResolvedValueOnce({ id: f.intent.key, directory: foreign.worktree } as never);
  await expect(f.receiver.openWorkspace({ ...f.intent, branch: foreign.intent.branch })).rejects.toThrow("isolation");
  await expect(f.receiver.archive("worker")).rejects.toThrow("U3");
});
