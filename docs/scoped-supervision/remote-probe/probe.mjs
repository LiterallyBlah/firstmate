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

// The rest of the remote Supervisor receiver's surface, against a throwaway git repository the probe
// creates under /tmp: workspace create/ls/archive, permit allow --input, permit deny --interrupt, stop.
// A janitor agent (cwd /tmp) runs exactly two shell commands, each allowed only after the pending
// request shows that exact command: create the repository, and at the end remove it. Every mutation
// names an ID the probe created; every listing is recorded filtered to the probe's own rows. Any
// surprise stops the probe and tears down what it knows it created; `leftover` lists anything it
// could not prove gone. The daemon version is read before the first effect and after the last.
function surfaceProbe() {
  const home = flag("home"), host = flag("host");
  if (!home || !host) throw new Error("surface needs --home and --host");
  const nonce = `s0-${randomBytes(4).toString("hex")}`;
  const repo = `/tmp/fm-probe-${nonce}`, slug = `fm-probe-${nonce}`, branch = `fm-probe/${nonce}`;
  const labels = ["--label", "firstmate.task=fm-remote-supervisors-probe", "--label", "firstmate.kind=scout", "--label", `firstmate.probe=${nonce}`];
  const created = { janitor: null, worker: null, worktree: null, worktreeCwd: null, repoProject: null, tmpWorkspace: null, tmpProject: null, repo: false };
  const leftover = [];
  const helper = (args) => spawnSync(process.execPath, [join(home, "tools", "remote.mjs"), ...args], { cwd: home, encoding: "utf8", timeout: 400_000 });
  const remote = (args) => {
    const startedAt = new Date().toISOString(), r = helper([host, ...args]);
    return { args, code: r.status, startedAt, endedAt: new Date().toISOString(), stdout: r.stdout, stderr: r.stderr, parsed: json(r.stdout) };
  };
  // Only this probe's rows are kept: the host's other workspaces, projects and permissions are not ours to record.
  const filtered = (result, keep) => { const rows = Array.isArray(result.parsed) ? result.parsed : [];
    return { ...result, stdout: undefined, rows: rows.length, keys: [...new Set(rows.flatMap((row) => Object.keys(row)))].sort(), parsed: rows.filter(keep) }; };
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const catalog = () => { const r = helper(["hosts"]); const h = json(r.stdout)?.hosts?.find((x) => x.serverId === host); if (!h) throw new Error("host not in the catalog"); return h; };
  const version = (phase) => { const h = catalog(); return record(`version:${phase}`, { readAt: new Date().toISOString(), checkedAt: h.checkedAt, online: h.online, daemonVersion: h.daemonVersion ?? null }); };
  const fail = (why) => { throw new Error(why); };
  const inspect = (id) => remote(["inspect", id]).parsed;
  const until = (label, test, tries = 36, every = 5_000) => {
    for (let i = 0; i < tries; i++) { const value = test(); if (value) return value; sleep(every); }
    fail(`gave up waiting: ${label}`);
  };
  const pendingOf = (id) => { const r = remote(["permit", "ls"]); return { r, mine: (Array.isArray(r.parsed) ? r.parsed : []).filter((p) => p.agentId === id) }; };
  const awaitPermission = (label, id, tool) => {
    const { r, mine } = until(label, () => { const p = pendingOf(id); return p.mine.length ? p : null; });
    record(label, { ...r, stdout: undefined, parsed: mine });
    if (mine.length !== 1 || mine[0].name !== tool) fail(`${label}: expected exactly one ${tool} request, got ${JSON.stringify(mine.map((p) => p.name))}`);
    return mine[0];
  };
  const settled = (label, id, ok = (a) => a && a.Status === "idle" && a.PendingPermissions.length === 0) => {
    let last = null;
    try { return record(label, { parsed: until(label, () => { last = inspect(id); return ok(last) ? last : null; }) }); }
    catch (error) { record(`${label}:last-seen`, { parsed: last }); throw error; }
  };
  const stopped = (a) => a && a.Status !== "running" && a.Status !== "initializing" && a.PendingPermissions.length === 0;
  // The janitor's one shell command, allowed only when the pending request shows exactly it.
  const shell = (label, command, onAllow = () => {}) => {
    // The CLI's tool summary is capped at 200 characters; a longer command could never be checked.
    if (command.length > 190 || /\n/.test(command)) fail(`${label}: the command is too long to check exactly`);
    record(`${label}:send`, remote(["send", created.janitor, "--", `Run exactly this one Bash command, with no other tool, then reply with its output and stop:\n${command}`]));
    const request = awaitPermission(`${label}:requested`, created.janitor, "Bash");
    // The CLI labels a Claude Bash call `[Shell]` in its tool summary.
    // Only the newest entry is the pending call; an older matching command proves nothing about it.
    const shown = String((request.recentTools ?? []).at(-1) ?? "").replace(/^\[(?:Bash|Shell)\]\s*/, "");
    if (shown !== command) {
      record(`${label}:refused`, remote(["permit", "deny", created.janitor, request.id, "--message", "Not the exact command.", "--interrupt"]));
      fail(`${label}: the pending Bash request is not exactly the command`);
    }
    onAllow();
    record(`${label}:allow`, remote(["permit", "allow", created.janitor, request.id]));
    settled(`${label}:settled`, created.janitor);
    return record(`${label}:output`, remote(["logs", created.janitor, "--tail", "1", "--filter", "assistant_message"])).stdout ?? "";
  };
  const workspaces = () => remote(["workspace", "ls", "--background"]);
  const projects = () => remote(["project", "ls"]);
  try {
    version("before");
    const before = catalog();
    if (before.projects.some((p) => p.path === "/tmp" || p.path.startsWith("/tmp/fm-probe")) || before.workspaces.some((w) => w.cwd === "/tmp" || w.cwd.startsWith("/tmp/fm-probe")))
      fail("preflight: /tmp already has a project or workspace; refusing to share it");
    record("preflight", { projects: before.projects.length, workspaces: before.workspaces.length, tmpProjects: 0, tmpWorkspaces: 0 });

    const janitor = record("janitor:create", remote(["run", "--cwd", "/tmp", "--provider", "claude", "--model", "claude-haiku-4-5", "--mode", "default",
      "--title", `FirstMate probe janitor ${nonce} (archive me)`, ...labels, "--", "This is a FirstMate capability probe. Reply with exactly the word ok and then stop. Do not use any tools."]));
    created.janitor = janitor.parsed?.agentId ?? fail("janitor create returned no agentId");
    settled("janitor:first-turn", created.janitor);
    const tmp = record("janitor:workspace", filtered(workspaces(), (w) => w.cwd === "/tmp"));
    created.tmpWorkspace = tmp.parsed.length === 1 ? tmp.parsed[0].workspaceId : fail("expected exactly one new /tmp workspace");
    const tmpProject = record("janitor:project", filtered(projects(), (p) => (p.path ?? p.cwd ?? p.directory) === "/tmp"));
    created.tmpProject = tmpProject.parsed.length === 1 ? (tmpProject.parsed[0].projectId ?? tmpProject.parsed[0].id) : null;

    const setup = `mkdir ${repo} && cd ${repo} && git init -q -b main && git -c user.name=p -c user.email=p@x commit -q --allow-empty -m init && git branch --show-current`;
    // Once allowed, the directory may exist; teardown removes it.
    if (!/\bmain\b/.test(shell("repo:create", setup, () => { created.repo = true; }))) fail("the throwaway repository did not report branch main");

    // The receiver's own `workspace create` shape (`SupervisionRemoteReceiver.openWorkspace`).
    const open = record("workspace:create", remote(["workspace", "create", "--isolation", "worktree", "--path", repo,
      "--worktree-slug", slug, "--new-branch", branch, "--base", "main", "--title", branch]));
    if (open.code !== 0) fail("workspace create failed");
    const w = open.parsed ?? {}, nested = w.workspace ?? {};
    created.worktree = w.workspaceId ?? w.id ?? nested.workspaceId ?? nested.id ?? fail("workspace create returned no workspace id");
    created.worktreeCwd = w.cwd ?? w.path ?? w.directory ?? nested.cwd ?? nested.path ?? null;
    const listed = record("workspace:ls", filtered(workspaces(), (row) => row.workspaceId === created.worktree || String(row.cwd ?? "").includes(slug)));
    record("workspace:ls-branch", { branchField: listed.keys.includes("branch"), rowBranch: listed.parsed[0]?.branch ?? null });
    const repoProject = record("workspace:project", filtered(projects(), (p) => (p.path ?? p.cwd ?? p.directory) === repo));
    created.repoProject = repoProject.parsed.length === 1 ? (repoProject.parsed[0].projectId ?? repoProject.parsed[0].id) : null;

    const worker = record("worker:create", remote(["run", "--workspace", created.worktree, "--provider", "claude", "--model", "claude-haiku-4-5", "--mode", "default",
      "--title", `FirstMate probe worker ${nonce} (archive me)`, ...labels, "--",
      "This is a FirstMate capability probe. Use the AskUserQuestion tool exactly once, with one question \"Proceed with the probe?\" (header \"Probe\") and the two options \"yes\" and \"no\". Then reply with exactly the answer you received and stop. Use no other tool."]));
    created.worker = worker.parsed?.agentId ?? fail("worker create returned no agentId");
    const question = awaitPermission("permit-allow:requested", created.worker, "AskUserQuestion");
    record("permit-allow:inspect", remote(["inspect", created.worker]));
    record("permit-allow:answer", remote(["permit", "allow", created.worker, question.id, "--input", JSON.stringify({ answers: { "Proceed with the probe?": "yes" } })]));
    settled("permit-allow:settled", created.worker);
    record("permit-allow:reply", remote(["logs", created.worker, "--tail", "1", "--filter", "assistant_message"]));

    record("permit-deny-interrupt:send", remote(["send", created.worker, "--", "Use the Write tool to create probe.txt in the current directory containing ok. If that is refused, reply ok and stop."]));
    const write = awaitPermission("permit-deny-interrupt:requested", created.worker, "Write");
    record("permit-deny-interrupt:deny", remote(["permit", "deny", created.worker, write.id, "--message", "Denied by the FirstMate probe.", "--interrupt"]));
    // The interrupt ends the turn: the worker stops, its request gone, whatever status it settles in.
    settled("permit-deny-interrupt:settled", created.worker, stopped);
    record("permit-deny-interrupt:logs", remote(["logs", created.worker, "--tail", "4", "--filter", "text"]));

    record("stop:send", remote(["send", created.worker, "--", "Without using any tools, write the numbers from 1 to 3000 in English words, one per line, then stop."]));
    record("stop:running", { parsed: until("worker running", () => { const a = inspect(created.worker); return a?.Status === "running" ? a : null; }, 30, 1_000) });
    const stop = record("stop", remote(["stop", created.worker]));
    // A turn that finished before the stop arrived would prove nothing: the stop must have stopped this worker.
    if (stop.parsed?.stoppedCount !== 1 || !stop.parsed.agentIds?.includes(created.worker)) fail("stop did not report stopping the running worker");
    settled("stop:settled", created.worker, (a) => a && a.Status !== "running" && a.Status !== "initializing");
    record("stop:logs", remote(["logs", created.worker, "--tail", "2", "--filter", "text"]));
  } catch (error) {
    record("aborted", { error: String(error?.message ?? error) });
  }
  // Teardown, in reverse: each step only for what this probe created.
  const step = (label, args) => { const r = record(label, remote(args)); if (r.code !== 0) leftover.push(`${label}: ${r.stderr.trim()}`); return r; };
  if (created.worker) { step("teardown:worker-stop", ["stop", created.worker]); step("teardown:worker-archive", ["archive", created.worker]); }
  if (created.worktree) step("teardown:worktree-archive", ["workspace", "archive", created.worktree]);
  if (created.repoProject) step("teardown:repo-project-delete", ["project", "delete", created.repoProject]);
  if (created.repo && created.janitor) {
    const checks = [`test ! -e ${repo}`, ...(created.worktreeCwd ? [`test ! -e ${created.worktreeCwd}`] : [])].join(" && ");
    try { if (!/\bclean\b/.test(shell("repo:remove", `rm -rf ${repo} && ${checks} && echo clean`))) leftover.push(`${repo} or the worktree may remain`); }
    catch (error) { leftover.push(`repo:remove: ${String(error?.message ?? error)}`); }
  } else if (created.repo) leftover.push(`${repo} may remain (no janitor)`);
  if (created.janitor) { step("teardown:janitor-stop", ["stop", created.janitor]); step("teardown:janitor-archive", ["archive", created.janitor]); }
  if (created.tmpWorkspace) step("teardown:tmp-workspace-archive", ["workspace", "archive", created.tmpWorkspace]);
  if (created.tmpProject) step("teardown:tmp-project-delete", ["project", "delete", created.tmpProject]);
  // Once its workspace is archived and its project deleted, an archived agent drops out of `ls -a`; inspect each one.
  for (const [role, id] of [["janitor", created.janitor], ["worker", created.worker]]) {
    if (!id) continue;
    const a = record(`after:${role}-inspect`, remote(["inspect", id])).parsed;
    if (!a || a.Archived !== true || a.Status === "running") leftover.push(`${role} ${id} is not archived`);
  }
  const agents = record("after:agents", remote(["ls", "-g", "-a", "--label", `firstmate.probe=${nonce}`]));
  const live = record("after:agents-active", remote(["ls", "-g", "--label", `firstmate.probe=${nonce}`]));
  if (!Array.isArray(live.parsed) || live.parsed.length) leftover.push("an agent with the probe label is still active");
  const ours = (path) => path === "/tmp" || String(path ?? "").includes(slug) || String(path ?? "").startsWith(repo);
  const ws = record("after:workspaces", filtered(workspaces(), (row) => ours(row.cwd) || Object.values(created).includes(row.workspaceId)));
  const pj = record("after:projects", filtered(projects(), (row) => ours(row.path ?? row.cwd ?? row.directory)));
  if (ws.parsed.length) leftover.push("a probe workspace is still listed");
  if (pj.parsed.length) leftover.push("a probe project is still listed");
  // Truly after the last effect: wait for a catalog refresh that started after it.
  const lastEffect = steps.filter((s) => s.endedAt).at(-1)?.endedAt;
  for (let i = 0; i < 30; i++) { const h = catalog(); if (Date.parse(h.checkedAt) > Date.parse(lastEffect)) break; sleep(10_000); }
  version("after");
  return { nonce, repo, created, agents: Array.isArray(agents.parsed) ? agents.parsed.map((a) => a.id) : [], leftover };
}

let summary;
try {
  if (mode === "static") staticProbe();
  else if (mode === "live") summary = liveProbe();
  else if (mode === "surface") summary = surfaceProbe();
  else throw new Error("usage: probe.mjs static | live --home <dir> --host <serverId> --workspace <id> | surface --home <dir> --host <serverId>");
} catch (error) { summary = { error: String(error?.message ?? error) }; }
process.stdout.write(`${JSON.stringify({ probe: "firstmate-remote-supervisors-s0", mode, at: new Date(started).toISOString(), platform: process.platform, summary, steps }, null, 2)}\n`);
