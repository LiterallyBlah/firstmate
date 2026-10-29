// Shared by the daemon's Files writer and the installed launch helper. No shell or daemon API.
import { createHash, randomUUID } from "node:crypto";
import { chmod, link, mkdir, open, readFile, readdir, realpath, rename, rm, stat, utimes } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

export const fileHash = bytes => createHash("sha256").update(bytes).digest("hex");
export class FileChangedError extends Error {
  constructor(message = "This file changed since you opened it. Your text is still here. Compare the copies before saving.") {
    super(message); this.name = "FileChangedError"; this.code = "backlog-changed";
  }
}
const present = async path => {
  try { return await readFile(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
const digest = bytes => bytes === null ? null : fileHash(bytes);

// Resolve the real file (including aliases) so every cooperating writer uses the same lock.
export async function fileTarget(home, path) {
  const root = await realpath(home), target = join(root, path);
  let ancestor = target, suffix = [];
  for (;;) {
    try {
      const resolved = join(await realpath(ancestor), ...suffix);
      const rel = relative(root, resolved);
      if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("File must stay inside the home.");
      return { absolute: resolved, path: rel.split(sep).join("/"), root };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor);
    }
  }
}
export function fileLockPath(absolute) {
  return join(dirname(absolute), basename(absolute) === "backlog.md" ? ".backlog.lock" : `.firstmate-${fileHash(basename(absolute))}.lock`);
}
export async function withFileLock(absolute, action) {
  await mkdir(dirname(absolute), { recursive: true });
  const path = fileLockPath(absolute);
  let handle;
  try { handle = await open(path, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error("Another save has this file locked. Try Save again after it finishes. If the writer stopped, inspect the lock before removing it.");
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    await handle.sync();
    return await action();
  } finally { await handle.close(); await rm(path); }
}
async function durableFile(path, bytes) {
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

/** Call only inside withFileLock. Previous bytes and each operation's audit are bounded to 50. */
export async function replaceLocked(home, path, content, expectedHash, options = {}) {
  const target = await fileTarget(home, path), absolute = target.absolute;
  const after = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  const before = await present(absolute);
  const check = bytes => {
    if (digest(bytes) !== expectedHash) throw new FileChangedError(expectedHash === null && bytes !== null
      ? "This file already exists. Open it before saving." : undefined);
  };
  check(before);
  await options.check?.(before);
  if (before?.equals(after)) return fileHash(after);
  const id = `${Date.now()}-${randomUUID()}`;
  const temporary = `${absolute}.firstmate-${id}.tmp`, captured = `${absolute}.firstmate-${id}.previous`;
  const records = target.path.startsWith("data/");
  const recoveryPath = `recall/files/${target.path}`;
  let recovery, audit, moved = false, displacedHash = null, capturedBacked = false;
  const remember = async bytes => {
    if (!records || bytes === null) return;
    const snapshot = join(recovery, `${fileHash(bytes)}.bin`);
    try { await durableFile(snapshot, bytes); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await readFile(snapshot)).equals(bytes)) throw new Error("The saved previous copy is damaged. Save stopped.");
    }
    const time = new Date(); await utimes(snapshot, time, time);
  };
  const record = async status => {
    if (!records || !audit) return;
    const event = { at: new Date().toISOString(), path: target.path, before: digest(before), after: fileHash(after), displacedHash, actor: options.actor ?? "files", force: options.force === true, status };
    await durableFile(join(audit, `${id}-${status}.json`), JSON.stringify(event) + "\n");
  };
  try {
    await mkdir(dirname(absolute), { recursive: true });
    if (records) {
      recovery = (await fileTarget(target.root, recoveryPath)).absolute;
      await mkdir(recovery, { recursive: true });
      audit = (await fileTarget(target.root, `${recoveryPath}/history`)).absolute;
      await mkdir(audit, { recursive: true });
      await remember(before);
      await record("prepared");
    }
    await durableFile(temporary, after);
    if (before !== null) await chmod(temporary, (await stat(absolute)).mode & 0o7777);
    await options.afterStaging?.();
    check(await present(absolute));
    await options.beforeCapture?.();
    if (before !== null) {
      // Capture the actual destination rather than unconditionally renaming OVER it. An outside
      // edit at the last check/rename boundary is now inspected and retained, not thrown away.
      await rename(absolute, captured); moved = true;
      const displaced = await readFile(captured);
      displacedHash = fileHash(displaced);
      await remember(displaced);
      capturedBacked = records;
      check(displaced);
    }
    await options.beforeInstall?.();
    // Exclusive install: an outside writer creating the path during capture wins. Never clobber it.
    try { await link(temporary, absolute); }
    catch (error) { if (error.code === "EEXIST") throw new FileChangedError(); throw error; }
    await record("saved");
    await options.afterRename?.();
    if (digest(await present(absolute)) !== fileHash(after)) throw new FileChangedError();
    return fileHash(after);
  } catch (error) {
    if (moved) {
      // Restore only into an absent path. If another writer already put a file there, keep both.
      try { await link(captured, absolute); }
      catch (restoreError) { if (restoreError.code !== "EEXIST") throw restoreError; }
    }
    await record("stopped");
    throw error;
  } finally {
    await rm(temporary, { force: true });
    // On a failed restore leave the captured file beside the destination for manual recovery.
    const current = await present(absolute);
    if (!moved || (current !== null && (capturedBacked || digest(current) === displacedHash))) await rm(captured, { force: true });
    if (records && recovery && audit) {
      for (const [folder, extension, limit] of [[recovery, ".bin", 50], [audit, ".json", 100]]) {
        const names = (await readdir(folder)).filter(name => name.endsWith(extension));
        const entries = await Promise.all(names.map(async name => ({ name, time: (await stat(join(folder, name))).mtimeMs })));
        entries.sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
        for (const entry of entries.slice(limit)) await rm(join(folder, entry.name));
      }
    }
  }
}
