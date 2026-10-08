import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SavedHosts, type RemoteProfile } from "../shared/remotes";
import { commandArguments, connectionTarget, redact, remoteEnvironment, remoteError, RemoteService } from "./remotes";
import { fill, readTemplate, TEMPLATES } from "./templates";

const run = promisify(execFile);
const local: RemoteProfile = { serverId: "local-test", label: "Atlas", connections: [{ id: "local", type: "directTcp", endpoint: "127.0.0.1:6799" }] };
const remote: RemoteProfile = { serverId: "remote-test", label: "Remote", password: "private-test-secret", connections: [{ id: "direct", type: "directTcp", endpoint: "remote:6767" }, { id: "fallback", type: "directTcp", endpoint: "fallback:6767" }] };
let root = "";
let service: RemoteService | undefined;
afterEach(async () => {
  service?.stop(); service = undefined;
  await new Promise((done) => setTimeout(done, 30));
  if (root) await rm(root, { recursive: true, force: true });
  root = ""; vi.unstubAllEnvs();
});
async function fixture(execute: ConstructorParameters<typeof RemoteService>[0]) {
  root = await mkdtemp(join(tmpdir(), "firstmate-remotes-"));
  vi.stubEnv("PASEO_HOME", root);
  await writeFile(join(root, "server-id"), local.serverId);
  const directory = join(root, "plugin-data", "firstmate");
  const home = join(directory, "home");
  await mkdir(join(home, "data"), { recursive: true });
  await mkdir(join(home, "tools"));
  await writeFile(join(home, "AGENTS.md"), "# Isolated fixture\n");
  await writeFile(join(directory, "config.json"), JSON.stringify({ home }));
  service = new RemoteService(execute);
  await service.sync([local, remote]);
  return { directory, home, service };
}
const success = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });

