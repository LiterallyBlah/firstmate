import { imageExtension, type ChatImageRequest } from "../shared/chat-images";
import { parseFileLink, relativeWorkspaceFile } from "./workspace-links";
import { resolveWorkspaceFile, type WorkspaceLinkServices } from "./workspace-link-routing";

/** Classification only; the server checks both the extension and the actual bytes. */
export function localImageLink(href: string): boolean {
  if (/^(?:https?:|data:)/i.test(href)) return false;
  try { return imageExtension(decodeURIComponent(href).replace(/#L\d+(?:-L?\d+)?$|:\d+(?::\d+)?$/i, "")); }
  catch { return false; }
}

export interface ChatImageContext {
  serverId?: string | undefined;
  home?: string;
  /** Present only in worker chats. Missing identity must never fall back to the mate's home. */
  worker?: { workspaceId: string | null; cwd: string } | null;
}

export async function chatImageRequest(href: string, title: string | undefined, context: ChatImageContext & {
  services: WorkspaceLinkServices;
}): Promise<ChatImageRequest> {
  const parsed = parseFileLink(href, title === "firstmate:home" ? undefined : title);
  if (parsed.kind !== "file") throw new Error("Not a local image");
  const reference = parsed.reference;
  if (context.worker !== undefined) {
    if (!context.worker?.workspaceId || !context.serverId || title === "firstmate:home") throw new Error("Worker workspace unavailable");
    if (reference.provenance !== null && reference.provenance.serverId !== context.serverId) throw new Error("Image belongs to another host");
    // Bare relative paths are relative to this worker's cwd, which can be below the workspace root.
    const path = !reference.absolute && reference.provenance === null
      ? `${context.worker.cwd.replace(/[\\/]$/, "")}/${reference.path}` : reference.path;
    const selection = await resolveWorkspaceFile({ ...reference, path,
      provenance: reference.provenance ?? { serverId: context.serverId, workspaceId: context.worker.workspaceId },
      absolute: reference.absolute || reference.provenance === null,
    }, context.services);
    return { root: { kind: "workspace", workspaceId: selection.workspace.id }, path: selection.relativePath };
  }
  if (reference.provenance === null) {
    if (!reference.absolute) return { root: { kind: "home" }, path: reference.path };
    if (context.home) {
      const path = relativeWorkspaceFile(context.home, reference);
      if (path !== null) return { root: { kind: "home" }, path };
    }
  }
  if (title === "firstmate:home" || !context.serverId ||
      (reference.provenance !== null && reference.provenance.serverId !== context.serverId)) throw new Error("Image belongs to another host");
  // This RPC belongs to the contributing host. Never reinterpret remote provenance locally.
  const selection = await resolveWorkspaceFile(reference, {
    ...context.services,
    hosts: () => context.services.hosts().filter(host => host.serverId === context.serverId),
  });
  return { root: { kind: "workspace", workspaceId: selection.workspace.id }, path: selection.relativePath };
}
