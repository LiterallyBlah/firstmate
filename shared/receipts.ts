/**
 * The receipt journal's one RPC: a read-only page of the first mate's or a crewmate's timeline, through the
 * SDK's cursor, with the fields that prove a page is whole — `gap`, `staleCursor`, `hasOlder` and the rest —
 * passed on as Paseo gives them. It reads and writes nothing else, and is refused while the journal is off.
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const Cursor = z.object({ epoch: z.string(), seq: z.number() });

export const pageReceiptTimeline = defineRpc({
  name: "firstmate.receipts.timeline",
  input: z.object({
    agentId: z.string().min(1),
    direction: z.enum(["tail", "before", "after"]).default("tail"),
    cursor: Cursor.optional(),
    limit: z.number().int().min(1).max(200).default(100),
    projection: z.enum(["projected", "canonical"]).default("projected"),
  }).strict().refine((input) => (input.direction === "tail") === (input.cursor === undefined), {
    message: "A tail page takes no cursor; a before or after page needs one.",
  }),
  output: z.object({
    agentId: z.string(),
    role: z.enum(["first-mate", "former-first-mate", "crew"]),
    epoch: z.string(),
    direction: z.string(),
    projection: z.string(),
    reset: z.boolean(),
    staleCursor: z.boolean(),
    gap: z.boolean(),
    hasOlder: z.boolean(),
    hasNewer: z.boolean(),
    window: z.object({ minSeq: z.number(), maxSeq: z.number(), nextSeq: z.number() }),
    startCursor: Cursor.nullable(),
    endCursor: Cursor.nullable(),
    error: z.string().nullable(),
    entries: z.array(z.object({
      seqStart: z.number(), seqEnd: z.number(), turnId: z.string().nullable(), timestamp: z.string(), item: z.unknown(),
    })),
  }),
});
