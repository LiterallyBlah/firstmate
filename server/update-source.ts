/** Read-only source discovery. Never inspect the daemon cwd or the primary checkout. */
import { execFile } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import {
  PluginListItemSchema,
  PluginUpdatePreviewSchema,
} from "./update-contracts";
import { z } from "zod";
import { runPaseo } from "./cli";
import { paseoHome, PLUGIN_ID } from "./data-dir";

export interface InstalledSource {
  path: string;
  identity: string;
  revision: string;
  description: string;
  directory?: { remote: string; ref: string; root: string };
}

async function git(path: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", path, ...args],
      {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
        },
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    );
  });
}

async function cli(args: string[]): Promise<string> {
  const result = await runPaseo(
    ["plugin", ...args, "--home", paseoHome(), "--json"],
    process.env,
  );
  // Do not expose raw process errors: source URLs and credential helpers can contain secrets.
  if (result.code !== 0)
    throw new Error("FirstMate update check could not reach its source.");
  return result.stdout;
}

/** Credential-bearing URLs cannot become chat text. Keep authentication in Git's own config. */
function publicRemote(remote: string): string {
  if (/^[a-z]+:\/\//i.test(remote)) {
    const url = new URL(remote);
    if (
      (url.username && url.protocol !== "ssh:") ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Source identity contains private URL details.");
  }
  if (/[\r\n]/.test(remote)) throw new Error("Invalid source identity.");
  return remote;
}

export async function installedSource(): Promise<InstalledSource> {
  const plugins = z
    .array(PluginListItemSchema)
    .parse(JSON.parse(await cli(["ls"])));
  const plugin = plugins.find((entry) => entry.id === PLUGIN_ID);
  if (!plugin || plugin.status !== "running")
    throw new Error("Running FirstMate installation is unknown.");
  const installation = plugin.installation;
  if (installation && installation.identity.kind !== "directory") {
    const identity = installation.identity;
    if (identity.registry) publicRemote(identity.registry.url);
    const revision = installation.currentRevision;
    if (!revision) throw new Error("Installed revision is unknown.");
    if (identity.kind === "git") {
      publicRemote(identity.remote);
      // The host's acquisition metadata supplies identity, but an edited checkout is not that revision.
      if (
        await git(plugin.path, [
          "status",
          "--porcelain",
          "--untracked-files=normal",
        ])
      )
        throw new Error("Installed checkout has local changes.");
      if (
        (await git(plugin.path, ["rev-parse", "--verify", "HEAD"])) !== revision
      )
        throw new Error("Installed revision changed.");
    }
    const selector = plugin.ref ?? plugin.npm?.requestedSpec ?? null;
    return {
      path: resolve(plugin.path),
      revision,
      identity: JSON.stringify({ ...identity, selector }),
      description: identity.registry
        ? JSON.stringify(identity.registry)
        : identity.kind === "git"
          ? `${identity.remote} (${selector ?? "default HEAD"}), path ${identity.pluginPath}`
          : `${identity.packageName} (${selector ?? "latest"}), path ${identity.pluginPath}`,
    };
  }
  const path = resolve(plugin.path);
  const root = await git(path, ["rev-parse", "--show-toplevel"]);
  // An ignored npm package nested in some unrelated repository is not a directory Git installation.
  await git(path, ["ls-files", "--error-unmatch", "--", "paseo-plugin.json"]);
  if (await git(root, ["status", "--porcelain", "--untracked-files=normal"]))
    throw new Error("Installed checkout has local changes.");
  const revision = await git(root, ["rev-parse", "--verify", "HEAD"]);
  const branch = await git(root, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ]);
  const remoteName = await git(root, [
    "config",
    "--get",
    `branch.${branch}.remote`,
  ]);
  const ref = await git(root, ["config", "--get", `branch.${branch}.merge`]);
  if (!remoteName || remoteName === "." || !ref.startsWith("refs/heads/"))
    throw new Error("Installed checkout has no remote tracking branch.");
  const remote = publicRemote(
    await git(root, ["remote", "get-url", remoteName]),
  );
  const pluginPath = relative(root, path).split(sep).join("/") || ".";
  return {
    path,
    revision,
    identity: JSON.stringify({ kind: "directory", remote, ref, pluginPath }),
    description: `${remote} (${ref}), path ${pluginPath}`,
    directory: { remote, ref, root },
  };
}

export async function latestRevision(
  source: InstalledSource,
): Promise<{ revision: string; immutable: string; installedNewer?: boolean }> {
  if (source.directory) {
    const { remote, ref, root } = source.directory;
    const output = await git(root, [
      "ls-remote",
      "--exit-code",
      "--",
      remote,
      ref,
    ]);
    const entries = output.split(/\r?\n/).map((line) => line.split(/\s+/));
    const matches = entries.filter(
      (entry) => entry[1] === ref && /^[0-9a-f]{40,64}$/.test(entry[0] ?? ""),
    );
    if (matches.length !== 1)
      throw new Error("Configured branch revision is unknown.");
    const revision = matches[0]![0]!;
    return {
      revision,
      immutable: JSON.stringify({ kind: "git", commit: revision }),
    };
  }
  // --check returns before applyPluginUpdates. No target override, channel or credential changes.
  const parsedIdentity = JSON.parse(source.identity) as {
    selector: string | null;
    kind: string;
    registry?: unknown;
  };
  const selector = parsedIdentity.selector;
  const args = ["update", PLUGIN_ID, "--check"];
  if (selector && !parsedIdentity.registry)
    args.push(parsedIdentity.kind === "git" ? "--ref" : "--version", selector);
  const previews = z
    .array(PluginUpdatePreviewSchema)
    .parse(JSON.parse(await cli(args)));
  const preview = previews.find((entry) => entry.id === PLUGIN_ID);
  if (
    !preview ||
    !["current", "update", "installed-newer"].includes(preview.outcome) ||
    !preview.current ||
    !preview.target
  )
    throw new Error("Configured source could not be verified.");
  if (
    JSON.stringify({ ...preview.current.identity, selector }) !==
      source.identity ||
    preview.current.currentRevision !== source.revision
  )
    throw new Error("Installed source changed during the check.");
  const target = preview.target;
  if (preview.outcome === "installed-newer" && target.kind !== "npm")
    throw new Error("Unexpected source comparison.");
  if (target.kind === "npm") publicRemote(target.resolved);
  return {
    revision: target.kind === "git" ? target.commit : target.version,
    immutable: JSON.stringify(target),
    installedNewer: preview.outcome === "installed-newer",
  };
}
