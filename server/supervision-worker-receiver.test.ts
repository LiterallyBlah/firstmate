import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
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
  "outcome-unknown" | "half-built" | "half-built-dir" | "refuse" | "schema" | "daemon-error" | "lose-before-create" |
  "key-conflict" | "key-conflict-half-built" | "embedded-code-half-built" | "directory-message" | "directory-message-half-built" | "corrupt-packed-refs" | "directoryless-row";
async function fixture(behavior: Behavior = "ok") {
  const root = join(process.env.PASEO_HOME!, randomUUID()), project = join(root, "project"), worktree = join(root, "isolated");
  await mkdir(project, { recursive: true });
  const git = async (...args: string[]) => execute("git", ["-C", project, ...args], { windowsHide: true });
  await git("init", "-b", "main"); await writeFile(join(project, "source.txt"), "baseline\n"); await git("add", ".");
  await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "baseline");
  const intent: WorkspaceIntent = { key: `ws-${randomUUID()}`, purpose: "worker", project: "fixture", hostId: "local", branch: `fm/${randomUUID()}`, baseBranch: "main" };
  const paseoId = `wks_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const entries: { id: string; workspaceDirectory: string; worktreeSlug: string }[] = [];
  if (behavior === "directoryless-row") entries.push({ id: paseoId, workspaceDirectory: undefined as never, worktreeSlug: intent.key });
  let added = false;
  const agentCreate = vi.fn(async (i: { agentId: string }) => ({ id: i.agentId }));
  let handle = { id: paseoId, directory: worktree, refresh: async () => ({ id: paseoId, workspaceDirectory: worktree, worktreeSlug: intent.key }), agents: { create: agentCreate } };
  const timeout = () => Object.assign(new Error("Timeout waiting for message (60000ms)"), { code: "DAEMON_REQUEST_TIMEOUT" });
  const create = vi.fn(async (options: { workspaceId?: string; idempotencyKey?: string; source: { worktreeSlug?: string } }) => {
    if (behavior === "schema") z.object({ workspaceId: z.string().regex(/^wks_[a-f0-9]{16}$/) }).parse({ workspaceId: "ws-not-a-paseo-id" });
    const claimed = options.workspaceId !== undefined
      ? z.string().regex(/^wks_[a-f0-9]{16}$/).parse(options.workspaceId) : paseoId;
    if (behavior === "refuse") throw new Error("directory_not_found");
    if (behavior === "directory-message") throw new Error("Directory not found: /nope");
    if (behavior === "key-conflict") throw new Error("workspace_request_key_conflict");
    if (behavior === "corrupt-packed-refs") { await writeFile(join(project, ".git", "packed-refs"), "garbage-line-not-a-ref\n"); throw new Error("workspace setup failed"); }
    if (behavior === "daemon-error") throw new Error("workspace setup failed");
    if (behavior === "timeout") throw timeout();
    if (behavior === "outcome-unknown") throw new Error("workspace_request_outcome_unknown");
    if (behavior === "lose-before-create") throw Object.assign(new Error("Daemon connection lost"), { code: "DAEMON_CONNECTION_LOST" });
    if (behavior === "half-built-dir") {
      await mkdir(join(process.env.PASEO_HOME!, "worktrees", "fixturehash", intent.key), { recursive: true });
      throw new Error("workspace provisioning failed");
    }
    if (!added) { await git("worktree", "add", "-b", intent.branch, worktree, "main"); added = true; }
    if (behavior === "half-built") throw new Error("workspace provisioning failed"); // worktree+branch on disk, no registry row
    if (behavior === "key-conflict-half-built") throw new Error("workspace_request_key_conflict");
    if (behavior === "embedded-code-half-built") throw new Error("workspace provisioning failed: directory_not_found while seeding config");
    if (behavior === "directory-message-half-built") throw new Error("Directory not found: /nope");
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
it("settles a bare directory_not_found as rejected only with git-level proof nothing was created", async () => {
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
it("settles a key conflict as rejected only with git-level proof nothing was created", async () => {
  const f = await fixture("key-conflict");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toBeInstanceOf(ReceiverRejected);
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("keeps a key conflict with a half-built worktree uncertain: it must earn git proof like any error", async () => {
  const f = await fixture("key-conflict-half-built");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("workspace_request_key_conflict");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.not.toBeInstanceOf(ReceiverRejected);
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("keeps an error merely mentioning a refusal code uncertain when a worktree exists", async () => {
  const f = await fixture("embedded-code-half-built");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("provisioning failed: directory_not_found");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.not.toBeInstanceOf(ReceiverRejected);
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("keeps Directory not found uncertain when the branch is on disk: it also names a completed creation since removed", async () => {
  const f = await fixture("directory-message-half-built");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("Directory not found:");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.not.toBeInstanceOf(ReceiverRejected);
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("settles Directory not found as rejected with git-level proof nothing was created", async () => {
  const f = await fixture("directory-message");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toBeInstanceOf(ReceiverRejected);
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("Directory not found:");
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("keeps a daemon error uncertain when git cannot answer the branch check (exit other than 1)", async () => {
  const f = await fixture("corrupt-packed-refs");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("workspace setup failed");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.not.toBeInstanceOf(ReceiverRejected);
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
it("proves a worker workspace not created only when the registry and git show nothing", async () => {
  const f = await fixture();
  expect(await f.receiver.proveWorkspaceNotCreated(f.intent)).toBe(true);
  expect(await f.receiver.capabilities()).toMatchObject({ workspaceNotCreatedProof: true });
  await f.receiver.openWorkspace(f.intent);
  expect(await f.receiver.proveWorkspaceNotCreated(f.intent)).toBe(false); // It now exists.
}, 30000);
it("cannot prove not created when a half-built worktree is on disk", async () => {
  const f = await fixture("half-built");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("provisioning failed");
  expect(await f.receiver.proveWorkspaceNotCreated(f.intent)).toBe(false);
}, 30000);
it("cannot prove not created for a directory-only leftover or a git error other than exit 1", async () => {
  const dir = await fixture("half-built-dir");
  await expect(dir.receiver.openWorkspace(dir.intent)).rejects.toThrow("provisioning failed");
  expect(await dir.receiver.proveWorkspaceNotCreated(dir.intent)).toBe(false);
  const git = await fixture("corrupt-packed-refs");
  await expect(git.receiver.openWorkspace(git.intent)).rejects.toThrow("workspace setup failed");
  expect(await git.receiver.proveWorkspaceNotCreated(git.intent)).toBe(false);
}, 30000);
it("treats a registry row for the intent with no directory as doubt, not absence", async () => {
  const f = await fixture("directoryless-row");
  await expect(f.receiver.findWorkspace(f.intent)).rejects.toThrow("no directory");
  expect(await f.receiver.proveWorkspaceNotCreated(f.intent)).toBe(false);
}, 30000);
it("the proof reads the daemon's creation record for the intent key: live or completed is doubt, failed is not", async () => {
  const f = await fixture(), creations = join(process.env.PASEO_HOME!, "creations");
  await mkdir(creations, { recursive: true });
  const direct = (key: string) => join(creations, `${createHash("sha256").update(JSON.stringify(["workspace", key])).digest("hex")}.json`);
  const record = (phase?: string) => writeFile(direct(f.intent.key), JSON.stringify({
    ...(phase === undefined ? { inFlight: "workspace" } : { inFlight: null }),
    snapshot: { kind: "workspace", idempotencyKey: f.intent.key, ...(phase === undefined ? {} : { phase }) } }));
  await record("failed");
  expect(await f.receiver.proveWorkspaceNotCreated(f.intent)).toBe(true);
  await record(undefined); // No terminal phase: may still be creating in another process.
  expect(await f.receiver.proveWorkspaceNotCreated(f.intent)).toBe(false);
  const writing = await fixture();
  await writeFile(direct(writing.intent.key), JSON.stringify({ inFlight: "workspace", snapshot: null })); // Caught mid-write.
  expect(await writing.receiver.proveWorkspaceNotCreated(writing.intent)).toBe(false);
  const done = await fixture();
  await writeFile(direct(done.intent.key), JSON.stringify({ inFlight: null,
    snapshot: { kind: "workspace", idempotencyKey: done.intent.key, phase: "completed" } }));
  expect(await done.receiver.proveWorkspaceNotCreated(done.intent)).toBe(false);
}, 30000);
it("the managed-directory check follows worktrees.root; a set but unreadable root is doubt", async () => {
  const f = await fixture(), config = join(process.env.PASEO_HOME!, "config.json");
  const custom = join(process.env.PASEO_HOME!, `custom-worktrees-${randomUUID()}`);
  try {
    await writeFile(config, JSON.stringify({ worktrees: { root: custom } }));
    expect(await f.receiver.proveWorkspaceNotCreated(f.intent)).toBe(false); // Set root does not exist: unreadable.
    await mkdir(custom, { recursive: true });
    expect(await f.receiver.proveWorkspaceNotCreated(f.intent)).toBe(true);
    await mkdir(join(custom, "fixturehash", f.intent.key), { recursive: true });
    expect(await f.receiver.proveWorkspaceNotCreated(f.intent)).toBe(false); // The slug directory under the custom root.
  } finally { await rm(config, { force: true }); }
}, 30000);
it("keeps a legacy connection lost before creation uncertain, not rejected", async () => {
  const f = await fixture("lose-before-create");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.toThrow("connection lost");
  await expect(f.receiver.openWorkspace(f.intent)).rejects.not.toBeInstanceOf(ReceiverRejected);
  expect(await f.receiver.findWorkspace(f.intent)).toBeNull();
}, 30000);
