#!/usr/bin/env node
// Plugin-owned scope transport for a plan supervisor, a home guest bound to one scope epoch.
// Seeded when plan help is enabled; retained for read/receipt reconciliation while paused. tools/role.mjs remains the only
// global first-mate check; this helper never grants or borrows that role. Request files are
// cooperative same-user transport, not authenticated identity. Never repeat a create.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, open, link, rm, realpath } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const home = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execute = promisify(execFile);
async function inside(path) {
  const root = await realpath(home), target = await realpath(resolve(root, path)), rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("File must be inside the home.");
  return target;
}
export async function submit(kind, input, id = randomUUID()) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Use a UUID request id.");
  if (!process.env.PASEO_AGENT_ID) throw new Error("A scope supervisor needs its own PASEO_AGENT_ID.");
  const role = await execute(process.execPath, [join(home, "tools/role.mjs")], { cwd: home, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, timeout: 30000 });
  if (role.stdout.trim() === "first-mate" && !["policy", "rules", "artifact"].includes(kind)) throw new Error("The global first mate uses tools/workflow.mjs; scope commands belong to plan supervisors.");
  const directory = join(home, "data/scope-requests"); await mkdir(directory, { recursive: true });
  await inside("data/scope-requests");
  const path = join(directory, `${id}.json`), bytes = JSON.stringify({ id, actor: process.env.PASEO_AGENT_ID, kind, input });
  try { if (await readFile(path, "utf8") !== bytes) throw new Error("Request ID has different content."); }
  catch (e) {
    if (e.code !== "ENOENT") throw e;
    const temporary = `${path}.${randomUUID()}.tmp`, file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    try { await link(temporary, path); } catch (error) { if (error.code !== "EEXIST" || await readFile(path, "utf8") !== bytes) throw error; } finally { await rm(temporary, { force: true }); }
  }
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { const reply = JSON.parse(await readFile(join(directory, `${id}.reply.json`), "utf8")); if (!reply.ok) throw new Error(reply.code ? `${reply.code}: ${reply.error}` : reply.error); return reply.result; }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`No reply. Request ${id} remains queued; inspect and reuse --request-id ${id}. Never repeat a create.`);
}
export async function main(argv) {
  const [kind, ...rest] = argv, options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.slice(2);
    if (!["file", "request-id"].includes(key) || key in options || !rest[i + 1]) throw new Error("Invalid or repeated option.");
    options[key] = rest[i + 1];
  }
  if (!["plan", "continuation", "inbox", "outbox", "read", "rule-verification", "rule-failure", "policy-evidence", "policy", "rules", "pr-bind", "artifact", "project-result", "stop-worker"].includes(kind) || !options.file) throw new Error("Usage: scope.mjs <kind> --file <json> [--request-id <uuid>]");
  const input = JSON.parse((await readFile(await inside(options.file), "utf8")).replace(/^﻿/, ""));
  return submit(kind, input, options["request-id"]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify({ ok: true, result: await main(process.argv.slice(2)) }, null, 2)); }
  catch (e) { console.log(JSON.stringify({ ok: false, error: e.message })); process.exitCode = 1; }
}
