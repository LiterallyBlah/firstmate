// Plugin-owned role check. Environment values are hints, never durable authority.
// Paths are rendered by the daemon, not selected from this session's environment.
import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const daemonHome = {{paseoHomeJson}};
const home = {{homeJson}};
// Generated from the plugin's actual input schema, so invalid config cannot grant a role
// when the plugin itself would fall back to defaults. No dependencies in a prepared home.
const configSchema = {{configSchemaJson}};
function valid(value, schema) {
  if (schema.anyOf) return schema.anyOf.some(option => valid(value, option));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "null") return value === null;
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return (schema.required ?? []).every(key => Object.hasOwn(value, key)) &&
      Object.entries(value).every(([key, item]) => schema.properties?.[key] ? valid(item, schema.properties[key]) : schema.additionalProperties !== false);
  }
  if (schema.type === "array") return Array.isArray(value) && value.every(item => valid(item, schema.items));
  if (schema.type === "string") return typeof value === "string" && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity);
  return false; // An unfamiliar future schema needs an explicit validator update.
}
const canonical = async path => {
  const actual = await realpath(path);
  return process.platform === "win32" ? actual.toLowerCase() : actual;
};
async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
// Same precedence as server/data-dir.ts: current wins; legacy only when current is absent.
async function dataPath(entry) {
  const current = join(daemonHome, "plugin-data", "firstmate", entry);
  const legacy = join(daemonHome, "plugins", "firstmate", entry);
  return !(await exists(current)) && await exists(legacy) ? legacy : current;
}
async function role() {
  const id = process.env.PASEO_AGENT_ID;
  if (!id?.trim() || id !== id.trim()) return "guest";
  if (process.env.PASEO_HOME && await canonical(process.env.PASEO_HOME) !== await canonical(daemonHome)) return "guest";
  if (await canonical(join(dirname(fileURLToPath(import.meta.url)), "..")) !== await canonical(home)) return "guest";
  const config = JSON.parse(await readFile(await dataPath("config.json"), "utf8"));
  if (!valid(config, configSchema) || config.mateAgentId !== id) return "guest";
  let configured = (config.home ?? "").trim();
  if (!configured) configured = await dataPath("home");
  else if (configured === "~") configured = homedir();
  else if (configured.startsWith("~/")) configured = join(homedir(), configured.slice(2));
  else if (!isAbsolute(configured)) return "guest";
  if (await canonical(resolve(configured)) !== await canonical(home)) return "guest";
  if (config.mateLaunch != null && (config.migration != null || config.mateLaunch.agentId !== id ||
      config.mateLaunch.state !== "sending" || await canonical(config.mateLaunch.home) !== await canonical(home))) return "guest";
  if (config.migration != null &&
      (typeof config.migration.sourceId !== "string" || typeof config.migration.agentId !== "string" ||
       config.migration.sourceId === config.migration.agentId ||
       ![config.migration.sourceId, config.migration.agentId].includes(id))) return "guest";
  return "first-mate";
}
console.log(await role().catch(() => "guest"));
