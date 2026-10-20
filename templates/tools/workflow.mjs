#!/usr/bin/env node
// Plugin-owned home transport. Durable commands, never worker dispatch.
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
export async function submit(command, id = randomUUID()) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Use a UUID request id.");
  const readOnly = ["plans", "show", "agenda"].includes(command.op);
  if (!readOnly) {
    const role = await execute(process.execPath, [join(home, "tools/role.mjs")], { cwd: home, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, timeout: 30000 });
    if (role.stdout.trim() !== "first-mate" || !process.env.PASEO_AGENT_ID) throw new Error("Only the current first mate may change a plan.");
  }
  const directory = join(home, "data/workflow-requests"); await mkdir(directory, { recursive: true });
  // Resolve the created directory too: a junction is never a transport escape.
  await inside("data/workflow-requests");
  const path = join(directory, `${id}.json`), request = { id, actor: process.env.PASEO_AGENT_ID ?? "guest", command };
  const bytes = JSON.stringify(request);
  try { if (await readFile(path, "utf8") !== bytes) throw new Error("Request ID has different content."); }
  catch (e) {
    if (e.code !== "ENOENT") throw e;
    const temporary = `${path}.${randomUUID()}.tmp`, file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    try { await link(temporary, path); } catch (error) { if (error.code !== "EEXIST" || await readFile(path, "utf8") !== bytes) throw error; } finally { await rm(temporary, { force: true }); }
  }
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { const reply = JSON.parse(await readFile(join(directory, `${id}.reply.json`), "utf8")); if (!reply.ok) throw new Error(reply.error); return reply.result; }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`No reply. Request ${id} remains queued; inspect and reuse --request-id ${id}. Never repeat a create.`);
}
export async function main(argv) {
  const args = argv.filter(a => a !== "--json"), words = [], options = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) { words.push(args[i]); continue; }
    const key = args[i].slice(2);
    if (!["file", "plan", "node", "attempt", "state", "evidence", "agent", "workspace", "request-id", "expected", "reason", "told", "handled"].includes(key) || key in options || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Invalid or repeated option.");
    options[key] = args[++i];
  }
  let command;
  const file = async () => JSON.parse((await readFile(await inside(options.file), "utf8")).replace(/^\uFEFF/, ""));
  if (["plans", "agenda"].includes(words[0]) && words.length === 1) command = { op: words[0] };
  else if (words[0] === "plan" && words[1] === "draft") command = { op: "draft", definition: await file() };
  else if (words[0] === "plan" && words[1] === "revise") command = { op: "revise", definition: await file(), expected: options.expected, reason: options.reason };
  else if (words[0] === "plan" && words.length === 2) command = { op: "show", plan: words[1] };
  else if (words[0] === "start") command = options.file ? { op: "implicit", launch: await file() } : { op: "start", plan: options.plan, node: options.node };
  else if (words[0] === "record") command = options.told || options.handled ? { op: "ack", plan: options.plan, kind: options.told ? "told" : "handled", ids: (options.told ?? options.handled).split(",") } :
    { op: "record", plan: options.plan, node: options.node, attempt: options.attempt, state: options.state, evidence: options.evidence, ...(options.agent ? { agentId: options.agent } : {}), ...(options.workspace ? { workspaceId: options.workspace } : {}) };
  else throw new Error("Usage: workflow.mjs plans|plan <id>|plan draft|revise --file <json>|agenda|start|record. See data/workflows.md.");
  return submit(command, options["request-id"]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify({ ok: true, result: await main(process.argv.slice(2)) }, null, 2)); }
  catch (e) { console.log(JSON.stringify({ ok: false, error: e.message })); process.exitCode = 1; }
}
