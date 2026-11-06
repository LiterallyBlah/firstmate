import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SavedHosts, type RemoteProfile } from "../shared/remotes";
import { commandArguments, connectionTarget, redact, remoteEnvironment, remoteError, remoteMutationAgent, RemoteConnectRefused, RemoteService } from "./remotes";
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
async function fixture(execute: ConstructorParameters<typeof RemoteService>[0], tasks?: ConstructorParameters<typeof RemoteService>[1], scopedGuard?: ConstructorParameters<typeof RemoteService>[3], workspaceGuard?: ConstructorParameters<typeof RemoteService>[4]) {
  root = await mkdtemp(join(tmpdir(), "firstmate-remotes-"));
  vi.stubEnv("PASEO_HOME", root);
  await writeFile(join(root, "server-id"), local.serverId);
  const directory = join(root, "plugin-data", "firstmate");
  const home = join(directory, "home");
  await mkdir(join(home, "data"), { recursive: true });
  await mkdir(join(home, "tools"));
  await writeFile(join(home, "AGENTS.md"), "# Isolated fixture\n");
  await writeFile(join(directory, "config.json"), JSON.stringify({ home }));
  service = new RemoteService(execute, tasks, undefined, scopedGuard, workspaceGuard);
  await service.sync([local, remote]);
  return { directory, home, service };
}
const SCOPED = "8552861a-dee4-4771-9968-a494a64d1a79", CREW = "c0ffee00-1111-4111-8111-111111111111";
const success = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });

