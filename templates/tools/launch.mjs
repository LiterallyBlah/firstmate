#!/usr/bin/env node
// Optional first-mate tool. Local creation stays in the lead's own MCP calls.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, realpath, lstat, open, link, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { submit as workflowCommand } from "./workflow.mjs";

const config = {{launchConfigJson}};
const execute = promisify(execFile);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
// A retry before a launch record exists reuses the exact transport intent.
const workflowRequestId = (id, number, op) => {
  const value = hash(`${id}:${number}:${op}`);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
};
const now = () => new Date().toISOString();
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const manual = "Use the charter's manual §6; panels: remote.mjs --request-file / create_agent in the existing workspace; promotion: send_agent_prompt / remote send; relaunch: charter §7.";
const uncertainty = "Paseo may still be creating the worker; registration has no time bound. Never retry by any route. Inspect, then wait and run status, or abandon with inspection evidence and accepted duplicate risk.";
const backlogWarning = "Best-effort: an edit between compare and rename can be overwritten without detection. Never batch this tool with other backlog edits; restore the exact line from the launch record if needed.";
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function strict(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid-request", `${name} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail("invalid-request", `Unknown ${name} field: ${key}`);
}
function text(value, name, max = 10000, delimiters = false) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value) || (delimiters && /[()]/.test(value))) fail("invalid-request", `Invalid ${name}`);
  return value;
}
function task(value) { if (typeof value !== "string" || !ID.test(value)) fail("invalid-id", "Use a task id of 1–64 lowercase letters, digits or hyphens"); return value; }
function utf8(bytes) { try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail("invalid-utf8", "File is not UTF-8"); } }
const json = bytes => JSON.parse(utf8(bytes).replace(/^\uFEFF/, ""));
const fill = (source, values) => source.replace(/\{\{([a-zA-Z]+)\}\}/g, (whole, name) => values[name] ?? whole);
const noNotes = source => source.replace(/<!--[\s\S]*?-->/g, "").trim();

