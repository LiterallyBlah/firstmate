#!/usr/bin/env node
// schedule: */15 * * * *
// Opt-in, silent observation only. Copy explicitly; never seeded or auto-updated.
// See templates/watches/README.md for installation, report and measurement limits.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, link, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

const home = process.env.FIRSTMATE_HOME;
const stateDir = process.env.FIRSTMATE_WATCH_STATE;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const identifier = value => typeof value === "string" && /^[\w.-]{1,200}$/.test(value) ? value : null;
const taskId = value => typeof value === "string" && /^[\w.-]{1,64}$/.test(value) ? value : null;
const unknown = reason => ({ status: "unknown", reason });
const check = passed => ({ status: passed ? "pass" : "fail" });
const na = () => ({ status: "not-applicable" });
const rows = value => {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object")) throw new Error("invalid-list");
  return value;
};
async function optional(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
async function atomic(path, value) {
  await writeFile(`${path}.tmp`, JSON.stringify(value) + "\n", { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
async function withLock(run) {
  if (!stateDir) throw new Error("missing-state-directory");
  await mkdir(stateDir, { recursive: true });
  const path = join(stateDir, "launch-metrics.lock");
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, String(process.pid), { mode: 0o600 });
  try { await link(temporary, path); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Do not steal a lock: automatic stale-lock deletion can race another recovering run.
    // The runner prevents overlap; this also protects explicit manual runs using this state.
    const pid = Number(await optional(path));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("invalid-lock");
    try { process.kill(pid, 0); return; }
    catch (error) { if (error.code !== "ESRCH") return; }
    console.error("Launch metrics: stale launch-metrics.lock; remove it only after confirming its watch process has stopped.");
    throw new Error("stale-lock");
  }
  finally { await rm(temporary, { force: true }); }
  try { await run(); } finally { await rm(path); }
}
function backlogItems(text) {
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*[-*]\s+\[[ xX~-]\]\s+([\w.-]{1,64})(?:\s|$)/.exec(line);
    if (!match) continue;
    const fields = Object.fromEntries([...line.matchAll(/\(([\w-]+)\s*:\s*([^()]*)\)/g)].map(m => [m[1].toLowerCase(), m[2].trim()]));
    items.push({ task: match[1], agent: fields.agent ?? fields.crewmate, project: fields.project ?? fields.repo,
      kind: fields.kind, host: fields.host ?? fields["on-host"] });
  }
  return items;
}

// Same read-only path precedence as server/data-dir.ts and tools/role.mjs.
// Never use a retained first-mate label, or the watch process's agent identity.
async function leadIdentity() {
  try {
    const daemon = process.env.PASEO_HOME ?? join(homedir(), ".paseo");
    const dataPath = async entry => {
      const current = join(daemon, "plugin-data", "firstmate", entry);
      const legacy = join(daemon, "plugins", "firstmate", entry);
      return !(await exists(current)) && await exists(legacy) ? legacy : current;
    };
    const config = JSON.parse(await readFile(await dataPath("config.json"), "utf8"));
    if (!config || typeof config !== "object" || (config.home !== undefined && typeof config.home !== "string")) return null;
    let configured = typeof config.home === "string" ? config.home.trim() : "";
    if (!configured) configured = await dataPath("home");
    else if (configured === "~") configured = homedir();
    else if (configured.startsWith("~/")) configured = join(homedir(), configured.slice(2));
    else if (!isAbsolute(configured)) return null;
    const canonical = async path => {
      const actual = await realpath(path);
      return process.platform === "win32" ? actual.toLowerCase() : actual;
    };
    if (await canonical(configured) !== await canonical(home)) return null;
    return identifier(config.mateAgentId);
  } catch { return null; }
}

// Reproduce server/process-launch.ts's native Windows launches; never shell-quote CLI arguments.
async function localLaunch(args) {
  let cli = process.env.PASEO_CLI;
  if (!cli) {
    const names = process.platform === "win32" ? ["paseo.exe", "paseo.cmd"] : ["paseo"];
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
      for (const name of names) if (!cli && await exists(join(dir, name))) cli = join(dir, name);
    }
  }
  if (!cli) throw new Error("cli-unavailable");
  const nodeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  if (/\.(?:mjs|cjs|js)$/.test(cli)) return [process.execPath, [cli, ...args], nodeEnv];
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(cli)) return [cli, args, process.env];
  const resources = resolve(dirname(cli), "..");
  const exe = resolve(resources, "..", "Paseo.exe");
  const runner = join(resources, "app.asar.unpacked", "dist", "daemon", "node-entrypoint-runner.js");
  if (await exists(exe) && await exists(runner)) return [exe,
    ["--disable-warning=DEP0040", runner, "node-script", join(resources, "app.asar", "node_modules", "@getpaseo", "cli", "dist", "index.js"), ...args],
    { ...nodeEnv, PASEO_NODE_ENV: "production", PASEO_DESKTOP_MANAGED: "1", PASEO_CLI: cli }];
  for (const root of [join(dirname(cli), "node_modules", "@getpaseo", "cli"), join(dirname(cli), "..", "@getpaseo", "cli")]) {
    const entry = join(root, "bin", "paseo");
    if (await exists(entry)) return [process.execPath, [entry, ...args], nodeEnv];
  }
  throw new Error("cli-unavailable");
}
const deadline = Date.now() + 90000;
const cache = new Map();
async function cli(host, args) {
  const key = JSON.stringify([host, args]);
  if (cache.has(key)) return cache.get(key);
  if (Date.now() >= deadline) throw new Error("budget-exhausted");
  const pending = (async () => {
    const [command, argv, env] = host === "local" ? await localLaunch(args)
      : [process.execPath, [join(home, "tools", "remote.mjs"), host, ...args], { ...process.env, ELECTRON_RUN_AS_NODE: "1" }];
    return new Promise((accept, reject) => execFile(command, argv, {
      cwd: home, env, windowsHide: true, timeout: Math.min(15000, Math.max(1, deadline - Date.now())), maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout) => {
      // Never copy arbitrary command errors, prompts or remote connection details into metrics/logs.
      if (error) return reject(new Error("cli-read-failed"));
      try { accept(JSON.parse(stdout)); } catch { reject(new Error("invalid-cli-json")); }
    }));
  })();
  cache.set(key, pending);
  return pending;
}
const listing = (host, labels = { "firstmate.role": "crew" }) => cli(host,
  ["ls", "-a", "-g", ...Object.entries(labels).flatMap(([k, v]) => ["--label", `${k}=${v}`]), "--json"]).then(rows);
