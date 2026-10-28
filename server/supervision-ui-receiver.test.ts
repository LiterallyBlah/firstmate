import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { join } from "node:path";
import type { PaseoApi } from "./host-types";
import { SupervisionUiReceiver } from "./supervision-ui-receiver";
import { supervisorWorkspaceIntent } from "./supervision-effects";
it("the live-shaped adapter creates an unprompted, parentless reserved supervisor and preserves send IDs", async () => {
  const id = randomUUID(), scope = randomUUID(), root = process.env.PASEO_HOME!;
  const create = vi.fn(async () => ({ id })), open = vi.fn(async () => ({ id: "workspace" })), send = vi.fn(async () => {});
  const refresh = vi.fn(async () => ({ agent: { id, workspaceId: "workspace", cwd: root, provider: "codex/test", currentModeId: "read-only",
    status: "idle", pendingPermissions: [], archivedAt: null, labels: { "firstmate.role": "plan-supervisor" } } }));
  const api = { workspaces: { open, ref: () => ({ agents: { create } }) }, agents: { ref: () => ({ refresh, send }) } } as unknown as PaseoApi;
  const receiver = new SupervisionUiReceiver(api, root), intent = supervisorWorkspaceIntent(scope, 1, randomUUID());
  const workspace = await receiver.openWorkspace(intent);
  expect(open).toHaveBeenCalledWith(join(root, "supervisor-workspaces", intent.key));
  await receiver.createAgent({ agentId: id, workspaceId: workspace.workspaceId, cwd: workspace.directory,
    profile: { provider: "codex/test", modeId: "read-only" }, title: "Plan supervisor", labels: { "firstmate.role": "plan-supervisor" } });
  const args = create.mock.calls[0] as unknown[];
  expect(args[0]).toMatchObject({ agentId: id, idempotencyKey: id }); expect(args[0]).not.toHaveProperty("prompt"); expect(args[0]).not.toHaveProperty("parent");
  expect(await receiver.findAgent(id)).toMatchObject({ id, modeId: "read-only", pendingPermissions: 0 });
  await receiver.send(id, "opening", "reserved-message");
  expect(send).toHaveBeenCalledWith("opening", { messageId: "reserved-message", activeTurnBehavior: "steer" });
  expect(await receiver.capabilities()).toMatchObject({ qualification: "cooperative-paseo", conditionalArchive: false, sendReceiptLookup: false, workspaceIntentLookup: false });
  await expect(receiver.archive(id)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(receiver.interrupt(id)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  refresh.mockRejectedValueOnce(new Error("connection lost"));
  await expect(receiver.findAgent(id)).rejects.toThrow("connection lost");
});
