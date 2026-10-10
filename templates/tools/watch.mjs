// Plugin-owned transport. Creation/configuration JSON has explicit routing fields; never encode routing in a script.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const operation = process.argv[2];
if (!["create", "configure"].includes(operation) || process.argv[3] !== "--file" || !process.argv[4]) {
  process.stderr.write('Usage: node tools/watch.mjs create|configure --file request.json [--request-id UUID]\n'); process.exit(2);
}
const input = JSON.parse(await readFile(resolve(process.argv[4]), "utf8"));
const id = process.argv[5] === "--request-id" ? process.argv[6] : randomUUID();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id ?? "")) throw new Error("Invalid request ID.");
const home = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = join(home, "data", "watch-requests"); await mkdir(directory, { recursive: true });
const path = join(directory, `${id}.json`); const temporary = `${path}.tmp`;
const request = { id, operation, input };
try {
  const previous = JSON.parse(await readFile(path, "utf8"));
  if (JSON.stringify(previous) !== JSON.stringify(request)) throw new Error("Request ID already has different fields.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await writeFile(temporary, `${JSON.stringify(request)}\n`, "utf8"); await rename(temporary, path);
}
process.stderr.write(`Watch request ${id}; retry with the same --request-id if delivery is uncertain.\n`);
const deadline = Date.now() + 45000;
while (Date.now() < deadline) {
  try {
    const result = JSON.parse(await readFile(join(directory, `${id}.reply.json`), "utf8"));
    process.stdout.write(`${JSON.stringify({ id, ...result })}\n`); process.exit(result.ok ? 0 : 1);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await new Promise((done) => setTimeout(done, 250));
}
process.stderr.write(`No plugin reply yet. Request ${id} remains queued; retry this ID after the plugin is available.\n`); process.exit(1);