const carries = async (host, id, labels) => (await listing(host, labels)).some(row => row.id === id);

// Inspect only task JSON files and their launches/ subdirectory, never recursively walk the home.
// Retain a small projection, never the request's prompt, URLs, arguments or credentials.
async function requests() {
  const found = [];
  for (const dir of await readdir(join(home, "data"), { withFileTypes: true })) {
    if (!dir.isDirectory() || !taskId(dir.name) || ["metrics", "remote-action-receipts"].includes(dir.name)) continue;
    for (const relative of [`data/${dir.name}`, `data/${dir.name}/launches`]) {
      let entries;
      try { entries = await readdir(join(home, relative), { withFileTypes: true }); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const path = `${relative}/${entry.name}`;
        const info = await stat(join(home, path));
        if (info.size > 1024 * 1024) continue;
        let input;
        try { input = JSON.parse((await readFile(join(home, path), "utf8")).replace(/^\uFEFF/, "")); }
        catch { continue; }
        if (!input || typeof input !== "object") continue;
        const labels = {};
        let agent = input.agent ?? input.createAgent;
        if (Array.isArray(input.args) && input.args[0] === "run" && input.args.every(a => typeof a === "string")) {
          const options = {};
          for (let i = 1; i < input.args.length && input.args[i] !== "--"; i++) {
            const arg = input.args[i];
            if (!arg.startsWith("--")) continue;
            const eq = arg.indexOf("=");
            const key = eq < 0 ? arg : arg.slice(0, eq);
            if (!["--label", "--provider", "--model", "--mode", "--thinking"].includes(key)) continue;
            const value = eq < 0 ? input.args[++i] : arg.slice(eq + 1);
            if (typeof value !== "string") continue;
            if (key === "--label") { const split = value.indexOf("="); if (split > 0) labels[value.slice(0, split)] = value.slice(split + 1); }
            else options[key] = value;
          }
          agent = { provider: options["--provider"], model: options["--model"], modeId: options["--mode"], thinkingOptionId: options["--thinking"] };
        } else if (agent && typeof agent === "object") Object.assign(labels, agent.labels);
        else continue;
        const task = taskId(labels["firstmate.task"] ?? input.id ?? dir.name);
        if (!task) continue;
        const provider = typeof agent.provider === "string" ? agent.provider : "";
        found.push({ path, mtime: info.mtime.toISOString(), task, host: typeof input.host === "string" ? input.host : "local",
          kind: identifier(labels["firstmate.kind"] ?? input.kind), project: identifier(labels["firstmate.project"] ?? input.project),
          launch: identifier(labels["firstmate.launch"]), provider: identifier(provider.split("/")[0]),
          model: identifier(agent.model ?? provider.split("/").slice(1).join("/")),
          mode: identifier(agent.modeId ?? agent.settings?.modeId), thinking: identifier(agent.thinkingOptionId ?? agent.settings?.thinkingOptionId) });
      }
    }
  }
  return found;
}
async function receiptRows() {
  const dir = join(home, "data", "remote-action-receipts");
  if (!(await exists(dir))) return [];
  const entries = [];
  for (const file of await readdir(dir, { withFileTypes: true })) {
    if (!file.isFile() || !/\.(started|succeeded|failed|uncertain)\.json$/.test(file.name)) continue;
    try {
      const row = JSON.parse(await readFile(join(dir, file.name), "utf8"));
      if (row.version === 1 && row.action === "dispatch" && identifier(row.requestId) && Number.isFinite(Date.parse(row.at))) entries.push(row);
    } catch { throw new Error("invalid-receipt"); }
  }
  return entries;
}
function remoteMetrics(receipts, host, task, id) {
  const related = receipts.filter(r => r.serverId === host && (r.targetId === id || (task && r.taskKey === hash(task))));
  const success = related.filter(r => r.phase === "succeeded" && r.targetId === id).sort((a, b) => a.at.localeCompare(b.at))[0];
  const window = related.filter(r => !success || r.at <= success.at);
  const actions = [...new Set(window.map(r => r.requestId))].map(requestId => {
    const parts = window.filter(r => r.requestId === requestId);
    const end = parts.find(r => r.phase !== "started");
    return { requestId, at: parts.find(r => r.phase === "started")?.at ?? end?.at,
      outcome: end?.phase ?? "uncertain", cause: end?.phase === "failed" ? "unknown" : null };
  });
  return { observedDispatchActions: actions, verifiedLaunchAttempts: success ? 1 : 0,
    attemptsBeforeSuccess: null, firstAttemptSuccess: null,
    limitation: "Task-scoped receipts through the matched success, possibly including earlier workers and workspace creation. Failures omit causes. Verified count is a lower bound, not an attempt total." };
}

