import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installedSource, latestRevision } from "./update-source";

const { run, execute } = vi.hoisted(() => ({ run: vi.fn(), execute: vi.fn() }));
vi.mock("./cli", () => ({ runPaseo: run }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: (...args: unknown[]) => execute(...args),
}));
let temporary = "";
afterEach(async () => {
  vi.resetAllMocks();
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = "";
});
const sha = "a".repeat(40),
  target = "b".repeat(40);
function listing(identity: object, extra = {}) {
  return [
    {
      id: "firstmate",
      path: "/installed/firstmate",
      status: "running",
      enabled: true,
      installation: { identity, currentRevision: sha },
      ...extra,
    },
  ];
}
function result(value: unknown) {
  return { code: 0, stdout: JSON.stringify(value), stderr: "" };
}

describe("installed Paseo source contracts", () => {
  it("uses the configured fork, plugin path and explicit selector", async () => {
    execute.mockImplementation((_cmd, args, _options, callback) =>
      callback(null, args.includes("status") ? "" : sha, ""),
    );
    const identity = {
      kind: "git",
      remote: "https://example.org/captain/fork.git",
      pluginPath: "firstmate",
    };
    run.mockResolvedValueOnce(result(listing(identity, { ref: "release" })));
    const source = await installedSource();
    run.mockResolvedValueOnce(
      result([
        {
          id: "firstmate",
          outcome: "update",
          current: { identity, currentRevision: sha },
          target: { kind: "git", commit: target },
          links: [],
        },
      ]),
    );
    expect(await latestRevision(source)).toMatchObject({ revision: target });
    expect(run.mock.calls[1]?.[0]).toEqual([
      "plugin",
      "update",
      "firstmate",
      "--check",
      "--ref",
      "release",
      "--home",
      expect.any(String),
      "--json",
    ]);
    expect(source.description).toContain("captain/fork.git");
  });
  it("keeps registry pins in the host's read-only preview contract", async () => {
    execute.mockImplementation((_cmd, args, _options, callback) =>
      callback(null, args.includes("status") ? "" : sha, ""),
    );
    const identity = {
      kind: "git",
      remote: "https://example.org/fork.git",
      pluginPath: ".",
      registry: { url: "https://example.org", id: "captain/firstmate" },
    };
    run.mockResolvedValueOnce(result(listing(identity)));
    const source = await installedSource();
    run.mockResolvedValueOnce(
      result([
        {
          id: "firstmate",
          outcome: "current",
          current: { identity, currentRevision: sha },
          target: { kind: "git", commit: sha },
          links: [],
        },
      ]),
    );
    expect((await latestRevision(source)).revision).toBe(sha);
    expect(run.mock.calls[1]?.[0]).not.toContain("--ref");
  });
  it("fails closed on missing revision, bad preview, private URL or changed source", async () => {
    run.mockResolvedValueOnce(
      result([
        {
          id: "firstmate",
          path: "/installed",
          status: "running",
          enabled: true,
          installation: {
            identity: {
              kind: "git",
              remote: "https://example.org/fork",
              pluginPath: ".",
            },
          },
        },
      ]),
    );
    await expect(installedSource()).rejects.toThrow("revision");
    const identity = {
      kind: "git",
      remote: "https://token@example.org/fork",
      pluginPath: ".",
    };
    run.mockResolvedValueOnce(result(listing(identity)));
    await expect(installedSource()).rejects.toThrow("private");
    const source = {
      path: "/installed",
      identity: "{}",
      revision: sha,
      description: "fork",
    };
    run.mockResolvedValueOnce(
      result([
        { id: "firstmate", outcome: "error", links: [], error: "offline" },
      ]),
    );
    await expect(latestRevision(source)).rejects.toThrow("verified");
    run.mockResolvedValueOnce(
      result([
        {
          id: "firstmate",
          outcome: "update",
          links: [],
          current: {
            identity: {
              kind: "git",
              remote: "https://example.org/another-fork",
              pluginPath: ".",
            },
            currentRevision: sha,
          },
          target: { kind: "git", commit: target },
        },
      ]),
    );
    await expect(latestRevision(source)).rejects.toThrow("source changed");
  });
  it("uses the configured npm package and channel and retains the full immutable artifact identity", async () => {
    const identity = {
      kind: "npm",
      packageName: "@captain/firstmate",
      pluginPath: ".",
    };
    run.mockResolvedValueOnce(
      result(
        listing(identity, {
          npm: {
            packageName: "@captain/firstmate",
            requestedSpec: "beta",
            version: "1.0.0",
            integrity: "sha512-old",
          },
          installation: { identity, currentRevision: "1.0.0" },
        }),
      ),
    );
    const source = await installedSource();
    const artifact = {
      kind: "npm",
      version: "1.1.0-beta.1",
      resolved: "https://registry.example.org/firstmate.tgz",
      integrity: "sha512-immutable",
    };
    run.mockResolvedValueOnce(
      result([
        {
          id: "firstmate",
          outcome: "update",
          current: { identity, currentRevision: "1.0.0" },
          target: artifact,
          links: [],
        },
      ]),
    );
    const latest = await latestRevision(source);
    expect(JSON.parse(latest.immutable)).toEqual(artifact);
    expect(run.mock.calls[1]?.[0]).toContain("--version");
    expect(run.mock.calls[1]?.[0]).toContain("beta");
    expect(run.mock.calls[1]?.[0]).not.toContain("--yes");
  });
  it("reads the installed directory's upstream and uses ls-remote without fetching or moving it", async () => {
    const actual =
      await vi.importActual<typeof import("node:child_process")>(
        "node:child_process",
      );
    execute.mockImplementation(actual.execFile);
    temporary = await mkdtemp(join(tmpdir(), "firstmate-update-"));
    const remote = join(temporary, "fork.git"),
      installed = join(temporary, "installed"),
      publisher = join(temporary, "publisher");
    function git(args: string[], cwd = temporary) {
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    }
    git(["init", "--bare", remote]);
    git(["clone", remote, publisher]);
    git(["checkout", "-b", "release"], publisher);
    await mkdir(join(publisher, "firstmate"));
    await writeFile(join(publisher, "firstmate", "paseo-plugin.json"), "{}");
    await writeFile(join(publisher, "file"), "one");
    git(["add", "."], publisher);
    const commit = () =>
      git(
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.org",
          "commit",
          "-m",
          "fixture",
        ],
        publisher,
      );
    commit();
    git(["push", "origin", "release"], publisher);
    git(["clone", "--branch", "release", remote, installed]);
    run.mockResolvedValue(
      result([
        {
          id: "firstmate",
          path: join(installed, "firstmate"),
          status: "running",
          enabled: true,
          installation: {
            identity: { kind: "directory", path: join(installed, "firstmate") },
          },
        },
      ]),
    );
    const source = await installedSource();
    expect(source.directory?.ref).toBe("refs/heads/release");
    expect((await latestRevision(source)).revision).toBe(source.revision);
    await writeFile(join(publisher, "file"), "two");
    git(["add", "."], publisher);
    commit();
    git(["push", "origin", "release"], publisher);
    const latest = await latestRevision(source);
    expect(latest.revision).not.toBe(source.revision);
    expect(git(["rev-parse", "HEAD"], installed)).toBe(source.revision);
    expect(git(["rev-parse", "@{upstream}"], installed)).toBe(source.revision);
    await writeFile(join(installed, "file"), "edited");
    await expect(installedSource()).rejects.toThrow("local changes");
  });
});
