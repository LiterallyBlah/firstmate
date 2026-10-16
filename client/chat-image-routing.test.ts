import { expect, it, vi } from "vitest";
import { chatImageRequest, localImageLink } from "./chat-image-routing";
import type { WorkspaceLinkServices } from "./workspace-link-routing";
import { markdownImage } from "./markdown-image";

function context() {
  const list = vi.fn(async () => ({ entries: [{ id: "worktree", name: "Worktree", workspaceDirectory: "C:/worktree", archivingAt: null }], pageInfo: { hasMore: false, nextCursor: null } }));
  const services: WorkspaceLinkServices = { hosts: () => [{ serverId: "local", label: "Desktop", status: "online" }, { serverId: "remote", label: "Other host", status: "online" }], client: () => ({ workspaces: { list } }) };
  return { serverId: "local", home: "C:/home", services, list };
}
it("reduces absolute, file-URI and titled worktree images to a registered ID and relative path", async () => {
  const c = context();
  for (const href of ["C:/worktree/preview.png", "file:///C:/worktree/preview.png", "C:\\worktree\\preview.png"]) expect(await chatImageRequest(href, undefined, c)).toEqual({ root: { kind: "workspace", workspaceId: "worktree" }, path: "preview.png" });
  expect(await chatImageRequest("preview%20image.png", "firstmate:serverId=local&workspaceId=worktree", c)).toEqual({ root: { kind: "workspace", workspaceId: "worktree" }, path: "preview image.png" });
});
it("uses only the configured home for unqualified relative images and home absolute images", async () => {
  const c = context();
  for (const href of ["images/preview.png", "C:/home/images/preview.png"]) expect(await chatImageRequest(href, undefined, c)).toEqual({ root: { kind: "home" }, path: "images/preview.png" });
  expect(c.list).not.toHaveBeenCalled();
});
it("refuses remote provenance, outside paths, traversal and unavailable workspace inventory", async () => {
  const c = context();
  await expect(chatImageRequest("preview.png", "firstmate:serverId=remote&workspaceId=worktree", c)).rejects.toThrow();
  expect(c.list).not.toHaveBeenCalled();
  for (const href of ["C:/outside/preview.png", "../preview.png", "javascript:alert", "C:/worktree/../preview.png"]) await expect(chatImageRequest(href, undefined, c)).rejects.toThrow();
  c.list.mockRejectedValue(new Error("offline"));
  await expect(chatImageRequest("C:/worktree/preview.png", undefined, c)).rejects.toThrow();
});
it("opts local Markdown images into the reader, retaining provenance and leaving web/data images alone", () => {
  const title = "firstmate:serverId=local&workspaceId=worktree";
  expect(markdownImage(`![Deck](<preview image.png> "${title}")`, true)).toEqual({ uri: "preview image.png", label: "Deck", title });
  expect(markdownImage("![No](notes.txt)", true)?.uri).toBe("notes.txt");
  expect(localImageLink("file:///C:/worktree/preview%20image.PNG")).toBe(true);
  for (const href of ["https://example.com/x.png", "data:image/png;base64,x", "notes.txt"]) expect(localImageLink(href)).toBe(false);
});