function sameDirectory(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const windows = /^[A-Za-z]:[\\/]/.test(a);
  const normal = s => s.replace(/\\/g, "/").replace(/\/+$/, "");
  return windows ? normal(a).toLowerCase() === normal(b).toLowerCase() : normal(a) === normal(b);
}
async function measure(host, id, items, inputs, receipts) {
  const detail = await cli(host.id, ["inspect", id, "--json"]);
  if (detail?.Id !== id || typeof detail.Cwd !== "string") throw new Error("invalid-inspect");
  const workspaces = rows(await cli(host.id, ["workspace", "ls", "--json"]));
  const workspacesHere = workspaces.filter(w => sameDirectory(w.cwd ?? w.path, detail.Cwd));
  const workspace = workspacesHere.length === 1 ? workspacesHere[0] : null;
  const hostMatches = value => host.id === "local" ? !value || value === "local" : value === host.id || value === host.label;
  const lines = items.filter(item => hostMatches(item.host) && item.agent === id);
  let task = lines.length === 1 ? lines[0].task : taskId(/^fm\/(.+)$/.exec(workspace?.branch ?? "")?.[1]);
  let candidates = inputs.filter(r => hostMatches(r.host) && (!task || r.task === task));
  if (!task) {
    const matched = [];
    // Hints are only candidates for an actual label-filter check, never evidence by themselves.
    const hints = [host.workers?.find(w => w.id === id && !w.followed)?.task, detail.Cwd.split(/[\\/]/).pop()].filter(taskId);
    const tasks = [...new Set([...hints, ...candidates.map(r => r.task), ...items.filter(item => hostMatches(item.host)).map(item => item.task)])];
    // An unfiled worker must not consume the entire poll enumerating years of task names.
    for (const candidate of tasks.slice(0, 10)) {
      if (await carries(host.id, id, { "firstmate.role": "crew", "firstmate.task": candidate })) matched.push(candidate);
      if (matched.length) break;
    }
    if (matched.length === 1) task = matched[0];
    candidates = candidates.filter(r => r.task === task);
  }
  const launches = [];
  for (const launch of [...new Set(candidates.map(r => r.launch).filter(Boolean))]) {
    if (await carries(host.id, id, { "firstmate.role": "crew", "firstmate.launch": launch })) launches.push(launch);
  }
  const launch = launches.length === 1 ? launches[0] : null;
  if (launch) candidates = candidates.filter(r => r.launch === launch);
  // Prefer the last request written before creation, in the host's measured clock.
  // A file edited after creation is not silently treated as the original request.
  const created = Date.parse(detail.CreatedAt);
  const skew = host.id === "local" ? 0 : host.clockSkew?.seconds;
  const before = candidates.filter(r => Number.isFinite(created) && typeof skew === "number" && Date.parse(r.mtime) <= created - skew * 1000);
  before.sort((a, b) => b.mtime.localeCompare(a.mtime));
  const request = before.length && (before.length === 1 || before[0].mtime !== before[1].mtime) ? before[0]
    : candidates.length === 1 ? candidates[0] : null;
  const taskLine = lines.length === 1 ? lines[0] : items.find(item => hostMatches(item.host) && item.task === task);
  const expected = { "firstmate.role": "crew", "firstmate.task": task,
    "firstmate.kind": request?.kind ?? taskLine?.kind, "firstmate.project": request?.project ?? taskLine?.project };
  const labelChecks = {};
  for (const [key, value] of Object.entries(expected)) labelChecks[key] = !identifier(value) ? unknown("expected-value-unavailable")
    : check(await carries(host.id, id, { "firstmate.role": "crew", [key]: value }));
  const leadId = host.id === "local" ? await leadIdentity() : null;
  const compare = (expected, actual) => expected == null ? unknown("request-unavailable-or-unspecified")
    : actual == null || actual === "-" ? unknown("actual-unavailable") : check(expected === actual);
  const checks = {
    labels: Object.values(labelChecks).some(c => c.status === "fail") ? check(false)
      : Object.values(labelChecks).some(c => c.status === "unknown") ? unknown("expected-labels-incomplete") : check(true),
    parent: host.id !== "local" ? na() : leadId ? check(detail.ParentAgentId === leadId) : unknown("lead-config-unavailable"),
    worktree: !task ? unknown("task-unavailable") : workspacesHere.length > 1 ? unknown("workspace-ambiguous")
      : !workspace ? check(false) : (workspace.isolation ?? workspace.kind) !== "worktree" ? check(false)
        : typeof workspace.branch !== "string" ? unknown("workspace-branch-not-exposed") : check(workspace.branch === `fm/${task}`),
    provider: compare(request?.provider, detail.Provider), model: compare(request?.model, detail.Model),
    mode: compare(request?.mode, detail.Mode), thinking: compare(request?.thinking, detail.Thinking),
    backlog: check(lines.length > 0),
  };
  const statuses = Object.values(checks).map(c => c.status);
  return { schema: "firstmate.launch-metrics", version: 1, key: `${host.id}:${id}`, observedAt: new Date().toISOString(),
    createdAt: Number.isFinite(created) ? new Date(created).toISOString() : null,
    locality: host.id === "local" ? "local" : "remote", host: host.id, agentId: id, task, launchLabel: launch,
    leadId, parentAgentId: identifier(detail.ParentAgentId),
    workspace: workspace ? { id: identifier(workspace.workspaceId), isolation: identifier(workspace.isolation ?? workspace.kind), branch: typeof workspace.branch === "string" ? workspace.branch : null } : null,
    checks, labelChecks,
    checklist: statuses.includes("fail") ? "fail" : statuses.includes("unknown") ? "unknown" : "pass",
    request: request ? { path: request.path, mtime: request.mtime } : null,
    requestToCreatedMs: request && Number.isFinite(created) ? created - Date.parse(request.mtime) : null,
    clockSkewSeconds: typeof skew === "number" ? skew : null,
    remote: host.id === "local" ? null : remoteMetrics(receipts, host.id, task, id) };
}

