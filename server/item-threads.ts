/** A thread is a small home record plus one first-mate reply file per message. No agent or worktree creation. */
import { createHash } from "node:crypto";
import type { z } from "zod";
import type { FleetCard } from "../shared/fleet";
import { MAX_EDITABLE_BYTES } from "../shared/files";
import { itemTagKey } from "../shared/item-tags";
import { ItemThreadSchema, type ItemThread, type ThreadMessage, type sendItemThread } from "../shared/item-threads";
import { readTextFile, replaceTextIfUnchanged, writeTextFile } from "./files";
import { serialized } from "./serialize";
import { cutoverGate } from "./supervision-gate";
import { message, TEMPLATES } from "./templates";
import { digest } from "./submissions";

export function threadPath(key: string): string {
  return `data/item-threads/${createHash("sha256").update(key).digest("hex")}/thread.json`;
}
export function threadReplyPath(key: string, id: string): string {
  return threadPath(key).replace("thread.json", `${id}.reply.md`);
}
async function optionalText(home: string, path: string): Promise<string | null> {
  try {
    const file = await readTextFile(home, path);
    if (file.content === null) throw new Error(`Cannot read ${path}: use a text file within the editor's size limit.`);
    return file.content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function load(home: string, key: string) {
  const text = await optionalText(home, threadPath(key));
  const thread = text === null ? { key, title: "Item discussion", messages: [] } : ItemThreadSchema.parse(JSON.parse(text));
  if (thread.key !== key) throw new Error("This discussion belongs to a different item.");
  return { text, thread };
}
async function replies(home: string, thread: ItemThread): Promise<ItemThread> {
  return { ...thread, messages: await Promise.all(thread.messages.map(async (entry) => ({
    ...entry, reply: await optionalText(home, threadReplyPath(thread.key, entry.id)),
  }))) };
}
/** Opening is read-only: no model turn, record, worktree or dispatch until Send. */
export async function readThread(home: string, key: string): Promise<ItemThread> {
  return replies(home, (await load(home, key)).thread);
}

/** The same confined, versioned thread transport for scope discussions. The message is retained
 * before a native call, and a missing RPC/send reply never authorizes another delivery. */
export async function sendRecordedDiscussion(home: string, key: string, title: string,
  entry: Pick<ThreadMessage, "id" | "text" | "route" | "requestHash">, deliver: (beforeSend: (agentId: string) => Promise<void>) => Promise<void>): Promise<ItemThread> {
  return serialized(`${home}:${threadPath(key)}:send`, async () => {
    let { text: previous, thread } = await load(home, key);
    const existing = thread.messages.find(m => m.id === entry.id);
    if (existing) {
      if (existing.text !== entry.text || existing.requestHash !== entry.requestHash || JSON.stringify(existing.route) !== JSON.stringify(entry.route)) throw new Error("This discussion message id was already used with another target or body.");
      return replies(home, thread);
    }
    if (thread.messages.length >= 200) throw new Error("This discussion is full. Open its existing conversation.");
    const visible = await replies(home, thread);
    if (visible.messages.some(m => m.delivery === "uncertain" && m.reply === null)) throw new Error("Reconcile the uncertain message before sending another to this conversation.");
    if (entry.route?.replyTo && !thread.messages.some(m => m.id === entry.route!.replyTo)) throw new Error("The reply reference is not in this recipient's conversation.");
    async function save() {
      const content = `${JSON.stringify(thread, null, 2)}\n`;
      if (Buffer.byteLength(content) > MAX_EDITABLE_BYTES) throw new Error("This discussion is full. Open its existing conversation.");
      if (previous === null) await writeTextFile(home, { path: threadPath(key), content, expectedModifiedMs: null, force: false });
      else await replaceTextIfUnchanged(home, threadPath(key), previous, content);
      previous = content;
    }
    let reserved = false;
    try {
      await deliver(async agentId => {
        if (reserved) throw new Error("A discussion message has one captured recipient.");
        thread = { ...thread, title, messages: [...thread.messages, { ...entry, kind: "discuss", agentId, createdAt: new Date().toISOString(), delivery: "uncertain", reply: null }] };
        await save(); reserved = true;
      });
    } catch (error) {
      if (!reserved) throw error;
      return replies(home, thread);
    }
    if (!reserved) throw new Error("The sender did not reserve its captured recipient.");
    thread.messages.at(-1)!.delivery = "sent";
    await save();
    return replies(home, thread);
  });
}

type Deliver = (text: string, messageId: string, beforeSend: (agentId: string) => Promise<void>) => Promise<unknown>;
/** S08: whether the card's worker is (or, on a held journal, may be) a scoped attempt. */
export type ScopedCard = (card: FleetCard) => Promise<boolean>;
/** The sender invokes beforeSend only after lifecycle checks, immediately before delivery. */
export async function sendThread(
  home: string, card: FleetCard, input: z.infer<typeof sendItemThread.input>, deliver: Deliver, scoped?: ScopedCard,
): Promise<ItemThread> {
  const key = itemTagKey(card);
  if (key !== input.key) throw new Error("The item changed. Reopen its discussion.");
  // S07: a frozen or migrated plan's task is discussed with its scoped owner, never the legacy first mate.
  const gate = cutoverGate(home), item = { source: "decision" as const, id: `thread:${input.id}`, payloadHash: digest({ key, input }), ...(card.taskId ? { task: { taskId: card.taskId, host: card.remote?.host ?? null } } : {}) };
  return serialized(`${home}:${threadPath(key)}:send`, async () => {
    let { text: previous, thread } = await load(home, key);
    const existing = thread.messages.find((entry) => entry.id === input.id);
    if (existing !== undefined) {
      if (existing.kind !== input.kind || existing.text !== input.text) throw new Error("This message id was already used.");
      return replies(home, thread); // Lost RPC response: never deliver twice.
    }
    // Scoped board traffic bypasses General: before any new record or send, refuse a scoped worker's item.
    if (scoped !== undefined && await scoped(card)) {
      throw new Error("This item's worker belongs to a scoped supervisor. Discuss it with that scope; the first mate's item discussion will not carry it.");
    }
    if (input.kind === "graduate") {
      if (card.agent !== null || card.remote?.worker != null) throw new Error("This item already has a worker. Open its conversation.");
      if (thread.messages.some((entry) => entry.kind === "graduate")) throw new Error("Work has already been requested. Discuss the next step with the first mate.");
      if (!thread.messages.some((entry) => entry.kind === "discuss")) throw new Error("Discuss this item before requesting work.");
    }
    if (thread.messages.length >= 200) throw new Error("This discussion is full. Continue with the first mate in the bridge.");
    const template = input.kind === "graduate" ? TEMPLATES.itemGraduate
      : thread.messages.some((entry) => entry.kind === "graduate") ? TEMPLATES.itemWorkDiscussion : TEMPLATES.itemDiscuss;
    const prompt = await message(template, {
      item: JSON.stringify({ task: card.taskId, title: card.title, project: card.project, host: card.remote?.host ?? "local", backlog: card.backlog }),
      record: threadPath(key), reply: threadReplyPath(key, input.id), text: input.text,
    });
    async function save(): Promise<void> {
      const content = `${JSON.stringify(thread, null, 2)}\n`;
      if (Buffer.byteLength(content, "utf8") > MAX_EDITABLE_BYTES) throw new Error("This discussion is full. Continue with the first mate in the bridge.");
      if (previous === null) await writeTextFile(home, { path: threadPath(key), content, expectedModifiedMs: null, force: false });
      else await replaceTextIfUnchanged(home, threadPath(key), previous, content);
      previous = content;
    }
    let attempted = false;
    let claim: string | null = null;
    try {
      await deliver(prompt, `firstmate-thread-${input.id}`, async (agentId) => {
        claim = await gate.admit({ ...item, payloadHash: digest({ key, input, prompt }) }, agentId, { beforeClaim: async () => {
          thread = { ...thread, title: card.title, messages: [...thread.messages, {
            id: input.id, kind: input.kind, text: input.text, agentId,
            createdAt: new Date().toISOString(), delivery: "uncertain", reply: null,
          }] };
          await save(); // Durable reservation before the send; a crash never causes an automatic resend.
          attempted = true;
        } });
      });
    } catch (error) {
      await gate.settle(claim, "uncertain", String(error));
      if (!attempted) throw error;
      return replies(home, thread);
    }
    await gate.settle(claim, "accepted");
    thread.messages[thread.messages.length - 1]!.delivery = "sent";
    await save();
    return replies(home, thread);
  });
}