/** Contain reads and writes, including existing symlink/junction parents. */
async function inside(path) {
  const root = await realpath(config.home), target = resolve(root, path);
  const check = value => { const rel = relative(root, value); if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail("outside-home", "Path must be inside the home"); };
  check(target);
  let ancestor = target;
  for (;;) {
    try { await lstat(ancestor); check(await realpath(ancestor)); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; ancestor = dirname(ancestor); if (ancestor === root) break; }
  }
  return target;
}
async function read(path) { return readFile(await inside(path)); }
const env = () => {
  const result = { ...process.env, ...config.cli?.env, PASEO_HOME: config.paseoHome, ELECTRON_RUN_AS_NODE: "1" };
  for (const key of Object.keys(result)) if (/^PASEO_(HOST|PASSWORD|LOCAL_CREDENTIAL)$/i.test(key)) delete result[key];
  return result;
};
async function node(args, timeout = 30000) { return execute(process.execPath, args, { cwd: config.home, env: env(), windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }); }
async function role() {
  // Preserve the caller's daemon hint: role.mjs must be able to reject a different home.
  const result = await execute(process.execPath, [join(config.home, "tools/role.mjs")], { cwd: config.home, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, timeout: 30000 });
  if (result.stdout.trim() !== "first-mate" || !process.env.PASEO_AGENT_ID) fail("not-first-mate", "Only the current first mate may change launch records");
  return process.env.PASEO_AGENT_ID;
}
async function cli(args) {
  if (!config.cli) fail("cli-unavailable", "Paseo CLI unavailable; use the manual route");
  try {
    const result = await execute(config.cli.command, [...config.cli.args, ...args, "--home", config.paseoHome, "--json"], { cwd: config.home, env: env(), windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(result.stdout);
  } catch { fail("cli-read-failed", `Paseo ${args[0]} read failed; absence is not established`); }
}
async function remote(host, args) {
  // remote.mjs owns the queue, prompt expansion and action receipts. No credentials here.
  const result = await node([join(config.home, "tools/remote.mjs"), host, ...args], 190000);
  return JSON.parse(result.stdout);
}
const query = (record, args) => record.host === "local" ? cli(args) : remote(record.host, [...args, "--json"]);
function rows(value) { if (!Array.isArray(value)) fail("invalid-response", "Expected a Paseo list; absence is not established"); return value; }
async function write(path, bytes) {
  await role(); const target = await inside(path);
  await mkdir(dirname(target), { recursive: true }); await writeFile(await inside(path), bytes, { mode: 0o600 });
}
async function atomic(path, value, exclusive = false) {
  await role(); const target = await inside(path), temporary = `${target}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
  try { if (exclusive) await link(temporary, target); else await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; } }
async function locked(path, action) {
  await role(); const target = await inside(path); await mkdir(dirname(target), { recursive: true });
  let handle;
  try { handle = await open(await inside(path), "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    let lock; try { lock = json(await read(path)); } catch { /* Malformed lock is never broken. */ }
    fail(lock?.pid && !alive(lock.pid) ? "stale-lock" : "locked", `Lock retained: ${path}. Inspect it; unlock explicitly after its writer is gone.`);
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: now() })); return await action(); }
  finally { await handle.close(); await rm(target); }
}
const directory = id => `data/${task(id)}/launches`;
const recordPath = (id, attempt) => `${directory(id)}/${attempt}.json`;
async function attempts(id) {
  let names; try { names = await readdir(await inside(directory(id))); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return Promise.all(names.filter(name => /^[1-9]\d*\.json$/.test(name)).sort((a, b) => parseInt(a) - parseInt(b)).map(name => read(`${directory(id)}/${name}`).then(json)));
}
async function load(id, attempt) { return json(await read(recordPath(id, attempt))); }
function handover(record, recorder) {
  return { recorder, handover: recorder !== record.launchedBy, ...(recorder === record.launchedBy ? {} : { warning: `Paseo's note for this worker went to ${record.launchedBy}, which is gone; you will not be notified. Check it on your heartbeat.` }) };
}
async function update(record, changes) {
  return locked(`${directory(record.id)}/.lock`, async () => {
    const current = await load(record.id, record.attempt);
    if (current.revision !== record.revision) fail("record-changed", "Launch record changed; inspect status before continuing");
    const actor = handover(current, await role());
    const next = { ...current, ...changes, ...actor, revision: current.revision + 1, updatedAt: now(), history: [...current.history, { at: now(), state: changes.state ?? current.state, ...actor }] };
    await atomic(recordPath(record.id, record.attempt), next);
    if (next.workflow && ["unresolved", "failed", "abandoned"].includes(changes.state)) await workflowCommand({ op: "record", plan: next.workflow.plan, node: next.workflow.node, attempt: next.workflow.attempt,
      state: changes.state === "failed" ? "failed" : "unresolved", evidence: changes.reason ?? changes.error ?? "Launch outcome requires inspection; no create may be repeated blindly." });
    return next;
  });
}

/** Preserve every untouched byte, including mixed line endings and the BOM. */
export function backlogLines(bytes) {
  const source = utf8(bytes), bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
  const lines = source.slice(bom.length).match(/[^\r\n]*(?:\r\n|\n|\r|$)/g).filter(Boolean);
  let section = null;
  return { bom, lines: lines.map(raw => {
    const content = raw.replace(/[\r\n]+$/, "");
    const heading = /^#{2,3}\s+(.*)$/.exec(content);
    if (heading) section = /^(in[\s-]*flight)\b/i.test(heading[1]) ? "In flight" : /^(queued|queue|next|charted)\b/i.test(heading[1]) ? "Queued" : /^(done|landed|finished)\b/i.test(heading[1]) ? "Done" : null;
    const item = /^\s*[-*]\s+\[[ xX~-]\]\s+([\w.-]+)\s+[-–—]\s+(.*)$/.exec(content);
    return { raw, content, section, id: item?.[1], title: item?.[2]?.split(/\([a-zA-Z][\w-]*\s*:/)[0].trim() };
  }) };
}
function itemFor(bytes, id) { const found = backlogLines(bytes).lines.filter(line => line.id === id); if (found.length > 1) fail("ambiguous-backlog", "Multiple lines for this task; reconcile manually"); return found[0]; }
const group = (line, key) => new RegExp(`\\(${key}\\s*:\\s*([^()]*)\\)`, "i").exec(line ?? "")?.[1]?.trim();
function gates(request, item) {
  const blocked = group(item?.content, "blocked-by") ?? /\bblocked-by:\s*([\w.-]+)/i.exec(item?.content ?? "")?.[1];
  if (blocked && !request.dependency) fail("dependency-evidence-required", `Dependency ${blocked} needs satisfiedBy evidence; missing history is unknown`);
  const hold = group(item?.content, "hold") ?? (group(item?.content, "kind") === "captain" ? item.title : null);
  if (hold && request.captainAuthority?.hold !== hold) fail("captain-authority-required", `Authority must bind exactly to this hold: ${hold}`);
  if (request.captainAuthority && request.captainAuthority.hold !== hold) fail("authority-mismatch", "Authority is not bound to this item's hold");
}
function lineFor(request, old, agent) {
  const title = old?.title ?? request.title;
  let line = old?.content ?? `- [ ] ${request.id} - ${title}`;
  for (const key of ["project", "kind", "mode", "agent", "crewmate", "host", "on-host", "blocked-by", "hold"]) line = line.replace(new RegExp(`\\s*\\(${key}\\s*:[^()]*\\)`, "gi"), "");
  line = line.replace(/\s+blocked-by:\s*[\w.-]+/gi, "").replace(/\[[ xX~-]\]/, "[ ]");
  line += ` (project: ${request.project}) (kind: ${request.kind}) (mode: ${request.mode})`;
  if (agent) line += `${request.host === "local" ? "" : ` (host: ${request.host})`} (agent: ${agent})`;
  if (!old && request.backlog.tags?.length) line += ` (tags: ${request.backlog.tags.join(", ")})`;
  const notes = [request.backlog.note, request.dependency && `Dependency satisfied: ${request.dependency.satisfiedBy}`, request.captainAuthority && `Hold ${request.captainAuthority.hold}; authority: ${request.captainAuthority.authority}`].filter(Boolean);
  for (const note of notes) if (!line.includes(`(note: ${note})`)) line += ` (note: ${note})`;
  return line;
}
export function backlogEdit(bytes, id, line, section) {
  const parsed = backlogLines(bytes), eol = /\r\n|\n|\r/.exec(utf8(bytes))?.[0] ?? "\n";
  const previous = itemFor(bytes, id), lines = parsed.lines.filter(item => item.id !== id);
  const index = lines.findIndex(item => /^#{2,3}\s/.test(item.content) && item.section === section);
  if (index < 0) fail("backlog-section-missing", `Backlog has no ${section} heading`);
  const ending = previous?.raw.slice(previous.content.length) || eol;
  if (index === lines.length - 1 && !/[\r\n]$/.test(lines[index].raw)) lines[index] = { ...lines[index], raw: lines[index].raw + eol };
  lines.splice(index + 1, 0, { raw: line + ending });
  return Buffer.from(parsed.bom + lines.map(item => item.raw).join(""));
}
/** Hooks allow deterministic verification of the two observable conflict boundaries. */
export async function replaceBacklog(path, before, after, line, hooks = {}) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, after, { flag: "wx", mode: 0o600 });
  try {
    await hooks.beforeCompare?.();
    if (!(await readFile(path)).equals(before)) { await readFile(path); fail("backlog-changed", "Backlog changed before compare; re-read once, no overwrite"); }
    // Another writer can land here and be overwritten without detection. This is NOT CAS.
    await rename(temporary, path);
    await hooks.afterRename?.();
    if (!backlogLines(await readFile(path)).lines.some(item => item.content === line)) fail("backlog-line-missing", "Backlog line missing after rename; restore it from the launch record");
  } finally { await rm(temporary, { force: true }); }
}
async function backlog(record, section, agent) {
  return locked("data/.backlog.lock", async () => {
    const bytes = await read("data/backlog.md"), old = itemFor(bytes, record.id);
    if (section === "Queued") {
      if (record.queuedPreimage !== (old?.content ?? null)) fail("backlog-changed", "Task changed since validation; reconcile manually");
      gates(record.request, old);
    } else if (old && !["Queued", "In flight"].includes(old.section)) fail("backlog-changed", "Task moved elsewhere; reconcile manually");
    const line = lineFor(record.request, old, agent);
    // Persist the recovery line before touching the backlog, even when replacement fails.
    record = await update(record, { backlog: { section, line, changed: false, warning: backlogWarning } });
    const next = backlogEdit(bytes, record.id, line, section);
    await role();
    try { await replaceBacklog(await inside("data/backlog.md"), bytes, next, line); }
    catch (error) { return update(record, { backlog: { ...record.backlog, error: error.code ?? "backlog-write-failed" } }); }
    return update(record, { backlog: { ...record.backlog, changed: !next.equals(bytes) } });
  });
}

function validate(request) {
  if (request && typeof request === "object" && ["workspaceId", "workspace", "relaunch", "relaunchOf", "promotion", "promote", "agentId"].some(key => Object.hasOwn(request, key))) fail("unsupported-before-effects", manual);
  strict(request, ["id", "title", "agentTitle", "project", "host", "baseBranch", "kind", "mode", "brief", "agent", "backlog", "dependency", "captainAuthority", "workflow"], "request");
  if (request.workflow) { strict(request.workflow, ["plan", "node", "attempt", "briefHash"], "workflow"); for (const key of ["plan", "node", "attempt", "briefHash"]) text(request.workflow[key], key, 100); }
  task(request.id); text(request.title, "title", 120, true); text(request.agentTitle, "agentTitle", 60);
  for (const key of ["project", "host", "baseBranch", "mode"]) text(request[key], key, 200, true);
  if (!/^[^\s~^:?*[\\]+$/.test(request.baseBranch) || request.baseBranch.startsWith("-") || request.baseBranch.includes("..") || request.baseBranch.includes("@{")) fail("invalid-request", "Invalid baseBranch");
  if (!["ship", "scout"].includes(request.kind)) fail("invalid-request", "kind must be ship or scout");
  strict(request.agent, ["provider", "modeId", "thinkingOptionId"], "agent");
  if (!/^[a-zA-Z0-9_-]+\/[^\s\x00-\x1f]+$/.test(request.agent.provider ?? "")) fail("invalid-request", "Use provider/model");
  text(request.agent.modeId, "modeId", 100);
  if (request.agent.thinkingOptionId !== undefined) text(request.agent.thinkingOptionId, "thinkingOptionId", 100);
  strict(request.backlog, ["existing", "note", "tags"], "backlog");
  if (!["none", "adopt"].includes(request.backlog.existing)) fail("invalid-request", "backlog.existing must be none or adopt");
  if (request.backlog.note !== undefined) text(request.backlog.note, "note", 10000, true);
  if (request.backlog.tags !== undefined) {
    if (!Array.isArray(request.backlog.tags) || request.backlog.tags.length > 12) fail("invalid-request", "Use at most 12 tags");
    for (const tag of request.backlog.tags) { text(tag, "tag", 40, true); if (tag.includes(",")) fail("invalid-request", "No comma in a tag"); }
  }
  if (request.dependency !== undefined) { strict(request.dependency, ["satisfiedBy"], "dependency"); text(request.dependency.satisfiedBy, "satisfiedBy", 10000, true); }
  if (request.captainAuthority !== undefined) { strict(request.captainAuthority, ["hold", "authority"], "captainAuthority"); text(request.captainAuthority.hold, "hold", 10000, true); text(request.captainAuthority.authority, "authority", 10000, true); }
  strict(request.brief, ["assemble", "file"], "brief");
  if (Object.keys(request.brief).length !== 1) fail("invalid-request", "brief needs exactly one of assemble or file");
  if (request.brief.file !== undefined && request.brief.file !== `data/${request.id}/brief.md`) fail("invalid-request", "Full brief must be data/<id>/brief.md");
  if (request.brief.assemble !== undefined) {
    strict(request.brief.assemble, ["intent", "spec", "rules"], "assemble");
    for (const key of ["intent", "spec"]) {
      const value = request.brief.assemble[key];
      if (typeof value !== "string") { strict(value, ["file"], key); text(value.file, `${key}.file`); }
      else if (!value.trim()) fail("invalid-request", `${key} must not be empty`);
    }
    const rules = request.brief.assemble.rules;
    if (rules !== null) {
      if (typeof rules !== "string") strict(rules, ["file"], "rules");
      if (!/^data\/[a-zA-Z0-9_-]+-rules\.md$/.test(typeof rules === "string" ? rules : rules?.file ?? "")) fail("invalid-request", "rules must be a data/*-rules.md path or null");
    }
  }
}
async function briefFor(request) {
  let bytes;
  if (request.brief.file) bytes = await read(request.brief.file);
  else {
    const source = request.brief.assemble;
    const content = async value => typeof value === "string" ? value : utf8(await read(value.file));
    const delivery = request.kind === "scout" ? request.host === "local"
      ? `Write data/${request.id}/report.md in the first mate's home at ${config.home}: findings, evidence and recommendations. Never open a pull request.`
      : `Return the full report in the final reply for the first mate to save as data/${request.id}/report.md: findings, evidence and recommendations. The local home is not available on this host. Never open a pull request.`
      : request.mode === "local-only" ? `Leave a clean branch fm/${request.id}; no push or pull request. Report done: ready in branch fm/${request.id}.`
      : request.mode === "direct-PR" ? "Push the task branch and open a pull request ready for review, not a draft. Report done: PR <full URL>."
      : request.mode === "reviewed-PR" ? "Review the whole diff, run the full test suite, push the task branch and open a pull request ready for review. Wait for green CI. Report done: PR <full URL> checks green."
      : request.mode;
    const rules = source.rules === null ? fill(config.parts.rules, { id: request.id, baseBranch: request.baseBranch.replace(/^origin\//, ""), delivery }) : utf8(await read(typeof source.rules === "string" ? source.rules : source.rules.file));
    bytes = Buffer.from(fill(config.parts.template, { intro: config.parts.intro, intent: await content(source.intent), spec: await content(source.spec), rules, done: delivery, status: config.parts.status }));
  }
  const value = utf8(bytes);
  if (!value.trim() || /\x00/.test(value) || /__[A-Za-z0-9_]+__/.test(value)) fail("invalid-brief", "Brief is empty, contains NUL or has an unfilled __PLACEHOLDER__");
  if (!/^#{1,6}\s+Status[ -]line\s*$/im.test(value)) fail("invalid-brief", "Brief needs a status-line section");
  if (request.host !== "local" && value.replace(/^\uFEFF/, "").length > 28000) fail("brief-too-large", "Remote brief exceeds 28,000 characters");
  return { bytes, value, path: `data/${request.id}/brief.md`, fileSha256: hash(bytes), payloadSha256: hash(Buffer.from(value.replace(/\r\n/g, "\n").trim())), chars: value.length };
}
async function resolveRequest(request) {
  let projects, host = "local";
  if (request.host === "local") projects = rows(await cli(["project", "ls"]));
  else {
    const catalog = json(await read("data/remote-hosts.json"));
    const matches = (catalog.hosts ?? []).filter(item => item.serverId === request.host || item.label === request.host);
    if (matches.length !== 1 || !matches[0].online) fail("host-unavailable", "Remote host is unknown, ambiguous or offline");
    host = text(matches[0].serverId, "host id", 200, true); projects = rows(matches[0].projects);
  }
  const selected = projects.filter(item => item.name === request.project || item.projectId === request.project);
  if (selected.length !== 1 || typeof selected[0].path !== "string" || !(isAbsolute(selected[0].path) || win32.isAbsolute(selected[0].path))) fail("project-unavailable", "Project must resolve to one Paseo checkout");
  const project = selected[0]; text(project.name, "project name", 200, true);
  const resolved = { ...request, host, project: project.name };
  const provider = request.agent.provider.split("/")[0], model = request.agent.provider.slice(provider.length + 1);
  const models = rows(await query(resolved, ["provider", "models", provider]));
  const chosen = models.find(item => item.id === model);
  if (!chosen || (request.agent.thinkingOptionId && !chosen.thinkingOptionIds?.includes(request.agent.thinkingOptionId))) fail("invalid-model", "Provider model or thinking option is not offered on this host");
  return { request: resolved, path: project.path };
}
async function labelled(record, all = true) {
  const filters = [[config.labels.task, record.id], ["firstmate.launch", `${record.id}.a${record.attempt}`]];
  if (all && record.host === "local") filters.push([config.labels.role, config.labels.crewRole], [config.labels.kind, record.request.kind], [config.labels.project, record.request.project]);
  return rows(await query(record, ["ls", "-a", "-g", ...filters.flatMap(([key, value]) => ["--label", `${key}=${value}`])]));
}
async function available(previous) {
  if (previous.some(item => ["issued", "unresolved"].includes(item.state))) fail("attempt-open", uncertainty);
  for (const record of previous.filter(item => item.state === "recorded")) {
    // A captain may have changed labels, and an ordinary listing can omit persisted
    // sessions. Read the recorded identity directly; a failed read never means gone.
    const detail = await query(record, ["inspect", record.agent]);
    if (detail?.Archived !== true) fail("unsupported-before-effects", `Recorded worker is live or not known archived. ${manual}`);
  }
}
function output(record, prompt) {
  const labels = { [config.labels.role]: config.labels.crewRole, [config.labels.task]: record.id, [config.labels.kind]: record.request.kind, [config.labels.project]: record.request.project, "firstmate.launch": `${record.id}.a${record.attempt}` };
  const { provider, ...settings } = record.request.agent;
  return { ok: true, ...record, ...(record.host !== "local" ? {} : {
    createWorkspace: { isolation: "worktree", path: record.projectPath, branchName: `fm/${record.id}`, baseBranch: record.request.baseBranch, worktreeSlug: record.id, title: record.request.title },
    createAgent: { title: record.request.agentTitle, provider, settings, labels, notifyOnFinish: true, initialPrompt: prompt, workspaceId: "<from create_workspace>" },
    next: `Call create_workspace, then create_agent exactly once with these arguments. Then record ${record.id} --attempt ${record.attempt} --agent <id> --workspace <wks> [--armed only if Paseo said you will be notified]. On error or no answer: unresolved ${record.id} --attempt ${record.attempt}. Never repeat create_agent for this attempt.`,
  }) };
}
async function prepare(file, dryRun) {
  const request = json(await read(file)); validate(request); await role();
  const previous = await attempts(request.id);
  await available(previous);
  const existing = itemFor(await read("data/backlog.md"), request.id);
  const owned = existing && previous.some(item => item.backlog?.line === existing.content);
  // A drafted plan's printed Queued line is already filed before start. Its bound claim below
  // still verifies the exact committed request; this metadata alone grants no launch authority.
  const plannedExisting = request.workflow?.node === request.id && group(existing?.content, "plan") === request.workflow?.plan;
  if (existing && !owned && (existing.section !== "Queued" || (request.backlog.existing !== "adopt" && !plannedExisting))) fail("unsupported-before-effects", `Only a new item or an adopted Queued item is supported. ${manual}`);
  if (!existing && request.backlog.existing === "adopt") fail("invalid-request", "No Queued item to adopt");
  gates(request, existing);
  const brief = await briefFor(request), resolved = await resolveRequest(request);
  const number = (previous.at(-1)?.attempt ?? 0) + 1;
  const record = { version: 1, id: request.id, attempt: number, state: "issued", revision: 0, host: resolved.request.host, request: resolved.request, projectPath: resolved.path,
    launchedBy: await role(), createdAt: now(), history: [], queuedPreimage: existing?.content ?? null, brief: { path: brief.path, fileSha256: brief.fileSha256, payloadSha256: brief.payloadSha256, chars: brief.chars },
    checks: { baseBranch: "unknown: Paseo validates the requested base during creation", arming: "unknown", briefDelivery: "unknown" } };
  if (dryRun) return { ...output(record, brief.value), dryRun: true, state: "dry-run" };
  // The implicit intent pins this assembled file; a later lock refusal may leave
  // an unused brief, but it never exposes creation instructions or a worker.
  if (!request.brief.file) await write(brief.path, brief.bytes);
  const { workflow: binding, ...launchRequest } = resolved.request;
  const launch = { ...launchRequest, brief: { file: brief.path } };
  await locked(`${directory(request.id)}/.lock`, async () => {
    if (JSON.stringify(await attempts(request.id)) !== JSON.stringify(previous)) fail("attempt-changed", "Another prepare changed this task; inspect status");
    if (binding) {
      if (binding.briefHash !== brief.fileSha256) fail("brief-changed", "Brief changed since the plan start intent; replan before dispatch");
      await workflowCommand({ op: "claim", ...binding, launch }, workflowRequestId(request.id, number, "claim")); record.workflow = binding;
    } else {
      const planned = await workflowCommand({ op: "implicit", launch }, workflowRequestId(request.id, number, "implicit"));
      record.workflow = planned.launch.workflow;
    }
    await atomic(recordPath(request.id, number), record, true);
  });
  let saved = await backlog(record, "Queued");
  if (saved.backlog.error) return { ok: false, ...saved, next: uncertainty };
  if (saved.host === "local") return output(saved, brief.value);
  const args = ["run", "--prompt-file", brief.path, "--cwd", resolved.path, "--new-workspace", "worktree", "--worktree-slug", request.id, "--new-branch", `fm/${request.id}`, "--base", request.baseBranch,
    "--provider", request.agent.provider, "--mode", request.agent.modeId, ...(request.agent.thinkingOptionId ? ["--thinking", request.agent.thinkingOptionId] : []), "--title", request.agentTitle,
    ...[[config.labels.task, request.id], [config.labels.kind, request.kind], [config.labels.project, resolved.request.project], ["firstmate.launch", `${request.id}.a${number}`]].flatMap(([key, value]) => ["--label", `${key}=${value}`])];
  const remotePath = `${directory(request.id)}/${number}.remote.json`;
  await write(remotePath, JSON.stringify({ host: saved.host, args }, null, 2) + "\n");
  await role();
  if (hash(await read(brief.path)) !== brief.fileSha256) fail("brief-changed", "Brief changed before remote submission; attempt retained, no run sent");
  let explicitError = false;
  try { await node([join(config.home, "tools/remote.mjs"), "--request-file", join(config.home, remotePath)], 190000); }
  catch (error) { explicitError = /^Remote command failed:/m.test(error.stderr ?? "") && !/timeout|timed out|uncertain|interrupt|cancel/i.test(error.stderr ?? ""); }
  // Always reconcile, even after an explicit error: creation can have had an effect.
  saved = await update(saved, { state: "unresolved", error: explicitError ? "remote-cli-error" : "remote-outcome-needs-reconciliation" });
  return reconcile(saved, explicitError);
}

async function localGit(cwd, args) {
  return (await execute("git", ["-C", cwd, ...args], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })).stdout.trim();
}
async function checksFor(record, agent, workspace) {
  const checks = { arming: "unknown: lead report only", briefDelivery: "unknown: CLI has no typed transcript" };
  let detail, spaces;
  try { const found = await labelled(record); checks.labels = found.length === 1 && found[0].id === agent ? "pass" : "fail"; } catch { checks.labels = "unknown: listing failed"; }
  try { detail = await query(record, ["inspect", agent]); } catch { checks.inspect = "unknown: inspect failed"; }
  try { spaces = rows(await query(record, ["workspace", "ls"])); } catch { checks.workspace = "unknown: workspace listing failed"; }
  const selected = spaces?.filter(item => item.workspaceId === workspace);
  const space = selected?.length === 1 ? selected[0] : undefined;
  if (spaces) checks.workspace = space ? "pass" : "fail";
  if (space) checks.isolation = space.isolation === "worktree" ? "pass" : space.isolation === undefined ? "unknown" : "fail";
  if (record.host === "local") {
    checks.parent = detail && Object.hasOwn(detail, "ParentAgentId") ? detail.ParentAgentId === process.env.PASEO_AGENT_ID ? "pass" : "fail" : "unknown";
    checks.cwd = "unknown"; checks.branch = "unknown"; checks.baseBranch = "unknown";
    if (detail?.Cwd && space?.cwd) {
      try { const canonical = async path => { const value = await realpath(path); return process.platform === "win32" ? value.toLowerCase() : value; }; checks.cwd = await canonical(detail.Cwd) === await canonical(space.cwd) ? "pass" : "fail"; } catch { /* Unknown is not a mismatch. */ }
      try { checks.branch = await localGit(space.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) === `fm/${record.id}` ? "pass" : "fail"; } catch { /* Unknown. */ }
      try {
        const base = await localGit(space.cwd, ["rev-parse", "--verify", `${record.request.baseBranch}^{commit}`]);
        checks.baseBranch = await localGit(space.cwd, ["merge-base", "HEAD", base]) === base ? "pass" : "fail";
      } catch { /* Unknown. */ }
    }
  } else {
    checks.parent = "not-applicable: bridge strips local identity";
    checks.role = checks.owner = "unknown: bridge cannot filter reserved labels";
    checks.kind = checks.project = "unknown: remote listing checks task and launch only";
    checks.cwd = detail?.Cwd && space?.cwd ? detail.Cwd === space.cwd ? "reported-paths-equal" : "reported-paths-differ" : "unknown";
    checks.canonicalCwd = checks.branch = checks.baseBranch = "unknown: bridge has no canonical path or Git read";
  }
  if (detail) {
    const provider = record.request.agent.provider.split("/")[0], model = record.request.agent.provider.slice(provider.length + 1);
    const required = ["Provider", "Model", "Mode", ...(record.request.agent.thinkingOptionId ? ["Thinking"] : [])];
    checks.settings = required.some(key => typeof detail[key] !== "string") ? "unknown" : detail.Provider === provider && detail.Model === model && detail.Mode === record.request.agent.modeId && (!record.request.agent.thinkingOptionId || detail.Thinking === record.request.agent.thinkingOptionId) ? "pass" : "settings-differ";
    checks.observedSettings = { provider: detail.Provider, model: detail.Model, mode: detail.Mode, thinking: detail.Thinking };
  } else checks.settings = "unknown";
  return checks;
}
async function recordWorker(record, agent, workspace, armed = false) {
  if (record.agent && (record.agent !== agent || record.workspace !== workspace)) fail("already-recorded", "This attempt already accounts for a different agent/workspace; reconcile manually without discarding it");
  const checks = await checksFor(record, agent, workspace);
  let saved = await update(record, { state: "recorded", agent, workspace, recordedAt: now(), checks, armed: { reported: armed, by: process.env.PASEO_AGENT_ID, verified: false }, briefDeliveredIntact: "unknown" });
  if (saved.workflow) await workflowCommand({ op: "record", plan: saved.workflow.plan, node: saved.workflow.node, attempt: saved.workflow.attempt, state: "running", agentId: agent, workspaceId: workspace, evidence: "Launch helper inspected the recorded worker; checks remain attached to the launch record." });
  try { saved = await backlog(saved, "In flight", agent); }
  catch (error) { saved = await update(saved, { backlog: { ...saved.backlog, error: error.code ?? "backlog-write-failed" } }); }
  return { ok: true, ...saved, problems: Object.entries(checks).filter(([, value]) => value === "fail").map(([name]) => name) };
}
async function reconcile(record, explicitError = false) {
  let found;
  try { found = await labelled(record, false); } catch { return { ok: false, ...record, next: uncertainty, reconciliation: "unknown: listing failed" }; }
  if (found.length === 1) {
    try {
      const detail = await query(record, ["inspect", found[0].id]), spaces = rows(await query(record, ["workspace", "ls"]));
      const matches = spaces.filter(space => space.cwd === detail.Cwd);
      if (matches.length === 1) return recordWorker(record, found[0].id, matches[0].workspaceId);
    } catch { /* Keep the attempt unresolved and expose the found agent. */ }
    return { ok: false, ...record, found: found.map(item => item.id), next: "Worker found; inspect its workspace, then run record explicitly. Never create again." };
  }
  if (found.length > 1) return { ok: false, ...record, duplicate: true, found: found.map(item => item.id), next: "Multiple workers found; reconcile manually. No archive or relabel is performed." };
  if (explicitError) {
    let partialEffects = "unknown: workspace listing failed";
    try { partialEffects = rows(await query(record, ["workspace", "ls"])).map(item => ({ workspaceId: item.workspaceId, cwd: item.cwd, name: item.name })); } catch { /* Report unknown. */ }
    record = await update(record, { state: "failed", partialEffects, partialEffectsNote: "Inspect this workspace listing for a leftover worktree; no cleanup was performed." });
    return { ok: false, ...record, next: "Explicit remote CLI error and no matching worker observed. Inspect partial effects before deliberately preparing a new attempt; no automatic retry was performed." };
  }
  return { ok: false, ...record, next: uncertainty };
}
async function status(id) {
  const records = await attempts(id), result = [];
  for (const record of records) {
    try {
      const found = await labelled(record, false);
      result.push({ ...record, found: found.map(item => item.id), duplicate: found.length > 1 || (record.state === "abandoned" && found.length > 0),
        next: found.length ? `Inspect these workers and run record ${id} --attempt ${record.attempt} --agent <id> --workspace <wks>; never create again.` : uncertainty });
    } catch { result.push({ ...record, reconciliation: "unknown: listing failed", next: uncertainty }); }
  }
  return { ok: true, id, attempts: result, readOnly: true };
}
async function unlock(id, backlogLock) {
  await role(); const path = backlogLock ? "data/.backlog.lock" : `${directory(id)}/.lock`, bytes = await read(path), lock = json(bytes);
  if (!Number.isInteger(lock.pid) || lock.pid <= 0 || alive(lock.pid)) fail("lock-live", "Lock writer is live or cannot be established gone; lock retained");
  await role(); if (!(await read(path)).equals(bytes)) fail("lock-changed", "Lock changed; retained");
  await rm(await inside(path)); return { ok: true, unlocked: path };
}
async function render(name, values, out) {
  if (!ID.test(name ?? "")) fail("invalid-template", "Use a template name from data/templates");
  const source = noNotes(utf8(await read(`data/templates/${name}.md`)));
  for (const match of source.matchAll(/\{\{([a-zA-Z]+)\}\}/g)) if (!Object.hasOwn(values, match[1])) fail("missing-placeholder", `Missing --set ${match[1]}=value`);
  const rendered = fill(source, values);
  if (out) {
    if (!/^data\/[a-z0-9][a-z0-9-]{0,63}\/[a-zA-Z0-9_-]+\.md$/.test(out) || /\/(brief|backlog)\.md$/.test(out)) fail("invalid-output", "--out must name a task message Markdown file (not brief/backlog)");
    // Explicit artifact output only; render has no orchestration effects, role check or lock.
    const path = await inside(out); await mkdir(dirname(path), { recursive: true }); await writeFile(await inside(out), rendered + "\n", { flag: "wx", mode: 0o600 });
  }
  return { ok: true, text: rendered, ...(out ? { out } : {}) };
}
const help = `Optional new-task launch helper. Run alone, never alongside backlog edits.
prepare --file data/<id>/launch-request.json [--dry-run]
record <id> --attempt <n> --agent <agentId> --workspace <workspaceId> [--armed]
unresolved <id> --attempt <n> [--error <text>]
abandon <id> --attempt <n> --reason <inspection evidence; duplicate risk accepted>
status <id>                         Read-only; watches abandoned labels too.
unlock <id> [--backlog]              Explicitly remove a lock whose pid is gone.
render <template> --set key=value … [--out data/<id>/<name>.md]
help
Request fields: id, title, agentTitle, project, host (local or saved remote), baseBranch,
kind (ship|scout), mode, brief ({file: data/<id>/brief.md} or {assemble: {intent, spec, rules}}),
agent {provider: provider/model, modeId, thinkingOptionId?}, backlog {existing: none|adopt, note?, tags?},
dependency? {satisfiedBy}, captainAuthority? {hold, authority}. Intent/spec are text or {file};
rules is null or a data/*-rules.md path (or {file}). For kind: captain without hold, bind hold to its title.
${manual}
${uncertainty}
${backlogWarning}
Arming is lead-reported; brief delivery is unknown. Remote branch, ancestry, canonical paths and
reserved labels are unknown. settings-differ is informational. No archive, relabel or retry.
render fills once, sends nothing, and writes only the explicitly requested new message file.`;
export async function main(argv) {
  const [command, ...args] = argv;
  if (command === "help" || !command) return { ok: true, help };
  const allowed = { prepare: ["file", "dry-run"], record: ["attempt", "agent", "workspace", "armed"], unresolved: ["attempt", "error"], abandon: ["attempt", "reason"], status: [], unlock: ["backlog"], render: ["set", "out"] }[command];
  if (!allowed) fail("usage", help);
  const options = {}, positional = [], values = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) { positional.push(args[i]); continue; }
    const key = args[i].slice(2);
    if (!allowed.includes(key) || (Object.hasOwn(options, key) && key !== "set")) fail("usage", `Unknown or repeated option: --${key}`);
    if (["dry-run", "armed", "backlog"].includes(key)) options[key] = true;
    else {
      const value = args[++i]; if (value === undefined || value.startsWith("--")) fail("usage", `Missing --${key} value`);
      options[key] = value;
      if (key === "set") { const match = /^([a-zA-Z]+)=([\s\S]*)$/.exec(value); if (!match || Object.hasOwn(values, match[1])) fail("usage", "Use distinct --set key=value arguments"); values[match[1]] = match[2]; }
    }
  }
  if (positional.length !== (command === "prepare" ? 0 : 1)) fail("usage", help);
  if (command === "render") return render(positional[0], values, options.out);
  if (command === "prepare") { if (!options.file) fail("usage", "prepare needs --file"); return prepare(options.file, options["dry-run"]); }
  const id = task(positional[0]);
  if (command === "status") return status(id);
  await role();
  if (command === "unlock") return unlock(id, options.backlog);
  if (!/^[1-9]\d*$/.test(options.attempt ?? "")) fail("usage", "Use --attempt <positive integer>");
  const record = await load(id, Number(options.attempt));
  if (command === "record") { text(options.agent, "agent", 200, true); text(options.workspace, "workspace", 200, true); return recordWorker(record, options.agent, options.workspace, options.armed); }
  if (command === "abandon") {
    if (record.state === "recorded") fail("unsupported-before-effects", `A recorded worker is accounted for; relaunch is manual. ${manual}`);
    text(options.reason, "reason", 10000);
    return { ok: true, ...await update(record, { state: "abandoned", reason: options.reason }), next: "A new prepare is an explicit new attempt. status continues watching this label for late workers." };
  }
  if (record.state === "recorded") fail("already-recorded", "This attempt is recorded; inspect status instead of reopening it");
  if (options.error !== undefined) text(options.error, "error", 10000);
  return reconcile(await update(record, { state: "unresolved", error: options.error ?? "create returned an error or no answer" }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await main(process.argv.slice(2)); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; }
  catch (error) { console.log(JSON.stringify({ ok: false, code: error.code ?? "launch-error", error: error.message })); process.exitCode = 1; }
}
