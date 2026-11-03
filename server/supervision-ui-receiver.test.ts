import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { join } from "node:path";
import type { PaseoApi } from "./host-types";
import { SupervisionUiReceiver } from "./supervision-ui-receiver";
import { supervisorWorkspaceIntent } from "./supervision-effects";
it("the live-shaped adapter creates an unprompted, parentless reserved supervisor and preserves send IDs", async () => {
  const id = randomUUID(), scope = randomUUID(), root = process.env.PASEO_HOME!;
  const create = vi.fn(async () => ({ id })), open = vi.fn(async () => ({ id: "workspace" })), send = vi.fn(async () => {});
  const refresh = vi.fn(async () => ({ agent: { id, workspaceId: "workspace", cwd: root, provider: "codex", model: "test", currentModeId: "read-only",
    status: "idle", pendingPermissions: [], archivedAt: null, labels: { "firstmate.role": "plan-supervisor" } } }));
  const api = { workspaces: { open, ref: () => ({ agents: { create } }) }, agents: { ref: () => ({ refresh, send }) } } as unknown as PaseoApi;
  const receiver = new SupervisionUiReceiver(api, root), intent = supervisorWorkspaceIntent(scope, 1, randomUUID());
  const workspace = await receiver.openWorkspace(intent);
  expect(open).toHaveBeenCalledWith(join(root, "supervisor-workspaces", intent.key));
  await receiver.createAgent({ agentId: id, workspaceId: workspace.workspaceId, cwd: workspace.directory,
    profile: { provider: "codex/test", modeId: "read-only" }, title: "Plan supervisor", labels: { "firstmate.role": "plan-supervisor" } });
  const args = create.mock.calls[0] as unknown[];
  expect(args[0]).toMatchObject({ agentId: id, idempotencyKey: id }); expect(args[0]).not.toHaveProperty("prompt"); expect(args[0]).not.toHaveProperty("parent");
  expect(await receiver.findAgent(id)).toMatchObject({ id, provider: "codex/test", modeId: "read-only", pendingPermissions: 0 });
  await receiver.send(id, "opening", "reserved-message");
  expect(send).toHaveBeenCalledWith("opening", { messageId: "reserved-message", activeTurnBehavior: "steer" });
  expect(await receiver.capabilities()).toMatchObject({ qualification: "cooperative-paseo", conditionalArchive: false, sendReceiptLookup: false, workspaceIntentLookup: false });
  await expect(receiver.archive(id)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(receiver.interrupt(id)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  refresh.mockRejectedValueOnce(new Error("connection lost"));
  await expect(receiver.findAgent(id)).rejects.toThrow("connection lost");
});

it("project creation is refused by the Attach receiver unless explicitly enabled, and remains unprompted and independent", async () => {
  const id = randomUUID(), create = vi.fn(async (_input: unknown) => ({ id })), api = { workspaces: { ref: () => ({ agents: { create } }) } } as unknown as PaseoApi;
  const intent = { agentId: id, workspaceId: "independent-project", cwd: "C:/project-mate", profile: { provider: "codex/test", modeId: "full-access", thinkingOptionId: "xhigh" },
    title: "Project mate", labels: { "firstmate.role": "project-mate" } };
  await expect(new SupervisionUiReceiver(api, process.env.PASEO_HOME!).createAgent(intent)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(create).not.toHaveBeenCalled();
  await new SupervisionUiReceiver(api, process.env.PASEO_HOME!, { projectMates: true }).createAgent(intent);
  expect(create).toHaveBeenCalledWith({ agentId: id, idempotencyKey: id, config: { provider: "codex/test", modeId: "full-access", thinkingOptionId: "xhigh" }, title: "Project mate", labels: { "firstmate.role": "project-mate" } });
  expect(create.mock.calls[0]![0]).not.toHaveProperty("prompt"); expect(create.mock.calls[0]![0]).not.toHaveProperty("parent");
});

it("maintenance creation requires its own explicit receiver switch and never accepts a native parent", async () => {
  const id = randomUUID(), create = vi.fn(async (_input: unknown) => ({ id })), api = { workspaces: { ref: () => ({ agents: { create } }) } } as unknown as PaseoApi;
  const intent = { agentId: id, workspaceId: "independent-maintenance", cwd: "C:/maintenance", profile: { provider: "codex/test", modeId: "full-access", thinkingOptionId: "xhigh" },
    title: "Maintenance mate", labels: { "firstmate.role": "maintenance-mate" } };
  await expect(new SupervisionUiReceiver(api, process.env.PASEO_HOME!).createAgent(intent)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(new SupervisionUiReceiver(api, process.env.PASEO_HOME!, { projectMates: true }).createAgent(intent)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  const receiver = new SupervisionUiReceiver(api, process.env.PASEO_HOME!, { maintenanceMates: true });
  await expect(receiver.createAgent({ ...intent, labels: { ...intent.labels, "paseo.parent-agent-id": "general" } })).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(create).not.toHaveBeenCalled(); await receiver.createAgent(intent);
  expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0]![0]).not.toHaveProperty("prompt"); expect(create.mock.calls[0]![0]).not.toHaveProperty("parent");
});

it("reads the new Supervisor role with its scope kind beside each kind's old role, under the same switches", async () => {
  const create = vi.fn(async (input: { agentId: string }) => ({ id: input.agentId })), api = { workspaces: { ref: () => ({ agents: { create } }) } } as unknown as PaseoApi;
  const intent = (labels: Record<string, string>) => ({ agentId: randomUUID(), workspaceId: "independent", cwd: "C:/supervisor",
    profile: { provider: "codex/test", modeId: "full-access" }, title: "Supervisor · Ariadne", labels });
  const plain = new SupervisionUiReceiver(api, process.env.PASEO_HOME!), all = new SupervisionUiReceiver(api, process.env.PASEO_HOME!, { projectMates: true, maintenanceMates: true });
  for (const labels of [{ "firstmate.role": "supervisor", "firstmate.scope-kind": "plan" }, { "firstmate.role": "plan-supervisor" }])
    await plain.createAgent(intent(labels));
  for (const labels of [{ "firstmate.role": "supervisor", "firstmate.scope-kind": "project" }, { "firstmate.role": "project-mate" },
    { "firstmate.role": "supervisor", "firstmate.scope-kind": "maintenance" }, { "firstmate.role": "maintenance-mate" }]) {
    await expect(plain.createAgent(intent(labels))).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await all.createAgent(intent(labels));
  }
  // A Supervisor role without a known kind, an old role claiming another kind, or crew is never a Supervisor here.
  for (const labels of [{ "firstmate.role": "supervisor" }, { "firstmate.role": "supervisor", "firstmate.scope-kind": "general" },
    { "firstmate.role": "project-mate", "firstmate.scope-kind": "plan" }, { "firstmate.role": "crew" }])
    await expect(all.createAgent(intent(labels))).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(create).toHaveBeenCalledTimes(6);
});
