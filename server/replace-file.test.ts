import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ORPHAN_AGE_MS, replaceFile, transientRetry } from "./replace-file";

const errno = (code: string) => Object.assign(new Error(code), { code });
async function folder() {
  const directory = join(process.env.PASEO_HOME!, randomUUID()); await mkdir(directory, { recursive: true });
  return directory;
}
/** A rename that refuses with `codes`, in order, before doing the real one. */
function refusing(codes: string[]) {
  const calls: string[] = [];
  return { calls, renameFile: async (from: string, to: string) => { const code = codes[calls.length]; calls.push(code ?? "ok"); if (code) throw errno(code); await rename(from, to); } };
}

describe("replaceFile", () => {
  it("retries Windows' transient rename refusals and leaves no temporary", async () => {
    const directory = await folder(), path = join(directory, "config.json");
    await writeFile(path, "old");
    const r = refusing(["EPERM", "EBUSY", "EACCES"]);
    await replaceFile(path, "new", { platform: "win32", renameFile: r.renameFile });
    expect(r.calls).toEqual(["EPERM", "EBUSY", "EACCES", "ok"]);
    expect(await readFile(path, "utf8")).toBe("new");
    expect(await readdir(directory)).toEqual(["config.json"]);
  });
  it("never retries EEXIST, and keeps the old file and no temporary on failure", async () => {
    const directory = await folder(), path = join(directory, "config.json");
    await writeFile(path, "old");
    const r = refusing(["EEXIST"]);
    await expect(replaceFile(path, "new", { platform: "win32", renameFile: r.renameFile })).rejects.toMatchObject({ code: "EEXIST" });
    expect(r.calls).toEqual(["EEXIST"]);
    expect(await readFile(path, "utf8")).toBe("old");
    expect(await readdir(directory)).toEqual(["config.json"]);
  });
  it("does not retry these codes off Windows", async () => {
    const directory = await folder(), path = join(directory, "config.json"), r = refusing(["EPERM"]);
    await expect(replaceFile(path, "new", { platform: "linux", renameFile: r.renameFile })).rejects.toMatchObject({ code: "EPERM" });
    expect(r.calls).toEqual(["EPERM"]);
    expect(await readdir(directory)).toEqual([]);
  });
  it("gives up after a bounded number of attempts", async () => {
    let calls = 0;
    await expect(transientRetry(async () => { calls++; throw errno("EPERM"); }, "win32")).rejects.toMatchObject({ code: "EPERM" });
    expect(calls).toBe(40);
  }, 20_000);
  it("removes this target's orphaned temporaries once a replacement lands, and nothing else", async () => {
    const directory = await folder(), path = join(directory, "config.json");
    const orphan = `config.json.${randomUUID()}.tmp`, recent = `config.json.${randomUUID()}.tmp`, other = `watches.json.${randomUUID()}.tmp`;
    for (const name of [orphan, recent, other, "config.json.tmp"]) await writeFile(join(directory, name), "{}");
    const { utimes } = await import("node:fs/promises"), old = new Date(Date.now() - ORPHAN_AGE_MS - 60_000);
    await utimes(join(directory, orphan), old, old); await utimes(join(directory, other), old, old);
    await replaceFile(path, "new");
    expect((await readdir(directory)).sort()).toEqual(["config.json", "config.json.tmp", recent, other].sort());
  });
});
