/** Atomic whole-file replacement (write a sibling temporary, rename it over the target) that
 * survives Windows' transient refusals. Windows intermittently refuses a rename, link or unlink
 * while another handle (indexer, antivirus, a lagging close, a concurrent reader) holds the file:
 * EPERM/EBUSY/EACCES. Those are retried briefly, as the journal's own writes do (PR 221); EEXIST and
 * every other code fail at once, and elsewhere these codes are permanent and fail at once too.
 */
import { randomUUID } from "node:crypto";
import { open, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const TRANSIENT_WINDOWS = new Set(["EPERM", "EBUSY", "EACCES"]);
/** At most 40 attempts, about 7 seconds in all. */
export const TRANSIENT_ATTEMPTS = 40;
export function isTransientWindowsError(error: unknown, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" && TRANSIENT_WINDOWS.has(String((error as NodeJS.ErrnoException | null)?.code));
}
export async function transientRetry<T>(work: () => Promise<T>, platform: NodeJS.Platform = process.platform): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await work(); }
    catch (error) {
      if (!isTransientWindowsError(error, platform) || attempt >= TRANSIENT_ATTEMPTS - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * Math.min(attempt + 1, 8)));
    }
  }
}

/** A temporary this module names: `<target>.<uuid>.tmp`. */
const temporaryName = (target: string) => new RegExp(`^${basename(target).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.tmp$`, "i");
/** Older than this, a temporary of ours is an orphan of a failed or interrupted write, never one in progress. */
export const ORPHAN_AGE_MS = 10 * 60_000;

export type ReplaceOptions = {
  mode?: number;
  /** fsync the temporary before the rename. */
  sync?: boolean;
  /** For tests: the platform whose rename refusals are transient. */
  platform?: NodeJS.Platform;
  /** For tests: the rename to use. */
  renameFile?: (from: string, to: string) => Promise<void>;
  now?: () => number;
};

/** Writes `data` to a fresh `<path>.<uuid>.tmp`, renames it over `path` (retrying Windows' transient
 * refusals), and never leaves that temporary behind. After a replacement lands it also removes this
 * target's own orphaned temporaries older than {@link ORPHAN_AGE_MS}, left by an earlier write that
 * failed or was interrupted; a failure to remove one never fails the write. The directory must exist. */
export async function replaceFile(path: string, data: string | Uint8Array, options: ReplaceOptions = {}): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`, move = options.renameFile ?? rename;
  try {
    const file = await open(temporary, "wx", options.mode ?? 0o666);
    try { await file.writeFile(data); if (options.sync) await file.sync(); }
    finally { await file.close(); }
    await transientRetry(() => move(temporary, path), options.platform);
  } finally {
    await transientRetry(() => rm(temporary, { force: true }), options.platform).catch(() => undefined);
  }
  await removeOrphans(path, options.now?.() ?? Date.now()).catch(() => undefined);
}

async function removeOrphans(path: string, now: number): Promise<void> {
  const directory = dirname(path), pattern = temporaryName(path);
  for (const name of await readdir(directory)) {
    if (!pattern.test(name)) continue;
    const candidate = join(directory, name);
    try {
      if (now - (await stat(candidate)).mtimeMs >= ORPHAN_AGE_MS) await rm(candidate, { force: true });
    } catch { /* gone already, or held: the next write tries again */ }
  }
}
