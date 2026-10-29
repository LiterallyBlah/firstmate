import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileChangedError,
  cleanRelative,
  findFiles,
  listDirectory,
  readTextFile,
  replaceTextIfUnchanged,
  writeTextFile,
} from "./files";
import { listWatches } from "./watch-files";
import { fileHash } from "./file-save.mjs";
import { fileLosses } from "../shared/file-losses";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "firstmate-files-"));
  tempDirs.push(dir);
  await mkdir(join(dir, "data", "fix-login"), { recursive: true });
  await writeFile(join(dir, "AGENTS.md"), "# First mate\n");
  await writeFile(join(dir, "data", "backlog.md"), "## In flight\n");
  await writeFile(join(dir, "data", "fix-login", "brief.md"), "brief");
  return dir;
}

describe("cleanRelative", () => {
  it("normalizes paths inside the home and refuses the rest", () => {
    expect(cleanRelative("")).toBe("");
    expect(cleanRelative("./data//backlog.md")).toBe("data/backlog.md");
    expect(cleanRelative("data/fix-login/../backlog.md")).toBe("data/backlog.md");
    expect(() => cleanRelative("../outside")).toThrow(/outside the home/);
    expect(() => cleanRelative("data/../../x")).toThrow(/outside the home/);
    expect(() => cleanRelative("/etc/passwd")).toThrow(/not a path inside/);
  });
});

describe("listDirectory", () => {
  it("lists folders first, then files, with paths relative to the home", async () => {
    const dir = await home();
    const root = await listDirectory(dir, "");
    expect(root.entries.map((entry) => [entry.kind, entry.path])).toEqual([
      ["dir", "data"],
      ["file", "AGENTS.md"],
    ]);
    const data = await listDirectory(dir, "data");
    expect(data.entries.map((entry) => entry.path)).toEqual(["data/fix-login", "data/backlog.md"]);
  });

  it("refuses a symlink that leads outside the home", async () => {
    const dir = await home();
    const outside = await mkdtemp(join(tmpdir(), "firstmate-outside-"));
    tempDirs.push(outside);
    await writeFile(join(outside, "secret.txt"), "no");
    await symlink(outside, join(dir, "escape"), process.platform === "win32" ? "junction" : "dir");
    await expect(listDirectory(dir, "escape")).rejects.toThrow(/outside the home/);
    await expect(readTextFile(dir, "escape/secret.txt")).rejects.toThrow(/outside the home/);
  });
});

