import { open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { extname } from "node:path";
import { ChatImageRequestSchema, MAX_CHAT_IMAGE_BYTES, imageExtension, type ChatImageRequest, type ChatImageResult } from "../shared/chat-images";
import { readFirstmateConfig, resolveHome } from "./config";
import { cleanRelative, isInside, resolveInHome } from "./files";
import type { PaseoApi } from "./host-types";

/** Require the extension and signature to agree; never return an arbitrary file as an image. */
export function imageContentType(path: string, bytes: Buffer): string | null {
  const ext = extname(path).toLowerCase();
  const ascii = (start: number, end: number) => bytes.toString("ascii", start, end);
  if (ext === ".png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if ([".jpg", ".jpeg"].includes(ext) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (ext === ".gif" && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  if (ext === ".webp" && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ext === ".bmp" && bytes.length >= 26 && ascii(0, 2) === "BM") return "image/bmp";
  if (ext === ".avif" && bytes.length >= 16 && ascii(4, 8) === "ftyp") {
    const end = bytes.readUInt32BE(0);
    if (end >= 16 && end <= bytes.length) {
      for (let offset = 8; offset + 4 <= end; offset += offset === 8 ? 8 : 4) {
        if (["avif", "avis"].includes(ascii(offset, offset + 4))) return "image/avif";
      }
    }
  }
  if (ext === ".svg") {
    const text = bytes.toString("utf8");
    // SVG is served only as an Image data URL, never as markup or navigation.
    // Refuse entities/DTDs and non-text data; accept XML declarations/comments before the root.
    if (!/[\u0000\ufffd]/.test(text) && !/<!DOCTYPE|<!ENTITY/i.test(text) &&
        /^\uFEFF?\s*(?:<\?xml\s[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|\/?>)/.test(text)) return "image/svg+xml";
  }
  return null;
}

/** The caller selects an identity, never a directory or absolute disk path. */
export async function loadChatImage(paseo: Pick<PaseoApi, "workspaces">, input: ChatImageRequest): Promise<ChatImageResult> {
  const unavailable = (reason: Extract<ChatImageResult, { status: "unavailable" }>["reason"]): ChatImageResult => ({ status: "unavailable", reason });
  if (!ChatImageRequestSchema.safeParse(input).success) return unavailable("path");
  let path: string;
  try {
    // Reject traversal rather than letting normalization turn it into a different file.
    if (input.path.split(/[\\/]/).includes("..") || /[\u0000-\u001f\u007f:]/.test(input.path)) return unavailable("path");
    path = cleanRelative(input.path);
    if (!path) return unavailable("path");
  } catch { return unavailable("path"); }
  if (!imageExtension(path)) return unavailable("not-image");
  let root: string;
  try {
    if (input.root.kind === "home") root = resolveHome(await readFirstmateConfig());
    else {
      const workspace = await paseo.workspaces.ref(input.root.workspaceId).refresh();
      if (!workspace || workspace.id !== input.root.workspaceId || workspace.archivingAt != null) return unavailable("workspace");
      root = workspace.workspaceDirectory;
    }
  } catch { return unavailable("workspace"); }
  let absolute: string;
  try {
    const contained = await resolveInHome(root, path);
    // Open the canonical target, not the symlink that was checked.
    absolute = await realpath(contained.absolute);
    if (!isInside(await realpath(root), absolute)) return unavailable("path");
  } catch { return unavailable("path"); }
  try {
    // A disguised FIFO must not block the plugin. Refuse a final symlink swapped after realpath too.
    const handle = await open(absolute, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile()) return unavailable("not-image");
      if (info.size > MAX_CHAT_IMAGE_BYTES) return unavailable("too-large");
      const bytes = Buffer.alloc(Math.min(info.size + 1, MAX_CHAT_IMAGE_BYTES + 1));
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length);
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      if (length > MAX_CHAT_IMAGE_BYTES || length > info.size) return unavailable("too-large");
      const image = bytes.subarray(0, length);
      const contentType = imageContentType(path, image);
      if (contentType === null) return unavailable("not-image");
      return { status: "ready", dataUrl: `data:${contentType};base64,${image.toString("base64")}`, contentType, size: length };
    } finally { await handle.close(); }
  } catch { return unavailable("unreadable"); }
}
