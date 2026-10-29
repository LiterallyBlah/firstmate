/**
 * The first mate's home as files, for the panel's file view.
 *
 * Every path is relative to the home and is checked twice: lexically (no
 * absolute paths, nothing that normalizes above the home) and on disk, by
 * resolving symlinks and requiring the result to still be inside the home's
 * own real path. The second check is what stops a link the first mate — or a
 * clone under `projects/` — happens to contain from opening the rest of the
 * disk.
 *
 * Saves compare exact byte hashes under the shared cross-process file lock. Data replacements
 * keep previous bytes and an audit even with receipt journaling disabled. See file-save.mjs.
 */
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";

import { fileLosses } from "../shared/file-losses";
import { FileChangedError, fileHash, fileTarget, replaceLocked, withFileLock, type SaveOptions } from "./file-save.mjs";
export { FileChangedError } from "./file-save.mjs";

import { MAX_EDITABLE_BYTES, type HomeEntry } from "../shared/files";
import { newAction, observedWrite, type RecordOrigin } from "./receipts";
import { serialized } from "./serialize";

/** How much of a file is read to decide whether it is text. */
const SNIFF_BYTES = 8192;

/** Turns a panel path into a normalized relative one, or throws. `""` is the home. */
export function cleanRelative(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (trimmed === "" || trimmed === ".") return "";
  if (isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed)) throw new Error(`"${path}" is not a path inside the home.`);
  const normalized = normalize(trimmed).split(sep).join("/").replace(/\/+$/, "");
  if (normalized === ".." || normalized.startsWith("../")) throw new Error(`"${path}" is outside the home.`);
  return normalized === "." ? "" : normalized;
}

export function isInside(root: string, candidate: string): boolean {
  const between = relative(root, candidate);
  return between === "" || (!between.startsWith("..") && !isAbsolute(between));
}

/**
 * The absolute path for `path`, after resolving symlinks — of the path
 * itself when it exists, of its nearest existing ancestor when it does not
 * (a file about to be created) — and refusing anything that lands outside.
 */
