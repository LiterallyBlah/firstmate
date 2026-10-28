#!/usr/bin/env node
// Default-off Build A project administration. Same-user role convention, not authenticated IPC.
// No provisioning or Attach command is accepted. The captain uses explicit app buttons.
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
  if (["attach", "provision", "provision-ui"].includes(command.op)) throw new Error("Project provisioning and Attach are explicit captain app actions.");
  if (!["read", "memory-read"].includes(command.op)) {
    const role = await execute(process.execPath, [join(home, "tools/role.mjs")], { cwd: home, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, timeout: 30000 });
    if (role.stdout.trim() !== "first-mate" || !process.env.PASEO_AGENT_ID) throw new Error("Only the current first mate records project administration.");
  }
  const directory = join(home, "data/project-requests"); await mkdir(directory, { recursive: true }); await inside("data/project-requests");
  const path = join(directory, `${id}.json`), bytes = JSON.stringify({ id, actor: process.env.PASEO_AGENT_ID ?? "guest", command });
  try { if (await readFile(path, "utf8") !== bytes) throw new Error("Request ID has different content."); }
  catch (e) {
    if (e.code !== "ENOENT") throw e;
    const temporary = `${path}.${randomUUID()}.tmp`, file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    try { await link(temporary, path); } catch (error) { if (error.code !== "EEXIST" || await readFile(path, "utf8") !== bytes) throw error; } finally { await rm(temporary, { force: true }); }
  }
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { const reply = JSON.parse(await readFile(await inside(`data/project-requests/${id}.reply.json`), "utf8")); if (!reply.ok) throw new Error(reply.error); return reply.result; }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`No reply. Request ${id} remains queued; reuse --request-id ${id}.`);
}
export async function main(argv) {
  if (argv[0] === "read" && argv.length === 1) return submit({ op: "read" });
  if (argv[0] !== "command" || argv[1] !== "--file" || !argv[2] || ![3, 5].includes(argv.length) || argv.length === 5 && argv[3] !== "--request-id") throw new Error("Usage: projects.mjs read | command --file <home-json> [--request-id <uuid>]. See data/project-mates.md.");
  return submit(JSON.parse((await readFile(await inside(argv[2]), "utf8")).replace(/^\uFEFF/, "")), argv[4]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify({ ok: true, result: await main(process.argv.slice(2)) }, null, 2)); }
  catch (e) { console.log(JSON.stringify({ ok: false, error: e.message })); process.exitCode = 1; }
}
