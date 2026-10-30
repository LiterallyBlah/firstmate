import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ChatQueue } from "./chat-queue";
import { queueTarget, type ChatQueuePayload } from "../shared/chat-queue";
const payload = (text: string): ChatQueuePayload => ({ kind: "mate", agentId: "mate", message: { text } });
function fixture() {
  const path = join(process.env.PASEO_HOME!, "chat-queue-probe", randomUUID(), "queue.json");
  const options = { enabled: vi.fn(async () => true), activity: vi.fn(async () => "busy" as "ready" | "busy"), deliver: vi.fn(async (_p: ChatQueuePayload, _id: string, _a: boolean) => {}) };
  return { queue: new ChatQueue(path, options), options, path, target: queueTarget(payload("")) };
}

// The review's probes, with real idle/busy observations supplied independently
// of lifecycle hooks. deliver() deliberately never calls started().
// Agent is mid-turn T0 which started BEFORE any queue item existed, so no
// turn_started was ever recorded for it.
// Captain queues a message, then presses Send now: steer joins T0, no new
// turn_started fires. Captain queues another. T0 completes.
it("PROBE A: Send-now steered into an untracked running turn, then queued follow-up releases when that turn ends", async () => {
  const f = fixture();
  const first = await f.queue.submit(randomUUID(), payload("urgent"));
  expect(f.options.deliver).not.toHaveBeenCalled();
  await f.queue.change(f.target, first.id, "now"); // steer joins T0; deliver() fires no started()
  expect(f.options.deliver).toHaveBeenCalledTimes(1);
  f.options.activity.mockResolvedValue("busy");
  await f.queue.submit(randomUUID(), payload("follow-up"));
  f.options.activity.mockResolvedValue("ready"); // the native agent is now idle
  await f.queue.ended("mate", "T0", true); // the steered turn completes
  expect(f.options.deliver).toHaveBeenCalledTimes(2); // follow-up should release now
});

// Fast turn: claim on idle, queue second, ended is processed before started.
it("PROBE B: ended processed before started for the claimed item's own turn still releases the next message", async () => {
  const f = fixture();
  f.options.activity.mockResolvedValue("ready");
  f.options.deliver.mockImplementation(async () => { f.options.activity.mockResolvedValue("busy"); });
  await f.queue.submit(randomUUID(), payload("one")); // claimed+sent; its turn T1 starts
  await f.queue.submit(randomUUID(), payload("two")); // native turn is now busy
  expect(f.options.deliver).toHaveBeenCalledTimes(1);
  f.options.activity.mockResolvedValue("ready");
  await f.queue.ended("mate", "T1", true); // ended hook transaction wins the race
  await f.queue.started("mate", "T1"); // started hook arrives late
  expect(f.options.deliver).toHaveBeenCalledTimes(2);
});

// Crash/reload between claim persistence and delivery settlement must turn
// the abandoned claim into a removable hold, without dispatching it again.
it("PROBE C: a claimed row left by a crash mid-delivery can be removed after reload", async () => {
  const f = fixture();
  f.options.activity.mockResolvedValue("ready");
  let release!: () => void;
  f.options.deliver.mockImplementation(() => new Promise<void>(r => { release = r; }));
  const pending = f.queue.submit(randomUUID(), payload("in flight"));
  await vi.waitFor(() => expect(f.options.deliver).toHaveBeenCalled()); // claim is durable, delivery in flight
  const stored = JSON.parse(await readFile(f.path, "utf8"));
  expect(stored.items[0].state).toBe("claimed");
  // Simulate daemon restart: brand-new instance over the same file, delivery outcome unknown.
  const after = new ChatQueue(f.path, f.options);
  const snap = await after.snapshot(f.target);
  expect(snap.items[0]!.state).toBe("held");
  await expect(after.change(f.target, snap.items[0]!.id, "remove")).resolves.toBeTruthy();
  release(); await pending.catch(() => undefined);
  expect((await after.snapshot(f.target)).items).toEqual([]);
  expect(f.options.deliver).toHaveBeenCalledTimes(1);
});

// Removing an uncertain delivery must not leave a barrier behind it.
it("PROBE E: removing a held message lets the next idle send go immediately", async () => {
  const f = fixture();
  f.options.activity.mockResolvedValue("ready");
  f.options.deliver.mockRejectedValueOnce(new Error("Lost response"));
  const held = await f.queue.submit(randomUUID(), payload("uncertain"));
  expect(held.state).toBe("held");
  await f.queue.change(f.target, held.id, "remove");
  f.options.deliver.mockResolvedValue(undefined);
  const next = await f.queue.submit(randomUUID(), payload("fresh"));
  expect(next.state).toBe("sent");
  expect(f.options.deliver).toHaveBeenCalledTimes(2);
});

// Turning the setting OFF: only NEW sends should be immediate. Check a
// previously queued message is not stranded when later immediate sends
// complete their turns.
it("PROBE D: queued message still releases after an immediate (setting-off) send's turn completes", async () => {
  const f = fixture();
  await f.queue.submit(randomUUID(), payload("queued")); // busy, queued
  f.options.enabled.mockResolvedValue(false);
  await f.queue.submit(randomUUID(), payload("immediate")); // claimed now, jumps ahead (explicit)
  f.options.activity.mockResolvedValue("ready");
  await f.queue.ended("mate", "T-imm", true);
  expect(f.options.deliver.mock.calls.map(c => (c[0] as Extract<ChatQueuePayload, { kind: "mate" }>).message.text)).toEqual(["immediate", "queued"]);
});