describe("independent remote access", () => {
  it("retains minimal immutable action receipts, with a durable intent before submission", async () => {
    const actor = "10000000-0000-4000-8000-000000000001";
    const target = "20000000-0000-4000-8000-000000000002";
    let receiptDir = "";
    let fail = false;
    const intentsSeen: number[] = [];
    const { directory, home, service } = await fixture(async (args) => {
      if (args[0] === "status") return success({ serverId: remote.serverId, connectedDaemon: "reachable" });
      if (["run", "send", "archive", "stop"].includes(args[0]!)) {
        intentsSeen.push((await readdir(receiptDir)).filter((n) => n.endsWith(".started.json")).length);
        if (fail) return { code: 1, stdout: "", stderr: "private failure prose" };
        return success({ agentId: target, prose: "private result prose" });
      }
      return success({ Id: target, CreatedAt: new Date().toISOString() });
    });
    receiptDir = join(home, "data", "remote-action-receipts");
    const helper = join(home, "tools", "remote.mjs");
    await writeFile(helper, fill(await readTemplate(TEMPLATES.remoteHelper), { remoteQueueJson: JSON.stringify(join(directory, "remote-requests")) }));
    service.start();
    const env = { ...process.env, PASEO_AGENT_ID: actor };
    await run(process.execPath, [helper, "Remote", "run", "--label", "firstmate.task=receipt-test", "--", "private prompt --password=secret"], { env, timeout: 10000 });
    await run(process.execPath, [helper, "Remote", "send", target, "--", "--archive private steer"], { env, timeout: 10000 });
    await run(process.execPath, [helper, "Remote", "archive", target], { env, timeout: 10000 });
    fail = true;
    await expect(run(process.execPath, [helper, "Remote", "stop", target], { env, timeout: 10000 })).rejects.toThrow();
    const before = (await readdir(receiptDir)).sort();
    await run(process.execPath, [helper, "Remote", "inspect", target], { env, timeout: 10000 });
    await expect(run(process.execPath, [helper, "Remote", "constructor"], { env, timeout: 10000 })).rejects.toThrow();
    expect((await readdir(receiptDir)).sort()).toEqual(before);
    const raw = await Promise.all(before.map((n) => readFile(join(receiptDir, n), "utf8")));
    const rows = raw.map((s) => JSON.parse(s));
    expect(intentsSeen).toEqual([1, 2, 3, 4]);
    expect(rows.filter((r) => r.phase === "succeeded").map((r) => r.action).sort()).toEqual(["archive", "dispatch", "steer"]);
    expect(rows.filter((r) => r.phase === "failed")).toHaveLength(1);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["action", "actorId", "at", "phase", "requestId", "serverId", "targetId", "taskKey", "version"]);
      expect(r.actorId).toBe(actor);
      expect(r.serverId).toBe(remote.serverId);
    }
    expect(raw.join("")).not.toMatch(/private|secret|password|receipt-test|--archive/);
    expect(rows.find((r) => r.action === "dispatch" && r.phase === "succeeded").targetId).toBe(target);
    expect(rows.find((r) => r.action === "dispatch").taskKey).toMatch(/^[a-f0-9]{64}$/);
  }, 60000);
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
    expect((await first.read()).localLabel).toBe("Atlas");
    first.stop(); service = new RemoteService(async () => success({}));
    expect((await service.read()).localLabel).toBe("Atlas");
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
    expect(commandArguments(["run", "--cwd", "C:\\repo", "--", "--home is a word in this brief"], "owner")).toEqual(["run", "--cwd", "C:\\repo", "--no-wait", "--label", "firstmate.role=crew", "--label", "firstmate.owner=owner", "--json", "--", "--home is a word in this brief"]);
    expect(commandArguments(["send", "agent", "--", "- guidance"], "owner")).toEqual(["send", "agent", "--no-wait", "--json", "--", "- guidance"]);
    expect(() => commandArguments(["send", "agent", "--prompt-file", "C:\\anywhere.txt"], "owner")).toThrow("helper's --prompt-file");
    expect(() => commandArguments(["run", "--host", "x", "--", "brief"], "owner")).toThrow("overridden");
    expect(() => commandArguments(["permit", "allow", "agent", "--all"], "owner")).toThrow("one exact request");
    expect(() => commandArguments(["permit", "deny", "agent", "--all"], "owner")).toThrow("one exact request");
    expect(() => commandArguments(["permit", "deny", "agent", "--all=true"], "owner")).toThrow("one exact request");
    expect(() => commandArguments(["permit", "allow", "agent"], "owner")).toThrow("exact request ID");
    expect(() => commandArguments(["permit", "deny", "agent", "--message", "No."], "owner")).toThrow("exact request ID");
    expect(() => commandArguments(["permit", "allow"], "owner")).toThrow("exact request ID");
    expect(commandArguments(["permit", "ls"], "owner")).toEqual(["permit", "ls", "--json"]);
    expect(remoteMutationAgent(["send", "a1", "--json"])).toBe("a1");
    expect(remoteMutationAgent(["stop", "a2", "--json"])).toBe("a2");
    expect(remoteMutationAgent(["archive", "a3", "--json"])).toBe("a3");
    expect(remoteMutationAgent(["permit", "deny", "a4", "req", "--json"])).toBe("a4");
    expect(remoteMutationAgent(["permit", "ls", "--json"])).toBeNull();
    expect(remoteMutationAgent(["run", "brief"])).toBeNull();
    expect(remoteMutationAgent(["inspect", "a1"])).toBeNull();
    expect(commandArguments(["permit", "deny", "agent", "permission-1", "--message", "No."], "owner")).toEqual(["permit", "deny", "agent", "permission-1", "--message", "No.", "--json"]);
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
  it("records the remote daemon version, discovers by owner-filtered attempt label including archived, and marks connect refusals definite", async () => {
    const calls: string[][] = [];
    const attempt = "30000000-0000-4000-8000-000000000003";
    const { service } = await fixture(async (args) => {
      calls.push(args);
      if (args[0] === "status") return success({ serverId: remote.serverId, connectedDaemon: "reachable", daemonVersion: "0.14.0" });
      if (args[0] === "ls") return success([{ id: "worker-1", name: "Probe", status: "closed", cwd: "/home/ariadne/work", provider: "claude/claude-haiku-4-5", secret: "discard" }]);
      return success({});
    });
    const rows = await service.discoverByAttempt("Remote", `firstmate.attempt=${attempt}`);
    expect(rows).toEqual([{ id: "worker-1", name: "Probe", status: "closed", cwd: "/home/ariadne/work", provider: "claude/claude-haiku-4-5" }]);
    const listing = calls.find((args) => args[0] === "ls")!;
    expect(listing).toEqual(["ls", "-g", "-a", "--label", "firstmate.owner=local-test:firstmate", "--label", `firstmate.attempt=${attempt}`, "--json"]);
    expect((await service.hostInfo("Remote"))?.daemonVersion).toBe("0.14.0");
    await expect(service.discoverByAttempt("Remote", "firstmate.owner=someone")).rejects.toThrow("exact attempt label");
    await expect(service.request("Remote", ["ls", "-g", "-a", "--label", "firstmate.owner=local-test:firstmate"])).rejects.toThrow("Reserved");
    const refused = await fixture(async () => ({ code: 1, stdout: "", stderr: JSON.stringify({ error: { code: "DAEMON_UNREACHABLE", message: "connect ECONNREFUSED" } }) }));
    await expect(refused.service.request("Remote", ["run", "brief"])).rejects.toBeInstanceOf(RemoteConnectRefused);
  });
  it("the minute poll records the daemon version it observes and replaces a stale value after an upgrade", async () => {
    let daemonVersion = "0.14.0";
    const { service } = await fixture(async (args) => {
      if (args[0] === "status") return success({ serverId: remote.serverId, connectedDaemon: "reachable", daemonVersion });
      return success([]);
    });
    await service.poll();
    expect((await service.hostInfo("Remote"))?.daemonVersion).toBe("0.14.0");
    daemonVersion = "0.15.0";
    await service.poll();
    expect((await service.hostInfo("Remote"))?.daemonVersion).toBe("0.15.0");
    expect((await service.read()).hosts[0]?.daemonVersion).toBe("0.15.0");
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
    }, undefined, undefined, async () => {}); // No scoped worktrees here; the guards are covered below.
    const helper = join(home, "tools", "remote.mjs");
    await writeFile(helper, fill(await readTemplate(TEMPLATES.remoteHelper), { remoteQueueJson: JSON.stringify(join(directory, "remote-requests")) }));
    // This test counts helper commands, not the independent background collector.
    // A successful request schedules a fresh poll on the next one-second tick;
    // its four listing calls could otherwise race the refused-command assertion.
    // Keep the real queue pump; collection is exercised separately above.
    vi.spyOn(service, "poll").mockResolvedValue();
    service.start();
    const brief = "- Start here.\nWork in C:\\Users\\captain\\repo\\src and keep \\\\server\\share as written.\n";
    await mkdir(join(home, "data", "task"), { recursive: true });
    await writeFile(join(home, "data", "task", "brief.md"), `\uFEFF${brief}`);
    const cwd = "C:\\Users\\captain\\repo";
    await run(process.execPath, [helper, remote.serverId, "run", "--prompt-file", "data/task/brief.md", "--cwd", cwd, "--provider", "claude/opus"], { cwd: home, timeout: 10000 });
    expect(calls.at(-1)).toEqual(["run", "--cwd", cwd, "--provider", "claude/opus", "--no-wait", "--label", "firstmate.role=crew", "--label", "firstmate.owner=local-test:firstmate", "--json", "--", brief]);
    await writeFile(join(home, "data", "task", "send.json"), JSON.stringify({ host: "Remote", args: ["send", CREW, "--prompt-file", join(home, "data", "task", "brief.md")] }));
    await run(process.execPath, [helper, "--request-file", join(home, "data", "task", "send.json")], { cwd: home, timeout: 10000 });
    expect(calls.at(-1)).toEqual(["send", CREW, "--no-wait", "--json", "--", brief]);

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
  it("follows listed agents read-only, with their last message and what their permissions ask", async () => {
    const calls: string[][] = [];
    const { home, service } = await fixture(async (args) => {
      calls.push(args);
      if (args[0] === "status") return success({ serverId: remote.serverId, connectedDaemon: "reachable" });
      if (args[0] === "project" || args[0] === "workspace" || args[0] === "provider") return success([]);
      if (args[0] === "ls") return success([{ id: "crew-1", name: "Crew", status: "idle" }]);
      if (args[0] === "inspect") {
        if (args[1] === "missing") return { code: 1, stdout: "", stderr: "No agent found" };
        if (args[1] === "mine") return success({ Id: "mine-full-id", Name: "Captain's session", Status: "running", UpdatedAt: "t", PendingPermissions: [{ id: "req", tool: "Bash" }] });
        return success({ Id: args[1], Status: "idle", UpdatedAt: "t", PendingPermissions: [] });
      }
      if (args[0] === "permit") return success([{ id: "req", agentId: "mine-full-id", name: "Bash", description: "npm run build" }, { id: "other", agentId: "someone-else", name: "Edit", description: "-" }]);
      if (args.includes("assistant_message")) return { code: 0, stdout: "Final words.\n\ndone: shipped\n", stderr: "" };
      if (args.includes("tools")) return { code: 0, stdout: "[Read] a.ts\n[Edit] a.ts\n[Bash] npm run build\n", stderr: "" };
      return { code: 0, stdout: "[Thought] tail\nEarlier reply\n", stderr: "" };
    });
    await writeFile(join(home, "data", "remote-follow.json"), JSON.stringify({ follow: [
      { host: "Remote", agent: "mine" },
      { host: remote.serverId, agent: "crew" },
      { host: remote.serverId, agent: "missing" },
      { host: "Elsewhere", agent: "not-this-host" },
      { host: "Remote" },
    ] }));
    await service.poll();
    const workers = (await service.read()).hosts[0]!.workers;
    expect(workers.map((worker) => worker.id)).toEqual(["crew-1", "mine-full-id", "missing"]);
    expect(workers[0]).toMatchObject({ lastMessage: "Final words.\n\ndone: shipped", output: "[Thought] tail\nEarlier reply\n" });
    expect(workers[0]).not.toHaveProperty("followed");
    expect(workers[1]).toMatchObject({ followed: true, name: "Captain's session", status: "running", permissions: 1, pendingPermissions: [{ id: "req", tool: "Bash", description: "npm run build" }], recentTools: ["[Read] a.ts", "[Edit] a.ts", "[Bash] npm run build"] });
    expect(workers[0]).not.toHaveProperty("recentTools");
    expect(workers[2]).toMatchObject({ followed: true, status: "unavailable" });
    expect(calls.some((args) => args.includes("not-this-host"))).toBe(false);
    // Reading only: nothing that sends, stops, archives or labels a followed agent.
    const followedCalls = calls.filter((args) => args.includes("mine") || args.includes("mine-full-id"));
    expect(followedCalls.every((args) => ["inspect", "logs"].includes(args[0]!))).toBe(true);
    expect(calls.map((args) => args[0]).filter((command) => !["status", "project", "workspace", "provider", "ls", "inspect", "logs", "permit"].includes(command!))).toEqual([]);
    expect(calls.filter((args) => args[0] === "permit")).toEqual([["permit", "ls", "--json"]]);
  });
  it("learns a worker's task by a label-filtered ls, only for tasks it was asked about, and keeps it", async () => {
    const lookups: string[][] = [];
    let asked = 0;
    const { service } = await fixture(async (args) => {
      if (args[0] === "status") return success({ serverId: remote.serverId, connectedDaemon: "reachable" });
      if (args[0] === "ls" && args.some((arg) => arg.startsWith("firstmate.task="))) {
        lookups.push(args);
        return success(args.includes("firstmate.task=fix-login") ? [{ id: "worker" }] : []);
      }
      if (args[0] === "ls") return success([{ id: "worker", name: "Fix", status: "running" }]);
      if (args[0] === "inspect") return success({ Id: "worker", Status: "running", UpdatedAt: "now", PendingPermissions: [] });
      return success([]);
    }, async (host) => {
      asked += 1;
      return host.workers.some((worker) => worker.task === "fix-login") ? [] : ["fix-login", "other", "bad id; rm"];
    });
    await service.poll();
    expect((await service.read()).hosts[0]?.workers[0]).toMatchObject({ id: "worker", task: "fix-login" });
    expect(lookups.map((args) => args.find((arg) => arg.startsWith("firstmate.task=")))).toEqual(["firstmate.task=fix-login", "firstmate.task=other"]);
    expect(lookups[0]).toContain("firstmate.owner=local-test:firstmate");
    await service.poll();
    expect(asked).toBe(2);
    expect(lookups).toHaveLength(2);
    expect((await service.read()).hosts[0]?.workers[0]?.task).toBe("fix-login");
  });
  it("refuses helper-origin mutations of scoped workers before connecting; gateway origin, own crew and reads pass", async () => {
    const calls: string[][] = [], guarded: [string, string][] = [];
    const { service } = await fixture(async (args) => {
      calls.push(args);
      return args[0] === "status" ? success({ serverId: remote.serverId, connectedDaemon: "reachable" }) : success({ ok: true });
    }, undefined, async (serverId, agentId) => {
      guarded.push([serverId, agentId]);
      if (agentId === SCOPED) throw new Error("This remote worker belongs to a scoped supervisor.");
    });
    for (const args of [
      ["send", SCOPED, "--", "steer"], ["stop", SCOPED], ["archive", SCOPED],
      ["permit", "allow", SCOPED, "req-1"], ["permit", "deny", SCOPED, "req-1", "--message", "No."],
    ]) await expect(service.request("Remote", args, { helper: true })).rejects.toThrow("scoped supervisor");
    expect(calls).toEqual([]); // Refused before any connection or command reached the host.
    expect(guarded).toEqual(Array(5).fill([remote.serverId, SCOPED]));
    // The checked gateway's own receiver (no helper origin) still answers its worker's permission.
    await expect(service.request("Remote", ["permit", "deny", SCOPED, "req-1", "--message", "No."])).resolves.toEqual({ ok: true });
    // General's own crew and read-only helper calls are unaffected.
    await expect(service.request("Remote", ["send", CREW, "--", "hi"], { helper: true })).resolves.toEqual({ ok: true });
    await expect(service.request("Remote", ["permit", "ls"], { helper: true })).resolves.toEqual({ ok: true });
    await expect(service.request("Remote", ["inspect", SCOPED], { helper: true })).resolves.toEqual({ ok: true });
    expect(guarded).toHaveLength(6); // Only the crew send added a guard check after the refusals.
  });
  it("guards exactly the agent a helper mutation reaches: full ID first, no option before it, no stop --all or --cwd", async () => {
    const calls: string[][] = [], guarded: string[] = [];
    const { service } = await fixture(async (args) => {
      calls.push(args);
      return args[0] === "status" ? success({ serverId: remote.serverId, connectedDaemon: "reachable" }) : success({ ok: true });
    }, undefined, async (_serverId, agentId) => {
      guarded.push(agentId);
      // The real guard also refuses any prefix of a scoped worker's ID (supervision-sources.test.ts).
      if (SCOPED.startsWith(agentId.toLowerCase())) throw new Error("This remote worker belongs to a scoped supervisor.");
    });
    // An option before the target would put the agent where the guard did not look: refused, unguarded.
    for (const args of [["send", "--json", SCOPED, "--", "steer"], ["archive", "--force", SCOPED], ["stop", "--json", SCOPED],
      ["stop", "-q", SCOPED], ["archive", "-o", "json", SCOPED], ["stop"], ["send", "--", "steer"]])
      await expect(service.request("Remote", args, { helper: true }), args.join(" ")).rejects.toThrow("before any option");
    // stop --all and stop --cwd reach agents without naming them, in either spelling and position.
    for (const args of [["stop", "--all"], ["stop", "--cwd", "/home/ariadne/work"], ["stop", "--cwd=/home/ariadne/work"], ["stop", CREW, "--all"], ["stop", "--all=true"]])
      await expect(service.request("Remote", args, { helper: true }), args.join(" ")).rejects.toThrow("stop --all and stop --cwd are refused");
    // Prefixes and names are refused outright, a scoped prefix included; only a full ID is acted on.
    for (const args of [["send", SCOPED.slice(0, 7), "--", "steer"], ["stop", CREW.slice(0, 8)], ["archive", "c"], ["archive", "Crew worker"],
      ["permit", "allow", CREW.slice(0, 7), "req-1"], ["permit", "deny", SCOPED.slice(0, 7), "req-1", "--message", "No."], ["stop", `${CREW}x`]])
      await expect(service.request("Remote", args, { helper: true }), args.join(" ")).rejects.toThrow("full ID");
    expect(guarded).toEqual([]);
    expect(calls).toEqual([]);
    // The full ID of a scoped worker, in any case, is still refused by the guard; own crew passes with its options after.
    await expect(service.request("Remote", ["stop", SCOPED.toUpperCase(), "--json"], { helper: true })).rejects.toThrow("scoped supervisor");
    await expect(service.request("Remote", ["archive", CREW, "--force"], { helper: true })).resolves.toEqual({ ok: true });
    expect(guarded).toEqual([SCOPED.toUpperCase(), CREW]);
    expect(calls.find((args) => args[0] === "archive")).toEqual(["archive", CREW, "--force", "--json"]);
    // The gateway's own receiver (no helper origin) keeps its forms.
    await expect(service.request("Remote", ["stop", "--json", SCOPED])).resolves.toEqual({ ok: true });
  });
  it("guards every helper command that can reach a scoped worker's workspace; project delete and unknown subcommands refuse", async () => {
    const calls: string[][] = [], checked: { workspaceId?: string; path?: string }[] = [];
    const scopedWorktree = "/home/ariadne/.paseo/worktrees/h1/slug-1";
    const { service } = await fixture(async (args) => {
      calls.push(args);
      return args[0] === "status" ? success({ serverId: remote.serverId, connectedDaemon: "reachable" }) : success({ ok: true });
    }, undefined, async () => {}, async (_serverId, target) => {
      checked.push(target);
      // The real check reads the journal (supervision-sources.test.ts); here one workspace and its directory are scoped.
      if (target.workspaceId === "wks_scoped" || target.path?.startsWith(scopedWorktree)) throw new Error("belongs to a scoped supervisor");
    });
    // Each command that archives, sets up, renames or adds an agent or workspace to a scoped worktree refuses before connecting.
    for (const args of [["workspace", "archive", "wks_scoped"], ["workspace", "setup", "wks_scoped"], ["workspace", "rename", "wks_scoped", "x"],
      ["run", "--workspace", "wks_scoped", "--provider", "claude", "--", "brief"], ["run", "--workspace=wks_scoped", "--", "brief"],
      ["run", "--cwd", scopedWorktree, "--", "brief"], ["run", `--cwd=${scopedWorktree}/src`, "--", "brief"],
      ["workspace", "create", "--isolation", "local", "--path", scopedWorktree]])
      await expect(service.request("Remote", args, { helper: true }), args.join(" ")).rejects.toThrow("scoped supervisor");
    // project delete deletes the project's workspaces; unknown subcommands and an option before the workspace ID cannot be checked.
    await expect(service.request("Remote", ["project", "delete", "prj_any"], { helper: true })).rejects.toThrow("project delete is refused");
    for (const args of [["workspace", "help"], ["workspace", "--json", "archive", "wks_scoped"], ["project", "remove", "prj_any"], ["permit", "approve", "a", "b"], ["provider", "set", "claude"]])
      await expect(service.request("Remote", args, { helper: true }), args.join(" ")).rejects.toThrow("not a command the helper sends");
    for (const args of [["workspace", "archive", "--json", "wks_scoped"], ["workspace", "archive"]])
      await expect(service.request("Remote", args, { helper: true }), args.join(" ")).rejects.toThrow("before any option");
    await expect(service.request("Remote", ["run", "--workspace", "a", "--workspace", "wks_scoped", "--", "brief"], { helper: true })).rejects.toThrow("more than once");
    expect(calls).toEqual([]);
    // Unscoped workspaces and directories, reads and plain creations pass; reads are not checked at all.
    checked.length = 0;
    for (const args of [["workspace", "archive", "wks_crew"], ["run", "--cwd", "/home/ariadne/work", "--new-workspace", "worktree", "--", "brief"],
      ["workspace", "ls"], ["project", "ls"], ["project", "create", "/home/ariadne/new"], ["provider", "ls"], ["permit", "ls"], ["ls", "-g"], ["run", "--provider", "claude", "--", "brief"]])
      await expect(service.request("Remote", args, { helper: true }), args.join(" ")).resolves.toEqual({ ok: true });
    expect(checked).toEqual([{ workspaceId: "wks_crew", listedCwd: null }, { path: "/home/ariadne/work" }, { path: "/home/ariadne/new" }]);
  });
  it("checks the other ways a new workspace can land in a scoped worktree: project roots, slugs, branches, IDs", async () => {
    const calls: string[][] = [], checked: unknown[] = [];
    const scopedWorktree = "/home/ariadne/.paseo/worktrees/h1/ws-slug-1";
    const { service } = await fixture(async (args) => {
      calls.push(args);
      return args[0] === "status" ? success({ serverId: remote.serverId, connectedDaemon: "reachable" }) : success({ ok: true });
    }, undefined, async () => {}, async (_serverId, target) => {
      checked.push(target);
      // The real check reads the journal (supervision-sources.test.ts): one scoped worktree, its slug and branch.
      if (target.path?.startsWith(scopedWorktree) || target.slug === "ws-slug-1" || target.branch === "fm/build") throw new Error("belongs to a scoped supervisor");
      if (target.workspaceId !== undefined && target.listedCwd === null) throw new Error("cannot be shown not to be it");
    });
    // What the last poll found on the host: a project whose root is the scoped worktree, and a listed workspace.
    const catalog = (service as any).snapshot.hosts.find((host: { serverId: string }) => host.serverId === remote.serverId);
    catalog.projects = [{ projectId: "prj_scoped", path: scopedWorktree }, { projectId: "prj_repo", path: "/home/ariadne/repo" }];
    catalog.workspaces = [{ workspaceId: "wks_listed", cwd: "/home/ariadne/.paseo/worktrees/h1/other" }];
    for (const [args, message] of [
      // project create takes its directory as a positional; workspace create --project lands in the project's root.
      [["project", "create", scopedWorktree], "scoped supervisor"], [["project", "create", "--json", scopedWorktree], "before any option"], [["project", "create"], "before any option"],
      [["workspace", "create", "--project", "prj_scoped", "--isolation", "local"], "scoped supervisor"],
      [["workspace", "create", "--project", "prj_unknown"], "not in the host's last poll"],
      // A scoped worktree's slug or branch, in a run or a workspace create.
      [["run", "--cwd", "/home/ariadne/repo", "--new-workspace", "worktree", "--worktree-slug", "ws-slug-1", "--", "brief"], "scoped supervisor"],
      [["workspace", "create", "--project", "prj_repo", "--worktree-slug=ws-slug-1"], "scoped supervisor"],
      [["run", "--cwd", "/home/ariadne/repo", "--new-workspace", "worktree", "--worktree-mode", "checkout-branch", "--branch", "fm/build", "--", "brief"], "scoped supervisor"],
      [["workspace", "create", "--project", "prj_repo", "--mode", "checkout-branch", "--branch", "fm/build"], "scoped supervisor"],
      [["run", "--cwd", "/home/ariadne/repo", "--new-workspace", "worktree", "--new-branch", "fm/build", "--", "brief"], "scoped supervisor"],
      // A pull request's branch is unknown here.
      [["run", "--cwd", "/home/ariadne/repo", "--new-workspace", "worktree", "--worktree-mode", "checkout-pr", "--pr-number", "7", "--", "brief"], "pull request"],
      [["workspace", "create", "--project", "prj_repo", "--mode=checkout-pr"], "pull request"],
      // Only canonical (lowercase) IDs, which is how Paseo prints them.
      [["workspace", "archive", "WKS_LISTED"], "lowercase"], [["run", "--workspace", "Wks_listed", "--", "brief"], "lowercase"], [["workspace", "create", "--project", "PRJ_repo"], "lowercase"],
      // A workspace the catalog does not list, while a scoped open is unsettled.
      [["workspace", "archive", "wks_unlisted"], "cannot be shown"],
    ] as const) await expect(service.request("Remote", [...args], { helper: true }), args.join(" ")).rejects.toThrow(message);
    expect(calls).toEqual([]);
    // The first mate's own launches and archives pass, with the catalog's directory and the project's root checked.
    checked.length = 0;
    for (const args of [["workspace", "archive", "wks_listed"], ["workspace", "create", "--project", "prj_repo", "--worktree-slug", "fm-task", "--new-branch", "fm/task"],
      ["run", "--cwd", "/home/ariadne/repo", "--new-workspace", "worktree", "--worktree-slug", "fm-task", "--new-branch", "fm/task", "--base", "main", "--", "brief"]])
      await expect(service.request("Remote", args, { helper: true }), args.join(" ")).resolves.toEqual({ ok: true });
    expect(checked).toEqual([{ workspaceId: "wks_listed", listedCwd: "/home/ariadne/.paseo/worktrees/h1/other" },
      { path: "/home/ariadne/repo" }, { slug: "fm-task" }, { branch: "fm/task" },
      { path: "/home/ariadne/repo" }, { slug: "fm-task" }, { branch: "fm/task" }]);
  });
  it("refuses helper workspace changes outright when no workspace guard is wired", async () => {
    const calls: string[][] = [];
    const { service } = await fixture(async (args) => { calls.push(args); return args[0] === "status" ? success({ serverId: remote.serverId, connectedDaemon: "reachable" }) : success({ ok: true }); });
    for (const args of [["workspace", "archive", "wks_any"], ["run", "--cwd", "/home/ariadne/work", "--", "brief"]])
      await expect(service.request("Remote", args, { helper: true }), args.join(" ")).rejects.toThrow("cannot be checked");
    expect(calls).toEqual([]);
    // The checked gateway's own receiver (no helper origin) is not affected.
    await expect(service.request("Remote", ["workspace", "create", "--isolation", "worktree", "--path", "/home/ariadne/work"])).resolves.toEqual({ ok: true });
  });
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
