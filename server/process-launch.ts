/**
 * Windows cannot spawn a .cmd file or execute a shebang. Launch Paseo's known
 * JavaScript entry points through a native Node runtime, keeping arguments out
 * of a shell. Unix continues to execute the original command.
 */
import { access, constants, open } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

export interface ProcessLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export function nodeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // The plugin's runtime can be Paseo.exe (Electron) rather than node.exe.
  return { ...env, ELECTRON_RUN_AS_NODE: "1" };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function paseoLaunch(
  cli: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ProcessLaunch> {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(extname(cli))) return { command: cli, args, env };

  // Desktop resources/bin/paseo.cmd: reproduce its native invocation.
  const resources = resolve(dirname(cli), "..");
  const executable = resolve(resources, "..", "Paseo.exe");
  const runner = join(resources, "app.asar.unpacked", "dist", "daemon", "node-entrypoint-runner.js");
  if (await exists(executable) && await exists(runner)) {
    return {
      command: executable,
      args: [
        "--disable-warning=DEP0040", runner, "node-script",
        join(resources, "app.asar", "node_modules", "@getpaseo", "cli", "dist", "index.js"),
        ...args,
      ],
      env: { ...nodeEnvironment(env), PASEO_NODE_ENV: "production", PASEO_DESKTOP_MANAGED: "1", PASEO_CLI: cli },
    };
  }

  // npm's global shim, or node_modules/.bin/paseo.cmd in a local install.
  const packageRoots = [
    join(dirname(cli), "node_modules", "@getpaseo", "cli"),
    join(dirname(cli), "..", "@getpaseo", "cli"),
  ];
  for (const root of packageRoots) {
    const entry = join(root, "bin", "paseo");
    if (await exists(entry)) return { command: process.execPath, args: [entry, ...args], env: nodeEnvironment(env) };
  }
  throw new Error(`Cannot launch ${basename(cli)} on Windows: the desktop or npm Paseo entry point was not found.`);
}

/** Windows watches run through the plugin's Node runtime. Other shebangs remain Unix-only. */
export function windowsWatchProblem(head: string): string | null {
  const line = head.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return /^#!\s*(?:\/usr\/bin\/env\s+)?node(?:\.exe)?\s*$/.test(line)
    ? null
    : "Windows watches need a #!/usr/bin/env node or #!node line";
}

export async function watchLaunch(path: string, env: NodeJS.ProcessEnv): Promise<ProcessLaunch> {
  if (process.platform !== "win32") return { command: path, args: [], env };
  const file = await open(path, "r");
  let head: string;
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    head = buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
  const problem = windowsWatchProblem(head);
  if (problem !== null) throw new Error(problem);
  return { command: process.execPath, args: [path], env: nodeEnvironment(env) };
}