export async function resolveInHome(home: string, path: string): Promise<{ absolute: string; relative: string }> {
  const rel = cleanRelative(path);
  const root = await realpath(home);
  const absolute = join(root, rel);
  let existing = absolute;
  for (;;) {
    try {
      const real = await realpath(existing);
      if (!isInside(root, real)) throw new Error(`"${rel}" leads outside the home.`);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
  }
  return { absolute, relative: rel };
}

function childPath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

/** One directory, folders first, then files, each alphabetical. Entries that vanish mid-listing are skipped. */
export async function listDirectory(home: string, path: string): Promise<{ path: string; entries: HomeEntry[] }> {
  const { absolute, relative: rel } = await resolveInHome(home, path);
  const dirents = await readdir(absolute, { withFileTypes: true });
  const entries: HomeEntry[] = [];
  await Promise.all(
    dirents.map(async function (dirent) {
      const full = join(absolute, dirent.name);
      try {
        const info = await stat(full);
        if (!info.isDirectory() && !info.isFile()) return;
        entries.push({
          name: dirent.name,
          path: childPath(rel, dirent.name),
          kind: info.isDirectory() ? "dir" : "file",
          size: info.size,
          modifiedMs: Math.floor(info.mtimeMs),
        });
      } catch {
        // Gone since the listing, or a dangling link: nothing to show.
      }
    }),
  );
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
  return { path: rel, entries };
}

/** Read once: the version always describes the exact bytes shown, even if the file changes mid-read. */
export async function readTextFile(home: string, path: string) {
  const { absolute, relative: rel } = await resolveInHome(home, path);
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error(`"${rel}" is not a file.`);
  const base = { path: rel, size: info.size, modifiedMs: Math.floor(info.mtimeMs), hash: null };
  if (info.size > MAX_EDITABLE_BYTES) return { ...base, content: null, binary: false, tooLarge: true };
  const bytes = await readFile(absolute);
  if (bytes.length > MAX_EDITABLE_BYTES) return { ...base, size: bytes.length, content: null, binary: false, tooLarge: true };
  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return { ...base, content: null, binary: true, tooLarge: false };
  try {
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { ...base, size: bytes.length, content, hash: fileHash(bytes), binary: false, tooLarge: false };
  } catch { return { ...base, content: null, binary: true, tooLarge: false }; }
}

export interface WriteHooks extends SaveOptions {
  /** Optional receipt journal action; recovery copies are always enabled separately. */
  origin?: RecordOrigin | (() => RecordOrigin);
}
const originOf = (hooks: WriteHooks) => hooks.origin ?? (() => newAction("home.write"));

export async function writeTextFile(
  home: string,
  input: { path: string; content: string; expectedHash: string | null; force: boolean; reviewedLosses?: string[] },
  hooks: WriteHooks = {},
): Promise<{ path: string; size: number; modifiedMs: number; hash: string }> {
  const { relative: rel } = await resolveInHome(home, input.path);
  if (rel === "") throw new Error("The home itself is not a file.");
  const target = await fileTarget(home, rel);
  // Check canonical identity too: a home alias cannot edit a scoped projection or skip data recovery.
  if (/^data\/scoped\/(?!proposals\/)/.test(target.path))
    throw new Error("This is a scoped plan's projection; the plan's journal is its authority. Save your change under data/scoped/proposals/ as a proposal for its supervisor.");
  if (Buffer.byteLength(input.content, "utf8") > MAX_EDITABLE_BYTES) throw new Error("This text is too large to save here.");
  return serialized(target.absolute, () => withFileLock(target.absolute, async () => {
    const hash = await observedWrite({ absolute: target.absolute, path: rel }, originOf(hooks),
      () => replaceLocked(home, target.path, input.content, input.expectedHash, {
        ...hooks, actor: "files", force: input.force,
        check: before => {
          const losses = target.path.startsWith("data/") && before !== null ? fileLosses(before.toString("utf8"), input.content) : [];
          if (losses.length && JSON.stringify(losses) !== JSON.stringify(input.reviewedLosses ?? []))
            throw new FileChangedError("This save removes tasks or marks completed work unfinished. Review what will change before replacing the file.");
        },
      }), { after: input.content });
    const saved = await stat(target.absolute);
    return { path: rel, size: Buffer.byteLength(input.content, "utf8"), modifiedMs: Math.floor(saved.mtimeMs), hash };
  }));
}

/** Internal text edits share the same lock and recovery protocol; they never bypass a content check. */
export async function replaceTextIfUnchanged(
  home: string, path: string, expected: string, content: string, hooks: WriteHooks = {},
): Promise<void> {
  const { relative: rel } = await resolveInHome(home, path);
  if (rel === "") throw new Error("The home itself is not a file.");
  const target = await fileTarget(home, rel);
  await serialized(target.absolute, () => withFileLock(target.absolute, () =>
    observedWrite({ absolute: target.absolute, path: rel }, originOf(hooks), async () => {
      try { await replaceLocked(home, target.path, content, fileHash(expected), { ...hooks, actor: "home.edit", force: false }); }
      catch (error) { if (error instanceof FileChangedError) throw new FileChangedError(`"${rel}" changed since it was read.`); throw error; }
    }, { before: expected, after: content }),
  ));
}

/**
 * The home-relative path of `candidate` — relative to the home, or absolute
 * under it as given or as its real path — or null when it names no file
 * inside the home: outside it, lexically or through a symlink, missing, or a
 * folder.
 */
async function homeFileOf(home: string, root: string, candidate: string): Promise<string | null> {
  let rel = candidate;
  if (isAbsolute(candidate)) {
    const inside = [home, root].find((base) => isInside(base, candidate));
    if (inside === undefined) return null;
    rel = relative(inside, candidate);
  }
  try {
    const resolved = await resolveInHome(home, rel);
    if (resolved.relative === "") return null;
    return (await stat(resolved.absolute)).isFile() ? resolved.relative : null;
  } catch {
    // Outside the home, or not there: not a link, and not worth an error in a chat.
    return null;
  }
}

/** Each of `candidates` that is a file in the home, mapped to the path the Files view opens it by. */
export async function findFiles(home: string, candidates: readonly string[]): Promise<Record<string, string>> {
  const root = await realpath(home);
  const found = await Promise.all(candidates.map((candidate) => homeFileOf(home, root, candidate)));
  const files: Record<string, string> = {};
  candidates.forEach((candidate, index) => {
    const path = found[index];
    if (path !== null && path !== undefined) files[candidate] = path;
  });
  return files;
}

/** The home, which a launch creates; before that there is nothing to show, and saying so beats ENOENT. */
export async function requireHome(home: string): Promise<string> {
  try {
    const info = await stat(home);
    if (info.isDirectory()) return home;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  throw new Error("The first mate's home does not exist yet. Launch the first mate, and it is created.");
}
