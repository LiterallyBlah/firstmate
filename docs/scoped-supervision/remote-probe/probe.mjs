#!/usr/bin/env node
// Slice 0 evidence fixture: probes the installed Paseo CLI's remote surface.
// Not shipped (docs/ is outside package.json `files`), never run by tests.
//
//   node docs/scoped-supervision/remote-probe/probe.mjs static
//     Local only. Reads the CLI that the daemon hands its plugins (PASEO_CLI),
//     its help for the commands a remote receiver would use, and how it fails
//     against an endpoint that refuses or never answers. Creates nothing.
//
//   node docs/scoped-supervision/remote-probe/probe.mjs live --home <firstmate home> --host <serverId> --workspace <remote workspace id>
//     Through the plugin's own remote path (the home's tools/remote.mjs queue →
//     RemoteService → the remote CLI): creates ONE labelled test agent in an
//     existing remote workspace, asks it to reply "ok", reconciles it by label,
//     reads its status and completion, provokes one permission request and
//     denies it (nothing is executed), then archives the agent. Touches no
//     other agent: every mutation names the probe agent's exact ID.
//
// Both write a JSON transcript to stdout; redirect it into evidence/.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const mode = process.argv[2];
const flag = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const steps = [];
const started = Date.now();
const record = (name, result) => { steps.push({ name, atMs: Date.now() - started, ...result }); return result; };
const json = (text) => { try { return JSON.parse(text); } catch { return undefined; } };

function cli(args, timeoutMs = 60_000) {
  const command = process.env.PASEO_CLI;
  if (!command) throw new Error("PASEO_CLI is not set; run from a shell the Paseo daemon started");
  const t = Date.now();
  // The desktop launcher is a .cmd on Windows, which needs a shell; arguments here are fixed literals.
  const r = spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs, shell: process.platform === "win32" });
  return { args, code: r.status, ms: Date.now() - t, stdout: r.stdout, stderr: r.stderr };
}

function staticProbe() {
  record("version", cli(["--version"]));
  for (const c of [["run"], ["send"], ["inspect"], ["ls"], ["wait"], ["stop"], ["archive"], ["permit", "ls"], ["permit", "allow"], ["permit", "deny"], ["workspace", "create"], ["agent", "update"], ["agent", "detach"], ["host"]]) {
    const r = cli([...c, "--help"]);
    record(`help:${c.join(" ")}`, { code: r.code, options: (r.stdout.match(/^\s+(-\w, )?--[\w-]+[^\n]*/gm) ?? []).map((l) => l.trim().split(/\s{2,}/)[0]) });
  }
  // Validation that runs before any connection: no prompt, and the bridge's injected flags.
  record("run:empty-prompt", cli(["run", "--provider", "claude", "--json", "--host", "127.0.0.1:1", " "]));
  record("run:bridge-flags", cli(["run", "--background", "--json", "--host", "127.0.0.1:1", "--provider", "claude", "noop"]));
  record("run:unknown-id-flag", cli(["run", "--agent-id", "00000000-0000-4000-8000-000000000000", "--json", "--host", "127.0.0.1:1", "--provider", "claude", "noop"]));
  // Unreachable endpoints: refused, and a blackhole address (TEST-NET-1) that never answers.
  for (const [label, target] of [["refused", "127.0.0.1:1"], ["blackhole", "192.0.2.1:6767"]]) {
    for (const args of [["status", "--json"], ["ls", "-g", "--json"], ["inspect", "abc", "--json"], ["permit", "ls", "--json"], ["run", "--no-wait", "--json", "--provider", "claude", "noop"]]) {
      record(`unreachable:${label}:${args[0]}`, cli([...args, "--host", target], 90_000));
    }
  }
}