describe("readTextFile", () => {
  it("hashes the exact BOM and line-ending bytes shown and refuses invalid UTF-8", async () => {
    const dir = await home(), path = join(dir, "data/backlog.md");
    const bytes = Buffer.from("\uFEFF## In flight\r\n"); await writeFile(path, bytes);
    const opened = await readTextFile(dir, "data/backlog.md");
    expect(Buffer.from(opened.content!)).toEqual(bytes);
    expect(opened.hash).toBe(fileHash(bytes));
    await writeFile(path, Buffer.from([0xc3, 0x28]));
    expect(await readTextFile(dir, "data/backlog.md")).toMatchObject({ binary: true, content: null, hash: null });
  });
  it("reads text and flags a binary file instead of sending it", async () => {
    const dir = await home();
    expect(await readTextFile(dir, "data/backlog.md")).toMatchObject({ content: "## In flight\n", binary: false });
    await writeFile(join(dir, "image.png"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
    expect(await readTextFile(dir, "image.png")).toMatchObject({ content: null, binary: true });
  });
});

describe("writeTextFile", () => {
  it("keeps an hour of newer tasks and Done work until the exact losses are reviewed", async () => {
    const dir = await home(), path = join(dir, "data/backlog.md");
    const original = "## In flight\n- [ ] pr9 - Review nine\n- [ ] pr10 - Review ten\n## Done\n";
    const current = "## In flight\n" + Array.from({ length: 10 }, (_, n) => `- [ ] new${n} - New task ${n}\n`).join("") + "## Done\n- [x] pr9 - Review nine\n- [x] pr10 - Review ten\n";
    await writeFile(path, original);
    const hourAgo = new Date(Date.now() - 3_600_000); await utimes(path, hourAgo, hourAgo);
    const opened = await readTextFile(dir, "data/backlog.md");
    await writeFile(path, current);
    for (const force of [false, true]) await expect(writeTextFile(dir, {
      path: "data/backlog.md", content: original, expectedHash: opened.hash, force,
    })).rejects.toBeInstanceOf(FileChangedError);
    const reviewed = await readTextFile(dir, "data/backlog.md");
    const losses = fileLosses(current, original);
    expect(losses).toHaveLength(12);
    await expect(writeTextFile(dir, { path: "data/backlog.md", content: original, expectedHash: reviewed.hash, force: true })).rejects.toThrow(/Review what will change/);
    expect(await readFile(path, "utf8")).toBe(current);
    await writeTextFile(dir, { path: "data/backlog.md", content: original, expectedHash: reviewed.hash, force: true, reviewedLosses: losses });
    const recovery = join(dir, "recall/files/data/backlog.md");
    expect(await readFile(join(recovery, `${fileHash(current)}.bin`), "utf8")).toBe(current);
    const events = await Promise.all((await readdir(join(recovery, "history"))).map(name => readFile(join(recovery, "history", name), "utf8").then(JSON.parse)));
    expect(events).toContainEqual(expect.objectContaining({ before: fileHash(current), after: fileHash(original), actor: "files", force: true, status: "saved" }));
    // A later save invalidates the reviewed current copy, even with the old acknowledgement.
    await writeFile(path, current + "- [ ] newest - Do not lose me\n");
    await expect(writeTextFile(dir, { path: "data/backlog.md", content: original, expectedHash: reviewed.hash, force: true, reviewedLosses: losses })).rejects.toBeInstanceOf(FileChangedError);
  });

  it("refuses different bytes with the same millisecond timestamp", async () => {
    const dir = await home(), path = join(dir, "data/backlog.md");
    const opened = await readTextFile(dir, "data/backlog.md");
    const sameTime = new Date(opened.modifiedMs);
    await writeFile(path, "a different version\n"); await utimes(path, sameTime, sameTime);
    await expect(writeTextFile(dir, { path: "data/backlog.md", content: "old draft", expectedHash: opened.hash, force: false })).rejects.toBeInstanceOf(FileChangedError);
    expect(await readFile(path, "utf8")).toBe("a different version\n");
  });

  it.each(["beforeCapture", "beforeInstall"] as const)("preserves an outside edit at %s and keeps exact previous bytes", async boundary => {
    const dir = await home(), path = join(dir, "data/backlog.md");
    const opened = await readTextFile(dir, "data/backlog.md");
    const external = Buffer.from("\uFEFF## In flight\r\n- [ ] latest - Latest work\r\n");
    await expect(writeTextFile(dir, { path: "data/backlog.md", content: "my draft", expectedHash: opened.hash, force: false }, {
      [boundary]: () => writeFile(path, external),
    })).rejects.toBeInstanceOf(FileChangedError);
    expect(await readFile(path)).toEqual(external);
    const recovery = join(dir, "recall/files/data/backlog.md");
    expect(await readFile(join(recovery, `${opened.hash}.bin`), "utf8")).toBe(opened.content);
    if (boundary === "beforeCapture") expect(await readFile(join(recovery, `${fileHash(external)}.bin`))).toEqual(external);
    expect((await readdir(join(dir, "data"))).sort()).toEqual(["backlog.md", "fix-login"]);
  });

  it("bounds recovery copies to 50 and keeps a bounded before/after audit without the optional journal", async () => {
    const dir = await home();
    for (let n = 0; n < 53; n++) {
      const opened = await readTextFile(dir, "data/backlog.md");
      await writeTextFile(dir, { path: "data/backlog.md", content: `version ${n}`, expectedHash: opened.hash, force: false });
    }
    const recovery = join(dir, "recall/files/data/backlog.md");
    expect((await readdir(recovery)).filter(name => name.endsWith(".bin"))).toHaveLength(50);
    expect(await readFile(join(recovery, `${fileHash("version 51")}.bin`), "utf8")).toBe("version 51");
    expect(await readdir(join(recovery, "history"))).toHaveLength(100);
  });

  it("stops before replacing a record if its previous bytes cannot be saved", async () => {
    const dir = await home(), path = join(dir, "data/backlog.md");
    const opened = await readTextFile(dir, "data/backlog.md");
    await writeFile(join(dir, "recall"), "a file blocks the recovery directory");
    await expect(writeTextFile(dir, { path: "data/backlog.md", content: "my draft", expectedHash: opened.hash, force: false })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(opened.content);
    expect((await readdir(join(dir, "data"))).sort()).toEqual(["backlog.md", "fix-login"]);
  });

  it("saves over the version it opened, and refuses one that changed since even when forced", async () => {
    const dir = await home();
    const opened = await readTextFile(dir, "data/backlog.md");
    const saved = await writeTextFile(dir, {
      path: "data/backlog.md",
      content: "mine",
      expectedHash: opened.hash,
      force: false,
    });
    expect(await readFile(join(dir, "data", "backlog.md"), "utf8")).toBe("mine");

    // The first mate writes the file after the editor opened it.
    await writeFile(join(dir, "data", "backlog.md"), "theirs");
    const later = new Date(saved.modifiedMs + 5000);
    await utimes(join(dir, "data", "backlog.md"), later, later);
    await expect(
      writeTextFile(dir, { path: "data/backlog.md", content: "mine again", expectedHash: saved.hash, force: false }),
    ).rejects.toThrow(/changed since you opened it/);
    expect(await readFile(join(dir, "data", "backlog.md"), "utf8")).toBe("theirs");

    await expect(writeTextFile(dir, { path: "data/backlog.md", content: "mine again", expectedHash: saved.hash, force: true })).rejects.toBeInstanceOf(FileChangedError);
    const reviewed = await readTextFile(dir, "data/backlog.md");
    await writeTextFile(dir, { path: "data/backlog.md", content: "mine again", expectedHash: reviewed.hash, force: true });
    expect(await readFile(join(dir, "data", "backlog.md"), "utf8")).toBe("mine again");
  });

  it("refuses a save the first mate beats while it is being staged, and leaves no temporary file", async () => {
    const dir = await home();
    const path = join(dir, "data", "backlog.md");
    const opened = await readTextFile(dir, "data/backlog.md");
    const save = writeTextFile(
      dir,
      { path: "data/backlog.md", content: "mine", expectedHash: opened.hash, force: false },
      {
        afterStaging: async () => {
          await writeFile(path, "theirs");
          const later = new Date(opened.modifiedMs + 5000);
          await utimes(path, later, later);
        },
      },
    );
    await expect(save).rejects.toBeInstanceOf(FileChangedError);
    await expect(save).rejects.toThrow(/changed since you opened it/);
    expect(await readFile(path, "utf8")).toBe("theirs");
    expect((await readdir(join(dir, "data"))).sort()).toEqual(["backlog.md", "fix-login"]);
  });

  it("refuses creating a file the first mate creates while it is being staged", async () => {
    const dir = await home();
    const path = join(dir, "notes.md");
    const save = writeTextFile(
      dir,
      { path: "notes.md", content: "mine", expectedHash: null, force: false },
      { afterStaging: () => writeFile(path, "theirs") },
    );
    await expect(save).rejects.toThrow(/already exists/);
    expect(await readFile(path, "utf8")).toBe("theirs");
  });

  it("lets only one of two saves opened at the same version replace the file", async () => {
    const dir = await home();
    // Opened well before the saves, so each save's new mtime differs from it.
    const earlier = new Date(Date.now() - 60_000);
    await utimes(join(dir, "data", "backlog.md"), earlier, earlier);
    const opened = await readTextFile(dir, "data/backlog.md");
    const contents = ["first", "second"];
    const results = await Promise.allSettled(
      contents.map((content) =>
        writeTextFile(dir, { path: "data/backlog.md", content, expectedHash: opened.hash, force: false }),
      ),
    );
    // Either may reach the queue first; exactly one wins, and the file is the winner's.
    const winners = contents.filter((_, index) => results[index]?.status === "fulfilled");
    expect(winners).toHaveLength(1);
    expect(await readFile(join(dir, "data", "backlog.md"), "utf8")).toBe(winners[0]);
    expect((await readdir(join(dir, "data"))).sort()).toEqual(["backlog.md", "fix-login"]);
  });

  it("keeps a saved file's mode, so a watch script edited in the panel stays executable", async () => {
    const dir = await home();
    await mkdir(join(dir, "watches"));
    const script = join(dir, "watches", "demo");
    await writeFile(script, "#!/usr/bin/env node\n// schedule: * * * * *\n// echo one\n");
    await chmod(script, 0o755);
    await chmod(join(dir, "data", "backlog.md"), 0o640);
    const scriptMode = (await stat(script)).mode & 0o777;
    const backlogMode = (await stat(join(dir, "data", "backlog.md"))).mode & 0o777;

    const opened = await readTextFile(dir, "watches/demo");
    await writeTextFile(dir, {
      path: "watches/demo",
      content: "#!/usr/bin/env node\n// schedule: * * * * *\n// echo two\n",
      expectedHash: opened.hash,
      force: false,
    });
    expect(await readFile(script, "utf8")).toContain("echo two");
    expect((await stat(script)).mode & 0o777).toBe(scriptMode);
    expect((await listWatches(dir))[0]).toMatchObject({ name: "demo", invalid: null });

    const backlog = await readTextFile(dir, "data/backlog.md");
    await writeTextFile(dir, { path: "data/backlog.md", content: "x", expectedHash: backlog.hash, force: false });
    expect((await stat(join(dir, "data", "backlog.md"))).mode & 0o777).toBe(backlogMode);

    // A new file gets the default, which is never executable.
    await writeTextFile(dir, { path: "watches/new", content: "#!/bin/sh\n", expectedHash: null, force: false });
    expect((await stat(join(dir, "watches", "new"))).mode & 0o111).toBe(0);
  });

  it("creates a new file, folders and all, but never over an existing one", async () => {
    const dir = await home();
    await writeTextFile(dir, { path: "notes/today.md", content: "hi", expectedHash: null, force: false });
    expect(await readFile(join(dir, "notes", "today.md"), "utf8")).toBe("hi");
    await expect(
      writeTextFile(dir, { path: "AGENTS.md", content: "x", expectedHash: null, force: false }),
    ).rejects.toThrow(/already exists/);
    await expect(
      writeTextFile(dir, { path: "../escape.md", content: "x", expectedHash: null, force: false }),
    ).rejects.toThrow(/outside the home/);
  });
});

describe("findFiles", () => {
  it("maps each existing file in the home to its home-relative path, relative or absolute", async () => {
    const dir = await home();
    const found = await findFiles(dir, [
      "AGENTS.md",
      "./data/backlog.md",
      join(dir, "data", "fix-login", "brief.md"),
      "data/missing.md",
      "data",
    ]);
    expect(found).toEqual({
      "AGENTS.md": "AGENTS.md",
      "./data/backlog.md": "data/backlog.md",
      [join(dir, "data", "fix-login", "brief.md")]: "data/fix-login/brief.md",
    });
  });

  it("finds nothing outside the home, by .., by an absolute path, or through a symlink", async () => {
    const dir = await home();
    const outside = await mkdtemp(join(tmpdir(), "firstmate-outside-"));
    tempDirs.push(outside);
    await writeFile(join(outside, "secret.md"), "secret");
    // Windows junctions exercise the same containment check without requiring
    // administrator privileges or Developer Mode for a file symlink.
    if (process.platform !== "win32") await symlink(join(outside, "secret.md"), join(dir, "data", "link.md"));
    await symlink(outside, join(dir, "elsewhere"), process.platform === "win32" ? "junction" : "dir");
    const found = await findFiles(dir, [
      "../secret.md",
      "data/../../secret.md",
      join(outside, "secret.md"),
      "data/link.md",
      "elsewhere/secret.md",
      `${dir}/../${outside.split("/").pop() ?? ""}/secret.md`,
    ]);
    expect(found).toEqual({});
  });
});

describe("replaceTextIfUnchanged", () => {
  it("replaces a file that still reads as expected", async () => {
    const dir = await home();
    await replaceTextIfUnchanged(dir, "data/backlog.md", "## In flight\n", "mine");
    expect(await readFile(join(dir, "data", "backlog.md"), "utf8")).toBe("mine");
  });

  it("refuses other contents even with the same modification time", async () => {
    const dir = await home();
    const path = join(dir, "data", "backlog.md");
    const { mtime } = await stat(path);
    await writeFile(path, "theirs\n");
    await utimes(path, mtime, mtime);
    await expect(replaceTextIfUnchanged(dir, "data/backlog.md", "## In flight\n", "mine")).rejects.toBeInstanceOf(
      FileChangedError,
    );
    expect(await readFile(path, "utf8")).toBe("theirs\n");
  });

  it("refuses when the file is rewritten or deleted while the replacement is staged", async () => {
    const dir = await home();
    const path = join(dir, "data", "backlog.md");
    await expect(
      replaceTextIfUnchanged(dir, "data/backlog.md", "## In flight\n", "mine", {
        afterStaging: () => writeFile(path, "theirs\n"),
      }),
    ).rejects.toBeInstanceOf(FileChangedError);
    expect(await readFile(path, "utf8")).toBe("theirs\n");

    await expect(
      replaceTextIfUnchanged(dir, "data/backlog.md", "theirs\n", "mine", { afterStaging: () => rm(path) }),
    ).rejects.toBeInstanceOf(FileChangedError);
    expect((await readdir(join(dir, "data"))).sort()).toEqual(["fix-login"]);
  });
});
