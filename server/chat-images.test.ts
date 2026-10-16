import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { MAX_CHAT_IMAGE_BYTES, ChatImageRequestSchema } from "../shared/chat-images";
import { loadChatImage, imageContentType } from "./chat-images";
import { updateFirstmateConfig } from "./config";
import type { PaseoApi } from "./host-types";

let home: string, workspace: string, outside: string;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
beforeEach(async () => {
  const base = await mkdtemp(join(process.env.PASEO_HOME!, "images-"));
  home = join(base, "home"); workspace = join(base, "worktree"); outside = join(base, "outside");
  for (const root of [home, workspace, outside]) {
    await mkdir(root);
    await writeFile(join(root, "preview.png"), png);
  }
  await updateFirstmateConfig({ home });
});
function host() {
  const record = { id: "registered", workspaceDirectory: workspace, archivingAt: null as string | null };
  const refresh = vi.fn(async () => record as typeof record | null);
  const ref = vi.fn(() => ({ refresh }));
  return { paseo: { workspaces: { ref } } as unknown as PaseoApi, record, refresh, ref };
}
const homeRoot = { kind: "home" } as const;
const workspaceRoot = { kind: "workspace", workspaceId: "registered" } as const;

it("reads only images from the configured home or exact registered workspace and leaves bytes unchanged", async () => {
  const h = host();
  for (const root of [homeRoot, workspaceRoot]) {
    expect(await loadChatImage(h.paseo, { root, path: "preview.png" })).toEqual({ status: "ready", contentType: "image/png", size: png.length, dataUrl: `data:image/png;base64,${png.toString("base64")}` });
  }
  expect(h.ref).toHaveBeenCalledExactlyOnceWith("registered");
  expect(await readFile(join(workspace, "preview.png"))).toEqual(png);
});

it("rejects absolute paths, parent traversal, NUL, Windows streams and caller-selected roots", async () => {
  for (const path of [join(outside, "preview.png"), "/etc/preview.png", "C:\\secret.png", "../outside/preview.png", "nested/../../preview.png", "..\\outside\\preview.png", "preview.png\0", "preview.png:stream", "//server/share/x.png"]) {
    expect(await loadChatImage(host().paseo, { root: homeRoot, path })).toEqual({ status: "unavailable", reason: "path" });
  }
  expect(ChatImageRequestSchema.safeParse({ root: { kind: "home", directory: outside }, path: "preview.png" }).success).toBe(false);
});

it("resolves directory symlinks/junctions and refuses escapes even into another allowed root", async () => {
  await symlink(outside, join(home, "escape"), process.platform === "win32" ? "junction" : "dir");
  await symlink(workspace, join(home, "other-workspace"), process.platform === "win32" ? "junction" : "dir");
  await mkdir(join(home, "inside"));
  await writeFile(join(home, "inside", "preview.png"), png);
  await symlink(join(home, "inside"), join(home, "safe"), process.platform === "win32" ? "junction" : "dir");
  for (const path of ["escape/preview.png", "other-workspace/preview.png"]) expect(await loadChatImage(host().paseo, { root: homeRoot, path })).toEqual({ status: "unavailable", reason: "path" });
  expect((await loadChatImage(host().paseo, { root: homeRoot, path: "safe/preview.png" })).status).toBe("ready");
});

it("refuses a missing, mismatched, archiving or unavailable workspace without falling back home", async () => {
  const h = host();
  h.record.archivingAt = "now";
  expect((await loadChatImage(h.paseo, { root: workspaceRoot, path: "preview.png" })).status).toBe("unavailable");
  h.record.archivingAt = null; h.record.id = "different";
  expect((await loadChatImage(h.paseo, { root: workspaceRoot, path: "preview.png" })).status).toBe("unavailable");
  h.refresh.mockResolvedValue(null);
  expect((await loadChatImage(h.paseo, { root: workspaceRoot, path: "preview.png" })).status).toBe("unavailable");
  h.refresh.mockRejectedValue(new Error("offline"));
  expect((await loadChatImage(h.paseo, { root: workspaceRoot, path: "preview.png" })).status).toBe("unavailable");
});

it("refuses non-images, forged/mismatched signatures, directories, missing and oversized files", async () => {
  await writeFile(join(home, "source.txt"), png);
  await writeFile(join(home, "source.png"), "secret source text");
  await writeFile(join(home, "wrong.jpg"), png);
  await writeFile(join(home, "large.png"), Buffer.concat([png, Buffer.alloc(MAX_CHAT_IMAGE_BYTES)]));
  await mkdir(join(home, "directory.png"));
  for (const path of ["source.txt", "source.png", "wrong.jpg", "directory.png"]) expect(await loadChatImage(host().paseo, { root: homeRoot, path })).toEqual({ status: "unavailable", reason: "not-image" });
  expect(await loadChatImage(host().paseo, { root: homeRoot, path: "large.png" })).toEqual({ status: "unavailable", reason: "too-large" });
  expect((await loadChatImage(host().paseo, { root: homeRoot, path: "missing.png" })).status).toBe("unavailable");
});

it("sniffs the supported formats, with SVG confined to text and no DTD/entities", () => {
  for (const [ext, bytes, mime] of [
    ["png", png, "image/png"], ["JPEG", Buffer.from([255, 216, 255, 224]), "image/jpeg"],
    ["gif", Buffer.from("GIF89a"), "image/gif"], ["webp", Buffer.from("RIFF1234WEBP"), "image/webp"],
    ["bmp", Buffer.concat([Buffer.from("BM"), Buffer.alloc(24)]), "image/bmp"],
    ["svg", Buffer.from('<?xml version="1.0"?>\n<!-- image --><svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml"],
    ["avif", Buffer.from("00000018667479706176696600000000617669666d696631", "hex"), "image/avif"],
  ] as const) expect(imageContentType(`image.${ext}`, bytes)).toBe(mime);
  for (const text of ["<html><svg/></html>", '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg/>', "<svg>\0</svg>"]) expect(imageContentType("x.svg", Buffer.from(text))).toBeNull();
});
