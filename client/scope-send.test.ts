import { expect, it, vi } from "vitest";
import { createDiscussionSender, discussionSender, discussionSendRegistry, discussionSendKey, type DiscussionInput } from "./scope-send";
import { scopeConversationKey } from "../shared/scope-discussion";
import type { ItemThread } from "../shared/item-threads";
const input = (): DiscussionInput => ({ id: "00000000-0000-4000-8000-000000000001", route: {
  target: { homeId: "home", scopeId: "plan", scopeVersion: 1, epoch: 1, agentId: "owner" }, recipient: "Plan", projectIds: ["p"], conversationId: "main", replyTo: null },
  text: "Explain", addressedText: "@plan Explain", defaultScope: "general" });
function thread(i: DiscussionInput, delivery: "sent" | "uncertain" = "sent"): ItemThread {
  return { key: scopeConversationKey(i.route.target.homeId, i.route.target.scopeId), title: "Plan", messages: [{ id: i.id, text: i.text, route: i.route,
    agentId: "owner", kind: "discuss", createdAt: "2026-10-26T00:00:00Z", delivery, reply: null }] };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
it("captures the target before a scope switch and prevents double send across stores/remount", async () => {
  const root = {}, gate = discussionSender(root, "plan"), request = input(), done = vi.fn();
  let release!: () => void;
  const barrier = new Promise<void>(r => { release = r; });
  const deliver = vi.fn(async (captured: DiscussionInput) => { await barrier; return { outcome: "recorded" as const, thread: thread(captured) }; });
  expect(gate.send(request, deliver, done)).toBe(true);
  request.route.target.scopeId = "another"; request.route.projectIds.push("private");
  expect(discussionSender(root, "plan").send(input(), deliver, done)).toBe(false);
  await flush(); expect(deliver.mock.calls[0]![0].route.target.scopeId).toBe("plan"); expect(deliver.mock.calls[0]![0].route.projectIds).toEqual(["p"]);
  release(); await flush(); expect(done).toHaveBeenCalledOnce(); expect(gate.snapshot().pending).toBeNull();
});
it("retains uncertain and lost-reply requests; only the original conversation can reconcile them", async () => {
  const gate = createDiscussionSender(), request = input(), done = vi.fn();
  gate.send(request, async () => { throw new Error("reply lost"); }, done); await flush();
  expect(gate.snapshot()).toMatchObject({ running: false, pending: request, error: "reply lost" });
  expect(gate.send(input(), vi.fn(), done)).toBe(false);
  const wrong = thread(request); wrong.key = scopeConversationKey("home", "another"); gate.reconcile(wrong); expect(gate.snapshot().pending).not.toBeNull();
  gate.reconcile(thread(request, "uncertain")); expect(gate.snapshot().pending).not.toBeNull();
  gate.reconcile(thread(request)); expect(gate.snapshot().pending).toBeNull(); expect(done).not.toHaveBeenCalled();
});
it("returns a definite refusal to its captured draft without creating another request", async () => {
  const gate = createDiscussionSender(), restore = vi.fn(), request = input();
  gate.send(request, async () => ({ outcome: "refused", code: "STALE", message: "Owner changed" }), vi.fn(), restore); await flush();
  expect(restore).toHaveBeenCalledWith(request); expect(gate.snapshot()).toEqual({ running: false, pending: null, error: "Owner changed" });
});
it("does not mistake send acceptance, a missing matching row or a cross-conversation response for a reply", async () => {
  for (const result of [{ outcome: "recorded" as const, thread: thread(input(), "uncertain") }, { outcome: "recorded" as const, thread: { ...thread(input()), messages: [] } }, { outcome: "uncertain" as const, message: "Storage unavailable" }]) {
    const gate = createDiscussionSender(); gate.send(input(), async () => result, vi.fn()); await flush(); expect(gate.snapshot().pending?.id).toBe(input().id);
  }
});
it("keeps a targeted unknown send visible in the shared stream after @text is cleared and on remount", async () => {
  const root = {}, gate = discussionSender(root, discussionSendKey("host", "home", "plan")), registry = discussionSendRegistry(root), listener = vi.fn();
  const stop = registry.subscribe(listener);
  gate.send(input(), async () => { throw new Error("Transport reply missing"); }, vi.fn()); await flush();
  expect(discussionSendRegistry(root).pending("host", "home")[0]?.pending?.route.target.scopeId).toBe("plan");
  expect(registry.pending("other-host", "home")).toEqual([]); expect(listener).toHaveBeenCalled(); stop();
  expect(discussionSender(root, discussionSendKey("host", "home", "plan"))).toBe(gate);
});
