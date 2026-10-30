import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { s04Fixture } from "../test/supervision-s04-fixture";
import { expected, hash, ids, scope } from "../test/supervision-fixture";
import { readScopes } from "../shared/supervision-rpc";
import { registerScopeRpcs } from "./scope-rpc";
import { RECOVERY_OBSERVATION_TIMEOUT_MS } from "./supervision-observation";

afterEach(() => { vi.useRealTimers(); });

async function fixture() {
  const f = await s04Fixture();
  const at = new Date(Date.now() - 120_000).toISOString();
  const mutations = [
    { kind: "scope" as const, value: { ...scope(f.store.homeId), kind: "project" as const, state: "active" as const } },
    { kind: "binding" as const, value: { scopeId: ids.scope, epoch: 1, hostId: "local", agentId: "project-mate", workspaceId: "project-workspace",
      profileDigest: hash, state: "active" as const, checkpointHash: hash, acknowledgedSeq: 0, heartbeatDue: null,
      observation: { state: "dormant" as const, at } } },
  ];
  await f.store.transact(expected(mutations), randomUUID(), mutations);
  const current = { status: await f.store.read() };
  const agent = (status: PaseoAgent["status"] = "idle") => ({ id: "project-mate", workspaceId: "project-workspace", status, archivedAt: null });
  const refresh = vi.fn(async (): Promise<{ agent: ReturnType<typeof agent> } | null> => ({ agent: agent() }));
  const send = vi.fn(), reload = vi.fn(), ref = vi.fn((_id: string) => ({ refresh, send, reload }));
  const paseo = { agents: { ref } } as unknown as PaseoApi;
  let handler!: (input: unknown, context: { paseo: PaseoApi }) => Promise<unknown>;
  registerScopeRpcs({ handle: (rpc: { name: string }, run: never) => { if (rpc.name === readScopes.name) handler = run; } } as never, {
    read: async () => ({ home: f.home, generalId: f.state.globalMate, status: current.status }),
    readNeeds: async () => { throw new Error("Status must not read decisions"); }, uiEnabled: true,
  });
  const read = async () => readScopes.output.parse(await handler({}, { paseo }));
  const row = async () => (await read()).scopes.find(s => s.id === ids.scope)!;
  return { f, current, agent, refresh, send, reload, ref, read, row, at };
}

it("reports a live idle project mate after its stored observation is older than 60 seconds, without any writes or owner turn", async () => {
  const f = await fixture(), files = await f.f.files();
  expect(await f.row()).toMatchObject({ session: "dormant", observedAt: expect.any(String) });
  expect((await f.row()).observedAt).not.toBe(f.at);
  expect(f.ref.mock.calls.every(([id]) => id === "project-mate")).toBe(true);
  expect(f.refresh).toHaveBeenCalledTimes(2);
  expect(f.send).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
  expect(f.f.receiver.calls).toEqual([]); expect(await f.f.files()).toEqual(files);
});

it("reports a running project mate from the bound agent's current snapshot", async () => {
  const f = await fixture(); f.refresh.mockResolvedValue({ agent: f.agent("running") });
  expect(await f.row()).toMatchObject({ session: "awake" });
});

it.each(["archived", "missing", "unreachable", "wrong-agent", "wrong-workspace", "closed", "error"])("keeps %s project agents unavailable even with a recent stored idle observation", async kind => {
  const f = await fixture(); f.current.status.bindings[0]!.observation!.at = new Date().toISOString();
  if (kind === "missing") f.refresh.mockResolvedValue(null);
  else if (kind === "unreachable") f.refresh.mockRejectedValue(new Error("Host unreachable"));
  else f.refresh.mockResolvedValue({ agent: { ...f.agent(kind === "closed" || kind === "error" ? kind : "idle"),
    ...(kind === "archived" ? { archivedAt: new Date().toISOString() } : {}),
    ...(kind === "wrong-agent" ? { id: "some-other-mate" } : {}),
    ...(kind === "wrong-workspace" ? { workspaceId: "some-other-workspace" } : {}),
  } } as never);
  expect(await f.row()).toMatchObject({ session: "unknown" });
});

it("bounds a stalled observation, reuses the pending read, and never treats a late answer as durable truth", async () => {
  const f = await fixture(), files = await f.f.files();
  let release!: (value: { agent: ReturnType<typeof f.agent> }) => void;
  f.refresh.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  vi.useFakeTimers();
  const first = f.row(), second = f.row();
  await vi.advanceTimersByTimeAsync(RECOVERY_OBSERVATION_TIMEOUT_MS);
  expect(await first).toMatchObject({ session: "unknown" }); expect(await second).toMatchObject({ session: "unknown" });
  expect(f.refresh).toHaveBeenCalledOnce();
  release({ agent: f.agent() }); await Promise.resolve();
  vi.useRealTimers();
  expect(await f.f.files()).toEqual(files);
  expect(f.send).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
});

it("Refresh rereads the agent even when the stored observation is recent", async () => {
  const f = await fixture(); f.current.status.bindings[0]!.observation!.at = new Date().toISOString();
  const first = await f.row(); expect(first.session).toBe("dormant");
  f.refresh.mockResolvedValue({ agent: f.agent("running") });
  const refreshed = await f.row(); expect(refreshed.session).toBe("awake");
  expect(f.refresh).toHaveBeenCalledTimes(2);
  expect(f.current.status.bindings[0]!.observation!.state).toBe("dormant");
});

it("never applies an observation to a replacement owner", async () => {
  const f = await fixture();
  let entered!: () => void, release!: (value: { agent: ReturnType<typeof f.agent> }) => void;
  const observing = new Promise<void>(resolve => { entered = resolve; });
  f.refresh.mockImplementationOnce(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  const result = f.row(); await observing;
  f.current.status = structuredClone(f.current.status);
  Object.assign(f.current.status.bindings[0]!, { epoch: 2, agentId: "replacement", observation: { state: "unknown", at: new Date().toISOString() } });
  release({ agent: f.agent() });
  expect(await result).toMatchObject({ session: "unknown", target: { epoch: 2, agentId: "replacement" } });
});

it.each(["general", "plan", "maintenance", "remote", "held", "uncreated", "suspect", "unavailable-store"])("leaves %s status behavior unchanged without a native observation", async kind => {
  const f = await fixture(), s = f.current.status;
  if (kind === "general" || kind === "plan" || kind === "maintenance") s.scopes[0]!.kind = kind;
  if (kind === "remote") s.bindings[0]!.hostId = "remote-host";
  if (kind === "held") s.scopes[0]!.state = "held";
  if (kind === "uncreated") s.bindings = [];
  if (kind === "suspect") s.bindings[0]!.state = "suspect";
  if (kind === "unavailable-store") s.freshness = "held";
  await f.read(); expect(f.refresh).not.toHaveBeenCalled();
});
