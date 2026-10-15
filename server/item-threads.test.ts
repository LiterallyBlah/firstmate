import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { itemTagKey } from "../shared/item-tags";
import { threadKey, sendItemThread } from "../shared/item-threads";
import { converseKey, converseTarget } from "../client/converse-layout";
import { buildCards } from "./fleet";
import { parseBacklog } from "./backlog";
import { readThread, sendThread, threadPath, threadReplyPath } from "./item-threads";

const card = (id = "idea", section = "Queued", project = "web") => buildCards(
  parseBacklog(`## ${section}\n- [ ] ${id} - Explore the idea (project: ${project})`), [],
)[0]!;
async function fixture() { return mkdtemp(join(process.env.PASEO_HOME!, "thread-")); }
const input = (id: string, item = card(), kind: "discuss" | "graduate" = "discuss") => ({ key: itemTagKey(item), id, kind, text: kind === "discuss" ? "What are the options?" : "" });
const delivered = vi.fn(async (_text: string, _id: string, before: (agent: string) => Promise<void>) => { await before("mate-1"); });

describe("light item discussions", () => {
  it("opens without files or sends, and stays scoped across column/title/worker changes", async () => {
    const home = await fixture();
    const item = card();
    expect(await readThread(home, itemTagKey(item))).toMatchObject({ messages: [] });
    expect(await readdir(home)).toEqual([]);
    expect(converseTarget(converseKey(item))).toEqual({ kind: "thread", itemKey: itemTagKey(item) });
    expect(threadKey({ ...card("idea", "In flight"), title: "Renamed" })).toBe(threadKey(item));
    expect(threadKey(card("idea", "Queued", "other"))).not.toBe(threadKey(item));
    const remote = { ...item, remote: { host: "Elsewhere", serverId: "host-2", online: true, clockSkewSeconds: null, worker: null } };
    expect(threadKey(remote)).not.toBe(threadKey(item));
  });

  it("persists captain messages and reads only each message's confined reply file", async () => {
    const home = await fixture();
    const item = card();
    const sent = await sendThread(home, item, input("one"), delivered);
    expect(sent.messages[0]).toMatchObject({ agentId: "mate-1", delivery: "sent", reply: null });
    const prompt = delivered.mock.lastCall![0];
    expect(prompt).toContain("not a work order");
    expect(prompt).toContain(threadReplyPath(itemTagKey(item), "one"));
    expect(delivered.mock.lastCall![1]).toBe("firstmate-thread-one");
    await writeFile(join(home, threadReplyPath(itemTagKey(item), "one")), "Two options, both worth discussing.");
    expect((await readThread(home, itemTagKey(item))).messages[0]!.reply).toBe("Two options, both worth discussing.");
    expect((await readThread(home, itemTagKey(card("different")))).messages).toEqual([]);
    // File persistence works without any module-memory session.
    expect(JSON.parse(await readFile(join(home, threadPath(itemTagKey(item))), "utf8")).messages[0].text).toBe("What are the options?");
  });

  it("reserves before sending, serializes clients, and never repeats an uncertain delivery", async () => {
    const home = await fixture();
    const item = card();
    const deliver = vi.fn(async (_text: string, _id: string, before: (agent: string) => Promise<void>) => {
      await before("mate-1");
      expect((await readThread(home, itemTagKey(item))).messages[0]!.delivery).toBe("uncertain");
      throw new Error("connection lost after delivery");
    });
    const [first, second] = await Promise.all([
      sendThread(home, item, input("same"), deliver), sendThread(home, item, input("same"), deliver),
    ]);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.messages[0]!.delivery).toBe("uncertain");
    await expect(sendThread(home, item, { ...input("same"), text: "different" }, deliver)).rejects.toThrow("already used");
  });

  it("does not reserve when first-mate lifecycle checks refuse sending", async () => {
    const home = await fixture();
    await expect(sendThread(home, card(), input("one"), async () => { throw new Error("no first mate"); })).rejects.toThrow("no first mate");
    expect((await readThread(home, itemTagKey(card()))).messages).toEqual([]);
  });

  it("graduates explicitly once, preserves the discussion and allows scope answers after graduation", async () => {
    const home = await fixture();
    const item = card();
    await expect(sendThread(home, item, input("work", item, "graduate"), delivered)).rejects.toThrow("Discuss");
    await sendThread(home, item, input("one"), delivered);
    const result = await sendThread(home, item, input("work", item, "graduate"), delivered);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({ kind: "graduate", delivery: "sent" });
    expect(delivered.mock.lastCall![0]).toContain("explicit request to graduate");
    expect(delivered.mock.lastCall![0]).toContain("Preserve the item's task id, project and host");
    await expect(sendThread(home, item, input("work-again", item, "graduate"), delivered)).rejects.toThrow("already been requested");
    await sendThread(home, item, input("answer"), delivered);
    expect(delivered.mock.lastCall![0]).toContain("proceed within that request's scope");
  });

  it("refuses graduation if a worker appeared, while preserving phase-1 routing", async () => {
    const home = await fixture();
    const item = card();
    await sendThread(home, item, input("one"), delivered);
    const worker = { ...item, agent: { id: "worker-1" } as NonNullable<typeof item.agent> };
    expect(converseKey(worker)).toBe("worker-1");
    expect(converseTarget(converseKey(worker))).toEqual({ kind: "local", agentId: "worker-1" });
    expect(threadKey(worker)).toBe(threadKey(item));
    await expect(sendThread(home, worker, input("work", item, "graduate"), delivered)).rejects.toThrow("already has a worker");
    expect((await readThread(home, itemTagKey(worker))).messages).toHaveLength(1);
  });

  it("rejects invalid ids, blank discussion, oversized text, identity mismatch and corrupt history", async () => {
    expect(sendItemThread.input.safeParse({ ...input("one"), id: "../../escape" }).success).toBe(false);
    expect(sendItemThread.input.safeParse({ ...input("one"), text: "  " }).success).toBe(false);
    expect(sendItemThread.input.safeParse({ ...input("one"), text: "a".repeat(16001) }).success).toBe(false);
    const home = await fixture();
    await expect(sendThread(home, card("other"), input("one"), delivered)).rejects.toThrow("changed");
    const path = join(home, threadPath(itemTagKey(card())));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "broken JSON");
    await expect(sendThread(home, card(), input("one"), delivered)).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("broken JSON");
  });
});
