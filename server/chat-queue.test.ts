import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ChatQueue, ChatQueueRefusal } from "./chat-queue";
import { queueTarget, type ChatQueuePayload } from "../shared/chat-queue";
const payload = (text: string): ChatQueuePayload => ({ kind: "mate", agentId: "mate", message: { text } });
async function fixture() {
  const path = join(process.env.PASEO_HOME!, "chat-queue-tests", randomUUID(), "queue.json");
  const options = { enabled: vi.fn(async () => true), activity: vi.fn(async () => "busy" as "ready" | "busy"), deliver: vi.fn(async (_payload: ChatQueuePayload, _id: string, _allowBusy: boolean) => {}) };
  const queue = new ChatQueue(path, options);
  return { queue, options, path, target: queueTarget(payload("")), add: (text: string) => queue.submit(randomUUID(), payload(text)) };
}
it("releases three queued messages on three distinct completed turns, including reload and duplicate callbacks", async () => {
  const f = await fixture();
  const items = await Promise.all([f.add("one"), f.add("two"), f.add("three")]);
  expect(f.options.deliver).not.toHaveBeenCalled();
  const queue = new ChatQueue(f.path, f.options);
  expect((await queue.snapshot(f.target)).items.map(i => i.id)).toEqual(items.map(i => i.id));
  await Promise.all([queue.ended("mate", "initial", true), queue.ended("mate", "initial", true)]);
  expect(f.options.deliver.mock.calls.map(c => c[1])).toEqual([items[0]!.id]);
  await queue.started("mate", "one");
  await new ChatQueue(f.path, f.options).ended("mate", "one", true);
  await queue.ended("mate", "initial", true);
  expect(f.options.deliver.mock.calls.map(c => c[1])).toEqual(items.slice(0, 2).map(i => i.id));
  await queue.started("mate", "two");
  await queue.ended("mate", "two", true);
  await queue.ended("mate", "two", true);
  expect(f.options.deliver.mock.calls.map(c => c[1])).toEqual(items.map(i => i.id));
});
it("edits are recoverable after reload, resending appends to the end, and Remove persists", async () => {
  const f = await fixture(), first = await f.add("original"), second = await f.add("second");
  expect((await f.queue.change(f.target, first.id, "edit")).payload).toEqual(payload("original"));
  const queue = new ChatQueue(f.path, f.options);
  expect((await queue.snapshot(f.target)).items[0]!.state).toBe("editing");
  const edited = await queue.submit(randomUUID(), payload("edited"), false, first.id);
  await queue.change(f.target, second.id, "remove");
  expect((await queue.snapshot(f.target)).items.filter(i => i.state === "queued").map(i => i.id)).toEqual([edited.id]);
  await queue.ended("mate", "initial", true);
  expect(f.options.deliver.mock.calls[0]![0]).toEqual(payload("edited"));
});
it("concurrent and repeated admissions of one ID send at most once, even after reload", async () => {
  const f = await fixture(), id = randomUUID(); f.options.activity.mockResolvedValue("ready");
  await Promise.all([f.queue.submit(id, payload("once")), new ChatQueue(f.path, f.options).submit(id, payload("once"))]);
  await new ChatQueue(f.path, f.options).submit(id, payload("once"));
  expect(f.options.deliver).toHaveBeenCalledTimes(1);
  await expect(f.queue.submit(id, payload("different"))).rejects.toThrow("another message");
});
it("an unknown delivery remains held and is never retried by admission, reload or duplicate release", async () => {
  const f = await fixture(), id = randomUUID();
  f.options.deliver.mockRejectedValue(new Error("Lost response"));
  await f.queue.submit(id, payload("uncertain"));
  await f.queue.ended("mate", "initial", true);
  const queue = new ChatQueue(f.path, f.options);
  await queue.submit(id, payload("uncertain"));
  await queue.ended("mate", "initial", true);
  expect((await queue.snapshot(f.target)).items[0]!.state).toBe("held");
  expect(f.options.deliver).toHaveBeenCalledTimes(1);
});
it("off restores immediate sends while busy; Send now bypasses the queue explicitly", async () => {
  const f = await fixture(); f.options.enabled.mockResolvedValue(false);
  await f.add("immediate");
  expect(f.options.deliver.mock.calls[0]![2]).toBe(true);
  f.options.enabled.mockResolvedValue(true);
  const waiting = await f.add("waiting");
  await f.queue.change(f.target, waiting.id, "now");
  expect(f.options.deliver.mock.calls[1]![2]).toBe(true);
});
it("rapid idle submissions wait for the first message's completed turn", async () => {
  const f = await fixture(); f.options.activity.mockResolvedValue("ready");
  await f.add("one"); await f.add("two"); await f.add("three");
  expect(f.options.deliver).toHaveBeenCalledTimes(1);
  await f.queue.ended("mate", "unrelated", true);
  await f.queue.ended("mate", null, true);
  expect(f.options.deliver).toHaveBeenCalledTimes(1);
  await f.queue.started("mate", "one"); await f.queue.ended("mate", "one", false);
  expect(f.options.deliver).toHaveBeenCalledTimes(1);
});
it("changed scope owners retain the captured target and remain visible without rerouting", async () => {
  const f = await fixture();
  const scope: ChatQueuePayload = { kind: "scope", input: { id: randomUUID(), text: "question", addressedText: "question", defaultScope: "project",
    route: { target: { homeId: "home", scopeId: "project", scopeVersion: 1, epoch: 1, agentId: "owner" }, recipient: "Reader", projectIds: [], conversationId: "main", replyTo: null } } };
  await f.queue.submit(randomUUID(), scope);
  const changed = { kind: "scope" as const, target: { ...scope.input.route.target, agentId: "replacement", epoch: 2 } };
  expect((await f.queue.snapshot(changed)).items[0]!.target).toEqual(queueTarget(scope));
  f.options.deliver.mockRejectedValue(new Error("Captured owner changed"));
  await f.queue.ended("owner", "initial", true);
  expect((await f.queue.snapshot(changed)).items[0]!.state).toBe("held");
  expect(f.options.deliver.mock.calls[0]![0]).toEqual(scope);
});
it("storage damage refuses mutation and never resets saved claims", async () => {
  const f = await fixture(); await f.add("keep");
  const original = await readFile(f.path, "utf8"); await writeFile(f.path, original.slice(0, -3));
  await expect(f.add("new")).rejects.toThrow();
  expect(f.options.deliver).not.toHaveBeenCalled();
  expect(await readFile(f.path, "utf8")).toBe(original.slice(0, -3));
});
it("a proven pre-reservation refusal keeps an editable message without retrying its old ID", async () => {
  const f = await fixture(), id = randomUUID(); f.options.activity.mockResolvedValue("ready");
  f.options.deliver.mockRejectedValueOnce(new ChatQueueRefusal("Policy changed"));
  expect((await f.queue.submit(id, payload("question"))).state).toBe("refused");
  await f.queue.submit(id, payload("question")); expect(f.options.deliver).toHaveBeenCalledTimes(1);
  await f.queue.change(f.target, id, "edit");
  expect((await f.queue.submit(randomUUID(), payload("revised"), false, id)).state).toBe("sent");
});
it("queue previews omit attachment bytes while Edit restores them", async () => {
  const f = await fixture(), withImage: ChatQueuePayload = { kind: "mate", agentId: "mate", message: { text: "Picture", images: [{ mimeType: "image/png", data: "aGVsbG8=" }] } };
  const row = await f.queue.submit(randomUUID(), withImage);
  const preview = (await f.queue.snapshot(f.target)).items[0]!;
  expect(preview).toMatchObject({ text: "Picture", attachmentCount: 1 });
  expect(JSON.stringify(preview)).not.toContain("aGVsbG8=");
  expect((await f.queue.change(f.target, row.id, "edit")).payload).toEqual(withImage);
});