describe("independent remote access", () => {
  it("projects only connection fields and rejects unknown formats and duplicate hosts", () => {
    const hosts = SavedHosts.parse([{ ...remote, appearance: { secret: "ignored" } }]);
    expect(hosts[0]).not.toHaveProperty("appearance");
    expect(SavedHosts.safeParse([{ ...remote, connections: [{ type: "new-format" }] }]).success).toBe(false);
    expect(SavedHosts.safeParse([remote, remote]).success).toBe(false);
  });
  it("supports encrypted relay offers and isolates local identity and credentials", () => {
    const target = connectionTarget(remote, { id: "relay", type: "relay", relayEndpoint: "relay.paseo.sh:443", useTls: true, daemonPublicKeyB64: "key" });
    expect(JSON.parse(Buffer.from(target.split("#offer=")[1]!, "base64url").toString())).toMatchObject({ v: 2, serverId: remote.serverId, daemonPublicKeyB64: "key", relay: { useTls: true } });
    const env = remoteEnvironment(remote, target, { PASEO_HOME: "local", paseo_password: "wrong", PASEO_AGENT_ID: "local-agent", PASEO_WORKSPACE_ID: "local-workspace", PATH: "path" });
    expect(env).toEqual({ PATH: "path", PASEO_HOST: target, PASEO_PASSWORD: remote.password });
    expect(connectionTarget(remote, { id: "ssh", type: "remoteSsh", host: "user@server", sshPort: 2222, daemonPort: 7777 })).toBe("ssh://user@server:2222?daemonPort=7777");
  });
  it("rejects target overrides and injects stable ownership on remote runs", () => {
    expect(() => commandArguments(["ls", "--host=other"], "owner")).toThrow("overridden");
    expect(() => commandArguments(["project", "ls", "--home", "elsewhere"], "owner")).toThrow("overridden");
    expect(() => commandArguments(["run", "brief", "--label", "firstmate.owner=someone"], "owner")).toThrow("Reserved");
    expect(() => commandArguments(["restart"], "owner")).toThrow("Unsupported");
    expect(commandArguments(["run", "brief"], "owner")).toContain("firstmate.owner=owner");
  });
  it("keeps credentials outside the public snapshot, retains access across restarts, and removes forgotten hosts", async () => {
    const { directory, home, service: first } = await fixture(async () => success({}));
    expect(await readFile(join(directory, "remotes.json"), "utf8")).toContain(remote.password);
    expect(await readFile(join(home, "data", "remote-hosts.json"), "utf8")).not.toContain(remote.password);
    first.stop(); service = new RemoteService(async () => success({}));
    expect((await service.read()).hosts.map((host) => host.serverId)).toEqual([remote.serverId]);
    await expect(service.sync([remote])).rejects.toThrow("local host");
    expect((await service.read()).hosts).toHaveLength(1);
    await service.sync([local]);
    expect((await service.read()).hosts).toEqual([]);
    expect(await readFile(join(directory, "remotes.json"), "utf8")).not.toContain(remote.password);
  });
  it("checks host identity, retries only read probes, and never retries a failed creation", async () => {
    const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const { service } = await fixture(async (args, env) => {
      calls.push({ args, env });
      if (args[0] === "status") return success({ serverId: env.PASEO_HOST?.includes("fallback") ? remote.serverId : "wrong-server", connectedDaemon: "reachable" });
      return { code: 1, stdout: "", stderr: "Network failure after creation" };
    });
    await expect(service.request("Remote", ["run", "brief"])).rejects.toThrow("Remote command failed");
    expect(calls.filter((call) => call.args[0] === "run")).toHaveLength(1);
    const creation = calls.find((call) => call.args[0] === "run")!;
    expect(creation.env.PASEO_HOST).toContain("fallback");
    expect(creation.args).toContain("firstmate.owner=local-test:firstmate");
    expect(creation.env.PASEO_HOME).toBeUndefined();
  });
  it("collects remote workers and their completion replies without an app connection", async () => {
    const { service } = await fixture(async (args) => {
      if (args[0] === "status") return success({ serverId: remote.serverId, connectedDaemon: "reachable" });
      if (args[0] === "project") return success([{ projectId: "p", path: "/remote/repo", password: "discard" }]);
      if (args[0] === "workspace") return success([{ workspaceId: "w", path: "/remote/repo" }]);
      if (args[0] === "provider") return success([{ id: "claude" }]);
      if (args[0] === "ls") { expect(args).toContain("firstmate.owner=local-test:firstmate"); return success([{ id: "worker", name: "Fix", status: "idle" }]); }
      if (args[0] === "inspect") return success({ Id: "worker", Status: "idle", UpdatedAt: "now", PendingPermissions: [] });
      return { code: 0, stdout: "done: PR https://github.com/test/repo/pull/1\n", stderr: "" };
    });
    await service.poll();
    const snapshot = await service.read();
    expect(snapshot.hosts[0]).toMatchObject({ online: true, projects: [{ projectId: "p", path: "/remote/repo" }], workers: [{ id: "worker", status: "idle", permissions: 0 }] });
    expect(snapshot.hosts[0]?.workers[0]?.output).toContain("done: PR");
    expect(JSON.stringify(snapshot)).not.toContain("discard");
  });
  it("keeps a prompt after -- out of the option checks and injects flags before it", () => {
    expect(commandArguments(["run", "--cwd", "C:\\repo", "--", "--home is a word in this brief"], "owner")).toEqual(["run", "--cwd", "C:\\repo", "--background", "--label", "firstmate.role=crew", "--label", "firstmate.owner=owner", "--json", "--", "--home is a word in this brief"]);
    expect(commandArguments(["send", "agent", "--", "- guidance"], "owner")).toEqual(["send", "agent", "--no-wait", "--json", "--", "- guidance"]);
    expect(() => commandArguments(["send", "agent", "--prompt-file", "C:\\anywhere.txt"], "owner")).toThrow("helper's --prompt-file");
    expect(() => commandArguments(["run", "--host", "x", "--", "brief"], "owner")).toThrow("overridden");
  });
  it("returns the remote CLI's own error, redacted, and keeps the authentication mapping", async () => {
    const relayHost: RemoteProfile = { ...remote, connections: [...remote.connections, { id: "relay", type: "relay", relayEndpoint: "relay.example.test:443", daemonPublicKeyB64: "public-key-value" }] };
    expect(redact(`pw ${remote.password} link https://app.paseo.sh/#offer=abc relay wss://relay.example.test:443/ws?x=1 key public-key-value paseo.bearer.token`, relayHost))
      .toBe("pw [redacted] link [pairing link] relay [relay URL] key [redacted] [credential]");
    expect(remoteError({ code: 1, stdout: "", stderr: JSON.stringify({ error: { code: "X", message: "Working directory does not exist: C:Usersrepo", details: "Check --cwd" } }, null, 2) }))
      .toBe("Working directory does not exist: C:Usersrepo\nCheck --cwd");
    expect(remoteError({ code: 1, stdout: "plain stdout complaint\n", stderr: "  " })).toBe("plain stdout complaint");
    expect(remoteError({ code: 1, stdout: "", stderr: "x".repeat(5000) }).length).toBeLessThan(1600);
    let stderr = "";
    const { service } = await fixture(async (args) => args[0] === "status" ? success({ serverId: remote.serverId, connectedDaemon: "reachable" }) : { code: 1, stdout: "", stderr });
    stderr = JSON.stringify({ error: { code: "SEND_FAILED", message: `Failed to send message: Agent not found: abc (via https://app.paseo.sh/#offer=secret, ${remote.password})` } });
    const error = await service.request("Remote", ["send", "abc", "hi"]).catch((e: Error) => e.message);
    expect(error).toBe("Remote command failed: Failed to send message: Agent not found: abc (via [pairing link], [redacted])");
    stderr = JSON.stringify({ error: { code: "AUTH", message: "Incorrect password" } });
    await expect(service.request("Remote", ["ls"])).rejects.toThrow("Remote authentication failed; reconnect this host in Paseo");
  });
  it("names the last probe failure when no saved connection answers", async () => {
    const { service } = await fixture(async () => ({ code: 1, stdout: "", stderr: JSON.stringify({ error: { message: "connect ECONNREFUSED 10.0.0.2:6767" } }) }));
    await expect(service.request("Remote", ["ls"])).rejects.toThrow("(last attempt: connect ECONNREFUSED 10.0.0.2:6767)");
  });
  it("sends a brief from a home file, shows pending tool calls, and prints times as reported", async () => {
    const calls: string[][] = [];
    const { directory, home, service } = await fixture(async (args) => {
      if (args[0] === "status") return success({ serverId: remote.serverId, connectedDaemon: "reachable" });
      calls.push(args);
      if (args[0] === "permit") return success([{ id: "req-1", agentId: "agent-1", agentShortId: "agent-1", name: "Bash", description: "-" }]);
      if (args[0] === "logs") return { code: 0, stdout: "[Read] notes.md\n[Shell] npm test -- --run\n", stderr: "" };
      if (args[0] === "inspect") return success({ Id: "agent-1", UpdatedAt: "2026-10-08T09:09:42.199Z", Name: "2026-10-08T09:09:42.199Z is a title" });
      return success({ ok: true });
    });
    const helper = join(home, "tools", "remote.mjs");
    await writeFile(helper, fill(await readTemplate(TEMPLATES.remoteHelper), { remoteQueueJson: JSON.stringify(join(directory, "remote-requests")) }));
    service.start();
    const brief = "- Start here.\nWork in C:\\Users\\captain\\repo\\src and keep \\\\server\\share as written.\n";
    await mkdir(join(home, "data", "task"), { recursive: true });
    await writeFile(join(home, "data", "task", "brief.md"), `\uFEFF${brief}`);
    const cwd = "C:\\Users\\captain\\repo";
    await run(process.execPath, [helper, remote.serverId, "run", "--prompt-file", "data/task/brief.md", "--cwd", cwd, "--provider", "claude/opus"], { cwd: home, timeout: 10000 });
    expect(calls.at(-1)).toEqual(["run", "--cwd", cwd, "--provider", "claude/opus", "--background", "--label", "firstmate.role=crew", "--label", "firstmate.owner=local-test:firstmate", "--json", "--", brief]);
    await writeFile(join(home, "data", "task", "send.json"), JSON.stringify({ host: "Remote", args: ["send", "agent-1", "--prompt-file", join(home, "data", "task", "brief.md")] }));
    await run(process.execPath, [helper, "--request-file", join(home, "data", "task", "send.json")], { cwd: home, timeout: 10000 });
    expect(calls.at(-1)).toEqual(["send", "agent-1", "--no-wait", "--json", "--", brief]);

    const sent = calls.length;
    const refused = async (args: string[], message: string) => {
      const failure = await run(process.execPath, [helper, remote.serverId, ...args], { cwd: home, timeout: 10000 }).then(() => null, (error: { stderr: string }) => error.stderr);
      expect(failure).toContain(message);
    };
    await writeFile(join(root, "outside.md"), "not in the home");
    await refused(["run", "--prompt-file", join(root, "outside.md")], "inside the first mate's home");
    await refused(["send", "agent-1", "extra words", "--prompt-file", "data/task/brief.md"], "send takes only the agent ID");
    await refused(["run", "inline brief", "--prompt-file", "data/task/brief.md"], "run takes no prompt argument");
    await refused(["inspect", "agent-1", "--prompt-file", "data/task/brief.md"], "for run and send");
    await refused(["run", "brief", "--cwd", "C:Userscaptainrepo"], "lost its backslashes");
    expect(calls).toHaveLength(sent);

    const permits = JSON.parse((await run(process.execPath, [helper, "Remote", "permit", "ls"], { timeout: 10000 })).stdout);
    expect(permits).toEqual([{ id: "req-1", agentId: "agent-1", agentShortId: "agent-1", name: "Bash", description: "-", recentTools: ["[Read] notes.md", "[Shell] npm test -- --run"] }]);
    expect(calls.at(-1)).toEqual(["logs", "agent-1", "--filter", "tools", "--tail", "3", "--json"]);

    const inspected = await run(process.execPath, [helper, "Remote", "inspect", "agent-1"], { timeout: 10000 });
    expect(JSON.parse(inspected.stdout)).toMatchObject({ UpdatedAt: "2026-10-08T09:09:42.199Z", Name: "2026-10-08T09:09:42.199Z is a title" });
    expect(inspected.stderr).toBe("");
  }, 60000);
  it("measures a host's clock from a new worker's CreatedAt and warns while it is off", async () => {
    let behindMs = 59 * 60000;
    let inspectFails = false;
    const { directory, home, service } = await fixture(async (args) => {
      if (args[0] === "status") return success({ serverId: remote.serverId, connectedDaemon: "reachable" });
      if (args[0] === "run") return success({ agentId: "new-agent", status: "running" });
      if (args[0] === "inspect" && inspectFails) return { code: 1, stdout: "", stderr: "busy" };
      if (args[0] === "inspect") return success({ Id: args[1], CreatedAt: new Date(Date.now() - behindMs).toISOString(), UpdatedAt: "2026-10-08T09:02:30.413Z" });
      return success([]);
    });
    const helper = join(home, "tools", "remote.mjs");
    await writeFile(helper, fill(await readTemplate(TEMPLATES.remoteHelper), { remoteQueueJson: JSON.stringify(join(directory, "remote-requests")) }));
    service.start();
    const dispatched = await run(process.execPath, [helper, "Remote", "run", "brief"], { cwd: home, timeout: 10000 });
    expect(JSON.parse(dispatched.stdout)).toEqual({ agentId: "new-agent", status: "running" });
    expect(dispatched.stderr).toContain(`host "Remote"'s clock appears to be about 59 minutes behind this machine's (agent new-agent's CreatedAt`);
    const skew = (await service.read()).hosts[0]!.clockSkew!;
    expect(skew.agentId).toBe("new-agent");
    expect(skew.seconds).toBeLessThanOrEqual(-59 * 60 + 1);
    expect(skew.seconds).toBeGreaterThan(-60 * 60);

    // Later answers keep warning, and show the host's times untouched.
    const inspected = await run(process.execPath, [helper, "Remote", "inspect", "new-agent"], { cwd: home, timeout: 10000 });
    expect(JSON.parse(inspected.stdout).UpdatedAt).toBe("2026-10-08T09:02:30.413Z");
    expect(inspected.stderr).toContain("59 minutes behind");
    expect(JSON.parse(await readFile(join(home, "data", "remote-hosts.json"), "utf8")).hosts[0].clockSkew.seconds).toBe(skew.seconds);
    expect((await run(process.execPath, [helper, "hosts"], { cwd: home, timeout: 10000 })).stderr).toContain("59 minutes behind");

    // A failed measurement keeps the last one and never fails the run.
    inspectFails = true;
    await expect(service.request("Remote", ["run", "brief"])).resolves.toEqual({ agentId: "new-agent", status: "running" });
    expect((await service.read()).hosts[0]!.clockSkew!.seconds).toBe(skew.seconds);

    // A host whose clock agrees reads as no skew, and no warning.
    inspectFails = false; behindMs = 0;
    const fixed = await run(process.execPath, [helper, "Remote", "run", "brief"], { cwd: home, timeout: 10000 });
    expect(fixed.stderr).toBe("");
    expect((await service.read()).hosts[0]!.clockSkew!.seconds).toBe(0);
  }, 60000);
  it("executes a native terminal helper through the daemon queue", async () => {
    const { directory, home, service } = await fixture(async (args) => args[0] === "status" ? success({ serverId: remote.serverId, connectedDaemon: "reachable" }) : success([{ projectId: "remote-project" }]));
    const helper = join(home, "tools", "remote.mjs");
    await writeFile(helper, fill(await readTemplate(TEMPLATES.remoteHelper), { remoteQueueJson: JSON.stringify(join(directory, "remote-requests")) }));
    service.start();
    const input = join(home, "dispatch.json");
    await writeFile(input, JSON.stringify({ host: remote.serverId, args: ["project", "ls"] }));
    const result = await run(process.execPath, [helper, "--request-file", input], { timeout: 10000 });
    expect(JSON.parse(result.stdout)).toEqual([{ projectId: "remote-project" }]);
  }, 15000);
});
