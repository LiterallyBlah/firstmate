import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { connectPlanBootstrap } from "./plan-bootstrap";
function fixture(home: string, overrides: object = {}) {
  const client = { connect: vi.fn(async () => {}), close: vi.fn(async () => {}), agents: { ref: vi.fn(() => ({ refresh: vi.fn(async () => ({ agent: {
    id: "general", cwd: home, archivedAt: null, ...overrides } })) })) } };
  const create = vi.fn(() => client) as unknown as NonNullable<Parameters<typeof connectPlanBootstrap>[2]>["create"];
  return { client, create };
}
it("F2: explicit loopback bootstrap connects and reads General identity without launching, then releases its connection", async () => {
  const home = await mkdtemp(join(process.env.PASEO_HOME!, "bootstrap-")), f = fixture(home);
  const connection = await connectPlanBootstrap(home, "general", { env: { FIRSTMATE_PLAN_BOOTSTRAP_URL: "ws://127.0.0.1:6767/ws", FIRSTMATE_PLAN_BOOTSTRAP_PASSWORD: "synthetic-secret" }, create: f.create! });
  expect(f.client.connect).toHaveBeenCalledOnce(); expect(f.client.agents.ref).toHaveBeenCalledExactlyOnceWith("general");
  expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ password: "synthetic-secret", connectTimeoutMs: 5000 }));
  await connection.close(); expect(f.client.close).toHaveBeenCalledOnce();
});
it.each([undefined, "ws://other-host:6767/ws", "ws://127.0.0.1:6767/ws?token=no", "ws://user:secret@127.0.0.1:6767/ws", "http://127.0.0.1:6767/ws"])("F2: missing or unqualified endpoint never creates a client (%s)", async url => {
  const f = fixture("home"); await expect(connectPlanBootstrap("home", "general", { env: url ? { FIRSTMATE_PLAN_BOOTSTRAP_URL: url } : {}, create: f.create! })).rejects.toMatchObject({ code: "HELD" });
  expect(f.create).not.toHaveBeenCalled();
});
it.each([{ id: "wrong-general" }, { cwd: "wrong-home" }, { archivedAt: "2026-10-29T00:00:00Z" }])("F2: mismatched General/home refuses and closes before retained work (%j)", async override => {
  const home = await mkdtemp(join(process.env.PASEO_HOME!, "bootstrap-")), f = fixture(home, override);
  await expect(connectPlanBootstrap(home, "general", { env: { FIRSTMATE_PLAN_BOOTSTRAP_URL: "ws://127.0.0.1:6767/ws" }, create: f.create! })).rejects.toMatchObject({ code: "HELD" });
  expect(f.client.close).toHaveBeenCalledOnce();
});
it("F2: connection failure closes and does not disclose authentication diagnostics", async () => {
  const f = fixture("home"); f.client.connect.mockRejectedValueOnce(new Error("synthetic-secret password rejected"));
  await expect(connectPlanBootstrap("home", "general", { env: { FIRSTMATE_PLAN_BOOTSTRAP_URL: "ws://127.0.0.1:6767/ws" }, create: f.create! })).rejects.toThrow("retained work remains held");
  expect(f.client.close).toHaveBeenCalledOnce();
});
