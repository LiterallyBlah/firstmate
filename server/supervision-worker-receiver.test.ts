import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import type { PaseoApi } from "./host-types";
import { ReceiverRejected } from "./supervision-effects";
import { SupervisionWorkerReceiver } from "./supervision-worker-receiver";
import type { WorkspaceIntent } from "../shared/supervision-effects";
const execute = promisify(execFile);
/** The fake models the real @getpaseo/client + daemon contract: a caller `workspaceId` is only
 * accepted matching `^wks_[a-f0-9]{16}$` (checked by the client's schema parse, so a bad one is a
 * genuine ZodError) and the daemon otherwise assigns `wks_<hex>` ids; the intent key survives as
 * idempotency key and worktree slug. On the creationLifecycle path a lost connection is recovered
 * inside the client, so the receiver sees success there; `DAEMON_CONNECTION_LOST` surfacing as a
 * rejection is the legacy path. Provisioning failures (e.g. an invalid ref) surface as a plain
 * daemon error with the outcome unknown, never as a clean refusal. */
type Behavior = "ok" | "slug-collision" | "slug-rewritten" | "slug-rewritten-alias" | "timeout-after-create" | "timeout" |
  "outcome-unknown" | "half-built" | "half-built-dir" | "refuse" | "schema" | "daemon-error" | "lose-before-create";
