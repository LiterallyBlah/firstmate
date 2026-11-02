import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ChatQueue } from "../../server/chat-queue";
import type { ChatQueuePayload } from "../../shared/chat-queue";
const payload = (agentId: string, text: string): ChatQueuePayload => ({ kind: "mate", agentId, message: { text } });

it("A9: a stalled receiver status read during admission cannot hold General's independent queue admission", async () => {
  let release!: () => void, entered!: () => void;
  const stalled = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { entered = r; }), sent: string[] = [];
  const q = new ChatQueue(join(process.env.PASEO_HOME!, randomUUID(), "queue.json"), { enabled: async () => true,
    activity: async target => { if (target.kind === "mate" && target.agentId === "stalled-owner") { entered(); await stalled; } return "ready"; },
    deliver: async p => { if (p.kind === "mate") sent.push(p.agentId); } });
  const pending = q.submit(randomUUID(), payload("stalled-owner", "Owner input")); await ready;
  const captain = q.submit(randomUUID(), payload("general", "Captain input"));
  try {
    await vi.waitFor(() => expect([...sent]).toContain("general"), { timeout: 10000 });
    expect(sent).not.toContain("stalled-owner");
  } finally { release(); await Promise.all([pending, captain]); }
}, 30000);

it("A9: one pending background readiness read does not block other agents or repeat reads, claims or completed-turn releases", async () => {
  let release!: () => void, entered!: () => void, checking = false;
  const stalled = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { entered = r; });
  const sent: string[] = []; let slowReads = 0;
  const q = new ChatQueue(join(process.env.PASEO_HOME!, randomUUID(), "queue.json"), { enabled: async () => true,
    activity: async target => {
      if (!checking) return "busy";
      if (target.kind === "mate" && target.agentId === "stalled-owner") { slowReads++; entered(); await stalled; }
      return "ready";
    }, deliver: async (_p, id) => { sent.push(id); } });
  const owner = randomUUID(), first = randomUUID(), second = randomUUID();
  await q.submit(owner, payload("stalled-owner", "Retain this input"));
  await q.submit(first, payload("general", "First captain input"));
  await q.submit(second, payload("general", "Second captain input")); checking = true;
  const sweep = q.reconcile(undefined, false); await ready;
  try {
    await vi.waitFor(() => expect([...sent]).toEqual([first]), { timeout: 10000 });
    await sweep;
    await vi.waitFor(async () => expect((await q.snapshot({ kind: "mate", agentId: "general" })).items.map(i => i.id)).toEqual([second]));
    await q.ended("general", "one-completed-turn", true);
    expect(sent).toEqual([first, second]);
    await q.reconcile(undefined, false); expect(slowReads).toBe(1);
    await q.change({ kind: "mate", agentId: "stalled-owner" }, owner, "remove");
  } finally {
    release(); await sweep;
    // Drain definite transport settlements before isolated-home cleanup, including a failing red run.
    await vi.waitFor(async () => {
      const rows = [...(await q.snapshot({ kind: "mate", agentId: "general" })).items,
        ...(await q.snapshot({ kind: "mate", agentId: "stalled-owner" })).items];
      expect(rows.some(i => i.state === "claimed")).toBe(false);
    });
  }
  await vi.waitFor(async () => expect((await q.snapshot({ kind: "mate", agentId: "stalled-owner" })).items).toEqual([]));
  expect(sent).toEqual([first, second]);
}, 30000);
