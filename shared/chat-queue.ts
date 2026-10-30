import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { CaptainMessageSchema } from "./attachments";
import { DiscussionTargetSchema } from "./scope-discussion";
import { discussScope } from "./supervision-rpc";

export const ChatQueueTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mate"), agentId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("scope"), target: DiscussionTargetSchema }).strict(),
]);
export const ChatQueuePayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mate"), agentId: z.string().min(1), message: CaptainMessageSchema }).strict(),
  z.object({ kind: z.literal("scope"), input: discussScope.input }).strict(),
]);
export type ChatQueueTarget = z.infer<typeof ChatQueueTargetSchema>;
export type ChatQueuePayload = z.infer<typeof ChatQueuePayloadSchema>;
export const ChatQueueItemSchema = z.object({
  id: z.string().uuid(), target: ChatQueueTargetSchema, payload: ChatQueuePayloadSchema.nullable(),
  hash: z.string(), state: z.enum(["queued", "editing", "claimed", "sent", "held", "refused", "removed"]),
  problem: z.string().nullable(),
});
export type ChatQueueItem = z.infer<typeof ChatQueueItemSchema>;
export const ChatQueuePreviewSchema = ChatQueueItemSchema.omit({ payload: true }).extend({ text: z.string(), attachmentCount: z.number().int().nonnegative() });
export type ChatQueuePreview = z.infer<typeof ChatQueuePreviewSchema>;
export const ChatQueueSnapshotSchema = z.object({ enabled: z.boolean(), items: z.array(ChatQueuePreviewSchema) });
export const readChatQueue = defineRpc({ name: "firstmate.chat.queue", input: z.object({ target: ChatQueueTargetSchema }), output: ChatQueueSnapshotSchema });
export const submitChatMessage = defineRpc({ name: "firstmate.chat.submit", input: z.object({ id: z.string().uuid(), payload: ChatQueuePayloadSchema, now: z.boolean().default(false), replaces: z.string().uuid().optional() }), output: ChatQueueItemSchema });
export const changeChatQueue = defineRpc({ name: "firstmate.chat.queue.change", input: z.object({ target: ChatQueueTargetSchema, id: z.string().uuid(), action: z.enum(["edit", "remove", "now"]) }), output: ChatQueueItemSchema });
export function queueTarget(payload: ChatQueuePayload): ChatQueueTarget {
  return payload.kind === "mate" ? { kind: "mate", agentId: payload.agentId } : { kind: "scope", target: payload.input.route.target };
}
export function queueAgent(target: ChatQueueTarget): string | null { return target.kind === "mate" ? target.agentId : target.target.agentId; }
export function queueText(payload: ChatQueuePayload): string { return payload.kind === "mate" ? payload.message.text : payload.input.addressedText; }