async function fixture(behavior: Behavior = "ok") {
  const root = join(process.env.PASEO_HOME!, randomUUID()), project = join(root, "project"), worktree = join(root, "isolated");
  await mkdir(project, { recursive: true });
  const git = async (...args: string[]) => execute("git", ["-C", project, ...args], { windowsHide: true });
  await git("init", "-b", "main"); await writeFile(join(project, "source.txt"), "baseline\n"); await git("add", ".");
  await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "baseline");
  const intent: WorkspaceIntent = { key: `ws-${randomUUID()}`, purpose: "worker", project: "fixture", hostId: "local", branch: `fm/${randomUUID()}`, baseBranch: "main" };
  const paseoId = `wks_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const entries: { id: string; workspaceDirectory: string; worktreeSlug: string }[] = [];
  const agentCreate = vi.fn(async (i: { agentId: string }) => ({ id: i.agentId }));
  let handle = { id: paseoId, directory: worktree, refresh: async () => ({ id: paseoId, workspaceDirectory: worktree, worktreeSlug: intent.key }), agents: { create: agentCreate } };
  const timeout = () => Object.assign(new Error("Timeout waiting for message (60000ms)"), { code: "DAEMON_REQUEST_TIMEOUT" });
  const create = vi.fn(async (options: { workspaceId?: string; idempotencyKey?: string; source: { worktreeSlug?: string } }) => {
    if (behavior === "schema") z.object({ workspaceId: z.string().regex(/^wks_[a-f0-9]{16}$/) }).parse({ workspaceId: "ws-not-a-paseo-id" });
    const claimed = options.workspaceId !== undefined
      ? z.string().regex(/^wks_[a-f0-9]{16}$/).parse(options.workspaceId) : paseoId;
    if (behavior === "refuse") throw new Error("directory_not_found");
    if (behavior === "daemon-error") throw new Error("workspace setup failed");
    if (behavior === "timeout") throw timeout();
    if (behavior === "outcome-unknown") throw new Error("workspace_request_outcome_unknown");
    if (behavior === "lose-before-create") throw Object.assign(new Error("Daemon connection lost"), { code: "DAEMON_CONNECTION_LOST" });
    if (behavior === "half-built-dir") {
      await mkdir(join(process.env.PASEO_HOME!, "worktrees", "fixturehash", intent.key), { recursive: true });
      throw new Error("workspace provisioning failed");
    }
    await git("worktree", "add", "-b", intent.branch, worktree, "main");
    if (behavior === "half-built") throw new Error("workspace provisioning failed"); // worktree+branch on disk, no registry row
    const slug = behavior === "slug-collision" ? `${intent.key}-1` : behavior.startsWith("slug-rewritten") ? "rewritten-by-hook" : options.source.worktreeSlug!;
    // The daemon's spelling of the directory may differ from git's (junction here; Windows 8.3
    // short names on CI runners): only canonical-path comparison can still match the branch mark.
    let listed = worktree;
    if (behavior === "slug-rewritten-alias") { listed = join(root, "alias"); await symlink(worktree, listed, "junction"); }
    entries.push({ id: claimed, workspaceDirectory: listed, worktreeSlug: slug });
    handle = { ...handle, id: claimed, refresh: async () => ({ id: claimed, workspaceDirectory: worktree, worktreeSlug: slug }) };
    if (behavior === "timeout-after-create") throw timeout();
    return handle;
  });
  const list = vi.fn(async (_options?: unknown) => ({ entries: [...entries], pageInfo: { nextCursor: null }, requestId: "fixture" }));
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
  expect(f.list.mock.calls[0]![0]).toMatchObject({ sort: [{ key: "name", direction: "asc" }] });
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
it("reconciles a create reply lost to a request timeout to the one created workspace, never a second", async () => {
  const f = await fixture("timeout-after-create"), workspace = await f.receiver.openWorkspace(f.intent);
  expect(workspace).toEqual({ workspaceId: f.paseoId, directory: f.worktree });
  expect(f.create.mock.calls).toHaveLength(1);
  expect(await f.receiver.findWorkspace(f.intent)).toEqual(workspace);
  expect(f.create.mock.calls).toHaveLength(1);
}, 30000);
it("finds the workspace when the daemon suffixed its slug on a path collision", async () => {
  const f = await fixture("slug-collision"), workspace = await f.receiver.openWorkspace(f.intent);
  expect(await f.receiver.findWorkspace(f.intent)).toEqual(workspace);
}, 30000);
it("finds the workspace by its branch when a hook rewrote the slug", async () => {
  const f = await fixture("slug-rewritten"), workspace = await f.receiver.openWorkspace(f.intent);
  expect(await f.receiver.findWorkspace(f.intent)).toEqual(workspace);
}, 30000);
it("finds the workspace by its branch when the listed directory is an alias spelling", async () => {
  const f = await fixture("slug-rewritten-alias"), workspace = await f.receiver.openWorkspace(f.intent);
  const found = await f.receiver.findWorkspace(f.intent);
  expect(found?.workspaceId).toBe(workspace.workspaceId);
  expect(await realpath(found!.directory)).toBe(await realpath(f.worktree));
}, 30000);
it("settles a pre-admission daemon refusal as rejected, with nothing created", async () => {
  const f = await fixture("refuse");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toBeInstanceOf(ReceiverRejected);
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("directory_not_found");
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("settles a client-side schema error as rejected, with nothing created", async () => {
  const f = await fixture("schema");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toBeInstanceOf(ReceiverRejected);
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("settles an unfamiliar daemon error as rejected only with git-level proof nothing was created", async () => {
  const f = await fixture("daemon-error");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toBeInstanceOf(ReceiverRejected);
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("workspace setup failed");
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("keeps a request timeout uncertain: creation may still be running", async () => {
  const f = await fixture("timeout");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("Timeout waiting for message");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.not.toBeInstanceOf(ReceiverRejected);
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("keeps the daemon's outcome-unknown marker uncertain, not rejected", async () => {
  const f = await fixture("outcome-unknown");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("workspace_request_outcome_unknown");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.not.toBeInstanceOf(ReceiverRejected);
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("keeps a half-built worktree uncertain: branch and worktree exist with no registry row", async () => {
  const f = await fixture("half-built");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("provisioning failed");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.not.toBeInstanceOf(ReceiverRejected);
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("keeps a half-built managed directory uncertain: the slug directory exists with no registry row", async () => {
  const f = await fixture("half-built-dir");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("provisioning failed");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.not.toBeInstanceOf(ReceiverRejected);
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("keeps a legacy connection lost before creation uncertain, not rejected", async () => {
  const f = await fixture("lose-before-create");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("connection lost");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.not.toBeInstanceOf(ReceiverRejected);
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
