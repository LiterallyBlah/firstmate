/** Lightweight item discussions use the existing first mate, never another agent. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { FleetCard } from "./fleet";
import { itemTagKey } from "./item-tags";

export const threadKey = (card: FleetCard): string => `thread:${encodeURIComponent(itemTagKey(card))}`;

export const ThreadMessageSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/),
  kind: z.enum(["discuss", "graduate"]),
  text: z.string(),
  createdAt: z.string(),
  agentId: z.string(),
  delivery: z.enum(["uncertain", "sent"]),
  reply: z.string().nullable(),
});
export const ItemThreadSchema = z.object({
  key: z.string(),
  title: z.string(),
  messages: z.array(ThreadMessageSchema),
});
export type ItemThread = z.infer<typeof ItemThreadSchema>;
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;
const identity = z.object({ key: z.string().min(1).max(2048) });
export const readItemThread = defineRpc({
  name: "firstmate.item.thread",
  input: identity,
  output: ItemThreadSchema,
});
export const sendItemThread = defineRpc({
  name: "firstmate.item.discuss",
  input: identity.extend({
    id: ThreadMessageSchema.shape.id,
    kind: ThreadMessageSchema.shape.kind,
    text: z.string().trim().max(16000),
  }).refine((input) => input.kind === "graduate" || input.text.length > 0, "Write a message first."),
  output: ItemThreadSchema,
});