async function journal() {
  const text = await optional(join(home, "data", "metrics", "launches.jsonl")) ?? "";
  // Refuse a torn/invalid journal. Never append after a partial line or silently erase history.
  if (text && !text.endsWith("\n")) throw new Error("incomplete-journal");
  return text.split("\n").filter(Boolean).map(line => {
    const record = JSON.parse(line);
    if (record.schema !== "firstmate.launch-metrics" || record.version !== 1 || typeof record.key !== "string") throw new Error("invalid-journal");
    return record;
  });
}
async function snapshot(bytes, state) {
  const digest = hash(bytes);
  if (digest === state.backlogHash) return;
  const dir = join(home, "recall", "backlog");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(":", "");
  const temporary = join(dir, `.snapshot-${process.pid}.tmp`);
  await writeFile(temporary, bytes, { mode: 0o600 });
  // A manual rerun can observe two versions in one minute. Preserve both, never overwrite.
  try {
    for (const name of [`${stamp}.md`, `${stamp}-${digest}.md`]) {
      const path = join(dir, name);
      try { await link(temporary, path); break; }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (hash(await readFile(path)) === digest) break;
        if (name.includes(digest)) throw new Error("snapshot-collision");
      }
    }
  } finally { await rm(temporary, { force: true }); }
  state.backlogHash = digest;
}
async function observe() {
  if (!home || !stateDir) throw new Error("missing-environment");
  await mkdir(stateDir, { recursive: true });
  const path = join(stateDir, "launch-metrics.json");
  const raw = await optional(path);
  const state = raw ? JSON.parse(raw) : { version: 1, startedAt: null, hosts: {}, backlogHash: null };
  if (state.version !== 1 || !state.hosts || (state.startedAt !== null && !Number.isFinite(Date.parse(state.startedAt)))) throw new Error("invalid-state");
  const bytes = await readFile(process.env.FIRSTMATE_BACKLOG ?? join(home, "data", "backlog.md"));
  await snapshot(bytes, state);
  await atomic(path, state);
  const records = await journal();
  const recorded = new Set(records.map(r => r.key));
  const catalog = JSON.parse(await optional(join(home, "data", "remote-hosts.json")) ?? '{"hosts":[]}');
  if (!Array.isArray(catalog.hosts)) throw new Error("invalid-catalog");
  const hosts = [{ id: "local" }, ...catalog.hosts.filter(h => identifier(h.serverId)).map(h => ({ ...h, id: h.serverId }))];
  const inputs = await requests();
  const receipts = await receiptRows();
  let failed = false;
  for (const host of hosts) {
    if (host.id !== "local" && !host.online) continue;
    if (Date.now() >= deadline) break;
    try {
      const crew = await listing(host.id);
      if (crew.some(row => !identifier(row.id))) throw new Error("invalid-crew-list");
      if (!Object.hasOwn(state.hosts, host.id)) {
        state.startedAt ??= new Date().toISOString();
        state.hosts[host.id] = { baselineAt: new Date().toISOString(), seen: crew.map(row => row.id) };
        await atomic(path, state);
        continue;
      }
      const seen = new Set(state.hosts[host.id].seen);
      for (const row of crew) {
        if (Date.now() >= deadline) break;
        if (seen.has(row.id)) continue;
        if (!recorded.has(`${host.id}:${row.id}`)) {
          let record;
          try { record = await measure(host, row.id, backlogItems(bytes.toString("utf8")), inputs, receipts); }
          catch {
            failed = true;
            console.error("Launch metrics: a worker could not be measured; it remains eligible for the next run.");
            continue;
          }
          await mkdir(join(home, "data", "metrics"), { recursive: true });
          await appendFile(join(home, "data", "metrics", "launches.jsonl"), JSON.stringify(record) + "\n", { mode: 0o600 });
          recorded.add(record.key);
        }
        seen.add(row.id);
        state.hosts[host.id].seen = [...seen];
        await atomic(path, state);
      }
    } catch {
      failed = true;
      console.error("Launch metrics: a host could not be measured; unseen launches remain eligible for the next run.");
    }
  }
  await atomic(path, state);
  if (failed) process.exitCode = 1;
}
async function report(args) {
  if (!home) throw new Error("missing-home");
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--from", "--to", "--days"].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error("invalid-report-options");
    options[args[i]] = args[i + 1];
  }
  const state = stateDir ? JSON.parse(await optional(join(stateDir, "launch-metrics.json")) ?? "null") : null;
  const from = Date.parse(options["--from"] ?? state?.startedAt ?? "");
  const days = Number(options["--days"] ?? 14);
  const to = options["--to"] ? Date.parse(options["--to"]) : from + days * 86400000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error("report-needs-valid-period");
  const records = await journal();
  // Receipts without a resulting worker must also appear in error counts. These are
  // immutable source receipts, read at report time, not invented per-launch attempts.
  const receipts = await receiptRows();
  const receiptActions = [...new Set(receipts.map(r => r.requestId))].map(id => {
    const parts = receipts.filter(r => r.requestId === id);
    const at = parts.find(r => r.phase === "started")?.at ?? parts[0].at;
    return { ...(parts.find(r => r.phase !== "started") ?? { ...parts[0], phase: "uncertain" }), at };
  }).filter(r => Date.parse(r.at) >= from && Date.parse(r.at) < to);
  const selected = [...new Map(records.map(r => [r.key, r])).values()].filter(r => {
    const time = Date.parse(r.createdAt ?? r.observedAt);
    return time >= from && time < to;
  });
  const groups = {};
  for (const locality of ["local", "remote"]) {
    const launches = selected.filter(r => r.locality === locality);
    const counts = values => Object.fromEntries(["pass", "fail", "unknown", "not-applicable"].map(s => [s, values.filter(v => v === s).length]));
    const checklist = counts(launches.map(r => r.checklist));
    const latency = launches.map(r => r.requestToCreatedMs).filter(n => typeof n === "number" && n >= 0).sort((a, b) => a - b);
    const actions = [...new Map(launches.flatMap(r => r.remote?.observedDispatchActions ?? []).map(a => [a.requestId, a])).values()]
      .filter(a => Date.parse(a.at) >= from && Date.parse(a.at) < to);
    groups[locality] = { launches: launches.length, checklist,
      checklistPassRate: checklist.pass + checklist.fail ? checklist.pass / (checklist.pass + checklist.fail) : null,
      checklistCoverage: launches.length ? (checklist.pass + checklist.fail) / launches.length : null,
      checks: Object.fromEntries([...new Set(launches.flatMap(r => Object.keys(r.checks)))].map(k => [k, counts(launches.map(r => r.checks[k]?.status ?? "unknown"))])),
      latency: { samples: latency.length, medianMs: latency.length ? (latency[Math.floor((latency.length - 1) / 2)] + latency[Math.floor(latency.length / 2)]) / 2 : null,
        negativeSamples: launches.filter(r => r.requestToCreatedMs < 0).length, clock: "raw CreatedAt minus request mtime; remote clocks may differ" },
      observedDispatchActions: actions.length, remoteErrorsByCause: { unknown: actions.filter(a => a.outcome === "failed").length },
      uncertainDispatchActions: actions.filter(a => a.outcome === "uncertain").length,
      verifiedLaunchAttemptsLowerBound: launches.reduce((sum, r) => sum + (r.remote?.verifiedLaunchAttempts ?? 0), 0),
      remoteFirstAttemptSuccessRate: null };
  }
  console.log(JSON.stringify({ schema: "firstmate.launch-metrics-report", version: 1, from: new Date(from).toISOString(), to: new Date(to).toISOString(),
    periodComplete: Date.now() >= to, baselineStartedAt: state?.startedAt ?? null, hostBaselines: state ? Object.fromEntries(Object.entries(state.hosts).map(([id, h]) => [id, h.baselineAt])) : null,
    timeBasis: "CreatedAt, falling back to observedAt when unavailable; [from,to)",
    receiptTotals: { source: "data/remote-action-receipts at report time; includes dispatches with no observed worker", observedDispatchActions: receiptActions.length,
      errorsByCause: { unknown: receiptActions.filter(r => r.phase === "failed").length }, uncertain: receiptActions.filter(r => r.phase === "uncertain").length },
    groups }, null, 2));
}
try {
  const args = process.argv.slice(2);
  if (args[0] === "--report") await report(args.slice(1));
  else if (args.length) throw new Error("invalid-options");
  else await withLock(observe);
} catch {
  console.error("Launch metrics failed: check environment, CLI availability, state and input JSON. Report requires --from <ISO date> or FIRSTMATE_WATCH_STATE.");
  process.exitCode = 1;
}
