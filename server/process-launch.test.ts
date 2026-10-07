import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { paseoLaunch, windowsWatchProblem } from "./process-launch";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "firstmate CLI & "));
  roots.push(root);
  return root;
}
async function file(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
const echo = "console.log(JSON.stringify(process.argv.slice(2)));";
const args = ["project", "rename", "project-id", 'Release & "quoted" %HOME% ^ name', "--home", "a home with spaces"];

describe("Paseo launch", () => {
  it("runs the desktop CLI without cmd.exe, preserving spaces, quotes and shell characters", async () => {
    const root = await fixture();
    const cli = join(root, "resources", "bin", "paseo.cmd");
    await file(cli, "@echo off\r\n");
    await copyFile(process.execPath, join(root, "Paseo.exe"));
    await file(join(root, "resources", "app.asar.unpacked", "dist", "daemon", "node-entrypoint-runner.js"),
      'const [, entry, ...args] = process.argv.slice(2); process.argv = [process.argv[0], entry, ...args]; require(entry);');
    await file(join(root, "resources", "app.asar", "node_modules", "@getpaseo", "cli", "dist", "index.js"), echo);
    const launch = await paseoLaunch(cli, args, process.env, "win32");
    const { stdout } = await execute(launch.command, launch.args, { env: launch.env, windowsHide: true });
    expect(JSON.parse(stdout)).toEqual(args);
    expect(launch.env).toMatchObject({ ELECTRON_RUN_AS_NODE: "1", PASEO_CLI: cli, PASEO_DESKTOP_MANAGED: "1" });
  });

  it.each(["global", "local"])("runs an npm %s shim through Node", async (kind) => {
    const root = await fixture();
    const cli = kind === "global" ? join(root, "paseo.cmd") : join(root, "node_modules", ".bin", "paseo.cmd");
    const packageRoot = join(root, "node_modules", "@getpaseo", "cli");
    await file(cli, "@echo off\r\n");
    await file(join(packageRoot, "bin", "paseo"), echo);
    const launch = await paseoLaunch(cli, args, process.env, "win32");
    const { stdout } = await execute(launch.command, launch.args, { env: launch.env, windowsHide: true });
    expect(JSON.parse(stdout)).toEqual(args);
  });

  it("explains an unsupported Windows wrapper instead of spawning a batch file", async () => {
    await expect(paseoLaunch(join(await fixture(), "paseo.cmd"), [], {}, "win32")).rejects.toThrow(/entry point was not found/);
  });

  it("preserves native executables and Unix launchers", async () => {
    const env = { PATH: "example" };
    expect(await paseoLaunch("paseo.exe", args, env, "win32")).toEqual({ command: "paseo.exe", args, env });
    expect(await paseoLaunch("paseo", args, env, "linux")).toEqual({ command: "paseo", args, env });
  });
});

describe("Windows watch headers", () => {
  it("accepts Node shebangs with Windows line endings and explains unsupported interpreters", () => {
    expect(windowsWatchProblem("#!/usr/bin/env node\r\n// schedule: @hourly")).toBeNull();
    expect(windowsWatchProblem("#!node\n")).toBeNull();
    expect(windowsWatchProblem("#!node.exe\n")).toBeNull();
    expect(windowsWatchProblem("#!/bin/sh\n")).toMatch(/Windows watches need/);
    expect(windowsWatchProblem("#!/usr/bin/env node --eval anything\n")).toMatch(/Windows watches need/);
  });
});
