import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Maximum source bytes, before base64 encoding. Reads are bounded even if a file grows. */
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
export const ChatImageRequestSchema = z.object({
  root: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("home") }).strict(),
    z.object({ kind: z.literal("workspace"), workspaceId: z.string().min(1).max(1024) }).strict(),
  ]),
  path: z.string().min(1).max(1024),
}).strict();
export const ChatImageResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), dataUrl: z.string(), contentType: z.string(), size: z.number() }),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["path", "workspace", "not-image", "too-large", "unreadable"]) }),
]);
export type ChatImageRequest = z.infer<typeof ChatImageRequestSchema>;
export type ChatImageResult = z.infer<typeof ChatImageResultSchema>;
export const readChatImage = defineRpc({
  name: "firstmate.images.read",
  input: ChatImageRequestSchema,
  output: ChatImageResultSchema,
});

export function imageExtension(path: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(path);
}
