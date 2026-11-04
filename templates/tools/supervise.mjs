#!/usr/bin/env node
// Supervisor setup for the current first mate (General): plan-help handover, plan Attach and
// project provisioning through the same checked server paths as the captain's app buttons
// (data/supervisors.md). Same-user role convention, not authenticated IPC. Only the current
// first mate may submit, from within a turn; crewmates and Supervisors are refused here and again by the cooperative role check.
// Handover cancel and hold resolution stay with the captain's app controls.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, open, link, rm, realpath } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const home = resolve(dirname(fileURLToPath(import.meta.url)), ".."), execute = promisify(execFile);
async function inside(path) {
  const root = await realpath(home), target = await realpath(resolve(root, path)), rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("File must be inside the home.");
  return target;
}
export async function submit(command, id = randomUUID()) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Use a UUID request id.");
  if (command.op === "migrate" && ["abort", "resolve-hold"].includes(command.command?.op))
    throw new Error("Canceling a handover and resolving its holds stay with the captain's app controls.");
  const role = await execute(process.execPath, [join(home, "tools/role.mjs")], { cwd: home, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, timeout: 30000 });
  if (role.stdout.trim() !== "first-mate" || !process.env.PASEO_AGENT_ID) throw new Error("Only the current first mate sets up Supervisors.");
  const directory = join(home, "data/supervise-requests"); await mkdir(directory, { recursive: true }); await inside("data/supervise-requests");
  const path = join(directory, `${id}.json`), bytes = JSON.stringify({ id, actor: process.env.PASEO_AGENT_ID, command });
  try { if (await readFile(path, "utf8") !== bytes) throw new Error("Request ID has different content."); }
  catch (e) {
    if (e.code !== "ENOENT") throw e;
    const temporary = `${path}.${randomUUID()}.tmp`, file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    try { await link(temporary, path); } catch (error) { if (error.code !== "EEXIST" || await readFile(path, "utf8") !== bytes) throw error; } finally { await rm(temporary, { force: true }); }
  }
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { const reply = JSON.parse(await readFile(await inside(`data/supervise-requests/${id}.reply.json`), "utf8")); if (!reply.ok) throw new Error(reply.error); return reply.result; }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`No reply yet. Request ${id} remains queued; reuse --request-id ${id} only while no reply exists. After an error reply, fix the cause and submit a new request id (attach-resume or project-provision-resume for an interrupted setup).`);
}
export async function main(argv) {
  if (argv[0] === "activation" && argv.length === 1) return submit({ op: "activation" });
  if (argv[0] === "backup-read" && argv.length === 1) return submit({ op: "backup-read" });
  if (argv[0] !== "command" || argv[1] !== "--file" || !argv[2] || ![3, 5].includes(argv.length) || argv.length === 5 && argv[3] !== "--request-id") throw new Error("Usage: supervise.mjs activation | backup-read | command --file <home-json> [--request-id <uuid>]. See data/supervisors.md.");
  return submit(JSON.parse((await readFile(await inside(argv[2]), "utf8")).replace(/^﻿/, "")), argv[4]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify({ ok: true, result: await main(process.argv.slice(2)) }, null, 2)); }
  catch (e) { console.log(JSON.stringify({ ok: false, error: e.message })); process.exitCode = 1; }
}
