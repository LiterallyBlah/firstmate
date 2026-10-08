#!/usr/bin/env node
// Plugin-owned transport helper. Credentials stay in the daemon's registry.
import { randomUUID } from "node:crypto";
import { readFile, realpath, stat, writeFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const queue = {{remoteQueueJson}};
const home = dirname(dirname(fileURLToPath(import.meta.url)));
// A whole Windows command line holds about 32,000 characters.
const MAX_PROMPT_CHARS = 28000;
// Options of `paseo run` and `paseo send` that take no value; any other option takes the next argument.
const FLAGS = new Set(["-d", "--background", "--json", "-q", "--quiet", "--no-headers", "--no-color", "--no-wait", "-h", "--help", "-v", "--version"]);
const usage = "Usage: node tools/remote.mjs hosts | <host-id-or-name> <paseo command...> [--prompt-file <file in the home>] | --request-file <JSON file with host and args>";

/** One Paseo command on the remote host, through the plugin's queue. */
async function remote(host, args) {
  const id = randomUUID();
  const request = join(queue, `${id}.request.json`);
  const response = join(queue, `${id}.response.json`);
  const temp = `${request}.tmp`;
  await writeFile(temp, JSON.stringify({ id, host, args, createdAt: Date.now() }), { mode: 0o600 });
  await rename(temp, request);
  const deadline = Date.now() + 180000;
  let result;
  while (Date.now() < deadline) {
    try { result = JSON.parse(await readFile(response, "utf8")); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await new Promise((done) => setTimeout(done, 250));
  }
  if (!result) {
    await rm(request, { force: true });
    throw new Error("Remote request timed out. Its outcome is uncertain: inspect the host before retrying a change.");
  }
  await rm(response, { force: true });
  if (result.id !== id || !result.ok) throw new Error(result.error || "Invalid remote response");
  return result.result;
}

/** A file inside the home, absolute or relative to it; symlinks may not lead out. */
async function homeFile(path) {
  const root = await realpath(home);
  let real;
  try { real = await realpath(resolve(home, path)); }
  catch { throw new Error(`Prompt file not found: ${path}`); }
  const inside = relative(root, real);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error("The prompt file must be inside the first mate's home");
  if (!(await stat(real)).isFile()) throw new Error(`Not a file: ${path}`);
  return real;
}

/** `--prompt-file <path>` → the file's text as the prompt, after `--` so a leading dash stays text. */
async function withPromptFile(args) {
  const at = args.findIndex((arg) => /^--prompt-file(?:=|$)/.test(arg));
  if (at < 0) return args;
  if (args[0] !== "run" && args[0] !== "send") throw new Error("--prompt-file is for run and send");
  const inline = args[at].startsWith("--prompt-file=");
  const path = inline ? args[at].slice("--prompt-file=".length) : args[at + 1];
  if (!path) throw new Error("--prompt-file needs a path");
  const rest = [...args.slice(0, at), ...args.slice(at + (inline ? 1 : 2))];
  if (rest.some((arg) => /^--prompt(?:-file)?(?:=|$)/.test(arg) || arg === "--")) throw new Error("--prompt-file is the whole prompt; give the prompt only once");
  const positionals = [];
  for (let i = 1; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("-")) positionals.push(arg);
    else if (!arg.includes("=") && !FLAGS.has(arg)) i++;
  }
  if (positionals.length !== (args[0] === "send" ? 1 : 0)) throw new Error(args[0] === "send" ? "With --prompt-file, send takes only the agent ID" : "With --prompt-file, run takes no prompt argument");
  const file = await homeFile(path);
  if ((await stat(file)).size > MAX_PROMPT_CHARS * 4) throw new Error(`Prompt file is larger than ${MAX_PROMPT_CHARS} characters`);
  const text = (await readFile(file, "utf8")).replace(/^\uFEFF/, "");
  if (!text.trim()) throw new Error("Prompt file is empty");
  if (text.length > MAX_PROMPT_CHARS) throw new Error(`Prompt file has ${text.length} characters; a command line takes at most ${MAX_PROMPT_CHARS}`);
  return [...rest, "--", text];
}

/** `C:Users\…` or `C:repo` is a Windows path whose backslashes a shell ate. */
function checkCwd(args) {
  for (let i = 0; i < args.length && args[i] !== "--"; i++) {
    const value = args[i] === "--cwd" ? args[i + 1] : args[i].startsWith("--cwd=") ? args[i].slice(6) : undefined;
    if (value !== undefined && /^[A-Za-z]:[^\\/]/.test(value)) throw new Error(`--cwd ${JSON.stringify(value)} looks like a Windows path that lost its backslashes. Put it in single quotes, write it with forward slashes (C:/path/to/repo), or use a request file.`);
  }
}

/** Paseo reports UTC (`…Z`); show the same instant in this machine's time, with its offset. */
function localTime(text) {
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  const offset = -date.getTimezoneOffset();
  const abs = Math.abs(offset);
  const zone = `${offset < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${new Date(date.getTime() + offset * 60000).toISOString().slice(0, -1)}${zone}`;
}
function localTimes(value) {
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ? localTime(value) : value;
  if (Array.isArray(value)) return value.map(localTimes);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, localTimes(entry)]));
  return value;
}

/** `permit ls` names only the tool. An agent's latest tool calls carry what it
 * is asking: a pending Bash call is usually the last, with its command. */
async function withRecentTools(host, rows) {
  if (!Array.isArray(rows)) return rows;
  const agents = [...new Set(rows.map((row) => row?.agentId).filter((id) => typeof id === "string"))].slice(0, 10);
  const recent = new Map();
  for (const agent of agents) {
    try {
      const logs = await remote(host, ["logs", agent, "--filter", "tools", "--tail", "3"]);
      recent.set(agent, { recentTools: String(typeof logs === "string" ? logs : JSON.stringify(logs)).split(/\r?\n/).map((line) => line.trim()).filter(Boolean) });
    } catch (error) { recent.set(agent, { recentToolsError: error.message }); }
  }
  return rows.map((row) => ({ ...row, ...recent.get(row?.agentId) }));
}

let [host, ...args] = process.argv.slice(2);
try {
  if (host === "--request-file") {
    if (args.length !== 1) throw new Error("Usage: node tools/remote.mjs --request-file <JSON file with host and args>");
    const input = JSON.parse((await readFile(args[0], "utf8")).replace(/^\uFEFF/, ""));
    if (typeof input.host !== "string" || !Array.isArray(input.args) || input.args.some((arg) => typeof arg !== "string")) throw new Error("Request file must contain a host string and an args array of strings");
    host = input.host; args = input.args;
  }
  if (host === "hosts") {
    const text = await readFile(join(home, "data", "remote-hosts.json"), "utf8");
    let hosts;
    try { hosts = JSON.parse(text); } catch { console.log(text); }
    if (hosts !== undefined) console.log(JSON.stringify(localTimes(hosts), null, 2));
  } else {
    if (!host || !args.length) throw new Error(usage);
    checkCwd(args);
    args = await withPromptFile(args);
    let result = await remote(host, args);
    if (args[0] === "permit" && args[1] === "ls") result = await withRecentTools(host, result);
    console.log(typeof result === "string" ? result : JSON.stringify(localTimes(result), null, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
