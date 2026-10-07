#!/usr/bin/env node
// Plugin-owned transport helper. Credentials stay in the daemon's registry.
import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const queue = {{remoteQueueJson}};
let [host, ...args] = process.argv.slice(2);
try {
  if (host === "--request-file") {
    if (args.length !== 1) throw new Error("Usage: node tools/remote.mjs --request-file <JSON file with host and args>");
    const input = JSON.parse(await readFile(args[0], "utf8"));
    if (typeof input.host !== "string" || !Array.isArray(input.args) || input.args.some((arg) => typeof arg !== "string")) throw new Error("Request file must contain a host string and an args array of strings");
    host = input.host; args = input.args;
  }
  if (host === "hosts") {
    const home = dirname(dirname(fileURLToPath(import.meta.url)));
    console.log(await readFile(join(home, "data", "remote-hosts.json"), "utf8"));
  } else {
    if (!host || !args.length) throw new Error("Usage: node tools/remote.mjs hosts | <host-id-or-name> <paseo command...>");
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
    console.log(JSON.stringify(result.result, null, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
