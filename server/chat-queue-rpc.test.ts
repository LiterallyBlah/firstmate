import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PaseoApi } from "./host-types";
import type { ScopeRuntime } from "./scope-runtime";
import { displaySettings } from "../shared/settings";
import { queueTarget, type ChatQueuePayload } from "../shared/chat-queue";
import { registerChatQueue } from "./chat-queue-rpc";
import { workflowHomeIdentity } from "./workflow-ownership";
import { SupervisionUiReceiver } from "./supervision-ui-receiver";
import { dataPath } from "./data-dir";
const host = vi.hoisted(() => ({ home: "", mate: "mate", ask: vi.fn() }));
vi.mock("./config", () => ({ readFirstmateConfig: async () => ({ home: host.home, mateAgentId: host.mate }), resolveHome: (config: { home: string }) => config.home }));
vi.mock("./mate", () => ({ askMate: (...args: unknown[]) => host.ask(...args) }));
async function fixture() {
  host.home = `test-home-${randomUUID()}`; host.mate = "mate"; host.ask.mockReset();
  const handlers = new Map<string, Function>(), hooks = new Map<string, Function>();
  const agent = { id: "mate", status: "running", activeTurn: null as { turnId: string } | null, archivedAt: null, pendingPermissions: [] as unknown[] };
  const refresh = vi.fn(async () => ({ agent }));
  const paseo = { agents: { ref: () => ({ refresh }) } } as unknown as PaseoApi;
  host.ask.mockImplementation(async (_paseo, _message, before) => { await before(host.mate); return host.mate; });
  const execute = vi.fn(async (_home, _scope, _paseo, run) => run({ discussions: { result: async (input: { id: string }) => ({ outcome: "recorded", thread: { messages: [{ id: input.id, delivery: "sent" }] } }) } }));
  let enabled = true;
  const stop = registerChatQueue({ handle: (contract: { name: string }, run: Function) => handlers.set(contract.name, run), on: (name: string, run: Function) => { hooks.set(name, run); return () => hooks.delete(name); } } as unknown as PluginServerContext,
    { execute } as unknown as ScopeRuntime, { read: async () => ({ status: "ready", revision: "1", values: displaySettings.schema.parse({ queueMessagesWhileBusy: enabled }) }), subscribe: () => () => {} });
  const call = (name: string, input: unknown) => handlers.get(`firstmate.chat.${name}`)!(input, { paseo });
  return { call, agent, refresh, execute, stop, path: dataPath(`chat-queues/${createHash("sha256").update(host.home).digest("hex")}.json`), off: () => { enabled = false; }, end: (turnId: string) => hooks.get("agent.turn_ended")!({ agent: { id: "mate" }, turnId, outcome: { kind: "completed" } }, { paseo }) };
}
afterEach(() => vi.restoreAllMocks());
it("main queue uses the checked mate sender and preserves its message ID; off sends while busy", async () => {
  const f = await fixture(), payload: ChatQueuePayload = { kind: "mate", agentId: "mate", message: { text: "one" } }, id = randomUUID();
  await f.call("submit", { id, payload }); expect(host.ask).not.toHaveBeenCalled();
  f.agent.status = "idle"; await f.end("initial");
  expect(host.ask).toHaveBeenCalledTimes(1);
  expect(host.ask.mock.calls[0]![1]).toMatchObject({ text: "one", messageId: `firstmate-captain-${id}` });
  f.off(); f.agent.status = "running";
  await f.call("submit", { id: randomUUID(), payload: { ...payload, message: { text: "now" } } });
  expect(host.ask).toHaveBeenCalledTimes(2); await f.stop();
});
it("scoped sends preserve their exact route and use only the existing discussion outbox", async () => {
  const f = await fixture(); f.agent.status = "idle";
  const payload: ChatQueuePayload = { kind: "scope", input: { id: randomUUID(), text: "Scope words", addressedText: "Scope words", defaultScope: "project",
    route: { target: { homeId: workflowHomeIdentity(host.home), scopeId: "project", scopeVersion: 2, epoch: 1, agentId: "mate" }, recipient: "Reader mate", projectIds: [], conversationId: "main", replyTo: null } } };
  const receipt = await f.call("submit", { id: randomUUID(), payload });
  expect(receipt.state).toBe("sent"); expect(f.execute.mock.calls[0]!.slice(0, 2)).toEqual([payload.input.route.target.homeId, "project"]);
  expect(host.ask).not.toHaveBeenCalled(); await f.stop();
});
it("changing the main owner holds an already queued message instead of rerouting; replay is read-only", async () => {
  const f = await fixture(), payload: ChatQueuePayload = { kind: "mate", agentId: "mate", message: { text: "keep original" } }, id = randomUUID();
  await f.call("submit", { id, payload }); host.mate = "replacement"; f.agent.status = "idle";
  await f.end("initial");
  const snapshot = await f.call("queue", { target: queueTarget(payload) });
  expect(snapshot.items[0].state).toBe("held"); expect(host.ask).not.toHaveBeenCalled();
  expect((await f.call("submit", { id, payload })).state).toBe("held"); expect(host.ask).not.toHaveBeenCalled(); await f.stop();
});
it("idle status with an active turn or permission request cannot release the next message", async () => {
  const f = await fixture(), payload: ChatQueuePayload = { kind: "mate", agentId: "mate", message: { text: "waiting" } };
  try {
    await f.call("submit", { id: randomUUID(), payload });
    f.agent.status = "idle"; f.agent.activeTurn = { turnId: "reserved" };
    await f.end("old"); expect(host.ask).not.toHaveBeenCalled();
    f.agent.activeTurn = null; f.agent.pendingPermissions = [{}];
    await f.end("reserved"); expect(host.ask).not.toHaveBeenCalled();
    f.agent.pendingPermissions = [];
    await f.end("permission-finished"); expect(host.ask).toHaveBeenCalledTimes(1);
  } finally { await f.stop(); }
});
it("the polling sweep releases one per actual idle turn even when every hook is missing", async () => {
  let poll!: () => Promise<void> | undefined;
  vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: typeof poll) => { poll = callback; return { unref() {} }; }) as typeof setInterval);
  vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
  const f = await fixture(), payload: ChatQueuePayload = { kind: "mate", agentId: "mate", message: { text: "waiting" } };
  try {
    for (let i = 0; i < 3; i++) await f.call("submit", { id: randomUUID(), payload });
    let accepted!: () => void;
    host.ask.mockImplementation(async (_paseo, _message, before) => { await before(host.mate); f.agent.activeTurn = { turnId: randomUUID() }; accepted(); });
    f.agent.status = "idle";
    for (let count = 1; count <= 3; count++) {
      const acceptance = new Promise<void>(resolve => { accepted = resolve; });
      f.agent.activeTurn = null;
      let observe!: () => void, unblock!: () => void;
      const observed = new Promise<void>(resolve => { observe = resolve; });
      const blocked = new Promise<void>(resolve => { unblock = resolve; });
      f.refresh.mockImplementationOnce(async () => { observe(); await blocked; return { agent: f.agent }; });
      // Await disk admission and native acceptance, not a one-second I/O deadline.
      const polls = Promise.all([poll(), poll()]);
      await observed; expect(host.ask).toHaveBeenCalledTimes(count - 1);
      unblock(); await polls; await acceptance;
      // Drain a further poll while status says idle but a native turn is reserved.
      await poll();
      const rows = (await f.call("queue", { target: queueTarget(payload) })).items;
      expect(rows.filter((row: { state: string }) => row.state === "queued")).toHaveLength(3 - count);
      expect(rows.some((row: { state: string }) => row.state === "claimed")).toBe(false);
      expect(host.ask).toHaveBeenCalledTimes(count);
    }
  } finally { await f.stop(); }
});
it("registration recovers an abandoned claim before any RPC provides an API", async () => {
  const f = await fixture(), payload: ChatQueuePayload = { kind: "mate", agentId: "mate", message: { text: "crashed" } }, id = randomUUID();
  await f.call("submit", { id, payload }); await f.stop();
  const saved = JSON.parse(await readFile(f.path, "utf8")); saved.items[0].state = "claimed";
  saved.claims = { [id]: { owner: "previous-process", at: Date.now() } };
  await writeFile(f.path, JSON.stringify(saved));
  const stop = registerChatQueue({ handle() {}, on: () => () => {} } as unknown as PluginServerContext, {} as ScopeRuntime, {} as Parameters<typeof registerChatQueue>[2]);
  await stop(); // Awaits registration's startup recovery; no RPC supplied an API.
  expect(JSON.parse(await readFile(f.path, "utf8")).items[0].state).toBe("held");
  expect(host.ask).not.toHaveBeenCalled();
});
it("the scoped receiver rechecks queue availability immediately before the native effect", async () => {
  const send = vi.fn();
  const receiver = new SupervisionUiReceiver({ agents: { ref: () => ({ send }) } } as unknown as PaseoApi, "unused", { beforeSend: async () => { throw new Error("Mate became busy"); } });
  await expect(receiver.send("original-owner", "words", "message-id")).rejects.toThrow("Mate became busy");
  expect(send).not.toHaveBeenCalled();
});
