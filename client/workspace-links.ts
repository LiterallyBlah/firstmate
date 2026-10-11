/** Link identity and lexical confinement only. Never reads a file or invents a navigation URL. */
import { MAX_FILE_PATH_LENGTH } from "../shared/files";

export interface FileReference {
  path: string;
  absolute: boolean;
  provenance: { serverId: string; workspaceId: string } | null;
  lineStart?: number;
  lineEnd?: number;
  column?: number;
}
export type ParsedFileLink = { kind: "external"; url: string } | { kind: "file"; reference: FileReference };
const CONTROL = /[\u0000-\u001f\u007f]/;
const WINDOWS = /^(?:[a-z]:[\\/]|[\\/]{2})/i;

export function absoluteFileTarget(path: string): boolean {
  return path.startsWith("/") || WINDOWS.test(path) || /^file:/i.test(path);
}

function decoded(value: string): string {
  try { return decodeURIComponent(value); } catch { throw new Error("The file link has invalid percent encoding."); }
}
function positive(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error("The file link has an invalid line or column number.");
  return number;
}

/** The title is plugin metadata, not a deep link. Other normal Markdown titles are ignored. */
function provenance(title: string | undefined): FileReference["provenance"] {
  if (!title?.startsWith("firstmate:")) return null;
  const match = /^firstmate:serverId=([^&]+)&workspaceId=([^&]+)$/.exec(title);
  if (!match) throw new Error("Use the file-link title firstmate:serverId=SERVER_ID&workspaceId=WORKSPACE_ID with exact Paseo IDs.");
  const serverId = decoded(match[1]!), workspaceId = decoded(match[2]!);
  if ([serverId, workspaceId].some(value => !value || value.length > MAX_FILE_PATH_LENGTH || CONTROL.test(value) || value.trim() !== value)) {
    throw new Error("The file link has an invalid host or workspace identity.");
  }
  return { serverId, workspaceId };
}

export function parseFileLink(href: string, title?: string): ParsedFileLink {
  // HTTPS stays external even if the author supplied an unrelated title.
  if (/^https?:\/\//i.test(href)) return { kind: "external", url: href };
  if (!href || href.length > MAX_FILE_PATH_LENGTH + 100 || CONTROL.test(href) || href.trim() !== href) {
    throw new Error("The file link is empty, too long, or contains invalid characters.");
  }
  const identity = provenance(title);
  let raw = href;
  if (/^file:/i.test(raw)) {
    // A file URI authority is not a Paseo serverId. Require file:/// and explicit title metadata.
    const uri = /^file:\/\/\/(.*)$/i.exec(raw);
    if (!uri) throw new Error("Use file:/// for an absolute file and put its Paseo host identity in the link title.");
    raw = "/" + uri[1];
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw)) {
    throw new Error("This link is not a supported HTTP(S) URL or file path.");
  }
  if (raw.includes("?")) throw new Error("Encode a filename's question mark as %3F; file links do not take a query string.");
  const hash = raw.indexOf("#");
  const location: Pick<FileReference, "lineStart" | "lineEnd" | "column"> = {};
  if (hash >= 0) {
    const lines = /^L(\d+)(?:-L?(\d+))?$/i.exec(raw.slice(hash + 1));
    if (!lines) throw new Error("Use #L12 or #L12-L18 for a file link's line selection.");
    location.lineStart = positive(lines[1]!);
    if (lines[2] !== undefined) location.lineEnd = positive(lines[2]);
    raw = raw.slice(0, hash);
  } else {
    const suffix = /:(\d+)(?::(\d+))?$/.exec(raw);
    if (suffix) {
      location.lineStart = positive(suffix[1]!);
      if (suffix[2] !== undefined) location.column = positive(suffix[2]);
      raw = raw.slice(0, suffix.index);
    }
  }
  if (location.lineEnd !== undefined && location.lineEnd < location.lineStart!) throw new Error("The file link's line range ends before it starts.");
  let path = decoded(raw);
  if (/^\/[a-z]:[\\/]/i.test(path)) path = path.slice(1);
  if (!path || path.length > MAX_FILE_PATH_LENGTH || CONTROL.test(path) || path.endsWith("/") || path.endsWith("\\") || /^~(?:[\\/]|$)/.test(path) || /^[a-z]:[^\\/]/i.test(path)) {
    throw new Error("The file link does not name a supported file path.");
  }
  if (path.split(/[\\/]/).includes("..")) throw new Error("The file link contains parent traversal; use a path inside the workspace.");
  return { kind: "file", reference: { path, absolute: absoluteFileTarget(path), provenance: identity, ...location } };
}

function normalize(path: string): { path: string; windows: boolean } {
  const windows = WINDOWS.test(path);
  if (!windows && path.includes("\\")) throw new Error("A Unix workspace path must use / separators.");
  const slashes = path.replace(/\\/g, "/");
  if (CONTROL.test(slashes) || slashes.split("/").includes("..")) throw new Error("The file link is outside the workspace.");
  const parts = slashes.split("/").filter(part => part !== "" && part !== ".");
  const prefix = /^[a-z]:\//i.test(slashes) ? "" : slashes.startsWith("//") ? "//" : slashes.startsWith("/") ? "/" : "";
  return { path: prefix + parts.join("/"), windows };
}

/** A file's relative display path, or null if the absolute path is not inside this root. */
export function relativeWorkspaceFile(root: string, reference: FileReference): string | null {
  if (!absoluteFileTarget(root) || /^file:/i.test(root)) throw new Error("The workspace has no usable directory; file ownership cannot be checked.");
  const normalizedRoot = normalize(root);
  const rootPath = normalizedRoot.path.replace(/\/$/, "");
  let path: string;
  if (reference.absolute) {
    const target = normalize(reference.path);
    if (target.windows !== normalizedRoot.windows) return null;
    const compare = (value: string) => target.windows ? value.toLowerCase() : value;
    if (!compare(target.path).startsWith(compare(rootPath + "/"))) return null;
    path = target.path.slice(rootPath.length + 1);
  } else {
    if (!normalizedRoot.windows && reference.path.includes("\\")) throw new Error("A Unix workspace file must use / separators.");
    path = normalize((normalizedRoot.windows ? reference.path.replace(/\\/g, "/") : reference.path)).path;
  }
  if (!path || path === "." || path.startsWith("/") || /^[a-z]:/i.test(path)) return null;
  if (normalizedRoot.windows && path.split("/").some(part => /[<>:"|?*]|[ .]$/.test(part))) {
    throw new Error("The file link contains an unsupported Windows filename.");
  }
  return path;
}

/** An explicitly authored home Markdown link still goes through the existing confined RPC. */
export function homeLinkCandidate(href: string): string | null {
  try {
    const parsed = parseFileLink(href);
    return parsed.kind === "file" && !parsed.reference.absolute ? parsed.reference.path : null;
  } catch { return null; }
}

export function fileLineDescription(reference: FileReference): string {
  if (reference.lineStart === undefined) return "";
  if (reference.lineEnd !== undefined && reference.lineEnd !== reference.lineStart) return `Lines ${reference.lineStart}–${reference.lineEnd}`;
  return `Line ${reference.lineStart}${reference.column === undefined ? "" : `, column ${reference.column}`}`;
}