function liveProbe() {
  const home = flag("home"), host = flag("host"), workspace = flag("workspace");
  if (!home || !host || !workspace) throw new Error("live needs --home, --host and --workspace");
  const nonce = `s0-${randomBytes(4).toString("hex")}`;
  const remote = (args) => {
    const t = Date.now();
    const r = spawnSync(process.execPath, [join(home, "tools", "remote.mjs"), host, ...args], { cwd: home, encoding: "utf8", timeout: 400_000 });
    return { args, code: r.status, ms: Date.now() - t, stdout: r.stdout, stderr: r.stderr, parsed: json(r.stdout) };
  };
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const settle = (id, label, until) => {
    for (let i = 0; i < 24; i++) {
      const r = remote(["inspect", id]);
      if (until(r.parsed)) return record(label, r);
      sleep(10_000);
    }
    return record(`${label}:gave-up`, remote(["inspect", id]));
  };
  record("baseline:label-listing", remote(["ls", "-g", "--label", `firstmate.probe=${nonce}`]));
  record("unknown-host", (() => {
    const r = spawnSync(process.execPath, [join(home, "tools", "remote.mjs"), "no-such-host-s0", "ls"], { cwd: home, encoding: "utf8", timeout: 400_000 });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  })());
  const run = record("create", remote([
    "run", "--workspace", workspace, "--provider", "claude", "--model", "claude-haiku-4-5", "--mode", "default",
    "--title", `FirstMate s0 probe ${nonce} (archive me)`,
    "--label", "firstmate.task=fm-remote-supervisors-s0-probe", "--label", "firstmate.kind=scout", "--label", `firstmate.probe=${nonce}`,
    "--", "This is a FirstMate capability probe. Reply with exactly the word ok and then stop. Do not use any tools.",
  ]));
  const id = run.parsed?.agentId;
  if (typeof id !== "string") return { nonce, aborted: "create returned no agentId" };
  record("reconcile:label-listing", remote(["ls", "-g", "--label", `firstmate.probe=${nonce}`]));
  record("reconcile:label-and-owner", remote(["ls", "-g", "--label", `firstmate.probe=${nonce}`, "--label", "firstmate.role=crew"]));
  settle(id, "status:first-turn-settled", (a) => a && a.Status !== "running" && a.Status !== "initializing");
  record("completion:logs-text", remote(["logs", id, "--tail", "5", "--filter", "text"]));
  record("completion:logs-assistant", remote(["logs", id, "--tail", "1", "--filter", "assistant_message"]));
  // Permission: ask for a Write, which the default mode asks about, then deny it.
  record("permission:send", remote(["send", id, "--", "Use the Write tool to create /tmp/firstmate-s0-probe.txt containing ok. If that is refused, reply ok and stop."]));
  let pending = null;
  for (let i = 0; i < 18 && !pending; i++) {
    sleep(10_000);
    const r = remote(["permit", "ls"]);
    const rows = Array.isArray(r.parsed) ? r.parsed : Array.isArray(r.parsed?.permissions) ? r.parsed.permissions : [];
    const mine = rows.filter((p) => JSON.stringify(p).includes(id.slice(0, 7)));
    if (mine.length) { pending = mine[0]; record("permission:listed", { ...r, parsed: mine }); }
    else { const a = remote(["inspect", id]); if (a.parsed && a.parsed.Status === "idle") { record("permission:none-requested", a); break; } }
  }
  if (pending) {
    record("permission:inspect", remote(["inspect", id]));
    const requestId = pending.id ?? pending.requestId ?? pending.ID;
    record("permission:deny", remote(["permit", "deny", id, String(requestId), "--message", "Denied by the FirstMate slice 0 probe. Reply ok and stop."]));
    settle(id, "permission:settled", (a) => a && a.Status === "idle");
    record("permission:logs-text", remote(["logs", id, "--tail", "5", "--filter", "text"]));
  }
  record("archive", remote(["archive", id]));
  record("after-archive:listing", remote(["ls", "-g", "--label", `firstmate.probe=${nonce}`]));
  record("after-archive:listing-all", remote(["ls", "-g", "-a", "--label", `firstmate.probe=${nonce}`]));
  return { nonce, agentId: id };
}

let summary;
try {
  if (mode === "static") staticProbe();
  else if (mode === "live") summary = liveProbe();
  else throw new Error("usage: probe.mjs static | live --home <dir> --host <serverId> --workspace <id>");
} catch (error) { summary = { error: String(error?.message ?? error) }; }
process.stdout.write(`${JSON.stringify({ probe: "firstmate-remote-supervisors-s0", mode, at: new Date(started).toISOString(), platform: process.platform, summary, steps }, null, 2)}\n`);
