import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { CaptainSteers, exitCrew, interruptCrew, registerSteerRelay, relaunchCrew, steerCrew } from "./crew";
import { workerLabels } from "./supervision-effects";
import { stopAgent } from "./cli";
import { askMate, queueBurstNote } from "./mate";
import type { PaseoApi } from "./host-types";

vi.mock("./cli", () => ({ stopAgent: vi.fn() }));
vi.mock("./mate", () => ({ askMate: vi.fn(), queueBurstNote: vi.fn(), extendBurstNote: vi.fn() }));

function fixture() {
  const agent = { id: "scoped-builder", title: "Builder", status: "idle", archivedAt: null, pendingPermissions: [],
    labels: workerLabels(randomUUID(), { nodeId: "build" } as never, randomUUID(), { kind: "ship", project: "pilot" } as never) };
  const send = vi.fn(), archive = vi.fn();
  const paseo = { agents: { ref: () => ({ refresh: async () => ({ agent }), send, archive }) } } as unknown as PaseoApi;
  return { agent, paseo, send, archive, steers: new CaptainSteers() };
}
it.each(["steer", "interrupt", "end", "relaunch"] as const)("legacy %s refuses gateway-labelled scoped workers before any effect", async action => {
  vi.clearAllMocks();
  const f = fixture();
  const call = () => action === "steer" ? steerCrew(f.paseo, f.steers, f.agent.id, "change") : action === "interrupt" ? interruptCrew(f.paseo, f.agent.id) :
    action === "end" ? exitCrew(f.paseo, f.agent.id) : relaunchCrew(f.paseo, f.agent.id, "again");
  await expect(call()).rejects.toThrow("belongs to a scoped supervisor");
  expect(f.send).not.toHaveBeenCalled(); expect(f.archive).not.toHaveBeenCalled();
  expect(stopAgent).not.toHaveBeenCalled(); expect(askMate).not.toHaveBeenCalled();
  expect(f.steers.take(f.agent.id, ["change"])).toBeNull();
});
it("the relay refreshes ownership and refuses a pending legacy steer after the worker becomes scoped", async () => {
  vi.clearAllMocks(); const f = fixture();
  // Simulate an exchange recorded before ownership changed, or retained by an old caller.
  f.steers.record(f.agent.id, "old steer");
  let handler: (event: unknown, context: unknown) => Promise<void>;
  registerSteerRelay({ on: (_name: unknown, h: typeof handler) => { handler = h; return () => {}; } } as never, f.steers);
  await expect(handler!({ agent: { id: f.agent.id, title: f.agent.title }, outcome: { kind: "completed" }, turnId: "t",
    timeline: [{ type: "user_message", text: "old steer" }, { type: "assistant_message", text: "private scoped answer" }] }, { paseo: f.paseo }))
    .rejects.toThrow("legacy board controls and the steer relay");
  expect(queueBurstNote).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  expect(f.steers.take(f.agent.id, ["old steer"])).toBeNull();
});
it("with the S08 scoped adapter, a scoped steer goes only to that adapter: no relay entry, burst note or General send", async () => {
  vi.clearAllMocks(); const f = fixture(), scoped = { steer: vi.fn(async () => ({})) };
  const paseo = { agents: { ref: () => ({ refresh: async () => ({ agent: f.agent }), send: f.send, archive: f.archive }), list: async () => [f.agent] } } as unknown as PaseoApi;
  await steerCrew(paseo, f.steers, f.agent.id, "change", scoped);
  expect(scoped.steer).toHaveBeenCalledWith(paseo, f.agent.id, "change");
  expect(f.send).not.toHaveBeenCalled(); expect(askMate).not.toHaveBeenCalled(); expect(queueBurstNote).not.toHaveBeenCalled();
  expect(f.steers.take(f.agent.id, ["change"])).toBeNull();
});
